// Bordeaux : grille de l'arrêté préfectoral (tableur de la préfecture de la Gironde, appartements et maisons)
// et zones 1 à 4 de la carte officielle, intégrées à l'extension (lib/data/, générées par tools/).
// Les zones sont des regroupements d'îlots IRIS : la zone d'un îlot est celle qui couvre la plus grande part
// de son contour sur la carte. Sans îlots (service indisponible), on lit la carte autour du point, avec une marge.

import { BORDEAUX_GRID, BORDEAUX_ARRETE } from '../data/bordeaux-grille.js';
import { BORDEAUX_ZONES, BORDEAUX_ZONE_RUNS } from '../data/bordeaux-zones.js';
import { makeRow } from '../grid.js';
import { irisOfCommune, samplePoints, containsPoint } from '../geo.js';

// Imprécision du calage de la carte (quelques dizaines de mètres) : marge minimale autour du point.
const MAP_MARGIN = 40;
// En dessous de cette part, un îlot partagé entre deux zones sur la carte reçoit les deux.
const MAJORITY = 0.65;

let decoded = null;
const zoneRows = () => (decoded ??= BORDEAUX_ZONE_RUNS.map((runs) => {
  const row = new Uint8Array(BORDEAUX_ZONES.cols);
  let at = 0;
  for (const run of runs.split(',')) {
    const n = parseInt(run.slice(1), 36);
    row.fill(Number(run[0]), at, at + n);
    at += n;
  }
  return row;
}));

/** Zone (1 à 4) de la carte en un point, 0 hors de Bordeaux. */
export function zoneAt(lat, lon) {
  const { latMax, lonMin, dLat, dLon, rows, cols } = BORDEAUX_ZONES;
  const i = Math.floor((latMax - lat) / dLat);
  const j = Math.floor((lon - lonMin) / dLon);
  if (i < 0 || j < 0 || i >= rows || j >= cols) return 0;
  return zoneRows()[i][j];
}

/** Zones d'un îlot : celle qui couvre la plus grande part de son contour, et la suivante si le partage est serré. */
export function zonesOfPolygons(polygons) {
  const { latMax, lonMin, dLat, dLon } = BORDEAUX_ZONES;
  const counts = [0, 0, 0, 0, 0];
  for (const poly of polygons) {
    const ring = poly[0] || [];
    const lons = ring.map((p) => p[0]);
    const lats = ring.map((p) => p[1]);
    const i0 = Math.max(0, Math.floor((latMax - Math.max(...lats)) / dLat));
    const i1 = Math.floor((latMax - Math.min(...lats)) / dLat);
    const j0 = Math.max(0, Math.floor((Math.min(...lons) - lonMin) / dLon));
    const j1 = Math.floor((Math.max(...lons) - lonMin) / dLon);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const lat = latMax - (i + 0.5) * dLat;
        const lon = lonMin + (j + 0.5) * dLon;
        if (containsPoint([poly], lon, lat)) counts[zoneAt(lat, lon)]++;
      }
    }
  }
  const total = counts.slice(1).reduce((a, b) => a + b, 0);
  if (!total) return [];
  const ranked = [1, 2, 3, 4].filter((z) => counts[z]).sort((a, b) => counts[b] - counts[a]);
  return counts[ranked[0]] / total >= MAJORITY ? [ranked[0]] : ranked.slice(0, 2);
}

/** Zones lues directement sur la carte autour du point. */
export function zonesOnMap(area) {
  const zones = new Set();
  for (const p of samplePoints({ ...area, radius: Math.max(area.radius || 0, MAP_MARGIN) })) {
    const z = zoneAt(p.lat, p.lon);
    if (z) zones.add(z);
  }
  return [...zones];
}

async function zonesFor(area, { signal }) {
  try {
    const iris = await irisOfCommune('33063', { signal });
    const zones = new Set();
    for (const p of samplePoints(area)) {
      const hit = iris.find((i) => containsPoint(i.polygons, p.lon, p.lat));
      if (hit) {
        hit.zones ??= zonesOfPolygons(hit.polygons);
        hit.zones.forEach((z) => zones.add(z));
      }
    }
    if (zones.size) return [...zones];
  } catch (error) {
    if (signal?.aborted) throw error;
  }
  return zonesOnMap(area);
}

/** Lignes de la grille, toutes zones confondues (normalisées une fois). */
let allRows = null;
export function bordeauxGrid() {
  allRows ??= BORDEAUX_GRID.map(([zone, rooms, period, kind, furnished, min, ref, max]) => makeRow({
    zone: `Zone ${zone}`,
    year: BORDEAUX_ARRETE.date,
    rooms,
    period,
    furnished: furnished === 1,
    kind,
    min,
    ref,
    max,
  }));
  return allRows;
}

export async function bordeauxRows(area, { signal } = {}) {
  const zones = await zonesFor(area, { signal });
  const labels = new Set(zones.map((z) => `Zone ${z}`));
  return bordeauxGrid().filter((r) => labels.has(r.zone));
}
