// Lyon et Villeurbanne : couche WFS annuelle de la Métropole de Lyon (data.grandlyon.com), un polygone par IRIS.
// Chaque objet porte `valeurs` : pièces → époque → meublé ou non → { loyer_reference, loyer_reference_majore, loyer_reference_minore }.
// Le nom de la couche change chaque année (car_care.carencadrmtloyer_2025_2026…) : on le lit dans le catalogue data.gouv.fr.

import { requestJson, cached, DAY } from '../net.js';
import { makeRow, parseYear, parseFurnished, gridRooms, parsePeriod, orderTriplet } from '../grid.js';
import { irisCodesFor } from '../geo.js';
import { findTerritory } from '../territories.js';

const DATA_GOUV = 'https://www.data.gouv.fr/api/1/datasets/?q=Encadrement%20des%20loyers%20M%C3%A9tropole%20de%20Lyon&page_size=20';
const WFS = 'https://data.grandlyon.com/geoserver/metropole-de-lyon/ows';
// Repli si le catalogue est injoignable : la couche « latest » documentée par la Métropole.
const FALLBACK_TYPENAME = 'metropole-de-lyon:car_care.carencadrmtloyer_latest';

const typenameIn = (url) => {
  const m = /[?&]typenames?=([^&]+)/i.exec(url || '');
  return m ? decodeURIComponent(m[1]) : null;
};

/** Couche la plus récente d'après les titres des jeux de données (« … 2025-2026 »). */
export function latestTypename(datasets) {
  const candidates = (datasets || [])
    .filter((d) => /m[ée]tropole de lyon/i.test(d.title || '') && /encadrement/i.test(d.title || ''))
    .map((d) => ({
      year: Math.max(0, ...[...String(d.title).matchAll(/\b(20\d{2})\b/g)].map((m) => Number(m[1]))),
      typename: (d.resources || []).map((r) => typenameIn(r.url)).find(Boolean),
    }))
    .filter((c) => c.typename)
    .sort((a, b) => b.year - a.year);
  return candidates[0] ? { typename: candidates[0].typename, year: candidates[0].year } : null;
}

async function layer({ signal }) {
  return cached('lyon-typename', DAY, async () => {
    try {
      const data = await requestJson(DATA_GOUV, { signal });
      return latestTypename(data.data) || { typename: FALLBACK_TYPENAME, year: null };
    } catch {
      return { typename: FALLBACK_TYPENAME, year: null };
    }
  });
}

/**
 * Lignes de grille d'un objet de la couche. On repère chaque niveau de `valeurs` par son contenu
 * (un nombre de pièces, une époque, « meublé ») plutôt que par sa position.
 */
export function lyonRowsFromFeature(properties, gridStartYear = null) {
  let valeurs = properties?.valeurs;
  if (typeof valeurs === 'string') {
    try { valeurs = JSON.parse(valeurs); } catch { return []; }
  }
  const zone = properties?.zonage != null ? `Zone ${properties.zonage}` : (properties?.libelle || properties?.nom_iris || '');
  const rows = [];
  const visit = (node, keys) => {
    if (!node || typeof node !== 'object') return;
    const leafValues = ['loyer_reference_minore', 'loyer_reference', 'loyer_reference_majore'].map((k) => node[k]);
    if (leafValues.some((v) => v != null)) {
      const roomsKey = keys.find((k) => gridRooms(k) != null && !/\d{4}/.test(k));
      const periodKey = keys.find((k) => /\d{4}/.test(k));
      const furnishedKey = keys.find((k) => parseFurnished(k) != null);
      const triplet = orderTriplet(leafValues) || { min: node.loyer_reference_minore, ref: node.loyer_reference, max: node.loyer_reference_majore };
      const row = makeRow({
        zone,
        year: gridStartYear,
        rooms: roomsKey,
        period: parsePeriod(periodKey || ''),
        furnished: furnishedKey ?? null,
        ...triplet,
      });
      if (row) rows.push(row);
      return;
    }
    for (const [key, child] of Object.entries(node)) visit(child, [...keys, key]);
  };
  visit(valeurs, []);
  return rows;
}

export async function lyonRows(area, { signal } = {}) {
  const accept = (code) => findTerritory(code)?.id === 'lyon' && code !== '69123';
  const codes = await irisCodesFor(area, accept, { signal });
  if (!codes.length) return [];
  const { typename, year } = await layer({ signal });
  const params = new URLSearchParams({
    SERVICE: 'WFS',
    VERSION: '2.0.0',
    request: 'GetFeature',
    typename,
    outputFormat: 'application/json',
    CQL_FILTER: codes.map((c) => `codeiris=${Number(c)}`).join(' OR '),
  });
  const url = `${WFS}?${params}`;
  const data = await cached(url, DAY, () => requestJson(url, { signal, timeout: 30000 }));
  return (data.features || []).flatMap((f) => lyonRowsFromFeature(f.properties, year ? year - 1 : parseYear(typename)));
}
