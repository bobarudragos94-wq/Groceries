import { readFileSync } from 'node:fs';
import { db } from '../src/lib/db';
import { SCHEMA_STATEMENTS } from '../src/lib/schema';
import { parseCsv, rowsToScrapeResults } from './csv';
import { saveScrapeResult } from './save';

/**
 * Import de produse din CSV (aceeași conductă de salvare ca scraperele).
 *
 *   npm run import:csv -- produse.csv
 *
 * Coloane (antet obligatoriu):
 *   supermarket,external_id,name,price  — obligatorii
 *   brand,category,unit_size,old_price,image_url,url,city,store_external_id,store_name — opționale
 *
 * `city` + `store_external_id` leagă prețul de un magazin anume;
 * fără ele prețul este considerat național.
 */
async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) {
    console.error('Utilizare: npm run import:csv -- <fisier.csv>');
    process.exit(1);
  }

  for (const stmt of SCHEMA_STATEMENTS) await db().execute(stmt);

  const rows = parseCsv(readFileSync(file, 'utf-8'));
  const results = rowsToScrapeResults(rows);

  let total = 0;
  for (const result of results) {
    const { products } = await saveScrapeResult(result);
    console.log(`✔ ${result.supermarket.name}: ${products} produse importate`);
    total += products;
  }
  console.log(`Gata: ${total} produse din ${file}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
