// Répartition des résidences principales par époque d'achèvement, par commune (recensement de l'Insee).
// Sert à estimer la probabilité de dépassement quand l'annonce ne dit pas quand l'immeuble a été construit :
// chaque époque de la grille compte pour la part des logements de la commune qui en datent.

// Classes de l'Insee (tableau « Résidences principales selon la période d'achèvement »), bornes incluses.
export const INSEE_CLASSES = [[1800, 1918], [1919, 1945], [1946, 1970], [1971, 1990], [1991, 2005], [2006, 2030]];

const SHARES = {
  '75056': { name: 'Paris', source: 'Insee, recensement 2022', shares: [31.3, 17.4, 19.8, 20.8, 7.2, 3.4] },
  '69123': { name: 'Lyon', source: 'Insee, recensement 2023', shares: [14.2, 8.9, 22.3, 22.5, 18.5, 13.5] },
  // Faute du tableau Insee récent, chiffres d'un recensement antérieur relayés par ville-data.com.
  '69266': { name: 'Villeurbanne', source: 'recensement antérieur, via ville-data.com', shares: [3, 7, 25, 27, 23, 13] },
  '34172': { name: 'Montpellier', source: 'Insee, recensement 2023', shares: [6.8, 3.6, 19.4, 30.3, 18.7, 21.3] },
  '33063': { name: 'Bordeaux', source: 'Insee, recensement 2023', shares: [22.8, 11.5, 16.8, 19.7, 13.8, 15.3] },
};

/** Répartition pour une commune (les arrondissements de Paris et de Lyon prennent celle de leur ville). */
export function periodSharesFor(citycode) {
  const n = Number(citycode);
  const code = n >= 75101 && n <= 75120 ? '75056' : n >= 69381 && n <= 69389 ? '69123' : String(citycode || '');
  return SHARES[code] || null;
}

const span = (a, b) => Math.max(0, b - a + 1);
const lo = (range) => range?.from ?? 1800;
const hi = (range) => range?.to ?? 2030;

/**
 * Poids d'une époque de la grille : part des logements de la commune construits pendant cette époque
 * et dans ce que l'on sait déjà de l'immeuble (réponse « avant 1946 », année publiée…).
 */
export function periodWeight(period, construction, info) {
  if (!info) return 1;
  let weight = 0;
  INSEE_CLASSES.forEach(([a, b], i) => {
    const from = Math.max(a, lo(period), lo(construction));
    const to = Math.min(b, hi(period), hi(construction));
    weight += (info.shares[i] * span(from, to)) / span(a, b);
  });
  return weight;
}
