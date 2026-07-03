'use strict';

/**
 * Scrie produsele în formatul CSV acceptat de importul aplicației
 * (/admin → Import sau `npm run import:csv`).
 */

const HEADER = [
  'supermarket',
  'external_id',
  'name',
  'brand',
  'category',
  'unit_size',
  'price',
  'old_price',
  'city',
  'county',
  'postal_code',
  'store_external_id',
  'image_url',
  'url'
];

function esc(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(supermarketSlug, products, { city = null, county = null } = {}) {
  // cu --city/--county prețurile devin specifice magazinului local
  // (ex. Metro arată prețurile magazinului selectat, nu naționale)
  const storeExternalId = city || county ? `harvester-${(city || county).toLowerCase().replace(/\s+/g, '-')}` : '';
  const lines = [HEADER.join(',')];
  for (const p of products) {
    lines.push(
      [
        supermarketSlug,
        p.externalId ?? '',
        p.name,
        p.brand ?? '',
        p.category ?? '',
        p.unitSize ?? '',
        p.price.toFixed(2),
        p.oldPrice != null ? p.oldPrice.toFixed(2) : '',
        city ?? '',
        county ?? '',
        '',
        storeExternalId,
        p.imageUrl ?? '',
        p.url ?? ''
      ]
        .map(esc)
        .join(',')
    );
  }
  return lines.join('\r\n') + '\r\n';
}

module.exports = { toCsv };
