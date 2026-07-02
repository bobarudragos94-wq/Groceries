import { fetchJson, sleep } from '../http';
import { GROCERY_QUERIES } from '../keywords';
import type { ScrapeResult, ScrapedProduct, StoreAdapter } from '../types';

/**
 * Lidl România — API-ul public de căutare al site-ului:
 *   GET https://www.lidl.ro/q/api/search?q=...&fetchsize=...&locale=ro_RO&assortment=RO&version=2.1.0
 *
 * API-ul nu oferă listarea completă a catalogului, așa că interogăm o listă
 * de cuvinte-cheie uzuale și deduplicăm după itemId. Prețurile Lidl sunt
 * naționale (aceleași în toate magazinele), deci se salvează cu store_id=0.
 *
 * Observat în practică: API-ul răspunde intermitent 500/406 — fetchJson
 * reîncearcă automat cu backoff.
 */

const API = 'https://www.lidl.ro/q/api/search';
const FETCH_SIZE = 100;
const PAUSE_BETWEEN_QUERIES_MS = 1200;

interface LidlItem {
  code?: string;
  gridbox?: {
    data?: {
      itemId?: number;
      erpNumber?: string;
      fullTitle?: string;
      brand?: { name?: string };
      canonicalUrl?: string;
      image?: string;
      keyfacts?: { wonCategoryPrimary?: string };
      price?: {
        price?: number;
        oldPrice?: number;
        packaging?: { text?: string };
        currencyCode?: string;
      };
      stockAvailability?: { badgeInfoV2?: Array<{ validFrom?: number; validUntil?: number }> };
    };
  };
}

interface LidlResponse {
  numFound?: number;
  items?: LidlItem[];
}

export const lidlAdapter: StoreAdapter = {
  slug: 'lidl',
  name: 'Lidl',

  async scrape(): Promise<ScrapeResult> {
    const warnings: string[] = [];
    const extra = (process.env.LIDL_EXTRA_QUERIES || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const queries = [...GROCERY_QUERIES, ...extra];

    const byId = new Map<string, ScrapedProduct>();

    for (const q of queries) {
      try {
        const url = `${API}?q=${encodeURIComponent(q)}&fetchsize=${FETCH_SIZE}&locale=ro_RO&assortment=RO&version=2.1.0`;
        const data = await fetchJson<LidlResponse>(url, { retries: 4, backoffMs: 2000 });
        for (const item of data.items ?? []) {
          const p = parseItem(item);
          if (p && !byId.has(p.externalId)) byId.set(p.externalId, p);
        }
      } catch (err) {
        warnings.push(`Lidl: interogarea „${q}” a eșuat: ${(err as Error).message}`);
      }
      await sleep(PAUSE_BETWEEN_QUERIES_MS);
    }

    if (byId.size === 0) {
      throw new Error(`Lidl: nu s-a putut prelua niciun produs. ${warnings.slice(0, 3).join(' | ')}`);
    }

    return {
      supermarket: { slug: this.slug, name: this.name },
      stores: [],
      products: [...byId.values()],
      warnings
    };
  }
};

function parseItem(item: LidlItem): ScrapedProduct | null {
  const d = item.gridbox?.data;
  if (!d) return null;
  const price = d.price?.price;
  const externalId = String(d.itemId ?? d.erpNumber ?? item.code ?? '');
  if (!externalId || !price || price <= 0) return null;

  const validity = d.stockAvailability?.badgeInfoV2?.[0];

  return {
    externalId,
    name: d.fullTitle ?? '',
    brand: d.brand?.name || undefined,
    rawCategory: d.keyfacts?.wonCategoryPrimary,
    unitSizeText: d.price?.packaging?.text,
    price,
    oldPrice: d.price?.oldPrice && d.price.oldPrice > 0 ? d.price.oldPrice : undefined,
    currency: d.price?.currencyCode || 'RON',
    imageUrl: d.image,
    url: d.canonicalUrl ? `https://www.lidl.ro${d.canonicalUrl}` : undefined,
    validFrom: validity?.validFrom ? toIsoDate(validity.validFrom) : undefined,
    validTo: validity?.validUntil ? toIsoDate(validity.validUntil) : undefined,
    storeExternalIds: null
  };
}

function toIsoDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}
