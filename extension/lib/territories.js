// Territoires où s'applique l'encadrement du niveau des loyers (loi ELAN, article 140), par code commune INSEE.
// `source` désigne le connecteur qui sait calculer le plafond à partir des données ouvertes du territoire.
// Sans connecteur, l'extension signale que le loyer est encadré et renvoie vers le simulateur officiel.
// Codes vérifiés dans le référentiel @etalab/decoupage-administratif (communes, communes associées et déléguées).

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => String(from + i));

const DRIHL = 'https://www.referenceloyer.drihl.ile-de-france.developpement-durable.gouv.fr';

export const TERRITORIES = [
  {
    id: 'paris',
    name: 'Paris',
    source: 'paris',
    // Commune et ses 20 arrondissements municipaux (codes renvoyés par la Base Adresse Nationale).
    communes: ['75056', ...range(75101, 75120)],
    officialUrl: `${DRIHL}/paris/`,
  },
  {
    id: 'lyon',
    name: 'Lyon et Villeurbanne',
    source: 'lyon',
    communes: ['69123', ...range(69381, 69389), '69266'],
    // Simulateur de la Métropole de Lyon (Lyon et Villeurbanne).
    officialUrl: 'https://demarches.toodego.com/logement/encadrement-des-loyers-v2/',
  },
  {
    id: 'montpellier',
    name: 'Montpellier',
    source: 'montpellier',
    communes: ['34172'],
    officialUrl: 'https://www.montpellier.fr/vie-quotidienne/vivre-ici/se-loger/lencadrement-des-loyers',
  },
  {
    id: 'lille',
    name: 'Lille, Hellemmes et Lomme',
    source: null,
    communes: ['59350', '59298', '59355'],
    officialUrl: 'https://encadrement-loyers.lille.fr/',
  },
  {
    id: 'bordeaux',
    name: 'Bordeaux',
    source: 'bordeaux',
    communes: ['33063'],
    officialUrl: 'https://www.gironde.gouv.fr/Actions-de-l-Etat/Amenagement-du-territoire-construction-logement/Habitat-logement/Encadrement-des-loyers-a-Bordeaux/Dispositif-d-encadrement-des-loyers',
  },
  {
    id: 'plaine-commune',
    name: 'Plaine Commune',
    source: null,
    // Saint-Denis a absorbé Pierrefitte-sur-Seine (commune déléguée 93059) au 1er janvier 2025.
    communes: ['93001', '93027', '93031', '93039', '93059', '93066', '93070', '93072', '93079'],
    officialUrl: `${DRIHL}/plaine-commune/`,
  },
  {
    id: 'est-ensemble',
    name: 'Est Ensemble',
    source: null,
    communes: ['93006', '93008', '93010', '93045', '93048', '93053', '93055', '93061', '93063'],
    officialUrl: `${DRIHL}/est-ensemble/`,
  },
  {
    id: 'pays-basque',
    name: 'Pays basque',
    source: null,
    communes: [
      '64009', '64024', '64035', '64038', '64065', '64100', '64102', '64122', '64125', '64130', '64140', '64189',
      '64249', '64260', '64282', '64304', '64317', '64407', '64483', '64496', '64540', '64545', '64547', '64558',
    ],
    officialUrl: 'https://www.anil.org/adil-64/',
  },
  {
    id: 'grenoble',
    name: 'Grenoble-Alpes Métropole',
    source: null,
    // 21 communes, dont 8 encadrées sur une partie seulement de leur territoire.
    partial: true,
    communes: [
      '38057', '38111', '38150', '38151', '38158', '38169', '38170', '38179', '38185', '38229', '38271',
      '38309', '38317', '38382', '38421', '38474', '38485', '38486', '38516', '38524', '38533',
    ],
    officialUrl: 'https://www.anil.org/adil-38/',
  },
];

const BY_COMMUNE = new Map(TERRITORIES.flatMap((t) => t.communes.map((code) => [code, t])));

/** Territoire encadré contenant cette commune (code INSEE), ou null. */
export function findTerritory(citycode) {
  return BY_COMMUNE.get(String(citycode || '')) || null;
}

export function getTerritory(id) {
  return TERRITORIES.find((t) => t.id === id) || null;
}

/** Les 9 arrondissements de Lyon et les 20 de Paris ont leur propre code ; la commune « mère » aussi. */
export function isWholeCityCode(citycode) {
  return citycode === '75056' || citycode === '69123';
}
