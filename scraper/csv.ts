import type { ScrapeResult, ScrapedProduct, ScrapedStore } from './types';

/** Parser CSV minimal cu suport pentru ghilimele ("a,b", "" escapat). */
export function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);

  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    header.forEach((h, i) => (obj[h] = (r[i] ?? '').trim()));
    return obj;
  });
}

/** Grupează rândurile CSV pe supermarket și le transformă în ScrapeResult-uri. */
export function rowsToScrapeResults(rows: Array<Record<string, string>>): ScrapeResult[] {
  const bySupermarket = new Map<string, Array<Record<string, string>>>();
  for (const r of rows) {
    const slug = (r.supermarket || '').toLowerCase();
    if (!slug || !r.name || !r.price) continue;
    if (!bySupermarket.has(slug)) bySupermarket.set(slug, []);
    bySupermarket.get(slug)!.push(r);
  }

  const results: ScrapeResult[] = [];
  for (const [slug, group] of bySupermarket) {
    const stores = new Map<string, ScrapedStore>();
    const products: ScrapedProduct[] = [];

    for (const r of group) {
      const storeId = r.store_external_id || (r.city ? `csv-${r.city.toLowerCase()}` : '');
      if (storeId && r.city) {
        stores.set(storeId, {
          externalId: storeId,
          name: r.store_name || `${capitalize(slug)} ${r.city}`,
          city: r.city
        });
      }
      const price = parseFloat(r.price.replace(',', '.'));
      if (!(price > 0)) continue;
      products.push({
        externalId: r.external_id || r.name.toLowerCase().replace(/\s+/g, '-').slice(0, 80),
        name: r.name,
        brand: r.brand || undefined,
        rawCategory: r.category || undefined,
        unitSizeText: r.unit_size || undefined,
        price,
        oldPrice: r.old_price ? parseFloat(r.old_price.replace(',', '.')) : undefined,
        imageUrl: r.image_url || undefined,
        url: r.url || undefined,
        storeExternalIds: storeId ? [storeId] : null
      });
    }

    results.push({
      supermarket: { slug, name: capitalize(slug) },
      stores: [...stores.values()],
      products,
      warnings: []
    });
  }
  return results;
}

function capitalize(s: string): string {
  return s
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
