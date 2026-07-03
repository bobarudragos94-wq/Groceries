# Coșul Ieftin — Harvester (unealta de rulat acasă)

Profi, Metro și La Cocoș blochează serverele din cloud (Cloudflare/Akamai), deci scraperele automate nu pot ajunge la ele. **Harvester-ul rulează pe calculatorul tău** — IP obișnuit de acasă, browserul tău real (Chrome sau Edge) — culege produsele și scrie **fișiere CSV** pe care le urci apoi în aplicație la **Admin → Import**.

## Utilizare (Windows)

1. Descarcă `CosulIeftin-Harvester.exe` (din chat sau din GitHub → Actions → *Build harvester* → Artifacts).
2. Dublu-click pe el.
   - Windows SmartScreen poate avertiza „editor necunoscut” → *More info* → *Run anyway*.
   - Se deschide o fereastră de browser: **nu o închide** cât timp rulează.
   - Dacă un site afișează o verificare anti-robot („Verify you are human”): programul **se oprește complet și nu atinge pagina** — o rezolvi tu în fereastră, apoi **apeși Enter în fereastra neagră** și el continuă. Verificarea trecută se memorează (profil de browser persistent), deci la rulările următoare de obicei nu mai apare.
3. La final găsești lângă executabil fișiere de forma `profi-2026-07-02.csv`, `metro-2026-07-02.csv`, `la-cocos-2026-07-02.csv`.
4. Deschide aplicația → **Admin → Import** → încarcă fiecare CSV.

## Opțiuni (linie de comandă)

```
CosulIeftin-Harvester.exe --sites profi              doar un site (profi | metro | la-cocos)
CosulIeftin-Harvester.exe --out C:\csv               folderul de ieșire
CosulIeftin-Harvester.exe --debug                    salvează HTML/JSON brut în debug\
CosulIeftin-Harvester.exe --chrome "C:\...\chrome.exe"  cale explicită către browser
CosulIeftin-Harvester.exe --url https://... --slug profi   culege o singură pagină, la alegere
CosulIeftin-Harvester.exe --confirm                  așteaptă Enter la FIECARE pagină (control manual total)
CosulIeftin-Harvester.exe --fresh-profile            profil de browser curat (uită verificările memorate)
CosulIeftin-Harvester.exe --city "București" --county "București"
                                                     marchează prețurile ca fiind ale magazinului local
                                                     (ex. Metro arată prețurile magazinului selectat de tine,
                                                     nu prețuri naționale — spune aplicației orașul lor)
```

## Cum funcționează

Deschide browserul instalat pe PC (găsește singur Chrome sau Edge) cu protocolul de control DevTools, vizitează paginile de oferte/categorii și extrage produse din trei surse, în ordinea încrederii:

1. **răspunsurile JSON** ale site-ului (API-urile interne, interceptate din rețea) — cele mai bogate: nume, marcă, preț, imagine;
2. **fișierele descărcate de site** (ex. profi.ro servește un export „oferte.csv” — e capturat și parsat automat) + interogări țintite (ex. API-ul WordPress al profi.ro, apelat din pagină cu verificarea deja trecută);
3. **JSON-LD** (`schema.org/Product`) din pagină;
4. **cardurile de produs** vizibile în pagină (euristic: titlu + preț în lei, inclusiv prețurile afișate „rupt”: 12⁹⁹ → 12,99).

Prețurile în bani (899 = 8,99 lei) sunt detectate și convertite automat; gramajul se extrage din numele produsului („1 l”, „500 g”), iar aplicația calculează la import prețul pe kg/litru.

## Dacă un site nu scoate produse

Site-urile astea nu au putut fi inspectate dinainte (blochează cloud-ul), deci extractoarele sunt generice. Rulează:

```
CosulIeftin-Harvester.exe --sites metro --debug
```

și trimite folderul `debug\` (HTML + JSON capturat) — pe baza lui se scrie un extractor țintit pentru site-ul respectiv în `src/sites.js` / `src/extract.js`.

## Build din sursă

```bash
cd harvester
npm install
node src/index.js --sites profi        # rulare directă cu Node
node build.js                          # → dist/CosulIeftin-Harvester.exe
```

Build-ul folosește Node SEA: bundle cu esbuild → blob SEA → injectat cu postject în binarul oficial Node pentru Windows (nodejs.org). Există și un workflow GitHub Actions (*Build harvester*) care produce exe-ul ca artifact la fiecare modificare în `harvester/`.
