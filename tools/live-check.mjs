// Vérification en direct des services publics de données, avec le code de l'extension :
// géocodage, IRIS, grilles de Paris, Lyon-Villeurbanne et Montpellier. À relancer de temps en temps
// (les portails changent de format sans prévenir) et après chaque nouvelle grille annuelle.
//
// Usage : node tools/live-check.mjs
import { checkListing } from '../extension/lib/check.js';

const listing = { surface: 40, rooms: 2, furnished: false, construction: null, rent: { amount: 1000, chargesIncluded: false } };

const CASES = [
  ['Paris, adresse exacte', { address: '12 rue Oberkampf', postcode: '75011', city: 'Paris' }, 'paris'],
  ['Paris, quartier seulement', { postcode: '75011', city: 'Paris' }, 'paris'],
  ['Lyon', { address: '10 rue de la République', postcode: '69002', city: 'Lyon' }, 'lyon'],
  ['Villeurbanne', { address: 'Place Lazare Goujon', postcode: '69100', city: 'Villeurbanne' }, 'lyon'],
  ['Montpellier', { address: '1 place de la Comédie', postcode: '34000', city: 'Montpellier' }, 'montpellier'],
  ['Bordeaux (encadré, sans calcul)', { postcode: '33000', city: 'Bordeaux' }, 'bordeaux'],
  ['Mérignac (non encadré)', { postcode: '33700', city: 'Mérignac' }, null],
];

let failures = 0;
for (const [label, location, territory] of CASES) {
  const started = Date.now();
  try {
    const r = await checkListing({ listing, location });
    const v = r.verdict;
    const ok = (r.territory?.id ?? null) === territory && (!['paris', 'lyon', 'montpellier'].includes(territory) || v?.perM2);
    if (!ok) failures++;
    console.log(`${ok ? 'ok  ' : 'ÉCHEC'} ${label} — ${r.status}${r.place ? ` · ${r.place.label}` : ''} (${Date.now() - started} ms)`);
    if (v?.perM2) console.log(`      majoré ${v.perM2.min} à ${v.perM2.max} €/m² · secteurs ${v.zones.join(', ')} · grille ${v.years.join(', ') || '?'} · époques ${v.periods.join(', ')}`);
  } catch (error) {
    failures++;
    console.log(`ÉCHEC ${label} — ${error.message}`);
  }
}
process.exit(failures ? 1 : 0);
