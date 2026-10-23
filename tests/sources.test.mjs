// Sources de données simulées : géocodage, IRIS, Paris (Opendatasoft), Lyon (WFS), Montpellier (GeoJSON + .xlsx).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockFetch, square, geocoderFeature, makeXlsx, parisRecords, montpellierSheet } from './helpers.mjs';
import { checkListing } from '../extension/lib/check.js';
import { currentGrid, parisRowsFromRecords } from '../extension/lib/sources/paris.js';
import { lyonRowsFromFeature, latestTypename } from '../extension/lib/sources/lyon.js';
import { montpellierGrid } from '../extension/lib/sources/montpellier.js';
import { readWorkbook } from '../extension/lib/xlsx.js';
import { bordeauxGrid, zoneAt, zonesOfPolygons } from '../extension/lib/sources/bordeaux.js';

let mock;
afterEach(() => mock?.restore());

const TODAY = new Date('2026-10-23T12:00:00Z');

const listing = (over = {}) => ({
  surface: 40,
  rooms: 2,
  furnished: false,
  construction: { from: 1900, to: 1900 },
  rent: { amount: 1500, chargesIncluded: true, charges: 100 },
  ...over,
});

test('Paris : grille en vigueur (1er juillet)', () => {
  const rows = parisRowsFromRecords([...parisRecords('Q', 2026), ...parisRecords('Q', 2025)]);
  assert.equal(currentGrid(rows, new Date('2026-10-01')).every((r) => r.year === 2026), true);
  assert.equal(currentGrid(rows, new Date('2026-06-15')).every((r) => r.year === 2025), true);
});

test('Paris : adresse exacte, loyer au-dessus du plafond', async () => {
  mock = mockFetch([
    ['https://data.geopf.fr/geocodage/search', { features: [geocoderFeature({ lon: 2.3705, lat: 48.8665, citycode: '75111', postcode: '75011', city: 'Paris', label: '12 Rue Oberkampf 75011 Paris' })] }],
    ['https://opendata.paris.fr/', (url) => {
      assert.equal(new URL(url).searchParams.get('where'), "intersects(geo_shape, geom'POINT(2.370500 48.866500)')");
      return { total_count: 64, results: [...parisRecords('Folie-Méricourt', 2026), ...parisRecords('Folie-Méricourt', 2025)] };
    }],
  ]);
  const result = await checkListing({ listing: listing(), location: { address: '12 rue Oberkampf', postcode: '75011', city: 'Paris' } }, { today: TODAY });
  assert.equal(result.status, 'over');
  assert.equal(result.territory.id, 'paris');
  assert.equal(result.place.approximate, false);
  // 28 × 1,2 = 33,6 €/m² × 40 m² = 1 344 € ; loyer hors charges 1 400 €.
  assert.deepEqual(result.verdict.ceiling, { low: 1344, high: 1344 });
  assert.equal(result.verdict.overBy, 56);
  assert.deepEqual(result.verdict.zones, ['Folie-Méricourt']);
  assert.deepEqual(result.verdict.years, [2026]);
});

test('Paris : position approximative, plusieurs quartiers possibles', async () => {
  mock = mockFetch([
    ['https://data.geopf.fr/geocodage/reverse', { features: [geocoderFeature({ lon: 2.37, lat: 48.86, citycode: '75111', postcode: '75011', city: 'Paris' })] }],
    ['https://opendata.paris.fr/', (url) => {
      assert.match(new URL(url).searchParams.get('where'), /^intersects\(geo_shape, geom'POLYGON\(\(2\.36\d+ 48\.85\d+, /);
      return { results: [...parisRecords('Folie-Méricourt', 2026), ...parisRecords('Saint-Ambroise', 2026, 26)] };
    }],
  ]);
  const result = await checkListing({ listing: listing({ rent: { amount: 1300, chargesIncluded: false } }), location: { lat: 48.86, lon: 2.37, postcode: '75011', city: 'Paris' } }, { today: TODAY });
  assert.equal(result.place.approximate, true);
  assert.equal(result.status, 'depends');
  assert.deepEqual(result.verdict.spread, ['address']);
  assert.deepEqual(result.verdict.ceiling, { low: 1248, high: 1344 });
});

test('Lyon : couche annuelle trouvée sur data.gouv.fr, objet repéré par son IRIS', async () => {
  const valeurs = {
    2: {
      'avant 1946': { 'non meublé': { loyer_reference: 13, loyer_reference_majore: 15.6, loyer_reference_minore: 9.1 }, 'meublé': { loyer_reference: 15, loyer_reference_majore: 18, loyer_reference_minore: 10.5 } },
      '1946-1970': { 'non meublé': { loyer_reference: 12, loyer_reference_majore: 14.4, loyer_reference_minore: 8.4 }, 'meublé': { loyer_reference: 14, loyer_reference_majore: 16.8, loyer_reference_minore: 9.8 } },
    },
  };
  mock = mockFetch([
    ['https://data.geopf.fr/geocodage/reverse', { features: [geocoderFeature({ lon: 4.85, lat: 45.76, citycode: '69383', postcode: '69003', city: 'Lyon' })] }],
    ['https://data.geopf.fr/wfs/ows', (url) => {
      assert.match(decodeURIComponent(url), /code_insee='69383'/);
      return { features: [{ properties: { code_iris: '693830101', nom_iris: 'Part-Dieu' }, geometry: square(4.85, 45.76) }] };
    }],
    ['https://www.data.gouv.fr/api/1/datasets/', { data: [
      { title: 'Encadrement des loyers de la Métropole de Lyon 2024-2025', resources: [{ url: 'https://data.grandlyon.com/geoserver/metropole-de-lyon/ows?SERVICE=WFS&typename=metropole-de-lyon:car_care.carencadrmtloyer_2024_2025' }] },
      { title: 'Encadrement des loyers de la Métropole de Lyon 2025-2026', resources: [{ url: 'https://data.grandlyon.com/geoserver/metropole-de-lyon/ows?SERVICE=WFS&typename=metropole-de-lyon:car_care.carencadrmtloyer_2025_2026' }] },
    ] }],
    ['https://data.grandlyon.com/', (url) => {
      assert.match(decodeURIComponent(url), /typename=metropole-de-lyon:car_care\.carencadrmtloyer_2025_2026/);
      assert.match(decodeURIComponent(url), /codeiris=693830101/);
      return { features: [{ properties: { codeiris: 693830101, zonage: 2, valeurs: JSON.stringify(valeurs) } }] };
    }],
  ]);
  const result = await checkListing({ listing: listing({ construction: null, rent: { amount: 700, chargesIncluded: false } }), location: { lat: 45.76, lon: 4.85, approximate: false } });
  assert.equal(result.territory.id, 'lyon');
  // 2 pièces vide, époque inconnue : majoré 14,40 à 15,60 €/m² × 40 m² = 576 à 624 €.
  assert.deepEqual(result.verdict.ceiling, { low: 576, high: 624 });
  assert.equal(result.status, 'over');
  assert.deepEqual(result.verdict.zones, ['Zone 2']);
  assert.deepEqual(result.verdict.years, [2025]);
});

test('Lyon : niveaux de « valeurs » reconnus par leur contenu', () => {
  const rows = lyonRowsFromFeature({ zonage: 1, valeurs: { '4_pieces_et_plus': { apres_2005: { meuble: { loyer_reference: 14, loyer_reference_majore: 16.8, loyer_reference_minore: 9.8 } } } } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rooms, 4);
  assert.equal(rows[0].furnished, true);
  assert.equal(rows[0].period.from, 2006);
  assert.equal(latestTypename([]), null);
});

test('Montpellier : classeur lu sans dépendance', async () => {
  const sheets = await readWorkbook(makeXlsx([montpellierSheet(1), montpellierSheet(2)]));
  assert.deepEqual(sheets.map((s) => s.name), ['Zone1', 'Zone2']);
  const grid = montpellierGrid(sheets);
  assert.equal(grid.get(1).length, 40);
  const row = grid.get(2).find((r) => r.rooms === 4 && r.furnished && r.period.label === 'Après 2005');
  // Zone 2, 4 pièces, après 2005 : référence 14 − 3 − 2 + 2 = 11, meublé 13 → majoré 15,6.
  assert.equal(row.max, 15.6);
});

test('Montpellier : zone trouvée sur la couche des IRIS, verdict', async () => {
  mock = mockFetch([
    ['https://data.geopf.fr/geocodage/search', { features: [geocoderFeature({ lon: 3.88, lat: 43.61, citycode: '34172', postcode: '34000', city: 'Montpellier', type: 'housenumber' })] }],
    ['https://data.montpellier3m.fr/sites/default/files/ressources/MMM_MTP_Loyers.json', { features: [
      { properties: { code_iris: '341720101', zone_oll: 2 }, geometry: square(3.88, 43.61) },
      { properties: { code_iris: '341720102', zone_oll: 1 }, geometry: square(3.90, 43.61) },
    ] }],
    ['https://data.montpellier3m.fr/sites/default/files/ressources/MMM_MTP_Loyers.xlsx', makeXlsx([1, 2, 3, 4, 5].map(montpellierSheet))],
  ]);
  const result = await checkListing({
    listing: listing({ rooms: 2, furnished: true, construction: { from: 2010, to: 2010 }, rent: { amount: 600, chargesIncluded: false } }),
    location: { address: '1 place de la Comédie', city: 'Montpellier' },
  });
  assert.equal(result.territory.id, 'montpellier');
  assert.equal(result.status, 'under');
  // Zone 2, 2 pièces, après 2005, meublé : référence 14 − 1 − 2 + 2 + 2 = 15 → majoré 18 €/m² × 40 = 720 €.
  assert.deepEqual(result.verdict.ceiling, { low: 720, high: 720 });
  assert.deepEqual(result.verdict.zones, ['Zone 2']);
});

const BOURSE = { lat: 44.8414, lon: -0.5701 };

test('Bordeaux : grille de l’arrêté (appartements et maisons)', () => {
  const grid = bordeauxGrid();
  assert.equal(grid.length, 256);
  const row = grid.find((r) => r.zone === 'Zone 2' && r.rooms === 2 && r.period.label === '1946-1970' && !r.furnished && r.kind === 'appartement');
  assert.deepEqual([row.min, row.ref, row.max, row.year], [8.8, 12.5, 15, 2026]);
  assert.deepEqual([row.period.from, row.period.to], [1946, 1970]);
  const house = grid.find((r) => r.zone === 'Zone 1' && r.rooms === 1 && r.period.label === 'Avant 1946' && r.furnished && r.kind === 'maison');
  assert.equal(house.max, 29.2);
});

test('Bordeaux : zones de la carte en des lieux connus', () => {
  assert.equal(zoneAt(BOURSE.lat, BOURSE.lon), 1, 'place de la Bourse');
  assert.equal(zoneAt(44.8487, -0.5778), 1, 'Jardin public');
  assert.equal(zoneAt(44.8625, -0.5503), 4, 'Cité du Vin');
  assert.equal(zoneAt(44.8857, -0.5650), 3, 'Ginko');
  assert.equal(zoneAt(44.8386, -0.6436), 0, 'Mérignac, hors de Bordeaux');
  // Un îlot entièrement en zone 1, et un îlot à cheval sur les zones 2 et 1 (les deux sont gardées).
  assert.deepEqual(zonesOfPolygons([square(BOURSE.lon, BOURSE.lat, 0.001).coordinates]), [1]);
  assert.deepEqual(zonesOfPolygons([square(-0.585, 44.848, 0.002).coordinates]), [2, 1]);
});

test('Bordeaux : adresse exacte, zone de l’îlot, appartement ou maison', async () => {
  mock = mockFetch([
    ['https://data.geopf.fr/geocodage/search', { features: [geocoderFeature({ lon: BOURSE.lon, lat: BOURSE.lat, citycode: '33063', postcode: '33000', city: 'Bordeaux' })] }],
    ['https://data.geopf.fr/wfs/ows', (url) => {
      assert.match(new URL(url).searchParams.get('CQL_FILTER'), /33063/);
      return { features: [{ properties: { code_iris: '330630101', nom_iris: 'Bourse' }, geometry: square(BOURSE.lon, BOURSE.lat, 0.001) }] };
    }],
  ]);
  const flat = listing({ construction: { from: 1900, to: 1900 }, kind: 'appartement', rent: { amount: 900, chargesIncluded: true, charges: 50 } });
  const result = await checkListing({ listing: flat, location: { address: '1 place de la Bourse', city: 'Bordeaux' } });
  assert.equal(result.territory.id, 'bordeaux');
  // Zone 1, appartement 2 pièces vide avant 1946 : majoré 18,80 €/m² × 40 m² = 752 € ; loyer hors charges 850 €.
  assert.deepEqual(result.verdict.zones, ['Zone 1']);
  assert.deepEqual(result.verdict.ceiling, { low: 752, high: 752 });
  assert.equal(result.status, 'over');
  assert.equal(result.verdict.overBy, 98);
  // Maison : majoré 20,80 €/m² → 832 €.
  const house = await checkListing({ listing: { ...flat, kind: 'maison' }, location: { address: '1 place de la Bourse', city: 'Bordeaux' } });
  assert.equal(house.verdict.overBy, 18);
  // Type inconnu : les deux grilles.
  const unknown = await checkListing({ listing: { ...flat, kind: null }, location: { address: '1 place de la Bourse', city: 'Bordeaux' } });
  assert.deepEqual(unknown.verdict.ceiling, { low: 752, high: 832 });
  assert.ok(unknown.verdict.spread.includes('kind'));
});

test('Bordeaux : sans îlots, la carte seule ; Lille : encadré sans calcul ; Mérignac : pas d’encadrement', async () => {
  mock = mockFetch([
    [/geocodage\/search.*Bourse/, { features: [geocoderFeature({ lon: BOURSE.lon, lat: BOURSE.lat, citycode: '33063', postcode: '33000', city: 'Bordeaux' })] }],
    [/geocodage\/search.*Lille/, { features: [geocoderFeature({ lon: 3.06, lat: 50.63, citycode: '59350', postcode: '59000', city: 'Lille', type: 'municipality' })] }],
    [/geocodage\/search.*M%C3%A9rignac|geocodage\/search.*Merignac/, { features: [geocoderFeature({ lon: -0.64, lat: 44.84, citycode: '33281', postcode: '33700', city: 'Mérignac', type: 'municipality' })] }],
    ['https://data.geopf.fr/wfs/ows', new Response('indisponible', { status: 503 })],
  ]);
  const bordeaux = await checkListing({ listing: listing({ construction: { from: 1900, to: 1900 }, kind: 'appartement' }), location: { address: '1 place de la Bourse', city: 'Bordeaux' } });
  assert.deepEqual(bordeaux.verdict.zones, ['Zone 1']);
  const lille = await checkListing({ listing: listing(), location: { postcode: '59000', city: 'Lille' } });
  assert.equal(lille.status, 'nosource');
  assert.match(lille.territory.officialUrl, /^https:\/\/encadrement-loyers\.lille\.fr\//);
  const merignac = await checkListing({ listing: listing(), location: { postcode: '33700', city: 'Mérignac' } });
  assert.equal(merignac.status, 'notcovered');
  assert.equal(merignac.place.city, 'Mérignac');
});

test('Sans localisation', async () => {
  assert.equal((await checkListing({ listing: listing(), location: {} })).status, 'nolocation');
});
