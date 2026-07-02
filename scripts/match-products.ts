import { db } from '../src/lib/db';
import { ensureSchema } from '../src/lib/schema';
import { rematchAllProducts } from '../src/lib/match-products';

/**
 * Recalculează potrivirea produselor între supermarketuri:
 *
 *   npm run db:match
 *
 * Scrie products.match_tokens (căutare cu sinonime) și
 * products.match_group_id (grupuri de produse identice între lanțuri),
 * apoi afișează câteva grupuri ca verificare vizuală.
 */
async function main(): Promise<void> {
  const client = db();
  await ensureSchema(client);

  const stats = await rematchAllProducts();
  console.log(
    `Produse: ${stats.products} · grupate între lanțuri: ${stats.grouped} ` +
      `în ${stats.groups} grupuri · rânduri actualizate: ${stats.updated}`
  );

  const sample = await client.execute(
    `SELECT p.match_group_id, s.name AS supermarket, p.name, p.unit_size
     FROM products p JOIN supermarkets s ON s.id = p.supermarket_id
     WHERE p.match_group_id IN (
       SELECT match_group_id FROM products
       WHERE match_group_id IS NOT NULL
       GROUP BY match_group_id ORDER BY COUNT(*) DESC, match_group_id LIMIT 8
     )
     ORDER BY p.match_group_id, s.name`
  );
  let lastGroup: number | null = null;
  for (const r of sample.rows as unknown as Array<{ match_group_id: number; supermarket: string; name: string; unit_size: string | null }>) {
    if (Number(r.match_group_id) !== lastGroup) {
      lastGroup = Number(r.match_group_id);
      console.log(`\nGrup #${lastGroup}:`);
    }
    console.log(`  [${r.supermarket}] ${r.name}${r.unit_size ? ` (${r.unit_size})` : ''}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
