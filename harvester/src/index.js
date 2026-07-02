'use strict';

/**
 * Coșul Ieftin — Harvester
 * ------------------------
 * Rulează pe calculatorul TĂU (IP obișnuit, browser real) și culege prețuri
 * de pe site-urile care blochează serverele din cloud: Profi, Metro, La Cocoș.
 * Rezultatul: câte un fișier CSV per magazin, gata de urcat în aplicație
 * (/admin → Import).
 *
 * Utilizare (dublu-click pe .exe sau din linia de comandă):
 *   CosulIeftin-Harvester.exe                      — toate site-urile
 *   CosulIeftin-Harvester.exe --sites profi        — doar Profi
 *   CosulIeftin-Harvester.exe --out C:\csv         — folderul de ieșire
 *   CosulIeftin-Harvester.exe --debug              — salvează HTML/JSON brut
 *   CosulIeftin-Harvester.exe --chrome "C:\...\chrome.exe"  — browser explicit
 *   CosulIeftin-Harvester.exe --headless           — fără fereastră (nu
 *                              recomandat: Cloudflare detectează headless)
 */

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { launchBrowser, visitAndExtract, sleep } = require('./browser');
const {
  DOM_EXTRACTOR,
  productsFromJsonBodies,
  productsFromJsonLd,
  productsFromDom,
  mergeProducts
} = require('./extract');
const SITES = require('./sites');
const { toCsv } = require('./csv');

function parseArgs(argv) {
  const args = {
    sites: null,
    out: null,
    debug: false,
    headless: false,
    chrome: null,
    pause: true,
    url: null,
    slug: null
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--sites') args.sites = (argv[++i] || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--debug') args.debug = true;
    else if (a === '--headless') args.headless = true;
    else if (a === '--chrome') args.chrome = argv[++i];
    else if (a === '--no-pause') args.pause = false;
    else if (a === '--url') args.url = argv[++i];
    else if (a === '--slug') args.slug = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log(
        'Optiuni: --sites profi,metro,la-cocos | --out <folder> | --debug | --chrome <cale> | --headless | --no-pause\n' +
          '         --url <adresa> --slug <magazin>   (culege o singură pagină, la alegere)'
      );
      process.exit(0);
    }
  }
  return args;
}

function isStandaloneBinary() {
  if (process.pkg) return true;
  try {
    return require('node:sea').isSea();
  } catch {
    return false;
  }
}

function baseDir() {
  // lângă executabil (exe standalone) sau în folderul curent la rulare cu node
  return isStandaloneBinary() ? path.dirname(process.execPath) : process.cwd();
}

async function harvestSite(port, site, opts) {
  const { log, debugDir } = opts;
  log(`\n=== ${site.name} ===`);

  const visited = new Set();
  const collected = [];
  let queue = [...site.startUrls];
  let discovered = 0;

  while (queue.length > 0) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);
    log(`  → ${url}`);

    let page;
    try {
      page = await visitAndExtract(port, url, DOM_EXTRACTOR, { log });
    } catch (err) {
      log(`    ✘ eroare: ${err.message.split('\n')[0]}`);
      continue;
    }

    let origin;
    try {
      origin = new URL(page.finalUrl).origin;
    } catch {
      origin = undefined;
    }

    const fromJson = productsFromJsonBodies(page.jsonBodies, origin);
    const fromLd = productsFromJsonLd(page.html, origin);
    const fromDom = productsFromDom(page.domProducts);
    const merged = mergeProducts(fromJson, fromLd, fromDom);
    log(`    ✔ ${merged.length} produse (API: ${fromJson.length}, JSON-LD: ${fromLd.length}, pagină: ${fromDom.length})`);
    collected.push(merged);

    if (debugDir) {
      const safe = url.replace(/[^a-z0-9]+/gi, '_').slice(0, 80);
      fs.writeFileSync(path.join(debugDir, `${site.slug}_${safe}.html`), page.html);
      page.jsonBodies.forEach((b, i) =>
        fs.writeFileSync(path.join(debugDir, `${site.slug}_${safe}_xhr${i}.json`), `// ${b.url}\n${b.body}`)
      );
    }

    // descoperim pagini de categorie/ofertă din linkurile paginii
    if (discovered < site.maxDiscovered && page.html) {
      const links = new Set();
      const re = /href="(https?:\/\/[^"]+|\/[^"]+)"/g;
      let m;
      while ((m = re.exec(page.html))) {
        let href = m[1];
        if (href.startsWith('/')) href = (origin || '') + href;
        try {
          const u = new URL(href);
          if (origin && u.origin !== origin) continue;
          if (!site.discover.test(u.pathname)) continue;
          if (/\.(pdf|jpg|png|webp|css|js)(\?|$)/i.test(u.pathname)) continue;
          u.hash = '';
          links.add(u.toString());
        } catch {
          /* href invalid */
        }
      }
      for (const link of links) {
        if (discovered >= site.maxDiscovered) break;
        if (!visited.has(link) && !queue.includes(link)) {
          queue.push(link);
          discovered++;
        }
      }
    }
    await sleep(1200);
  }

  return mergeProducts(...collected);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = args.out || baseDir();
  fs.mkdirSync(outDir, { recursive: true });

  const debugDir = args.debug ? path.join(outDir, 'debug') : null;
  if (debugDir) fs.mkdirSync(debugDir, { recursive: true });

  const log = (...xs) => console.log(...xs);

  log('==============================================');
  log('  Coșul Ieftin — Harvester (prețuri → CSV)');
  log('==============================================');
  log('Se deschide o fereastră de browser. NU o închide cât timp rulează.');
  log('Dacă un site îți cere o verificare anti-robot, rezolv-o în fereastră.');

  let sites;
  if (args.url) {
    // mod ad-hoc: o singură pagină, pentru orice magazin
    sites = [
      {
        slug: args.slug || 'custom',
        name: args.slug || 'custom',
        startUrls: [args.url],
        discover: /$^/,
        maxDiscovered: 0
      }
    ];
  } else {
    const wanted = args.sites ?? SITES.filter((s) => !s.testOnly).map((s) => s.slug);
    sites = SITES.filter((s) => wanted.includes(s.slug));
  }
  if (sites.length === 0) {
    log(`Niciun site valid. Disponibile: ${SITES.map((s) => s.slug).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  let browser;
  try {
    browser = await launchBrowser({ chromePath: args.chrome, headless: args.headless });
  } catch (err) {
    log(`\n✘ ${err.message}`);
    process.exitCode = 1;
    await maybePause(args.pause);
    return;
  }

  const summary = [];
  try {
    for (const site of sites) {
      try {
        const products = await harvestSite(browser.port, site, { log, debugDir });
        if (products.length === 0) {
          summary.push({ site: site.name, count: 0, file: null });
          log(`  ✘ ${site.name}: niciun produs extras. Rulează cu --debug și trimite folderul debug/.`);
          continue;
        }
        const file = path.join(outDir, `${site.slug}-${new Date().toISOString().slice(0, 10)}.csv`);
        fs.writeFileSync(file, toCsv(site.slug, products), 'utf8');
        summary.push({ site: site.name, count: products.length, file });
        log(`  💾 ${products.length} produse → ${file}`);
      } catch (err) {
        summary.push({ site: site.name, count: 0, file: null });
        log(`  ✘ ${site.name} a eșuat: ${err.message.split('\n')[0]}`);
      }
    }
  } finally {
    browser.close();
  }

  log('\n================ REZUMAT ================');
  for (const s of summary) {
    log(s.count > 0 ? ` ✔ ${s.site}: ${s.count} produse → ${path.basename(s.file)}` : ` ✘ ${s.site}: nimic extras`);
  }
  log('\nPasul următor: deschide aplicația → Admin → Import și urcă fișierele CSV.');
  if (summary.every((s) => s.count === 0)) process.exitCode = 1;

  await maybePause(args.pause);
}

/** La dublu-click pe Windows, fereastra s-ar închide instant — așteptăm Enter. */
async function maybePause(pause) {
  if (!pause || !process.stdout.isTTY) return;
  await new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('\nApasă Enter pentru a închide...', () => {
      rl.close();
      resolve();
    });
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
