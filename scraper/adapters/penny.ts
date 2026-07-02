import { fetchJson, sleep } from '../http';
import type { BaseUnit } from '../../src/lib/normalize';
import type { ScrapeResult, ScrapedProduct, StoreAdapter } from '../types';

/**
 * Penny România — API-ul public al site-ului (REWE):
 *   GET /api/product-discovery/products?page=N   (paginat, ~20/pagină)
 *
 * Returnează sortimentul publicat online (~300 produse, ofertele săptămânii +
 * produsele marcate), cu preț în bani (899 = 8,99 lei), preț/unitate
 * standardizată, gramaj și valabilitate. Prețurile sunt naționale.
 */

const API = 'https://www.penny.ro/api/product-discovery/products';
const PAUSE_MS = 600;

interface PennyPrice {
  baseUnitShort?: string;
  regular?: { value?: number; perStandardizedQuantity?: number };
  validityStart?: string;
  validityEnd?: string;
}

interface PennyProduct {
  sku?: string;
  productId?: string;
  name?: string;
  slug?: string;
  category?: string;
  brandMarketing?: string;
  images?: string[];
  price?: PennyPrice;
  weight?: number;
  weightArticle?: boolean;
  volumeLabelShort?: string;
  amount?: string;
  packageLabelKey?: string;
  published?: boolean;
}

interface PennyResponse {
  total?: number;
  count?: number;
  offset?: number;
  results?: PennyProduct[];
}

const BASE_UNITS: Record<string, BaseUnit> = { kg: 'kg', l: 'l', buc: 'buc', lt: 'l' };

export const pennyAdapter: StoreAdapter = {
  slug: 'penny',
  name: 'Penny',
  minProducts: 150,

  async scrape(): Promise<ScrapeResult> {
    const warnings: string[] = [];
    const byId = new Map<string, ScrapedProduct>();

    let page = 0;
    let total = Infinity;
    let fetched = 0;

    while (fetched < total && page < 100) {
      const data = await fetchJson<PennyResponse>(`${API}?page=${page}`, { retries: 4, backoffMs: 2500 });
      if (typeof data.total !== 'number' || !Array.isArray(data.results)) {
        throw new Error(`Penny: răspuns neașteptat la pagina ${page}`);
      }
      total = data.total;
      fetched += data.results.length;
      if (data.results.length === 0) break;

      for (const p of data.results) {
        const sp = parseProduct(p);
        if (sp && !byId.has(sp.externalId)) byId.set(sp.externalId, sp);
      }
      page++;
      await sleep(PAUSE_MS);
    }

    if (byId.size === 0) {
      throw new Error('Penny: nu s-a extras niciun produs (structura API s-a schimbat?)');
    }

    return {
      supermarket: { slug: this.slug, name: this.name },
      stores: [],
      products: [...byId.values()],
      warnings
    };
  }
};

function parseProduct(p: PennyProduct): ScrapedProduct | null {
  const priceBani = p.price?.regular?.value;
  const externalId = p.sku || p.productId;
  if (!externalId || !p.name || !priceBani || priceBani <= 0 || p.published === false) return null;

  // gramaj: articole cântărite au weight + volumeLabelShort ("1 kg"),
  // restul au amount + packageLabelKey ("6 buc")
  const unitSizeText = p.weightArticle
    ? `${p.weight ?? 1} ${p.volumeLabelShort ?? 'kg'}`
    : [p.amount, p.packageLabelKey].filter(Boolean).join(' ') || undefined;

  const perStd = p.price?.regular?.perStandardizedQuantity;
  const baseUnit = BASE_UNITS[(p.price?.baseUnitShort || '').toLowerCase()];

  return {
    externalId,
    name: titleCase(p.name),
    brand: p.brandMarketing || undefined,
    rawCategory: p.category,
    unitSizeText,
    price: priceBani / 100,
    pricePerUnit: perStd && baseUnit ? { value: perStd / 100, unit: baseUnit } : undefined,
    currency: 'RON',
    imageUrl: p.images?.[0],
    url: p.slug ? `https://www.penny.ro/products/${p.slug}` : undefined,
    validFrom: p.price?.validityStart,
    validTo: p.price?.validityEnd,
    storeExternalIds: null
  };
}

/** numele vin ÎN MAJUSCULE ("ROSII") — le facem lizibile */
function titleCase(s: string): string {
  if (s !== s.toUpperCase()) return s;
  return s
    .toLowerCase()
    .replace(/(^|[\s-])(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase());
}
