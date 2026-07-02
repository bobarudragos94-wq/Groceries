import { db } from './db';
import { normalizeText } from './normalize';
import { CATEGORIES, mapCategory } from './categories';

/** Un produs cu cel mai bun preț aplicabil (național sau din orașul cerut). */
export interface ProductHit {
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

interface RawRow {
  [key: string]: unknown;
}

function rowToHit(r: RawRow): ProductHit {
  return {
    id: Number(r.id),
    name: String(r.name),
    brand: (r.brand as string) ?? null,
    category: (r.category as string) ?? null,
    unitSize: (r.unit_size as string) ?? null,
    imageUrl: (r.image_url as string) ?? null,
    url: (r.url as string) ?? null,
    supermarketSlug: String(r.supermarket_slug),
    supermarketName: String(r.supermarket_name),
    price: Number(r.price),
    oldPrice: r.old_price != null ? Number(r.old_price) : null,
    pricePerUnit: r.price_per_unit != null ? Number(r.price_per_unit) : null,
    perUnit: (r.per_unit as string) ?? null,
    city: (r.city as string) ?? null,
    updatedAt: String(r.updated_at)
  };
}

/**
 * Caută produse după nume (toate cuvintele trebuie să apară) sau categorie.
 * `city` limitează prețurile la magazinele din oraș + prețurile naționale.
 * Pentru fiecare produs se păstrează cel mai mic preț aplicabil.
 */
export async function searchProducts(opts: {
  q?: string;
  category?: string;
  city?: string;
  supermarket?: string;
  limit?: number;
  /** true = doar potrivire pe nume (folosit la compararea coșului, ca un
   *  termen generic să nu fie „găsit” printr-un produs greșit din categorie) */
  strict?: boolean;
}): Promise<ProductHit[]> {
  const { q, category, city, supermarket, limit = 60, strict = false } = opts;

  const where: string[] = [];
  const args: (string | number)[] = [];
  // produsele potrivite pe nume înaintea celor potrivite doar pe categorie
  let rankExpr = '0';
  const rankArgs: string[] = [];

  if (q) {
    const tokens = normalizeText(q).split(' ').filter(Boolean);
    for (const t of tokens) {
      where.push(`p.normalized_name LIKE ?`);
      args.push(`%${t}%`);
    }
    if (!strict && tokens.length === 1) {
      // un singur cuvânt generic — acceptă și potrivirea pe categorie,
      // dar clasată după potrivirile directe pe nume
      const catSlug = mapCategory(q);
      if (catSlug !== 'altele') {
        where[where.length - 1] = `(p.normalized_name LIKE ? OR p.category = ?)`;
        args.push(catSlug);
        rankExpr = `CASE WHEN p.normalized_name LIKE ? THEN 0 ELSE 1 END`;
        rankArgs.push(`%${tokens[0]}%`);
      }
    }
  }
  if (category) {
    where.push(`p.category = ?`);
    args.push(category);
  }
  if (supermarket) {
    where.push(`s.slug = ?`);
    args.push(supermarket);
  }
  if (city) {
    where.push(`(pr.store_id = 0 OR st.city = ?)`);
    args.push(city);
  }

  const sql = `
    SELECT p.id, p.name, p.brand, p.category, p.unit_size, p.image_url, p.url,
           s.slug AS supermarket_slug, s.name AS supermarket_name,
           pr.price, pr.old_price, pr.price_per_unit, pr.per_unit, pr.updated_at,
           st.city, ${rankExpr} AS match_rank
    FROM products p
    JOIN supermarkets s ON s.id = p.supermarket_id
    JOIN prices pr ON pr.product_id = p.id
    LEFT JOIN stores st ON st.id = pr.store_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY match_rank ASC, pr.price ASC
    LIMIT 500`;

  const rs = await db().execute({ sql, args: [...rankArgs, ...args] });

  // păstrăm cel mai mic preț per produs
  const best = new Map<number, ProductHit>();
  for (const r of rs.rows as unknown as RawRow[]) {
    const id = Number(r.id);
    if (!best.has(id)) best.set(id, rowToHit(r));
  }
  return [...best.values()].slice(0, limit);
}

export interface BasketItem {
  query: string;
  qty: number;
}

export interface SupermarketComparison {
  slug: string;
  name: string;
  total: number;
  foundCount: number;
  items: Array<{
    query: string;
    qty: number;
    product: ProductHit | null;
    alternative: ProductHit | null;
  }>;
}

/**
 * Compară coșul între supermarketuri: pentru fiecare articol se alege cel mai
 * ieftin produs care se potrivește; articolele lipsă primesc, unde se poate,
 * o alternativă (potrivire mai laxă). Clasament: acoperire desc, apoi total asc.
 */
export async function compareBasket(items: BasketItem[], city?: string): Promise<SupermarketComparison[]> {
  const supermarkets = await db().execute(`SELECT id, slug, name FROM supermarkets ORDER BY name`);
  const results: SupermarketComparison[] = [];

  for (const sm of supermarkets.rows as unknown as Array<{ id: number; slug: string; name: string }>) {
    const comparison: SupermarketComparison = {
      slug: String(sm.slug),
      name: String(sm.name),
      total: 0,
      foundCount: 0,
      items: []
    };

    for (const item of items) {
      const qty = item.qty > 0 ? item.qty : 1;
      const hits = await searchProducts({ q: item.query, supermarket: String(sm.slug), city, limit: 1, strict: true });
      const product = hits[0] ?? null;

      let alternative: ProductHit | null = null;
      if (!product) {
        alternative = await findAlternative(item.query, String(sm.slug), city);
      } else {
        comparison.total += product.price * qty;
        comparison.foundCount++;
      }
      comparison.items.push({ query: item.query, qty, product, alternative });
    }

    comparison.total = Math.round(comparison.total * 100) / 100;
    results.push(comparison);
  }

  results.sort((a, b) => b.foundCount - a.foundCount || a.total - b.total);
  return results;
}

/** Potrivire laxă pentru sugestii: cel mai lung cuvânt, trunchiat (rădăcină). */
async function findAlternative(query: string, supermarket: string, city?: string): Promise<ProductHit | null> {
  const tokens = normalizeText(query).split(' ').filter((t) => t.length >= 3);
  if (tokens.length === 0) return null;
  const longest = tokens.sort((a, b) => b.length - a.length)[0];
  const stem = longest.slice(0, Math.max(4, longest.length - 2));
  const hits = await searchProducts({ q: stem, supermarket, city, limit: 1 });
  return hits[0] ?? null;
}

export async function getMeta(): Promise<{
  supermarkets: Array<{ slug: string; name: string; productCount: number }>;
  cities: string[];
  categories: Array<{ slug: string; label: string }>;
  lastUpdate: string | null;
}> {
  const client = db();
  const [sms, cities, lastUpdate] = await Promise.all([
    client.execute(
      `SELECT s.slug, s.name, COUNT(p.id) AS product_count
       FROM supermarkets s LEFT JOIN products p ON p.supermarket_id = s.id
       GROUP BY s.id ORDER BY s.name`
    ),
    client.execute(`SELECT DISTINCT city FROM stores ORDER BY city`),
    client.execute(`SELECT MAX(updated_at) AS m FROM prices`)
  ]);

  return {
    supermarkets: (sms.rows as unknown as Array<{ slug: string; name: string; product_count: number }>).map(
      (r) => ({ slug: String(r.slug), name: String(r.name), productCount: Number(r.product_count) })
    ),
    cities: (cities.rows as unknown as Array<{ city: string }>).map((r) => String(r.city)),
    categories: Object.entries(CATEGORIES).map(([slug, label]) => ({ slug, label })),
    lastUpdate: lastUpdate.rows[0]?.m ? String(lastUpdate.rows[0].m) : null
  };
}
