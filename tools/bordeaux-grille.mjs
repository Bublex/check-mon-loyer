// Grille des loyers de référence de Bordeaux, à partir du tableur publié chaque année par la préfecture de la Gironde
// (« Tableaux_loyers_reference_Bordeaux_Arrete_AAAA-MM-JJ.xlsx » : une feuille Appartements, une feuille Maisons).
// Écrit extension/lib/data/bordeaux-grille.js. À relancer à chaque nouvel arrêté (en vigueur chaque 15 juillet).
//
// Usage : node tools/bordeaux-grille.mjs chemin/vers/Tableaux_loyers_reference_Bordeaux_Arrete_….xlsx
import { readFileSync, writeFileSync } from 'node:fs';
import { readWorkbook } from '../extension/lib/xlsx.js';
import { orderTriplet, toNumber } from '../extension/lib/grid.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage : node tools/bordeaux-grille.mjs Tableaux_loyers_reference_Bordeaux_Arrete_….xlsx');
  process.exit(1);
}
const OUT = new URL('../extension/lib/data/bordeaux-grille.js', import.meta.url);

const buf = readFileSync(file);
const sheets = await readWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

/** « 1 -Avant 1946 » → « Avant 1946 », « 2 - 1946-70 » → « 1946-1970 ». */
const periodLabel = (s) => s.replace(/^\s*\d\s*-\s*/, '').replace(/\b(1[89]|20)(\d{2})\s*-\s*(\d{2})\b/, (_, c, y, e) => `${c}${y}-${c}${e}`).trim();

let arrete = null;
const rows = [];
for (const sheet of sheets) {
  const kind = /maison/i.test(sheet.name) ? 'maison' : /appart/i.test(sheet.name) ? 'appartement' : null;
  if (!kind) continue;
  const date = sheet.rows.flat().join(' ').match(/arr[êe]t[ée][^0-9]*(\d{2})\/(\d{2})\/(\d{4})/i);
  if (date) arrete = `${date[3]}-${date[2]}-${date[1]}`;
  const h = sheet.rows.findIndex((r) => /secteur/i.test(r[0] || ''));
  if (h < 1) throw new Error(`Feuille ${sheet.name} : en-tête introuvable`);
  const header = sheet.rows[h];
  const groups = sheet.rows[h - 1];
  // Colonnes des deux triplets (vide puis meublé), repérées par leurs libellés.
  const cols = { false: {}, true: {} };
  const furnishedFrom = groups.findIndex((c) => /meubl/i.test(c));
  header.forEach((label, i) => {
    const key = /major[ée]/i.test(label) ? 'max' : /minor[ée]/i.test(label) ? 'min' : /^loyer de r[ée]f[ée]rence$/i.test(label.trim()) ? 'ref' : null;
    if (key) cols[furnishedFrom >= 0 && i >= furnishedFrom][key] = i;
  });
  let zone = null;
  let rooms = null;
  for (const r of sheet.rows.slice(h + 1)) {
    if (r[0]) zone = toNumber(r[0].replace(/\D/g, ''));
    if (r[1]) rooms = r[1];
    if (!r[2] || zone == null || rooms == null) continue;
    for (const furnished of [false, true]) {
      const c = cols[furnished];
      const t = orderTriplet([r[c.min], r[c.ref], r[c.max]]);
      if (!t || t.ref !== toNumber(r[c.ref])) throw new Error(`Feuille ${sheet.name}, zone ${zone}, ${rooms} pièces, ${r[2]} : triplet incohérent`);
      rows.push([zone, rooms === '4 et plus' ? 4 : Number(rooms), periodLabel(r[2]), kind, furnished ? 1 : 0, t.min, t.ref, t.max]);
    }
  }
}
if (rows.length !== 256) throw new Error(`${rows.length} lignes lues, 256 attendues (4 zones × 4 tailles × 4 époques × vide/meublé × appartement/maison)`);
if (!arrete) throw new Error('Date de l’arrêté introuvable');

const lines = [
  '// Généré par tools/bordeaux-grille.mjs à partir du tableur de la préfecture de la Gironde : ne pas modifier à la main.',
  '// Une ligne : zone, pièces (4 = 4 et plus), époque, type de logement, meublé (1) ou vide (0), loyers minoré, de référence, majoré (€/m²).',
  `export const BORDEAUX_ARRETE = ${JSON.stringify({ date: arrete, start: `${arrete.slice(0, 4)}-07-15` })};`,
  'export const BORDEAUX_GRID = [',
  ...rows.map((r) => `  ${JSON.stringify(r)},`),
  '];',
  '',
];
writeFileSync(OUT, lines.join('\n'));
console.log(`${rows.length} lignes, arrêté du ${arrete} → extension/lib/data/bordeaux-grille.js`);
