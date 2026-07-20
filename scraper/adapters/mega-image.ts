import { postJson, sleep } from '../http';
import type { ScrapeResult, ScrapedProduct, StoreAdapter } from '../types';

/**
 * Mega Image (Ahold Delhaize) — gateway-ul GraphQL public al site-ului:
 *   POST https://www.mega-image.ro/api/v1/
 *
 * Deși site-ul folosește „persisted queries”, endpoint-ul acceptă și interogări
 * GraphQL complete — nu e nevoie de extragerea hash-urilor din bundle-uri.
 * `productSearchV2` cu searchQuery gol întoarce ÎNTREGUL catalog online
 * (~7.500 produse), paginat; pageSize maxim acceptat: 50.
 *
 * Prețurile sunt naționale (magazinul online) → store_id = 0.
 * Categoria se derivă din calea URL-ului produsului
 * („/Lactate-si-oua/Lapte-proaspat/.../p/97109”).
 */

const API = 'https://www.mega-image.ro/api/v1/';
const BASE = 'https://www.mega-image.ro';
const PAGE_SIZE = 50;
const PAUSE_MS = 700;
const MAX_PAGES = 400;

const PRODUCT_QUERY = `query($q: String, $page: Int, $size: Int) {
  productSearch: productSearchV2(lang: "ro", searchQuery: $q, pageSize: $size, pageNumber: $page) {
    products {
      code
      name
      manufacturerName
      url
      images { url imageType format }
      price { value unitPrice unitCode showStrikethroughPrice discountedPriceFormatted }
    }
    pagination { totalResults totalPages currentPage pageSize }
  }
}`;

interface MegaProduct {
  code?: string;
  name?: string;
  manufacturerName?: string;
  url?: string;
  images?: Array<{ url?: string; imageType?: string; format?: string }>;
  price?: {
    value?: number;
    unitPrice?: number;
    unitCode?: string;
    showStrikethroughPrice?: boolean;
    discountedPriceFormatted?: string;
  };
}

interface MegaResponse {
  data?: {
    productSearch?: {
      products?: MegaProduct[];
      pagination?: { totalResults?: number; totalPages?: number; currentPage?: number };
    };
  };
  errors?: Array<{ message?: string }>;
}

export const megaImageAdapter: StoreAdapter = {
  slug: 'mega-image',
  name: 'Mega Image',
  minProducts: 3000,

  async scrape(): Promise<ScrapeResult> {
    const warnings: string[] = [];
    const byId = new Map<string, ScrapedProduct>();

    let totalPages = 1;
    for (let page = 0; page < Math.min(totalPages, MAX_PAGES); page++) {
      const data = await postJson<MegaResponse>(
        API,
        { query: PRODUCT_QUERY, variables: { q: '', page, size: PAGE_SIZE } },
        { retries: 4, backoffMs: 2000, timeoutMs: 45000 }
      );
      if (data.errors?.length) {
        throw new Error(`Mega Image: eroare GraphQL la pagina ${page}: ${data.errors[0]?.message}`);
      }
      const search = data.data?.productSearch;
      const pag = search?.pagination;
      if (pag?.totalResults != null) {
        totalPages = Math.ceil(pag.totalResults / PAGE_SIZE);
      }

      const items = search?.products ?? [];
      if (items.length === 0) break; // protecție anti-buclă
      for (const item of items) {
        const p = parseProduct(item);
        if (p && !byId.has(p.externalId)) byId.set(p.externalId, p);
      }
      await sleep(PAUSE_MS);
    }

    if (byId.size === 0) {
      throw new Error('Mega Image: nu s-a putut prelua niciun produs.');
    }

    return {
      supermarket: { slug: this.slug, name: this.name },
      stores: [],
      products: [...byId.values()],
      warnings
    };
  }
};

function parseProduct(item: MegaProduct): ScrapedProduct | null {
  const externalId = item.code ?? '';
  const regular = item.price?.value;
  if (!externalId || !item.name || !regular || regular <= 0) return null;

  // la reducere, prețul curent e cel „redus” (formatat), iar `value` devine prețul vechi
  const discounted = item.price?.showStrikethroughPrice
    ? parseFormattedLei(item.price?.discountedPriceFormatted)
    : null;
  const price = discounted ?? regular;
  const oldPrice = discounted != null && discounted < regular ? regular : undefined;

  // "/Lactate-si-oua/Lapte-proaspat/Lapte-proaspat-integral/<produs>/p/97109"
  // → categoria = segmentele de dinaintea produsului
  const segments = (item.url ?? '').split('/').filter(Boolean);
  const pIdx = segments.indexOf('p');
  const rawCategory =
    pIdx > 1 ? segments.slice(0, pIdx - 1).join(' ').replace(/-/g, ' ') : undefined;

  const image =
    item.images?.find((i) => i.imageType === 'PRIMARY' && i.format === 'respListGrid') ??
    item.images?.find((i) => i.imageType === 'PRIMARY');

  return {
    externalId,
    name: item.name,
    brand: item.manufacturerName || undefined,
    rawCategory,
    price,
    oldPrice,
    currency: 'RON',
    pricePerUnit: unitFromCode(item.price?.unitCode, item.price?.unitPrice ?? undefined),
    imageUrl: image?.url ? `${BASE}${image.url}` : undefined,
    url: item.url ? `${BASE}${item.url}` : undefined,
    storeExternalIds: null
  };
}

/** "16,15 Lei" → 16.15 */
function parseFormattedLei(text: string | undefined): number | null {
  if (!text) return null;
  const m = text.match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** unitCode-ul Mega Image → unitatea de bază a aplicației (dacă e utilizabilă). */
function unitFromCode(
  code: string | undefined,
  unitPrice: number | undefined
): { value: number; unit: 'kg' | 'l' | 'buc' } | undefined {
  if (!unitPrice || unitPrice <= 0) return undefined;
  const c = (code ?? '').toLowerCase();
  if (c.startsWith('kilogram') || c === 'kg') return { value: unitPrice, unit: 'kg' };
  if (c.startsWith('lit') || c === 'l') return { value: unitPrice, unit: 'l' };
  // „pieces” = preț per bucată — gramajul din nume dă lei/kg-l mai util,
  // așa că lăsăm calculul pe seama conductei comune (save.ts)
  return undefined;
}
