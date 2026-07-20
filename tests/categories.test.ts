import { describe, expect, it } from 'vitest';
import { mapCategory } from '../src/lib/categories';

describe('mapCategory', () => {
  it('mapează categorii brute uzuale', () => {
    expect(mapCategory('Lactate și ouă')).toBe('lactate-oua');
    expect(mapCategory('Băuturi răcoritoare')).toBe('bauturi');
    expect(mapCategory('Detergenți rufe')).toBe('menaj');
  });

  it('cade pe numele produsului când categoria brută nu ajută', () => {
    expect(mapCategory('Oferte', 'Lapte UHT 3,5% 1 l')).toBe('lactate-oua');
    expect(mapCategory(null, 'Pâine albă feliată')).toBe('panificatie');
  });

  it('regulile specifice bat pe cele generice', () => {
    // „ciocolată cu lapte” e la dulciuri, nu la lactate
    expect(mapCategory(null, 'Ciocolată cu lapte')).toBe('dulciuri');
    // „lapte praf” pentru bebeluși nu e lactate
    expect(mapCategory(null, 'Lapte praf formula 2')).toBe('bebe-copii');
    // hrana pentru pisici nu e la lactate
    expect(mapCategory(null, 'Hrană umedă pisici cu lapte')).toBe('animale');
  });

  it('necunoscut → altele', () => {
    expect(mapCategory('Diverse', 'Produs misterios')).toBe('altele');
    expect(mapCategory(undefined, undefined)).toBe('altele');
  });
});
