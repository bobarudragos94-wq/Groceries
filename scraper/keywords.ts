/**
 * Cuvinte de căutare pentru magazinele fără listare completă de catalog (Lidl).
 * Acoperă coșul de cumpărături de zi cu zi; se pot adăuga altele prin
 * variabila de mediu LIDL_EXTRA_QUERIES (separate prin virgulă).
 */
export const GROCERY_QUERIES: string[] = [
  // lactate & ouă
  'lapte', 'iaurt', 'branza', 'cascaval', 'smantana', 'unt', 'oua', 'kefir', 'mozzarella', 'telemea',
  // panificație
  'paine', 'bagheta', 'chifle', 'covrigi', 'lipie',
  // carne & mezeluri
  'piept pui', 'pulpe pui', 'carne porc', 'carne vita', 'mici', 'carnati', 'salam', 'sunca', 'crenvursti', 'bacon',
  // pește
  'somon', 'ton', 'peste',
  // fructe & legume
  'rosii', 'castraveti', 'cartofi', 'ceapa', 'morcovi', 'ardei', 'salata', 'mere', 'banane', 'portocale',
  'lamai', 'struguri', 'pepene', 'capsuni', 'avocado', 'usturoi', 'dovlecei', 'vinete', 'ciuperci',
  // alimente de bază
  'ulei', 'faina', 'zahar', 'orez', 'paste', 'malai', 'otet', 'sare', 'piper', 'bulion', 'ketchup', 'maioneza', 'mustar',
  // mic dejun & dulciuri
  'cereale', 'musli', 'miere', 'gem', 'ciocolata', 'biscuiti', 'napolitane', 'chips', 'snack', 'inghetata',
  // conserve & congelate
  'conserva', 'fasole', 'porumb', 'mazare', 'zacusca', 'pizza congelata', 'legume congelate',
  // băuturi
  'apa minerala', 'apa plata', 'suc', 'cola', 'bere', 'vin', 'cafea', 'ceai', 'energizant', 'fanta',
  // menaj & îngrijire
  'detergent', 'balsam rufe', 'hartie igienica', 'servetele', 'detergent vase', 'sampon', 'gel de dus',
  'sapun', 'pasta de dinti', 'deodorant',
  // bebe & animale
  'scutece', 'hrana pisici', 'hrana caini'
];
