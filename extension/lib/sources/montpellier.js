// Montpellier : couche des zones de l'observatoire local des loyers (une zone de 1 à 5 par IRIS)
// et classeur de la grille (une feuille par zone : pièces × époque, vide puis meublé).
// Publiés chaque année aux mêmes adresses par Montpellier Méditerranée Métropole.

import { requestJson, requestBuffer, cached, DAY } from '../net.js';
import { makeRow, orderTriplet, toNumber } from '../grid.js';
import { readWorkbook } from '../xlsx.js';
import { irisCodesFor, samplePoints, polygonsOf, normalizeAxes, containsPoint } from '../geo.js';

const BASE = 'https://data.montpellier3m.fr/sites/default/files/ressources';
export const MONTPELLIER_ZONES = `${BASE}/MMM_MTP_Loyers.json`;
export const MONTPELLIER_GRID = `${BASE}/MMM_MTP_Loyers.xlsx`;

/** Zone (1 à 5) de chaque IRIS, et contours si la couche les publie. */
export function montpellierZoning(geojson) {
  const byIris = new Map();
  const shapes = [];
  for (const f of geojson?.features || []) {
    const zone = toNumber(f.properties?.zone_oll ?? f.properties?.zone);
    if (zone == null) continue;
    const code = f.properties?.code_iris != null ? String(f.properties.code_iris) : null;
    if (code) byIris.set(code, zone);
    const polygons = normalizeAxes(polygonsOf(f.geometry));
    if (polygons.length) shapes.push({ zone, polygons });
  }
  return { byIris, shapes };
}

/**
 * Lignes d'une feuille « ZoneN ». Chaque ligne : nombre de pièces, époque, puis deux triplets
 * (location vide, location meublée). On repère les triplets par leurs valeurs, pas par leurs colonnes.
 */
export function montpellierSheetRows(cells, zone) {
  const rows = [];
  // Ordre vide / meublé d'après l'en-tête quand il le précise (vide d'abord, comme dans les grilles publiées).
  let furnishedFirst = false;
  for (const line of cells) {
    const empty = line.findIndex((c) => /non[\s_-]*meubl|vide/i.test(c));
    const furnished = line.findIndex((c) => /meubl/i.test(c) && !/non[\s_-]*meubl/i.test(c));
    if (empty >= 0 && furnished >= 0) { furnishedFirst = furnished < empty; break; }
  }
  for (const line of cells) {
    const roomsCell = line[0] || '';
    const period = line[1] || '';
    if (!/\d/.test(roomsCell) || !/\d{4}/.test(period)) continue;
    // Trois montants pour la location vide, trois pour la meublée (une colonne vide ou un repère peut les séparer).
    const numbers = line.slice(2).map(toNumber).filter((n) => n != null);
    if (numbers.length < 6) continue;
    [orderTriplet(numbers.slice(0, 3)), orderTriplet(numbers.slice(-3))].forEach((t, index) => {
      const row = t && makeRow({ zone: `Zone ${zone}`, rooms: roomsCell, period, furnished: (index === 1) !== furnishedFirst, ...t });
      if (row) rows.push(row);
    });
  }
  return rows;
}

/** Toutes les lignes du classeur, indexées par zone. */
export function montpellierGrid(sheets) {
  const byZone = new Map();
  for (const sheet of sheets) {
    const zone = toNumber(sheet.name.match(/zone\s*(\d)/i)?.[1]);
    if (zone != null) byZone.set(zone, montpellierSheetRows(sheet.rows, zone));
  }
  return byZone;
}

export async function montpellierRows(area, { signal } = {}) {
  const zoning = await cached(MONTPELLIER_ZONES, DAY, async () => montpellierZoning(await requestJson(MONTPELLIER_ZONES, { signal, timeout: 30000 })));
  const zones = new Set();
  if (zoning.shapes.length) {
    for (const p of samplePoints(area)) {
      const hit = zoning.shapes.find((s) => containsPoint(s.polygons, p.lon, p.lat));
      if (hit) zones.add(hit.zone);
    }
  }
  if (!zones.size) {
    const codes = await irisCodesFor(area, (code) => code === '34172', { signal });
    for (const code of codes) if (zoning.byIris.has(code)) zones.add(zoning.byIris.get(code));
  }
  if (!zones.size) return [];
  const grid = await cached(MONTPELLIER_GRID, DAY, async () => montpellierGrid(await readWorkbook(await requestBuffer(MONTPELLIER_GRID, { signal, timeout: 30000 }))));
  return [...zones].flatMap((z) => grid.get(z) || []);
}
