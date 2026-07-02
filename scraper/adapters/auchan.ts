import { fetchWithRetry, sleep } from '../http';
import type { ScrapeResult, ScrapedProduct, StoreAdapter } from '../types';

/**
 * Auchan România — magazin online pe platforma VTEX, cu API public de catalog:
 *   GET /api/catalog_system/pub/category/tree/{depth}
 *   GET /api/catalog_system/pub/products/search/?fq=C:{categoryId}&_from=A&_to=B
 *
 * Catalog COMPLET (~zeci de mii de produse) cu prețurile magazinului online
 * (naționale). Limitări observate:
 *  - fereastra de paginare max 50 (antetul `resources: from-to/total`)
 *  - offset adânc (>~2500) răspunde 400/429 → parcurgem subcategoriile,
 *    fiecare sub pragul de paginare, cu pauze și backoff la 429.
 */

const BASE = 'https://www.auchan.ro';
const PAGE_SIZE = 50;
const MAX_OFFSET = 2400; // sub limita hard a VTEX
const PAUSE_MS = 450;

interface VtexCategory {
  id: number;
  name: string;
  hasChildren: boolean;
  children?: VtexCategory[];
}

interface VtexProduct {
  productId: string;
  productName: string;
  brand?: string;
  linkText?: string;
  categories?: string[];
  items?: Array<{
    ean?: string;
    measurementUnit?: string;
    unitMultiplier?: number;
    images?: Array<{ imageUrl?: string }>;
    sellers?: Array<{
      commertialOffer?: { Price?: number; ListPrice?: number; IsAvailable?: boolean };
    }>;
  }>;
}

export const auchanAdapter: StoreAdapter = {
  slug: 'auchan',
  name: 'Auchan',
  minProducts: 2000,

  async scrape(): Promise<ScrapeResult> {
    const warnings: string[] = [];
    const byId = new Map<string, ScrapedProduct>();

    const tree = await fetchTree();
    // interogarea pe categorie cere CALEA completă: fq=C:/1000000/1010000/
    const queue: Array<{ cat: VtexCategory; path: string }> = tree.map((cat) => ({
      cat,
      path: `/${cat.id}/`
    }));

    while (queue.length > 0) {
      const { cat, path } = queue.shift()!;
      let total: number;
      try {
        total = await categoryTotal(path);
      } catch (err) {
        warnings.push(`Auchan: categoria ${cat.name} (${path}) nu răspunde: ${(err as Error).message}`);
        continue;
      }

      // categoriile prea mari nu pot fi paginate integral — coborâm în subcategorii
      if (total > MAX_OFFSET && cat.children?.length) {
        queue.push(...cat.children.map((ch) => ({ cat: ch, path: `${path}${ch.id}/` })));
        continue;
      }
      if (total === 0) continue;

      try {
        await pageCategory(path, Math.min(total, MAX_OFFSET), byId);
        if (total > MAX_OFFSET) {
          warnings.push(
            `Auchan: categoria ${cat.name} are ${total} produse fără subcategorii — s-au preluat primele ${MAX_OFFSET}`
          );
        }
      } catch (err) {
        warnings.push(`Auchan: paginarea categoriei ${cat.name} a eșuat: ${(err as Error).message}`);
      }
    }

    if (byId.size === 0) {
      throw new Error(`Auchan: nu s-a extras niciun produs. ${warnings.slice(0, 3).join(' | ')}`);
    }

    return {
      supermarket: { slug: this.slug, name: this.name },
      stores: [],
      products: [...byId.values()],
      warnings
    };
  }
};

async function fetchTree(): Promise<VtexCategory[]> {
  const res = await fetchWithRetry(`${BASE}/api/catalog_system/pub/category/tree/3`, {
    retries: 4,
    backoffMs: 3000
  });
  if (!res.ok) throw new Error(`Auchan: category tree HTTP ${res.status}`);
  return (await res.json()) as VtexCategory[];
}

async function categoryTotal(path: string): Promise<number> {
  const res = await fetchWithRetry(
    `${BASE}/api/catalog_system/pub/products/search/?fq=C:${encodeURIComponent(path)}&_from=0&_to=0`,
    { retries: 4, backoffMs: 3000 }
  );
  if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
  // antet: "resources: 0-0/3625"
  const resources = res.headers.get('resources') || '';
  const m = resources.match(/\/(\d+)\s*$/);
  await res.arrayBuffer(); // consumă corpul
  return m ? parseInt(m[1], 10) : 0;
}

async function pageCategory(
  path: string,
  total: number,
  byId: Map<string, ScrapedProduct>
): Promise<void> {
  for (let from = 0; from < total; from += PAGE_SIZE) {
    const to = Math.min(from + PAGE_SIZE - 1, total - 1);
    const res = await fetchWithRetry(
      `${BASE}/api/catalog_system/pub/products/search/?fq=C:${encodeURIComponent(path)}&_from=${from}&_to=${to}`,
      { retries: 5, backoffMs: 4000, timeoutMs: 45000 }
    );
    if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status} la offset ${from}`);
    const products = (await res.json()) as VtexProduct[];
    for (const p of products) {
      const sp = parseProduct(p);
      if (sp && !byId.has(sp.externalId)) byId.set(sp.externalId, sp);
    }
    await sleep(PAUSE_MS);
  }
}

function parseProduct(p: VtexProduct): ScrapedProduct | null {
  const item = p.items?.[0];
  const offer = item?.sellers?.[0]?.commertialOffer;
  const price = offer?.Price;
  if (!p.productId || !p.productName || !price || price <= 0) return null;

  const listPrice = offer?.ListPrice;
  // gramajul e de obicei în numele produsului ("..., 500 g"); ca rezervă,
  // folosim unitatea de măsură VTEX (ex. kg × 0.5)
  const unitSizeText =
    item?.measurementUnit && item.measurementUnit !== 'un' && item.unitMultiplier
      ? `${item.unitMultiplier} ${item.measurementUnit}`
      : p.productName;

  // frunza căii de categorie („.../Lactate/Lapte/” -> „Lapte”) — calea
  // întreagă conține cuvinte derutante („Lactate, Carne, Mezeluri & Peste”)
  const leafCategory = p.categories?.[0]?.split('/').filter(Boolean).pop();

  return {
    externalId: p.productId,
    name: p.productName,
    brand: p.brand || undefined,
    rawCategory: leafCategory,
    unitSizeText,
    price,
    oldPrice: listPrice && listPrice > price ? listPrice : undefined,
    currency: 'RON',
    imageUrl: item?.images?.[0]?.imageUrl,
    url: p.linkText ? `${BASE}/${p.linkText}/p` : undefined,
    storeExternalIds: null
  };
}
