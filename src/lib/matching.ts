/**
 * Recunoașterea produselor între supermarketuri (entity resolution):
 * „Bucovina Apă minerală 2L” (Auchan) și „Apă Bucovina 2 l” (Lidl) sunt
 * ACELAȘI produs și trebuie grupate; „Kinder Bueno Dark” și „Tablete
 * ciocolată neagră Kinder” la fel.
 *
 * Abordare deterministă, fără servicii externe (rulează și în GitHub Actions
 * și în API-ul serverless):
 *   1. semnătură per produs: marcă (lexicon + brandul raportat de magazin),
 *      cuvinte canonice (sinonime RO/EN + stemming ușor, fără ambalaj/umplutură),
 *      markeri de variantă (neagră/albă, carbogazoasă/plată, zero…),
 *      procente (grăsime, cacao) și cantitatea în unitatea de bază;
 *   2. scor de similaritate cu PORȚI DURE (cantitate/marcă/variantă/procent
 *      diferite = nu e același produs) + Jaccard ponderat pe cuvinte;
 *   3. grupare greedy (cel mai bun scor primul), cu cel mult un produs
 *      per supermarket într-un grup — precizia înaintea acoperirii.
 */

import { normalizeText, parseUnitSize } from './normalize';

export interface SignatureInput {
  name: string;
  brand?: string | null;
  category?: string | null;
  /** cantitatea în unitatea de bază (kg/l/buc), dacă e deja parsată */
  quantity?: number | null;
  unit?: string | null;
}

export interface ProductSignature {
  /** mărci detectate (formă canonică) — din lexicon sau raportate de magazin */
  brands: Set<string>;
  /** toate cuvintele canonice purtătoare de sens (inclusiv variantele) */
  descriptors: Set<string>;
  /** markeri de variantă care TREBUIE să coincidă exact între produse */
  variants: Set<string>;
  /** procente din nume (grăsime lapte, cacao…) */
  percents: Set<number>;
  quantity: number | null;
  unit: string | null;
  category: string | null;
}

/** Sub acest scor două produse NU sunt considerate același produs. */
export const MATCH_THRESHOLD = 0.6;

// ---------------------------------------------------------------------------
// Lexicoane
// ---------------------------------------------------------------------------

/** Cuvinte de legătură/umplutură — nu deosebesc produsele. */
const STOPWORDS = new Set([
  'de', 'cu', 'la', 'pentru', 'din', 'si', 'sau', 'in', 'pe', 'fara', 'per',
  'un', 'o', 'the', 'cel', 'cea', 'mai', 'tip', 'gama', 'sortiment', 'sortimente',
  'diverse', 'asortate', 'aprox', 'cca', 'nr', 'buc', 'plus'
]);

/** Cuvinte de ambalaj — „tablete”, „PET”, „cutie” nu schimbă produsul. */
const PACKAGING = new Set([
  'tableta', 'tablete', 'cutie', 'cutii', 'pet', 'sticla', 'sticle', 'doza',
  'doze', 'punga', 'pungi', 'pachet', 'pachete', 'bax', 'folie', 'caserola',
  'borcan', 'flacon', 'tub', 'plic', 'plicuri', 'vrac', 'rezerva', 'navete',
  'membrana', 'vid', 'ambalat', 'ambalata', 'preambalat'
]);

/** Unități de măsură singure („kg”, „l”) — cantitatea se compară numeric. */
const UNIT_WORDS = new Set([
  'kg', 'g', 'gr', 'mg', 'ml', 'cl', 'l', 'litri', 'litru', 'bucata', 'bucati',
  'gram', 'grame', 'kilogram', 'x'
]);

/**
 * Sinonime → forma canonică. Valorile sunt deja în formă FINALĂ
 * (canonizată/stemuită) — nu se mai aplică stem() peste ele.
 * Acoperă și denumirile EN folosite pe ambalaje („dark”, „white”, „milk”).
 */
const SYNONYMS: Record<string, string> = {
  // variante de culoare/tip ciocolată, pâine etc.
  neagra: 'neagra', negre: 'neagra', negru: 'neagra', dark: 'neagra',
  amaruie: 'neagra', black: 'neagra',
  alba: 'alba', albe: 'alba', alb: 'alba', albi: 'alba', white: 'alba',
  // apă
  carbogazoasa: 'carbogazoasa', carbogazoas: 'carbogazoasa',
  acidulata: 'carbogazoasa', gazoasa: 'carbogazoasa', sparkling: 'carbogazoasa',
  necarbogazoasa: 'necarbogazoasa', necarbogazoas: 'necarbogazoasa',
  plata: 'necarbogazoasa', still: 'necarbogazoasa',
  // fără zahăr
  zero: 'zero', sugarfree: 'zero', dietetic: 'zero',
  // traduceri EN frecvente pe ambalaje (valoarea = forma stemuită a cuvântului RO)
  milk: 'lapt', water: 'apa', juice: 'suc', cheese: 'branz',
  chocolate: 'ciocolat', choco: 'ciocolat', cioco: 'ciocolat',
  yogurt: 'iaurt', yoghurt: 'iaurt', yaourt: 'iaurt', iaurt: 'iaurt',
  eggs: 'ou', oua: 'ou', egg: 'ou',
  bread: 'pain', coffee: 'cafea', tea: 'ceai', beer: 'bere', wine: 'vin',
  strawberry: 'capsun', cherry: 'cherry', vanilla: 'vanilie', vanilie: 'vanilie',
  // alte echivalențe RO
  iute: 'picant', hot: 'picant', spicy: 'picant',
  eco: 'bio', organic: 'bio', ecologic: 'bio',
  smoked: 'afumat',
  light: 'light', lejer: 'light',
  decaf: 'decofeinizat', decofeinizata: 'decofeinizat'
};

/**
 * Markeri de variantă: dacă seturile diferă între două produse, NU e același
 * produs („ciocolată neagră” ≠ „ciocolată albă”, „apă plată” ≠ „carbogazoasă”,
 * „lapte bio” ≠ „lapte” simplu). Forme canonice finale.
 */
const VARIANT_TOKENS = new Set([
  'neagra', 'alba', 'carbogazoasa', 'necarbogazoasa', 'zero', 'light', 'bio',
  'integral', 'degresat', 'semidegresat', 'picant', 'afumat', 'decofeinizat',
  'vegan', 'fara_lactoza', 'fara_gluten'
]);

/** Cuvinte cu informație slabă — pondere mică în similaritate. */
const LOW_INFO = new Set([
  'mineral', 'natural', 'proaspat', 'clasic', 'original', 'traditional',
  'extra', 'premium', 'superior', 'fin', 'delicios', 'gustos', 'specialitat',
  'calitat', 'aliment', 'produs', 'veritabil', 'autentic', 'bautur', 'racoritoar'
]);

/**
 * Lexicon de mărci uzuale în supermarketurile românești (forme normalizate,
 * fără diacritice). Frazele multi-cuvânt sunt detectate întregi.
 * Mărcile din lexicon NU se stemuiesc — rămân stabile pentru căutare.
 */
const BRAND_PHRASES: string[] = [
  // apă & băuturi
  'bucovina', 'borsec', 'aqua carpatica', 'dorna', 'izvorul minunilor',
  'perla harghitei', 'biborteni', 'lipova', 'bilbor', 'carpatina', 'baile lipova',
  'coca cola', 'pepsi', 'fanta', 'sprite', 'mirinda', '7up', 'schweppes',
  'prigat', 'cappy', 'tedi', 'santal', 'granini', 'tymbark', 'fuzetea',
  'lipton', 'red bull', 'monster', 'burn', 'hell', 'ciucas',
  'ursus', 'timisoreana', 'ciuc', 'silva', 'bergenbier', 'becks', 'heineken',
  'tuborg', 'carlsberg', 'skol', 'noroc', 'neumarkt', 'stella artois',
  'corona', 'staropramen', 'peroni', 'zaganu',
  'jacobs', 'lavazza', 'tchibo', 'doncafe', 'fortuna', 'nescafe', 'illy',
  'davidoff', 'amigo', 'segafredo',
  // dulciuri & snacks
  'kinder', 'ferrero', 'nutella', 'raffaello', 'milka', 'heidi', 'poiana',
  'rom', 'kandia', 'mars', 'snickers', 'twix', 'bounty', 'kitkat', 'lion',
  'oreo', 'toblerone', 'merci', 'lindt', 'anidor', 'primola', 'novatini',
  'haribo', 'mentos', 'orbit', 'airwaves', 'tic tac',
  'lays', 'chio', 'pringles', 'star', 'krax', 'croco', 'viva', 'salatini',
  'eugenia', 'ulpio', 'rostar', 'belvita', 'tuc', 'dr gerard', 'alka',
  // lactate & ouă
  'napolact', 'zuzu', 'fulga', 'milli', 'olympus', 'danone', 'activia',
  'actimel', 'danonino', 'muller', 'zott', 'monte', 'hochland', 'delaco',
  'covalact', 'albalact', 'president', 'philadelphia', 'la dorna', 'artesana',
  'cedra', 'hoplala', 'toneli', 'matines', 'zizin',
  // de bază / conserve / sosuri
  'baneasa', 'boromir', 'dobrogea', 'pambac', 'arpis', 'lemnia',
  'floriol', 'unisol', 'spornic', 'untdelemn de la bunica', 'bunica',
  'margaritar', 'coronita', 'agrana', 'sanovita', 'carrefour',
  'barilla', 'panzani', 'riso scotti', 'deroni', 'ario', 'gallo',
  'heinz', 'hellmanns', 'knorr', 'maggi', 'univer', 'olympia', 'regal',
  'bonduelle', 'hame', 'sadu', 'mandy', 'raureni', 'topoloveni', 'scandia',
  'bunatati de la raureni', 'delikat', 'vegeta', 'fuchs', 'kotanyi', 'kamis',
  // carne & mezeluri
  'caroli', 'cris tim', 'campofrio', 'matache macelaru', 'fox', 'agricola',
  'transavia', 'fragedo', 'aaylex', 'cocorico', 'meda', 'diana', 'elit',
  'unicarm', 'reinert', 'aldis',
  // congelate & înghețată
  'edenia', 'frosta', 'findus', 'corso', 'aloma', 'betty ice', 'napoca',
  'magnum', 'algida', 'joe', 'nirvana',
  // cereale & mic dejun
  'nestle', 'kelloggs', 'musli', 'vitalis', 'milupa', 'nestea',
  // menaj & îngrijire
  'ariel', 'persil', 'tide', 'bonux', 'rex', 'lenor', 'coccolino', 'fairy',
  'pur', 'domestos', 'cif', 'mr proper', 'sanytol', 'dero', 'savex', 'perwoll',
  'zewa', 'pufina', 'motto', 'regina', 'libresse', 'always', 'pampers',
  'colgate', 'blend a med', 'parodontax', 'sensodyne', 'oral b', 'aquafresh',
  'nivea', 'dove', 'rexona', 'fa', 'palmolive', 'head shoulders', 'pantene',
  'garnier', 'loreal', 'schauma', 'gerovital', 'elmiplant', 'farmec',
  // mărci proprii de lanț (nu se potrivesc între lanțuri, dar stabilizează căutarea)
  'pilos', 'milbona', 'cien', 'freeway', 'solevita', 'alesto', 'deluxe',
  'chef select', 'crownfield', 'combino', 'vitasia', 'lupilu', 'silvercrest',
  'k classic', 'k bio', 'k take it veggie', 'penny ready', 'karamela',
  'auchan bio', 'pouce', 'inextenso'
];

// frazele mai lungi întâi, ca „aqua carpatica” să câștige înaintea „carpatica”
const BRANDS_SORTED = [...BRAND_PHRASES].sort(
  (a, b) => b.split(' ').length - a.split(' ').length || b.length - a.length
);
/** toate cuvintele care apar în lexicon — nu se stemuiesc niciodată */
const BRAND_TOKENS = new Set(BRANDS_SORTED.flatMap((p) => p.split(' ')));

// ---------------------------------------------------------------------------
// Canonizare cuvinte
// ---------------------------------------------------------------------------

/**
 * Stemmer ușor pentru română: taie sufixele de plural/articol ca
 * „roșii/roșie” → „rosi”, „căpșuni/căpșune” → „capsun”. Conservator —
 * se aplică identic pe ambele părți, deci ușoara supra-tăiere nu strică.
 */
function stem(t: string): string {
  if (t.length <= 4) return t;
  for (const suf of ['urilor', 'urile', 'ului', 'elor', 'ilor', 'iile', 'uri', 'ele', 'ul', 'le', 'ii', 'i', 'e', 'a']) {
    if (t.endsWith(suf) && t.length - suf.length >= 4) return t.slice(0, -suf.length);
  }
  return t;
}

/**
 * Sparge un text normalizat în cuvinte brute pentru potrivire:
 * desparte cratimele dintre litere („coca-cola”), unifică virgula zecimală,
 * lipește procentul de număr („3,5 %” → „3.5%”).
 */
function rawTokens(text: string): string[] {
  return normalizeText(text)
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/(\d)\s*%/g, '$1% ')
    .replace(/([a-z])-(?=[a-z])/g, '$1 ')
    .replace(/[,/+]/g, ' ')
    .replace(/(?<![0-9])\.|\.(?![0-9])/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** „fara zahar”/„zero zahar” → „zero”; „fara lactoza” → „fara_lactoza” etc. */
function joinBigrams(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1];
    if ((t === 'fara' || t === 'zero') && next) {
      if (/^zahar/.test(next)) { out.push('zero'); i++; continue; }
      if (/^lactoz/.test(next)) { out.push('fara_lactoza'); i++; continue; }
      if (/^gluten/.test(next)) { out.push('fara_gluten'); i++; continue; }
    }
    // „băutură carbogazoasă/răcoritoare” e numele generic al sucurilor —
    // NU varianta de apă; markerul se aruncă, rămâne doar „băutură”
    if ((t === 'bautura' || t === 'bauturi') && next && /^(ne)?(carbogazoas|racoritoar)/.test(next)) {
      out.push(t);
      i++;
      continue;
    }
    out.push(t);
  }
  return out;
}

/**
 * Forma canonică a unui cuvânt de căutare/potrivire, sau null dacă e
 * ignorabil (umplutură, ambalaj, cantitate — tratate separat).
 */
export function canonicalToken(raw: string): string | null {
  const t = raw;
  if (!t || STOPWORDS.has(t) || PACKAGING.has(t) || UNIT_WORDS.has(t)) return null;
  if (/^\d+(\.\d+)?%$/.test(t)) return t; // procentele rămân („3.5%”)
  if (/^\d/.test(t)) return null; // numere/cantități — comparate numeric
  if (SYNONYMS[t]) return SYNONYMS[t];
  if (BRAND_TOKENS.has(t)) return t;
  const s = stem(t);
  return SYNONYMS[s] ?? s;
}

/** Toate cuvintele canonice dintr-un text liber (ex. interogarea userului). */
export function canonicalTokens(text: string): string[] {
  const out: string[] = [];
  for (const t of joinBigrams(rawTokens(text))) {
    const c = canonicalToken(t);
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Semnătura produsului
// ---------------------------------------------------------------------------

/** Detectează frazele de marcă din lexicon prezente în șirul de cuvinte. */
function detectBrands(tokens: string[]): { phrases: string[]; tokenSet: Set<string> } {
  const padded = ` ${tokens.join(' ')} `;
  const phrases: string[] = [];
  const tokenSet = new Set<string>();
  for (const phrase of BRANDS_SORTED) {
    if (padded.includes(` ${phrase} `)) {
      // frazele conținute într-una deja găsită nu se adaugă separat
      if (!phrases.some((p) => ` ${p} `.includes(` ${phrase} `))) phrases.push(phrase);
      for (const t of phrase.split(' ')) tokenSet.add(t);
    }
  }
  return { phrases, tokenSet };
}

/** Construiește semnătura de potrivire a unui produs. */
export function extractSignature(input: SignatureInput): ProductSignature {
  const nameTokens = joinBigrams(rawTokens(input.name));
  const brandInfo = detectBrands(nameTokens);

  const brands = new Set<string>();
  const descriptors = new Set<string>();
  const variants = new Set<string>();
  const percents = new Set<number>();

  // marca raportată de magazin (poate lipsi din nume)
  const reportedBrandTokens = new Set<string>();
  if (input.brand) {
    for (const t of rawTokens(input.brand)) {
      reportedBrandTokens.add(t);
      const c = canonicalToken(t);
      if (c) brands.add(c);
    }
  }

  for (const t of nameTokens) {
    const pct = t.match(/^(\d+(?:\.\d+)?)%$/);
    if (pct) percents.add(parseFloat(pct[1]));
    const c = canonicalToken(t);
    if (!c) continue;
    if (brandInfo.tokenSet.has(t) || reportedBrandTokens.has(t)) {
      brands.add(c);
    } else {
      descriptors.add(c);
      if (VARIANT_TOKENS.has(c)) variants.add(c);
    }
  }

  const parsed = input.quantity != null && input.unit ? null : parseUnitSize(input.name);
  return {
    brands,
    descriptors,
    variants,
    percents,
    quantity: input.quantity ?? parsed?.quantity ?? null,
    unit: input.unit ?? parsed?.unit ?? null,
    category: input.category ?? null
  };
}

/**
 * Cuvintele canonice ale produsului pentru indexul de căutare
 * (coloana products.match_tokens): marcă + descriptori + variante + procente,
 * sortate — interogarea canonizată se potrivește pe cuvinte întregi.
 */
export function buildMatchTokens(sig: ProductSignature): string {
  const all = new Set<string>([...sig.brands, ...sig.descriptors]);
  for (const p of sig.percents) all.add(`${p}%`);
  return [...all].sort().join(' ');
}

// ---------------------------------------------------------------------------
// Scorul de potrivire
// ---------------------------------------------------------------------------

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function weightOf(t: string): number {
  return LOW_INFO.has(t) ? 0.35 : 1;
}

function weightedJaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  let union = 0;
  for (const t of a) {
    const w = weightOf(t);
    union += w;
    if (b.has(t)) inter += w;
  }
  for (const t of b) if (!a.has(t)) union += weightOf(t);
  return union > 0 ? inter / union : 0;
}

/**
 * Scorul că două semnături descriu ACELAȘI produs, 0..1.
 * Porți dure (return 0): cantitate diferită, procent diferit, variantă
 * diferită, mărci cunoscute și diferite. Apoi Jaccard ponderat pe cuvinte
 * + bonus de marcă comună; categoria diferită penalizează.
 */
export function matchScore(a: ProductSignature, b: ProductSignature): number {
  // cantități incompatibile → produse diferite (1L ≠ 500ml)
  if (a.quantity != null && b.quantity != null && a.unit && b.unit) {
    if (a.unit !== b.unit) return 0;
    const rel = Math.abs(a.quantity - b.quantity) / Math.max(a.quantity, b.quantity);
    if (rel > 0.05) return 0;
  }
  // procente diferite (grăsime lapte, % cacao) → produse diferite
  if (a.percents.size && b.percents.size && !setsEqual(a.percents, b.percents)) return 0;
  // markerii de variantă trebuie să coincidă exact
  if (!setsEqual(a.variants, b.variants)) return 0;

  // marcă: dacă ambele părți au marcă detectată, se compară direct
  // (altfel „cola” din „Pepsi cola” s-ar confunda cu marca „Coca-Cola”);
  // doar când o parte nu are marcă o căutăm în cuvintele celeilalte
  let brandOverlap: boolean;
  if (a.brands.size && b.brands.size) {
    brandOverlap = [...a.brands].some((t) => b.brands.has(t));
    if (!brandOverlap) return 0;
  } else {
    brandOverlap =
      [...a.brands].some((t) => b.descriptors.has(t)) ||
      [...b.brands].some((t) => a.descriptors.has(t));
  }

  // pentru similaritate, cuvintele de marcă nu se numără ca descriptori
  const descA = new Set([...a.descriptors].filter((t) => !a.brands.has(t) && !b.brands.has(t)));
  const descB = new Set([...b.descriptors].filter((t) => !a.brands.has(t) && !b.brands.has(t)));

  let base: number;
  if (descA.size === 0 && descB.size === 0) {
    base = brandOverlap ? 1 : 0; // ex. „Nutella 400g” vs „Nutella 400 g”
  } else if (descA.size === 0 || descB.size === 0) {
    base = brandOverlap ? 0.6 : 0.15; // „Nutella” vs „Nutella cremă de alune”
  } else {
    base = weightedJaccard(descA, descB);
  }

  let score = base * 0.85 + (brandOverlap ? 0.15 : 0);
  if (a.category && b.category && a.category !== 'altele' && b.category !== 'altele' && a.category !== b.category) {
    score -= 0.2;
  }
  return Math.max(0, Math.min(1, score));
}

// ---------------------------------------------------------------------------
// Gruparea între supermarketuri
// ---------------------------------------------------------------------------

export interface GroupInput {
  id: number;
  supermarketId: number;
  sig: ProductSignature;
}

/** peste acest număr de produse un cuvânt e prea comun pentru blocking */
const MAX_TOKEN_DF = 400;
/** peste această mărime un bloc de marcă nu se mai împerechează integral */
const MAX_BRAND_BLOCK = 600;

/**
 * Grupează produsele care sunt același articol în lanțuri diferite.
 * Returnează productId → groupId (id-ul minim din grup); produsele
 * negrupate lipsesc din hartă. Garanție: cel mult un produs per
 * supermarket într-un grup (altfel „găsim” dubluri, nu echivalențe).
 */
export function groupProducts(items: GroupInput[], threshold = MATCH_THRESHOLD): Map<number, number> {
  const n = items.length;

  // 1. generarea candidaților (blocking): aceeași marcă SAU ≥2 descriptori comuni
  const pairShared = new Map<number, number>(); // cheia i*n+j (i<j) → nr. descriptori comuni
  const candidate = new Set<number>();

  const addPair = (i: number, j: number): number => (i < j ? i * n + j : j * n + i);

  const byBrand = new Map<string, number[]>();
  const byDesc = new Map<string, number[]>();
  items.forEach((it, i) => {
    for (const b of it.sig.brands) (byBrand.get(b) ?? byBrand.set(b, []).get(b)!).push(i);
    for (const d of it.sig.descriptors) (byDesc.get(d) ?? byDesc.set(d, []).get(d)!).push(i);
  });

  for (const idxs of byBrand.values()) {
    if (idxs.length > MAX_BRAND_BLOCK) continue; // marcă de lanț uriașă — rămân descriptorii
    for (let x = 0; x < idxs.length; x++) {
      for (let y = x + 1; y < idxs.length; y++) {
        if (items[idxs[x]].supermarketId !== items[idxs[y]].supermarketId) {
          candidate.add(addPair(idxs[x], idxs[y]));
        }
      }
    }
  }
  for (const idxs of byDesc.values()) {
    if (idxs.length > MAX_TOKEN_DF) continue; // „lapte”, „ciocolată” — prea comune singure
    for (let x = 0; x < idxs.length; x++) {
      for (let y = x + 1; y < idxs.length; y++) {
        if (items[idxs[x]].supermarketId === items[idxs[y]].supermarketId) continue;
        const key = addPair(idxs[x], idxs[y]);
        const c = (pairShared.get(key) ?? 0) + 1;
        pairShared.set(key, c);
        if (c >= 2) candidate.add(key);
      }
    }
  }

  // 2. scorurile perechilor candidate
  const edges: Array<{ i: number; j: number; score: number }> = [];
  for (const key of candidate) {
    const i = Math.floor(key / n);
    const j = key % n;
    const score = matchScore(items[i].sig, items[j].sig);
    if (score >= threshold) edges.push({ i, j, score });
  }
  edges.sort((a, b) => b.score - a.score);

  // 3. union-find greedy: cel mai sigur scor primul; un grup nu poate
  //    conține două produse din același supermarket
  const parent = items.map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const superms = new Map<number, Set<number>>();
  items.forEach((it, i) => superms.set(i, new Set([it.supermarketId])));

  for (const { i, j } of edges) {
    const ri = find(i);
    const rj = find(j);
    if (ri === rj) continue;
    const si = superms.get(ri)!;
    const sj = superms.get(rj)!;
    let disjoint = true;
    for (const s of si) if (sj.has(s)) { disjoint = false; break; }
    if (!disjoint) continue;
    parent[rj] = ri;
    for (const s of sj) si.add(s);
    superms.delete(rj);
  }

  // 4. id-ul de grup = cel mai mic id de produs din componentă (stabil)
  const members = new Map<number, number[]>();
  items.forEach((_, i) => {
    const r = find(i);
    (members.get(r) ?? members.set(r, []).get(r)!).push(i);
  });

  const result = new Map<number, number>();
  for (const idxs of members.values()) {
    if (idxs.length < 2) continue;
    const groupId = Math.min(...idxs.map((i) => items[i].id));
    for (const i of idxs) result.set(items[i].id, groupId);
  }
  return result;
}
