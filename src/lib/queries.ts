import { db } from './db';
import { normalizeText } from './normalize';
import { canonicalToken } from './matching';
import { CATEGORIES, mapCategory } from './categories';

/** Același produs într-un alt supermarket (din grupul de potrivire). */
export interface ProductOffer {
  productId: number;
  supermarketSlug: string;
  supermarketName: string;
  name: string;
  price: number;
  oldPrice: number | null;
  unitSize: string | null;
  city: string | null;
  url: string | null;
}

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
  /** grupul de produse identice între supermarketuri (null = negrupate) */
  matchGroupId: number | null;
  /** prețul aceluiași produs în fiecare supermarket unde a fost recunoscut */
  offers?: ProductOffer[];
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
    updatedAt: String(r.updated_at),
    matchGroupId: r.match_group_id != null ? Number(r.match_group_id) : null
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
  /** județ — prețurile din magazinele județului + prețurile naționale */
  county?: string;
  supermarket?: string;
  limit?: number;
  /** true = doar potrivire pe nume (folosit la compararea coșului, ca un
   *  termen generic să nu fie „găsit” printr-un produs greșit din categorie) */
  strict?: boolean;
  /** true = cuvintele se potrivesc ca prefixe („deterge” găsește „detergent”) —
   *  folosit la sugestiile de alternative */
  prefix?: boolean;
}): Promise<ProductHit[]> {
  const { q, category, city, county, supermarket, limit = 60, strict = false, prefix = false } = opts;

  const where: string[] = [];
  const args: (string | number)[] = [];
  let rankExpr = '0';
  const rankArgs: string[] = [];

  if (q) {
    const rawTokens = normalizeText(q).split(' ').filter(Boolean);
    // fiecare cuvânt din interogare are și o formă canonică (sinonime +
    // stemming — „dark” = „neagra”, „rosii” = „rosie”) care se potrivește
    // pe products.match_tokens; cuvintele de umplutură („cutie”, „de”)
    // nu restrâng căutarea dacă mai rămâne măcar un cuvânt cu sens
    let tokens = rawTokens.map((raw) => ({ raw, canon: canonicalToken(raw) ?? raw, ignorable: canonicalToken(raw) == null }));
    if (tokens.some((t) => !t.ignorable)) tokens = tokens.filter((t) => !t.ignorable);

    // potrivire pe CUVINTE întregi, nu substring — „oua” nu are voie să
    // se potrivească cu „Roua”; în modul prefix, cuvântul poate continua
    const wordMatch = `(instr(' ' || p.normalized_name || ' ', ?) > 0 OR instr(' ' || COALESCE(p.match_tokens, '') || ' ', ?) > 0)`;
    const prefixMatch = `((' ' || p.normalized_name) LIKE ? OR (' ' || COALESCE(p.match_tokens, '')) LIKE ?)`;
    for (const t of tokens) {
      where.push(prefix ? prefixMatch : wordMatch);
      if (prefix) args.push(`% ${t.raw}%`, `% ${t.canon}%`);
      else args.push(` ${t.raw} `, ` ${t.canon} `);
    }
    if (!strict && tokens.length === 1) {
      // un singur cuvânt generic — acceptă și potrivirea pe categorie,
      // dar clasată după potrivirile directe pe nume
      const catSlug = mapCategory(q);
      if (catSlug !== 'altele') {
        where[where.length - 1] = `(${prefix ? prefixMatch : wordMatch} OR p.category = ?)`;
        args.push(catSlug);
      }
    }

    // clasament: (1) categoria potrivită întâi — laptele de băut înaintea
    // laptelui pentru pisici; (2) cuvântul căutat cât mai devreme în nume —
    // „Lapte UHT” înaintea „Telemea din lapte”; (3) preț crescător.
    // Potrivirile doar prin sinonime (match_tokens) au instr()=0 pe nume →
    // sunt clasate după potrivirile directe, ceea ce e ordinea dorită.
    const catSlug = mapCategory(q);
    const posExprs = tokens.map(() => `instr(' ' || p.normalized_name || ' ', ?)`);
    const rawMinPos = posExprs.length > 1 ? `min(${posExprs.join(', ')})` : posExprs[0];
    // instr() = 0 înseamnă „nu apare” (potrivire pe categorie/sinonim) — ultimul loc, nu primul
    const minPos = `(CASE WHEN ${rawMinPos} = 0 THEN 9999 ELSE ${rawMinPos} END)`;
    const posArgs = tokens.map((t) => (prefix ? ` ${t.raw}` : ` ${t.raw} `));
    // minPos conține instr() de două ori (în CASE și în ELSE) — argumentele se dublează
    if (catSlug !== 'altele') {
      rankExpr = `(CASE WHEN p.category = ? THEN 0 ELSE 1 END) * 1000 + ${minPos}`;
      rankArgs.push(catSlug, ...posArgs, ...posArgs);
    } else {
      rankExpr = minPos;
      rankArgs.push(...posArgs, ...posArgs);
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
  if (county) {
    where.push(`(pr.store_id = 0 OR st.county = ?)`);
    args.push(county);
  }

  const sql = `
    SELECT p.id, p.name, p.brand, p.category, p.unit_size, p.image_url, p.url,
           p.match_group_id,
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

  let hits = [...best.values()];
  // fără filtru de supermarket, produsele recunoscute ca identice între
  // lanțuri se afișează o singură dată, cu prețul din fiecare lanț atașat
  if (!supermarket) {
    hits = await attachOffersAndDedupe(hits, { city, county });
  }
  return hits.slice(0, limit);
}

/**
 * Pentru rezultatele care au un grup de potrivire, aduce prețul aceluiași
 * produs din fiecare supermarket (respectând filtrul de județ/oraș) și
 * păstrează un singur card per grup — cel mai bine clasat.
 */
async function attachOffersAndDedupe(
  hits: ProductHit[],
  opts: { city?: string; county?: string }
): Promise<ProductHit[]> {
  const groupIds = [...new Set(hits.map((h) => h.matchGroupId).filter((g): g is number => g != null))];
  if (groupIds.length === 0) return hits;

  const where: string[] = [`p.match_group_id IN (${groupIds.map(() => '?').join(',')})`];
  const args: (string | number)[] = [...groupIds];
  if (opts.city) {
    where.push(`(pr.store_id = 0 OR st.city = ?)`);
    args.push(opts.city);
  }
  if (opts.county) {
    where.push(`(pr.store_id = 0 OR st.county = ?)`);
    args.push(opts.county);
  }

  const rs = await db().execute({
    sql: `SELECT p.id, p.match_group_id, p.name, p.unit_size, p.url,
                 s.slug AS supermarket_slug, s.name AS supermarket_name,
                 pr.price, pr.old_price, st.city
          FROM products p
          JOIN supermarkets s ON s.id = p.supermarket_id
          JOIN prices pr ON pr.product_id = p.id
          LEFT JOIN stores st ON st.id = pr.store_id
          WHERE ${where.join(' AND ')}
          ORDER BY pr.price ASC`,
    args
  });

  // cel mai mic preț per (grup, supermarket)
  const byGroup = new Map<number, Map<string, ProductOffer>>();
  for (const r of rs.rows as unknown as RawRow[]) {
    const group = Number(r.match_group_id);
    const slug = String(r.supermarket_slug);
    const perSm = byGroup.get(group) ?? byGroup.set(group, new Map()).get(group)!;
    if (!perSm.has(slug)) {
      perSm.set(slug, {
        productId: Number(r.id),
        supermarketSlug: slug,
        supermarketName: String(r.supermarket_name),
        name: String(r.name),
        price: Number(r.price),
        oldPrice: r.old_price != null ? Number(r.old_price) : null,
        unitSize: (r.unit_size as string) ?? null,
        city: (r.city as string) ?? null,
        url: (r.url as string) ?? null
      });
    }
  }

  const seenGroups = new Set<number>();
  const out: ProductHit[] = [];
  for (const hit of hits) {
    if (hit.matchGroupId == null) {
      out.push(hit);
      continue;
    }
    if (seenGroups.has(hit.matchGroupId)) continue;
    seenGroups.add(hit.matchGroupId);
    const offers = [...(byGroup.get(hit.matchGroupId)?.values() ?? [])].sort((a, b) => a.price - b.price);
    if (offers.length > 1) hit.offers = offers;
    out.push(hit);
  }
  return out;
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
export async function compareBasket(
  items: BasketItem[],
  opts: { city?: string; county?: string } = {}
): Promise<SupermarketComparison[]> {
  const { city, county } = opts;
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
      const hits = await searchProducts({
        q: item.query,
        supermarket: String(sm.slug),
        city,
        county,
        limit: 1,
        strict: true
      });
      const product = hits[0] ?? null;

      let alternative: ProductHit | null = null;
      if (!product) {
        alternative = await findAlternative(item.query, String(sm.slug), city, county);
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
async function findAlternative(
  query: string,
  supermarket: string,
  city?: string,
  county?: string
): Promise<ProductHit | null> {
  const tokens = normalizeText(query).split(' ').filter((t) => t.length >= 3);
  if (tokens.length === 0) return null;
  const longest = tokens.sort((a, b) => b.length - a.length)[0];
  const stem = longest.slice(0, Math.max(4, longest.length - 2));
  const hits = await searchProducts({ q: stem, supermarket, city, county, limit: 1, prefix: true });
  return hits[0] ?? null;
}

export async function getMeta(): Promise<{
  supermarkets: Array<{ slug: string; name: string; productCount: number }>;
  cities: string[];
  counties: string[];
  categories: Array<{ slug: string; label: string }>;
  lastUpdate: string | null;
}> {
  const client = db();
  const [sms, cities, counties, lastUpdate] = await Promise.all([
    client.execute(
      `SELECT s.slug, s.name, COUNT(p.id) AS product_count
       FROM supermarkets s LEFT JOIN products p ON p.supermarket_id = s.id
       GROUP BY s.id ORDER BY s.name`
    ),
    client.execute(`SELECT DISTINCT city FROM stores ORDER BY city`),
    client.execute(`SELECT DISTINCT county FROM stores WHERE county IS NOT NULL ORDER BY county`),
    client.execute(`SELECT MAX(updated_at) AS m FROM prices`)
  ]);

  return {
    supermarkets: (sms.rows as unknown as Array<{ slug: string; name: string; product_count: number }>).map(
      (r) => ({ slug: String(r.slug), name: String(r.name), productCount: Number(r.product_count) })
    ),
    cities: (cities.rows as unknown as Array<{ city: string }>).map((r) => String(r.city)),
    counties: (counties.rows as unknown as Array<{ county: string }>).map((r) => String(r.county)),
    categories: Object.entries(CATEGORIES).map(([slug, label]) => ({ slug, label })),
    lastUpdate: lastUpdate.rows[0]?.m ? String(lastUpdate.rows[0].m) : null
  };
}
