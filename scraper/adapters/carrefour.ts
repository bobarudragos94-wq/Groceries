import { fetchText, sleep } from '../http';
import type { ScrapeResult, ScrapedProduct, StoreAdapter } from '../types';

/**
 * Carrefour România — paginile de categorie (Magento) sunt redate pe server,
 * cu datele fiecărui produs într-un atribut JSON curat:
 *   data-event-attributes='{"id":"...","name":"...","price":...,"items":[{...categorii}]}'
 * plus URL-ul produsului, imaginea și prețul vechi în blocul HTML alăturat.
 *
 * Parcurgem categoriile de băcănie cu paginare (?p=N, 24 produse/pagină;
 * totalul e afișat în toolbar). Prețurile sunt cele ale magazinului online
 * (naționale) → store_id = 0.
 *
 * Categoriile se pot ajusta prin CARREFOUR_CATEGORIES (slug-uri separate
 * prin virgulă, ex. „bacanie-carrefour,cosmetice-si-ingrijire-personala”).
 */

const BASE = 'https://carrefour.ro';
const PAGE_SIZE = 24;
const PAUSE_MS = 1200;
const MAX_PAGES_PER_CATEGORY = 600;

const DEFAULT_CATEGORIES = ['bacanie-carrefour', 'cosmetice-si-ingrijire-personala'];

export const carrefourAdapter: StoreAdapter = {
  slug: 'carrefour',
  name: 'Carrefour',
  minProducts: 1500,

  async scrape(): Promise<ScrapeResult> {
    const warnings: string[] = [];
    const byId = new Map<string, ScrapedProduct>();

    const categories = (process.env.CARREFOUR_CATEGORIES || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    for (const cat of categories.length ? categories : DEFAULT_CATEGORIES) {
      try {
        await browseCategory(cat, byId, warnings);
      } catch (err) {
        warnings.push(`Carrefour: categoria „${cat}” a eșuat: ${(err as Error).message}`);
      }
    }

    if (byId.size === 0) {
      throw new Error(`Carrefour: nu s-a putut prelua niciun produs. ${warnings.slice(0, 3).join(' | ')}`);
    }

    return {
      supermarket: { slug: this.slug, name: this.name },
      stores: [],
      products: [...byId.values()],
      warnings
    };
  }
};

async function browseCategory(
  category: string,
  byId: Map<string, ScrapedProduct>,
  warnings: string[]
): Promise<void> {
  let total = Infinity;
  for (let page = 1; page <= MAX_PAGES_PER_CATEGORY; page++) {
    const url = `${BASE}/${category}${page > 1 ? `?p=${page}` : ''}`;
    const html = await fetchText(url, { retries: 4, backoffMs: 2500, timeoutMs: 45000 });

    const t = parseTotal(html);
    if (t != null) total = t;

    const before = byId.size;
    const found = parsePage(html, byId);
    if (found === 0 && page === 1) {
      throw new Error('nicio potrivire în HTML — s-a schimbat markup-ul?');
    }
    // dincolo de ultima pagină Magento repetă conținutul — fără produse NOI ne oprim
    if (found === 0 || byId.size === before) break;
    if (page * PAGE_SIZE >= total) break;
    await sleep(PAUSE_MS);
  }
}

/**
 * Totalul din toolbar: „<span class="toolbar-number"><strong>1</strong>-
 * <strong>24</strong> din <strong>242</strong> produse”. Clasa apare și în
 * alte contexte (config JS) — luăm maximul din toate aparițiile cu numere.
 */
function parseTotal(html: string): number | null {
  const nums: number[] = [];
  for (const m of html.matchAll(/toolbar-number[\s\S]{0,300}?<\/span>/g)) {
    for (const s of m[0].matchAll(/<strong>\s*(\d+)\s*<\/strong>/g)) {
      nums.push(parseInt(s[1], 10));
    }
  }
  return nums.length ? Math.max(...nums) : null;
}

interface CarrefourEventJson {
  id?: string;
  name?: string;
  price?: number;
  items?: Array<{ item_category?: string; item_category2?: string; item_category3?: string }>;
}

/** Extrage produsele dintr-o pagină; întoarce câte blocuri au fost găsite. */
function parsePage(html: string, byId: Map<string, ScrapedProduct>): number {
  // fiecare produs are exact un data-event-attributes cu JSON-ul de analytics
  const blocks = html.split(`data-event-attributes='`).slice(1);
  for (const block of blocks) {
    const jsonText = decodeEntities(block.slice(0, block.indexOf(`'`)));
    let data: CarrefourEventJson;
    try {
      data = JSON.parse(jsonText) as CarrefourEventJson;
    } catch {
      continue;
    }
    if (!data.id || !data.name || !data.price || data.price <= 0) continue;
    if (byId.has(data.id)) continue;

    // restul blocului (până la următorul produs) conține URL, imagine,
    // marcă (data-brand) și prețul vechi
    const seg = block.slice(0, 8000);
    const brand = decodeEntities(seg.match(/data-brand="([^"]*)"/)?.[1] ?? '');
    const url = seg.match(/href="(https:\/\/carrefour\.ro\/produse\/[^"]+)"/)?.[1];
    const image = seg.match(/data-src="(https:\/\/cdn-media\.carrefour\.ro\/[^"]+)"/)?.[1];
    // prețul vechi apare doar la promoții: <span class="price price-old">…12,34…
    const oldRaw = seg.match(/price price-old[^>]*>[\s\S]{0,200}?(\d+(?:[.,]\d+)?)/)?.[1];
    const oldPrice = oldRaw ? parseFloat(oldRaw.replace(',', '.')) : undefined;

    const cats = data.items?.[0];
    const rawCategory = [cats?.item_category, cats?.item_category2, cats?.item_category3]
      .filter(Boolean)
      .join(' ');

    byId.set(data.id, {
      externalId: data.id,
      name: data.name,
      brand: brand || undefined,
      rawCategory: rawCategory || undefined,
      price: data.price,
      oldPrice: oldPrice && oldPrice > data.price ? oldPrice : undefined,
      currency: 'RON',
      imageUrl: image,
      url,
      storeExternalIds: null
    });
  }
  return blocks.length;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
