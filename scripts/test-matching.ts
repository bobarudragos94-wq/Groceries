import {
  canonicalTokens,
  extractSignature,
  groupProducts,
  matchScore,
  MATCH_THRESHOLD,
  type SignatureInput
} from '../src/lib/matching';

/**
 * Suită de acuratețe pentru potrivirea produselor între supermarketuri:
 *
 *   npm run test:matching
 *
 * Fiecare caz e o pereche de produse (așa cum le raportează două lanțuri
 * diferite) + verdictul așteptat. Iese cu cod 1 dacă orice caz pică —
 * rulați după orice modificare în src/lib/matching.ts.
 */

interface PairCase {
  why: string;
  a: SignatureInput;
  b: SignatureInput;
  expect: boolean;
}

const CASES: PairCase[] = [
  {
    why: 'ordinea cuvintelor nu contează (exemplul Auchan vs Lidl)',
    a: { name: 'Bucovina apa minerala naturala 2L' },
    b: { name: 'Apa minerala Bucovina 2 l' },
    expect: true
  },
  {
    why: 'sinonime RO/EN + cuvinte de ambalaj (exemplul Kinder)',
    a: { name: 'Ciocolata Kinder Bueno Dark' },
    b: { name: 'Tablete ciocolata neagra Kinder bueno' },
    expect: true
  },
  {
    why: 'cantitate diferită = produs diferit',
    a: { name: 'Lapte Zuzu 1L' },
    b: { name: 'Lapte Zuzu 500ml' },
    expect: false
  },
  {
    why: 'procent de grăsime diferit = produs diferit',
    a: { name: 'Lapte de consum Zuzu 1,5% 1L' },
    b: { name: 'Lapte Zuzu 3,5% 1L' },
    expect: false
  },
  {
    why: 'apă carbogazoasă ≠ apă plată, chiar la aceeași marcă',
    a: { name: 'Apa minerala carbogazoasa Borsec 1,5L' },
    b: { name: 'Apa minerala plata Borsec 1.5 l' },
    expect: false
  },
  {
    why: '„acidulată” = „carbogazoasă” (sinonime)',
    a: { name: 'Apa minerala acidulata Borsec 1.5L' },
    b: { name: 'Apa carbogazoasa Borsec 1,5 l' },
    expect: true
  },
  {
    why: 'mărci diferite nu se potrivesc niciodată',
    a: { name: 'Coca-Cola 2L' },
    b: { name: 'Pepsi cola 2l' },
    expect: false
  },
  {
    why: 'arome diferite ale aceleiași mărci = produse diferite',
    a: { name: 'Iaurt Danone cu capsuni 400g' },
    b: { name: 'Iaurt Danone cu piersici 400 g' },
    expect: false
  },
  {
    why: 'diacritice + singular/plural',
    a: { name: 'Roșii cherry 500g' },
    b: { name: 'rosii cherry 500 g' },
    expect: true
  },
  {
    why: 'nume scurt vs nume descriptiv, aceeași marcă și gramaj',
    a: { name: 'Crema de alune Nutella 400g' },
    b: { name: 'Nutella 400 g' },
    expect: true
  },
  {
    why: 'multipack echivalent cu volumul total',
    a: { name: 'Apa minerala Dorna 6x0,5l' },
    b: { name: 'Apa minerala Dorna 3l' },
    expect: true
  },
  {
    why: 'ciocolată albă în EN vs RO',
    a: { name: 'Ciocolata alba Milka 100g' },
    b: { name: 'Milka white chocolate 100 g' },
    expect: true
  },
  {
    why: 'pâine albă ≠ pâine neagră (variante, fără marcă)',
    a: { name: 'Paine alba feliata 500g' },
    b: { name: 'Paine neagra feliata 500g' },
    expect: false
  },
  {
    why: '„fara zahar” = „zero” (Cola)',
    a: { name: 'Coca-Cola Zero 2L' },
    b: { name: 'Bautura carbogazoasa Coca Cola fara zahar 2 l' },
    expect: true
  },
  {
    why: 'brandul raportat separat de magazin se recunoaște în numele celuilalt',
    a: { name: 'Iaurt natur 3,5% 400g', brand: 'Olympus' },
    b: { name: 'Olympus iaurt natur 3.5% 400 g' },
    expect: true
  },
  {
    why: 'bio ≠ non-bio, chiar cu nume altfel identice',
    a: { name: 'Lapte bio Zuzu 3,5% 1L' },
    b: { name: 'Lapte Zuzu 3,5% 1L' },
    expect: false
  }
];

let failed = 0;

for (const c of CASES) {
  const sa = extractSignature(c.a);
  const sb = extractSignature(c.b);
  const score = matchScore(sa, sb);
  const matched = score >= MATCH_THRESHOLD;
  const ok = matched === c.expect;
  if (!ok) failed++;
  console.log(
    `${ok ? '✔' : '✘'} [scor ${score.toFixed(2)}, așteptat ${c.expect ? '≥' : '<'}${MATCH_THRESHOLD}] ${c.why}` +
      (ok ? '' : `\n    A: ${c.a.name}\n    B: ${c.b.name}`)
  );
}

// gruparea: același produs în 3 lanțuri + un intrus care nu trebuie absorbit
const groupItems = [
  { id: 1, supermarketId: 1, sig: extractSignature({ name: 'Apa minerala Bucovina 2L' }) },
  { id: 2, supermarketId: 2, sig: extractSignature({ name: 'Bucovina apa minerala naturala 2 l' }) },
  { id: 3, supermarketId: 3, sig: extractSignature({ name: 'Apa Bucovina 2l', brand: 'Bucovina' }) },
  { id: 4, supermarketId: 1, sig: extractSignature({ name: 'Apa minerala Borsec 2L' }) }
];
const groups = groupProducts(groupItems);
const g1 = groups.get(1);
const groupOk = g1 != null && groups.get(2) === g1 && groups.get(3) === g1 && groups.get(4) == null;
if (!groupOk) failed++;
console.log(`${groupOk ? '✔' : '✘'} gruparea leagă cele 3 lanțuri și exclude intrusul (Borsec)`);

// invariant: un grup nu conține niciodată două produse din același supermarket
const withDup = [
  ...groupItems,
  { id: 5, supermarketId: 1, sig: extractSignature({ name: 'Apa minerala naturala Bucovina 2L' }) }
];
const groups2 = groupProducts(withDup);
const bySm = new Map<number, Set<number>>();
let invariantOk = true;
for (const [id, g] of groups2) {
  const sm = withDup.find((x) => x.id === id)!.supermarketId;
  const set = bySm.get(g) ?? bySm.set(g, new Set()).get(g)!;
  if (set.has(sm)) invariantOk = false;
  set.add(sm);
}
if (!invariantOk) failed++;
console.log(`${invariantOk ? '✔' : '✘'} invariant: cel mult un produs per supermarket într-un grup`);

// canonizarea interogării: „kinder dark” trebuie să producă „neagra”
const qTokens = canonicalTokens('tablete ciocolata kinder dark');
const queryOk = qTokens.includes('neagra') && qTokens.includes('kinder') && !qTokens.includes('tablete');
if (!queryOk) failed++;
console.log(`${queryOk ? '✔' : '✘'} interogarea se canonizează („dark”→„neagra”, „tablete” ignorat): ${qTokens.join(', ')}`);

const total = CASES.length + 3;
console.log(`\n${total - failed}/${total} cazuri trecute.`);
if (failed > 0) process.exit(1);
