// Test de bout en bout : charge l'extension dans Chrome (profil temporaire, headless), ouvre des pages d'annonce
// enregistrées (servies à leur vraie adresse par interception) et simule les services publics de données.
// Vérifie la pastille et le verdict, la correction par le formulaire et la fenêtre de l'extension ; enregistre des captures.
//
// Usage :
//   CHROME_PATH=/chemin/vers/chrome node tools/e2e.mjs [dossier-de-sortie]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { launch, sleep } from './chrome.mjs';
import { square, geocoderFeature, makeXlsx, parisRecords, montpellierSheet } from '../tests/helpers.mjs';

const OUT = resolve(process.argv[2] || join(tmpdir(), 'check-mon-loyer-e2e'));
const fixture = (name) => readFileSync(new URL(`../tests/fixtures/${name}`, import.meta.url));

// --- Services publics simulés (mêmes formats que les vrais) ---

const json = (data) => ({ body: JSON.stringify(data), type: 'application/json' });
const place = (lon, lat, citycode, postcode, city, type, label) => json({ features: [geocoderFeature({ lon, lat, citycode, postcode, city, type, label })] });

const lyonValeurs = {
  2: {
    'avant 1946': { 'non meublé': { loyer_reference: 13, loyer_reference_majore: 15.6, loyer_reference_minore: 9.1 }, 'meublé': { loyer_reference: 15, loyer_reference_majore: 18, loyer_reference_minore: 10.5 } },
    '1946-1970': { 'non meublé': { loyer_reference: 12, loyer_reference_majore: 14.4, loyer_reference_minore: 8.4 }, 'meublé': { loyer_reference: 14, loyer_reference_majore: 16.8, loyer_reference_minore: 9.8 } },
  },
};

function services(href) {
  const url = new URL(href);
  const q = url.searchParams.get('q') || '';
  if (url.host === 'data.geopf.fr' && url.pathname === '/geocodage/reverse') {
    const lat = Number(url.searchParams.get('lat'));
    if (Number(url.searchParams.get('lon')) < 0) return place(-0.5701, 44.8414, '33063', '33000', 'Bordeaux', 'street');
    return lat > 48 ? place(2.3772, 48.8651, '75111', '75011', 'Paris', 'street')
      : lat > 45 ? place(4.85, 45.76, '69383', '69003', 'Lyon', 'street')
        : place(3.88, 43.61, '34172', '34000', 'Montpellier', 'street');
  }
  if (url.host === 'data.geopf.fr' && url.pathname === '/geocodage/search') {
    if (/lyon/i.test(q)) return place(4.85, 45.76, '69383', '69003', 'Lyon 3e Arrondissement', 'municipality');
    if (/montpellier/i.test(q)) return place(3.88, 43.61, '34172', '34000', 'Montpellier', 'municipality');
    if (/bordeaux/i.test(q)) return place(-0.57, 44.84, '33063', '33000', 'Bordeaux', 'municipality');
    if (/lib[ée]ration/i.test(q)) return place(-0.6436, 44.8386, '33281', '33700', 'Mérignac', 'housenumber');
    if (/m[ée]rignac/i.test(q)) return place(-0.64, 44.84, '33281', '33700', 'Mérignac', 'municipality');
    if (/oberkampf/i.test(q)) return place(2.3705, 48.8665, '75111', '75011', 'Paris', 'housenumber', '12 Rue Oberkampf 75011 Paris');
    return json({ features: [] });
  }
  if (url.host === 'data.geopf.fr' && url.pathname === '/wfs/ows') {
    if (/33063/.test(url.searchParams.get('CQL_FILTER'))) return json({ features: [{ properties: { code_iris: '330630102', nom_iris: 'Saint-Pierre' }, geometry: square(-0.57, 44.84) }] });
    return json({ features: [{ properties: { code_iris: '693830101', nom_iris: 'Part-Dieu' }, geometry: square(4.85, 45.76) }] });
  }
  if (url.host === 'opendata.paris.fr') {
    const where = url.searchParams.get('where') || '';
    const records = where.includes('POLYGON')
      ? [...parisRecords('Folie-Méricourt', 2026), ...parisRecords('Saint-Ambroise', 2026, 26)]
      : parisRecords('Folie-Méricourt', 2026);
    return json({ results: records });
  }
  if (url.host === 'www.data.gouv.fr') {
    return json({ data: [{ title: 'Encadrement des loyers de la Métropole de Lyon 2025-2026', resources: [{ url: 'https://data.grandlyon.com/geoserver/metropole-de-lyon/ows?typename=metropole-de-lyon:car_care.carencadrmtloyer_2025_2026' }] }] });
  }
  if (url.host === 'data.grandlyon.com') return json({ features: [{ properties: { codeiris: 693830101, zonage: 2, valeurs: lyonValeurs } }] });
  if (url.host === 'data.montpellier3m.fr' && url.pathname.endsWith('.json')) {
    return json({ features: [{ properties: { code_iris: '341720101', zone_oll: 2 }, geometry: square(3.88, 43.61) }] });
  }
  if (url.host === 'data.montpellier3m.fr' && url.pathname.endsWith('.xlsx')) {
    return { body: Buffer.from(makeXlsx([1, 2, 3, 4, 5].map(montpellierSheet))), type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  }
  return null;
}

const PAGES = [
  { url: 'https://www.leboncoin.fr/ad/locations/2981234567', file: 'leboncoin-paris.html', expect: { title: 'Loyer au-dessus du plafond', detail: 'Au moins 156\u00a0€ de trop par mois' } },
  { url: 'https://www.seloger.com/annonces/locations/appartement/lyon-3eme-69/part-dieu/212345678.htm', file: 'seloger-lyon.html', expect: { title: 'Risque de dépassement : 49\u00a0%', detail: 'Selon l’époque de construction' } },
  { url: 'https://www.pap.fr/annonces/appartement-montpellier-34000-r412345678', file: 'pap-montpellier.html', expect: { title: 'Loyer conforme à l’encadrement', detail: 'Plafond : 720\u00a0€ hors charges' } },
  { url: 'https://www.seloger.com/annonces/253456789.htm', file: 'seloger-bordeaux.html', expect: { title: 'Loyer au-dessus du plafond', detail: 'Au moins 13\u00a0€ de trop par mois' } },
  { url: 'https://www.bienici.com/annonce/location/montpellier/appartement/2pieces/ag340000-1', file: 'bienici-montpellier.html', expect: { title: 'Loyer conforme à l’encadrement', detail: 'Plafond : 720\u00a0€ hors charges' } },
  { url: 'https://www.pap.fr/annonces/appartement-bordeaux-33000-r412345679', file: 'pap-bordeaux.html', expect: { title: 'Loyer au-dessus du plafond', detail: '144\u00a0€ de trop par mois' } },
];

// --- Lancement ---

mkdirSync(OUT, { recursive: true });
const chrome = await launch({
  width: 1280,
  height: 860,
  // Shadow DOM ouvert dans la copie de test, pour lire la pastille.
  patch: (dir) => {
    const file = join(dir, 'content/ui.js');
    writeFileSync(file, readFileSync(file, 'utf8').replace("attachShadow({ mode: 'closed' })", "attachShadow({ mode: 'open' })"));
  },
});
let failures = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  ok   ${label}`); } catch (error) { failures++; console.log(`  ÉCHEC ${label}\n       ${error.message.split('\n').join('\n       ')}`); }
};

try {
  console.log(`${chrome.product} — extension ${chrome.extId}`);

  // Service worker : on intercepte ses requêtes vers les services de données.
  let sw;
  for (let i = 0; i < 50 && !sw; i++) {
    sw = (await chrome.cdp.send('Target.getTargets')).targetInfos.find((t) => t.type === 'service_worker' && t.url.includes(chrome.extId));
    if (!sw) await sleep(200);
  }
  const { sessionId: swSession } = await chrome.cdp.send('Target.attachToTarget', { targetId: sw.targetId, flatten: true });
  await chrome.cdp.send('Runtime.enable', {}, swSession);
  chrome.cdp.on((msg) => {
    if (msg.sessionId === swSession && msg.method === 'Runtime.consoleAPICalled') console.log('  [service worker]', msg.params.args.map((a) => a.value ?? a.description?.split('\n')[0]).join(' '));
  });
  const requested = [];
  await chrome.intercept(swSession, (url) => { requested.push(url); return services(url); });

  const pill = (s) => chrome.evaluate(s, `(() => {
    const root = document.querySelector('[data-check-mon-loyer]')?.shadowRoot;
    if (!root) return null;
    return { title: root.querySelector('.pill-title')?.textContent, detail: root.querySelector('.pill-detail')?.textContent };
  })()`);

  let n = 1;
  for (const page of PAGES) {
    console.log(`\n${page.url}`);
    const s = await chrome.openPage(page.url, { respond: (url) => (url === page.url ? { body: fixture(page.file), type: 'text/html; charset=utf-8' } : null) });
    let state = null;
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      state = await pill(s);
      if (state && !/Vérification/.test(state.title)) break;
    }
    check(`pastille « ${page.expect.title} »`, () => assert.deepEqual(state, page.expect));
    const prefix = String(n++).padStart(2, '0');
    await chrome.screenshot(s, join(OUT, `${prefix}-pastille.png`));
    await chrome.evaluate(s, `document.querySelector('[data-check-mon-loyer]').shadowRoot.querySelector('.pill').click()`);
    await sleep(400);
    await chrome.screenshot(s, join(OUT, `${prefix}-panneau.png`));

    if (page.file === 'leboncoin-paris.html') {
      // Adresse saisie dans le formulaire : inconnue (signalée), puis exacte (plafond du seul quartier concerné).
      const submitAddress = (address) => chrome.evaluate(s, `(() => {
        const root = document.querySelector('[data-loyer-juste], [data-check-mon-loyer]').shadowRoot;
        root.querySelector('details.edit').open = true;
        root.querySelector('input[name="address"]').value = ${JSON.stringify(address)};
        root.querySelector('form').requestSubmit();
      })()`);
      const notes = () => chrome.evaluate(s, `[...document.querySelector('[data-check-mon-loyer]').shadowRoot.querySelectorAll('.note')].map((n) => n.textContent).join(' | ')`);
      await submitAddress('3 rue qui n’existe pas');
      await sleep(1500);
      const unknownNotes = await notes();
      check('adresse inconnue signalée', () => assert.match(unknownNotes, /Adresse « 3 rue qui n’existe pas » introuvable : le calcul porte sur le quartier de l’annonce/));
      await submitAddress('12 rue Oberkampf');
      await sleep(1500);
      const exact = await pill(s);
      check('adresse exacte : un seul quartier, dépassement exact', () => assert.deepEqual(exact, { title: 'Loyer au-dessus du plafond', detail: '156\u00a0€ de trop par mois' }));
      const exactNotes = await notes();
      check('adresse retenue affichée', () => assert.match(exactNotes, /Adresse retenue : 12 Rue Oberkampf 75011 Paris\./));
      await chrome.screenshot(s, join(OUT, `${prefix}-panneau-adresse.png`));
    }

    if (page.file === 'seloger-lyon.html') {
      // Époque inconnue : la question « avant 1946 ? » est proposée ; « Non » tranche (seule l'époque 1946-1970 reste).
      const question = await chrome.evaluate(s, `document.querySelector('[data-check-mon-loyer]').shadowRoot.querySelector('.question-text')?.textContent`);
      check('question proposée : avant 1946 ?', () => assert.equal(question, 'Le bâtiment date-t-il d’avant 1946 ?'));
      await chrome.evaluate(s, `document.querySelector('[data-check-mon-loyer]').shadowRoot.querySelector('.tip-btn').click()`);
      await sleep(300);
      const tip = await chrome.evaluate(s, `(() => {
        const root = document.querySelector('[data-check-mon-loyer]').shadowRoot;
        const pop = root.querySelector('.tip-pop');
        return { shown: getComputedStyle(pop).display !== 'none', expanded: root.querySelector('.tip-btn').getAttribute('aria-expanded'), text: pop.textContent };
      })()`);
      check('infobulle « Comment savoir ? » : indices et sources', () => {
        assert.equal(tip.shown, true);
        assert.equal(tip.expanded, 'true');
        assert.match(tip.text, /Avant 1946 : pierre de taille/);
        assert.match(tip.text, /Le bail doit indiquer la période de construction/);
      });
      await chrome.screenshot(s, join(OUT, `${prefix}-question.png`));
      await chrome.evaluate(s, `[...document.querySelector('[data-check-mon-loyer]').shadowRoot.querySelectorAll('.answer')].find((b) => b.textContent === 'Non').click()`);
      await sleep(1500);
      const gauge = await chrome.evaluate(s, `document.querySelector('[data-check-mon-loyer]').shadowRoot.querySelector('.gauge')?.getAttribute('aria-label')`);
      check('réponse « Non » : jauge au plafond exact', () => assert.equal(gauge, 'Loyer hors charges : 560\u00a0€. Plafond légal : 547\u00a0€.'));
      const facts = await chrome.evaluate(s, `document.querySelector('[data-check-mon-loyer]').shadowRoot.querySelector('.facts')?.textContent`);
      check('réponse « Non » : calcul du plafond détaillé', () => assert.match(facts, /14,40\u00a0€\/m² × 38\u00a0m² = 547\u00a0€ hors charges/));
      const after = await pill(s);
      check('pastille après réponse : 13 € de trop', () => assert.deepEqual(after, { title: 'Loyer au-dessus du plafond', detail: '13\u00a0€ de trop par mois' }));
      await chrome.screenshot(s, join(OUT, `${prefix}-panneau-corrige.png`));
    }
  }

  // Fenêtre de l'extension, saisie manuelle : Mérignac n'applique pas l'encadrement.
  console.log('\nFenêtre de l’extension');
  const popup = await chrome.openPage(`chrome-extension://${chrome.extId}/popup/popup.html`, { w: 390, h: 760 });
  await sleep(800);
  await chrome.evaluate(popup, `(() => {
    const form = document.querySelector('form');
    form.address.value = '10 avenue de la Libération, Mérignac';
    form.surface.value = '50';
    form.amount.value = '900';
    form.requestSubmit();
  })()`);
  await sleep(1500);
  const popupTitle = await chrome.evaluate(popup, `document.querySelector('.verdict-title')?.textContent`);
  check('fenêtre : « Pas d’encadrement des loyers ici »', () => assert.equal(popupTitle, 'Pas d’encadrement des loyers ici'));
  await chrome.screenshot(popup, join(OUT, `${String(n).padStart(2, '0')}-fenetre.png`));

  check('aucun appel hors des services de données déclarés', () => {
    const hosts = new Set(requested.map((u) => new URL(u).host));
    assert.deepEqual([...hosts].filter((h) => !['data.geopf.fr', 'opendata.paris.fr', 'www.data.gouv.fr', 'data.grandlyon.com', 'data.montpellier3m.fr'].includes(h)), []);
  });
} finally {
  await chrome.close();
}

console.log(`\nCaptures dans ${OUT}`);
if (failures) {
  console.log(`${failures} vérification(s) en échec`);
  process.exit(1);
}
