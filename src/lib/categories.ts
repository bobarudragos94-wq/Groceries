import { normalizeText } from './normalize';

/** Categoriile canonice ale aplicației (slug -> etichetă în română). */
export const CATEGORIES: Record<string, string> = {
  'fructe-legume': 'Fructe și legume',
  'lactate-oua': 'Lactate și ouă',
  'carne-mezeluri': 'Carne și mezeluri',
  peste: 'Pește',
  panificatie: 'Panificație',
  'alimente-baza': 'Alimente de bază',
  conserve: 'Conserve',
  dulciuri: 'Dulciuri și snacks',
  'mic-dejun': 'Mic dejun și cereale',
  bauturi: 'Băuturi',
  congelate: 'Congelate și înghețată',
  menaj: 'Menaj și curățenie',
  'ingrijire-personala': 'Îngrijire personală',
  'bebe-copii': 'Bebeluși și copii',
  animale: 'Animale de companie',
  altele: 'Altele'
};

/**
 * Reguli cuvânt-cheie -> categorie. Se aplică pe categoria brută a magazinului
 * și, dacă nu se potrivește nimic, pe numele produsului.
 * Ordinea contează: prima potrivire câștigă.
 */
const RULES: Array<[RegExp, string]> = [
  // regulile specifice ÎNAINTEA celor generice: „Formule lapte” (bebe) sau
  // „Lapte pentru pisici” nu trebuie să cadă la lactate
  [/\banimal|caine|caini|catel|pisic|pet ?shop|hrana (uscata|umeda|pentru)\b/, 'animale'],
  [/\bbebe|scutece|formule lapte|lapte praf|copii\b/, 'bebe-copii'],
  [/\bmezel|salam|carnati|sunca|crenvur|parizer|kaizer|bacon\b/, 'carne-mezeluri'],
  [/\bcarne|pui|porc|vita|curcan|miel|grill\b/, 'carne-mezeluri'],
  [/\bpeste|somon|ton|hering|fructe de mare|creveti\b/, 'peste'],
  [/\blactate|lapte|iaurt|branz|cascaval|smantana|unt|kefir|sana|telemea|mozzarella|oua\b/, 'lactate-oua'],
  [/\blegume|fructe|salat[ae]|verdeturi|flori\b/, 'fructe-legume'],
  [/\bpaine|panificatie|patiserie|covrig|bagheta|chifl|lipie|cozonac\b/, 'panificatie'],
  [/\bcereale|musli|corn ?flakes|gem|miere|dulceata|crema de ciocolata|mic dejun\b/, 'mic-dejun'],
  [/\bdulciuri|ciocolat|biscuit|napolitan|bomboane|snack|chips|sticksuri|pufuleti|prajitur\b/, 'dulciuri'],
  [/\bconserv|muraturi|zacusca|compot\b/, 'conserve'],
  [/\bbautur|suc|apa|bere|vin|cafea|ceai|energizant|cola|limonada|whisky|vodca\b/, 'bauturi'],
  [/\bcongelat|inghetata|frozen\b/, 'congelate'],
  [/\bulei|faina|zahar|orez|paste|malai|otet|condiment|sare|mustar|ketchup|maionez|sos\b/, 'alimente-baza'],
  [/\bdetergent|curatenie|menaj|hartie igienica|servetele|prosop|vase|rufe\b/, 'menaj'],
  [/\bsampon|gel de dus|sapun|pasta de dinti|deodorant|cosmetic|ingrijire\b/, 'ingrijire-personala']
];

/** Mapează categoria brută + numele produsului la o categorie canonică. */
export function mapCategory(rawCategory: string | null | undefined, productName?: string): string {
  for (const source of [rawCategory, productName]) {
    if (!source) continue;
    const n = normalizeText(source);
    for (const [re, slug] of RULES) {
      if (re.test(n)) return slug;
    }
  }
  return 'altele';
}
