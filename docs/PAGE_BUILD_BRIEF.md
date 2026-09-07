# Page build brief — read this before writing any page

Applies to every agent building a PharmaIQ page. Three agents work inside
`frontend/` simultaneously, so the boundaries below are not style preferences —
ignoring them causes merge conflicts and lost work.

## Read first, completely

1. **`docs/API_SHAPES.md`** — response shapes probed from the RUNNING API.
   Authoritative over any prose, including `CONTRACT.md`. Build against it.
2. **`docs/CONTRACT.md` §7** — the design system transcribed from the client's
   approved Figma: exact palette, type scale, card/table/badge patterns, and the
   fixed therapeutic-area colour map (a colour must mean the same area on every page).
   **§9** — the per-page specifications.
3. **`frontend/app/(app)/dashboard/page.tsx`** and
   **`frontend/app/(app)/hcps/page.tsx`** — the two Figma-approved reference pages.
   Match their structure and idioms: `PageHeader`, a KPI row, a filter bar, then the
   main card(s). Your page must look like a sibling of these, not like a different app.

## The stack is already running — do not start or restart anything

MySQL `:3307`, ML `:8000`, API `:4000`, Next dev `:3000` are up, and Next hot-reloads
your edits. Restarting a shared service breaks the other agents mid-flight.

To call the API directly:

```bash
API=http://127.0.0.1:4000/api
TOK=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"exec@pharmaiq.io","password":"PharmaIQ@2026"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['accessToken'])")
curl -s -H "Authorization: Bearer $TOK" "$API/products?pageSize=2"
```

## Hard boundaries

**You may create or edit only** your own assigned `frontend/app/(app)/<page>/**`
routes, plus new files under your own `frontend/components/<page>/` folders.

**Do not modify** any of these — they are shared and were written by a single hand
deliberately, so that 22 client methods and their types could land without three
agents colliding in the same files:

- `frontend/lib/api.ts`, `frontend/lib/types.ts`, `frontend/lib/types-pages.ts`
- `frontend/lib/mocks.ts`, `frontend/lib/format.ts`, `frontend/lib/constants.ts`
- anything in `frontend/components/ui/` or `frontend/components/shell/`
- any page that is not yours

Every client method and type you need **already exists**. If something seems
missing, re-read `frontend/lib/api.ts` and `frontend/lib/types-pages.ts` before
concluding otherwise — and if it genuinely is missing, **report it rather than
adding it**.

Import shared UI as `import { Card, DataTable, ... } from "@/components/ui"` and
formatting from `@/lib/format`. **Never call `fetch` directly** — use `endpoints.*`
from `@/lib/api`.

Available in `@/components/ui`: `Card`, `CardHeader`, `DeltaBadge`, `Pill`, `TaBadge`,
`ScoreBadge`, `PriorityBadge`, `KpiCard`, `KpiCardSimple`, `Sparkline`,
`SegmentedControl`, `FilterChipBar`, `FilterSelectBar`, `DataTable`,
`AiInsightBanner`, `AiAlertBanner`, `StatTile`, `ChartCard`, `Breadcrumb`,
`Spinner`, `CenteredSpinner`, `ErrorState`, `EmptyState`.

Available in `@/lib/format`: `formatCurrency`, `formatCurrencyAxis`, `formatCompact`,
`formatNumber`, `formatPercent`, `formatPercentagePoints`, `formatScore`,
`formatRelativeDate`, `formatDate`, `formatPeriod`.

## Requirements for every page

- **Loading, empty and error states are mandatory** (SRS §40). A chart or table that
  silently renders nothing on failure is a defect, not a blank slate.
- **Server-side pagination, sorting and filtering.** Never fetch a whole table and
  filter it in the browser. Paginated helpers return `{ data, meta }`; drive
  `DataTable`'s pager from `meta`.
- **`"All"` is a UI-only sentinel and must become `undefined` before it reaches the
  API.** The API filters literally: sending the string `"All"` matched zero rows and
  rendered the entire HCP directory empty with every dropdown still on its default.
  This is the single most likely way to break your own page.
- **Formatting lives in the UI.** The API returns raw numbers; run money through
  `formatCurrency` / `formatCompact` (Indian ₹ Cr / L) and use tabular numerals so
  number columns align.
- A forecast is an **estimate**. Word it that way and show `mape` so a user can judge
  it (SRS §23). Never imply a guarantee.

## Verify — mandatory, and take the light path

Host memory is tight, so:

- `cd frontend && npx tsc --noEmit` must be **clean**.
- **Do not run `npm run build`** — it is memory-heavy and the parent runs one build
  at the end for everyone.
- For each route: `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/<route>`
  expecting `200`, then check `.run/web.log` for compile errors or warnings your
  change introduced, and fix them.
- Confirm the page shows **real data**: curl the underlying endpoint and sanity-check
  a couple of numbers against what your page renders.

Report the routes and components you created, the `tsc` result, and one real number
from each page.
