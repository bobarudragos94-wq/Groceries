import { normalizeText } from './normalize';

/**
 * Județele României + derivarea județului din codul poștal sau oraș.
 * Codurile poștale românești au 6 cifre; primele 2 identifică județul
 * (standard Poșta Română, stabil).
 */

export const POSTAL_PREFIX_TO_COUNTY: Record<string, string> = {
  '01': 'București',
  '02': 'București',
  '03': 'București',
  '04': 'București',
  '05': 'București',
  '06': 'București',
  '07': 'Ilfov',
  '08': 'Giurgiu',
  '10': 'Prahova',
  '11': 'Argeș',
  '12': 'Buzău',
  '13': 'Dâmbovița',
  '14': 'Teleorman',
  '20': 'Dolj',
  '21': 'Gorj',
  '22': 'Mehedinți',
  '23': 'Olt',
  '24': 'Vâlcea',
  '30': 'Timiș',
  '31': 'Arad',
  '32': 'Caraș-Severin',
  '33': 'Hunedoara',
  '40': 'Cluj',
  '41': 'Bihor',
  '42': 'Bistrița-Năsăud',
  '43': 'Maramureș',
  '44': 'Satu Mare',
  '45': 'Sălaj',
  '50': 'Brașov',
  '51': 'Alba',
  '52': 'Covasna',
  '53': 'Harghita',
  '54': 'Mureș',
  '55': 'Sibiu',
  '60': 'Bacău',
  '61': 'Neamț',
  '62': 'Vrancea',
  '70': 'Iași',
  '71': 'Botoșani',
  '72': 'Suceava',
  '73': 'Vaslui',
  '80': 'Galați',
  '81': 'Brăila',
  '82': 'Tulcea',
  '90': 'Constanța',
  '91': 'Călărași',
  '92': 'Ialomița'
};

/** Reședințele de județ + orașe mari — fallback când nu avem cod poștal. */
const CITY_TO_COUNTY: Record<string, string> = {
  bucuresti: 'București',
  'alba iulia': 'Alba',
  arad: 'Arad',
  pitesti: 'Argeș',
  bacau: 'Bacău',
  oradea: 'Bihor',
  bistrita: 'Bistrița-Năsăud',
  botosani: 'Botoșani',
  brasov: 'Brașov',
  braila: 'Brăila',
  buzau: 'Buzău',
  resita: 'Caraș-Severin',
  calarasi: 'Călărași',
  'cluj-napoca': 'Cluj',
  'cluj napoca': 'Cluj',
  constanta: 'Constanța',
  mangalia: 'Constanța',
  'sfantu gheorghe': 'Covasna',
  targoviste: 'Dâmbovița',
  craiova: 'Dolj',
  galati: 'Galați',
  giurgiu: 'Giurgiu',
  'targu jiu': 'Gorj',
  'miercurea ciuc': 'Harghita',
  deva: 'Hunedoara',
  hunedoara: 'Hunedoara',
  petrosani: 'Hunedoara',
  slobozia: 'Ialomița',
  iasi: 'Iași',
  voluntari: 'Ilfov',
  otopeni: 'Ilfov',
  'baia mare': 'Maramureș',
  'drobeta-turnu severin': 'Mehedinți',
  'drobeta turnu severin': 'Mehedinți',
  'targu mures': 'Mureș',
  'piatra neamt': 'Neamț',
  roman: 'Neamț',
  slatina: 'Olt',
  ploiesti: 'Prahova',
  campina: 'Prahova',
  'satu mare': 'Satu Mare',
  zalau: 'Sălaj',
  sibiu: 'Sibiu',
  medias: 'Sibiu',
  suceava: 'Suceava',
  alexandria: 'Teleorman',
  timisoara: 'Timiș',
  tulcea: 'Tulcea',
  vaslui: 'Vaslui',
  barlad: 'Vaslui',
  'ramnicu valcea': 'Vâlcea',
  focsani: 'Vrancea'
};

export function countyFromPostalCode(postalCode: string | null | undefined): string | null {
  if (!postalCode) return null;
  const digits = postalCode.replace(/\D/g, '');
  if (digits.length !== 6) return null;
  return POSTAL_PREFIX_TO_COUNTY[digits.slice(0, 2)] ?? null;
}

export function countyFromCity(city: string | null | undefined): string | null {
  if (!city) return null;
  return CITY_TO_COUNTY[normalizeText(city)] ?? null;
}

/** Cea mai bună estimare: explicit > cod poștal > oraș. */
export function resolveCounty(opts: {
  county?: string | null;
  postalCode?: string | null;
  city?: string | null;
}): string | null {
  return opts.county || countyFromPostalCode(opts.postalCode) || countyFromCity(opts.city);
}
