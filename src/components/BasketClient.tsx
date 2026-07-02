'use client';

import { useCallback, useEffect, useState } from 'react';
import { getBasket, setBasket, getCounty, type StoredBasketItem } from '@/lib/basket-client';
import type { Product } from './ProductCard';

interface ComparisonItem {
  query: string;
  qty: number;
  product: Product | null;
  alternative: Product | null;
}

interface Comparison {
  slug: string;
  name: string;
  total: number;
  foundCount: number;
  items: ComparisonItem[];
}

const MEDALS = ['🥇', '🥈', '🥉'];

export function BasketClient(): JSX.Element {
  const [items, setItems] = useState<StoredBasketItem[]>([]);
  const [comparisons, setComparisons] = useState<Comparison[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setItems(getBasket());
  }, []);

  const update = (next: StoredBasketItem[]): void => {
    setItems(next);
    setBasket(next);
    setComparisons(null);
  };

  const changeQty = (idx: number, delta: number): void => {
    const next = [...items];
    next[idx] = { ...next[idx], qty: next[idx].qty + delta };
    update(next[idx].qty <= 0 ? next.filter((_, i) => i !== idx) : next);
  };

  const compare = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: getBasket(), county: getCounty() || undefined })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Eroare la comparare');
      setComparisons(data.comparisons);
      setExpanded(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  if (items.length === 0) {
    return (
      <div className="space-y-3 py-10 text-center text-gray-500">
        <p className="text-4xl">🧺</p>
        <p>Coșul e gol. Caută produse și adaugă-le, apoi revino aici pentru comparație.</p>
      </div>
    );
  }

  const withProducts = comparisons?.filter((c) => c.foundCount > 0) ?? [];
  const top3 = withProducts.slice(0, 3);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold">Coșul meu ({items.length} articole)</h2>

      <ul className="divide-y rounded-xl border border-gray-200 bg-white shadow-sm">
        {items.map((item, idx) => (
          <li key={item.query} className="flex items-center gap-2 px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-sm">{item.query}</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => changeQty(idx, -1)}
                className="h-7 w-7 rounded-full border text-gray-600"
                aria-label="Scade cantitatea"
              >
                −
              </button>
              <span className="w-6 text-center text-sm font-semibold">{item.qty}</span>
              <button
                onClick={() => changeQty(idx, 1)}
                className="h-7 w-7 rounded-full border text-gray-600"
                aria-label="Crește cantitatea"
              >
                +
              </button>
            </div>
          </li>
        ))}
      </ul>

      <button
        onClick={compare}
        disabled={loading}
        className="w-full rounded-xl bg-brand-600 py-3 font-semibold text-white shadow hover:bg-brand-500 disabled:opacity-60"
      >
        {loading ? 'Se compară…' : 'Unde e cel mai ieftin?'}
      </button>

      {error && <p className="text-center text-sm text-red-600">{error}</p>}

      {comparisons && top3.length === 0 && (
        <p className="py-4 text-center text-gray-500">Niciun supermarket nu are produsele căutate.</p>
      )}

      {top3.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-semibold">Top {top3.length} supermarketuri pentru coșul tău</h3>
          {top3.map((c, rank) => {
            const missing = c.items.filter((i) => !i.product);
            const isOpen = expanded === c.slug;
            return (
              <div key={c.slug} className={`rounded-xl border bg-white shadow-sm ${rank === 0 ? 'border-brand-500 ring-1 ring-brand-500' : 'border-gray-200'}`}>
                <button className="flex w-full items-center gap-3 p-3 text-left" onClick={() => setExpanded(isOpen ? null : c.slug)}>
                  <span className="text-2xl">{MEDALS[rank]}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{c.name}</p>
                    <p className="text-xs text-gray-500">
                      {c.foundCount}/{c.items.length} articole găsite
                      {missing.length > 0 && ` · ${missing.length} lipsă`}
                    </p>
                  </div>
                  <span className="text-lg font-bold text-brand-600">{c.total.toFixed(2)} lei</span>
                  <span className="text-gray-400">{isOpen ? '▴' : '▾'}</span>
                </button>

                {isOpen && (
                  <div className="space-y-1 border-t px-3 py-2">
                    {c.items.map((i) => (
                      <div key={i.query} className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="min-w-0 flex-1">
                          {i.product ? (
                            <>
                              <span className="text-gray-800">
                                {i.qty > 1 ? `${i.qty} × ` : ''}
                                {i.product.brand ? `${i.product.brand} ` : ''}
                                {i.product.name}
                              </span>
                              {i.product.unitSize && <span className="text-xs text-gray-400"> · {i.product.unitSize}</span>}
                            </>
                          ) : (
                            <span className="text-red-600">
                              ✗ {i.query} — lipsește
                              {i.alternative && (
                                <span className="block text-xs text-amber-700">
                                  Alternativă: {i.alternative.brand ? `${i.alternative.brand} ` : ''}
                                  {i.alternative.name} — {i.alternative.price.toFixed(2)} lei
                                </span>
                              )}
                            </span>
                          )}
                        </span>
                        {i.product && (
                          <span className="shrink-0 font-medium">{(i.product.price * i.qty).toFixed(2)} lei</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {withProducts.length > top3.length && (
            <p className="text-center text-xs text-gray-400">
              {withProducts
                .slice(top3.length)
                .map((c) => `${c.name}: ${c.total.toFixed(2)} lei (${c.foundCount}/${c.items.length})`)
                .join(' · ')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
