// Outils de test : faux services de données (fetch simulé) et petit écrivain de classeur .xlsx.
import { deflateRawSync } from 'node:zlib';

/** Remplace fetch : chaque route est [test de l'URL, réponse (objet JSON, ArrayBuffer ou fonction)]. */
export function mockFetch(routes) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const href = String(url);
    calls.push(href);
    const route = routes.find(([match]) => (typeof match === 'string' ? href.startsWith(match) : match.test(href)));
    if (!route) return new Response('not found', { status: 404 });
    let body = route[1];
    if (typeof body === 'function') body = body(href);
    if (body instanceof Response) return body;
    if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return new Response(body, { status: 200 });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

/** Carré GeoJSON autour d'un point (côté en degrés). */
export function square(lon, lat, half = 0.002) {
  return { type: 'Polygon', coordinates: [[[lon - half, lat - half], [lon + half, lat - half], [lon + half, lat + half], [lon - half, lat + half], [lon - half, lat - half]]] };
}

export function geocoderFeature({ lon, lat, type = 'housenumber', citycode, postcode, city, label }) {
  return { type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { type, citycode, postcode, city, label: label || city, score: 0.9 } };
}

// --- Grilles fictives ---

// Grille parisienne d'un quartier pour une année : 2 pièces vide avant 1946 → référence 28 €/m².
export function parisRecords(quartier, year, base = 28) {
  const out = [];
  for (const piece of [1, 2, 3, 4]) {
    for (const [epoque, delta] of [['Avant 1946', 0], ['1946-1970', -3], ['1971-1990', -4], ['Apres 1990', -1]]) {
      for (const meuble_txt of ['non meublé', 'meublé']) {
        const ref = Math.round((base + delta + (meuble_txt === 'meublé' ? 3 : 0) - (piece - 2)) * 10) / 10;
        out.push({ annee: String(year), piece, epoque, meuble_txt, ref, max: Math.round(ref * 12) / 10, min: Math.round(ref * 7) / 10, nom_quartier: quartier });
      }
    }
  }
  return out;
}

// Feuille « ZoneN » du classeur de Montpellier : pièces × époque, vide puis meublé.
export const montpellierSheet = (zone) => ({
  name: `Zone${zone}`,
  rows: [
    ['Nb pièces', 'Époque', 'F. non meublé - Réf', 'Majoré', 'Minoré', '', 'F. meublé - Réf', 'Majoré', 'Minoré'],
    ...[1, 2, 3, '4 et +'].flatMap((rooms, i) => ['Avant 1946', '1946-1970', '1971-1990', '1991-2005', 'Après 2005'].map((period, j) => {
      const ref = 14 - i - j * 0.5 + zone;
      return [String(rooms), period, ref, Math.round(ref * 12) / 10, Math.round(ref * 7) / 10, '', ref + 2, Math.round((ref + 2) * 12) / 10, Math.round((ref + 2) * 7) / 10];
    })),
  ],
});

// --- .xlsx minimal (chaînes partagées, feuilles nommées) ---

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8');
    const packed = deflateRawSync(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, packed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + packed.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  const all = Buffer.concat([...locals, ...centrals, end]);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const col = (i) => String.fromCharCode(65 + i);

/** Classeur dont chaque feuille est { name, rows: [[cellule…]] } (texte en chaînes partagées, nombres en valeurs). */
export function makeXlsx(sheets) {
  const strings = [];
  const sid = (s) => { let i = strings.indexOf(s); if (i < 0) { i = strings.length; strings.push(s); } return i; };
  const files = {};
  sheets.forEach((sheet, n) => {
    const rows = sheet.rows.map((cells, r) => `<row r="${r + 1}">${cells.map((v, c) => {
      if (v === null || v === '') return '';
      const ref = `${col(c)}${r + 1}`;
      return typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="s"><v>${sid(v)}</v></c>`;
    }).join('')}</row>`).join('');
    files[`xl/worksheets/sheet${n + 1}.xml`] = `<?xml version="1.0"?><worksheet><sheetData>${rows}</sheetData></worksheet>`;
  });
  files['xl/workbook.xml'] = `<?xml version="1.0"?><workbook xmlns:r="r"><sheets>${sheets.map((s, n) => `<sheet name="${esc(s.name)}" sheetId="${n + 1}" r:id="rId${n + 1}"/>`).join('')}</sheets></workbook>`;
  files['xl/_rels/workbook.xml.rels'] = `<?xml version="1.0"?><Relationships>${sheets.map((_, n) => `<Relationship Id="rId${n + 1}" Target="worksheets/sheet${n + 1}.xml"/>`).join('')}</Relationships>`;
  files['xl/sharedStrings.xml'] = `<?xml version="1.0"?><sst>${strings.map((s) => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`;
  return zip(files);
}
