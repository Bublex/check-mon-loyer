// Calcul du loyer maximal autorisé et verdict pour une annonce.
// Le plafond est le loyer de référence majoré (€/m²) multiplié par la surface habitable ;
// il s'applique au loyer de base hors charges. Un complément de loyer peut s'y ajouter
// pour des caractéristiques exceptionnelles, jamais pour un logement classé F ou G.
//
// Quand une information manque (époque de construction, meublé, adresse exacte, charges),
// on considère toutes les possibilités : le verdict n'est tranché que s'il vaut pour toutes.

import { gridRooms, periodOverlaps, periodKnown } from './grid.js';

const TOLERANCE = 1; // euro : les grilles et les annonces arrondissent.

const roundEuro = (n) => Math.round(n);
const round2 = (n) => Math.round(n * 100) / 100;

/** Loyer hors charges de l'annonce, sous forme d'intervalle [lo, hi] (lo à null s'il est inconnu). */
export function rentRange(rent) {
  if (!rent || rent.amount == null) return null;
  const assumptions = [];
  if (rent.base != null) return { lo: rent.base, hi: rent.base, assumptions, base: true };
  let lo = null;
  let hi = null;
  if (rent.chargesIncluded === false) {
    lo = hi = rent.amount;
  } else if (rent.charges != null) {
    if (rent.chargesIncluded == null) assumptions.push('Montant affiché supposé charges comprises');
    lo = hi = Math.max(0, rent.amount - rent.charges);
  } else {
    // Charges comprises (ou non précisé, ce qui est l'usage des annonces) sans le montant des charges :
    // le loyer hors charges est inférieur au montant affiché.
    if (rent.chargesIncluded == null) assumptions.push('Montant affiché supposé charges comprises');
    hi = rent.amount;
  }
  if (rent.complement > 0) {
    // Le complément de loyer est jugé à part : on compare le loyer de base au plafond.
    if (lo != null) lo = Math.max(0, lo - rent.complement);
    hi = Math.max(0, hi - rent.complement);
  }
  return { lo, hi, assumptions, base: false };
}

/** Lignes de la grille qui peuvent s'appliquer à ce logement. */
export function candidateRows(rows, listing) {
  const rooms = gridRooms(listing.rooms);
  const byRooms = rows.filter((r) => rooms == null || r.rooms === rooms);
  const byFurnished = byRooms.filter((r) => listing.furnished == null || r.furnished === listing.furnished);
  // Une époque illisible dans la grille ne doit pas faire disparaître la ligne.
  const byPeriod = byFurnished.filter((r) => !periodKnown(r.period) || periodOverlaps(r.period, listing.construction));
  return byPeriod.length ? byPeriod : byFurnished;
}

const uniq = (list) => [...new Set(list.filter((x) => x !== '' && x != null))];

/**
 * @param listing { surface, rooms, furnished, construction: {from,to}|null, rent: {amount, chargesIncluded, charges, complement, base}, dpe }
 * @param rows lignes de grille (voir grid.js), déjà limitées au(x) secteur(s) possibles du logement
 * @param location { approximate } : l'adresse exacte est-elle connue ?
 */
export function evaluate(listing, rows, location = {}) {
  const rooms = gridRooms(listing.rooms);
  const missing = [];
  if (!listing.surface) missing.push('surface');
  if (rooms == null) missing.push('rooms');
  if (!listing.rent || listing.rent.amount == null) missing.push('rent');

  const candidates = candidateRows(rows, listing);
  if (!candidates.length) return { status: 'nodata', missing };

  const maxes = candidates.map((r) => r.max);
  const perM2 = { min: Math.min(...maxes), max: Math.max(...maxes) };
  const zones = uniq(candidates.map((r) => r.zone));
  const periods = uniq(candidates.map((r) => r.period.label));
  const years = uniq(candidates.map((r) => r.year));

  // Ce qui fait varier le plafond, pour le dire à l'utilisateur.
  const spread = [];
  const varies = (key) => new Set(candidates.map(key)).size > 1;
  if (rooms == null && varies((r) => r.rooms)) spread.push('rooms');
  if (listing.furnished == null && varies((r) => r.furnished)) spread.push('furnished');
  if (varies((r) => r.period.label)) spread.push('period');
  if (zones.length > 1) spread.push(location.approximate ? 'address' : 'zone');

  const base = {
    perM2: { min: round2(perM2.min), max: round2(perM2.max) },
    zones,
    periods,
    years,
    spread,
    missing,
    complementForbidden: Boolean(listing.rent?.complement > 0 && /^[FG]$/i.test(listing.dpe || '')),
  };

  if (!listing.surface) return { ...base, status: 'incomplete' };

  const ceiling = { low: roundEuro(perM2.min * listing.surface), high: roundEuro(perM2.max * listing.surface) };
  const rent = rentRange(listing.rent);
  if (!rent) return { ...base, ceiling, status: 'incomplete' };

  const result = { ...base, ceiling, rentHC: { lo: rent.lo, hi: rent.hi }, assumptions: rent.assumptions, baseRent: rent.base };
  if (rent.lo != null && rent.lo > ceiling.high + TOLERANCE) {
    return { ...result, status: 'over', overBy: roundEuro(rent.lo - ceiling.high), overByMax: roundEuro(rent.lo - ceiling.low) };
  }
  if (rent.hi <= ceiling.low + TOLERANCE) {
    return { ...result, status: 'under', margin: roundEuro(ceiling.low - rent.hi) };
  }
  // Entre les deux : le verdict dépend d'une information manquante.
  if (rent.lo == null && rent.hi > ceiling.high + TOLERANCE) spread.push('charges');
  return { ...result, status: 'depends', overByMax: roundEuro(rent.hi - ceiling.low) };
}
