import type { Client, InStatement } from '@libsql/client';
import { db } from '../src/lib/db';
import { mapCategory } from '../src/lib/categories';
import { normalizeText, parseUnitSize, pricePerUnit } from '../src/lib/normalize';
import type { ScrapeResult } from './types';

/**
 * Persistă rezultatul unui scrape:
 *  - upsert supermarket + magazine + produse
 *  - actualizează prețul curent (per magazin sau național, store_id=0)
 *  - la schimbare de preț, adaugă o intrare în price_history
 */
export async function saveScrapeResult(result: ScrapeResult): Promise<{ products: number; prices: number }> {
  const client = db();

  const supermarketId = await upsertSupermarket(client, result.supermarket.slug, result.supermarket.name);

  const storeIdByExternal = new Map<string, number>();
  for (const s of result.stores) {
    const rs = await client.execute({
      sql: `INSERT INTO stores (supermarket_id, external_id, name, city, address, lat, lng)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(supermarket_id, external_id) DO UPDATE SET
              name = excluded.name, city = excluded.city, address = excluded.address,
              lat = excluded.lat, lng = excluded.lng
            RETURNING id`,
      args: [supermarketId, s.externalId, s.name, s.city, s.address ?? null, s.lat ?? null, s.lng ?? null]
    });
    storeIdByExternal.set(s.externalId, Number(rs.rows[0].id));
  }

  let productCount = 0;
  let priceCount = 0;

  for (const p of result.products) {
    if (!p.externalId || !p.name || !(p.price > 0)) continue;

    const parsed = parseUnitSize(p.unitSizeText);
    const ppu = p.pricePerUnit ?? pricePerUnit(p.price, parsed);
    const category = mapCategory(p.rawCategory, p.name);

    const rs = await client.execute({
      sql: `INSERT INTO products (supermarket_id, external_id, name, normalized_name, brand, category,
              raw_category, unit_size, quantity, unit, image_url, url)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(supermarket_id, external_id) DO UPDATE SET
              name = excluded.name, normalized_name = excluded.normalized_name,
              brand = COALESCE(excluded.brand, products.brand),
              category = excluded.category, raw_category = excluded.raw_category,
              unit_size = COALESCE(excluded.unit_size, products.unit_size),
              quantity = COALESCE(excluded.quantity, products.quantity),
              unit = COALESCE(excluded.unit, products.unit),
              image_url = COALESCE(excluded.image_url, products.image_url),
              url = COALESCE(excluded.url, products.url)
            RETURNING id`,
      args: [
        supermarketId,
        p.externalId,
        p.name,
        buildNormalizedName(p.name, p.brand),
        p.brand ?? null,
        category,
        p.rawCategory ?? null,
        p.unitSizeText ?? null,
        parsed?.quantity ?? null,
        parsed?.unit ?? null,
        p.imageUrl ?? null,
        p.url ?? null
      ]
    });
    const productId = Number(rs.rows[0].id);
    productCount++;

    const storeIds =
      p.storeExternalIds == null
        ? [0]
        : p.storeExternalIds.map((e) => storeIdByExternal.get(e)).filter((x): x is number => x != null);

    for (const storeId of storeIds) {
      priceCount += await upsertPrice(client, productId, storeId, p, ppu);
    }
  }

  return { products: productCount, prices: priceCount };
}

/** Numele normalizat pentru căutare; nu dublăm marca dacă e deja în nume. */
function buildNormalizedName(name: string, brand?: string): string {
  const n = normalizeText(name);
  if (!brand) return n;
  const b = normalizeText(brand);
  return b && !n.includes(b) ? `${b} ${n}` : n;
}

async function upsertSupermarket(client: Client, slug: string, name: string): Promise<number> {
  const rs = await client.execute({
    sql: `INSERT INTO supermarkets (slug, name) VALUES (?, ?)
          ON CONFLICT(slug) DO UPDATE SET name = excluded.name
          RETURNING id`,
    args: [slug, name]
  });
  return Number(rs.rows[0].id);
}

async function upsertPrice(
  client: Client,
  productId: number,
  storeId: number,
  p: { price: number; oldPrice?: number; currency?: string; validFrom?: string; validTo?: string },
  ppu: { value: number; unit: string } | null
): Promise<number> {
  const existing = await client.execute({
    sql: `SELECT price FROM prices WHERE product_id = ? AND store_id = ?`,
    args: [productId, storeId]
  });
  const oldValue = existing.rows.length ? Number(existing.rows[0].price) : null;

  const statements: InStatement[] = [
    {
      sql: `INSERT INTO prices (product_id, store_id, price, old_price, price_per_unit, per_unit,
              currency, valid_from, valid_to, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(product_id, store_id) DO UPDATE SET
              price = excluded.price, old_price = excluded.old_price,
              price_per_unit = excluded.price_per_unit, per_unit = excluded.per_unit,
              currency = excluded.currency, valid_from = excluded.valid_from,
              valid_to = excluded.valid_to, updated_at = excluded.updated_at`,
      args: [
        productId,
        storeId,
        p.price,
        p.oldPrice ?? null,
        ppu?.value ?? null,
        ppu?.unit ?? null,
        p.currency ?? 'RON',
        p.validFrom ?? null,
        p.validTo ?? null
      ]
    }
  ];
  if (oldValue === null || Math.abs(oldValue - p.price) > 0.001) {
    statements.push({
      sql: `INSERT INTO price_history (product_id, store_id, price) VALUES (?, ?, ?)`,
      args: [productId, storeId, p.price]
    });
  }
  await client.batch(statements, 'write');
  return 1;
}

export async function recordRun(
  supermarket: string,
  startedAt: string,
  status: 'ok' | 'error',
  productsFound: number,
  message?: string
): Promise<void> {
  await db().execute({
    sql: `INSERT INTO scrape_runs (supermarket, status, products_found, message, started_at, finished_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    args: [supermarket, status, productsFound, message ?? null, startedAt]
  });
}
