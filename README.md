# 🛒 Coșul Ieftin — Romanian supermarket price comparison

Search day-to-day groceries across Romanian supermarkets, build a basket, and see **where that basket is cheapest**. Mobile-first PWA with a Romanian UI.

**The core of the project is the price scraper** — it pulls real prices from supermarket websites on a schedule and feeds the product database. The app (search, basket comparison, admin) sits on top of that data.

## What works today

| Supermarket | Source | Status |
|---|---|---|
| **Lidl** | Public search API (`lidl.ro/q/api/search`) — name, brand, price, packaging, category | ✅ verified live (~400+ products, national prices) |
| **Kaufland** | Store list JSON + weekly offers JSON embedded in `kaufland.ro` — prices **per store/city** with lei/kg | ✅ verified live (~350 products × 5 cities) |
| **Profi** | Headless Chromium (`playwright-core`) against `profi.ro` | ⚠️ profi.ro sits behind an aggressive Cloudflare challenge that hard-blocks datacenter IPs. The adapter works only from a residential IP (your laptop, a home server). Until then, use CSV import. |
| Carrefour, Mega Image, Auchan | seeded as demo supermarkets; add an adapter in `scraper/adapters/` or import CSV | 🔜 |

## Quick start

```bash
npm install
npm run db:init      # create schema (local SQLite: local.db)
npm run db:seed      # demo supermarkets + ~50 demo products
npm run dev          # http://localhost:3000
```

Get **real prices** immediately (no config needed, writes to local.db):

```bash
npm run scrape:lidl
npm run scrape:kaufland
```

## Configuration (`.env`, see `.env.example`)

| Variable | Purpose |
|---|---|
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | Turso in production. If unset, a local SQLite file (`file:local.db`) is used — ideal for development. |
| `ADMIN_PASSWORD` | Password for `/admin` (default `admin` — change it). |
| `KAUFLAND_CITIES` | Cities scraped for Kaufland store prices (default: București, Cluj-Napoca, Timișoara, Iași, Constanța). |
| `LIDL_EXTRA_QUERIES` | Extra search keywords for the Lidl adapter (comma-separated). |
| `PROFI_CHROMIUM_PATH` | Chromium path for the Profi adapter (otherwise Playwright's default). |

### Turso setup (production)

```bash
turso db create groceries
turso db show groceries --url        # → TURSO_DATABASE_URL
turso db tokens create groceries     # → TURSO_AUTH_TOKEN
npm run db:init && npm run db:seed   # with env vars set
```

Deploy the app on Vercel with the same env vars.

## The scraper

```bash
npm run scrape                       # all stores
npm run scrape -- --store lidl,kaufland
npm run import:csv -- data/sample-import.csv
```

- **Regular runs**: `.github/workflows/scrape.yml` runs Lidl + Kaufland daily at 04:30 UTC and writes to Turso. Add `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` as GitHub repo secrets and it just works (manual trigger available under Actions → *Scrape prices*).
- Each run upserts products, updates current prices, and appends to `price_history` whenever a price changed — the history table is ready for future charts/alerts.
- Runs are logged in `scrape_runs` and visible in `/admin` → *Magazine*.
- HTTP layer retries with exponential backoff (the Lidl API intermittently returns 500s — observed and handled).

### Adding a new supermarket scraper

Implement `StoreAdapter` (`scraper/types.ts`) — one `scrape()` returning stores + products — and register it in `scraper/index.ts`. Normalization (diacritics, units → lei/kg-l-buc, category mapping) and persistence are shared; an adapter only extracts raw data.

### CSV import

Header: `supermarket,external_id,name,brand,category,unit_size,price,old_price,city,store_external_id,image_url,url` (required: `supermarket,name,price`). With `city`+`store_external_id` the price is store-specific; without them it's national. Import via CLI or `/admin` → *Import*.

## The app

- **`/` Search** — exact product search („Fanta pere”) and generic/category search („roșii”, „lapte”); category chips; optional city filter; results show unit price (lei/kg, lei/l) and freshness.
- **`/cos` Basket** — quantities per item, then *„Unde e cel mai ieftin?”* ranks supermarkets (coverage first, then total), shows the **top 3**, lists missing items per supermarket, and suggests similar alternatives when a product is missing.
- **`/admin`** — add/edit/delete products, update prices, CSV import, manage supermarkets, see scraper run history. Guarded by `ADMIN_PASSWORD`.
- **PWA** — manifest + service worker; installable on the phone home screen.
- **Auth** — minimal email-only endpoint (`POST /api/auth`) as scaffolding; accounts aren't required for the MVP (basket lives in localStorage).

### Data model (SQLite/Turso)

`supermarkets → stores (city) → prices` and `supermarkets → products`. Prices are keyed `(product_id, store_id)` where `store_id = 0` means a national price — this is how city-specific prices coexist with chains that price nationally (Lidl). `price_history` records every change. See `src/lib/schema.ts`.

## Roadmap hooks (already structured for)

- More scrapers (Carrefour/Mega Image/Auchan adapters), price history charts (`price_history`), alerts, favorites, real login (swap `/api/auth`), GPS/manual location (stores already have lat/lng from Kaufland).
