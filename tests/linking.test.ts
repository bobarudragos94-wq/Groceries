import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ScrapeResult } from '../scraper/types';

/**
 * Legarea produselor echivalente între supermarketuri + folosirea legăturilor
 * la compararea coșului (pe o bază SQLite temporară).
 */

let db: typeof import('../src/lib/db')['db'];
let linking: typeof import('../src/lib/linking');
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
  const dir = mkdtempSync(join(tmpdir(), 'groceries-link-test-'));
  process.env.TURSO_DATABASE_URL = `file:${join(dir, 'test.db')}`;
  delete process.env.TURSO_AUTH_TOKEN;

  ({ db } = await import('../src/lib/db'));
  const { ensureSchema } = await import('../src/lib/schema');
  await ensureSchema(db());
  linking = await import('../src/lib/linking');
  queries = await import('../src/lib/queries');
  save = await import('../scraper/save');

  await save.saveScrapeResult(
    result('lidl', [
      // același produs, numit diferit la Carrefour (vezi mai jos)
      { externalId: 'l1', name: 'Lapte UHT 1,5% 1 l', brand: 'Zuzu', price: 6.0, unitSizeText: '1 l', rawCategory: 'Lactate' },
      // aceeași marcă + gramaj, dar ALT produs (iaurt, nu lapte) — nu se leagă
      { externalId: 'l2', name: 'Iaurt de băut 1 l', brand: 'Zuzu', price: 7.0, unitSizeText: '1 l', rawCategory: 'Lactate' },
      // fără marcă — nu se leagă niciodată
      { externalId: 'l3', name: 'Lapte de consum 1 l', price: 5.0, unitSizeText: '1 l', rawCategory: 'Lactate' }
    ])
  );
  await save.saveScrapeResult(
    result('carrefour', [
      // echivalentul produsului l1, cu nume mai lung și marca scrisă în nume
      { externalId: 'c1', name: 'Lapte UHT Zuzu 1.5% grasime 1L', brand: 'Zuzu', price: 6.5, unitSizeText: '1 l', rawCategory: 'Lactate' },
      // aceeași marcă, gramaj DIFERIT — nu se leagă de l1
      { externalId: 'c2', name: 'Lapte UHT Zuzu 1.5% grasime 500ml', brand: 'Zuzu', price: 4.0, unitSizeText: '500 ml', rawCategory: 'Lactate' }
    ])
  );

  await linking.linkProducts(db());
});

describe('linkProducts', () => {
  it('leagă același produs (marcă + gramaj + nume echivalent) între supermarketuri', async () => {
    const rs = await db().execute(
      `SELECT pl.group_id, p.external_id FROM product_links pl JOIN products p ON p.id = pl.product_id
       ORDER BY p.external_id`
    );
    const rows = rs.rows as unknown as Array<{ group_id: number; external_id: string }>;
    const ids = rows.map((r) => String(r.external_id));
    expect(ids).toContain('l1');
    expect(ids).toContain('c1');
    // l1 și c1 sunt în ACELAȘI grup
    const groupOf = new Map(rows.map((r) => [String(r.external_id), Number(r.group_id)]));
    expect(groupOf.get('l1')).toBe(groupOf.get('c1'));
  });

  it('nu leagă produse diferite ale aceleiași mărci, gramaje diferite sau fără marcă', async () => {
    const rs = await db().execute(
      `SELECT p.external_id FROM product_links pl JOIN products p ON p.id = pl.product_id`
    );
    const ids = (rs.rows as unknown as Array<{ external_id: string }>).map((r) => String(r.external_id));
    expect(ids).not.toContain('l2'); // iaurt ≠ lapte
    expect(ids).not.toContain('c2'); // 500 ml ≠ 1 l
    expect(ids).not.toContain('l3'); // fără marcă
  });

  it('e idempotent (recalcularea nu dublează legăturile)', async () => {
    const before = await db().execute(`SELECT count(*) AS c FROM product_links`);
    await linking.linkProducts(db());
    const after = await db().execute(`SELECT count(*) AS c FROM product_links`);
    expect(Number(after.rows[0].c)).toBe(Number(before.rows[0].c));
  });
});

describe('compareBasket cu legături', () => {
  it('folosește produsul legat unde căutarea textuală nu găsește nimic', async () => {
    // „lapte zuzu 1,5%” — la Carrefour numele conține „1.5%” (punct), deci
    // textual nu se potrivește; legătura îl găsește totuși exact
    const cmp = await queries.compareBasket([{ query: 'lapte zuzu 1,5%', qty: 1 }]);
    const lidl = cmp.find((c) => c.slug === 'lidl');
    const carrefour = cmp.find((c) => c.slug === 'carrefour');
    expect(lidl?.items[0].product?.name).toContain('Lapte UHT');
    expect(carrefour?.items[0].product?.name).toContain('Zuzu');
    expect(carrefour?.items[0].linked).toBe(true);
    expect(carrefour?.total).toBe(6.5);
  });

  it('preferă potrivirea textuală când există (interogări generice)', async () => {
    const cmp = await queries.compareBasket([{ query: 'lapte', qty: 1 }]);
    const lidl = cmp.find((c) => c.slug === 'lidl');
    // la Lidl cel mai bun „lapte” e cel fără marcă de 5 lei, nu produsul legat
    expect(lidl?.items[0].product?.price).toBe(5.0);
  });
});

describe('getLinkedHits', () => {
  it('întoarce cel mult un produs per supermarket, cu prețul aplicabil', async () => {
    const rs = await db().execute(`SELECT id FROM products WHERE external_id = 'l1'`);
    const id = Number(rs.rows[0].id);
    const hits = await queries.getLinkedHits(id);
    expect(hits.get('lidl')?.price).toBe(6.0);
    expect(hits.get('carrefour')?.price).toBe(6.5);
    expect(hits.size).toBe(2);
  });

  it('gol pentru produse nelegate', async () => {
    const rs = await db().execute(`SELECT id FROM products WHERE external_id = 'l3'`);
    const hits = await queries.getLinkedHits(Number(rs.rows[0].id));
    expect(hits.size).toBe(0);
  });
});
