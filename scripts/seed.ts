import { db } from '../src/lib/db';
import { SCHEMA_STATEMENTS } from '../src/lib/schema';
import { rowsToScrapeResults } from '../scraper/csv';
import { saveScrapeResult } from '../scraper/save';

/**
 * Populează baza cu date demo ca aplicația să poată fi testată imediat,
 * înainte de prima rulare a scraperelor. Idempotent (upsert).
 */

const SUPERMARKETS: Array<[string, string]> = [
  ['lidl', 'Lidl'],
  ['kaufland', 'Kaufland'],
  ['profi', 'Profi'],
  ['carrefour', 'Carrefour'],
  ['mega-image', 'Mega Image'],
  ['auchan', 'Auchan']
];

// supermarket, external_id, name, brand, category, unit_size, price, city
type Row = [string, string, string, string, string, string, number, string?];

const DEMO: Row[] = [
  // lapte
  ['lidl', 'demo-lapte-1', 'Lapte UHT 3,5%', 'Pilos', 'lactate', '1 l', 5.49],
  ['kaufland', 'demo-lapte-1', 'Lapte UHT 3,5%', 'K-Classic', 'lactate', '1 l', 5.79, 'București'],
  ['profi', 'demo-lapte-1', 'Lapte UHT 3,5%', 'Zuzu', 'lactate', '1 l', 6.19],
  ['carrefour', 'demo-lapte-1', 'Lapte UHT 3,5%', 'Carrefour', 'lactate', '1 l', 5.99, 'București'],
  ['mega-image', 'demo-lapte-1', 'Lapte UHT 3,5%', 'Zuzu', 'lactate', '1 l', 6.49, 'București'],
  ['auchan', 'demo-lapte-1', 'Lapte UHT 3,5%', 'Auchan', 'lactate', '1 l', 5.69, 'București'],
  // pâine
  ['lidl', 'demo-paine-1', 'Pâine albă feliată', '', 'panificatie', '500 g', 3.29],
  ['kaufland', 'demo-paine-1', 'Pâine albă feliată', 'K-Classic', 'panificatie', '500 g', 2.99, 'București'],
  ['profi', 'demo-paine-1', 'Pâine albă feliată', '', 'panificatie', '500 g', 3.49],
  ['carrefour', 'demo-paine-1', 'Pâine albă feliată', 'Carrefour', 'panificatie', '500 g', 3.19, 'București'],
  ['auchan', 'demo-paine-1', 'Pâine albă feliată', 'Auchan', 'panificatie', '500 g', 3.09, 'București'],
  // ouă
  ['lidl', 'demo-oua-1', 'Ouă mărimea M', '', 'lactate oua', '10 buc', 12.49],
  ['kaufland', 'demo-oua-1', 'Ouă mărimea M', '', 'lactate oua', '10 buc', 11.99, 'București'],
  ['profi', 'demo-oua-1', 'Ouă mărimea M', '', 'lactate oua', '10 buc', 12.99],
  ['mega-image', 'demo-oua-1', 'Ouă mărimea M', '', 'lactate oua', '10 buc', 13.49, 'București'],
  // roșii
  ['lidl', 'demo-rosii-1', 'Roșii cherry', '', 'legume', '500 g', 7.99],
  ['kaufland', 'demo-rosii-1', 'Roșii românești', '', 'legume', '1 kg', 8.99, 'București'],
  ['profi', 'demo-rosii-1', 'Roșii', '', 'legume', '1 kg', 9.49],
  ['carrefour', 'demo-rosii-1', 'Roșii românești', '', 'legume', '1 kg', 8.49, 'București'],
  ['auchan', 'demo-rosii-1', 'Roșii', '', 'legume', '1 kg', 7.89, 'București'],
  // ulei
  ['lidl', 'demo-ulei-1', 'Ulei de floarea-soarelui', 'Vita D’or', 'alimente de baza', '1 l', 8.79],
  ['kaufland', 'demo-ulei-1', 'Ulei de floarea-soarelui', 'K-Classic', 'alimente de baza', '1 l', 8.99, 'București'],
  ['profi', 'demo-ulei-1', 'Ulei de floarea-soarelui', 'Unisol', 'alimente de baza', '1 l', 9.29],
  ['mega-image', 'demo-ulei-1', 'Ulei de floarea-soarelui', 'Bunica', 'alimente de baza', '1 l', 10.49, 'București'],
  // piept de pui
  ['lidl', 'demo-pui-1', 'Piept de pui dezosat', '', 'carne', '1 kg', 25.99],
  ['kaufland', 'demo-pui-1', 'Piept de pui dezosat', '', 'carne', '1 kg', 24.49, 'București'],
  ['profi', 'demo-pui-1', 'Piept de pui dezosat', '', 'carne', '1 kg', 26.99],
  ['carrefour', 'demo-pui-1', 'Piept de pui dezosat', '', 'carne', '1 kg', 25.49, 'București'],
  // Fanta pere (căutare exactă)
  ['lidl', 'demo-fanta-pere', 'Fanta Pere', 'Fanta', 'bauturi', '1,5 l', 6.99],
  ['kaufland', 'demo-fanta-pere', 'Fanta Pere', 'Fanta', 'bauturi', '1,5 l', 6.49, 'București'],
  ['profi', 'demo-fanta-pere', 'Fanta Pere', 'Fanta', 'bauturi', '1,5 l', 7.29],
  ['mega-image', 'demo-fanta-pere', 'Fanta Pere', 'Fanta', 'bauturi', '1,5 l', 7.49, 'București'],
  // cereale Lion
  ['lidl', 'demo-lion-1', 'Cereale Lion ciocolată și caramel', 'Nestlé', 'cereale mic dejun', '425 g', 17.99],
  ['kaufland', 'demo-lion-1', 'Cereale Lion ciocolată și caramel', 'Nestlé', 'cereale mic dejun', '425 g', 16.49, 'București'],
  ['carrefour', 'demo-lion-1', 'Cereale Lion ciocolată și caramel', 'Nestlé', 'cereale mic dejun', '425 g', 18.29, 'București'],
  // apă
  ['lidl', 'demo-apa-1', 'Apă minerală naturală carbogazoasă', 'Saguaro', 'bauturi', '2 l', 1.99],
  ['kaufland', 'demo-apa-1', 'Apă minerală naturală carbogazoasă', 'K-Classic', 'bauturi', '2 l', 2.19, 'București'],
  ['profi', 'demo-apa-1', 'Apă minerală naturală carbogazoasă', '', 'bauturi', '2 l', 2.49],
  ['auchan', 'demo-apa-1', 'Apă minerală naturală carbogazoasă', 'Auchan', 'bauturi', '2 l', 2.09, 'București'],
  // cafea
  ['lidl', 'demo-cafea-1', 'Cafea boabe', 'Bellarom', 'cafea', '1 kg', 54.99],
  ['kaufland', 'demo-cafea-1', 'Cafea boabe', 'K-Classic', 'cafea', '1 kg', 52.99, 'București'],
  ['carrefour', 'demo-cafea-1', 'Cafea boabe', 'Carrefour Selection', 'cafea', '1 kg', 57.99, 'București'],
  // detergent
  ['lidl', 'demo-detergent-1', 'Detergent lichid rufe', 'Formil', 'menaj detergent', '3 l', 34.99],
  ['kaufland', 'demo-detergent-1', 'Detergent lichid rufe', 'K-Classic', 'menaj detergent', '3 l', 36.49, 'București'],
  ['profi', 'demo-detergent-1', 'Detergent lichid rufe', 'Ariel', 'menaj detergent', '2,2 l', 49.99],
  // banane
  ['lidl', 'demo-banane-1', 'Banane', '', 'fructe', '1 kg', 6.49],
  ['kaufland', 'demo-banane-1', 'Banane', '', 'fructe', '1 kg', 6.29, 'București'],
  ['profi', 'demo-banane-1', 'Banane', '', 'fructe', '1 kg', 6.99],
  ['mega-image', 'demo-banane-1', 'Banane', '', 'fructe', '1 kg', 7.29, 'București'],
  ['auchan', 'demo-banane-1', 'Banane', '', 'fructe', '1 kg', 6.19, 'București']
];

async function main(): Promise<void> {
  const client = db();
  for (const stmt of SCHEMA_STATEMENTS) await client.execute(stmt);

  for (const [slug, name] of SUPERMARKETS) {
    await client.execute({
      sql: `INSERT INTO supermarkets (slug, name) VALUES (?, ?)
            ON CONFLICT(slug) DO UPDATE SET name = excluded.name`,
      args: [slug, name]
    });
  }

  const rows = DEMO.map(([supermarket, external_id, name, brand, category, unit_size, price, city]) => ({
    supermarket,
    external_id,
    name,
    brand,
    category,
    unit_size,
    price: String(price),
    city: city ?? '',
    store_external_id: city ? `demo-${city.toLowerCase()}` : '',
    store_name: '',
    old_price: '',
    image_url: '',
    url: ''
  }));

  let total = 0;
  for (const result of rowsToScrapeResults(rows)) {
    const { products } = await saveScrapeResult(result);
    total += products;
  }
  console.log(`✔ Seed complet: ${SUPERMARKETS.length} supermarketuri, ${total} produse demo.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
