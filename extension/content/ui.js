// Interface de Check mon loyer : pastille flottante + panneau (Shadow DOM fermé), et rendu du verdict
// réutilisé par la fenêtre de l'extension (popup). Tout le contenu est inséré en texte, jamais en HTML.
(() => {
  'use strict';

  // --- Petits utilitaires DOM ---

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'text') el.textContent = value;
      else if (key === 'style') el.style.cssText = value;
      else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else el.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
  }

  const ICONS = {
    home: ['M3 11l9-7 9 7', 'M5 10v10h14V10', 'M10 20v-6h4v6'],
    refresh: ['M20 11a8 8 0 1 0-2.3 5.7', 'M20 4v7h-7'],
    minus: ['M6 12h12'],
    external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
    lock: ['M6 11h12v10H6z', 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3'],
    check: ['M5 12.5l4.5 4.5L19 7.5'],
    alert: ['M12 8v5', 'M12 16.5v.5', 'M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'],
    // Panneau « stop » : loyer au-dessus du plafond, distinct du triangle d'avertissement (dépassement possible).
    stop: ['M12 7.5v5', 'M12 16v.5', 'M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86z'],
    info: ['M12 11v5', 'M12 7.5v.5', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z'],
    offline: ['M3 3l18 18', 'M5.8 5.8A7 7 0 0 0 9 19h8.5c.5 0 .9-.1 1.3-.2', 'M21.5 16.5A4.5 4.5 0 0 0 17.5 10h-1.8A7 7 0 0 0 10 5.1'],
    help: ['M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6', 'M12 17v.5', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z'],
  };

  function icon(name, size = 16) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.9', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) svg.setAttribute(k, v);
    for (const d of ICONS[name]) {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d);
      svg.append(path);
    }
    return svg;
  }

  const POLICY_URL = 'https://github.com/Bublex/check-mon-loyer/blob/main/CONFIDENTIALITE.md';
  const safeUrl = (url) => (/^https:\/\//i.test(String(url || '')) ? url : null);
  const euroFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
  const m2Fmt = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nb = (s) => s.replace(/\u202f/g, '\u00a0');
  const eur = (n) => `${nb(euroFmt.format(n))}\u00a0€`;
  const perM2 = (n) => `${nb(m2Fmt.format(n))}\u00a0€/m²`;
  const m2 = (n) => `${nb(euroFmt.format(n))}\u00a0m²`;

  /** Pourcentage arrondi, jamais 0 % ni 100 % pour un verdict qui reste incertain. */
  const percent = (p) => `${Math.min(99, Math.max(1, Math.round(p * 100)))}\u00a0%`;

  const riskLevel = (p) => (p == null ? 'Dépassement possible' : p >= 0.67 ? 'Dépassement probable' : p >= 0.33 ? 'Dépassement possible' : 'Dépassement peu probable');

  function joinFr(list) {
    if (list.length < 2) return list.join('');
    return `${list.slice(0, -1).join(', ')} et ${list[list.length - 1]}`;
  }

  const SPREAD = {
    period: 'l’époque de construction',
    furnished: 'le type de location (vide ou meublée)',
    kind: 'le type de logement (appartement ou maison)',
    address: 'l’adresse exacte',
    zone: 'le secteur',
    rooms: 'le nombre de pièces',
    charges: 'le montant des charges',
  };
  const MISSING = { surface: 'la surface habitable', rooms: 'le nombre de pièces', rent: 'le loyer' };

  // --- Époques proposées dans le formulaire (couvrent les découpages de toutes les grilles) ---

  const PERIODS = [
    ['', 'Je ne sais pas'],
    ['avant1946', 'Avant 1946', { from: null, to: 1945 }],
    ['1946-1970', '1946 à 1970', { from: 1946, to: 1970 }],
    ['1971-1990', '1971 à 1990', { from: 1971, to: 1990 }],
    ['1991-2005', '1991 à 2005', { from: 1991, to: 2005 }],
    ['apres2005', 'Après 2005', { from: 2006, to: null }],
  ];

  function periodChoice(construction) {
    if (!construction) return '';
    if (construction.inferred) return 'inferred';
    if (construction.from != null && construction.from === construction.to) return `year:${construction.from}`;
    const hit = PERIODS.find(([, , range]) => range && range.from === construction.from && range.to === construction.to);
    return hit ? hit[0] : 'current';
  }

  function constructionFromChoice(value) {
    if (!value) return null;
    if (value.startsWith('year:')) {
      const y = Number(value.slice(5));
      return { from: y, to: y, label: String(y) };
    }
    const hit = PERIODS.find(([key]) => key === value);
    return hit?.[2] ? { ...hit[2], label: hit[1] } : null;
  }

  // --- Résumé (pastille) ---

  function placeName(state) {
    const p = state.result?.place;
    const l = state.inputs?.location || {};
    return p?.city || l.city || '';
  }

  function summarize(state) {
    if (state.loading) return { tone: 'load', busy: true, title: 'Vérification de l’encadrement…', detail: placeName(state) };
    if (state.error) return { tone: 'none', icon: 'offline', title: 'Vérification impossible', detail: state.error };
    const r = state.result;
    if (!r) return { tone: 'info', title: 'Encadrement des loyers', detail: 'Vérifier ce loyer' };
    const v = r.verdict || {};
    switch (r.status) {
      case 'over': {
        const exact = v.ceiling.low === v.ceiling.high;
        return { tone: 'err', icon: 'stop', final: true, title: 'Loyer au-dessus du plafond', detail: `${exact ? '' : 'Au moins '}${eur(v.overBy)} de trop par mois` };
      }
      case 'under':
        return { tone: 'ok', icon: 'check', final: true, title: 'Loyer conforme', detail: `${eur(v.margin)} sous le plafond` };
      case 'depends':
        return { tone: 'wait', icon: 'alert', title: riskLevel(v.probability),
          detail: [v.probability != null ? `${percent(v.probability)} de risque` : null, v.spread.length ? `selon ${SPREAD[v.spread[0]]}` : null].filter(Boolean).join(', ').replace(/^s/, 'S') || 'À préciser' };
      case 'incomplete':
        return { tone: 'info', title: 'Loyer encadré : à compléter', detail: v.missing?.length ? `Précisez ${MISSING[v.missing[0]]}` : 'Informations manquantes' };
      case 'nosource':
        return { tone: 'info', title: `Loyer encadré à ${r.territory.name}`, detail: 'Plafond à vérifier sur le simulateur officiel' };
      case 'nodata':
        return { tone: 'info', title: 'Loyer encadré', detail: 'Grille introuvable pour cette adresse' };
      case 'notcovered':
        return { tone: 'none', title: 'Pas d’encadrement des loyers ici', detail: r.place?.city || '' };
      case 'nolocation':
        return { tone: 'info', title: 'Adresse à préciser', detail: 'Pour vérifier l’encadrement' };
      case 'roomshare':
        return { tone: 'none', title: 'Colocation', detail: 'Non vérifiée par Check mon loyer' };
      default:
        return { tone: 'info', title: 'Encadrement des loyers', detail: '' };
    }
  }

  // --- Verdict détaillé ---

  function rentLine(v, inputs) {
    const rent = inputs.listing?.rent || {};
    const hc = v.rentHC;
    if (!hc) return null;
    if (v.baseRent) return `${eur(hc.hi)} de loyer de base`;
    const complement = rent.complement > 0 ? `, hors complément de loyer de ${eur(rent.complement)}` : '';
    if (hc.lo == null) return `Au plus ${eur(hc.hi)} hors charges (${eur(rent.amount)} charges comprises, charges non précisées${complement})`;
    if (rent.chargesIncluded === false) return `${eur(hc.lo)} hors charges${complement}`;
    return `${eur(hc.lo)} hors charges (${eur(rent.amount)} − ${eur(rent.charges)} de charges${complement})`;
  }

  function ceilingLine(v, inputs) {
    const surface = inputs.listing?.surface;
    if (!v.perM2) return null;
    if (!v.ceiling) return v.perM2.min === v.perM2.max ? `Plafond : ${perM2(v.perM2.max)} hors charges` : `Plafond : ${perM2(v.perM2.min)} à ${perM2(v.perM2.max)} hors charges`;
    if (v.ceiling.low === v.ceiling.high) return `Plafond : ${perM2(v.perM2.max)} × ${m2(surface)} = ${eur(v.ceiling.high)} hors charges`;
    return `Plafond : entre ${eur(v.ceiling.low)} et ${eur(v.ceiling.high)} hors charges (${perM2(v.perM2.min)} à ${perM2(v.perM2.max)} × ${m2(surface)})`;
  }

  /**
   * Jauge : le loyer hors charges (curseur) face au plafond légal (un repère, ou une bande hachurée
   * quand le plafond dépend d'une inconnue). Vert sous le plafond, rouge au-dessus.
   */
  function renderGauge(v, status) {
    const unsure = v.rentHC.lo == null;
    const rent = unsure ? v.rentHC.hi : v.rentHC.lo;
    const { low, high } = v.ceiling;
    const min = Math.min(low, rent);
    const max = Math.max(high, rent);
    const pad = Math.max((max - min) * 0.35, high * 0.12, 1);
    const from = Math.max(0, min - pad);
    const to = max + pad;
    const at = (x) => Math.round(((x - from) / (to - from)) * 1000) / 10;
    const [a, b, r] = [at(low), at(high), at(rent)];
    const mid = (a + b) / 2;
    const exact = low === high;
    const tone = status === 'over' ? 'err' : status === 'under' ? 'ok' : 'wait';
    const rentText = unsure ? `Au plus ${eur(rent)}` : `Loyer ${eur(rent)}`;
    const ceilingText = exact ? `Plafond ${eur(high)}` : `Plafond incertain : ${nb(euroFmt.format(low))} à ${eur(high)}`;
    const label = `Loyer hors charges : ${unsure ? 'au plus ' : ''}${eur(rent)}. Plafond légal : ${exact ? eur(high) : `entre ${eur(low)} et ${eur(high)}`}.`;
    return h('div', { class: `gauge tone-${tone}`, role: 'img', 'aria-label': label, style: `--a: ${a}%; --b: ${b}%; --r: ${r}%` },
      h('div', { class: 'gauge-labels' },
        h('span', { class: 'gauge-rent', style: `left: ${r}%; transform: translateX(-${r}%)` }, rentText)),
      h('div', { class: 'gauge-track' },
        h('span', { class: exact ? 'gauge-band is-exact' : 'gauge-band' }),
        unsure ? h('span', { class: 'gauge-tail' }) : null,
        h('span', { class: 'gauge-needle' })),
      h('div', { class: 'gauge-labels' },
        h('span', { class: 'gauge-ceiling', style: `left: ${exact ? b : mid}%; transform: translateX(-${exact ? b : mid}%)` }, ceilingText)),
      h('div', { class: 'gauge-caption' }, 'Montants par mois, hors charges'));
  }

  function headline(r) {
    const v = r.verdict || {};
    switch (r.status) {
      case 'over': {
        const amount = v.ceiling.low === v.ceiling.high ? `de ${eur(v.overBy)}` : `d’au moins ${eur(v.overBy)}`;
        return ['err', 'stop', 'Loyer au-dessus du plafond légal', `Le loyer hors charges le dépasse ${amount} par mois.`];
      }
      case 'under':
        return ['ok', 'check', 'Loyer conforme à l’encadrement', `Il reste ${eur(v.margin)} sous le plafond.`];
      case 'depends':
        return ['wait', 'alert', riskLevel(v.probability), `Selon ${joinFr(v.spread.map((k) => SPREAD[k]))}.`];
      case 'incomplete':
        return ['info', 'info', 'Informations manquantes', `Indiquez ${joinFr((v.missing || []).map((k) => MISSING[k]))} pour calculer le plafond.`];
      case 'nosource':
        return ['info', 'info', `Loyer encadré à ${r.territory.name}`,
          `${r.territory.partial ? 'L’encadrement s’applique à tout ou partie de cette commune. ' : ''}Check mon loyer ne calcule pas encore le plafond de ce territoire : vérifiez-le sur le simulateur officiel.`];
      case 'nodata':
        return ['info', 'info', 'Grille introuvable', 'Le service de données ne renvoie pas de loyer de référence pour cette adresse. Vérifiez-la, ou consultez le simulateur officiel.'];
      case 'notcovered':
        return ['none', 'home', 'Pas d’encadrement des loyers ici',
          `${r.place?.city ? `${r.place.city} n’applique` : 'Cette commune n’applique'} pas l’encadrement du niveau des loyers. En zone tendue, le loyer ne peut en principe pas augmenter entre deux locataires.`];
      case 'nolocation':
        return ['info', 'info', 'Adresse introuvable', r.addressNotFound
          ? `« ${r.addressNotFound} » n’a pas été trouvée dans la Base Adresse Nationale. Vérifiez l’orthographe, ajoutez le code postal et la ville.`
          : 'Indiquez l’adresse ou la ville du logement ci-dessous.'];
      case 'roomshare':
        return ['none', 'home', 'Colocation', 'Les baux de colocation et les chambres ne sont pas encore vérifiés par Check mon loyer.'];
      default:
        return ['info', 'info', 'Encadrement des loyers', ''];
    }
  }

  // --- Astuces pour répondre aux questions (« Comment savoir ? ») ---

  const IGN_URL = 'https://remonterletemps.ign.fr/';

  // Indices d'époque autour de chaque seuil des grilles, et ce que montrent les photos aériennes de l'IGN.
  const ERA_CLUES = {
    1946: {
      before: 'pierre de taille, style haussmannien, moulures, cheminées, parquet en chevrons, plafonds de 2,80 m et plus. À Bordeaux : échoppes, pierre blonde.',
      after: 'béton, façade lisse, grands ensembles, plafonds de 2,50 m environ.',
      photo: 'un immeuble absent des photos 1950-1965 date d’après 1946',
    },
    1971: {
      before: 'reconstruction, barres et tours en béton, panneaux préfabriqués, vide-ordures.',
      after: 'isolation d’origine (obligatoire depuis 1974), balcons filants, parking en sous-sol.',
      photo: 'un immeuble visible sur les photos 1950-1965 date d’avant 1971',
    },
    1991: {
      before: 'façades en béton, en brique ou carrelées, menuiseries en aluminium.',
      after: 'double vitrage d’origine, parking en sous-sol, ascenseur, digicode.',
    },
    2006: {
      after: '« livré en 20XX », « BBC », « RT 2012 », « Pinel », DPE en A ou B.',
      photo: 'un immeuble absent des photos 2000-2005 date d’après 2005',
    },
  };

  const TIPS = {
    period: ({ year }) => {
      const era = ERA_CLUES[year] || {};
      return {
        clues: [era.before && [`Avant ${year}`, era.before], era.after && [`${year} ou après`, era.after]].filter(Boolean),
        sure: [
          'Le bail doit indiquer la période de construction : demandez-la à l’agence ou au bailleur.',
          'Le DPE mentionne l’année de construction.',
        ],
        link: [IGN_URL, 'Remonter le temps (IGN)', era.photo ? ` : ${era.photo}.` : ' : photos aériennes anciennes de l’adresse.'],
      };
    },
    furnished: () => ({
      clues: [
        ['Dépôt de garantie', '2 mois de loyer au plus en meublé, 1 mois en vide.'],
        ['Durée du bail', '1 an (9 mois pour un étudiant) en meublé, 3 ans en vide.'],
        ['Équipement', 'un meublé fournit literie, plaques, four ou micro-ondes, réfrigérateur avec congélateur, vaisselle, table, chaises et rangements.'],
      ],
      sure: [],
    }),
    kind: () => ({
      clues: [
        ['Maison', 'logement individuel avec sa propre entrée. À Bordeaux, une échoppe est une maison.'],
        ['Appartement', 'logement dans un immeuble collectif, duplex compris.'],
      ],
      sure: [],
    }),
    charges: () => ({
      clues: [
        ['Dans l’annonce', 'cherchez « provisions sur charges », « dont charges » ou « charges : … € ».'],
        ['Sinon', 'demandez-le à l’agence ou au bailleur : le montant figure dans le bail.'],
      ],
      sure: [],
    }),
    rooms: () => ({
      clues: [
        ['Pièces principales', 'séjour et chambres ; cuisine, salle de bains, WC et couloir ne comptent pas.'],
        ['T2 ou F2', '2 pièces principales.'],
      ],
      sure: [],
    }),
    address: () => ({
      clues: [
        ['Dans l’annonce', 'la carte situe souvent le logement à quelques rues près ; une photo de façade permet de retrouver l’immeuble sur Street View.'],
        ['Sinon', 'demandez l’adresse à l’agence ou au bailleur : le numéro et la rue suffisent.'],
      ],
      sure: [],
    }),
  };

  let tipCount = 0;

  /**
   * Infobulle « Comment savoir ? » : s'ouvre au survol ou au clic (le clic la garde ouverte), se ferme avec Échap
   * ou quand le focus la quitte. Elle s'ouvre vers le haut quand la place manque en dessous.
   */
  function renderTip(question) {
    const tips = TIPS[question.topic]?.(question);
    if (!tips || (!tips.clues.length && !tips.sure.length)) return null;
    const id = `cml-tip-${++tipCount}`;
    const url = tips.link && safeUrl(tips.link[0]);
    const sources = [...tips.sure.map((t) => h('li', null, t)),
      url ? h('li', null, h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, tips.link[1], icon('external', 12)), tips.link[2]) : null].filter(Boolean);
    const pop = h('div', { class: 'tip-pop', id },
      tips.clues.map(([label, text]) => h('p', null, h('strong', null, `${label} : `), text)),
      sources.length ? [h('div', { class: 'tip-sure' }, 'Pour en être sûr'), h('ul', null, sources)] : null);
    const tip = h('div', { class: 'tip' });
    let pinned = false;
    let timer = null;

    const place = () => {
      pop.classList.remove('up');
      pop.style.maxHeight = '';
      const box = (tip.closest('.body') || document.documentElement).getBoundingClientRect();
      const anchor = (tip.closest('.question') || tip).getBoundingClientRect();
      const below = Math.min(box.bottom, innerHeight) - anchor.bottom - 12;
      const above = anchor.top - Math.max(box.top, 0) - 12;
      const up = pop.offsetHeight > below && above > below;
      pop.classList.toggle('up', up);
      if (pop.offsetHeight > Math.max(above, below)) pop.style.maxHeight = `${Math.max(above, below, 120)}px`;
    };
    const show = () => {
      clearTimeout(timer);
      if (tip.classList.contains('is-open')) return;
      tip.classList.add('is-open');
      button.setAttribute('aria-expanded', 'true');
      place();
    };
    const hide = () => {
      clearTimeout(timer);
      pinned = false;
      tip.classList.remove('is-open');
      button.setAttribute('aria-expanded', 'false');
    };
    const hideSoon = () => {
      clearTimeout(timer);
      if (!pinned) timer = setTimeout(hide, 250);
    };

    const button = h('button', { class: 'tip-btn', type: 'button', 'aria-expanded': 'false', 'aria-controls': id,
      onclick: () => { if (pinned) hide(); else { pinned = true; show(); } } }, icon('help', 14), 'Comment savoir ?');
    for (const el of [button, pop]) {
      el.addEventListener('mouseenter', show);
      el.addEventListener('mouseleave', hideSoon);
    }
    tip.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && tip.classList.contains('is-open')) { e.stopPropagation(); hide(); button.focus(); }
    });
    tip.addEventListener('focusout', (e) => { if (pinned && !tip.contains(e.relatedTarget)) hide(); });
    tip.append(button, pop);
    return tip;
  }

  // --- Suggestions d'adresses ---

  let comboCount = 0;

  /**
   * Suggestions sous un champ d'adresse (combobox ARIA) : flèches pour parcourir, Entrée pour retenir, Échap pour fermer.
   * Les adresses viennent de handlers.suggestAddress (Base Adresse Nationale, limitée à la ville du logement).
   */
  function withSuggestions(input, handlers, onPick) {
    if (!handlers.suggestAddress) return input;
    const id = `cml-suggest-${++comboCount}`;
    const list = h('ul', { class: 'suggest', id, role: 'listbox', hidden: true });
    let items = [];
    let active = -1;
    let timer = null;
    let seq = 0;
    for (const [k, v] of Object.entries({ role: 'combobox', autocomplete: 'off', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': id })) input.setAttribute(k, v);

    const close = () => {
      seq++;
      clearTimeout(timer);
      list.hidden = true;
      active = -1;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    };
    const highlight = (i) => {
      active = i;
      [...list.children].forEach((li, j) => li.setAttribute('aria-selected', String(j === i)));
      if (i >= 0) {
        input.setAttribute('aria-activedescendant', `${id}-${i}`);
        list.children[i].scrollIntoView({ block: 'nearest' });
      }
    };
    const pick = (item) => {
      input.value = item.label;
      close();
      onPick?.(item);
    };
    const show = ({ items: found = [], city } = {}) => {
      items = found;
      active = -1;
      list.replaceChildren(...(found.length
        ? found.map((item, i) => h('li', { id: `${id}-${i}`, role: 'option', 'aria-selected': 'false', onmousedown: (e) => { e.preventDefault(); pick(item); } }, item.label))
        : [h('li', { class: 'suggest-empty', 'aria-disabled': 'true' }, `Aucune adresse trouvée${city ? ` à ${city}` : ''}`)]));
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      input.removeAttribute('aria-activedescendant');
    };

    input.addEventListener('input', () => {
      clearTimeout(timer);
      const n = ++seq;
      const q = input.value.trim();
      if (q.length < 3) return close();
      timer = setTimeout(async () => {
        const found = await Promise.resolve(handlers.suggestAddress(q)).catch(() => null);
        if (n === seq && found) show(found);
      }, 220);
    });
    input.addEventListener('keydown', (e) => {
      if (list.hidden) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (items.length) highlight(e.key === 'ArrowDown' ? (active + 1) % items.length : (active <= 0 ? items.length : active) - 1);
      } else if (e.key === 'Enter' && active >= 0) {
        e.preventDefault();
        pick(items[active]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    });
    input.addEventListener('blur', close);
    return h('div', { class: 'combo' }, input, list);
  }

  // --- Questions pour compléter ---

  // Réponse saisie → correction envoyée au calcul.
  const ANSWERS = {
    charges: (value) => ({ rent: { charges: value, chargesIncluded: true } }),
    address: (value) => ({ address: value }),
  };

  /**
   * Question pour compléter une information manquante, une à la fois : oui/non (époque, meublé, maison), choix
   * (pièces), montant (charges) ou adresse. La réponse relance le calcul ; « Je ne sais pas » passe à la suivante.
   */
  function renderQuestion(question, state, handlers) {
    const answer = (edits) => handlers.onEdit?.(edits);
    const skipped = state.inputs?.listing?.skipped || [];
    const skip = h('button', { class: 'answer secondary', type: 'button', onclick: () => answer({ skipped: [...skipped, question.topic] }) }, 'Je ne sais pas');
    const head = [h('div', { class: 'question-text', id: `cml-q-${question.topic}` }, question.text), renderTip(question)];

    if (question.type === 'number' || question.type === 'text') {
      const isAddress = question.type === 'text';
      const city = state.result?.place?.city || '';
      const input = h('input', isAddress
        ? { type: 'text', name: 'answer', placeholder: `Ex. 12 rue Victor-Hugo${city ? `, ${city}` : ''}`, value: state.inputs?.location?.address || '', 'aria-labelledby': `cml-q-${question.topic}` }
        : { type: 'number', name: 'answer', min: '0', step: '1', inputmode: 'decimal', 'aria-labelledby': `cml-q-${question.topic}`, 'aria-describedby': `cml-q-${question.topic}-u` });
      const error = h('p', { class: 'question-error', role: 'alert', hidden: true });
      const fail = (message) => {
        error.textContent = message;
        error.hidden = false;
        input.setAttribute('aria-invalid', 'true');
        input.focus();
      };
      const submit = (value) => answer(ANSWERS[question.topic](value));
      const form = h('form', {
        class: 'question-form',
        novalidate: true,
        onsubmit: (e) => {
          e.preventDefault();
          const raw = input.value.trim();
          if (isAddress) {
            if (raw.length < 3) return fail('Indiquez au moins le nom de la rue.');
            return submit(raw);
          }
          const value = Number(raw.replace(',', '.'));
          const amount = state.inputs?.listing?.rent?.amount;
          if (!raw || !Number.isFinite(value) || value < 0 || (amount && value >= amount)) {
            return fail(amount ? `Indiquez un montant de charges inférieur à ${eur(amount)}.` : 'Indiquez un montant en euros.');
          }
          return submit(value);
        },
      },
      isAddress ? withSuggestions(input, handlers, (item) => submit(item.label)) : h('span', { class: 'with-unit' }, input, h('span', { class: 'question-unit', id: `cml-q-${question.topic}-u` }, '€ / mois')),
      h('button', { class: 'answer', type: 'submit' }, 'Valider'), isAddress ? null : skip);
      return h('div', { class: 'question', role: 'group', 'aria-labelledby': `cml-q-${question.topic}` }, head, form, error,
        isAddress && city && handlers.suggestAddress ? h('p', { class: 'question-hint' }, `Suggestions limitées à ${city}.`) : null,
        isAddress ? h('div', { class: 'question-actions' }, skip) : null);
    }

    const choices = question.type === 'choice'
      ? question.options.map(([value, label]) => h('button', { class: 'answer', type: 'button', onclick: () => answer({ [question.topic]: value }) }, label))
      : [h('button', { class: 'answer', type: 'button', onclick: () => answer(question.yes) }, 'Oui'),
        h('button', { class: 'answer', type: 'button', onclick: () => answer(question.no) }, 'Non')];
    return h('div', { class: 'question', role: 'group', 'aria-labelledby': `cml-q-${question.topic}` }, head, h('div', { class: 'question-actions' }, choices, skip));
  }

  function renderVerdict(state, handlers = {}) {
    const r = state.result;
    const v = r.verdict || {};
    const inputs = state.inputs || {};
    const [tone, ico, title, text] = headline(r);
    const gauge = v.rentHC && v.ceiling;
    const lines = [];
    if (!gauge && v.rentHC) lines.push(['Loyer demandé', rentLine(v, inputs)]);
    if (!gauge && v.perM2) lines.push(['Maximum légal', ceilingLine(v, inputs).replace(/^Plafond : /, '')]);
    const announced = inputs.announcedCeiling;
    const out = [
      h('div', { class: `verdict tone-${tone}${['over', 'under'].includes(r.status) ? ' is-final' : ''}` },
        h('div', { class: 'verdict-head' },
          h('div', { class: 'verdict-icon' }, icon(ico, 16)),
          h('div', { class: 'verdict-title', tabindex: '-1', role: 'heading', 'aria-level': '2' }, title),
          v.probability != null ? h('span', { class: 'risk', title: 'Part des cas possibles où le loyer dépasse le plafond' }, `Risque ${percent(v.probability)}`) : null),
        text ? h('p', null, text) : null,
        gauge ? renderGauge(v, r.status) : null),
      v.question ? renderQuestion(v.question, state, handlers) : null,
      // Toutes les questions passées : on peut les reprendre.
      r.status === 'depends' && !v.question && inputs.listing?.skipped?.length
        ? h('button', { class: 'link resume', type: 'button', onclick: () => handlers.onEdit?.({ skipped: [] }) }, 'Reprendre les questions') : null,
      lines.length ? h('dl', { class: 'figures' }, lines.flatMap(([k, val]) => [h('dt', null, k), h('dd', null, val)])) : null,
    ];
    // Ce que l'adresse saisie a donné : l'adresse retenue, ou l'échec du géocodage.
    if (r.place?.addressNotFound) {
      out.push(h('p', { class: 'note warn' }, `Adresse « ${r.place.addressNotFound} » introuvable : le calcul porte sur ${r.place.approximate ? 'le quartier de l’annonce' : 'la position de l’annonce'}. Vérifiez l’orthographe ou ajoutez le code postal.`));
    } else if (r.place?.source === 'address') {
      const precision = r.place.precision === 'housenumber' ? '' : ' (rue trouvée, numéro non reconnu)';
      out.push(h('p', { class: 'note' }, `Adresse retenue : ${r.place.label}${precision}.`));
    }
    if (v.spread?.includes('address') && r.status !== 'depends' && !r.place?.addressNotFound) {
      out.push(h('p', { class: 'note' }, 'L’annonce ne donne pas l’adresse exacte : le plafond couvre les secteurs voisins. Indiquez l’adresse pour l’affiner.'));
    }
    if (v.complementForbidden) out.push(h('p', { class: 'note warn' }, 'Un complément de loyer est demandé alors que le logement est classé F ou G : c’est interdit.'));
    else if (inputs.listing?.rent?.complement > 0) out.push(h('p', { class: 'note' }, `Complément de loyer de ${eur(inputs.listing.rent.complement)} : il n’est permis que pour un logement aux caractéristiques exceptionnelles (localisation, confort) et doit être justifié dans le bail.`));
    if (announced && announced < 100 && v.perM2 && Math.abs(announced - v.perM2.max) > 0.05 && v.perM2.min === v.perM2.max) {
      out.push(h('p', { class: 'note' }, `L’annonce indique un loyer de référence majoré de ${perM2(announced)} ; la grille en vigueur donne ${perM2(v.perM2.max)}.`));
    }
    if (v.assumptions?.length) out.push(h('p', { class: 'note' }, `${v.assumptions.join('. ')}.`));
    if (gauge || v.zones?.length || v.years?.length) {
      const facts = [
        gauge ? `Loyer hors charges : ${rentLine(v, inputs)}` : null,
        gauge ? ceilingLine(v, inputs) : null,
        v.zones?.length ? `${v.zones.length > 1 ? 'Secteurs' : 'Secteur'} : ${v.zones.join(', ')}` : null,
        v.periods?.length ? `Époque${v.periods.length > 1 ? 's' : ''} : ${v.periods.join(', ')}` : null,
        v.years?.length ? `Grille ${v.years.join(', ')}` : null,
        v.probability != null && v.weightSource ? `Risque estimé d’après la répartition des logements de ${v.weightSource.name} par époque de construction (${v.weightSource.source}), les autres inconnues comptant à parts égales` : null,
        v.probability != null && !v.weightSource ? 'Risque estimé en comptant chaque cas possible à parts égales' : null,
        r.place?.approximate ? 'Position approximative : indiquez l’adresse pour affiner' : null,
      ].filter(Boolean);
      out.push(h('details', { class: 'facts' }, h('summary', null, 'Détail du calcul'), h('ul', null, facts.map((f) => h('li', null, f)))));
    }
    const official = safeUrl(r.territory?.officialUrl);
    if (official && r.status !== 'under') out.push(h('a', { class: v.question ? 'cta secondary' : 'cta', href: official, target: '_blank', rel: 'noopener noreferrer' }, 'Simulateur et informations officielles', icon('external', 14)));
    return out;
  }

  // --- Formulaire de correction ---

  function field(label, control, hint) {
    return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('span', { class: 'field-hint' }, hint) : null);
  }

  function select(name, options, value) {
    return h('select', { name }, options.map(([v, label]) => h('option', { value: v, selected: String(v) === String(value ?? '') }, label)));
  }

  function renderForm(state, handlers, { open = false, submitLabel = 'Recalculer' } = {}) {
    const listing = state.inputs?.listing || {};
    const loc = state.inputs?.location || {};
    const rent = listing.rent || {};
    const construction = listing.construction;
    const periodOptions = [...PERIODS.map(([k, label]) => [k, label])];
    const choice = periodChoice(construction);
    if (choice.startsWith('year:')) periodOptions.splice(1, 0, [choice, `Construit en ${choice.slice(5)}`]);
    else if (choice === 'inferred' || choice === 'current') periodOptions.splice(1, 0, [choice, construction.label || 'Époque précisée']);

    const form = h('form', { class: 'form', novalidate: true },
      field('Adresse du logement', withSuggestions(h('input', { name: 'address', type: 'text', autocomplete: 'street-address', placeholder: 'Ex. 12 rue Oberkampf, Paris', value: loc.address || '' }), handlers),
        loc.address ? null : [loc.district, loc.postcode, loc.city].filter(Boolean).join(' ') || null),
      h('div', { class: 'row' },
        field('Surface habitable', h('input', { name: 'surface', type: 'number', min: '1', step: '0.1', inputmode: 'decimal', placeholder: 'm²', value: listing.surface ?? '' })),
        field('Pièces', select('rooms', [['', '?'], [1, '1'], [2, '2'], [3, '3'], [4, '4 et plus']], listing.rooms == null ? '' : Math.min(Math.max(listing.rooms, 1), 4)))),
      h('div', { class: 'row' },
        field('Logement', select('kind', [['', 'Je ne sais pas'], ['appartement', 'Appartement'], ['maison', 'Maison']], listing.kind || '')),
        field('Location', select('furnished', [['', 'Je ne sais pas'], ['false', 'Vide'], ['true', 'Meublée']], listing.furnished == null ? '' : String(listing.furnished)))),
      field('Construction', select('period', periodOptions, choice)),
      h('div', { class: 'row' },
        field('Loyer mensuel', h('input', { name: 'amount', type: 'number', min: '0', step: '1', inputmode: 'decimal', placeholder: '€', value: rent.amount ?? '' })),
        field('Affiché', select('chargesIncluded', [['true', 'Charges comprises'], ['false', 'Hors charges']], rent.chargesIncluded === false ? 'false' : 'true'))),
      h('div', { class: 'row' },
        field('Charges', h('input', { name: 'charges', type: 'number', min: '0', step: '1', inputmode: 'decimal', placeholder: '€ / mois', value: rent.charges ?? '' })),
        field('Complément de loyer', h('input', { name: 'complement', type: 'number', min: '0', step: '1', inputmode: 'decimal', placeholder: '€ / mois', value: rent.complement ?? '' }))),
      h('button', { class: 'primary', type: 'submit' }, submitLabel));

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const num = (k) => {
        const s = String(data.get(k) ?? '').replace(',', '.').trim();
        return s === '' || !Number.isFinite(Number(s)) ? null : Number(s);
      };
      const period = String(data.get('period') || '');
      handlers.onEdit?.({
        address: String(data.get('address') || '').trim(),
        surface: num('surface'),
        rooms: num('rooms'),
        furnished: data.get('furnished') === '' ? null : data.get('furnished') === 'true',
        kind: String(data.get('kind') || '') || null,
        construction: period === 'inferred' || period === 'current' ? construction : constructionFromChoice(period),
        rent: { amount: num('amount'), chargesIncluded: data.get('chargesIncluded') !== 'false', charges: num('charges'), complement: num('complement') },
      });
    });
    return h('details', { class: 'edit', open }, h('summary', null, 'Corriger ou compléter les informations'), form);
  }

  const liveRegions = new WeakMap();

  /** Verdict + formulaire, dans le panneau comme dans la fenêtre de l'extension. */
  function renderResult(container, state, handlers, options = {}) {
    const root = container.getRootNode();
    const hadFocus = container.contains(root.activeElement);
    // Recalcul après une réponse : le verdict précédent reste affiché, grisé, au lieu d'être remplacé par une ligne.
    const busy = Boolean(state.loading && state.result && container.querySelector('.verdict'));
    container.classList.toggle('is-busy', busy);
    container.setAttribute('aria-busy', String(Boolean(state.loading)));
    if (busy) {
      container.querySelectorAll('button, input').forEach((el) => el.setAttribute('aria-disabled', 'true'));
      const head = container.querySelector('.verdict-head');
      if (head && !head.querySelector('.spinner')) head.append(h('span', { class: 'spinner', 'aria-hidden': 'true' }));
      return;
    }
    const parts = [];
    if (state.loading) parts.push(h('div', { class: 'loading' }, h('span', { class: 'spinner' }), 'Vérification auprès des données publiques…'));
    else if (state.error) parts.push(h('div', { class: 'verdict tone-none' },
      h('div', { class: 'verdict-head' }, h('div', { class: 'verdict-icon' }, icon('offline', 16)),
        h('div', { class: 'verdict-title', tabindex: '-1', role: 'heading', 'aria-level': '2' }, 'Vérification impossible')),
      h('p', null, `${state.error}. `, h('button', { class: 'link', type: 'button', onclick: () => handlers.onRefresh?.() }, 'Réessayer'))));
    else if (state.result) parts.push(...renderVerdict(state, handlers));
    const status = state.result?.status;
    // Une question est posée : elle suffit, le formulaire complet reste replié.
    const formOpen = options.formOpen ?? (['depends', 'incomplete', 'nolocation', 'nodata'].includes(status) && !state.result?.verdict?.question);
    if (!state.loading && status !== 'roomshare') parts.push(renderForm(state, handlers, { open: formOpen, submitLabel: options.submitLabel }));
    const live = liveRegions.get(container) || liveRegions.set(container, h('div', { class: 'sr-only', 'aria-live': 'polite', 'aria-atomic': 'true' })).get(container);
    container.replaceChildren(...parts.filter(Boolean), live);
    // Nouveau verdict : le focus va à son titre (annoncé par les lecteurs d'écran) au lieu de se perdre ;
    // sans focus dans le panneau, une région vocale invisible annonce le titre et la phrase du verdict.
    const title = container.querySelector('.verdict-title');
    if (hadFocus) title?.focus();
    live.textContent = '';
    if (!hadFocus && !state.loading && title) setTimeout(() => { live.textContent = [title.textContent, container.querySelector('.verdict > p')?.textContent].filter(Boolean).join('. '); }, 60);
  }

  function listingMeta(listing) {
    const f = listing.furnished === true ? 'meublé' : listing.furnished === false ? 'vide' : null;
    return [listing.propertyType, listing.rooms ? `${listing.rooms} pièce${listing.rooms > 1 ? 's' : ''}` : null,
      listing.surface ? m2(listing.surface) : null, f].filter(Boolean).join(' · ');
  }

  // --- Panneau flottant (pages d'annonce) ---

  function mountPanel({ position = 'right', handlers = {} } = {}) {
    const host = document.createElement('div');
    host.setAttribute('data-check-mon-loyer', '');
    const root = host.attachShadow({ mode: 'closed' });
    root.append(h('style', null, CSS));
    const ui = { open: false };
    let last = null;

    const pill = h('button', { class: 'pill', type: 'button', 'aria-expanded': 'false' });
    const bodyEl = h('div', { class: 'body' });
    const headEl = h('div', { class: 'listing' });
    const card = h('section', { class: 'card', role: 'dialog', 'aria-label': 'Check mon loyer : encadrement des loyers', hidden: true },
      h('header', { class: 'card-head' },
        h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, icon('home', 14)), 'Check mon loyer'),
        h('div', { class: 'head-actions' },
          h('button', { class: 'icon-btn', type: 'button', title: 'Actualiser', 'aria-label': 'Vérifier à nouveau', onclick: () => handlers.onRefresh?.() }, icon('refresh', 16)),
          h('button', { class: 'icon-btn', type: 'button', title: 'Réduire', 'aria-label': 'Réduire le panneau', onclick: () => setOpen(false) }, icon('minus', 16)))),
      headEl,
      bodyEl,
      h('footer', { class: 'card-foot' },
        h('a', { class: 'privacy', href: POLICY_URL, target: '_blank', rel: 'noopener noreferrer', title: 'Seule la localisation du logement est envoyée aux services publics de données. Politique de confidentialité' }, icon('lock', 12), 'Sans compte ni statistiques'),
        h('button', { class: 'link', type: 'button', onclick: () => handlers.onHideSite?.() }, 'Masquer sur ce site')));
    const wrap = h('div', { class: 'wrap', 'data-pos': position }, card, pill);
    root.append(wrap);
    pill.addEventListener('click', () => setOpen(!ui.open));
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ui.open) { setOpen(false); pill.focus(); } });
    document.documentElement.append(host);

    function setOpen(open) {
      ui.open = open;
      card.hidden = !open;
      pill.setAttribute('aria-expanded', String(open));
      wrap.classList.toggle('is-open', open);
    }

    function render() {
      if (!last) return;
      const s = summarize(last);
      pill.className = `pill tone-${s.tone}${s.final ? ' is-final' : ''}`;
      const pillIcon = s.icon || { info: 'info' }[s.tone] || 'home';
      pill.replaceChildren(
        h('span', { class: 'pill-icon' }, s.busy ? h('span', { class: 'spinner' }) : icon(pillIcon, 15)),
        h('span', { class: 'pill-text' }, h('span', { class: 'pill-title' }, s.title), s.detail ? h('span', { class: 'pill-detail' }, s.detail) : null));
      pill.setAttribute('aria-label', `Check mon loyer : ${s.title}${s.detail ? `, ${s.detail}` : ''}`);
      const listing = last.listing || {};
      const place = last.result?.place?.label || [listing.location?.city, listing.location?.postcode].filter(Boolean).join(' ');
      headEl.replaceChildren(
        h('div', { class: 'listing-title' }, listing.title || 'Annonce de location'),
        h('div', { class: 'listing-meta' }, [listingMeta(last.inputs?.listing || listing), place].filter(Boolean).join(' · ')));
      renderResult(bodyEl, last, handlers);
    }

    return {
      update(state) { last = state; render(); },
      open: () => setOpen(true),
      isOpen: () => ui.open,
      setPosition: (pos) => wrap.setAttribute('data-pos', pos),
      destroy: () => host.remove(),
    };
  }

  // --- Styles ---

  const CSS = `
:host { all: initial; }
.wrap, .popup {
  --bg: #ffffff; --fg: #1c1d1f; --muted: #63666e; --line: #e5e4df; --soft: #f5f4f0;
  --accent: #1f4e5f; --accent-fg: #ffffff;
  --ok: #1f7a4d; --ok-bg: #e5f3eb; --wait: #9a5b00; --wait-bg: #fcf0dc;
  --info: #285e8f; --info-bg: #e6eef7; --none: #74767e; --none-bg: #efeeea; --err: #b42318; --err-bg: #fbe9e7;
  --shadow: 0 10px 34px rgba(20, 20, 30, .18), 0 2px 8px rgba(20, 20, 30, .08);
  font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  color: var(--fg);
}
@media (prefers-color-scheme: dark) {
  .wrap, .popup {
    --bg: #1c1d21; --fg: #f1f1f3; --muted: #a4a6ae; --line: #34353b; --soft: #25262b;
    --accent: #7fc4d6; --accent-fg: #0d1a1f;
    --ok: #5fd39a; --ok-bg: rgba(95, 211, 154, .14); --wait: #f2b55c; --wait-bg: rgba(242, 181, 92, .14);
    --info: #8fb7e8; --info-bg: rgba(143, 183, 232, .14); --none: #a4a6ae; --none-bg: #2c2d32; --err: #ff8a7a; --err-bg: rgba(255, 138, 122, .13);
    --shadow: 0 10px 34px rgba(0, 0, 0, .5);
  }
}
* { box-sizing: border-box; }
button, input, select { font: inherit; color: inherit; }
.wrap { position: fixed; bottom: 20px; right: 20px; z-index: 2147483646; display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }
.wrap[data-pos="left"] { right: auto; left: 20px; align-items: flex-start; }

.pill { display: flex; align-items: center; gap: 10px; max-width: 340px; padding: 7px 14px 7px 7px; border: 1px solid var(--line);
  border-radius: 999px; background: var(--bg); box-shadow: var(--shadow); cursor: pointer; text-align: left; }
.pill:hover { border-color: color-mix(in srgb, var(--line) 50%, var(--fg) 25%); }
:is(.pill, .icon-btn, .cta, .link, .primary, summary, input, select):focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.pill-icon { flex: none; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: var(--none-bg); color: var(--none); }
.pill-text { display: flex; flex-direction: column; min-width: 0; }
.pill-title { font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pill-detail { color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tone-ok .pill-icon { background: var(--ok-bg); color: var(--ok); }
.tone-wait .pill-icon { background: var(--wait-bg); color: var(--wait); }
.tone-info .pill-icon, .tone-load .pill-icon { background: var(--info-bg); color: var(--info); }
.tone-err .pill-icon { background: var(--err-bg); color: var(--err); }
.pill.is-final .pill-icon { color: var(--bg); }
.pill.is-final.tone-ok .pill-icon { background: var(--ok); }
.pill.is-final.tone-err .pill-icon { background: var(--err); }
.pill.tone-none { opacity: .88; }
.is-open .pill { display: none; }

.card { width: 390px; max-width: calc(100vw - 32px); max-height: min(78vh, 680px); display: flex; flex-direction: column;
  background: var(--bg); border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow); overflow: hidden; animation: rise .16s ease-out; }
.card[hidden] { display: none; }
@keyframes rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .body.is-busy .verdict, .body.is-busy .question, .answer:active { transition: none; transform: none; } .card, .tip-pop { animation: none; } .spinner { animation-duration: 2s; } }
.card-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 10px 0 14px; }
.brand { display: flex; align-items: center; gap: 7px; font-weight: 700; letter-spacing: .01em; }
.brand-mark { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 6px; background: var(--accent); color: var(--accent-fg); }
.head-actions { display: flex; gap: 2px; }
.icon-btn { display: grid; place-items: center; width: 30px; height: 30px; border: 0; border-radius: 8px; background: transparent; color: var(--muted); cursor: pointer; }
.icon-btn:hover { background: var(--soft); color: var(--fg); }
.listing { padding: 8px 14px 12px; border-bottom: 1px solid var(--line); }
.listing-title { font-size: 15px; font-weight: 650; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.listing-meta { color: var(--muted); font-size: 12px; margin-top: 2px; }
.body { overflow-y: auto; overscroll-behavior: contain; padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 10px; }
.card-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 9px 14px; border-top: 1px solid var(--line); background: var(--soft); color: var(--muted); font-size: 11.5px; }
.privacy { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; color: inherit; text-decoration: none; }
.privacy:hover { color: var(--fg); text-decoration: underline; text-underline-offset: 2px; }
.privacy:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }

.verdict { padding: 10px 12px 12px; border-radius: 10px; background: var(--none-bg); }
.verdict-head { display: flex; align-items: center; gap: 8px; }
.verdict-icon { flex: none; display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: var(--bg); }
.verdict.is-final .verdict-icon { background: currentColor; }
.verdict.is-final .verdict-icon svg { color: var(--bg); }
.verdict-title { flex: 1; min-width: 0; font-weight: 700; font-size: 15px; line-height: 1.3; }
.verdict-title:focus { outline: none; }
.risk { flex: none; padding: 2px 8px; border-radius: 999px; background: var(--bg); color: var(--wait); font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; }
.verdict p { margin: 6px 0 0; }
.verdict.tone-ok { background: var(--ok-bg); } .verdict.tone-ok .verdict-icon, .verdict.tone-ok .verdict-title { color: var(--ok); }
.verdict.tone-err { background: var(--err-bg); } .verdict.tone-err .verdict-icon, .verdict.tone-err .verdict-title { color: var(--err); }
.verdict.tone-wait { background: var(--wait-bg); } .verdict.tone-wait .verdict-icon, .verdict.tone-wait .verdict-title { color: var(--wait); }
.verdict.tone-info { background: var(--info-bg); } .verdict.tone-info .verdict-icon, .verdict.tone-info .verdict-title { color: var(--info); }
.verdict.tone-none .verdict-icon, .verdict.tone-none .verdict-title { color: var(--muted); }
.gauge { margin-top: 10px; }
.gauge-labels { position: relative; z-index: 1; height: 22px; }
.gauge-track + .gauge-labels { z-index: 0; }
.gauge-labels span { position: absolute; top: 0; white-space: nowrap; font-size: 12px; line-height: 20px; }
.gauge-rent { padding: 0 7px; border-radius: 6px; font-weight: 700; background: var(--bg); color: var(--fg); box-shadow: 0 0 0 1px color-mix(in srgb, currentColor 35%, transparent); }
.gauge-rent::after { content: ''; position: absolute; left: clamp(6px, var(--r), calc(100% - 6px)); bottom: -4px; width: 7px; height: 7px; margin-left: -3.5px;
  background: inherit; transform: rotate(45deg); box-shadow: 1px 1px 0 0 color-mix(in srgb, currentColor 35%, transparent); }
.gauge.tone-ok .gauge-rent { color: var(--ok); }
.gauge.tone-wait .gauge-rent { color: var(--wait); }
.gauge.tone-err .gauge-rent { color: var(--err); }
.gauge-ceiling { top: 2px !important; color: var(--fg); font-weight: 600; }
.gauge-track { position: relative; height: 8px; margin: 2px 0 4px; border-radius: 999px;
  background: linear-gradient(90deg,
    color-mix(in srgb, var(--fg) 10%, var(--bg)) 0 var(--b),
    color-mix(in srgb, var(--err) 70%, var(--bg)) var(--b) 100%); }
.gauge-band { position: absolute; top: -3px; bottom: -3px; left: var(--a); width: max(2px, calc(var(--b) - var(--a))); border-radius: 3px;
  background: repeating-linear-gradient(135deg, var(--wait) 0 2px, color-mix(in srgb, var(--wait) 22%, var(--bg)) 2px 6px); }
.gauge-band.is-exact { width: 2px; margin-left: -1px; top: -4px; bottom: -4px; background: var(--muted); border-radius: 1px; }
.gauge-tail { position: absolute; top: 0; bottom: 0; right: calc(100% - var(--r)); width: 26%; border-radius: 999px 0 0 999px;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--wait) 75%, transparent)); }
.gauge-needle { position: absolute; left: var(--r); top: -8px; bottom: -6px; width: 4px; margin-left: -2px; border-radius: 2px; background: var(--fg); box-shadow: 0 0 0 2px var(--bg); }

.gauge-caption { margin-top: 0; color: var(--muted); font-size: 12px; }
.question { position: relative; padding: 2px 2px 12px; border-bottom: 1px solid var(--line); }
.sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.question-text { font-weight: 650; font-size: 14px; }
.question-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 4px; }
.question-form { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 4px; }
.with-unit { position: relative; flex: 1; min-width: 120px; }
.with-unit .question-unit { position: absolute; right: 9px; top: 50%; transform: translateY(-50%); pointer-events: none; }
.with-unit input { padding-right: 58px !important; }
.question-form > input, .combo { flex: 1; min-width: 0; }
.question-form input { width: 100%; min-height: 36px; padding: 6px 8px; border: 1px solid var(--line); border-radius: 7px; background: var(--bg); }
.question-form input[aria-invalid="true"] { border-color: var(--err); }
.question-unit { color: var(--muted); font-size: 12px; white-space: nowrap; }
.question-error { margin: 4px 0 0; color: var(--err); font-size: 12px; font-weight: 600; }
.question-hint { margin: 4px 0 0; color: var(--muted); font-size: 12px; }
.tip { margin: 0 0 0 -4px; }
.combo { position: relative; }
.suggest { position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 4; max-height: 232px; overflow-y: auto; margin: 0; padding: 4px;
  list-style: none; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); box-shadow: var(--shadow); }
.suggest[hidden] { display: none; }
.suggest li { padding: 7px 8px; border-radius: 6px; cursor: pointer; font-size: 12.5px; line-height: 1.35; }
.suggest li:hover, .suggest li[aria-selected="true"] { background: var(--soft); }
.suggest li[aria-selected="true"] { box-shadow: inset 2px 0 0 var(--accent); }
.suggest .suggest-empty { color: var(--muted); cursor: default; }
.suggest .suggest-empty:hover { background: none; }
.tip-btn { display: inline-flex; align-items: center; gap: 5px; min-height: 32px; padding: 0 4px; border: 0; background: none; color: var(--accent);
  font-size: 12.5px; font-weight: 600; cursor: pointer; text-decoration: underline dotted; text-underline-offset: 3px; min-height: 30px; }
.tip-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
.tip-pop { display: none; position: absolute; left: 0; right: 0; top: calc(100% + 6px); z-index: 3; overflow-y: auto; padding: 10px 12px;
  border: 1px solid var(--line); border-radius: 10px; background: var(--bg); box-shadow: var(--shadow); font-size: 12px; line-height: 1.45; animation: rise .14s ease-out; }
.tip-pop.up { top: auto; bottom: calc(100% + 6px); }
.tip.is-open .tip-pop { display: block; }
.tip-pop p { margin: 0 0 6px; }
.tip-pop strong { font-weight: 650; }
.tip-sure { margin-top: 8px; font-weight: 650; }
.tip-pop ul { margin: 4px 0 0; padding-left: 16px; color: var(--muted); }
.tip-pop li + li { margin-top: 3px; }
.tip-pop a { display: inline-flex; align-items: center; gap: 4px; color: var(--accent); font-weight: 600; }
.tip-pop a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.answer { position: relative; min-width: 64px; min-height: 36px; padding: 6px 14px; border: 1px solid var(--accent); border-radius: 8px; background: var(--bg); color: var(--accent); font-weight: 600; cursor: pointer; }
.answer:hover { background: var(--accent); color: var(--accent-fg); }
.answer::after { content: ''; position: absolute; inset: -4px; }
.answer.secondary { border-color: color-mix(in srgb, var(--fg) 28%, transparent); color: var(--fg); font-weight: 500; }
.answer.secondary:hover { background: var(--bg); border-color: var(--muted); color: var(--fg); }
.answer:active { transform: translateY(1px); }
.answer:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.figures { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 0; }
.figures dt { color: var(--muted); }
.figures dd { margin: 0; font-weight: 600; }
.note { margin: 0; color: var(--muted); font-size: 12px; }
.note.warn { color: var(--err); font-weight: 600; }
.facts summary, .edit summary { cursor: pointer; color: var(--accent); font-size: 12.5px; font-weight: 600; }
.facts ul { margin: 6px 0 0; padding-left: 18px; color: var(--muted); font-size: 12px; }
.facts li + li { margin-top: 3px; }
.edit { border-top: 1px solid var(--line); padding-top: 10px; }
.form { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.field-label { font-size: 11.5px; font-weight: 600; color: var(--muted); }
.field-hint { font-size: 11px; color: var(--muted); }
.field input, .field select { width: 100%; padding: 6px 8px; border: 1px solid var(--line); border-radius: 7px; background: var(--bg); }
.resume { align-self: flex-start; }
.body.is-busy .verdict, .body.is-busy .question { opacity: .55; transition: opacity .15s ease-out; }
.body.is-busy [aria-disabled="true"] { pointer-events: none; }
.verdict-head .spinner { flex: none; color: var(--muted); }
.link { padding: 0; border: 0; background: none; color: var(--accent); cursor: pointer; font-size: 12px; text-decoration: underline; text-underline-offset: 2px; }
.cta { align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 8px; background: var(--accent); color: var(--accent-fg);
  font-weight: 600; font-size: 12.5px; text-decoration: none; }
.cta:hover, .primary:hover { filter: brightness(1.08); }
.cta.secondary { background: transparent; color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.cta.secondary:hover { filter: none; background: var(--soft); }
.primary { align-self: flex-start; padding: 8px 14px; border: 0; border-radius: 8px; background: var(--accent); color: var(--accent-fg); font-weight: 600; cursor: pointer; }
.loading { display: flex; align-items: center; gap: 8px; color: var(--muted); }
.spinner { width: 12px; height: 12px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
`;

  globalThis.LoyerUI = { mountPanel, renderResult, summarize, constructionFromChoice, CSS, h, icon };
})();
