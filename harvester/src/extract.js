'use strict';

/**
 * Extracție generică de produse din trei surse, în ordinea încrederii:
 *  1. Răspunsurile JSON interceptate din rețea (API-urile interne ale site-ului)
 *  2. JSON-LD (schema.org/Product) din HTML
 *  3. Carduri de produs detectate euristic în DOM
 *
 * Nu cunoaștem dinainte structura site-urilor protejate (nu le putem accesa
 * din cloud), așa că extractoarele sunt generice și defensive.
 */

const NAME_KEYS = ['name', 'productName', 'title', 'displayName', 'fullTitle', 'label', 'denumire'];
const ID_KEYS = ['sku', 'id', 'productId', 'code', 'ean', 'itemId', 'articleNumber', 'klNr'];
const IMG_KEYS = ['image', 'imageUrl', 'imageURL', 'img', 'thumbnail', 'listImage', 'picture'];
const URL_KEYS = ['url', 'link', 'href', 'canonicalUrl', 'productUrl'];
const BRAND_KEYS = ['brand', 'brandName', 'manufacturer', 'marca'];
const PRICE_KEY_RE = /price|pret|amount|value|suma/i;
const PRICE_PREFERRED_RE = /(^|[._])(price|pret|sellingprice|currentprice|finalprice)/i;

/** Produs normalizat de harvester (se mapează 1:1 pe coloanele CSV). */
function makeProduct({ externalId, name, brand, price, oldPrice, unitSize, category, imageUrl, url }) {
  return { externalId, name, brand, price, oldPrice, unitSize, category, imageUrl, url };
}

function sane(price) {
  return typeof price === 'number' && isFinite(price) && price >= 0.05 && price <= 30000;
}

function firstString(obj, keys, maxLen = 300) {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim().length >= 2 && v.length <= maxLen) return v.trim();
    if (v && typeof v === 'object' && typeof v.name === 'string' && v.name.trim()) return v.name.trim();
    // WordPress REST: title: { rendered: "..." }
    if (v && typeof v === 'object' && typeof v.rendered === 'string' && v.rendered.trim()) {
      return stripHtml(v.rendered).slice(0, maxLen);
    }
    if (Array.isArray(v) && typeof v[0] === 'string' && v[0].trim()) return v[0].trim();
    if (Array.isArray(v) && v[0] && typeof v[0] === 'object' && typeof v[0].url === 'string') return v[0].url;
  }
  return undefined;
}

function stripHtml(s) {
  return s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

/** Caută recursiv (max 3 niveluri) câmpuri numerice care seamănă a preț. */
function collectPriceCandidates(obj, path = '', depth = 0, out = []) {
  if (!obj || typeof obj !== 'object' || depth > 3) return out;
  for (const [k, v] of Object.entries(obj)) {
    const p = path ? `${path}.${k}` : k;
    if (typeof v === 'number' && PRICE_KEY_RE.test(p)) out.push({ path: p, value: v });
    else if (typeof v === 'string' && PRICE_KEY_RE.test(p) && /^\d+([.,]\d+)?$/.test(v.trim())) {
      out.push({ path: p, value: parseFloat(v.replace(',', '.')) });
    } else if (v && typeof v === 'object' && !Array.isArray(v) && PRICE_KEY_RE.test(p)) {
      // coborâm în obiecte de tip {price: {regular: {value: 649}}}
      collectPriceCandidates(v, p, depth + 1, out);
    }
  }
  return out;
}

function pickPrice(obj) {
  const candidates = collectPriceCandidates(obj).filter((c) => c.value > 0);
  if (candidates.length === 0) return undefined;
  // preferăm cheile care chiar spun "price"/"pret", nu doar "value"
  candidates.sort((a, b) => {
    const ap = PRICE_PREFERRED_RE.test(a.path) ? 0 : 1;
    const bp = PRICE_PREFERRED_RE.test(b.path) ? 0 : 1;
    return ap - bp || a.path.length - b.path.length;
  });
  return candidates[0].value;
}

/** Extrage gramajul din numele produsului: "Lapte Zuzu 1,5% 1 l" -> "1 l". */
function unitFromName(name) {
  if (!name) return undefined;
  const m = name.match(/(\d+(?:[.,]\d+)?)\s*(?:x\s*(\d+(?:[.,]\d+)?)\s*)?(kg|g|gr|l|ml|cl|buc|bucati|bucăți)\b/i);
  return m ? m[0] : undefined;
}

/**
 * Caută în orice structură JSON tablouri de obiecte care arată a liste de
 * produse (nume + preț la majoritatea elementelor).
 */
function findProductArrays(value, depth = 0, found = []) {
  if (depth > 8 || value == null) return found;
  if (Array.isArray(value)) {
    const objects = value.filter((x) => x && typeof x === 'object' && !Array.isArray(x));
    if (objects.length >= 3) {
      const sample = objects.slice(0, 10);
      const good = sample.filter((o) => firstString(o, NAME_KEYS) && pickPrice(o) !== undefined).length;
      if (good / sample.length >= 0.6) {
        found.push(objects);
        return found; // nu coborâm în elementele unei liste deja acceptate
      }
    }
    for (const item of value.slice(0, 50)) findProductArrays(item, depth + 1, found);
    return found;
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value)) findProductArrays(v, depth + 1, found);
  }
  return found;
}

/**
 * Prețuri în bani (899 = 8,99 lei)? Dacă toate prețurile din listă sunt
 * întregi și mediana e nefiresc de mare, împărțim la 100.
 */
function detectBaniScale(prices) {
  if (prices.length < 3) return 1;
  const allInt = prices.every((p) => Number.isInteger(p));
  const sorted = [...prices].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return allInt && median >= 150 ? 100 : 1;
}

function mapJsonItem(obj, scale, origin) {
  const name = firstString(obj, NAME_KEYS);
  const rawPrice = pickPrice(obj);
  if (!name || rawPrice === undefined) return null;
  const price = Math.round((rawPrice / scale) * 100) / 100;
  if (!sane(price)) return null;

  let url = firstString(obj, URL_KEYS, 2000);
  if (url && url.startsWith('/') && origin) url = origin + url;
  let imageUrl = firstString(obj, IMG_KEYS, 2000);
  if (imageUrl && imageUrl.startsWith('/') && origin) imageUrl = origin + imageUrl;

  return makeProduct({
    externalId: String(firstString(obj, ID_KEYS, 100) ?? '').trim() || undefined,
    name,
    brand: firstString(obj, BRAND_KEYS, 100),
    price,
    unitSize: unitFromName(name),
    category: firstString(obj, ['category', 'categoryName', 'categorie'], 150),
    imageUrl,
    url
  });
}

/** 1) Produse din răspunsurile JSON interceptate. */
function productsFromJsonBodies(jsonBodies, origin) {
  const out = [];
  for (const { body } of jsonBodies) {
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      continue;
    }
    for (const arr of findProductArrays(data)) {
      const prices = arr.map((o) => pickPrice(o)).filter((p) => p !== undefined && p > 0);
      const scale = detectBaniScale(prices);
      for (const obj of arr) {
        const p = mapJsonItem(obj, scale, origin);
        if (p) out.push(p);
      }
    }
  }
  return out;
}

/** 2) Produse din JSON-LD (schema.org/Product) din HTML. */
function productsFromJsonLd(html, origin) {
  const out = [];
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    let data;
    try {
      data = JSON.parse(m[1]);
    } catch {
      continue;
    }
    const list = Array.isArray(data) ? data : [data];
    for (const d of list) {
      const items =
        d && d['@type'] === 'ItemList'
          ? (d.itemListElement || []).map((x) => (x && x.item) || x)
          : [d, ...((d && d['@graph']) || [])];
      for (const it of items) {
        if (!it || it['@type'] !== 'Product') continue;
        const offer = Array.isArray(it.offers) ? it.offers[0] : it.offers;
        const price = parseFloat(String(offer?.price ?? offer?.lowPrice ?? '').replace(',', '.'));
        if (!sane(price)) continue;
        let url = typeof it.url === 'string' ? it.url : undefined;
        if (url && url.startsWith('/') && origin) url = origin + url;
        out.push(
          makeProduct({
            externalId: String(it.sku || it.productID || it.mpn || '').trim() || undefined,
            name: String(it.name || '').trim(),
            brand: typeof it.brand === 'string' ? it.brand : it.brand?.name,
            price,
            unitSize: unitFromName(String(it.name || '')),
            imageUrl: typeof it.image === 'string' ? it.image : Array.isArray(it.image) ? it.image[0] : it.image?.url,
            url
          })
        );
      }
    }
  }
  return out.filter((p) => p.name);
}

/**
 * 3) Extractor DOM (rulează ÎN pagină, prin CDP) — carduri-frunză cu preț
 * în lei și un titlu. Șir de cod, nu funcție: se evaluează cu Runtime.evaluate.
 */
const DOM_EXTRACTOR = `(() => {
  const out = [];
  const seen = new Set();
  // preferăm prețurile cu zecimale („12,99 lei”); abia apoi întregi („99 lei”)
  // — multe site-uri afișează prețul rupt în elemente separate și textul
  // fără zecimale e adesea altceva (procent de reducere, puncte etc.)
  const priceReDec = /(\\d{1,4}[.,]\\d{2})\\s*(?:lei|ron)/i;
  const priceReInt = /(\\d{1,4})\\s*(?:lei|ron)/i;
  const priceRe = priceReInt;
  const nodes = Array.from(document.querySelectorAll('[class*="product"], [class*="offer"], [class*="card"], [class*="item"], article, li'));
  for (const el of nodes) {
    if (el.querySelector('[class*="product"], [class*="offer"], [class*="card"], article')) continue;
    const text = el.innerText || '';
    if (text.length > 600) continue;

    // 1) elementul dedicat prețului, dacă există — citim bucățile lui:
    //    <span>12</span><sup>99</sup> lei -> 12.99, nu 1299
    let price = null;
    const priceEl = el.querySelector('[class*="price"], [class*="pret"]');
    if (priceEl) {
      // nodurile text SEPARAT (innerText lipește "12"+"99" în "1299"):
      // <span>12</span><sup>99</sup> lei -> ["12","99","lei"] -> 12.99
      const bits = [];
      const walker = document.createTreeWalker(priceEl, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const t = walker.currentNode.textContent.trim();
        if (t) bits.push(t);
      }
      const pt = bits.join(' ');
      const dm = pt.match(priceReDec) || pt.match(/(\\d{1,4}[.,]\\d{2})(?!\\d)/);
      const sm = pt.match(/(\\d{1,4})\\s+(\\d{2})(?!\\d)/);
      if (dm) price = parseFloat(dm[1].replace(',', '.'));
      else if (sm) price = parseFloat(sm[1] + '.' + sm[2]);
      else {
        const im = pt.match(/\\d{1,4}/);
        if (im) price = parseFloat(im[0]);
      }
    }
    // 2) altfel, prețul din textul cardului (zecimalele au prioritate)
    if (!(price > 0)) {
      const m = text.match(priceReDec) || text.match(priceReInt);
      if (!m) continue;
      price = parseFloat(m[1].replace(',', '.'));
    }
    if (!(price > 0.05 && price < 30000)) continue;
    const titleEl = el.querySelector('h1,h2,h3,h4,[class*="title"],[class*="name"],[class*="denumire"]');
    let name = titleEl ? titleEl.innerText.trim() : '';
    if (!name) {
      const lines = text.split('\\n').map(s => s.trim()).filter(s => s.length >= 6 && !priceRe.test(s) && !/^\\d/.test(s));
      name = lines.sort((a, b) => b.length - a.length)[0] || '';
    }
    name = name.replace(/\\s+/g, ' ').trim().slice(0, 200);
    if (name.length < 4) continue;
    const key = name.toLowerCase() + '|' + price;
    if (seen.has(key)) continue;
    seen.add(key);
    const img = el.querySelector('img');
    const a = el.querySelector('a[href]');
    out.push({
      name,
      price,
      imageUrl: img ? (img.currentSrc || img.src || undefined) : undefined,
      url: a ? a.href : undefined
    });
  }
  return out;
})()`;

function productsFromDom(domProducts) {
  return (domProducts || [])
    .filter((p) => p && p.name && sane(p.price))
    .map((p) =>
      makeProduct({
        name: p.name,
        price: p.price,
        unitSize: unitFromName(p.name),
        imageUrl: p.imageUrl,
        url: p.url
      })
    );
}

/**
 * 4) Produse din fișiere CSV pe care site-ul le descarcă singur
 * (ex. exportul „oferte.csv” de pe profi.ro). Coloanele se recunosc
 * după nume: Product_Name/name/denumire, New_Price/price/pret etc.
 */
function productsFromCsvText(text) {
  const rows = parseCsvLoose(text);
  if (rows.length === 0) return [];
  const headers = Object.keys(rows[0]);

  const find = (re) => headers.find((h) => re.test(h));
  const nameCol = find(/product.*name|^name$|denumire|titlu|nume/i);
  const priceCol = find(/new_price|current_price|^price$|pret(?!.*vechi)(?!.*old)/i) || find(/price|pret/i);
  if (!nameCol || !priceCol) return [];
  const oldCol = find(/old_price|pret.*vechi|list_price/i);
  const imgCol = find(/image|img|poza/i);
  const urlCol = find(/^url$|link/i);
  const idCol = find(/^id$|sku|cod/i);
  const brandCol = find(/brand|marca/i);
  const catCol = find(/categ/i);

  const out = [];
  for (const r of rows) {
    const name = (r[nameCol] || '').trim();
    const price = parseFloat(String(r[priceCol] || '').replace(',', '.'));
    if (!name || !sane(price)) continue;
    const oldPrice = oldCol ? parseFloat(String(r[oldCol] || '').replace(',', '.')) : NaN;
    out.push(
      makeProduct({
        externalId: idCol && r[idCol] ? String(r[idCol]) : undefined,
        name,
        brand: brandCol ? r[brandCol] || undefined : undefined,
        price,
        oldPrice: sane(oldPrice) && oldPrice > price ? oldPrice : undefined,
        unitSize: unitFromName(name),
        category: catCol ? r[catCol] || undefined : undefined,
        imageUrl: imgCol ? r[imgCol] || undefined : undefined,
        url: urlCol ? r[urlCol] || undefined : undefined
      })
    );
  }
  return out;
}

/** Parser CSV tolerant (ghilimele, BOM, \r\n). */
function parseCsvLoose(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj = {};
    header.forEach((h, i) => (obj[h] = (r[i] ?? '').trim()));
    return obj;
  });
}

/** Cheie de deduplicare stabilă. */
function productKey(p) {
  return (p.externalId || p.name.toLowerCase().replace(/\s+/g, '-')).slice(0, 120);
}

/** Combină sursele în ordinea încrederii; prima apariție câștigă. */
function mergeProducts(...sources) {
  const byKey = new Map();
  for (const list of sources) {
    for (const p of list) {
      if (!p.name || !sane(p.price)) continue;
      const key = productKey(p);
      if (!byKey.has(key)) byKey.set(key, p);
    }
  }
  return [...byKey.values()];
}

module.exports = {
  DOM_EXTRACTOR,
  productsFromJsonBodies,
  productsFromJsonLd,
  productsFromDom,
  productsFromCsvText,
  mergeProducts,
  productKey
};
