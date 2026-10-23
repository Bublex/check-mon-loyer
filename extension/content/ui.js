// Interface de Loyer Juste : pastille flottante + panneau (Shadow DOM fermé), et rendu du verdict
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

  const safeUrl = (url) => (/^https:\/\//i.test(String(url || '')) ? url : null);
  const euroFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
  const m2Fmt = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const eur = (n) => `${euroFmt.format(n)}\u00a0€`;
  const perM2 = (n) => `${m2Fmt.format(n)}\u00a0€/m²`;
  const m2 = (n) => `${euroFmt.format(n)}\u00a0m²`;

  function joinFr(list) {
    if (list.length < 2) return list.join('');
    return `${list.slice(0, -1).join(', ')} et ${list[list.length - 1]}`;
  }

  const SPREAD = {
    period: 'l’époque de construction',
    furnished: 'le type de location (vide ou meublée)',
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
    return hit ? hit[0] : '';
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
    if (state.error) return { tone: 'err', title: 'Vérification impossible', detail: state.error };
    const r = state.result;
    if (!r) return { tone: 'info', title: 'Encadrement des loyers', detail: 'Vérifier ce loyer' };
    const v = r.verdict || {};
    switch (r.status) {
      case 'over': {
        const exact = v.ceiling.low === v.ceiling.high;
        return { tone: 'err', title: 'Loyer au-dessus du plafond', detail: `${exact ? '' : 'Au moins '}${eur(v.overBy)} de trop par mois` };
      }
      case 'under':
        return { tone: 'ok', title: 'Loyer conforme à l’encadrement', detail: `Plafond : ${eur(v.ceiling.low)} hors charges` };
      case 'depends':
        return { tone: 'wait', title: 'Peut dépasser le plafond', detail: v.spread.length ? `Selon ${SPREAD[v.spread[0]]}` : 'À préciser' };
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
        return { tone: 'none', title: 'Colocation', detail: 'Non vérifiée par Loyer Juste' };
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

  function headline(r) {
    const v = r.verdict || {};
    switch (r.status) {
      case 'over': {
        const atLeast = v.ceiling.low === v.ceiling.high ? '' : 'au moins ';
        return ['err', 'alert', 'Loyer au-dessus du plafond légal',
          `Le loyer hors charges dépasse le maximum autorisé de ${atLeast}${eur(v.overBy)} par mois, soit ${atLeast}${eur(v.overBy * 12)} par an.`];
      }
      case 'under':
        return ['ok', 'check', 'Loyer conforme à l’encadrement', `Il reste ${eur(v.margin)} sous le plafond.`];
      case 'depends':
        return ['wait', 'help', 'Peut dépasser le plafond',
          `Le verdict dépend de ${joinFr(v.spread.map((k) => SPREAD[k]))}. Précisez-le ci-dessous.`];
      case 'incomplete':
        return ['info', 'help', 'Informations manquantes', `Indiquez ${joinFr((v.missing || []).map((k) => MISSING[k]))} pour calculer le plafond.`];
      case 'nosource':
        return ['info', 'help', `Loyer encadré à ${r.territory.name}`,
          `${r.territory.partial ? 'L’encadrement s’applique à tout ou partie de cette commune. ' : ''}Loyer Juste ne calcule pas encore le plafond de ce territoire : vérifiez-le sur le simulateur officiel.`];
      case 'nodata':
        return ['info', 'help', 'Grille introuvable', 'Le service de données ne renvoie pas de loyer de référence pour cette adresse. Vérifiez-la, ou consultez le simulateur officiel.'];
      case 'notcovered':
        return ['none', 'home', 'Pas d’encadrement des loyers ici',
          `${r.place?.city ? `${r.place.city} n’applique` : 'Cette commune n’applique'} pas l’encadrement du niveau des loyers. En zone tendue, le loyer ne peut en principe pas augmenter entre deux locataires.`];
      case 'nolocation':
        return ['info', 'help', 'Adresse introuvable', 'Indiquez l’adresse ou la ville du logement ci-dessous.'];
      case 'roomshare':
        return ['none', 'home', 'Colocation', 'Les baux de colocation et les chambres ne sont pas encore vérifiés par Loyer Juste.'];
      default:
        return ['info', 'help', 'Encadrement des loyers', ''];
    }
  }

  function renderVerdict(state) {
    const r = state.result;
    const v = r.verdict || {};
    const inputs = state.inputs || {};
    const [tone, ico, title, text] = headline(r);
    const lines = [];
    if (v.rentHC) lines.push(['Loyer demandé', rentLine(v, inputs)]);
    if (v.perM2) lines.push(['Maximum légal', ceilingLine(v, inputs).replace(/^Plafond : /, '')]);
    const announced = inputs.announcedCeiling;
    const out = [
      h('div', { class: `verdict tone-${tone}` },
        h('div', { class: 'verdict-icon' }, icon(ico, 18)),
        h('div', { class: 'verdict-text' }, h('div', { class: 'verdict-title' }, title), text ? h('p', null, text) : null)),
      lines.length ? h('dl', { class: 'figures' }, lines.flatMap(([k, val]) => [h('dt', null, k), h('dd', null, val)])) : null,
    ];
    if (v.spread?.includes('address') && r.status !== 'depends') {
      out.push(h('p', { class: 'note' }, 'L’annonce ne donne pas l’adresse exacte : le plafond couvre les secteurs voisins. Indiquez l’adresse pour l’affiner.'));
    }
    if (v.complementForbidden) out.push(h('p', { class: 'note warn' }, 'Un complément de loyer est demandé alors que le logement est classé F ou G : c’est interdit.'));
    else if (inputs.listing?.rent?.complement > 0) out.push(h('p', { class: 'note' }, `Complément de loyer de ${eur(inputs.listing.rent.complement)} : il n’est permis que pour un logement aux caractéristiques exceptionnelles (localisation, confort) et doit être justifié dans le bail.`));
    if (announced && announced < 100 && v.perM2 && Math.abs(announced - v.perM2.max) > 0.05 && v.perM2.min === v.perM2.max) {
      out.push(h('p', { class: 'note' }, `L’annonce indique un loyer de référence majoré de ${perM2(announced)} ; la grille en vigueur donne ${perM2(v.perM2.max)}.`));
    }
    if (v.assumptions?.length) out.push(h('p', { class: 'note' }, `${v.assumptions.join('. ')}.`));
    if (v.zones?.length || v.years?.length) {
      const facts = [
        v.zones?.length ? `${v.zones.length > 1 ? 'Secteurs' : 'Secteur'} : ${v.zones.join(', ')}` : null,
        v.periods?.length ? `Époque${v.periods.length > 1 ? 's' : ''} : ${v.periods.join(', ')}` : null,
        v.years?.length ? `Grille ${v.years.join(', ')}` : null,
        r.place?.approximate ? 'Position approximative : indiquez l’adresse pour affiner' : null,
      ].filter(Boolean);
      out.push(h('details', { class: 'facts' }, h('summary', null, 'Détail du calcul'), h('ul', null, facts.map((f) => h('li', null, f)))));
    }
    if (r.status === 'over' || r.status === 'depends') {
      out.push(h('div', { class: 'advice' },
        h('div', { class: 'advice-title' }, 'Bon à savoir'),
        h('ul', null,
          h('li', null, 'Le loyer de base hors charges ne peut pas dépasser le plafond. Un complément de loyer n’est permis que pour des caractéristiques exceptionnelles, jamais pour un logement classé F ou G.'),
          h('li', null, 'Bail signé ? Demandez la mise en conformité au bailleur, saisissez la commission départementale de conciliation (gratuite) ou signalez le bail à la préfecture, qui peut sanctionner le bailleur.'))));
    }
    const official = safeUrl(r.territory?.officialUrl);
    if (official && r.status !== 'under') out.push(h('a', { class: 'cta', href: official, target: '_blank', rel: 'noopener noreferrer' }, 'Simulateur et informations officielles', icon('external', 14)));
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
    else if (choice === 'inferred') periodOptions.splice(1, 0, ['inferred', construction.label]);

    const form = h('form', { class: 'form', novalidate: true },
      field('Adresse du logement', h('input', { name: 'address', type: 'text', autocomplete: 'street-address', placeholder: 'Ex. 12 rue Oberkampf, Paris', value: loc.address || '' }),
        loc.address ? null : [loc.district, loc.postcode, loc.city].filter(Boolean).join(' ') || null),
      h('div', { class: 'row' },
        field('Surface habitable', h('input', { name: 'surface', type: 'number', min: '1', step: '0.1', inputmode: 'decimal', placeholder: 'm²', value: listing.surface ?? '' })),
        field('Pièces', select('rooms', [['', '?'], [1, '1'], [2, '2'], [3, '3'], [4, '4 et plus']], listing.rooms == null ? '' : Math.min(Math.max(listing.rooms, 1), 4)))),
      h('div', { class: 'row' },
        field('Location', select('furnished', [['', 'Je ne sais pas'], ['false', 'Vide'], ['true', 'Meublée']], listing.furnished == null ? '' : String(listing.furnished))),
        field('Construction', select('period', periodOptions, choice))),
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
        construction: period === 'inferred' ? construction : constructionFromChoice(period),
        rent: { amount: num('amount'), chargesIncluded: data.get('chargesIncluded') !== 'false', charges: num('charges'), complement: num('complement') },
      });
    });
    return h('details', { class: 'edit', open }, h('summary', null, 'Corriger ou compléter les informations'), form);
  }

  /** Verdict + formulaire, dans le panneau comme dans la fenêtre de l'extension. */
  function renderResult(container, state, handlers, options = {}) {
    const parts = [];
    if (state.loading) parts.push(h('div', { class: 'loading' }, h('span', { class: 'spinner' }), 'Vérification auprès des données publiques…'));
    else if (state.error) parts.push(h('div', { class: 'verdict tone-err' }, h('div', { class: 'verdict-icon' }, icon('alert', 18)),
      h('div', { class: 'verdict-text' }, h('div', { class: 'verdict-title' }, 'Vérification impossible'), h('p', null, `${state.error}. `,
        h('button', { class: 'link', type: 'button', onclick: () => handlers.onRefresh?.() }, 'Réessayer')))));
    else if (state.result) parts.push(...renderVerdict(state));
    const status = state.result?.status;
    const formOpen = options.formOpen ?? ['depends', 'incomplete', 'nolocation', 'nodata'].includes(status);
    if (!state.loading && status !== 'roomshare') parts.push(renderForm(state, handlers, { open: formOpen, submitLabel: options.submitLabel }));
    container.replaceChildren(...parts.filter(Boolean));
  }

  function listingMeta(listing) {
    const f = listing.furnished === true ? 'meublé' : listing.furnished === false ? 'vide' : null;
    return [listing.propertyType, listing.rooms ? `${listing.rooms} pièce${listing.rooms > 1 ? 's' : ''}` : null,
      listing.surface ? m2(listing.surface) : null, f].filter(Boolean).join(' · ');
  }

  // --- Panneau flottant (pages d'annonce) ---

  function mountPanel({ position = 'right', handlers = {} } = {}) {
    const host = document.createElement('div');
    host.setAttribute('data-loyer-juste', '');
    const root = host.attachShadow({ mode: 'closed' });
    root.append(h('style', null, CSS));
    const ui = { open: false };
    let last = null;

    const pill = h('button', { class: 'pill', type: 'button', 'aria-expanded': 'false' });
    const bodyEl = h('div', { class: 'body' });
    const headEl = h('div', { class: 'listing' });
    const card = h('section', { class: 'card', role: 'dialog', 'aria-label': 'Loyer Juste : encadrement des loyers', hidden: true },
      h('header', { class: 'card-head' },
        h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, icon('home', 14)), 'Loyer Juste'),
        h('div', { class: 'head-actions' },
          h('button', { class: 'icon-btn', type: 'button', title: 'Actualiser', 'aria-label': 'Vérifier à nouveau', onclick: () => handlers.onRefresh?.() }, icon('refresh', 16)),
          h('button', { class: 'icon-btn', type: 'button', title: 'Réduire', 'aria-label': 'Réduire le panneau', onclick: () => setOpen(false) }, icon('minus', 16)))),
      headEl,
      bodyEl,
      h('footer', { class: 'card-foot' },
        h('span', { class: 'privacy', title: 'Seule la localisation du logement est envoyée aux services publics de données' }, icon('lock', 12), 'Sans compte ni statistiques'),
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
      pill.className = `pill tone-${s.tone}`;
      const pillIcon = { ok: 'check', err: 'alert', wait: 'help' }[s.tone] || 'home';
      pill.replaceChildren(
        h('span', { class: 'pill-icon' }, s.busy ? h('span', { class: 'spinner' }) : icon(pillIcon, 15)),
        h('span', { class: 'pill-text' }, h('span', { class: 'pill-title' }, s.title), s.detail ? h('span', { class: 'pill-detail' }, s.detail) : null));
      pill.setAttribute('aria-label', `Loyer Juste : ${s.title}${s.detail ? `, ${s.detail}` : ''}`);
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
.pill.tone-none { opacity: .88; }
.is-open .pill { display: none; }

.card { width: 390px; max-width: calc(100vw - 32px); max-height: min(78vh, 680px); display: flex; flex-direction: column;
  background: var(--bg); border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow); overflow: hidden; animation: rise .16s ease-out; }
.card[hidden] { display: none; }
@keyframes rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .card { animation: none; } .spinner { animation-duration: 2s; } }
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
.privacy { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }

.verdict { display: flex; gap: 10px; padding: 10px 12px; border-radius: 10px; background: var(--none-bg); }
.verdict-icon { flex: none; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: var(--bg); }
.verdict-title { font-weight: 700; font-size: 14px; }
.verdict p { margin: 2px 0 0; }
.verdict.tone-ok { background: var(--ok-bg); } .verdict.tone-ok .verdict-icon, .verdict.tone-ok .verdict-title { color: var(--ok); }
.verdict.tone-err { background: var(--err-bg); } .verdict.tone-err .verdict-icon, .verdict.tone-err .verdict-title { color: var(--err); }
.verdict.tone-wait { background: var(--wait-bg); } .verdict.tone-wait .verdict-icon, .verdict.tone-wait .verdict-title { color: var(--wait); }
.verdict.tone-info { background: var(--info-bg); } .verdict.tone-info .verdict-icon, .verdict.tone-info .verdict-title { color: var(--info); }
.figures { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 0; }
.figures dt { color: var(--muted); }
.figures dd { margin: 0; font-weight: 600; }
.note { margin: 0; color: var(--muted); font-size: 12px; }
.note.warn { color: var(--err); font-weight: 600; }
.facts summary, .edit summary { cursor: pointer; color: var(--accent); font-size: 12.5px; font-weight: 600; }
.facts ul, .advice ul { margin: 6px 0 0; padding-left: 18px; color: var(--muted); font-size: 12px; }
.facts li + li, .advice li + li { margin-top: 3px; }
.advice { padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; }
.advice-title { font-weight: 650; font-size: 12.5px; }
.edit { border-top: 1px solid var(--line); padding-top: 10px; }
.form { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.field-label { font-size: 11.5px; font-weight: 600; color: var(--muted); }
.field-hint { font-size: 11px; color: var(--muted); }
.field input, .field select { width: 100%; padding: 6px 8px; border: 1px solid var(--line); border-radius: 7px; background: var(--bg); }
.link { padding: 0; border: 0; background: none; color: var(--accent); cursor: pointer; font-size: 12px; text-decoration: underline; text-underline-offset: 2px; }
.cta { align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 8px; background: var(--accent); color: var(--accent-fg);
  font-weight: 600; font-size: 12.5px; text-decoration: none; }
.cta:hover, .primary:hover { filter: brightness(1.08); }
.primary { align-self: flex-start; padding: 8px 14px; border: 0; border-radius: 8px; background: var(--accent); color: var(--accent-fg); font-weight: 600; cursor: pointer; }
.loading { display: flex; align-items: center; gap: 8px; color: var(--muted); }
.spinner { width: 12px; height: 12px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
`;

  globalThis.LoyerUI = { mountPanel, renderResult, summarize, constructionFromChoice, CSS, h, icon };
})();
