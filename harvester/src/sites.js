'use strict';

/**
 * Configurația site-urilor. Pentru fiecare:
 *  - startUrls: paginile de pornire (ofertele/categoriile principale)
 *  - discover: șablon pentru linkurile interne care merită vizitate
 *    (pagini de categorie/ofertă găsite pe paginile de pornire)
 *  - maxDiscovered: câte linkuri descoperite vizităm, maximum
 *
 * Site-urile astea blochează IP-urile de datacenter, deci nu le-am putut
 * inspecta din cloud — extractoarele generice + modul --debug acoperă
 * necunoscutele: dacă un site nu scoate produse, rulează cu --debug și
 * trimite folderul debug/ ca să rafinam extractorul.
 */
module.exports = [
  {
    slug: 'profi',
    name: 'Profi',
    startUrls: ['https://www.profi.ro/cupoane/', 'https://www.profi.ro/oferte/', 'https://www.profi.ro/'],
    discover: /\/(oferte|revista|promotii|catalog|cupoane|coupon)[^"']*/i,
    maxDiscovered: 12,
    // profi.ro e WordPress: încercăm REST API-ul direct din pagină
    // (fetch-ul rulează în browser, cu verificarea Cloudflare deja trecută)
    inPageFetches: [
      '/wp-json/wp/v2/types',
      '/wp-json/wp/v2/coupon?per_page=100',
      '/wp-json/wp/v2/coupon?per_page=100&page=2',
      '/wp-json/wp/v2/cupoane?per_page=100',
      '/wp-json/wp/v2/oferta?per_page=100',
      '/wp-json/wp/v2/oferte?per_page=100'
    ]
  },
  {
    slug: 'metro',
    name: 'Metro',
    startUrls: ['https://www.metro.ro/promotii', 'https://produse.metro.ro/', 'https://www.metro.ro/'],
    discover: /\/(shop|promotii|oferte|categor|marketplace)[^"']*/i,
    maxDiscovered: 12
  },
  {
    slug: 'la-cocos',
    name: 'La Cocoș',
    // domeniul corect e la-cocos.com (lacocos.ro e altceva)
    startUrls: ['https://la-cocos.com/'],
    discover: /\/(produs|product|categ|shop|magazin|ofert|promo)[^"']*/i,
    maxDiscovered: 15
  },
  {
    // site accesibil și din cloud — folosit ca test al întregii mecanici
    slug: 'penny',
    name: 'Penny',
    startUrls: ['https://www.penny.ro/oferte'],
    discover: /\/(categorie|oferte|promo)[^"']*/i,
    maxDiscovered: 4,
    testOnly: true
  }
];
