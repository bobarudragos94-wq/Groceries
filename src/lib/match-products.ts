/**
 * Recalculează potrivirea produselor pe toată baza:
 *  - products.match_tokens  = cuvintele canonice (index de căutare cu sinonime)
 *  - products.match_group_id = grupul de produse identice între supermarketuri
 *
 * Rulează după fiecare scrape/import (și manual: `npm run db:match`).
 */
import type { InStatement } from '@libsql/client';
import { db } from './db';
import { buildMatchTokens, extractSignature, groupProducts, type GroupInput } from './matching';

export interface MatchStats {
  /** produse analizate */
  products: number;
  /** produse legate într-un grup cross-supermarket */
  grouped: number;
  /** numărul de grupuri */
  groups: number;
  /** rânduri actualizate în DB */
  updated: number;
}

interface ProductRow {
  id: number;
  supermarket_id: number;
  name: string;
  brand: string | null;
  category: string | null;
  quantity: number | null;
  unit: string | null;
  match_tokens: string | null;
  match_group_id: number | null;
}

export async function rematchAllProducts(): Promise<MatchStats> {
  const client = db();
  const rs = await client.execute(
    `SELECT id, supermarket_id, name, brand, category, quantity, unit, match_tokens, match_group_id
     FROM products`
  );
  const rows = rs.rows as unknown as ProductRow[];

  const items: GroupInput[] = [];
  const statements: InStatement[] = [];

  for (const r of rows) {
    const sig = extractSignature({
      name: String(r.name),
      brand: r.brand,
      category: r.category,
      quantity: r.quantity != null ? Number(r.quantity) : null,
      unit: r.unit
    });
    const tokens = buildMatchTokens(sig);
    if (tokens !== (r.match_tokens ?? '')) {
      statements.push({ sql: `UPDATE products SET match_tokens = ? WHERE id = ?`, args: [tokens, Number(r.id)] });
    }
    items.push({ id: Number(r.id), supermarketId: Number(r.supermarket_id), sig });
  }

  const groupOf = groupProducts(items);
  for (const r of rows) {
    const id = Number(r.id);
    const next = groupOf.get(id) ?? null;
    const current = r.match_group_id != null ? Number(r.match_group_id) : null;
    if (next !== current) {
      statements.push({ sql: `UPDATE products SET match_group_id = ? WHERE id = ?`, args: [next, id] });
    }
  }

  for (let i = 0; i < statements.length; i += 100) {
    await client.batch(statements.slice(i, i + 100), 'write');
  }

  const groups = new Set(groupOf.values());
  return { products: rows.length, grouped: groupOf.size, groups: groups.size, updated: statements.length };
}
