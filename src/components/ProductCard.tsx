'use client';

import { useState } from 'react';
import { addToBasket } from '@/lib/basket-client';

export interface Product {
  id: number;
  name: string;
  brand: string | null;
  category: string | null;
  unitSize: string | null;
  imageUrl: string | null;
  url: string | null;
  supermarketSlug: string;
  supermarketName: string;
  price: number;
  oldPrice: number | null;
  pricePerUnit: number | null;
  perUnit: string | null;
  city: string | null;
  updatedAt: string;
}

const BADGE_COLORS: Record<string, string> = {
  lidl: 'bg-blue-100 text-blue-800',
  kaufland: 'bg-red-100 text-red-800',
  profi: 'bg-orange-100 text-orange-800',
  carrefour: 'bg-sky-100 text-sky-800',
  'mega-image': 'bg-rose-100 text-rose-800',
  auchan: 'bg-emerald-100 text-emerald-800'
};

/** Marca se afișează doar dacă nu e deja inclusă în numele produsului. */
function brandPrefix(p: Product): string | null {
  if (!p.brand) return null;
  return p.name.toLowerCase().includes(p.brand.toLowerCase()) ? null : p.brand;
}

export function ProductCard({ product: p }: { product: Product }): JSX.Element {
  const [added, setAdded] = useState(false);

  const onAdd = (): void => {
    addToBasket([brandPrefix(p), p.name].filter(Boolean).join(' '));
    setAdded(true);
    setTimeout(() => setAdded(false), 1200);
  };

  return (
    <div className="flex gap-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      {p.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.imageUrl} alt="" className="h-20 w-20 shrink-0 rounded-lg object-contain" loading="lazy" />
      ) : (
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-2xl">🛒</div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-2">
          <p className="line-clamp-2 text-sm font-medium">
            {brandPrefix(p) ? <span className="font-semibold">{brandPrefix(p)} </span> : null}
            {p.name}
          </p>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              BADGE_COLORS[p.supermarketSlug] ?? 'bg-gray-100 text-gray-700'
            }`}
          >
            {p.supermarketName}
          </span>
        </div>
        <p className="text-xs text-gray-500">
          {p.unitSize ?? ''}
          {p.pricePerUnit ? ` · ${p.pricePerUnit.toFixed(2)} lei/${p.perUnit}` : ''}
          {p.city ? ` · ${p.city}` : ''}
        </p>
        <div className="mt-auto flex items-end justify-between pt-1">
          <div>
            <span className="text-lg font-bold text-brand-600">{p.price.toFixed(2)} lei</span>
            {p.oldPrice && p.oldPrice > p.price ? (
              <span className="ml-1.5 text-xs text-gray-400 line-through">{p.oldPrice.toFixed(2)}</span>
            ) : null}
          </div>
          <button
            onClick={onAdd}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold text-white transition ${
              added ? 'bg-brand-700' : 'bg-brand-600 hover:bg-brand-500'
            }`}
          >
            {added ? '✓ Adăugat' : '+ Coș'}
          </button>
        </div>
      </div>
    </div>
  );
}
