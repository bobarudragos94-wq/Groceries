import { fetchJson, fetchText, sleep } from '../http';
import { normalizeText, parseKauflandBasePrice } from '../../src/lib/normalize';
import type { ScrapeResult, ScrapedProduct, ScrapedStore, StoreAdapter } from '../types';

/**
 * Kaufland România — două surse publice:
 *  1. Lista magazinelor:  GET /.klstorefinder.json  (204 magazine, cu oraș)
 *  2. Ofertele săptămânii: pagina /oferte/oferte-saptamanale/saptamana-curenta.html
 *     conține TOATE ofertele în JSON server-side-rendered
 *     (window.SSR[...] = {component:"OfferTemplate", props.offerData.cycles[].categories[].offers[]})
 *  3. Ofertele valabile per magazin: GET /.kloffers.storeName={id}.json
 *     (listă de klNr) — cu ea filtrăm setul global pe fiecare magazin.
 *
 * Orașele scanate se configurează cu KAUFLAND_CITIES (implicit marile orașe);
 * se ia primul magazin din fiecare oraș.
 */

const BASE = 'https://www.kaufland.ro';
const DEFAULT_CITIES = ['București', 'Cluj-Napoca', 'Timișoara', 'Iași', 'Constanța'];

interface KlStore {
  n: string; // ex. "RO1000"
  cn: string; // nume magazin
  t: string; // oraș
  sn?: string; // adresă
  lat?: string;
  lng?: string;
}

interface KlOffer {
  offerId?: string;
  klNr?: string;
  title?: string;
  subtitle?: string;
  unit?: string;
  price?: number | string;
  basePrice?: string;
  formattedBasePrice?: string;
  dateFrom?: string;
  dateTo?: string;
  listImage?: string;
  detailTitle?: string;
}

interface KlCategory {
  displayName?: string;
  name?: string;
  offers?: KlOffer[];
}

export const kauflandAdapter: StoreAdapter = {
  slug: 'kaufland',
  name: 'Kaufland',

  async scrape(): Promise<ScrapeResult> {
    const warnings: string[] = [];

    const allStores = await fetchJson<KlStore[]>(`${BASE}/.klstorefinder.json`);
    const cities = (process.env.KAUFLAND_CITIES || DEFAULT_CITIES.join(','))
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);

    const selected: KlStore[] = [];
    for (const city of cities) {
      const found = allStores.find((s) => normalizeText(s.t) === normalizeText(city));
      if (found) selected.push(found);
      else warnings.push(`Kaufland: niciun magazin găsit în orașul „${city}”`);
    }
    if (selected.length === 0) throw new Error('Kaufland: niciun magazin selectat');

    const stores: ScrapedStore[] = selected.map((s) => ({
      externalId: s.n,
      name: s.cn,
      city: s.t,
      address: s.sn,
      lat: s.lat ? parseFloat(s.lat) : undefined,
      lng: s.lng ? parseFloat(s.lng) : undefined
    }));

    // 1) toate ofertele săptămânii (JSON încorporat în pagină)
    const html = await fetchText(`${BASE}/oferte/oferte-saptamanale/saptamana-curenta.html`, {
      timeoutMs: 60000
    });
    const offers = extractOffers(html);
    if (offers.length === 0) {
      throw new Error('Kaufland: nu s-au găsit oferte în pagină (structura s-a schimbat?)');
    }

    // 2) klNr valabile per magazin
    const storeKlNrs = new Map<string, Set<string>>();
    for (const s of selected) {
      try {
        const list = await fetchJson<Array<{ klNr?: string }>>(
          `${BASE}/.kloffers.storeName=${encodeURIComponent(s.n)}.json`
        );
        storeKlNrs.set(s.n, new Set(list.map((o) => o.klNr!).filter(Boolean)));
      } catch (err) {
        warnings.push(`Kaufland: lista de oferte pentru ${s.n} (${s.t}) a eșuat: ${(err as Error).message}`);
      }
      await sleep(800);
    }

    const products: ScrapedProduct[] = offers.map((o) => {
      const inStores = selected
        .filter((s) => storeKlNrs.get(s.n)?.has(o.klNr))
        .map((s) => s.n);
      return {
        ...o.product,
        // dacă nu avem informație per magazin, tratăm prețul ca național
        storeExternalIds: inStores.length > 0 ? inStores : null
      };
    });

    return {
      supermarket: { slug: this.slug, name: this.name },
      stores,
      products,
      warnings
    };
  }
};

function extractOffers(html: string): Array<{ klNr: string; product: ScrapedProduct }> {
  const m = html.match(/window\.SSR\['[^']+'\]\s*=\s*(\{"component":"OfferTemplate".*?\});?\s*<\/script>/s);
  if (!m) return [];

  let data: { props?: { offerData?: { cycles?: Array<{ categories?: KlCategory[] }> } } };
  try {
    data = JSON.parse(m[1]);
  } catch {
    return [];
  }

  const out: Array<{ klNr: string; product: ScrapedProduct }> = [];
  const seen = new Set<string>();

  for (const cycle of data.props?.offerData?.cycles ?? []) {
    for (const cat of cycle.categories ?? []) {
      for (const o of cat.offers ?? []) {
        const price = typeof o.price === 'string' ? parseFloat(o.price.replace(',', '.')) : o.price;
        const klNr = o.klNr || o.offerId;
        if (!klNr || !price || price <= 0) continue;
        const externalId = o.klNr || o.offerId!;
        if (seen.has(externalId)) continue;
        seen.add(externalId);

        // titlul e adesea doar marca ("Gordi"), iar subtitlul conține numele
        // real + gramajul ("Cașcaval Dalia 100 G") — le combinăm
        const subtitle = (o.subtitle || '').replace(/\n/g, ' ').trim();
        const name = [o.title?.trim(), subtitle].filter(Boolean).join(' ') || (o.detailTitle || '').trim();
        if (!name) continue;
        const unitText = [subtitle, o.unit].filter(Boolean).join(' ');

        out.push({
          klNr: o.klNr || '',
          product: {
            externalId,
            name,
            rawCategory: cat.displayName || cat.name,
            unitSizeText: unitText || undefined,
            price,
            pricePerUnit: parseKauflandBasePrice(o.basePrice || o.formattedBasePrice) ?? undefined,
            currency: 'RON',
            imageUrl: o.listImage,
            url: `${BASE}/oferte/oferte-saptamanale/saptamana-curenta.html`,
            validFrom: o.dateFrom,
            validTo: o.dateTo
          }
        });
      }
    }
  }
  return out;
}
