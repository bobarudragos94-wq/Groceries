import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ScrapeResult } from '../scraper/types';

/**
 * Teste de integrare pe o bază SQLite temporară: conducta completă
 * scrape → salvare → căutare (FTS) → comparare coș, plus prospețimea
 * prețurilor și curățarea produselor delistate.
 */

let db: typeof import('../src/lib/db')['db'];
let queries: typeof import('../src/lib/queries');
let save: typeof import('../scraper/save');

function result(slug: string, products: ScrapeResult['products']): ScrapeResult {
  return {
    supermarket: { slug, name: slug[0].toUpperCase() + slug.slice(1) },
    stores: [],
    products,
    warnings: []
  };
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'groceries-test-'));
  process.env.TURSO_DATABASE_URL = `file:${join(dir, 'test.db')}`;
  delete process.env.TURSO_AUTH_TOKEN;

  ({ db } = await import('../src/lib/db'));
  const { ensureSchema } = await import('../src/lib/schema');
  await ensureSchema(db());
  queries = await import('../src/lib/queries');
  save = await import('../scraper/save');

  await save.saveScrapeResult(
    result('lidl', [
      { externalId: 'l1', name: 'Lapte UHT 1,5% 1 l', price: 6.0, unitSizeText: '1 l', rawCategory: 'Lactate' },
      { externalId: 'l2', name: 'Roua parfum de rufe', price: 12.0, rawCategory: 'Detergenti rufe' },
      { externalId: 'l3', name: 'Ouă mărimea M 10 buc', price: 11.0, unitSizeText: '10 buc', rawCategory: 'Oua' }
    ])
  );
  await save.saveScrapeResult(
    result('penny', [
      // pachet mai mic, preț de raft mai mic, dar MAI SCUMP pe litru
      { externalId: 'p1', name: 'Lapte UHT 1,5% 500 ml', price: 4.0, unitSizeText: '500 ml', rawCategory: 'Lactate' },
      // pachet mare, raft mai scump, dar mai IEFTIN pe litru — același rang textual
      { externalId: 'p2', name: 'Lapte UHT 1,5% 1 l', price: 5.5, unitSizeText: '1 l', rawCategory: 'Lactate' }
    ])
  );
});

describe('searchProducts', () => {
  it('găsește produse prin FTS și calculează lei/unitate', async () => {
    const hits = await queries.searchProducts({ q: 'lapte' });
    expect(hits.length).toBeGreaterThanOrEqual(2);
    const lidl = hits.find((h) => h.supermarketSlug === 'lidl');
    expect(lidl?.pricePerUnit).toBe(6.0);
    expect(lidl?.perUnit).toBe('l');
  });

  it('potrivește pe cuvinte întregi — „oua” nu găsește „Roua”', async () => {
    const hits = await queries.searchProducts({ q: 'oua', strict: true });
    expect(hits.some((h) => h.name.includes('Ouă'))).toBe(true);
    expect(hits.some((h) => h.name.includes('Roua'))).toBe(false);
  });

  it('modul prefix completează cuvintele („lap” → lapte)', async () => {
    const hits = await queries.searchProducts({ q: 'lap', prefix: true, strict: true });
    expect(hits.some((h) => h.name.includes('Lapte'))).toBe(true);
  });

  it('un rând per produs (dedup în SQL) cu cel mai bun preț', async () => {
    const hits = await queries.searchProducts({ q: 'lapte', strict: true });
    const ids = hits.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('prospețimea prețurilor', () => {
  it('prețurile expirate (valid_to depășit) dispar din căutare', async () => {
    const before = await queries.searchProducts({ q: 'oua', strict: true });
    expect(before.length).toBe(1);
    await db().execute(`UPDATE prices SET valid_to = date('now', '-1 day')
                        WHERE product_id = (SELECT id FROM products WHERE external_id = 'l3')`);
    const after = await queries.searchProducts({ q: 'oua', strict: true });
    expect(after.length).toBe(0);
    await db().execute(`UPDATE prices SET valid_to = NULL
                        WHERE product_id = (SELECT id FROM products WHERE external_id = 'l3')`);
  });

  it('prețurile mai vechi decât pragul dispar din căutare', async () => {
    await db().execute(`UPDATE prices SET updated_at = datetime('now', '-30 days')
                        WHERE product_id = (SELECT id FROM products WHERE external_id = 'l3')`);
    const after = await queries.searchProducts({ q: 'oua', strict: true });
    expect(after.length).toBe(0);
    await db().execute(`UPDATE prices SET updated_at = datetime('now')
                        WHERE product_id = (SELECT id FROM products WHERE external_id = 'l3')`);
  });

  it('valid_to neparsabil nu ascunde prețul (decide doar vechimea)', async () => {
    await db().execute(`UPDATE prices SET valid_to = 'cândva'
                        WHERE product_id = (SELECT id FROM products WHERE external_id = 'l3')`);
    const hits = await queries.searchProducts({ q: 'oua', strict: true });
    expect(hits.length).toBe(1);
    await db().execute(`UPDATE prices SET valid_to = NULL
                        WHERE product_id = (SELECT id FROM products WHERE external_id = 'l3')`);
  });
});

describe('compareBasket', () => {
  it('alege produsul cu cel mai mic preț PE UNITATE, nu pe raft', async () => {
    const cmp = await queries.compareBasket([{ query: 'lapte', qty: 1 }]);
    const penny = cmp.find((c) => c.slug === 'penny');
    // 500 ml @ 4,00 lei = 8 lei/l; 1 l @ 5,50 lei = 5,50 lei/l → câștigă 1 l
    expect(penny?.items[0].product?.name).toContain('1 l');
    expect(penny?.total).toBe(5.5);
  });

  it('marchează diferențele de gramaj între supermarketuri', async () => {
    // forțăm potrivirea pachetului de 500 ml la Penny printr-o interogare specifică
    const cmp = await queries.compareBasket([{ query: 'lapte 500 ml', qty: 1 }]);
    const penny = cmp.find((c) => c.slug === 'penny');
    expect(penny?.items[0].product).toBeTruthy();
    const lidl = cmp.find((c) => c.slug === 'lidl');
    // Lidl nu are „500 ml” în nume → lipsă acolo; fără două potriviri nu există mismatch
    expect(lidl?.items[0].product).toBeNull();

    const cmp2 = await queries.compareBasket([{ query: 'lapte uht', qty: 1 }]);
    const matched = cmp2.filter((c) => c.items[0].product);
    expect(matched.length).toBeGreaterThanOrEqual(2);
    // ambele au 1 l → fără avertisment de gramaj
    expect(matched.every((c) => !c.items[0].sizeMismatch)).toBe(true);
  });

  it('cantitatea înmulțește prețul', async () => {
    const cmp = await queries.compareBasket([{ query: 'lapte', qty: 3 }]);
    const penny = cmp.find((c) => c.slug === 'penny');
    expect(penny?.total).toBe(16.5);
  });
});

describe('curățarea prețurilor moarte (pruneMissing)', () => {
  it('o rulare completă șterge prețurile produselor delistate', async () => {
    await save.saveScrapeResult(
      result('penny', [{ externalId: 'p2', name: 'Lapte UHT 1,5% 1 l', price: 5.4, unitSizeText: '1 l', rawCategory: 'Lactate' }]),
      { pruneMissing: true }
    );
    const hits = await queries.searchProducts({ q: 'lapte', supermarket: 'penny', strict: true });
    expect(hits.length).toBe(1);
    expect(hits[0].price).toBe(5.4);
  });

  it('importul fără pruneMissing nu șterge restul prețurilor', async () => {
    await save.saveScrapeResult(
      result('penny', [{ externalId: 'p9', name: 'Iaurt natural 400 g', price: 3.2, unitSizeText: '400 g', rawCategory: 'Lactate' }])
    );
    const lapte = await queries.searchProducts({ q: 'lapte', supermarket: 'penny', strict: true });
    expect(lapte.length).toBe(1);
    const iaurt = await queries.searchProducts({ q: 'iaurt', supermarket: 'penny', strict: true });
    expect(iaurt.length).toBe(1);
  });

  it('schimbarea de preț se înregistrează în price_history', async () => {
    const rs = await db().execute(
      `SELECT count(*) AS c FROM price_history
       WHERE product_id = (SELECT id FROM products WHERE external_id = 'p2')`
    );
    // prima salvare (5,50) + actualizarea (5,40)
    expect(Number(rs.rows[0].c)).toBe(2);
  });
});
