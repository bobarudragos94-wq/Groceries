import { db } from '../src/lib/db';
import { SCHEMA_STATEMENTS } from '../src/lib/schema';
import { lidlAdapter } from './adapters/lidl';
import { kauflandAdapter } from './adapters/kaufland';
import { profiAdapter } from './adapters/profi';
import { recordRun, saveScrapeResult } from './save';
import type { StoreAdapter } from './types';

/**
 * CLI-ul scraperului de prețuri.
 *
 *   npm run scrape                      # toate magazinele
 *   npm run scrape -- --store lidl      # un singur magazin
 *   npm run scrape -- --store lidl,kaufland
 *
 * Rulare regulată: .github/workflows/scrape.yml (cron zilnic).
 * Iese cu cod 0 dacă cel puțin un magazin a reușit, altfel 1.
 */

const ADAPTERS: Record<string, StoreAdapter> = {
  lidl: lidlAdapter,
  kaufland: kauflandAdapter,
  profi: profiAdapter
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const storeArg = args.includes('--store') ? args[args.indexOf('--store') + 1] : null;
  const slugs = storeArg ? storeArg.split(',').map((s) => s.trim().toLowerCase()) : Object.keys(ADAPTERS);

  for (const slug of slugs) {
    if (!ADAPTERS[slug]) {
      console.error(`Magazin necunoscut: „${slug}”. Disponibile: ${Object.keys(ADAPTERS).join(', ')}`);
      process.exit(1);
    }
  }

  // ne asigurăm că schema există (idempotent)
  for (const stmt of SCHEMA_STATEMENTS) await db().execute(stmt);

  let succeeded = 0;
  for (const slug of slugs) {
    const adapter = ADAPTERS[slug];
    const startedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
    console.log(`\n=== ${adapter.name} — pornit ===`);
    try {
      const result = await adapter.scrape();
      const { products, prices } = await saveScrapeResult(result);
      for (const w of result.warnings) console.warn(`  ⚠ ${w}`);
      console.log(`  ✔ ${products} produse, ${prices} prețuri actualizate`);
      await recordRun(slug, startedAt, 'ok', products, result.warnings.slice(0, 5).join(' | ') || undefined);
      succeeded++;
    } catch (err) {
      const msg = (err as Error).message;
      console.error(`  ✘ eșuat: ${msg}`);
      await recordRun(slug, startedAt, 'error', 0, msg).catch(() => undefined);
    }
  }

  console.log(`\nGata: ${succeeded}/${slugs.length} magazine actualizate.`);
  process.exit(succeeded > 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
