// Vérification complète d'une annonce : localisation → territoire encadré → grille → verdict.

import { geocode, reverse } from './geo.js';
import { findTerritory } from './territories.js';
import { evaluate } from './verdict.js';
import { parisRows } from './sources/paris.js';
import { lyonRows } from './sources/lyon.js';
import { montpellierRows } from './sources/montpellier.js';
import { bordeauxRows } from './sources/bordeaux.js';

const SOURCES = { paris: parisRows, lyon: lyonRows, montpellier: montpellierRows, bordeaux: bordeauxRows };

// Coordonnées fournies par un site d'annonces sans adresse exacte (pastille « quartier » sur la carte).
const APPROXIMATE_COORDS_RADIUS = 500;

/**
 * Où est le logement ? Par ordre de confiance : adresse saisie ou publiée, coordonnées de l'annonce,
 * quartier, code postal et ville.
 * @param loc { address, lat, lon, approximate, radius, postcode, city, district }
 */
export async function locate(loc, { signal } = {}) {
  const where = [loc.district, loc.postcode, loc.city].filter(Boolean).join(' ');
  if (loc.address) {
    const place = await geocode([loc.address, loc.postcode, loc.city].filter(Boolean).join(' '), { signal });
    if (place) return { ...place, source: 'address' };
  }
  if (Number.isFinite(loc.lat) && Number.isFinite(loc.lon)) {
    const place = await reverse(loc.lat, loc.lon, { signal });
    const radius = loc.radius ?? (loc.approximate === false ? 0 : APPROXIMATE_COORDS_RADIUS);
    return {
      lat: loc.lat,
      lon: loc.lon,
      radius,
      citycode: place?.citycode || null,
      postcode: place?.postcode || loc.postcode || null,
      city: place?.city || loc.city || '',
      label: radius ? where || place?.city || '' : place?.label || where,
      source: 'coords',
    };
  }
  if (where) {
    const place = await geocode(where, { postcode: /^\d{5}$/.test(loc.postcode || '') ? loc.postcode : undefined, signal });
    if (place) return { ...place, source: 'area' };
  }
  return null;
}

/**
 * @param input { listing: { surface, rooms, furnished, construction, rent, dpe }, location: {…} }
 * @returns { status, territory?, place?, verdict?, rowsCount? }
 *   status : over | under | depends | incomplete | nodata | nosource | notcovered | nolocation
 */
export async function checkListing(input, { signal, today } = {}) {
  const place = await locate(input.location || {}, { signal });
  if (!place) return { status: 'nolocation' };
  const placeInfo = { label: place.label, city: place.city, postcode: place.postcode, approximate: place.radius > 0, radius: place.radius };
  const territory = findTerritory(place.citycode);
  if (!territory) return { status: 'notcovered', place: placeInfo };
  const territoryInfo = { id: territory.id, name: territory.name, officialUrl: territory.officialUrl, partial: Boolean(territory.partial) };
  if (!territory.source) return { status: 'nosource', place: placeInfo, territory: territoryInfo };

  const rows = await SOURCES[territory.source]({ lat: place.lat, lon: place.lon, radius: place.radius, citycode: place.citycode }, { signal, today });
  if (!rows.length) return { status: 'nodata', place: placeInfo, territory: territoryInfo };
  const verdict = evaluate(input.listing || {}, rows, { approximate: place.radius > 0 });
  return { status: verdict.status, place: placeInfo, territory: territoryInfo, verdict };
}
