import type { Client, InStatement } from '@libsql/client';
import { db } from './db';
import { normalizeText } from './normalize';

/**
 * Legarea produselor ECHIVALENTE între supermarketuri (fără EAN — magazinele
 * nu publică coduri de bare, deci potrivirea e euristică dar conservatoare):
 *
 *  1. BLOCARE: candidații se compară doar în interiorul aceluiași bloc
 *     (marcă normalizată, unitate de bază, cantitate) — „Zuzu · l · 1”.
 *     Fără marcă sau fără gramaj nu se leagă nimic (prea riscant).
 *  2. SIMILARITATE: numele (fără marcă, fără cifre/unități de gramaj, fără
 *     cuvinte de legătură) trebuie să se suprapună — Jaccard ≥ 0.7, ca
 *     „Lapte UHT 1,5%” ↔ „Lapte UHT 1,5% grăsime” să treacă, dar
 *     „Lapte 1l” ↔ „Iaurt 1l” nu. Jaccard (nu coeficient de suprapunere!)
 *     ca un nume scurt să nu „înghită” variante cu multe cuvinte în plus
 *     („Barista”, „fără lactoză”). Procentele (1,5% ↔ 1.5%) se normalizează
 *     și trebuie să COINCIDĂ exact — 15% și 32% sunt produse diferite.
 *  3. Grupurile se construiesc cu union-find; doar grupurile care acoperă
 *     cel puțin două supermarketuri se salvează (restul nu ajută comparația).
 *
 * Rezultatul (product_links.group_id) e folosit de compararea coșului:
 * dacă articolul se potrivește cu un produs legat, în celelalte supermarketuri
 * se folosește EXACT același produs, nu o căutare textuală.
 */

// prag strict, calibrat pe date reale: la 0.5-0.6 variantele de aromă ale
// aceleiași mărci (Alpro soia/ovăz/migdale 1L) se înlănțuie tranzitiv într-un
// singur grup; 0.7 le separă și păstrează legăturile corecte (nume identice
// sau cu 1 cuvânt de umplutură în plus, gen „grăsime”)
const MIN_JACCARD = 0.7;

/** Cuvinte de legătură fără conținut — nu influențează echivalența. */
const STOPWORDS = new Set(['de', 'din', 'cu', 'si', 'la', 'pentru', 'pt', 'in', 'pe']);

interface LinkableProduct {
  id: number;
  supermarketId: number;
  brand: string;
  normalizedName: string;
  quantity: number;
  unit: string;
}

export async function linkProducts(
  client: Client = db()
): Promise<{ groups: number; linked: number }> {
  const rs = await client.execute(
    `SELECT id, supermarket_id, brand, normalized_name, quantity, unit
     FROM products
     WHERE brand IS NOT NULL AND brand != '' AND quantity IS NOT NULL AND unit IS NOT NULL`
  );
  const products: LinkableProduct[] = (rs.rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: Number(r.id),
    supermarketId: Number(r.supermarket_id),
    brand: String(r.brand),
    normalizedName: String(r.normalized_name),
    quantity: Number(r.quantity),
    unit: String(r.unit)
  }));

  // blocare pe (marcă fără spații, unitate, cantitate) — „la dorna” ≡ „ladorna”
  const blocks = new Map<string, LinkableProduct[]>();
  for (const p of products) {
    const key = `${brandKey(p.brand)}|${p.unit}|${p.quantity}`;
    const list = blocks.get(key);
    if (list) list.push(p);
    else blocks.set(key, [p]);
  }

  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r) as number;
    parent.set(x, r);
    return r;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb));
  };

  const tokenCache = new Map<number, Set<string>>();
  for (const block of blocks.values()) {
    if (block.length < 2) continue;
    for (let i = 0; i < block.length; i++) {
      for (let j = i + 1; j < block.length; j++) {
        const a = block[i];
        const b = block[j];
        // legăm doar între supermarketuri diferite — dublurile interne nu ajută
        if (a.supermarketId === b.supermarketId) continue;
        const ta = cachedTokens(tokenCache, a);
        const tb = cachedTokens(tokenCache, b);
        if (samePercents(ta, tb) && jaccard(ta, tb) >= MIN_JACCARD) {
          parent.set(a.id, parent.get(a.id) ?? a.id);
          parent.set(b.id, parent.get(b.id) ?? b.id);
          union(a.id, b.id);
        }
      }
    }
  }

  // păstrăm doar grupurile care acoperă cel puțin două supermarketuri
  const bySupermarket = new Map<number, number>(products.map((p) => [p.id, p.supermarketId]));
  const members = new Map<number, number[]>();
  for (const id of parent.keys()) {
    const root = find(id);
    const list = members.get(root);
    if (list) list.push(id);
    else members.set(root, [id]);
  }

  const statements: InStatement[] = [{ sql: `DELETE FROM product_links`, args: [] }];
  let groups = 0;
  let linked = 0;
  for (const [root, ids] of members) {
    const markets = new Set(ids.map((id) => bySupermarket.get(id)));
    if (ids.length < 2 || markets.size < 2) continue;
    groups++;
    for (const id of ids) {
      statements.push({
        sql: `INSERT INTO product_links (product_id, group_id, confidence) VALUES (?, ?, ?)`,
        args: [id, root, 1]
      });
      linked++;
    }
  }
  await client.batch(statements, 'write');
  return { groups, linked };
}

/** Marca redusă la o cheie stabilă: fără diacritice, spații sau punctuație. */
function brandKey(brand: string): string {
  return normalizeText(brand).replace(/[^a-z0-9]/g, '');
}

// cifre și gramaje, inclusiv lipite de unitate („1l”, „500ml”) și multipack
// („6x1,5l”, „20x2g”) — cantitatea e deja în cheia de blocare
const UNIT_TOKEN =
  /^(?:\d+(?:[.,]\d+)?(?:x\d+(?:[.,]\d+)?)?(?:kg|gr?|mg|ml|cl|l)?|kg|gr?|mg|ml|cl|l|litri|litru|buc(?:at[ăa]|[aă][tț]i)?|x|set|role)$/;

/**
 * Cuvintele relevante din nume: fără marcă (deja în cheia de blocare), fără
 * cifre/unități de gramaj (deja în cantitate+unitate) și fără cuvinte de
 * legătură. Procentele rămân, normalizate la punct („1,5%” → „1.5%”) —
 * conținutul de grăsime deosebește produsele.
 */
function nameTokens(p: LinkableProduct): Set<string> {
  const brandWords = new Set(normalizeText(p.brand).split(' ').filter(Boolean));
  const tokens = new Set<string>();
  for (const raw of p.normalizedName.split(' ')) {
    // virgulele/punctele de la margini sunt punctuație („alpro,” = „alpro”),
    // cele interioare sunt zecimale („1,5%”) și se normalizează la punct
    const clean = raw.replace(/^[.,]+|[.,]+$/g, '');
    const t = clean.endsWith('%') ? clean.replace(',', '.') : clean;
    if (!t || brandWords.has(t) || STOPWORDS.has(t) || UNIT_TOKEN.test(t)) continue;
    tokens.add(t);
  }
  return tokens;
}

/** Procentele (grăsime, alcool…) trebuie să coincidă exact între cele două nume. */
function samePercents(a: Set<string>, b: Set<string>): boolean {
  const pa = [...a].filter((t) => t.endsWith('%')).sort();
  const pb = [...b].filter((t) => t.endsWith('%')).sort();
  return pa.length === pb.length && pa.every((t, i) => t === pb[i]);
}

function cachedTokens(cache: Map<number, Set<string>>, p: LinkableProduct): Set<string> {
  let t = cache.get(p.id);
  if (!t) {
    t = nameTokens(p);
    cache.set(p.id, t);
  }
  return t;
}

/** Jaccard: |A∩B| / |A∪B|; seturi goale = identice (nume = doar marcă + gramaj). */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let common = 0;
  for (const t of a) if (b.has(t)) common++;
  return common / (a.size + b.size - common);
}
