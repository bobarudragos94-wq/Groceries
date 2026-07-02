import { fetchJson, fetchText, sleep } from '../http';
import { countyFromPostalCode } from '../../src/lib/counties';
import { parseKauflandBasePrice } from '../../src/lib/normalize';
import type { ScrapeResult, ScrapedProduct, ScrapedStore, StoreAdapter } from '../types';

/**
 * Kaufland România — surse publice:
 *  1. Lista magazinelor:  GET /.klstorefinder.json  (~204 magazine, cu oraș + cod poștal)
 *  2. Ofertele săptămânii: pagina /oferte/oferte-saptamanale/saptamana-curenta.html
 *     conține TOATE ofertele în JSON server-side-rendered
 *     (window.SSR[...] = {component:"OfferTemplate", props.offerData.cycles[].categories[].offers[]})
 *  3. Ofertele valabile per magazin: GET /.kloffers.storeName={id}.json
 *     (listă de klNr) — cu ea filtrăm setul global pe fiecare magazin.
 *
 * Acoperire: implicit TOATE JUDEȚELE — județul fiecărui magazin se derivă din
 * codul poștal și se alege un magazin reprezentativ per județ (determinist).
 *   KAUFLAND_SCOPE=all      → toate cele ~204 magazine (mai lent)
 *   KAUFLAND_CITIES=a,b,c   → doar orașele date (suprascrie selecția pe județe)
 */

const BASE = 'https://www.kaufland.ro';

interface KlStore {
  n: string; // ex. "RO1000"
  cn: string; // nume magazin
  t: string; // oraș
  pc?: string; // cod poștal
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
  minProducts: 200,

  async scrape(): Promise<ScrapeResult> {
    const warnings: string[] = [];

    const allStores = await fetchJson<KlStore[]>(`${BASE}/.klstorefinder.json`);
    const selected = selectStores(allStores, warnings);
    if (selected.length === 0) throw new Error('Kaufland: niciun magazin selectat');

    const stores: ScrapedStore[] = selected.map((s) => ({
      externalId: s.n,
      name: s.cn,
      city: s.t,
      postalCode: s.pc,
      address: s.sn,
      lat: s.lat ? parseFloat(s.lat) : undefined,
      lng: s.lng ? parseFloat(s.lng) : undefined
    }));

    // 1) toate ofertele săptămânii (JSON încorporat în pagină)
    const html = await fetchText(`${BASE}/oferte/oferte-saptamanale/saptamana-curenta.html`, {
      timeoutMs: 90000
    });
    const offers = extractOffers(html);
    if (offers.length === 0) {
      throw new Error('Kaufland: nu s-au găsit oferte în pagină (structura s-a schimbat?)');
    }

    // 2) klNr valabile per magazin
    const storeKlNrs = new Map<string, Set<string>>();
    let storeFailures = 0;
    for (const s of selected) {
      try {
        const list = await fetchJson<Array<{ klNr?: string }>>(
          `${BASE}/.kloffers.storeName=${encodeURIComponent(s.n)}.json`
        );
        storeKlNrs.set(s.n, new Set(list.map((o) => o.klNr!).filter(Boolean)));
      } catch (err) {
        storeFailures++;
        warnings.push(`Kaufland: lista de oferte pentru ${s.n} (${s.t}) a eșuat: ${(err as Error).message}`);
      }
      await sleep(700);
    }
    // dacă n-am putut citi ofertele pentru >20% din magazine, considerăm rularea incompletă
    if (storeFailures > selected.length * 0.2) {
      throw new Error(
        `Kaufland: ${storeFailures}/${selected.length} magazine fără listă de oferte — rulare incompletă, nu se salvează parțial`
      );
    }

    const products: ScrapedProduct[] = offers.map((o) => {
      const inStores = selected.filter((s) => storeKlNrs.get(s.n)?.has(o.klNr)).map((s) => s.n);
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

/**
 * Selecția magazinelor: orașe explicite > toate > un magazin per județ.
 * Reprezentantul unui județ e magazinul cu numărul cel mai mic (stabil între rulări).
 */
function selectStores(allStores: KlStore[], warnings: string[]): KlStore[] {
  const scope = (process.env.KAUFLAND_SCOPE || '').toLowerCase();
  const citiesEnv = (process.env.KAUFLAND_CITIES || '').trim();

  if (citiesEnv) {
    const wanted = citiesEnv.split(',').map((c) => c.trim().toLowerCase());
    const picked = allStores.filter((s) => wanted.includes(s.t.toLowerCase()));
    for (const c of wanted) {
      if (!picked.some((s) => s.t.toLowerCase() === c)) {
        warnings.push(`Kaufland: niciun magazin în orașul „${c}”`);
      }
    }
    return dedupeByCity(picked);
  }

  if (scope === 'all') return [...allStores].sort((a, b) => a.n.localeCompare(b.n));

  // implicit: un magazin per județ
  const byCounty = new Map<string, KlStore>();
  let unknown = 0;
  for (const s of [...allStores].sort((a, b) => a.n.localeCompare(b.n))) {
    const county = countyFromPostalCode(s.pc);
    if (!county) {
      unknown++;
      continue;
    }
    if (!byCounty.has(county)) byCounty.set(county, s);
  }
  if (unknown > 0) warnings.push(`Kaufland: ${unknown} magazine cu cod poștal nerecunoscut (ignorate la selecția pe județe)`);
  return [...byCounty.values()];
}

/** Un singur magazin per oraș când selecția e pe orașe. */
function dedupeByCity(stores: KlStore[]): KlStore[] {
  const byCity = new Map<string, KlStore>();
  for (const s of [...stores].sort((a, b) => a.n.localeCompare(b.n))) {
    const key = s.t.toLowerCase();
    if (!byCity.has(key)) byCity.set(key, s);
  }
  return [...byCity.values()];
}

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
