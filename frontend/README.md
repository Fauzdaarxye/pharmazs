# PharmaIQ — Frontend

Next.js 15 (App Router) · TypeScript · Tailwind CSS v4 · Recharts · lucide-react.
Built strictly against `docs/CONTRACT.md` §7 (design system) and §9 (page specs).

## Run

```bash
npm install
npm run dev          # http://127.0.0.1:3000
```

`.env.local` ships with `NEXT_PUBLIC_USE_MOCKS=1`, so the UI is fully reviewable
**without a backend** — every screen renders from contract-shaped fixtures in
`lib/mocks.ts`. Point at the real API and turn mocks off:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api
NEXT_PUBLIC_USE_MOCKS=0
```

Demo logins (mock or real): the five accounts from Contract §3, password
`PharmaIQ@2026`.

## Verify

```bash
npm run build        # zero TS + zero ESLint errors, all routes generated
npx tsc --noEmit     # clean
```

## Layout

```
app/
  login/                 # split-layout sign-in (no shell)
  (app)/                 # everything inside the shell (auth-guarded)
    layout.tsx           #   AppShell = sidebar + topbar + content column
    dashboard/           #   Figma screen 1 — built pixel-faithfully
    hcps/                #   Figma screen 2 — built pixel-faithfully
    overview products sales-reps regions competitors inventory
    forecasting alerts recommendations reports   # "Coming next" stubs
components/
  ui/                    # the shared component library (Contract §7)
  shell/                 # Sidebar, Topbar, AppShell, PageHeader, ComingSoon
  charts/                # Recharts wrappers (RevenueTrendChart …)
lib/
  api.ts                 # THE typed client — envelope unwrap, JWT, 401 refresh
  format.ts              # ALL display formatting (₹ Cr/L, %, relative dates)
  types.ts               # API response shapes (§5)
  constants.ts           # TA colour map, nav, config
  mocks.ts               # contract-shaped fixtures for NEXT_PUBLIC_USE_MOCKS
```

## Conventions

- **No component calls `fetch`.** All data goes through `lib/api.ts`
  (`endpoints.*`), which transparently serves mocks when enabled.
- **All formatting lives in `lib/format.ts`.** The API returns raw numbers.
- Every data surface has **loading / empty / error** states (SRS §40).
- Therapeutic-area colours are fixed in `lib/constants.ts` — a colour always
  means the same area on every page. Figures use tabular numerals (`.tnum`).
- The ten stub routes render the shell + breadcrumb + H1 + a `Coming next`
  state; invent-any-page-shape work goes into a reusable component, not the page
  file, so another agent can drop in the real content from §9.
