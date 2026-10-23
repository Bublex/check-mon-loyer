// Lecture de l'annonce de location affichée : loyer, charges, surface, pièces, meublé, localisation,
// époque de construction, classe énergie, complément de loyer.
// Script « classique » (les scripts de contenu ne peuvent pas être des modules) : expose globalThis.LoyerExtract.
//
// gatherPage(document, location) rassemble les textes et données structurées de la page ;
// parseListing(page) en déduit l'annonce, sans toucher au DOM (testable hors navigateur).
(() => {
  'use strict';

  const clean = (s) => String(s ?? '').replace(/[\s  ]+/g, ' ').trim();

  /** Montant écrit à la française : « 1 250 », « 1.250 », « 1 250,50 », « 1250.00 ». */
  function parseAmount(raw) {
    let s = String(raw ?? '').replace(/[\s  ]/g, '').replace(/€|eur(os?)?/gi, '');
    if (!s) return null;
    if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) s = s.replace(/,/g, '');
    else s = s.replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    return Number(s);
  }

  const NUM = '(\\d{1,3}(?:[\\s\\u00a0\\u202f.]\\d{3})*(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)';
  const amountAfter = (text, label) => {
    const m = new RegExp(`${label}[^\\d€\\n]{0,25}?${NUM}\\s*(?:€|eur)`, 'i').exec(text);
    return m ? parseAmount(m[1]) : null;
  };

  // --- Rassemblement des données de la page ---

  function jsonScripts(doc, selector) {
    const out = [];
    for (const script of doc.querySelectorAll(selector)) {
      try { out.push(JSON.parse(script.textContent)); } catch { /* JSON invalide : ignoré */ }
    }
    return out;
  }

  function gatherPage(doc, loc) {
    const meta = (name) => doc.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.getAttribute('content') || '';
    const main = doc.querySelector('main, [role="main"], article') || doc.body;
    return {
      url: loc.href,
      host: loc.hostname.replace(/^www\./, ''),
      title: clean(doc.title),
      h1: clean(doc.querySelector('h1')?.textContent),
      ogTitle: clean(meta('og:title')),
      description: clean(meta('og:description') || meta('description')),
      jsonld: jsonScripts(doc, 'script[type="application/ld+json"]'),
      nextData: jsonScripts(doc, 'script#__NEXT_DATA__')[0] || null,
      body: String(main?.innerText ?? main?.textContent ?? '').slice(0, 30000),
    };
  }

  // --- Leboncoin : l'annonce complète est dans les données Next.js ---

  function attr(ad, ...patterns) {
    for (const a of ad.attributes || []) {
      const names = `${a.key || ''} ${a.key_label || ''}`;
      if (patterns.some((p) => p.test(names))) return a;
    }
    return null;
  }

  function fromLeboncoin(page) {
    const ad = page.nextData?.props?.pageProps?.ad;
    if (!ad || typeof ad !== 'object') return null;
    // Navigation interne : les données Next.js restent celles de la première annonce ouverte.
    if (ad.list_id && !page.url.includes(String(ad.list_id))) return null;
    const category = String(ad.category_name || '');
    const out = { site: 'leboncoin', rental: category ? /location/i.test(category) : null, roomShare: /colocation/i.test(category) };
    out.title = clean(ad.subject);
    out.text = String(ad.body || '');
    const price = Array.isArray(ad.price) ? ad.price[0] : ad.price;
    if (Number.isFinite(Number(price))) out.amount = Number(price);
    const square = attr(ad, /^square\b/, /surface/i);
    if (square) out.surface = parseAmount(String(square.value ?? square.value_label).replace(/m.*$/i, ''));
    const rooms = attr(ad, /^rooms\b/, /pi[eè]ces/i);
    if (rooms) out.rooms = parseAmount(String(rooms.value ?? rooms.value_label).replace(/\D.*$/, ''));
    const furnished = attr(ad, /^furnished\b/, /meubl/i);
    if (furnished) {
      const label = `${furnished.value_label || ''}`;
      out.furnished = /non/i.test(label) ? false : /meubl/i.test(label) ? true : furnished.value === '1' ? true : furnished.value === '2' ? false : null;
    }
    const type = attr(ad, /^real_estate_type\b/, /type de bien/i);
    if (type) out.propertyType = clean(type.value_label);
    const energy = attr(ad, /^energy_rate\b/, /classe [ée]nergie|dpe/i);
    if (energy && /^[a-g]$/i.test(String(energy.value || ''))) out.dpe = String(energy.value).toUpperCase();
    const charges = attr(ad, /^charges_included\b/, /charges comprises/i);
    if (charges) out.chargesIncluded = /non|^2$/i.test(`${charges.value_label || charges.value}`) ? false : true;
    const year = attr(ad, /building_year|construction/i);
    if (year) {
      const y = Number(String(year.value ?? year.value_label).match(/\d{4}/)?.[0]);
      if (y) out.construction = { from: y, to: y, label: String(y) };
    }
    const l = ad.location || {};
    out.location = {
      lat: Number.isFinite(Number(l.lat)) ? Number(l.lat) : undefined,
      lon: Number.isFinite(Number(l.lng)) ? Number(l.lng) : undefined,
      postcode: l.zipcode || null,
      city: l.city || l.city_label || '',
      district: l.district || '',
      // Leboncoin place la pastille au centre du quartier, sauf adresse précise du vendeur.
      approximate: l.source !== 'address',
    };
    return out;
  }

  // --- Données structurées schema.org (Bien'ici, agences, portails) ---

  const PLACE_TYPES = /^(Apartment|House|SingleFamilyResidence|Residence|Accommodation|Room|Place|RealEstateListing|Product|Offer)$/i;

  function walk(node, visit, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 6) return;
    if (Array.isArray(node)) { node.forEach((n) => walk(n, visit, depth + 1)); return; }
    visit(node);
    for (const key of ['@graph', 'mainEntity', 'itemOffered', 'about', 'offers', 'object']) if (node[key]) walk(node[key], visit, depth + 1);
  }

  function fromJsonLd(page) {
    const out = {};
    for (const data of page.jsonld) {
      walk(data, (node) => {
        const types = [].concat(node['@type'] || []).map(String);
        if (!types.some((t) => PLACE_TYPES.test(t))) return;
        const size = node.floorSize?.value ?? node.floorSize;
        if (out.surface == null && toNum(size)) out.surface = toNum(size);
        if (out.rooms == null && toNum(node.numberOfRooms)) out.rooms = toNum(node.numberOfRooms);
        const price = node.offers?.price ?? node.price ?? node.priceSpecification?.price;
        if (out.amount == null && toNum(price)) out.amount = toNum(price);
        const addr = node.address || node.location?.address || {};
        const geo = node.geo || node.location?.geo || {};
        if (!out.location && (addr.postalCode || addr.addressLocality || geo.latitude)) {
          out.location = {
            address: clean(addr.streetAddress) || null,
            postcode: addr.postalCode ? String(addr.postalCode) : null,
            city: clean(addr.addressLocality),
            lat: toNum(geo.latitude) ?? undefined,
            lon: toNum(geo.longitude) ?? undefined,
            approximate: !clean(addr.streetAddress),
          };
        }
        if (!out.title && typeof node.name === 'string') out.title = clean(node.name);
      });
    }
    return out;
  }

  const toNum = (v) => (v == null ? null : typeof v === 'number' ? v : parseAmount(String(v).replace(/[^\d\s.,]/g, '')));

  // --- Texte de la page ---

  const RENTAL = /\b(locations?|à louer|a louer|louer|loyer|\/\s*mois|par mois|rent(al)?)\b/i;
  const SALE = /\b(vente|à vendre|a vendre|achat|acheter|viager|prix de vente)\b/i;
  const ROOM_SHARE = /\b(colocation|coloc|chambre (?:chez l'habitant|en colocation|meublée chez))\b/i;
  const NOT_HOUSING = /\b(parking|box|garage|bureaux?|local commercial|locaux|terrain|cave|entrepôt|fonds de commerce)\b/i;

  const ARRONDISSEMENT = [
    [/\bparis\s*(\d{1,2})\s*(?:e|er|ème|eme)?\b/i, (n) => `750${String(n).padStart(2, '0')}`, 'Paris', 20],
    [/\blyon\s*(\d)\s*(?:e|er|ème|eme)?\b/i, (n) => `6900${n}`, 'Lyon', 9],
  ];

  const GENERIC = /^(?:location|locations|louer|appartement|maison|studio|loft|duplex|chambre|meubl[ée]e?s?|vide|pi[eè]ces?|m²|à|a|au|en|t\d|f\d)$/i;
  const CITY_WORD = /^(?:[A-ZÀ-Ü][\wÀ-ÿ'’.-]*|d['’][\wÀ-ÿ'’.-]+|de|du|des|la|le|les|sur|sous|en|lès|l['’][\wÀ-ÿ'’.-]+)$/;

  function locationFromText(header) {
    const out = {};
    // Code postal précédé du nom de la commune : « Villeurbanne (69100) », « Bordeaux 33000 ».
    for (const m of String(header || '').matchAll(/\(?\b((?:0[1-9]|[1-8]\d|9[0-8])\d{3})\b\)?/g)) {
      const words = header.slice(0, m.index).replace(/[\s(|,–—-]+$/, '').split(/\s+/);
      const city = [];
      while (words.length && CITY_WORD.test(words[words.length - 1]) && !GENERIC.test(words[words.length - 1]) && city.length < 5) city.unshift(words.pop());
      while (city.length > 1 && /^(?:de|du|des|la|le|les|sur|sous|en|lès)$/.test(city[0])) city.shift();
      if (city.length) {
        out.postcode = m[1];
        out.city = city.join(' ');
        break;
      }
    }
    for (const [re, code, city, max] of ARRONDISSEMENT) {
      const m = String(header || '').match(re);
      if (m && Number(m[1]) >= 1 && Number(m[1]) <= max) {
        out.postcode ??= code(Number(m[1]));
        out.city = city;
      }
    }
    const district = String(header || '').match(/\bquartier\s+(?:de\s+|du\s+|des\s+)?([A-ZÀ-Ü][\w'’\- ]{2,40}?)(?=\s*(?:[,|–—(-]|$|\d{5}))/);
    if (district) out.district = clean(district[1]);
    return out.postcode || out.city ? out : null;
  }

  function fromText(page) {
    const header = [page.h1, page.ogTitle, page.title].filter(Boolean).join(' | ');
    const text = `${header}\n${page.description}\n${page.body}`;
    const out = { header };

    const surface = header.match(/(\d+(?:[.,]\d+)?)\s*m(?:²|2\b|\s*carr)/i) || text.match(/surface(?:\s+habitable)?(?:\s+de)?\s*:?\s*(\d+(?:[.,]\d+)?)\s*m(?:²|2\b)/i);
    if (surface) out.surface = parseAmount(surface[1]);

    const rooms = header.match(/(\d+)\s*pi[eè]ces?/i) || header.match(/\b[TF](\d)\b/) || text.match(/(?:nombre de pi[eè]ces|pi[eè]ces)\s*:?\s*(\d+)/i) || text.match(/(\d+)\s*pi[eè]ces?\b/i);
    if (rooms) out.rooms = Number(rooms[1]);
    else if (/\bstudio\b/i.test(header)) out.rooms = 1;

    if (/\bnon[\s-]*meubl[ée]/i.test(header) || /(?:location|logement|appartement|studio|maison|bien|loué|type de location)\s*:?\s+(?:non[\s-]*meubl|vide\b|nue?\b)/i.test(text) || /meubl[ée]e?\s*:\s*non\b/i.test(text)) out.furnished = false;
    else if (/\bmeubl[ée]e?s?\b/i.test(header) || /(?:location|logement|appartement|studio|maison|bien|loué|type de location)\s*:?\s+meubl[ée]/i.test(text) || /meubl[ée]e?\s*:\s*oui\b/i.test(text)) out.furnished = true;

    // Loyer : libellé explicite d'abord, puis montant mensuel du titre.
    const base = amountAfter(text, 'loyer (?:de base|hors complément)');
    if (base != null) out.base = base;
    const hc = amountAfter(text, 'loyer (?:mensuel )?(?:hors charges|hc)\\b');
    const cc = amountAfter(text, 'loyer (?:mensuel )?(?:charges comprises|cc|cac)\\b') ?? amountAfter(text, 'loyer (?:mensuel )?(?:toutes charges comprises|tcc)\\b');
    if (hc != null) { out.amount = hc; out.chargesIncluded = false; }
    else if (cc != null) { out.amount = cc; out.chargesIncluded = true; }
    else {
      const m = new RegExp(`${NUM}\\s*€\\s*(?:\\/\\s*mois|par mois|mensuel|cc\\b|c\\.c\\.|hc\\b|charges comprises|hors charges)`, 'i').exec(header) ||
        new RegExp(`${NUM}\\s*€`, 'i').exec(header) ||
        new RegExp(`loyer(?: mensuel)?\\s*:?\\s*${NUM}\\s*€`, 'i').exec(text);
      if (m) {
        out.amount = parseAmount(m[1]);
        const around = text.slice(Math.max(0, text.indexOf(m[0]) - 10), text.indexOf(m[0]) + m[0].length + 30);
        if (/hors charges|\bhc\b/i.test(around)) out.chargesIncluded = false;
        else if (/charges comprises|\bcc\b|c\.c\./i.test(around)) out.chargesIncluded = true;
      }
    }
    const chargesLabel = /(?:provisions?\s+(?:sur|pour)\s+charges|charges\s+(?:locatives|mensuelles|forfaitaires|récupérables)|forfait\s+(?:de\s+)?charges|charges(?!\s+comprises)(?!\s+incluses))/.source;
    const charges = amountAfter(text, chargesLabel) ?? (() => {
      const m = new RegExp(`(?:dont|soit)\\s*${NUM}\\s*€\\s*(?:de\\s+)?(?:provisions?\\s+(?:sur|pour|de)\\s+)?charges`, 'i').exec(text);
      return m ? parseAmount(m[1]) : null;
    })();
    if (charges != null && (out.amount == null || charges < out.amount)) out.charges = charges;

    const complement = amountAfter(text, 'compl[ée]ment de loyer');
    if (complement != null) out.complement = complement;
    else if (/(?:pas de|aucun|sans)\s+compl[ée]ment de loyer/i.test(text)) out.complement = 0;

    const announced = new RegExp(`loyer de r[ée]f[ée]rence major[ée][^\\d\\n]{0,20}?${NUM}\\s*(?:€|eur)`, 'i').exec(text);
    if (announced) out.announcedCeiling = parseAmount(announced[1]);

    const year = text.match(/(?:construit|construction|bâti|bati|édifié|immeuble|résidence)\s+(?:en|de|:|daté de|datant de)?\s*(?:l'année\s+)?((?:1[6-9]|20)\d{2})\b/i);
    if (year && Number(year[1]) <= new Date().getFullYear()) out.construction = { from: Number(year[1]), to: Number(year[1]), label: year[1] };
    else if (/haussmann/i.test(text)) out.construction = { from: null, to: 1945, label: 'Haussmannien (avant 1946)', inferred: true };

    const dpe = text.match(/(?:\bDPE\b|classe (?:[ée]nergie|[ée]nerg[ée]tique)|[ée]tiquette [ée]nergie|performance [ée]nerg[ée]tique)\s*:?\s*(?:classe\s*)?\(?([A-G])\b(?![a-z])/i);
    if (dpe) out.dpe = dpe[1].toUpperCase();

    out.location = locationFromText(header) || locationFromText(page.description);
    out.rental = RENTAL.test(`${page.url} ${header}`) && !SALE.test(header) ? true : SALE.test(header) ? false : null;
    out.roomShare = ROOM_SHARE.test(header);
    out.notHousing = NOT_HOUSING.test(header) && !/\b(appartement|maison|studio|loft|duplex)\b/i.test(header);
    return out;
  }

  // --- Pages d'annonce reconnues (les pages de résultats sont ignorées) ---

  const DETAIL = {
    'leboncoin.fr': /\/(?:ad\/locations|locations)\/\d+|\/ad\/[^/]+\/\d+/,
    'seloger.com': /\/annonces\/locations\/|\/annonces\/[^/]+\/\d+\.htm/,
    'pap.fr': /\/annonces\/[^/]*-r\d+/,
    'bienici.com': /\/annonce\/location\//,
    'logic-immo.com': /detail-location|\/location-immobilier\/.+\d/,
    'immobilier.lefigaro.fr': /\/annonces\/annonce-\d+/,
    'orpi.com': /\/annonce-location-/,
    'century21.fr': /\/trouver_logement\/detail\//,
    'laforet.com': /\/agence-immobiliere\/.+\/louer\//,
    'foncia.com': /\/location\/.+\d{5,}/,
    'nexity.fr': /\/annonce-location-/,
    'guy-hoquet.com': /\/biens\/result\/|\/annonce\//,
    'paruvendu.fr': /\/immobilier\/location\/.+\d/,
    'lodgis.com': /\/location-meublee\/|\/appartement-/,
    'locservice.fr': /\/location-/,
    'studapart.com': /\/accommodation\//,
  };

  function detailPage(page) {
    const site = Object.keys(DETAIL).find((d) => page.host === d || page.host.endsWith(`.${d}`));
    return site ? DETAIL[site].test(new URL(page.url).pathname) : null;
  }

  /** Fusion d'objets où une valeur vide (null, undefined, '') ne remplace pas une valeur connue. */
  function merge(...objects) {
    const out = {};
    for (const o of objects) for (const [k, v] of Object.entries(o || {})) if (v !== undefined && v !== null && v !== '') out[k] = v;
    return out;
  }

  function parseListing(page) {
    const lbc = fromLeboncoin(page) || {};
    const ld = fromJsonLd(page);
    const txt = fromText(page);
    const pick = (key) => [lbc[key], ld[key], txt[key]].find((v) => v !== undefined && v !== null);

    const detail = detailPage(page);
    if (detail === false) return null;
    const rental = lbc.rental ?? txt.rental;
    if (rental === false) return null;

    // Le texte de l'annonce Leboncoin (description) complète ce que le titre ne dit pas.
    const more = lbc.text ? fromText({ ...page, h1: lbc.title || '', ogTitle: '', title: '', description: '', body: lbc.text }) : {};

    const listing = {
      site: lbc.site || page.host,
      url: page.url,
      title: lbc.title || txt.header.split(' | ')[0] || ld.title || '',
      propertyType: lbc.propertyType || (txt.header.match(/\b(appartement|maison|studio|loft|duplex|chambre)\b/i)?.[1] || ''),
      surface: pick('surface'),
      rooms: pick('rooms'),
      furnished: lbc.furnished ?? txt.furnished ?? null,
      construction: lbc.construction || more.construction || txt.construction || null,
      dpe: lbc.dpe || txt.dpe || null,
      rent: {
        amount: pick('amount') ?? null,
        chargesIncluded: lbc.chargesIncluded ?? txt.chargesIncluded ?? null,
        charges: txt.charges ?? null,
        complement: txt.complement ?? null,
        base: txt.base ?? null,
      },
      announcedCeiling: txt.announcedCeiling ?? null,
      location: merge(txt.location, ld.location, lbc.location),
      roomShare: Boolean(lbc.roomShare || txt.roomShare),
    };
    if (lbc.text) {
      listing.furnished ??= more.furnished ?? null;
      listing.dpe ??= more.dpe;
      listing.rent.charges ??= more.charges ?? null;
      listing.rent.complement ??= more.complement ?? null;
      listing.rent.base ??= more.base ?? null;
      listing.announcedCeiling ??= more.announcedCeiling ?? null;
    }
    if (txt.notHousing && !lbc.site) return null;

    // Une annonce, c'est au moins un loyer et une surface ou un nombre de pièces, quelque part en France.
    const located = listing.location.postcode || listing.location.city || Number.isFinite(listing.location.lat);
    const enough = listing.rent.amount != null && (listing.surface || listing.rooms) && located;
    if (!enough && !(detail && rental && located)) return null;
    if (listing.rent.amount != null && (listing.rent.amount < 100 || listing.rent.amount > 20000)) return null;
    return listing;
  }

  function extractListing(doc, loc) {
    try {
      return parseListing(gatherPage(doc, loc));
    } catch (error) {
      console.warn('[Check mon loyer] lecture de l’annonce', error);
      return null;
    }
  }

  globalThis.LoyerExtract = { extractListing, parseListing, gatherPage, parseAmount };
})();
