// Lecture des grilles de loyers de référence, quel que soit le territoire :
// époques de construction, nombre de pièces, meublé ou non, triplet minoré / référence / majoré.
// Chaque connecteur produit des lignes au même format :
//   { zone, year, rooms, period: { label, from, to }, furnished, min, ref, max }   (montants en €/m²/mois, hors charges)

/** Nombre décimal écrit à la française ou non (« 28,3 », « 1 234,50 », 28.3). */
export function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const s = String(value ?? '').replace(/[\s  €]/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

/**
 * Époque de construction d'une grille : « Avant 1946 », « 1946-1970 », « Après 1990 », « 1991 à 2005 »…
 * Renvoie un intervalle d'années inclusif (from/to à null quand il est ouvert).
 */
export function parsePeriod(label) {
  const text = String(label ?? '').trim();
  const s = text.toLowerCase().replace(/_/g, ' ');
  let m = s.match(/(\d{4})\s*(?:-|–|—|à|a|au|\s)\s*(\d{4})/);
  if (m) return { label: text, from: Number(m[1]), to: Number(m[2]) };
  m = s.match(/(?:avant|<|jusqu'?\s*(?:à|en))\s*(\d{4})/);
  if (m) return { label: text, from: null, to: Number(m[1]) - (/jusqu/.test(s) ? 0 : 1) };
  m = s.match(/(?:apr[eè]s|post|>|plus de)\s*(\d{4})/);
  if (m) return { label: text, from: Number(m[1]) + 1, to: null };
  m = s.match(/(?:depuis|à partir de|a partir de|dès|>=|≥)\s*(\d{4})/) || s.match(/(\d{4})\s*(?:et\s*(?:apr[eè]s|plus)|\+)/);
  if (m) return { label: text, from: Number(m[1]), to: null };
  return { label: text, from: null, to: null };
}

/** Une époque de la grille est-elle compatible avec ce que l'on sait de l'immeuble ? */
export function periodOverlaps(period, construction) {
  if (!construction || (construction.from == null && construction.to == null)) return true;
  const lo = period.from ?? -Infinity;
  const hi = period.to ?? Infinity;
  const cLo = construction.from ?? -Infinity;
  const cHi = construction.to ?? Infinity;
  return lo <= cHi && cLo <= hi;
}

/** L'époque est-elle reconnue (au moins une borne) ? Sinon elle ne peut servir de filtre. */
export const periodKnown = (period) => period.from != null || period.to != null;

/** Pièces principales de la grille : 1, 2, 3, et « 4 et plus ». Un studio compte pour une pièce. */
export function gridRooms(rooms) {
  if (/studio/i.test(String(rooms ?? ''))) return 1;
  const n = toNumber(String(rooms ?? '').replace(/\D+$/, '').replace(/^\D+/, ''));
  if (n == null) return null;
  return Math.min(Math.max(Math.round(n), 1), 4);
}

/** « meublé », « Location meublée », « non meublé », « Logement vide »… */
export function parseFurnished(label) {
  const s = String(label ?? '').toLowerCase();
  if (/non[\s_-]*meubl|vide|\bnue?\b|unfurnished/.test(s)) return false;
  if (/meubl|furnished/.test(s)) return true;
  return null;
}

/**
 * Remet dans l'ordre un triplet de loyers (€/m²) : minoré (−30 %), référence, majoré (+20 %).
 * L'ordre des colonnes varie d'une source à l'autre ; la règle, elle, ne varie pas.
 * Un triplet incohérent est écarté plutôt que mal lu.
 */
export function orderTriplet(values) {
  const nums = values.map(toNumber).filter((v) => v != null && v > 0).sort((a, b) => a - b);
  if (nums.length !== 3) return null;
  const [min, ref, max] = nums;
  const up = max / ref;
  const down = min / ref;
  if (up < 1.1 || up > 1.3 || down < 0.6 || down > 0.8) return null;
  return { min, ref, max };
}

/** Année d'une grille : 2025, « 2025 », « 2025-07-01 », « 2025-2026 » → 2025. */
export function parseYear(value) {
  const m = String(value ?? '').match(/(?:19|20)\d{2}/);
  return m ? Number(m[0]) : null;
}

/** Ligne de grille normalisée, ou null si elle est inutilisable. */
export function makeRow({ zone, year = null, rooms, period, furnished, min, ref, max }) {
  const r = gridRooms(rooms);
  const f = typeof furnished === 'boolean' ? furnished : parseFurnished(furnished);
  const p = typeof period === 'object' && period ? period : parsePeriod(period);
  const maxN = toNumber(max);
  const refN = toNumber(ref);
  const minN = toNumber(min);
  if (r == null || f == null || maxN == null || maxN <= 0) return null;
  return { zone: zone == null ? '' : String(zone), year: parseYear(year), rooms: r, period: p, furnished: f, min: minN, ref: refN, max: maxN };
}
