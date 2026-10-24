// Lecture des grilles et calcul du plafond.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePeriod, periodOverlaps, gridRooms, parseFurnished, orderTriplet, makeRow, parseYear } from '../extension/lib/grid.js';
import { evaluate, rentRange } from '../extension/lib/verdict.js';
import { findTerritory } from '../extension/lib/territories.js';
import { periodSharesFor, periodWeight } from '../extension/lib/periods.js';

test('Époques : libellés des grilles', () => {
  assert.deepEqual(parsePeriod('Avant 1946'), { label: 'Avant 1946', from: null, to: 1945 });
  assert.deepEqual(parsePeriod('1946-1970'), { label: '1946-1970', from: 1946, to: 1970 });
  assert.deepEqual(parsePeriod('1971 à 1990'), { label: '1971 à 1990', from: 1971, to: 1990 });
  assert.deepEqual(parsePeriod('Après 1990'), { label: 'Après 1990', from: 1991, to: null });
  assert.deepEqual(parsePeriod('apres_2005'), { label: 'apres_2005', from: 2006, to: null });
  assert.deepEqual(parsePeriod('1991_2005'), { label: '1991_2005', from: 1991, to: 2005 });
  assert.equal(parsePeriod('Inconnue').from, null);
});

test('Époques : compatibilité avec l’année de construction', () => {
  const before46 = parsePeriod('Avant 1946');
  assert.equal(periodOverlaps(before46, { from: 1930, to: 1930 }), true);
  assert.equal(periodOverlaps(before46, { from: 1971, to: 1990 }), false);
  assert.equal(periodOverlaps(parsePeriod('Après 1990'), { from: 1991, to: 2005 }), true);
  assert.equal(periodOverlaps(before46, null), true);
});

test('Pièces, meublé, triplet', () => {
  assert.equal(gridRooms('4 et plus'), 4);
  assert.equal(gridRooms(6), 4);
  assert.equal(gridRooms('Studio'), 1);
  assert.equal(gridRooms('2_pieces'), 2);
  assert.equal(gridRooms(''), null);
  assert.equal(parseFurnished('non meublé'), false);
  assert.equal(parseFurnished('non_meuble'), false);
  assert.equal(parseFurnished('Meublé'), true);
  assert.equal(parseFurnished('Location vide'), false);
  assert.deepEqual(orderTriplet([33.96, 19.81, 28.3]), { min: 19.81, ref: 28.3, max: 33.96 });
  assert.equal(orderTriplet([10, 11, 12]), null, 'triplet incohérent écarté');
  assert.equal(parseYear('2025-07-01'), 2025);
  assert.equal(parseYear('car_care.carencadrmtloyer_2025_2026'), 2025);
});

// Grille fictive d'un quartier : référence 25 €/m² (vide, avant 1946), 28 €/m² meublé, 22 €/m² après 1990.
const grid = [];
for (const rooms of [1, 2, 3, 4]) {
  for (const [period, base] of [['Avant 1946', 25], ['1946-1970', 23], ['1971-1990', 22], ['Après 1990', 24]]) {
    for (const furnished of [false, true]) {
      const ref = base + (furnished ? 3 : 0) - rooms;
      grid.push(makeRow({ zone: 'Folie-Méricourt', year: 2025, rooms, period, furnished, min: ref * 0.7, ref, max: ref * 1.2 }));
    }
  }
}

const listing = (over = {}) => ({
  surface: 40,
  rooms: 2,
  furnished: false,
  construction: { from: 1900, to: 1900 },
  rent: { amount: 1000, chargesIncluded: false, charges: null, complement: null, base: null },
  dpe: 'D',
  ...over,
});

test('Plafond exact : loyer conforme', () => {
  // 2 pièces vide avant 1946 : référence 23 €/m², majoré 27,60 €/m², × 40 m² = 1 104 €.
  const v = evaluate(listing(), grid);
  assert.equal(v.status, 'under');
  assert.deepEqual(v.ceiling, { low: 1104, high: 1104 });
  assert.equal(v.margin, 104);
  assert.deepEqual(v.spread, []);
});

test('Plafond exact : loyer au-dessus', () => {
  const v = evaluate(listing({ rent: { amount: 1300, chargesIncluded: true, charges: 100 } }), grid);
  assert.equal(v.status, 'over');
  assert.equal(v.overBy, 96);
});

test('Époque inconnue : verdict tranché seulement s’il vaut pour toutes', () => {
  const unknown = listing({ construction: null, rent: { amount: 1050, chargesIncluded: false } });
  const v = evaluate(unknown, grid);
  // Majoré entre 20 × 1,2 = 24 €/m² (1971-1990) et 27,60 €/m² (avant 1946).
  assert.deepEqual(v.ceiling, { low: 960, high: 1104 });
  assert.equal(v.status, 'depends');
  assert.deepEqual(v.spread, ['period']);
  assert.equal(evaluate(listing({ construction: null, rent: { amount: 1200, chargesIncluded: false } }), grid).status, 'over');
  assert.equal(evaluate(listing({ construction: null, rent: { amount: 900, chargesIncluded: false } }), grid).status, 'under');
});

test('Charges comprises sans montant des charges', () => {
  // 1 050 € charges comprises : le loyer hors charges est au plus 1 050 €, sous le plafond de 1 104 €.
  assert.equal(evaluate(listing({ rent: { amount: 1050, chargesIncluded: true } }), grid).status, 'under');
  // 1 200 € charges comprises : dépend des charges.
  const v = evaluate(listing({ rent: { amount: 1200, chargesIncluded: null } }), grid);
  assert.equal(v.status, 'depends');
  assert.ok(v.spread.includes('charges'));
  assert.deepEqual(v.assumptions, ['Montant affiché supposé charges comprises']);
});

test('Complément de loyer : comparé à part, interdit en classe F ou G', () => {
  const rent = { amount: 1300, chargesIncluded: false, complement: 200 };
  const v = evaluate(listing({ rent }), grid);
  assert.equal(v.status, 'under');
  assert.equal(v.complementForbidden, false);
  assert.equal(evaluate(listing({ rent, dpe: 'G' }), grid).complementForbidden, true);
  assert.deepEqual(rentRange({ amount: 1300, base: 1100 }), { lo: 1100, hi: 1100, assumptions: [], base: true });
});

test('Surface ou loyer manquant', () => {
  const v = evaluate(listing({ surface: null }), grid);
  assert.equal(v.status, 'incomplete');
  assert.deepEqual(v.missing, ['surface']);
  assert.equal(v.perM2.max, 27.6);
  assert.equal(evaluate(listing({ rent: null }), grid).status, 'incomplete');
});

test('Territoires : communes encadrées', () => {
  assert.equal(findTerritory('75111').id, 'paris');
  assert.equal(findTerritory('69266').id, 'lyon');
  assert.equal(findTerritory('69383').id, 'lyon');
  assert.equal(findTerritory('33063').id, 'bordeaux');
  assert.equal(findTerritory('33281'), null, 'Mérignac n’est pas encadrée');
  assert.equal(findTerritory('64122').id, 'pays-basque');
});

test('Époque inconnue : probabilité de dépassement pondérée par les logements de la commune', () => {
  const paris = periodSharesFor('75111');
  assert.equal(paris.name, 'Paris');
  // Avant 1946 = avant 1919 + 1919-1945 ; après 1990 = 1991-2005 + 2006 et après.
  assert.ok(Math.abs(periodWeight({ from: null, to: 1945 }, null, paris) - 48.7) < 1e-9);
  assert.ok(Math.abs(periodWeight({ from: 1991, to: null }, null, paris) - 10.6) < 1e-9);

  // 1 050 € hors charges : au-dessus du plafond pour 1946-1970 (1 008 €) et 1971-1990 (960 €), pas avant 1946 (1 104 €) ni après 1990 (1 056 €).
  const unknown = listing({ construction: null, rent: { amount: 1050, chargesIncluded: false } });
  const v = evaluate(unknown, grid, { periodShares: paris });
  assert.equal(v.status, 'depends');
  assert.ok(Math.abs(v.probability - 40.6 / 99.9) < 1e-6, String(v.probability));
  assert.equal(evaluate(unknown, grid).probability, 0.5, 'sans répartition connue, chaque époque compte autant');
  // La question la plus utile : avant 1946 (oui : conforme ; non : dépassement probable).
  assert.equal(v.question.text, 'Le bâtiment date-t-il d’avant 1946 ?');
  assert.equal(v.question.year, 1946);
  assert.deepEqual(v.question.yes.construction, { from: null, to: 1945, label: 'Avant 1946' });

  const after1946 = evaluate({ ...unknown, construction: v.question.no.construction }, grid, { periodShares: paris });
  assert.ok(Math.abs(after1946.probability - 40.6 / 51.2) < 1e-6);
  assert.equal(after1946.question.text, 'Le bâtiment date-t-il d’avant 1991 ?');
  const settled = evaluate({ ...unknown, construction: after1946.question.yes.construction }, grid, { periodShares: paris });
  assert.equal(settled.status, 'over');
  assert.deepEqual(settled.periods, ['1946-1970', '1971-1990']);
});

test('Probabilité : pas de score sans le loyer hors charges, question sur le meublé quand c’est lui qui compte', () => {
  assert.equal(evaluate(listing({ construction: null, rent: { amount: 1200, chargesIncluded: null } }), grid).probability, undefined);
  // Avant 1946 connu, meublé inconnu : vide 1 104 €, meublé 1 248 € (31,20 €/m²) ; 1 150 € dépasse seulement en vide.
  const v = evaluate(listing({ furnished: null, rent: { amount: 1150, chargesIncluded: false } }), grid);
  assert.equal(v.status, 'depends');
  assert.equal(v.probability, 0.5);
  assert.equal(v.question.topic, 'furnished');
  assert.deepEqual(v.question.no, { furnished: false });
});

test('Questions enchaînées : charges, puis époque, puis adresse ; « Je ne sais pas » passe à la suivante', () => {
  // 1 200 € charges comprises, charges inconnues, époque inconnue.
  const unknown = listing({ construction: null, rent: { amount: 1200, chargesIncluded: true, charges: null } });
  const v = evaluate(unknown, grid);
  assert.equal(v.status, 'depends');
  assert.equal(v.spread[0], 'charges');
  assert.equal(v.question.topic, 'charges');
  assert.equal(v.question.type, 'number');
  // Charges passées : le montant affiché dépasse tous les plafonds, on demande quand même l'époque pour resserrer le plafond.
  const noCharges = evaluate({ ...unknown, skipped: ['charges'] }, grid);
  assert.equal(noCharges.question.topic, 'period');
  assert.equal(noCharges.question.type, 'yesno');
  assert.equal(evaluate({ ...unknown, skipped: ['charges', 'period'] }, grid).question, null);

  // Position approximative sur deux secteurs : 1 050 € conforme dans l'un (1 104 €), au-dessus dans l'autre (994 €).
  const twoZones = [...grid, ...grid.map((r) => ({ ...r, zone: 'Saint-Ambroise', max: Math.round(r.max * 0.9 * 100) / 100 }))];
  const near = listing({ rent: { amount: 1050, chargesIncluded: false } });
  const w = evaluate(near, twoZones, { approximate: true });
  assert.equal(w.status, 'depends');
  assert.deepEqual(w.spread, ['address']);
  assert.equal(w.question.topic, 'address');
  assert.equal(evaluate({ ...near, skipped: ['address'] }, twoZones, { approximate: true }).question, null);
});
