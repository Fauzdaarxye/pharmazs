# PharmaZs — Backend API

Node.js + Express 5 API for the PharmaZs commercial-intelligence platform. It is the
**only** layer that holds DB credentials and the only thing that talks to the Python
FastAPI ML service (CONTRACT §1). The frontend talks to this API and nothing else.

## Stack

TypeScript · Express 5 · mysql2 (promise pool) · jsonwebtoken · bcrypt · zod ·
helmet · cors · express-rate-limit · pino · Jest + Supertest.

## Architecture

Strict layering — a request flows **routes → controllers → services → repositories**:

```
src/
  config.ts              env loading + validation
  logger.ts              pino, with token/password redaction
  server.ts              entrypoint (listen + graceful shutdown)
  app.ts                 Express app assembly (helmet, cors, rate-limit, routers)
  types.ts               Principal / Role types
  db/pool.ts             mysql2 promise pool + query helpers
  auth/
    token.ts             JWT sign/verify, refresh-token hashing
    middleware.ts        authenticate + requireRole
  http/
    envelope.ts          success/failure envelope + ApiError
    middleware.ts        asyncHandler, central error middleware, 404
    query.ts             pagination / date / sort parsing (allow-listed)
    scope.ts             role scoping → SQL WHERE fragments
    filters.ts           common §4 query-param extraction
  ml/client.ts           typed FastAPI client (5s timeout → ML_UNAVAILABLE)
  routes/                one router per domain
  controllers → services → repositories   (SQL lives ONLY in repositories)
```

**SQL discipline (CONTRACT §8):** every query is parameterised with `?` placeholders.
No user input is ever concatenated into SQL. Sort columns are validated against a
per-endpoint **allow-list** (`http/query.ts::parseSort`) — an unknown sort field is a
`VALIDATION_ERROR`, never interpolated. `snake_case → camelCase` conversion happens in
the repository layer.

## Configuration

Copy `.env.example` to `.env` and adjust. `.env` is git-ignored; only `.env.example`
is committed. Never log a token or password (the logger redacts them).

```
PORT=4000
DB_HOST=127.0.0.1  DB_PORT=3307  DB_USER=pharmazs  DB_PASSWORD=pharmazs_dev_2026
DB_NAME=pharmazs   DB_SOCKET=/opt/homebrew/var/mysql/pharmazs.sock
JWT_ACCESS_SECRET=…  JWT_ACCESS_TTL=15m  REFRESH_TTL_DAYS=7  BCRYPT_COST=10
ML_BASE_URL=http://localhost:8000  ML_TIMEOUT_MS=5000
CORS_ORIGINS=http://localhost:3000
```

The database is the **isolated Homebrew MySQL on port 3307** (never the system MySQL on
3306). Start it with `../database/mysql-start.sh`.

## Running

```bash
npm install
npm run build      # tsc → dist/, must pass with zero errors
npm start          # node dist/server.js  → http://localhost:4000/api
npm run dev        # ts-node-dev with reload
npm test           # Jest + Supertest against the real seeded DB
```

## Response envelope (CONTRACT §2)

```jsonc
{ "success": true,  "data": <payload>, "meta": { /* pagination, highlights, timings */ } }
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [] } }
```

Error codes → HTTP status: `VALIDATION_ERROR` 400 · `UNAUTHORIZED` 401 · `FORBIDDEN` 403
· `NOT_FOUND` 404 · `RATE_LIMITED` 429 · `ML_UNAVAILABLE` 503 · `INTERNAL` 500.

Money is returned as a number of rupees; percentages as numbers in percent units.

## Auth (CONTRACT §3)

- `POST /api/auth/register` · `POST /api/auth/login` · `POST /api/auth/refresh`
  · `POST /api/auth/logout` · `GET /api/auth/me`
- Access token: JWT HS256, 15 min, payload `{ sub, email, role, repId, regionId }`.
- Refresh token: opaque random, 7 days, **sha256 hash** stored in `refresh_tokens`.
- Passwords: bcrypt cost 10.

Demo accounts (password `PharmaZs@2026`): `admin@`, `exec@`, `manager@`, `rep@`,
`analyst@` `pharmazs.io`.

## Role scoping (CONTRACT §3) — enforced in SQL

| Role      | Scope |
|-----------|-------|
| ADMIN / EXECUTIVE / ANALYST | unrestricted (read) |
| MANAGER   | own `region_id` only |
| SALES_REP | own assigned HCP panel / own rep rows only |

Scoping is applied as a `WHERE` fragment in the query (`http/scope.ts`), **not** by
filtering results afterward — a SALES_REP never receives another rep's rows in the JSON.
This is proven by the test suite (`SALES_REP scoping`, `MANAGER scoping`).

## Lists: pagination, filtering, sorting

Every list endpoint is server-side paginated (`page`, `pageSize` default 25, max 200),
filterable (CONTRACT §4 common params), and sortable via `sort=-field` against an
allow-list. Pagination metadata is returned in `meta`.

## ML passthrough

`GET /api/*/forecast`, `/api/forecast`, `/api/anomalies`, `/api/recommendations`,
`/api/hcps/:id/score`, `/api/reps/:id/recommended-hcps`, `/api/dashboard/alerts`, and
`POST /api/analytics/why-did-sales-change` call the FastAPI service through a typed client
with a **5-second timeout**. When FastAPI is unreachable the API returns `503` with code
`ML_UNAVAILABLE` — it never fabricates ML numbers and never crashes. These endpoints start
working the moment FastAPI comes up.

## Endpoint surface (40 total)

Auth (5), Dashboard (7), Products (6), HCPs (5), Reps (4), Regions (3),
Competitors (2), Inventory (2), Meta (1), ML/analytics passthrough (4), plus
`GET /api/health` (DB + ML reachability). See CONTRACT §5 for the full spec.

## Health

`GET /api/health` → `{ status, db: "up"|"down", ml: "up"|"down", time }`. Returns 200 when
the DB is reachable, 503 when it is not.
