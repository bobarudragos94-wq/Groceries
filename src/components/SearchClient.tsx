'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ProductCard, type Product } from './ProductCard';
import { getCounty, setCounty } from '@/lib/basket-client';

interface Meta {
  supermarkets: Array<{ slug: string; name: string; productCount: number }>;
  cities: string[];
  counties: string[];
  categories: Array<{ slug: string; label: string }>;
  lastUpdate: string | null;
}

export function SearchClient(): JSX.Element {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [county, setCountyState] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    setCountyState(getCounty());
    fetch('/api/meta')
      .then((r) => r.json())
      .then(setMeta)
      .catch(() => undefined);
  }, []);

  const runSearch = useCallback(async (query: string, cat: string, cty: string) => {
    if (!query && !cat) {
      setProducts([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      if (cat) params.set('category', cat);
      if (cty) params.set('county', cty);
      const res = await fetch(`/api/search?${params}`);
      const data = await res.json();
      setProducts(data.products ?? []);
      setSearched(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const onQueryChange = (value: string): void => {
    setQ(value);
    setCategory('');
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(value, '', county), 350);
  };

  const onCategoryClick = (slug: string): void => {
    const next = slug === category ? '' : slug;
    setCategory(next);
    setQ('');
    runSearch('', next, county);
  };

  const onCountyChange = (value: string): void => {
    setCountyState(value);
    setCounty(value);
    runSearch(q, category, value);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <input
          type="search"
          value={q}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Caută: „Fanta pere”, „lapte”, „roșii”…"
          className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-base shadow-sm focus:border-brand-500 focus:outline-none"
          autoFocus
        />
        <div className="flex items-center gap-2">
          <select
            value={county}
            onChange={(e) => onCountyChange(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
            aria-label="Județul meu"
          >
            <option value="">Toate județele</option>
            {meta?.counties.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {meta?.lastUpdate && (
            <span className="text-xs text-gray-400">Prețuri actualizate: {meta.lastUpdate.slice(0, 10)}</span>
          )}
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {meta?.categories.map((c) => (
          <button
            key={c.slug}
            onClick={() => onCategoryClick(c.slug)}
            className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-sm ${
              category === c.slug
                ? 'border-brand-600 bg-brand-600 text-white'
                : 'border-gray-300 bg-white text-gray-700'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {loading && <p className="py-8 text-center text-gray-500">Se caută…</p>}

      {!loading && searched && products.length === 0 && (
        <p className="py-8 text-center text-gray-500">
          Niciun produs găsit. Încearcă un termen mai general (ex. „lapte” în loc de marcă).
        </p>
      )}

      {!loading && !searched && (
        <div className="space-y-3 py-6 text-center text-gray-500">
          <p className="text-4xl">🛒</p>
          <p>
            Caută un produs sau alege o categorie, apoi adaugă-l în coș.
            <br />
            La final vezi în ce supermarket e cel mai ieftin coșul tău.
          </p>
          {meta && (
            <p className="text-xs">
              {meta.supermarkets
                .filter((s) => s.productCount > 0)
                .map((s) => `${s.name}: ${s.productCount} produse`)
                .join(' · ')}
            </p>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {products.map((p) => (
          <ProductCard key={`${p.supermarketSlug}-${p.id}`} product={p} />
        ))}
      </div>
    </div>
  );
}
