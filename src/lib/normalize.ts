/**
 * Normalizare text, unități de măsură și categorii.
 * Folosit atât de scraper (la import) cât și de API (la căutare),
 * ca ambele părți să vorbească aceeași limbă.
 */

/** Elimină diacriticele și pune totul pe litere mici: "Roșii" -> "rosii". */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ș|ş/g, 's')
    .replace(/ț|ţ/g, 't')
    .toLowerCase()
    .replace(/[^a-z0-9%,./+-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type BaseUnit = 'kg' | 'l' | 'buc';

export interface ParsedUnit {
  /** cantitatea în unitatea de bază (kg, l sau buc) */
  quantity: number;
  unit: BaseUnit;
}

const UNIT_FACTORS: Record<string, { unit: BaseUnit; factor: number }> = {
  kg: { unit: 'kg', factor: 1 },
  g: { unit: 'kg', factor: 0.001 },
  gr: { unit: 'kg', factor: 0.001 },
  mg: { unit: 'kg', factor: 0.000001 },
  l: { unit: 'l', factor: 1 },
  litri: { unit: 'l', factor: 1 },
  litru: { unit: 'l', factor: 1 },
  ml: { unit: 'l', factor: 0.001 },
  cl: { unit: 'l', factor: 0.01 },
  buc: { unit: 'buc', factor: 1 },
  bucati: { unit: 'buc', factor: 1 },
  bucata: { unit: 'buc', factor: 1 },
  set: { unit: 'buc', factor: 1 },
  role: { unit: 'buc', factor: 1 },
  oua: { unit: 'buc', factor: 1 }
};

const NUM = String.raw`(\d+(?:[.,]\d+)?)`;
const UNIT_WORD = String.raw`(kg|gr?|mg|ml|cl|l|litri|litru|buc(?:at[ăa]|[aă][tț]i)?|set|role|ou[aă])`;

/**
 * Extrage cantitatea și unitatea dintr-un text de ambalaj:
 *  "1 L" -> 1 l | "500g" -> 0.5 kg | "6x1,5l" -> 9 l | "10 buc" -> 10 buc
 * Returnează null dacă nu recunoaște formatul.
 */
export function parseUnitSize(text: string | null | undefined): ParsedUnit | null {
  if (!text) return null;
  const t = normalizeText(text);

  // multipack: "6x1,5l", "4 x 100 g"
  const multi = t.match(new RegExp(String.raw`(\d+)\s*x\s*${NUM}\s*${UNIT_WORD}\b`));
  if (multi) {
    const info = UNIT_FACTORS[canonicalUnitWord(multi[3])];
    if (info) {
      return { quantity: round3(parseInt(multi[1], 10) * parseNum(multi[2]) * info.factor), unit: info.unit };
    }
  }

  const single = t.match(new RegExp(String.raw`${NUM}\s*${UNIT_WORD}\b`));
  if (single) {
    const info = UNIT_FACTORS[canonicalUnitWord(single[2])];
    if (info) {
      return { quantity: round3(parseNum(single[1]) * info.factor), unit: info.unit };
    }
  }

  // "bucata", "la bucata" fără număr
  if (/\bbuc(ata)?\b/.test(t)) return { quantity: 1, unit: 'buc' };
  return null;
}

/** Prețul pe unitatea de bază (lei/kg, lei/l, lei/buc). */
export function pricePerUnit(price: number, parsed: ParsedUnit | null): { value: number; unit: BaseUnit } | null {
  if (!parsed || parsed.quantity <= 0) return null;
  return { value: round2(price / parsed.quantity), unit: parsed.unit };
}

/**
 * Parsează formatul Kaufland de preț de referință: "(=1 kg 37.98)" sau "(=100 g 3.80)".
 * Returnează prețul raportat la unitatea de bază (kg/l/buc).
 * Notă: normalizeText elimină "=()" — după normalizare rămâne "1 kg 37.98",
 * de aceea potrivirea e ancorată pe întregul text, fără "=".
 */
export function parseKauflandBasePrice(text: string | null | undefined): { value: number; unit: BaseUnit } | null {
  if (!text) return null;
  const m = normalizeText(text).match(new RegExp(String.raw`^${NUM}\s*${UNIT_WORD}\s+${NUM}$`));
  if (!m) return null;
  const info = UNIT_FACTORS[canonicalUnitWord(m[2])];
  if (!info) return null;
  const qtyInBase = parseNum(m[1]) * info.factor;
  if (qtyInBase <= 0) return null;
  return { value: round2(parseNum(m[3]) / qtyInBase), unit: info.unit };
}

function canonicalUnitWord(w: string): string {
  if (/^ou/.test(w)) return 'oua';
  if (/^buc/.test(w)) return 'buc';
  return w;
}

function parseNum(s: string): number {
  return parseFloat(s.replace(',', '.'));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
