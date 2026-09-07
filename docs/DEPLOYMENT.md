# PharmaZs — Deployment

How to take this repository from a laptop to a hosted environment, what has to
be configured, and how to verify the deploy actually worked.

---

## 1. What has to run

Four processes. One of them must **not** be publicly reachable.

| Component | Stack | Public? | Port | Notes |
|---|---|---|---|---|
| MySQL | MySQL 8.4+ | No | 3306 | ~22 tables, ~150 MB once seeded |
| ML service | FastAPI + uvicorn (Python 3.14) | **No** | 8000 | Internal by contract; called only by the API |
| API | Node 22 + Express | Yes | 4000 | JWT auth, role scoping in SQL |
| Frontend | Next.js 15 | Yes | 3000 | 19 routes |

The ML service has no authentication of its own (CONTRACT §6: plain JSON, no
envelope, no auth). Its only protection is being unreachable from the internet.
Publishing it exposes unauthenticated analytics over your whole dataset.

---

## 2. Environment variables

### API (`backend`)

| Variable | Required in production | Notes |
|---|---|---|
| `NODE_ENV` | yes — set to `production` | Enables the strict startup check below |
| `PORT` | no (4000) | |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | **yes** | |
| `DB_SOCKET` | **must be unset** | A socket path makes mysql2 ignore `DB_HOST` entirely |
| `JWT_ACCESS_SECRET` | **yes** | `openssl rand -base64 48` |
| `JWT_ACCESS_TTL` | no (`15m`) | |
| `REFRESH_TTL_DAYS` | no (7) | |
| `ML_BASE_URL` | **yes** | Private address of the ML service |
| `ML_TIMEOUT_MS` | no (5000) | Raise to ~8000 if the ML service is a network hop away |
| `CORS_ORIGINS` | **yes** | Comma-separated **browser** origins |
| `RATE_LIMIT_MAX` | no (300 / 15 min) | `trust proxy` is already set, so limits key off the real client IP behind a reverse proxy |

`backend/src/config.ts` refuses to start when `NODE_ENV=production` and the
configuration is unsafe. It checks more than presence, because dotenv runs first
— so copying `backend/.env` onto a server would otherwise satisfy every
presence check while still handing over the placeholders committed to this
repository. It rejects:

- any of `JWT_ACCESS_SECRET`, `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`,
  `ML_BASE_URL`, `CORS_ORIGINS` being absent;
- a `JWT_ACCESS_SECRET` or `DB_PASSWORD` containing a known development marker
  (`dev-local`, `change-me`, `pharmazs_dev_2026`, `do-not-use`);
- a `JWT_ACCESS_SECRET` shorter than 32 characters;
- a `CORS_ORIGINS` that still contains `localhost`/`127.0.0.1`, or is `*`.

This is why `.env.docker.example` and `backend/.env.example` ship `change-me-…`
values: they are rejected on purpose, so an unedited copy fails loudly at
startup instead of running with a secret that is public in this repository.

### ML service (`ml-service`)

`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, plus `ML_HOST`
(`0.0.0.0` in a container, `127.0.0.1` on a single host) and `ML_PORT`.

### Frontend (`frontend`)

`NEXT_PUBLIC_API_BASE_URL` (no trailing slash, includes `/api`) and
`NEXT_PUBLIC_USE_MOCKS=0`.

> `NEXT_PUBLIC_*` is **inlined into the client bundle at build time.** You cannot
> re-point a built image or a built Vercel deployment at a different API by
> changing a runtime variable — you must rebuild. Leaving
> `NEXT_PUBLIC_USE_MOCKS=1` ships a UI that renders fixtures and never calls the
> backend, which looks like a working deploy.

---

## 3. Path A — Railway (database + API + ML) and Vercel (frontend)

Railway is used here because it is the straightforward managed **MySQL** option;
Render has no first-party MySQL. Vercel serves the frontend on its free tier.

### 3.1 Database

1. Railway → **New Project** → **Add MySQL**.
2. From the service's Variables tab, note `MYSQLHOST`, `MYSQLPORT`,
   `MYSQLUSER`, `MYSQLPASSWORD`, `MYSQLDATABASE`.
3. Apply the schema (from the repository root):

   ```bash
   mysql -h <MYSQLHOST> -P <MYSQLPORT> -u <MYSQLUSER> -p<MYSQLPASSWORD> \
     < database/schema/01_schema.sql
   ```

   Note that `01_schema.sql` begins with `DROP DATABASE IF EXISTS pharmazs` and
   creates its own schema named `pharmazs`. If Railway provisioned a database
   under a different name, either use `pharmazs` as `DB_NAME` or edit those
   first three statements.

4. Seed it — see [§5](#5-seeding-the-database).

### 3.2 ML service

1. **New Service** → deploy from your GitHub repo.
2. Settings → **Root Directory**: `ml-service`.
3. Variables: the five `DB_*` values, plus `ML_HOST=0.0.0.0`.
4. Start command:
   `python -m uvicorn app.main:app --host 0.0.0.0 --port $PORT`
5. **Do not generate a public domain for this service.** Note its internal
   address, `<name>.railway.internal`.

### 3.3 API

1. **New Service** → same repo → **Root Directory**: `backend`.
2. Build: `npm ci && npm run build` · Start: `npm start`
3. Variables: `NODE_ENV=production`, the `DB_*` set (**omit `DB_SOCKET`**),
   `ML_BASE_URL=http://<ml-name>.railway.internal:8000`, a generated
   `JWT_ACCESS_SECRET`. Leave `CORS_ORIGINS` for step 3.5.
4. Generate a public domain. Confirm `https://<api-domain>/api/health` responds
   with database and ML both reachable.

### 3.4 Frontend

1. Vercel → **Import** the repo → **Root Directory**: `frontend`.
2. Environment variables:
   `NEXT_PUBLIC_API_BASE_URL=https://<api-domain>/api` and
   `NEXT_PUBLIC_USE_MOCKS=0`.
3. Deploy, and note the resulting domain.

### 3.5 Close the CORS loop

Set `CORS_ORIGINS=https://<vercel-domain>` on the **API** service and let it
redeploy. Skipping this is the single most common failure mode of this stack: the
login request fails its preflight, and the UI presents it as a broken login
rather than a configuration error.

---

## 4. Path B — one VM with docker compose

Cheaper (~$6–12/mo), and it matches the original architecture more closely: the
ML service stays on a private network with no published port.

```bash
git clone https://github.com/Fauzdaarxye/<repo>.git pharmazs
cd pharmazs
cp .env.docker.example .env
$EDITOR .env            # real DB password, generated JWT secret, public origins
docker compose build
docker compose up -d
docker compose ps       # mysql healthy, ml/api/web up
```

The API and frontend publish to `127.0.0.1` only, so terminate TLS on the host
and proxy inward. Minimal nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name pharmazs.example.com;

    # certbot --nginx manages these
    ssl_certificate     /etc/letsencrypt/live/pharmazs.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pharmazs.example.com/privkey.pem;

    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 12m;   # CSV import accepts up to 10 MB
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Then set, in `.env`, `CORS_ORIGINS=https://pharmazs.example.com` and
`NEXT_PUBLIC_API_BASE_URL=https://pharmazs.example.com/api`, and rebuild the
frontend (`docker compose build web && docker compose up -d web`) — that value
is compiled in.

`client_max_body_size` matters: the Data Import Center accepts CSV uploads up to
10 MB, and nginx's 1 MB default rejects them with a 413 before Express sees the
request.

---

## 5. Seeding the database

Two routes. **Prefer the dump.**

### Dump and restore (recommended)

`LOAD DATA LOCAL INFILE`, which `database/schema/02_load.sql` relies on, is
disabled by most managed MySQL providers. A dump avoids the question:

```bash
# From the machine holding the working local database
mysqldump --socket=/opt/homebrew/var/mysql/pharmazs.sock -u pharmazs -p \
  --single-transaction --routines --no-tablespaces \
  pharmazs > pharmazs-seed.sql

mysql -h <host> -P <port> -u <user> -p <database> < pharmazs-seed.sql
```

`sales.revenue` is a STORED generated column. `mysqldump` handles it correctly;
hand-rolled `INSERT`s that include a value for it are rejected by MySQL.

### Regenerate from source

```bash
cd data-generator && .venv/bin/python generate.py        # writes CSVs
cd ../database && mysql --local-infile=1 -h <host> -u <user> -p <db> \
  < schema/02_load.sql                                   # run from the CSV dir
```

Requires `local_infile=1` on both client and server. The compose MySQL service
enables it; most PaaS MySQL does not.

---

## 6. Populate the ML output tables

A seed dump carries transactional data only. `/dashboard/alerts` and
`/anomalies` read **persisted** tables that a refresh job writes — until it runs
they return empty rows, and the dashboard looks broken while the API reports
healthy.

```bash
# compose (ML has no published port, so call it from inside the network)
docker compose exec api node -e \
  "fetch(process.env.ML_BASE_URL+'/jobs/refresh-all',{method:'POST'}).then(r=>r.text()).then(console.log)"

# Railway: run from the ML service's shell
curl -X POST http://127.0.0.1:8000/jobs/refresh-all
```

Expect roughly 2,000 `hcp_scores`, 300 `forecasts`, 283 `anomalies` (254 point +
29 sustained level-shift) and 32 `alerts`. Re-run it after any data import.

---

## 7. Verifying the deploy

Do not stop at "the pages load" — this dataset has known values, so a bad seed
is detectable.

1. `GET /api/health` → database and ML both reachable.
2. Log in as `exec@pharmazs.io` (demo password `PharmaZs@2026`).
3. **Dashboard** — trailing-12-month revenue ≈ **₹179 Cr**; North leads, East
   flagged at risk.
4. **Recommendations** — defaults to CardioMax / North at **−15.7%** with five
   contributors summing to 100%.
5. Switch it to RespiCare / East over 2 months → inventory dominates the
   attribution (**−26.9%** revenue, a supply failure, not a demand one).
6. **Alerts** — 32 alerts and a populated anomalies tab. Empty means §6 was
   skipped.
7. **Sales Reps** — 60 field reps (managers excluded), attainment 85–123%,
   mean ≈ 101%.
8. Log in as a `SALES_REP` and confirm the HCP panel is scoped to their own 48
   physicians.

If revenue reads ~₹1,892 Cr instead of ~₹179 Cr, the seed predates the pack-size
correction — re-dump from a current database.

---

## 8. Security checklist

- [ ] `JWT_ACCESS_SECRET` is freshly generated, not the repository default.
- [ ] The ML service has no public domain and no published port.
- [ ] MySQL is not reachable from the internet.
- [ ] `CORS_ORIGINS` lists only real frontend origins — never `*`.
- [ ] TLS terminates in front of the API; JWTs must not cross plain HTTP.
- [ ] Demo accounts (`*@pharmazs.io`, shared password, click-to-fill on the
      login page) are acceptable for a demo and **not** for anything real.
- [ ] No `.env` is baked into an image; all three `.dockerignore` files exclude
      them.
- [ ] `NEXT_PUBLIC_USE_MOCKS=0` in every deployed build.

---

## 9. Troubleshooting

| Symptom | Cause |
|---|---|
| Login fails, browser console shows a CORS/preflight error | `CORS_ORIGINS` does not exactly match the frontend origin (scheme and host must both match) |
| API starts, then every query fails | `DB_SOCKET` is set, so `DB_HOST` is ignored |
| API refuses to start, naming variables | Working as designed — `NODE_ENV=production` with a missing variable, a repository placeholder secret, a secret under 32 chars, or a loopback `CORS_ORIGINS`. Fix the value; do not lower the check |
| Dashboard renders but every number is zero or fabricated | `NEXT_PUBLIC_USE_MOCKS=1` in the build |
| Forecasting/Alerts empty, health green | §6 refresh never ran |
| API reports the analytics service unavailable | `ML_BASE_URL` wrong, or the ML service is bound to loopback in a container (`ML_HOST=0.0.0.0`) |
| CSV import fails at ~1 MB | Reverse proxy body limit; see `client_max_body_size` |
| Changing the API URL has no effect on the frontend | `NEXT_PUBLIC_*` is build-time — rebuild |
