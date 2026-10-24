// Localisation du logement : géocodage (Base Adresse Nationale, servie par la Géoplateforme de l'IGN),
// îlots IRIS de l'INSEE (même Géoplateforme) et géométrie simple (point dans polygone, points d'échantillonnage).
// Quand l'annonce ne donne qu'un quartier ou une ville, on raisonne sur une zone autour du point.

import { requestJson, cached, DAY } from './net.js';

const GEOCODER = 'https://data.geopf.fr/geocodage';
const WFS = 'https://data.geopf.fr/wfs/ows';
const IRIS_LAYER = 'STATISTICALUNITS.IRIS:contours_iris';

// Rayon d'incertitude (mètres) selon la précision du résultat de géocodage.
const RADIUS = { housenumber: 0, street: 150, locality: 350, municipality: 1200 };

function toPlace(feature) {
  const p = feature?.properties;
  const [lon, lat] = feature?.geometry?.coordinates || [];
  if (!p || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    lat,
    lon,
    label: p.label || '',
    type: p.type || 'municipality',
    citycode: p.citycode || null,
    postcode: p.postcode || null,
    city: p.city || '',
    score: p.score ?? null,
  };
}

/** Meilleure adresse pour un texte libre (adresse, quartier, ville, code postal). */
export async function geocode(query, { postcode, citycode, signal } = {}) {
  const params = new URLSearchParams({ q: query, limit: '1' });
  if (postcode) params.set('postcode', postcode);
  if (citycode) params.set('citycode', citycode);
  const url = `${GEOCODER}/search?${params}`;
  const data = await cached(url, DAY, () => requestJson(url, { signal }));
  const place = toPlace(data?.features?.[0]);
  if (!place) return null;
  return { ...place, radius: RADIUS[place.type] ?? RADIUS.municipality };
}

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));

/** Codes INSEE d'une même ville : Paris, Lyon et Marseille avec tous leurs arrondissements. */
export function cityCodes(citycode) {
  const n = Number(citycode);
  if (n === 75056 || (n >= 75101 && n <= 75120)) return ['75056', ...range(75101, 75120)];
  if (n === 69123 || (n >= 69381 && n <= 69389)) return ['69123', ...range(69381, 69389)];
  if (n === 13055 || (n >= 13201 && n <= 13216)) return ['13055', ...range(13201, 13216)];
  return citycode ? [String(citycode)] : [];
}

/**
 * Suggestions d'adresses pendant la saisie, limitées à la ville du logement quand elle est connue
 * (filtre du géocodeur pour une commune, tri par proximité et filtrage ici pour une ville à arrondissements).
 */
export async function suggestAddresses(text, { citycode, city, lat, lon } = {}, { signal } = {}) {
  const q = String(text || '').trim();
  if (q.length < 3) return [];
  const codes = cityCodes(citycode);
  const params = new URLSearchParams({ q, autocomplete: '1', limit: '15' });
  if (codes.length === 1) params.set('citycode', codes[0]);
  else if (codes.length) {
    if (city && !q.toLowerCase().includes(city.toLowerCase())) params.set('q', `${q} ${city}`);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      params.set('lat', lat.toFixed(5));
      params.set('lon', lon.toFixed(5));
    }
  }
  const url = `${GEOCODER}/search?${params}`;
  const data = await cached(url, DAY, () => requestJson(url, { signal }));
  const seen = new Set();
  return (data?.features || [])
    .map(toPlace)
    .filter((p) => p && p.type !== 'municipality' && (!codes.length || codes.includes(p.citycode)))
    .filter((p) => !seen.has(p.label) && seen.add(p.label))
    .slice(0, 6)
    .map((p) => ({ label: p.label, type: p.type }));
}

/** Commune (code INSEE, arrondissement pour Paris, Lyon et Marseille) d'un point. */
export async function reverse(lat, lon, { signal } = {}) {
  const url = `${GEOCODER}/reverse?${new URLSearchParams({ lat: lat.toFixed(6), lon: lon.toFixed(6), limit: '1' })}`;
  const data = await cached(url, DAY, () => requestJson(url, { signal }));
  return toPlace(data?.features?.[0]);
}

// --- Géométrie ---

export function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Polygone GeoJSON (anneau extérieur puis trous). */
export function pointInPolygon(lon, lat, polygon) {
  if (!polygon.length || !pointInRing(lon, lat, polygon[0])) return false;
  return !polygon.slice(1).some((hole) => pointInRing(lon, lat, hole));
}

/** Géométrie GeoJSON → liste de polygones. */
export function polygonsOf(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

export const containsPoint = (polygons, lon, lat) => polygons.some((poly) => pointInPolygon(lon, lat, poly));

/**
 * Certains services renvoient les coordonnées dans l'ordre (latitude, longitude).
 * En France métropolitaine, la longitude est entre −6 et 10, la latitude entre 41 et 52.
 */
export function normalizeAxes(polygons) {
  const first = polygons[0]?.[0]?.[0];
  if (!first || !(first[0] > 40 && Math.abs(first[1]) < 11)) return polygons;
  return polygons.map((poly) => poly.map((ring) => ring.map(([a, b, ...rest]) => [b, a, ...rest])));
}

/** Point situé à `meters` du point de départ, dans la direction `bearing` (degrés). */
export function offset(lat, lon, bearing, meters) {
  const b = (bearing * Math.PI) / 180;
  return {
    lat: lat + (meters * Math.cos(b)) / 111320,
    lon: lon + (meters * Math.sin(b)) / (111320 * Math.cos((lat * Math.PI) / 180)),
  };
}

/** Points représentatifs d'une zone : le centre, puis deux cercles (rayon et demi-rayon). */
export function samplePoints({ lat, lon, radius = 0 }) {
  const points = [{ lat, lon }];
  if (!radius) return points;
  for (const r of [radius / 2, radius]) {
    for (let bearing = 0; bearing < 360; bearing += 45) points.push(offset(lat, lon, bearing, r));
  }
  return points;
}

/** Carré englobant la zone, au format WKT (longitude latitude). */
export function squareWkt({ lat, lon, radius }) {
  const n = offset(lat, lon, 0, radius).lat;
  const s = offset(lat, lon, 180, radius).lat;
  const e = offset(lat, lon, 90, radius).lon;
  const w = offset(lat, lon, 270, radius).lon;
  const f = (x) => x.toFixed(6);
  return `POLYGON((${f(w)} ${f(s)}, ${f(e)} ${f(s)}, ${f(e)} ${f(n)}, ${f(w)} ${f(n)}, ${f(w)} ${f(s)}))`;
}

// --- IRIS ---

/** Tous les IRIS d'une commune (ou d'un arrondissement), avec leur contour. */
export async function irisOfCommune(citycode, { signal } = {}) {
  const params = new URLSearchParams({
    SERVICE: 'WFS',
    VERSION: '2.0.0',
    REQUEST: 'GetFeature',
    TYPENAMES: IRIS_LAYER,
    OUTPUTFORMAT: 'application/json',
    CQL_FILTER: `code_insee='${citycode}'`,
  });
  const url = `${WFS}?${params}`;
  return cached(url, 7 * DAY, async () => {
    const data = await requestJson(url, { signal, timeout: 30000 });
    return (data.features || []).map((f) => ({
      code: String(f.properties?.code_iris || ''),
      name: f.properties?.nom_iris || '',
      polygons: normalizeAxes(polygonsOf(f.geometry)),
    })).filter((iris) => iris.code);
  });
}

/**
 * Codes IRIS couvrant une zone. Les points qui tombent hors des communes déjà chargées
 * sont rattachés à leur commune par géocodage inverse. `accept(citycode)` écarte les communes hors territoire.
 */
export async function irisCodesFor(area, accept, { signal } = {}) {
  const loaded = new Map();
  const load = async (code) => {
    if (!loaded.has(code)) loaded.set(code, await irisOfCommune(code, { signal }));
    return loaded.get(code);
  };
  if (area.citycode && accept(area.citycode)) await load(area.citycode);

  const codes = new Set();
  for (const point of samplePoints(area)) {
    const find = () => [...loaded.values()].flat().find((iris) => containsPoint(iris.polygons, point.lon, point.lat));
    let hit = find();
    if (!hit) {
      const place = await reverse(point.lat, point.lon, { signal });
      if (place?.citycode && accept(place.citycode) && !loaded.has(place.citycode)) {
        await load(place.citycode);
        hit = find();
      }
    }
    if (hit) codes.add(hit.code);
  }
  return [...codes];
}
