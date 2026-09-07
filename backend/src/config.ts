import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

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
    user: req('DB_USER', 'pharmaiq'),
    password: req('DB_PASSWORD', 'pharmaiq_dev_2026'),
    database: req('DB_NAME', 'pharmaiq'),
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
