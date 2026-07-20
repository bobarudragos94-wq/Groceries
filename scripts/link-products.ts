import { db } from '../src/lib/db';
import { ensureSchema } from '../src/lib/schema';
import { linkProducts } from '../src/lib/linking';

/**
 * Recalculează manual legăturile între produse echivalente
 * (rulează automat și la finalul fiecărui `npm run scrape`).
 *
 *   npm run db:link-products
 */
async function main(): Promise<void> {
  await ensureSchema(db());
  const { groups, linked } = await linkProducts(db());
  console.log(`✔ ${linked} produse legate în ${groups} grupuri inter-supermarket.`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
