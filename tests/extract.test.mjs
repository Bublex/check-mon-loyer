// Lecture d'annonces (sans DOM : parseListing reçoit les textes et données déjà rassemblés).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../extension/content/extract.js';

const { parseListing, parseAmount } = globalThis.LoyerExtract;

const page = (over) => ({ url: '', host: '', title: '', h1: '', ogTitle: '', description: '', jsonld: [], nextData: null, body: '', ...over });

test('Montants', () => {
  assert.equal(parseAmount('1 250'), 1250);
  assert.equal(parseAmount('1.250'), 1250);
  assert.equal(parseAmount('1 250,50 €'), 1250.5);
  assert.equal(parseAmount('1250.00'), 1250);
  assert.equal(parseAmount('12,5'), 12.5);
  assert.equal(parseAmount('abc'), null);
});

test('Leboncoin : données de l’annonce (Next.js) et description', () => {
  const listing = parseListing(page({
    url: 'https://www.leboncoin.fr/ad/locations/2981234567',
    host: 'leboncoin.fr',
    title: 'Appartement 2 pièces 42 m² - Locations - Leboncoin',
    nextData: { props: { pageProps: { ad: {
      subject: 'Bel appartement 2 pièces Oberkampf',
      body: 'Immeuble ancien construit en 1905. Loyer de 1 350 € dont 90 € de charges. DPE : E. Complément de loyer : 100 €.',
      category_name: 'Locations',
      price: [1350],
      attributes: [
        { key: 'real_estate_type', value: '2', value_label: 'Appartement' },
        { key: 'square', value: '42', value_label: '42 m²' },
        { key: 'rooms', value: '2', value_label: '2' },
        { key: 'furnished', value: '2', value_label: 'Non meublé' },
        { key: 'charges_included', value: '1', value_label: 'Oui' },
      ],
      location: { city: 'Paris', zipcode: '75011', lat: 48.8651, lng: 2.3772, source: 'city' },
    } } } },
  }));
  assert.equal(listing.site, 'leboncoin');
  assert.equal(listing.surface, 42);
  assert.equal(listing.rooms, 2);
  assert.equal(listing.furnished, false);
  assert.deepEqual(listing.rent, { amount: 1350, chargesIncluded: true, charges: 90, complement: 100, base: null });
  assert.deepEqual(listing.construction, { from: 1905, to: 1905, label: '1905' });
  assert.equal(listing.dpe, 'E');
  assert.deepEqual(listing.location, { postcode: '75011', city: 'Paris', lat: 48.8651, lon: 2.3772, approximate: true });
});

test('SeLoger : titre et texte de la page', () => {
  const listing = parseListing(page({
    url: 'https://www.seloger.com/annonces/locations/appartement/lyon-3eme-69/part-dieu/212345678.htm',
    host: 'seloger.com',
    h1: 'Appartement meublé 2 pièces 38 m²',
    title: 'Location Appartement 2 pièces 38 m² Lyon 3ème (69003) - 890 € CC | SeLoger',
    body: 'Loyer charges comprises 890 € / mois\nProvisions sur charges : 60 €\nDépôt de garantie : 1 660 €\nAnnée de construction : 1965\nLoyer de référence majoré : 17,40 €/m²',
  }));
  assert.equal(listing.surface, 38);
  assert.equal(listing.rooms, 2);
  assert.equal(listing.furnished, true);
  assert.deepEqual(listing.rent, { amount: 890, chargesIncluded: true, charges: 60, complement: null, base: null });
  assert.equal(listing.location.postcode, '69003');
  assert.equal(listing.location.city, 'Lyon');
  assert.equal(listing.construction.from, 1965);
  assert.equal(listing.announcedCeiling, 17.4);
});

test('PAP : séparateur de milliers en point, ville et code postal', () => {
  const listing = parseListing(page({
    url: 'https://www.pap.fr/annonces/appartement-villeurbanne-69100-r412345678',
    host: 'pap.fr',
    h1: 'Location appartement 3 pièces 65 m² Villeurbanne (69100)',
    body: 'Loyer : 1.120 € charges comprises (dont 120 € de charges). Logement non meublé. Classe énergie : C',
  }));
  assert.equal(listing.surface, 65);
  assert.equal(listing.rooms, 3);
  assert.equal(listing.furnished, false);
  assert.deepEqual(listing.rent, { amount: 1120, chargesIncluded: true, charges: 120, complement: null, base: null });
  assert.equal(listing.location.city, 'Villeurbanne');
  assert.equal(listing.location.postcode, '69100');
  assert.equal(listing.dpe, 'C');
});

test('Bien’ici : données structurées schema.org', () => {
  const listing = parseListing(page({
    url: 'https://www.bienici.com/annonce/location/montpellier/appartement/2pieces/ag340000-123',
    host: 'bienici.com',
    h1: 'Location appartement 2 pièces 44 m²',
    jsonld: [{ '@context': 'https://schema.org', '@type': 'Apartment', name: 'Appartement 2 pièces', floorSize: { '@type': 'QuantitativeValue', value: 44, unitCode: 'MTK' }, numberOfRooms: 2,
      address: { '@type': 'PostalAddress', postalCode: '34000', addressLocality: 'Montpellier' }, offers: { '@type': 'Offer', price: 780, priceCurrency: 'EUR' } }],
    body: '780 € par mois charges comprises',
  }));
  assert.equal(listing.surface, 44);
  assert.equal(listing.rent.amount, 780);
  assert.equal(listing.location.city, 'Montpellier');
  assert.equal(listing.location.postcode, '34000');
});

test('Pages ignorées : résultats de recherche, vente, parking', () => {
  assert.equal(parseListing(page({ url: 'https://www.seloger.com/list.htm?types=1', host: 'seloger.com', h1: 'Location appartement Paris', body: '1 200 € 2 pièces 40 m² …' })), null);
  assert.equal(parseListing(page({ url: 'https://www.example-immo.fr/bien/1', host: 'example-immo.fr', h1: 'Vente appartement 3 pièces 70 m² Paris 15e', body: 'Prix : 650 000 €' })), null);
  assert.equal(parseListing(page({ url: 'https://www.example-immo.fr/bien/2', host: 'example-immo.fr', h1: 'Location parking Paris 11e - 120 € / mois' })), null);
});
