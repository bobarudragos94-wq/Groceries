import type { ScrapeResult, ScrapedProduct, StoreAdapter } from '../types';

/**
 * Profi România — www.profi.ro este protejat de Cloudflare (challenge activ),
 * care blochează completamente cererile HTTP simple și IP-urile de datacenter.
 *
 * Strategia: browser real (Chromium prin playwright-core) care încarcă pagina
 * de oferte și extrage produsele din DOM + JSON-LD. Funcționează de pe un IP
 * rezidențial obișnuit (laptopul tău, un Raspberry Pi acasă); din cloud
 * (GitHub Actions, Vercel) Cloudflare va refuza de regulă conexiunea.
 *
 * Alternativă fără scraping: importul CSV din panoul de admin sau
 * `npm run import:csv -- fisier.csv`.
 */

const OFFER_PAGES = [
  'https://www.profi.ro/oferte/',
  'https://www.profi.ro/oferte/catalogul-saptamanii/'
];

export const profiAdapter: StoreAdapter = {
  slug: 'profi',
  name: 'Profi',

  async scrape(): Promise<ScrapeResult> {
    const warnings: string[] = [];
    let chromium;
    try {
      ({ chromium } = await import('playwright-core'));
    } catch {
      throw new Error(
        'Profi: playwright-core nu este instalat. Rulează `npm install playwright-core` și `npx playwright install chromium`.'
      );
    }

    const executablePath = process.env.PROFI_CHROMIUM_PATH || undefined;
    const browser = await chromium.launch({
      executablePath,
      args: ['--no-sandbox'],
      proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined
    });

    const products = new Map<string, ScrapedProduct>();
    try {
      const ctx = await browser.newContext({
        locale: 'ro-RO',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
      });
      const page = await ctx.newPage();

      for (const url of OFFER_PAGES) {
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
          // lasă provocarea Cloudflare să se rezolve, dacă apare
          await page.waitForTimeout(10000);

          const title = await page.title();
          if (/moment|attention|just a/i.test(title)) {
            warnings.push(`Profi: provocarea Cloudflare nu a trecut pe ${url} (IP blocat?)`);
            continue;
          }

          for (const p of await extractFromPage(page)) {
            if (!products.has(p.externalId)) products.set(p.externalId, p);
          }
        } catch (err) {
          warnings.push(`Profi: ${url} a eșuat: ${(err as Error).message.split('\n')[0]}`);
        }
      }
    } finally {
      await browser.close();
    }

    if (products.size === 0) {
      throw new Error(
        `Profi: nu s-a extras niciun produs. Cloudflare blochează probabil acest IP — rulează scraperul de pe un IP rezidențial sau folosește importul CSV. ${warnings.join(' | ')}`
      );
    }

    return {
      supermarket: { slug: this.slug, name: this.name },
      stores: [],
      products: [...products.values()],
      warnings
    };
  }
};

/* eslint-disable @typescript-eslint/no-explicit-any */
async function extractFromPage(page: any): Promise<ScrapedProduct[]> {
  // 1) JSON-LD (schema.org/Product) dacă există
  const jsonLd: ScrapedProduct[] = await page.evaluate(() => {
    const out: any[] = [];
    for (const s of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
      try {
        const data = JSON.parse(s.textContent || 'null');
        const list = Array.isArray(data) ? data : [data];
        for (const d of list) {
          const items = d?.['@type'] === 'ItemList' ? (d.itemListElement || []).map((x: any) => x.item || x) : [d];
          for (const it of items) {
            if (it?.['@type'] === 'Product' && it.offers) {
              const offer = Array.isArray(it.offers) ? it.offers[0] : it.offers;
              const price = parseFloat(String(offer?.price ?? '').replace(',', '.'));
              if (price > 0) {
                out.push({
                  externalId: String(it.sku || it.productID || it.name),
                  name: String(it.name || ''),
                  brand: it.brand?.name || undefined,
                  price,
                  imageUrl: typeof it.image === 'string' ? it.image : it.image?.[0],
                  url: it.url,
                  storeExternalIds: null
                });
              }
            }
          }
        }
      } catch {
        /* JSON-LD invalid — ignorăm */
      }
    }
    return out;
  });
  if (jsonLd.length > 0) return jsonLd;

  // 2) euristic: carduri de produs cu preț în DOM
  return await page.evaluate(() => {
    const out: any[] = [];
    const priceRe = /(\d+(?:[.,]\d{1,2})?)\s*(?:lei|ron)/i;
    const nodes = Array.from(
      document.querySelectorAll('[class*="product"], [class*="offer"], [class*="card"]')
    ) as HTMLElement[];
    for (const el of nodes) {
      if (el.querySelector('[class*="product"], [class*="offer"], [class*="card"]')) continue; // doar frunzele
      const text = el.innerText || '';
      const m = text.match(priceRe);
      if (!m) continue;
      const name = (el.querySelector('h2,h3,h4,[class*="title"],[class*="name"]') as HTMLElement | null)?.innerText
        ?.trim();
      if (!name || name.length < 3) continue;
      const price = parseFloat(m[1].replace(',', '.'));
      if (!(price > 0)) continue;
      const img = el.querySelector('img') as HTMLImageElement | null;
      out.push({
        externalId: name.toLowerCase().replace(/\s+/g, '-').slice(0, 80),
        name,
        price,
        imageUrl: img?.src,
        storeExternalIds: null
      });
    }
    return out;
  });
}
