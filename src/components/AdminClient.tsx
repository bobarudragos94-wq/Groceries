'use client';

import { useCallback, useEffect, useState } from 'react';

interface AdminProduct {
  id: number;
  name: string;
  brand: string | null;
  category: string | null;
  unit_size: string | null;
  supermarket: string;
  price: number | null;
  updated_at: string | null;
}

interface AdminSupermarket {
  id: number;
  slug: string;
  name: string;
  products: number;
  stores: number;
  cities: number;
}

interface ScrapeRun {
  supermarket: string;
  status: string;
  products_found: number;
  message: string | null;
  finished_at: string | null;
}

const PW_KEY = 'cosul-ieftin.admin-pw';

export function AdminClient(): JSX.Element {
  const [password, setPassword] = useState('');
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState<'produse' | 'import' | 'magazine'>('produse');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem(PW_KEY);
    if (saved) {
      setPassword(saved);
      setAuthed(true);
    }
  }, []);

  const headers = useCallback(
    (): Record<string, string> => ({ 'x-admin-password': password, 'Content-Type': 'application/json' }),
    [password]
  );

  const login = async (): Promise<void> => {
    const res = await fetch('/api/admin/supermarkets', { headers: headers() });
    if (res.ok) {
      localStorage.setItem(PW_KEY, password);
      setAuthed(true);
      setMessage('');
    } else {
      setMessage('Parolă greșită');
    }
  };

  if (!authed) {
    return (
      <div className="mx-auto max-w-sm space-y-3 py-10">
        <h2 className="text-center text-lg font-bold">Panou de administrare</h2>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && login()}
          placeholder="Parola de admin"
          className="w-full rounded-xl border border-gray-300 px-4 py-3"
        />
        <button onClick={login} className="w-full rounded-xl bg-brand-600 py-3 font-semibold text-white">
          Intră
        </button>
        {message && <p className="text-center text-sm text-red-600">{message}</p>}
        <p className="text-center text-xs text-gray-400">Setează ADMIN_PASSWORD în variabilele de mediu.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(['produse', 'import', 'magazine'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-1.5 text-sm capitalize ${
              tab === t ? 'bg-brand-600 font-semibold text-white' : 'border border-gray-300 bg-white'
            }`}
          >
            {t}
          </button>
        ))}
        <button
          onClick={() => {
            localStorage.removeItem(PW_KEY);
            setAuthed(false);
            setPassword('');
          }}
          className="ml-auto text-sm text-gray-400 underline"
        >
          Ieși
        </button>
      </div>

      {tab === 'produse' && <ProductsTab headers={headers} />}
      {tab === 'import' && <ImportTab headers={headers} />}
      {tab === 'magazine' && <SupermarketsTab headers={headers} />}
    </div>
  );
}

function ProductsTab({ headers }: { headers: () => Record<string, string> }): JSX.Element {
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [q, setQ] = useState('');
  const [form, setForm] = useState({ supermarketSlug: 'lidl', name: '', brand: '', unitSize: '', price: '' });
  const [msg, setMsg] = useState('');

  const load = useCallback(async (): Promise<void> => {
    const res = await fetch(`/api/admin/products?q=${encodeURIComponent(q)}`, { headers: headers() });
    const data = await res.json();
    setProducts(data.products ?? []);
  }, [q, headers]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (): Promise<void> => {
    const res = await fetch('/api/admin/products', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ ...form, price: parseFloat(form.price.replace(',', '.')) })
    });
    const data = await res.json();
    setMsg(res.ok ? '✔ Produs salvat' : data.error);
    if (res.ok) {
      setForm({ ...form, name: '', brand: '', unitSize: '', price: '' });
      load();
    }
  };

  const updatePrice = async (id: number): Promise<void> => {
    const price = prompt('Preț nou (lei):');
    if (!price) return;
    await fetch(`/api/admin/products/${id}`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ price: parseFloat(price.replace(',', '.')) })
    });
    load();
  };

  const remove = async (id: number): Promise<void> => {
    if (!confirm('Ștergi produsul?')) return;
    await fetch(`/api/admin/products/${id}`, { method: 'DELETE', headers: headers() });
    load();
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
        <h3 className="font-semibold">Adaugă produs</h3>
        <div className="grid grid-cols-2 gap-2">
          <select
            value={form.supermarketSlug}
            onChange={(e) => setForm({ ...form, supermarketSlug: e.target.value })}
            className="rounded-lg border px-2 py-2 text-sm"
          >
            {['lidl', 'kaufland', 'profi', 'carrefour', 'mega-image', 'auchan'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input
            placeholder="Marcă (opțional)"
            value={form.brand}
            onChange={(e) => setForm({ ...form, brand: e.target.value })}
            className="rounded-lg border px-2 py-2 text-sm"
          />
          <input
            placeholder="Nume produs *"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="col-span-2 rounded-lg border px-2 py-2 text-sm"
          />
          <input
            placeholder="Ambalaj (ex: 1 l, 500 g)"
            value={form.unitSize}
            onChange={(e) => setForm({ ...form, unitSize: e.target.value })}
            className="rounded-lg border px-2 py-2 text-sm"
          />
          <input
            placeholder="Preț (lei) *"
            value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value })}
            className="rounded-lg border px-2 py-2 text-sm"
          />
        </div>
        <button onClick={create} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white">
          Salvează
        </button>
        {msg && <p className="text-sm text-gray-600">{msg}</p>}
      </div>

      <input
        type="search"
        placeholder="Caută în produse…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="w-full rounded-xl border border-gray-300 px-4 py-2.5"
      />

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs uppercase text-gray-500">
              <th className="px-3 py-2">Produs</th>
              <th className="px-3 py-2">Magazin</th>
              <th className="px-3 py-2">Preț</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} className="border-b last:border-0">
                <td className="px-3 py-2">
                  {p.brand ? `${p.brand} ` : ''}
                  {p.name}
                  <span className="text-xs text-gray-400"> {p.unit_size ?? ''}</span>
                </td>
                <td className="px-3 py-2">{p.supermarket}</td>
                <td className="px-3 py-2 font-medium">{p.price != null ? `${Number(p.price).toFixed(2)} lei` : '—'}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <button onClick={() => updatePrice(p.id)} className="text-brand-600 underline">
                    preț
                  </button>{' '}
                  <button onClick={() => remove(p.id)} className="text-red-600 underline">
                    șterge
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ImportTab({ headers }: { headers: () => Record<string, string> }): JSX.Element {
  const [csv, setCsv] = useState('');
  const [msg, setMsg] = useState('');

  const doImport = async (): Promise<void> => {
    setMsg('Se importă…');
    const res = await fetch('/api/admin/import', {
      method: 'POST',
      headers: { 'x-admin-password': headers()['x-admin-password'], 'Content-Type': 'text/csv' },
      body: csv
    });
    const data = await res.json();
    setMsg(res.ok ? `✔ ${data.imported} produse importate` : `Eroare: ${data.error}`);
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-gray-200 bg-white p-3 text-sm shadow-sm">
        <p className="font-semibold">Format CSV</p>
        <code className="mt-1 block overflow-x-auto whitespace-nowrap rounded bg-gray-50 p-2 text-xs">
          supermarket,external_id,name,brand,category,unit_size,price,old_price,city,store_external_id,image_url,url
        </code>
        <p className="mt-1 text-xs text-gray-500">
          Obligatorii: supermarket, name, price. Cu „city” prețul devine specific orașului; fără — național.
        </p>
      </div>
      <textarea
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        rows={10}
        placeholder={'supermarket,external_id,name,brand,category,unit_size,price\nlidl,p1,Lapte UHT 1.5%,Pilos,lactate,1 l,5.49'}
        className="w-full rounded-xl border border-gray-300 p-3 font-mono text-xs"
      />
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) f.text().then(setCsv);
        }}
        className="block text-sm"
      />
      <button onClick={doImport} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white">
        Importă
      </button>
      {msg && <p className="text-sm text-gray-600">{msg}</p>}
    </div>
  );
}

function SupermarketsTab({ headers }: { headers: () => Record<string, string> }): JSX.Element {
  const [data, setData] = useState<{ supermarkets: AdminSupermarket[]; lastRuns: ScrapeRun[] } | null>(null);
  const [name, setName] = useState('');

  const load = useCallback(async (): Promise<void> => {
    const res = await fetch('/api/admin/supermarkets', { headers: headers() });
    if (res.ok) setData(await res.json());
  }, [headers]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async (): Promise<void> => {
    await fetch('/api/admin/supermarkets', { method: 'POST', headers: headers(), body: JSON.stringify({ name }) });
    setName('');
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          placeholder="Supermarket nou…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 rounded-lg border px-3 py-2 text-sm"
        />
        <button onClick={add} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white">
          Adaugă
        </button>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs uppercase text-gray-500">
              <th className="px-3 py-2">Supermarket</th>
              <th className="px-3 py-2">Produse</th>
              <th className="px-3 py-2">Magazine</th>
              <th className="px-3 py-2">Orașe</th>
            </tr>
          </thead>
          <tbody>
            {data?.supermarkets.map((s) => (
              <tr key={s.id} className="border-b last:border-0">
                <td className="px-3 py-2 font-medium">{s.name}</td>
                <td className="px-3 py-2">{s.products}</td>
                <td className="px-3 py-2">{s.stores}</td>
                <td className="px-3 py-2">{s.cities}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
        <h3 className="mb-2 font-semibold">Ultimele rulări ale scraperului</h3>
        {data?.lastRuns.length ? (
          <ul className="space-y-1 text-sm">
            {data.lastRuns.map((r, i) => (
              <li key={i} className="flex items-center gap-2">
                <span>{r.status === 'ok' ? '✅' : '❌'}</span>
                <span className="font-medium capitalize">{r.supermarket}</span>
                <span className="text-gray-500">{r.products_found} produse</span>
                <span className="ml-auto text-xs text-gray-400">{r.finished_at}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-400">Nicio rulare încă. Pornește cu: npm run scrape</p>
        )}
      </div>
    </div>
  );
}
