// Lecture minimale d'un classeur .xlsx (archive zip de fichiers XML), sans dépendance :
// répertoire central du zip, décompression « deflate-raw » native, chaînes partagées et cellules des feuilles.
// Suffit pour les grilles de loyers publiées en tableur ; les formules et les styles sont ignorés.

const decoder = new TextDecoder('utf-8');

function zipEntries(buffer) {
  const view = new DataView(buffer);
  let eocd = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Classeur illisible (zip sans répertoire central)');
  const entries = new Map();
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < count && view.getUint32(offset, true) === 0x02014b50; i++) {
    const method = view.getUint16(offset + 10, true);
    const size = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    entries.set(name, { method, start, size });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function inflate(buffer, entry) {
  const slice = buffer.slice(entry.start, entry.start + entry.size);
  if (entry.method === 0) return decoder.decode(slice);
  if (entry.method !== 8) throw new Error('Classeur illisible (compression inconnue)');
  const stream = new Blob([slice]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

const unescapeXml = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&');

function sharedStrings(xml) {
  const out = [];
  for (const si of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    out.push(unescapeXml([...si[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  }
  return out;
}

const columnIndex = (ref) => [...(ref.match(/^[A-Z]+/)?.[0] || '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** Cellules d'une feuille, ligne par ligne (tableau dense, chaînes vides pour les cellules absentes). */
export function sheetRows(xml, shared = []) {
  const rows = [];
  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const index = columnIndex(attrs.match(/\br="([A-Z]+)\d+"/)?.[1] || '');
      if (index < 0) continue;
      const inner = c[2] || '';
      const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      const inline = inner.match(/<is>([\s\S]*?)<\/is>/)?.[1];
      let value = '';
      if (/\bt="s"/.test(attrs)) value = shared[Number(v)] ?? '';
      else if (inline != null) value = unescapeXml([...inline.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));
      else if (v != null) value = unescapeXml(v);
      while (cells.length < index) cells.push('');
      cells[index] = value.trim();
    }
    rows.push(cells);
  }
  return rows;
}

/** Feuilles du classeur, dans l'ordre, avec leur nom : [{ name, rows }]. */
export async function readWorkbook(buffer) {
  const entries = zipEntries(buffer);
  const read = async (name) => (entries.has(name) ? inflate(buffer, entries.get(name)) : null);
  const shared = sharedStrings((await read('xl/sharedStrings.xml')) || '');
  const workbook = (await read('xl/workbook.xml')) || '';
  const rels = (await read('xl/_rels/workbook.xml.rels')) || '';
  const targets = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [
    m[0].match(/\bId="([^"]+)"/)?.[1],
    m[0].match(/\bTarget="([^"]+)"/)?.[1],
  ]));
  const sheets = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = unescapeXml(m[0].match(/\bname="([^"]*)"/)?.[1] || '');
    const target = targets.get(m[0].match(/\br:id="([^"]+)"/)?.[1]) || '';
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    const xml = await read(path);
    if (xml != null) sheets.push({ name, rows: sheetRows(xml, shared) });
  }
  return sheets;
}
