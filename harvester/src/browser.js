'use strict';

/**
 * Lansează browserul instalat pe calculatorul utilizatorului (Chrome sau Edge)
 * cu portul de depanare CDP deschis, apoi oferă funcții de navigare care
 * interceptează răspunsurile JSON ale site-ului.
 *
 * Folosim browserul REAL, cu fereastră vizibilă, tocmai ca protecțiile
 * anti-bot (Cloudflare/Akamai) să vadă un browser obișnuit de pe un IP
 * obișnuit. Dacă apare o verificare („Verify you are human”), utilizatorul
 * o poate rezolva cu un click în fereastră — scriptul așteaptă.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const CDP = require('chrome-remote-interface');

const CHROME_CANDIDATES = {
  win32: [
    () => path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
    () => path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
    () => path.join(process.env['LOCALAPPDATA'] || '', 'Google\\Chrome\\Application\\chrome.exe'),
    () => path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft\\Edge\\Application\\msedge.exe'),
    () => path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Microsoft\\Edge\\Application\\msedge.exe')
  ],
  darwin: [
    () => '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    () => '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
  ],
  linux: [
    () => '/usr/bin/google-chrome',
    () => '/usr/bin/chromium',
    () => '/usr/bin/chromium-browser',
    () => '/opt/pw-browsers/chromium'
  ]
};

function findChrome(explicitPath) {
  if (explicitPath) {
    if (!fs.existsSync(explicitPath)) throw new Error(`Browserul indicat nu există: ${explicitPath}`);
    return explicitPath;
  }
  for (const make of CHROME_CANDIDATES[process.platform] || []) {
    try {
      const p = make();
      if (p && fs.existsSync(p)) return p;
    } catch {
      /* candidat invalid — trecem mai departe */
    }
  }
  throw new Error(
    'Nu am găsit Chrome sau Edge pe acest calculator. Instalează Google Chrome sau pornește cu --chrome "C:\\calea\\catre\\chrome.exe"'
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launchBrowser({ chromePath, headless = false } = {}) {
  const exe = findChrome(chromePath);
  const port = 9222 + Math.floor(Math.random() * 800);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cosul-ieftin-'));

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--disable-features=Translate',
    '--window-size=1320,920',
    '--lang=ro-RO'
  ];
  if (headless) args.push('--headless=new', '--disable-gpu');
  // containerele Linux rulează adesea ca root — Chromium refuză sandbox-ul
  if (process.platform === 'linux') args.push('--no-sandbox');
  if (process.env.HTTPS_PROXY) args.push(`--proxy-server=${process.env.HTTPS_PROXY}`);
  args.push('about:blank');

  const proc = spawn(exe, args, { stdio: 'ignore', detached: false });

  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      await CDP.Version({ port });
      ready = true;
      break;
    } catch {
      await sleep(400);
    }
  }
  if (!ready) throw new Error('Browserul a pornit dar portul de control nu răspunde.');

  return {
    port,
    exe,
    close: () => {
      try {
        proc.kill();
      } catch {
        /* deja închis */
      }
      try {
        fs.rmSync(profileDir, { recursive: true, force: true });
      } catch {
        /* profil temporar rămas — inofensiv */
      }
    }
  };
}

/** Expresie evaluată în pagină: detectăm provocarea Cloudflare/anti-bot. */
const CHALLENGE_CHECK = `(() => {
  const t = (document.title || '').toLowerCase();
  const b = (document.body ? document.body.innerText : '').slice(0, 2000).toLowerCase();
  return /just a moment|attention required|verificare|un moment|are you human|verify you are/.test(t) ||
         !!document.querySelector('#challenge-form, #cf-chl-widget, [id^="cf-chl"], iframe[src*="challenges.cloudflare.com"]') ||
         /checking your browser|verify you are human|confirmați că sunteți om/.test(b);
})()`;

/**
 * Deschide un URL într-un tab nou, interceptează răspunsurile JSON ale
 * site-ului, derulează pagina (lazy-loading + „încarcă mai multe”), rulează
 * extractorul DOM primit și întoarce { html, finalUrl, jsonBodies, domProducts }.
 */
async function visitAndExtract(port, url, domExtractorExpression, opts = {}) {
  const target = await CDP.New({ port, url: 'about:blank' });
  const client = await CDP({ port, target });
  const { Network, Page, Runtime } = client;

  const jsonBodies = [];
  const pendingJson = new Map();

  Network.responseReceived(({ requestId, response }) => {
    const mime = (response.mimeType || '').toLowerCase();
    const u = response.url || '';
    if (u.startsWith('data:')) return;
    if (mime.includes('json') || /\/(api|graphql|rest|search|products?)\b/i.test(u)) {
      pendingJson.set(requestId, u);
    }
  });
  Network.loadingFinished(async ({ requestId }) => {
    const u = pendingJson.get(requestId);
    if (!u) return;
    pendingJson.delete(requestId);
    try {
      const { body, base64Encoded } = await Network.getResponseBody({ requestId });
      const text = base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body;
      if (text && text.length > 20 && text.length < 30_000_000) jsonBodies.push({ url: u, body: text });
    } catch {
      /* corp indisponibil */
    }
  });

  const { settleMs = 6000, scrolls = 4, log = () => {}, challengeWaitMs = 120000 } = opts;

  try {
    await Network.enable({});
    await Page.enable();
    await Page.navigate({ url });
    await Promise.race([Page.loadEventFired(), sleep(30000)]);
    await sleep(settleMs);

    const challenged = async () =>
      (await Runtime.evaluate({ expression: CHALLENGE_CHECK, returnByValue: true })).result.value === true;
    if (await challenged()) {
      log('  ⏳ Site-ul cere o verificare anti-robot. Rezolv-o în fereastra browserului (bifează caseta)...');
      const deadline = Date.now() + challengeWaitMs;
      while (Date.now() < deadline && (await challenged())) await sleep(2000);
      if (await challenged()) log('  ✘ Verificarea nu a fost trecută — pagina se sare.');
      else {
        log('  ✔ Verificare trecută, continui.');
        await sleep(settleMs);
      }
    }

    for (let i = 0; i < scrolls; i++) {
      await Runtime.evaluate({
        expression: `window.scrollTo(0, document.body.scrollHeight); (() => {
          const btn = [...document.querySelectorAll('button, a')].find(b =>
            /încarcă|incarca|mai multe|vezi mai|arată mai|arata mai|load more/i.test(b.textContent || ''));
          if (btn) btn.click();
        })()`
      });
      await sleep(1500);
    }
    await sleep(1000);

    const [htmlRes, urlRes, domRes] = [
      await Runtime.evaluate({ expression: 'document.documentElement ? document.documentElement.outerHTML : ""', returnByValue: true }),
      await Runtime.evaluate({ expression: 'location.href', returnByValue: true }),
      await Runtime.evaluate({ expression: domExtractorExpression, returnByValue: true })
    ];

    return {
      html: htmlRes.result.value || '',
      finalUrl: urlRes.result.value || url,
      jsonBodies,
      domProducts: Array.isArray(domRes.result.value) ? domRes.result.value : []
    };
  } finally {
    try {
      await CDP.Close({ port, id: target.id });
    } catch {
      /* tab închis */
    }
    try {
      client.close();
    } catch {
      /* conexiune închisă */
    }
  }
}

module.exports = { launchBrowser, visitAndExtract, sleep };
