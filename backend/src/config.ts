import dotenv from 'dotenv';
import path from 'path';

// This file lives in backend/src (ts-node) or backend/dist (compiled), so '..'
// is the backend root in BOTH cases — which is where .env actually is.
//
// This was '../../.env', i.e. the PROJECT root, where no .env exists. dotenv
// does not error on a missing file, so every value silently fell back to its
// development default below — including the JWT signing secret. It only looked
// correct locally because the defaults happen to match the dev machine.
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const isProduction = (process.env.NODE_ENV ?? 'development') === 'production';

// Values whose development fallback is either a secret or an assumption about
// localhost. Under NODE_ENV=production they must be supplied explicitly: a
// silent fallback here ships a known JWT secret or points at a database that
// isn't there, and both fail in ways that look like something else.
const PRODUCTION_REQUIRED = [
  'JWT_ACCESS_SECRET',
  'DB_HOST',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
  'ML_BASE_URL',
  'CORS_ORIGINS',
] as const;

// Presence alone is NOT sufficient. dotenv runs first, so a .env file copied
// onto the server satisfies every presence check while still handing over the
// placeholder values committed to this repository. These are the strings that
// must never sign a token or open a database in production.
const KNOWN_DEV_VALUES = ['dev-local', 'change-me', 'pharmazs_dev_2026', 'do-not-use'];

function looksLikeDevValue(value: string): boolean {
  const v = value.toLowerCase();
  return KNOWN_DEV_VALUES.some((marker) => v.includes(marker));
}

function assertProductionSafe(): void {
  const problems: string[] = [];

  for (const name of PRODUCTION_REQUIRED) {
    if (!process.env[name]) problems.push(`${name} is not set`);
  }

  const secret = process.env.JWT_ACCESS_SECRET;
  if (secret) {
    if (looksLikeDevValue(secret)) {
      problems.push('JWT_ACCESS_SECRET is a development placeholder from this repository');
    } else if (secret.length < 32) {
      problems.push(
        `JWT_ACCESS_SECRET is only ${secret.length} chars; use at least 32 (openssl rand -base64 48)`,
      );
    }
  }

  const dbPassword = process.env.DB_PASSWORD;
  if (dbPassword && looksLikeDevValue(dbPassword)) {
    problems.push('DB_PASSWORD is a development placeholder from this repository');
  }

  // A production API that still trusts loopback origins is either misconfigured
  // or about to reject every real browser request at the preflight.
  const cors = process.env.CORS_ORIGINS;
  if (cors && /localhost|127\.0\.0\.1/.test(cors)) {
    problems.push(`CORS_ORIGINS still contains a loopback origin: ${cors}`);
  }
  if (cors === '*') {
    problems.push('CORS_ORIGINS must name real origins, not "*"');
  }

  if (problems.length) {
    throw new Error(
      'Refusing to start with NODE_ENV=production:\n  - ' +
        problems.join('\n  - ') +
        '\nSee docs/DEPLOYMENT.md §2. Supply real environment variables rather ' +
        'than copying backend/.env to the server.',
    );
  }
}

if (isProduction) assertProductionSafe();

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`Env var ${name} must be a number, got "${v}"`);
  return n;
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: num('PORT', 4000),
  db: {
    host: req('DB_HOST', '127.0.0.1'),
    port: num('DB_PORT', 3307),
    user: req('DB_USER', 'pharmazs'),
    password: req('DB_PASSWORD', 'pharmazs_dev_2026'),
    database: req('DB_NAME', 'pharmazs'),
    socketPath: process.env.DB_SOCKET || undefined,
    connectionLimit: num('DB_CONNECTION_LIMIT', 10),
  },
  jwt: {
    accessSecret: req('JWT_ACCESS_SECRET', 'dev-local-access-secret'),
    accessTtl: req('JWT_ACCESS_TTL', '15m'),
    refreshTtlDays: num('REFRESH_TTL_DAYS', 7),
  },
  bcryptCost: num('BCRYPT_COST', 10),
  ml: {
    baseUrl: req('ML_BASE_URL', 'http://localhost:8000'),
    timeoutMs: num('ML_TIMEOUT_MS', 5000),
  },
  // Both loopback spellings are allowed by default. A browser treats
  // http://localhost:3000 and http://127.0.0.1:3000 as DIFFERENT origins, so
  // allowing only one produces a CORS preflight failure the moment a developer
  // (or a headless test) opens the other — which is exactly how this was found.
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000,http://127.0.0.1:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  rateLimit: {
    windowMs: num('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
    max: num('RATE_LIMIT_MAX', 300),
  },
  logLevel: process.env.LOG_LEVEL ?? 'info',
} as const;

export type AppConfig = typeof config;
