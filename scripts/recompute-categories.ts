import { db } from '../src/lib/db';
import { mapCategory } from '../src/lib/categories';

/**
 * Recalculează categoria canonică pentru toate produsele existente —
 * util după modificarea regulilor din src/lib/categories.ts, fără re-scrape.
 */
async function main(): Promise<void> {
  const client = db();
  const rs = await client.execute(`SELECT id, name, raw_category, category FROM products`);
  let changed = 0;

  for (const row of rs.rows as unknown as Array<{ id: number; name: string; raw_category: string | null; category: string | null }>) {
    const next = mapCategory(row.raw_category, row.name);
    if (next !== row.category) {
      await client.execute({ sql: `UPDATE products SET category = ? WHERE id = ?`, args: [next, row.id] });
      changed++;
    }
  }
  console.log(`✔ Categorii recalculate: ${changed} produse actualizate din ${rs.rows.length}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
