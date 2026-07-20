# 🛒 Coșul Ieftin — Romanian supermarket price comparison

Search day-to-day groceries across Romanian supermarkets, build your recurring basket (brand-level: „Apa Bucovina” vs „Aqua Carpatica”), pick your **județ**, and see **where that basket is cheapest**. Mobile-first PWA with a Romanian UI.

**The core of the project is the price scraper** — it pulls real prices from supermarket websites on a schedule, for **every county**, and feeds the product database. The app (search, basket comparison, admin) sits on top of that data.

## Scraper status per supermarket

| Supermarket | Source | Coverage | Status |
|---|---|---|---|
| **Lidl** | Public search API — full online catalog walked category-by-category with pagination | ~530 products with prices; **national prices** (same in every county) | ✅ verified live |
| **Kaufland** | Store-finder JSON (204 stores, county derived from postal code) + weekly offers JSON embedded in page + per-store offer lists | ~350 offer products/week × **all 42 counties** (~14,000 store prices) | ✅ verified live |
| **Auchan** | VTEX shop API (category tree + paginated product search) | Full online-shop catalog (thousands of products); national online prices | ✅ verified live |
| **Penny** | Public `product-discovery` API | ~290 published products (weekly assortment), prices in bani + price/unit; national | ✅ verified live |
| **Profi** | **Harvester** (desktop tool, see below) or headless Chromium from a residential IP | — | ⚠️ Cloudflare hard-blocks datacenter IPs → run the Harvester on your PC, upload the CSV |
| **Carrefour** | Server-rendered Magento category pages — clean per-product JSON in `data-event-attributes` + URL/image/old price from markup, paginated 24/page | Grocery categories (~9,000+ products, configurable via `CARREFOUR_CATEGORIES`); national online prices | ✅ verified live |
| **Mega Image** | GraphQL gateway (`/api/v1`) — accepts full queries (no persisted-query extraction needed); `productSearchV2` with empty query walks the whole catalog, 50/page | Full online catalog (~7,500 products); national online prices | ✅ verified live |
| **Metro** | **Harvester** (desktop tool, see below) | — | ⚠️ 403 for datacenter IPs; note real prices may require customer login |
| **Selgros** | offers published as PDF catalogs | — | ❌ no structured source; CSV import |
| **La Cocoș** | **Harvester** (desktop tool, see below) | — | ⚠️ 403 for datacenter IPs |

### Harvester — the desktop companion for blocked sites

`harvester/` contains a standalone Windows tool (`CosulIeftin-Harvester.exe`, built via Node SEA) you run **on your own PC**: it drives your installed Chrome/Edge (real browser, residential IP — passes Cloudflare, and you can solve a challenge by clicking it), extracts products via intercepted JSON APIs → JSON-LD → DOM heuristics, and writes CSVs in the exact import format. Upload them in `/admin` → *Import*. Build: `cd harvester && npm install && node build.js`, or the *Build harvester* GitHub Actions workflow (artifact). Details: [harvester/README.md](harvester/README.md).

## Weekly guarantee — no silent partial results

- Every adapter declares `minProducts`; if a run extracts fewer, **nothing is saved** and the run is marked failed (existing prices stay untouched).
- Kaufland additionally fails if >20% of county stores can't be read.
- The scrape CLI exits non-zero if **any** requested store failed → the GitHub Actions run turns red and GitHub emails you.
- Every run is logged in `scrape_runs` (visible in `/admin` → *Magazine*).
- The workflow runs **daily** at 04:30 UTC (Kaufland offers rotate Wednesdays, Lidl Mon/Thu — daily runs always catch the current week). Manual trigger: Actions → *Scrape prices*.

## Price freshness — no dead prices

- **Expired offers disappear**: search and basket comparison ignore any price whose `valid_to` has passed, and any price not refreshed in the last `PRICE_MAX_AGE_DAYS` days (default 14).
- **Delisted products are pruned**: after a successful scrape, prices that the run did *not* refresh are deleted for that supermarket (the scraper fetches the full published assortment, so anything missing is delisted or rotated out). CSV imports are *not* pruning — they may be partial top-ups.
- `price_history` keeps every price change for future charts/alerts.

## Honest basket comparison (unit prices + product linking)

- For each basket item, among equally-good textual matches the **cheapest per-unit** product wins (lei/kg / lei/l) — a small pack can no longer "beat" a big one just because its shelf price is lower.
- When the matched pack sizes differ across supermarkets (e.g. 1 l vs 500 ml), the item is flagged and the UI shows a **⚠ Gramaj diferit** warning with the unit price, so totals are never silently misleading.
- **Product linking** (`src/lib/linking.ts`, recomputed after every scrape, manual: `npm run db:link-products`): equivalent products across supermarkets are linked heuristically — same brand + same base quantity/unit + Jaccard ≥ 0.7 on the remaining name words, with fat/alcohol percentages required to match exactly (1,5% ≡ 1.5%, but 15% ≠ 32%). No EANs are published by the stores, so the matcher is deliberately conservative; only groups spanning ≥ 2 supermarkets are kept.
- The basket uses links to **fill coverage gaps**: when text search misses in a supermarket because the same product is named differently there ("Lapte Zuzu 1,5%" vs "Zuzu Lapte UHT 1.5% grăsime"), the exact linked product is used and marked **✓ același produs** in the UI. Generic queries keep their cheapest-per-market behavior.

## Quick start

```bash
npm install
npm run db:init      # schema (local SQLite: local.db)
npm run db:seed      # 10 supermarkets + demo products
npm run dev          # http://localhost:3000
```

Real prices immediately (no config, writes to local.db):

```bash
npm run scrape:lidl
npm run scrape:kaufland     # all 42 counties
npm run scrape:auchan       # full catalog, takes ~20-40 min
npm run scrape:penny
npm run scrape:carrefour    # grocery categories, ~10 min
npm run scrape:mega-image   # full catalog, ~3-5 min
```

## Configuration (`.env`, see `.env.example`)

| Variable | Purpose |
|---|---|
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | Turso in production; unset → local SQLite (`file:local.db`) |
| `ADMIN_PASSWORD` | Password for `/admin`. **Required in production** (and ≠ `admin`), otherwise the admin API answers 503. Constant-time compared, failed attempts rate-limited per IP |
| `AUTH_SECRET` | HMAC secret for signing the session cookie. **Required in production** (`openssl rand -hex 32`) |
| `PRICE_MAX_AGE_DAYS` | max age (days) for a price to still be shown (default 14) |
| `KAUFLAND_SCOPE` | empty = one store per county (all 42 counties); `all` = all ~204 stores |
| `KAUFLAND_CITIES` | comma-separated cities — overrides county selection |
| `LIDL_EXTRA_QUERIES` | extra keyword safety-net queries |
| `PROFI_CHROMIUM_PATH` | Chromium path for the Profi adapter |
| `CARREFOUR_CATEGORIES` | Carrefour category slugs to walk (default `bacanie-carrefour,cosmetice-si-ingrijire-personala`) |

### Turso + deployment

```bash
turso db create groceries
turso db show groceries --url        # → TURSO_DATABASE_URL
turso db tokens create groceries     # → TURSO_AUTH_TOKEN
npm run db:init && npm run db:seed
```

Deploy on Vercel with the same env vars; add both as **GitHub repo secrets** so the scheduled scraper writes to the same DB.

## How counties (județe) work

- `stores` carry `county`, derived automatically: explicit value → postal-code prefix (standard Poșta Română mapping, `src/lib/counties.ts`) → city fallback.
- Prices are keyed `(product_id, store_id)`; `store_id = 0` means **national price** (Lidl, Auchan online, Penny). County-specific prices (Kaufland) attach to that county's store.
- The UI has a „Județ” selector (persisted); search and basket comparison combine county prices + national prices.
- User flow for recurring shopping: search products (brand-level works — all words must match), add to basket, set quantities, „Unde e cel mai ieftin?” → top 3 supermarkets for *your county*, missing items marked per supermarket, similar alternatives suggested.

## The scraper

```bash
npm run scrape                       # all stores
npm run scrape -- --store lidl,kaufland,auchan,penny
npm run import:csv -- data/sample-import.csv
npm run db:recompute-categories      # re-map canonical categories after rule changes
```

### Adding a new supermarket

Implement `StoreAdapter` (`scraper/types.ts`): `slug`, `name`, `minProducts`, and one `scrape()` returning stores + products. Register it in `scraper/index.ts`. Normalization (diacritics, units → lei/kg-l-buc via `parseUnitSize`, category mapping) and persistence (upsert + price history) are shared — an adapter only extracts raw data.

### CSV import

Header: `supermarket,external_id,name,brand,category,unit_size,price,old_price,city,county,postal_code,store_external_id,image_url,url` (required: `supermarket,name,price`). With `city`/`county` the price is location-specific, otherwise national. Import via CLI or `/admin` → *Import*.

## The app

- **`/` Search** — exact/brand search („Fanta pere”, „apa bucovina”) and generic search („roșii”, „lapte”) with word-boundary matching and smart ranking (right category first, query word early in the name first, then price); category chips; județ selector; unit prices (lei/kg, lei/l) and price freshness.
- **`/cos` Basket** — quantities per item; ranks supermarkets by coverage then total; top 3 shown with per-item breakdown, missing items and alternatives.
- **`/admin`** — product CRUD, price updates, CSV import, supermarket management, scraper run history. Guarded by `ADMIN_PASSWORD`.
- **PWA** — installable, offline shell. **Auth** — minimal email-only endpoint as scaffolding (basket lives in localStorage for now).

### Data model (SQLite/Turso)

`supermarkets → stores (city, county) → prices` and `supermarkets → products`; `price_history` records every change (ready for charts/alerts). See `src/lib/schema.ts` (migrations included, `ensureSchema` is idempotent).

Search runs on a **FTS5 full-text index** (`products_fts`, kept in sync by triggers, rebuilt automatically when out of sync) — word-boundary matching without full-table scans, so it scales to full catalogs. If the SQLite build lacks FTS5, search transparently falls back to `instr()` matching.

### Tests & CI

```bash
npm test            # vitest: unit tests (normalization, categories, counties, sessions)
                    # + integration tests (scrape→save→search→compare on a temp SQLite db)
npm run typecheck   # tsc --noEmit
```

The **CI workflow** (`.github/workflows/ci.yml`) runs typecheck + tests + build on every push/PR.

## Roadmap hooks

Price-history charts, alerts, favorites, real login (magic link — the `uid` cookie is already HMAC-signed), GPS location (stores have lat/lng), cross-supermarket product linking (EAN/canonical products) for even tighter basket matching.
