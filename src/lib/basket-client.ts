'use client';

/**
 * Coșul de cumpărături, ținut în localStorage (MVP — fără cont).
 * Un articol = o căutare (nume exact de produs sau termen generic) + cantitate.
 */

export interface StoredBasketItem {
  query: string;
  qty: number;
}

const KEY = 'cosul-ieftin.basket';
const EVENT = 'basket-changed';

export function getBasket(): StoredBasketItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as StoredBasketItem[]) : [];
  } catch {
    return [];
  }
}

export function setBasket(items: StoredBasketItem[]): void {
  localStorage.setItem(KEY, JSON.stringify(items));
  window.dispatchEvent(new Event(EVENT));
}

export function addToBasket(query: string): void {
  const items = getBasket();
  const existing = items.find((i) => i.query.toLowerCase() === query.toLowerCase());
  if (existing) existing.qty += 1;
  else items.push({ query, qty: 1 });
  setBasket(items);
}

export function basketCount(): number {
  return getBasket().reduce((sum, i) => sum + i.qty, 0);
}

export function onBasketChange(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}

/** Județul selectat (opțional) — influențează prețurile per magazin. */
const COUNTY_KEY = 'cosul-ieftin.county';

export function getCounty(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(COUNTY_KEY) ?? '';
}

export function setCounty(county: string): void {
  localStorage.setItem(COUNTY_KEY, county);
  window.dispatchEvent(new Event(EVENT));
}
