import { fetchJson, sleep } from '../http';
import { GROCERY_QUERIES } from '../keywords';
import type { ScrapeResult, ScrapedProduct, StoreAdapter } from '../types';

/**
 * Lidl România — API-ul public de căutare/navigare al site-ului:
 *   GET https://www.lidl.ro/q/api/search?...&locale=ro_RO&assortment=RO&version=2.1.0
 *
 * CATALOG COMPLET: API-ul acceptă filtrul `category=<etichetă>` fără termen de
 * căutare, cu paginare offset — parcurgem toate categoriile de top ale
 * site-ului (materialul complet publicat online de Lidl). Cuvintele-cheie
 * rămân doar ca plasă de siguranță dacă navigarea pe categorii eșuează.
 *
 * Prețurile Lidl sunt NAȚIONALE (identice în toate magazinele/județele),
 * deci se salvează cu store_id=0 și acoperă orice județ.
 *
 * Capcane observate în practică:
 *  - fetchsize < 5 → HTTP 500 (bug al API-ului); folosim 100.
 *  - răspunsuri intermitente 500/406 → fetchJson reîncearcă cu backoff.
 */

const API = 'https://www.lidl.ro/q/api/search';
const FETCH_SIZE = 100;
const PAUSE_MS = 1500;

/** Categoriile de top de pe lidl.ro (etichetele exacte cerute de API). */
const TOP_CATEGORIES = [
  'Alimente & băuturi',
  'Bucătărie & gospodărie',
  'Bebeluși, copii & jucării',
  'Atelier & grădină',
  'Fashion & lifestyle',
  'Locuință & amenajare',
  'Sport & timp liber'
];

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
  minProducts: 300,

  async scrape(): Promise<ScrapeResult> {
    const warnings: string[] = [];
    const byId = new Map<string, ScrapedProduct>();

    // 1) catalogul complet, categorie cu categorie, cu paginare
    for (const cat of TOP_CATEGORIES) {
      try {
        await browseCategory(cat, byId);
      } catch (err) {
        warnings.push(`Lidl: categoria „${cat}” a eșuat: ${(err as Error).message}`);
      }
      await sleep(PAUSE_MS);
    }

    // 2) plasă de siguranță: dacă navigarea pe categorii a adus prea puțin,
    //    completăm cu interogări pe cuvinte-cheie
    if (byId.size < this.minProducts) {
      warnings.push(
        `Lidl: navigarea pe categorii a adus doar ${byId.size} produse — se completează cu căutări pe cuvinte-cheie`
      );
      const extra = (process.env.LIDL_EXTRA_QUERIES || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      for (const q of [...GROCERY_QUERIES, ...extra]) {
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
        await sleep(1200);
      }
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

async function browseCategory(category: string, byId: Map<string, ScrapedProduct>): Promise<void> {
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const url =
      `${API}?category=${encodeURIComponent(category)}` +
      `&fetchsize=${FETCH_SIZE}&offset=${offset}&locale=ro_RO&assortment=RO&version=2.1.0`;
    const data = await fetchJson<LidlResponse>(url, { retries: 5, backoffMs: 2500 });

    if (typeof data.numFound !== 'number') {
      throw new Error(`răspuns fără numFound la offset ${offset}`);
    }
    total = data.numFound;

    const items = data.items ?? [];
    for (const item of items) {
      const p = parseItem(item);
      if (p && !byId.has(p.externalId)) byId.set(p.externalId, p);
    }
    if (items.length === 0) break; // protecție anti-buclă
    offset += items.length;
    await sleep(PAUSE_MS);
  }
}

function parseItem(item: LidlItem): ScrapedProduct | null {
  const d = item.gridbox?.data;
  if (!d) return null;
  const price = d.price?.price;
  const externalId = String(d.itemId ?? d.erpNumber ?? item.code ?? '');
  // produsele fără preț publicat (doar „în magazin”) nu ne ajută la comparație
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
