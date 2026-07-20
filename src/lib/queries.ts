import { db } from './db';
import { normalizeText } from './normalize';
import { CATEGORIES, mapCategory } from './categories';

/**
 * Vechimea maximă (zile) a unui preț ca să mai fie afișat.
 * Ofertele săptămânale expiră; un preț nereîmprospătat de scraper
 * nu mai e de încredere. Configurabil prin PRICE_MAX_AGE_DAYS.
 */
export function priceMaxAgeDays(): number {
  const n = Number(process.env.PRICE_MAX_AGE_DAYS);
  return Number.isFinite(n) && n > 0 ? n : 14;
}

/**
 * Condiții SQL de prospețime pentru un rând din `prices` (alias `pr`):
 * valid_to depășit = ascuns (valid_to neparsabil → decide doar vechimea);
 * updated_at mai vechi decât pragul = ascuns.
 */
function freshnessWhere(where: string[], args: (string | number)[]): void {
  where.push(`(pr.valid_to IS NULL OR date(pr.valid_to) IS NULL OR date(pr.valid_to) >= date('now'))`);
  where.push(`pr.updated_at >= datetime('now', ?)`);
  args.push(`-${priceMaxAgeDays()} days`);
}

/** Un produs cu cel mai bun preț aplicabil (național sau din orașul cerut). */
export interface ProductHit {
  id: number;
  name: string;
  brand: string | null;
  category: string | null;
  unitSize: string | null;
  /** cantitatea în unitatea de bază (ex. 0.5 pentru "500 g") */
  quantity: number | null;
  /** unitatea de bază: kg, l sau buc */
  unit: string | null;
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
  /** rangul potrivirii textuale (mai mic = mai bun) — folosit la selecția din coș */
  matchRank: number;
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
    quantity: r.quantity != null ? Number(r.quantity) : null,
    unit: (r.unit as string) ?? null,
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
    matchRank: r.match_rank != null ? Number(r.match_rank) : 0
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

  const tokens = q ? normalizeText(q).split(' ').filter(Boolean) : [];
  if (q && tokens.length > 0) {
    // FTS5 (rapid, indexat) când există; altfel instr() (scanare completă).
    // Ambele potrivesc pe CUVINTE întregi, nu substring — „oua” nu are voie
    // să se potrivească cu „Roua”; în modul prefix, cuvântul poate continua.
    const useFts = await hasFts();
    const catSlug = mapCategory(q);
    // categoria e acceptată ca potrivire doar pentru un termen generic
    // de un cuvânt, clasată după potrivirile directe pe nume
    const allowCategoryMatch = !strict && tokens.length === 1 && catSlug !== 'altele';

    if (useFts) {
      // fiecare cuvânt e citat (tokenizer identic cu indexul); spațiu = AND
      const match = tokens.map((t) => `"${t}"${prefix ? '*' : ''}`).join(' ');
      const ftsCond = `p.id IN (SELECT rowid FROM products_fts WHERE products_fts MATCH ?)`;
      where.push(allowCategoryMatch ? `(${ftsCond} OR p.category = ?)` : ftsCond);
      args.push(match);
      if (allowCategoryMatch) args.push(catSlug);
    } else {
      const wordMatch = `instr(' ' || p.normalized_name || ' ', ?) > 0`;
      for (const t of tokens) {
        where.push(prefix ? `(' ' || p.normalized_name) LIKE ?` : wordMatch);
        args.push(prefix ? `% ${t}%` : ` ${t} `);
      }
      if (allowCategoryMatch) {
        where[where.length - 1] = `(${wordMatch} OR p.category = ?)`;
        args.push(catSlug);
      }
    }

    // clasament: (1) categoria potrivită întâi — laptele de băut înaintea
    // laptelui pentru pisici; (2) cuvântul căutat cât mai devreme în nume —
    // „Lapte UHT” înaintea „Telemea din lapte”; (3) preț crescător
    const posExprs = tokens.map(() => `instr(' ' || p.normalized_name || ' ', ?)`);
    const rawMinPos = posExprs.length > 1 ? `min(${posExprs.join(', ')})` : posExprs[0];
    // instr() = 0 înseamnă „nu apare” (potrivire doar pe categorie) — ultimul loc, nu primul
    const minPos = `(CASE WHEN ${rawMinPos} = 0 THEN 9999 ELSE ${rawMinPos} END)`;
    const posArgs = tokens.map((t) => (prefix ? ` ${t}` : ` ${t} `));
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
  freshnessWhere(where, args);

  // dedup ÎN SQL: un rând per produs = cel mai bun (rang, preț) — un LIMIT
  // aplicat înainte de dedup ar trunchia rezultatele la cataloage mari
  const sql = `
    SELECT * FROM (
      SELECT t.*, ROW_NUMBER() OVER (PARTITION BY t.id ORDER BY t.match_rank ASC, t.price ASC) AS rn
      FROM (
        SELECT p.id, p.name, p.brand, p.category, p.unit_size, p.quantity, p.unit, p.image_url, p.url,
               s.slug AS supermarket_slug, s.name AS supermarket_name,
               pr.price, pr.old_price, pr.price_per_unit, pr.per_unit, pr.updated_at,
               st.city, ${rankExpr} AS match_rank
        FROM products p
        JOIN supermarkets s ON s.id = p.supermarket_id
        JOIN prices pr ON pr.product_id = p.id
        LEFT JOIN stores st ON st.id = pr.store_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ) t
    )
    WHERE rn = 1
    ORDER BY match_rank ASC, price ASC
    LIMIT ?`;

  const rs = await db().execute({ sql, args: [...rankArgs, ...args, limit] });
  return (rs.rows as unknown as RawRow[]).map(rowToHit);
}

/** FTS5 e opțional (depinde de build-ul SQLite) — detectat o dată per proces. */
let ftsAvailable: boolean | null = null;
async function hasFts(): Promise<boolean> {
  if (ftsAvailable == null) {
    try {
      await db().execute(`SELECT count(*) FROM products_fts`);
      ftsAvailable = true;
    } catch {
      ftsAvailable = false;
    }
  }
  return ftsAvailable;
}

export interface BasketItem {
  query: string;
  qty: number;
}

export interface ComparisonItem {
  query: string;
  qty: number;
  product: ProductHit | null;
  alternative: ProductHit | null;
  /**
   * true = gramajul produsului diferă vizibil de cel potrivit în alte
   * supermarketuri (ex. 1 l vs 500 ml) — totalul NU e direct comparabil
   * pentru acest articol; UI-ul afișează avertisment + lei/unitate.
   */
  sizeMismatch?: boolean;
  /**
   * true = ACELAȘI produs (legat prin product_links: aceeași marcă + gramaj
   * + nume echivalent) ca cel de referință din alte supermarketuri —
   * comparația e exactă, nu doar textuală.
   */
  linked?: boolean;
}

export interface SupermarketComparison {
  slug: string;
  name: string;
  total: number;
  foundCount: number;
  items: ComparisonItem[];
}

/**
 * Compară coșul între supermarketuri. Pentru fiecare articol:
 *  - dintre potrivirile textuale de rang egal se alege produsul cu cel mai
 *    mic preț PE UNITATE (lei/kg, lei/l) — altfel un bax mic „bate” nedrept
 *    unul mare doar pentru că prețul de raft e mai mic;
 *  - unde căutarea textuală nu găsește nimic, dar produsul de referință e
 *    LEGAT (product_links) de un produs echivalent din acel supermarket
 *    (numit altfel acolo), se folosește exact produsul legat;
 *  - articolele lipsă primesc, unde se poate, o alternativă (potrivire laxă);
 *  - diferențele de gramaj între supermarketuri sunt marcate (sizeMismatch).
 * Clasament: acoperire desc, apoi total asc.
 */
export async function compareBasket(
  items: BasketItem[],
  opts: { city?: string; county?: string } = {}
): Promise<SupermarketComparison[]> {
  const { city, county } = opts;
  const supermarkets = await db().execute(`SELECT id, slug, name FROM supermarkets ORDER BY name`);

  // produsul de referință al fiecărui articol (căutare globală) + produsele
  // legate de el, pe supermarket — calculate O DATĂ, nu per supermarket
  const linkedByItem = await Promise.all(
    items.map(async (item) => {
      const globalHits = await searchProducts({ q: item.query, city, county, limit: 8, strict: true });
      const ref = pickBestValue(globalHits);
      return ref ? await getLinkedHits(ref.id, { city, county }) : new Map<string, ProductHit>();
    })
  );

  const results = await Promise.all(
    (supermarkets.rows as unknown as Array<{ id: number; slug: string; name: string }>).map(
      async (sm): Promise<SupermarketComparison> => {
        const slug = String(sm.slug);
        const comparison: SupermarketComparison = {
          slug,
          name: String(sm.name),
          total: 0,
          foundCount: 0,
          items: []
        };

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const qty = item.qty > 0 ? item.qty : 1;
          const hits = await searchProducts({
            q: item.query,
            supermarket: slug,
            city,
            county,
            limit: 8,
            strict: true
          });
          const viaLink = linkedByItem[i].get(slug) ?? null;
          const textBest = pickBestValue(hits);
          // textual întâi (respectă exact ce a cerut utilizatorul); legătura
          // acoperă cazul în care produsul există sub alt nume în magazin
          const product = textBest ?? viaLink;
          const linked = product != null && viaLink != null && product.id === viaLink.id;

          let alternative: ProductHit | null = null;
          if (!product) {
            alternative = await findAlternative(item.query, slug, city, county);
          } else {
            comparison.total += product.price * qty;
            comparison.foundCount++;
          }
          comparison.items.push({ query: item.query, qty, product, alternative, ...(linked ? { linked } : {}) });
        }

        comparison.total = Math.round(comparison.total * 100) / 100;
        return comparison;
      }
    )
  );

  markSizeMismatches(results, items.length);
  results.sort((a, b) => b.foundCount - a.foundCount || a.total - b.total);
  return results;
}

/**
 * Produsele din același grup de echivalență cu produsul dat (product_links),
 * cu cel mai mic preț „viu” aplicabil — cel mult unul per supermarket.
 */
export async function getLinkedHits(
  productId: number,
  opts: { city?: string; county?: string } = {}
): Promise<Map<string, ProductHit>> {
  const where: string[] = [
    `p.id IN (SELECT product_id FROM product_links
              WHERE group_id = (SELECT group_id FROM product_links WHERE product_id = ?))`
  ];
  const args: (string | number)[] = [productId];
  if (opts.city) {
    where.push(`(pr.store_id = 0 OR st.city = ?)`);
    args.push(opts.city);
  }
  if (opts.county) {
    where.push(`(pr.store_id = 0 OR st.county = ?)`);
    args.push(opts.county);
  }
  freshnessWhere(where, args);

  const sql = `
    SELECT * FROM (
      SELECT t.*, ROW_NUMBER() OVER (PARTITION BY t.id ORDER BY t.price ASC) AS rn
      FROM (
        SELECT p.id, p.name, p.brand, p.category, p.unit_size, p.quantity, p.unit, p.image_url, p.url,
               s.slug AS supermarket_slug, s.name AS supermarket_name,
               pr.price, pr.old_price, pr.price_per_unit, pr.per_unit, pr.updated_at,
               st.city, 0 AS match_rank
        FROM products p
        JOIN supermarkets s ON s.id = p.supermarket_id
        JOIN prices pr ON pr.product_id = p.id
        LEFT JOIN stores st ON st.id = pr.store_id
        WHERE ${where.join(' AND ')}
      ) t
    )
    WHERE rn = 1
    ORDER BY price ASC`;

  const rs = await db().execute({ sql, args });
  const bySlug = new Map<string, ProductHit>();
  for (const r of rs.rows as unknown as RawRow[]) {
    const hit = rowToHit(r);
    // rândurile vin ordonate după preț — primul per supermarket e cel mai ieftin
    if (!bySlug.has(hit.supermarketSlug)) bySlug.set(hit.supermarketSlug, hit);
  }
  return bySlug;
}

/**
 * Dintre potrivirile cu ACELAȘI rang textual ca prima (cea mai bună),
 * alege produsul cu cel mai mic preț pe unitate. Se compară doar produse cu
 * aceeași unitate de bază ca primul rezultat (lei/kg nu se compară cu lei/buc);
 * fără preț pe unitate rămâne prima potrivire (cel mai mic preț de raft).
 */
function pickBestValue(hits: ProductHit[]): ProductHit | null {
  const first = hits[0];
  if (!first) return null;
  const sameRank = hits.filter((h) => h.matchRank === first.matchRank);
  const refUnit = first.perUnit ?? sameRank.find((h) => h.perUnit)?.perUnit;
  if (!refUnit) return first;
  const comparable = sameRank.filter((h) => h.perUnit === refUnit && h.pricePerUnit != null);
  if (comparable.length === 0) return first;
  return comparable.reduce((best, h) => ((h.pricePerUnit as number) < (best.pricePerUnit as number) ? h : best));
}

/**
 * Marchează articolele al căror gramaj diferă cu >10% între supermarketuri
 * (aceeași unitate de bază) — totalurile nu sunt direct comparabile acolo.
 */
function markSizeMismatches(results: SupermarketComparison[], itemCount: number): void {
  for (let i = 0; i < itemCount; i++) {
    const matched = results
      .map((r) => r.items[i]?.product)
      .filter((p): p is ProductHit => p != null && p.quantity != null && p.unit != null);
    if (matched.length < 2) continue;
    const units = new Set(matched.map((p) => p.unit));
    const quantities = matched.map((p) => p.quantity as number);
    const mismatch =
      units.size > 1 || Math.max(...quantities) > Math.min(...quantities) * 1.1;
    if (!mismatch) continue;
    for (const r of results) {
      if (r.items[i]?.product) r.items[i].sizeMismatch = true;
    }
  }
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
    client.execute({
      // numărăm doar produsele cu cel puțin un preț „viu” — cele delistate
      // rămân în `products` (pentru istoric) dar nu se mai pot cumpăra
      sql: `SELECT s.slug, s.name, COUNT(DISTINCT pr.product_id) AS product_count
       FROM supermarkets s
       LEFT JOIN products p ON p.supermarket_id = s.id
       LEFT JOIN prices pr ON pr.product_id = p.id
         AND (pr.valid_to IS NULL OR date(pr.valid_to) IS NULL OR date(pr.valid_to) >= date('now'))
         AND pr.updated_at >= datetime('now', ?)
       GROUP BY s.id ORDER BY s.name`,
      args: [`-${priceMaxAgeDays()} days`]
    }),
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
