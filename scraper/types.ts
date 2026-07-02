/**
 * Contractul unui scraper de supermarket.
 * Un adapter nou (Carrefour, Mega Image, Auchan...) trebuie doar să
 * implementeze `StoreAdapter` și să fie înregistrat în scraper/index.ts.
 */

export interface ScrapedStore {
  externalId: string;
  name: string;
  city: string;
  address?: string;
  lat?: number;
  lng?: number;
}

export interface ScrapedProduct {
  externalId: string;
  name: string;
  brand?: string;
  /** categoria așa cum o raportează magazinul */
  rawCategory?: string;
  /** textul ambalajului, ex. "1 L", "500g", "6x1,5l" */
  unitSizeText?: string;
  price: number;
  oldPrice?: number;
  currency?: string;
  /** preț/unitate raportat de magazin (dacă există) — altfel se calculează */
  pricePerUnit?: { value: number; unit: 'kg' | 'l' | 'buc' };
  imageUrl?: string;
  url?: string;
  validFrom?: string;
  validTo?: string;
  /**
   * Magazinele (externalId) în care e valabil prețul.
   * undefined/null = preț național (toate magazinele).
   */
  storeExternalIds?: string[] | null;
}

export interface ScrapeResult {
  supermarket: { slug: string; name: string };
  stores: ScrapedStore[];
  products: ScrapedProduct[];
  warnings: string[];
}

export interface StoreAdapter {
  slug: string;
  name: string;
  scrape(): Promise<ScrapeResult>;
}
