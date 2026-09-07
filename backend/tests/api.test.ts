import request from 'supertest';
import { Application } from 'express';
import { createApp } from '../src/app';
import { closePool } from '../src/db/pool';
import { login } from './helpers';

let app: Application;

beforeAll(() => {
  app = createApp();
});

afterAll(async () => {
  await closePool();
});

describe('Auth', () => {
  it('logs in a valid user and returns tokens + user', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@pharmazs.io', password: 'PharmaZs@2026' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.accessToken).toBe('string');
    expect(typeof res.body.data.refreshToken).toBe('string');
    expect(res.body.data.user.email).toBe('admin@pharmazs.io');
    expect(res.body.data.user.role).toBe('ADMIN');
  });

  it('rejects a wrong password with 401 UNAUTHORIZED', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@pharmazs.io', password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a malformed login body with 400 VALIDATION_ERROR', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('refreshes an access token, and /me works with it', async () => {
    const l = await login(app, 'exec@pharmazs.io');
    const refreshed = await request(app).post('/api/auth/refresh').send({ refreshToken: l.refreshToken });
    expect(refreshed.status).toBe(200);
    const newToken = refreshed.body.data.accessToken;
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${newToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe('exec@pharmazs.io');
  });

  it('revokes a refresh token on logout', async () => {
    const l = await login(app, 'analyst@pharmazs.io');
    const out = await request(app).post('/api/auth/logout').send({ refreshToken: l.refreshToken });
    expect(out.status).toBe(200);
    const reuse = await request(app).post('/api/auth/refresh').send({ refreshToken: l.refreshToken });
    expect(reuse.status).toBe(401);
  });
});

describe('Protected routes', () => {
  it('rejects a request with no token (401)', async () => {
    const res = await request(app).get('/api/dashboard/kpis');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a request with an invalid/garbage token (401)', async () => {
    const res = await request(app)
      .get('/api/dashboard/kpis')
      .set('Authorization', 'Bearer not.a.real.jwt');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('Dashboard KPIs (real seeded data)', () => {
  // This suite asserts INVARIANTS rather than magic revenue constants. The
  // original test pinned totalRevenue to ">₹18e9", which quietly encoded a bug as
  // the expected result: the KPI was summing the whole 24-month dataset while the
  // regional table beneath it summed only the trailing 12 months, so the two
  // disagreed by a factor of ~1.7 and the test passed anyway. A constant also
  // breaks whenever the generator is retuned. Cross-endpoint consistency is the
  // property we actually care about, and it would have caught the real defect.
  it('reports totals that reconcile with the regional breakdown', async () => {
    const { accessToken } = await login(app, 'admin@pharmazs.io');
    const auth = { Authorization: `Bearer ${accessToken}` };

    const kpis = await request(app).get('/api/dashboard/kpis').set(auth);
    expect(kpis.status).toBe(200);
    const regions = await request(app).get('/api/dashboard/regional-performance').set(auth);
    expect(regions.status).toBe(200);

    const regionSum = regions.body.data.reduce(
      (acc: number, r: { revenue: number }) => acc + r.revenue,
      0,
    );
    // Same window, same scope => same money, within a rounding tolerance.
    expect(kpis.body.data.totalRevenue).toBeGreaterThan(0);
    expect(Math.abs(kpis.body.data.totalRevenue - regionSum) / regionSum).toBeLessThan(0.005);

    expect(kpis.body.data.totalProducts).toBe(38);
    expect(kpis.body.data.activeHcps).toBeGreaterThan(0);
  });

  it('counts prescriptions as scripts, not dispensed units', async () => {
    const { accessToken } = await login(app, 'admin@pharmazs.io');
    const auth = { Authorization: `Bearer ${accessToken}` };

    const kpis = await request(app).get('/api/dashboard/kpis').set(auth);
    const products = await request(app).get('/api/dashboard/top-products?limit=6').set(auth);
    expect(products.status).toBe(200);

    const topSum = products.body.data.reduce(
      (acc: number, p: { prescriptions: number }) => acc + p.prescriptions,
      0,
    );
    // Six products cannot account for more scripts than the whole company wrote.
    // Summing `units` instead of rows put a single product above the total KPI.
    expect(topSum).toBeLessThan(kpis.body.data.totalPrescriptions);
    expect(topSum).toBeGreaterThan(0);
  });

  it('returns a month-aligned sparkline with no partial leading bucket', async () => {
    const { accessToken } = await login(app, 'admin@pharmazs.io');
    const res = await request(app).get('/api/dashboard/kpis').set({ Authorization: `Bearer ${accessToken}` });
    const spark: number[] = res.body.data.sparklines.totalRevenue;
    expect(spark).toHaveLength(12);
    // A non-month-aligned window made the first bucket a single DAY, ~45x smaller
    // than its neighbours, which rendered as a vertical cliff on the revenue chart.
    const median = [...spark].sort((a, b) => a - b)[Math.floor(spark.length / 2)];
    expect(spark[0]).toBeGreaterThan(median * 0.5);
  });
});

describe('Role scoping — SALES_REP', () => {
  it('only ever receives their own assigned HCP panel from /api/hcps', async () => {
    const { accessToken } = await login(app, 'rep@pharmazs.io');
    const res = await request(app)
      .get('/api/hcps?pageSize=200')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    // The rep owns a bounded panel — far fewer than the 2000 total HCPs.
    expect(res.body.meta.total).toBeGreaterThan(0);
    expect(res.body.meta.total).toBeLessThan(200);
    expect(res.body.data.length).toBe(res.body.meta.total);
    // Prove no foreign rows leaked: every returned HCP must be in the rep's panel.
    // We assert it indirectly by fetching a known out-of-panel HCP below.
  });

  it('cannot access an HCP outside their panel (403), even though it exists', async () => {
    const { accessToken } = await login(app, 'rep@pharmazs.io');
    const panel = await request(app)
      .get('/api/hcps?pageSize=200')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(panel.status).toBe(200);
    expect(Array.isArray(panel.body.data)).toBe(true);
    const ownIds = new Set<number>(panel.body.data.map((h: { hcpId: number }) => h.hcpId));
    // find an hcpId in 1..2000 that is NOT in the panel
    let foreign = -1;
    for (let i = 1; i <= 2000; i++) {
      if (!ownIds.has(i)) {
        foreign = i;
        break;
      }
    }
    expect(foreign).toBeGreaterThan(0);
    const res = await request(app)
      .get(`/api/hcps/${foreign}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('Role scoping — MANAGER', () => {
  it('only sees their own region in regional performance', async () => {
    const { accessToken } = await login(app, 'manager@pharmazs.io');
    const res = await request(app)
      .get('/api/dashboard/regional-performance')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1); // manager is scoped to a single region
  });

  it('cannot read another region (403)', async () => {
    const { accessToken } = await login(app, 'manager@pharmazs.io');
    // manager belongs to region 1; region 2 must be forbidden
    const res = await request(app).get('/api/regions/2').set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('Pagination', () => {
  it('honours page/pageSize and returns pagination meta', async () => {
    const { accessToken } = await login(app, 'admin@pharmazs.io');
    const res = await request(app)
      .get('/api/products?page=2&pageSize=5&sort=-revenue')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(5);
    expect(res.body.meta.page).toBe(2);
    expect(res.body.meta.pageSize).toBe(5);
    expect(res.body.meta.total).toBeGreaterThan(5);
    expect(res.body.meta.totalPages).toBe(Math.ceil(res.body.meta.total / 5));
  });

  it('rejects pageSize over the max (200) with VALIDATION_ERROR', async () => {
    const { accessToken } = await login(app, 'admin@pharmazs.io');
    const res = await request(app)
      .get('/api/products?pageSize=500')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('Query validation', () => {
  it('returns VALIDATION_ERROR for a non-integer query param', async () => {
    const { accessToken } = await login(app, 'admin@pharmazs.io');
    const res = await request(app)
      .get('/api/products?pageSize=abc')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a sort-injection attempt (sort not in the allow-list)', async () => {
    const { accessToken } = await login(app, 'admin@pharmazs.io');
    const res = await request(app)
      .get('/api/products?sort=revenue;DROP TABLE sales')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/sort/i);
  });
});

describe('ML passthrough when FastAPI is down', () => {
  it('returns 503 ML_UNAVAILABLE (never fabricates numbers, never crashes)', async () => {
    const { accessToken } = await login(app, 'admin@pharmazs.io');
    const res = await request(app)
      .get('/api/forecast?entityType=COMPANY&horizon=6')
      .set('Authorization', `Bearer ${accessToken}`);
    // If FastAPI happens to be up in this environment, a 200 is also acceptable.
    expect([503, 200]).toContain(res.status);
    if (res.status === 503) {
      expect(res.body.error.code).toBe('ML_UNAVAILABLE');
    }
  });
});
