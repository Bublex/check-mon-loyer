// Paris : jeu de données « Logement - Encadrement des loyers » de la Ville (Opendatasoft, mis à jour chaque 1er juillet).
// Une ligne par quartier administratif, année, nombre de pièces, époque de construction et type de location.
// La recherche est géographique : le quartier qui contient le point, ou tous ceux qui touchent la zone.

import { requestJson, cached, DAY } from '../net.js';
import { makeRow, parseYear } from '../grid.js';
import { squareWkt } from '../geo.js';

export const PARIS_RECORDS = 'https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/logement-encadrement-des-loyers/records';
const PAGE = 100;
const MAX_PAGES = 8;

/** Lignes d'une réponse de l'API, normalisées. */
export function parisRowsFromRecords(records) {
  return records.map((r) => makeRow({
    zone: r.nom_quartier,
    year: r.annee,
    rooms: r.piece,
    period: r.epoque,
    furnished: r.meuble_txt,
    min: r.min,
    ref: r.ref,
    max: r.max,
  })).filter(Boolean);
}

/**
 * Grille en vigueur à une date : la plus récente dont l'année de départ (1er juillet) est passée,
 * ou à défaut la plus récente publiée.
 */
const startedYear = (today) => (today.getMonth() >= 6 ? today.getFullYear() : today.getFullYear() - 1);

/** Année de la grille en vigueur parmi celles publiées (null si aucune n'a encore commencé). */
function gridYear(years, today) {
  const started = years.filter((y) => Number.isFinite(y) && y <= startedYear(today));
  return started.length ? Math.max(...started) : null;
}

export function currentGrid(rows, today = new Date()) {
  const years = [...new Set(rows.map((r) => r.year).filter((y) => Number.isFinite(y)))];
  if (!years.length) return rows;
  const year = gridYear(years, today) ?? Math.max(...years);
  return rows.filter((r) => r.year === year);
}

export async function parisRows(area, { signal, today = new Date() } = {}) {
  const geom = area.radius ? squareWkt(area) : `POINT(${area.lon.toFixed(6)} ${area.lat.toFixed(6)})`;
  const where = `intersects(geo_shape, geom'${geom}')`;
  const records = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      where,
      select: 'annee,piece,epoque,meuble_txt,ref,min,max,nom_quartier',
      order_by: 'annee desc',
      limit: String(PAGE),
      offset: String(page * PAGE),
    });
    const url = `${PARIS_RECORDS}?${params}`;
    const data = await cached(url, DAY, () => requestJson(url, { signal }));
    const results = data.results || [];
    records.push(...results);
    if (results.length < PAGE) break;
    // Résultats triés par année décroissante : dès qu'une année antérieure à la grille en vigueur apparaît,
    // celle-ci est complète. (En juin, la grille du 1er juillet peut déjà être publiée : on continue jusqu'à la précédente.)
    const target = gridYear([...new Set(records.map((r) => parseYear(r.annee)))], today);
    if (target != null && results.some((r) => parseYear(r.annee) < target)) break;
  }
  return currentGrid(parisRowsFromRecords(records), today);
}
