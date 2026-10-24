# Check mon loyer : ce loyer respecte-t-il l'encadrement ?

Extension Chrome. Sur une annonce de location (Leboncoin, SeLoger, PAP, Bien'ici…), une pastille indique en quelques secondes si le loyer dépasse le plafond légal de l'encadrement des loyers, et de combien. Un clic ouvre le détail du calcul et un formulaire pour corriger ou compléter l'annonce.

- **Plafond calculé** avec les loyers de référence publiés en données ouvertes : loyer de référence majoré (€/m²) × surface habitable, comparé au loyer hors charges.
- **Verdict prudent** : quand l'annonce ne dit pas tout (époque de construction, meublé ou non, adresse exacte, montant des charges), toutes les possibilités sont calculées. Le verdict n'est tranché (« au-dessus » ou « conforme ») que s'il vaut pour toutes ; sinon la pastille dit de quoi il dépend.
- **Risque de dépassement** quand le verdict dépend d'une inconnue, le plus souvent l'année de construction : chaque époque de la grille compte pour la part des logements de la commune qui en datent (recensement de l'Insee). En dessous, les questions arrivent une à une et relancent le calcul : d'abord le montant des charges s'il manque, puis la question oui/non qui tranche le plus vite (« Le bâtiment date-t-il d'avant 1946 ? », « Le logement est-il loué meublé ? »), enfin l'adresse exacte. « Je ne sais pas » passe à la suivante. Son infobulle « Comment savoir ? » donne des indices pour y répondre (style de l'immeuble, bail, DPE, photos aériennes anciennes de l'IGN ; dépôt de garantie et durée du bail pour un meublé).
- **Suggestions d'adresses** dans la question et le formulaire, limitées à la ville du logement (Paris, Lyon et Marseille avec tous leurs arrondissements).
- **Complément de loyer** pris à part, et signalé quand il est interdit (logement classé F ou G).
- **Fenêtre de l'extension** (icône de la barre d'outils) : vérification d'un logement décrit à la main, sur n'importe quel site.

## Installation (mode développeur)

1. Ouvrez `chrome://extensions` et activez le **Mode développeur** (en haut à droite).
2. Cliquez sur **Charger l'extension non empaquetée** et choisissez le dossier `extension/` de ce dépôt (pas la racine du dépôt : Chrome répondrait « Manifest file is missing or unreadable »).
3. Ouvrez une annonce de location à Paris, Lyon, Villeurbanne, Montpellier ou Bordeaux.

Pour une archive à partager : `npm run zip` produit `check-mon-loyer.zip`.

## Territoires

L'encadrement du niveau des loyers s'applique dans neuf territoires. Pour quatre d'entre eux, l'extension calcule le plafond. Pour les autres, elle signale que le loyer est encadré et renvoie vers le simulateur officiel.

| Territoire | Plafond calculé | Source |
|---|---|---|
| Paris | Oui | Ville de Paris, jeu « Logement - Encadrement des loyers » (Opendatasoft), par quartier administratif |
| Lyon et Villeurbanne | Oui | Métropole de Lyon, couche WFS annuelle par IRIS (nom de couche lu sur data.gouv.fr) |
| Montpellier | Oui | Montpellier Méditerranée Métropole : zones de l'observatoire par IRIS + classeur de la grille |
| Lille, Hellemmes, Lomme | Non | Lien vers le simulateur de la Ville |
| Bordeaux | Oui | Grille de l'arrêté préfectoral (tableur de la préfecture de la Gironde, appartements et maisons) et zones de la carte officielle, intégrées à l'extension (voir ci-dessous) |
| Plaine Commune, Est Ensemble | Non | Lien vers le simulateur de la DRIHL |
| Pays basque (24 communes) | Non | Lien vers l'ADIL 64 |
| Grenoble-Alpes Métropole (21 communes, dont 8 en partie) | Non | Lien vers l'ADIL 38 |

Ailleurs, la pastille indique qu'il n'y a pas d'encadrement des loyers. Les communes sont repérées par leur code INSEE (`extension/lib/territories.js`, codes vérifiés dans le référentiel `@etalab/decoupage-administratif`).

**À surveiller** : l'expérimentation de la loi ELAN prend fin le 24 novembre 2026 sauf prolongation, examinée par le Parlement à l'automne 2026. Selon l'issue, il faudra mettre à jour la liste des territoires ou retirer l'extension.

## Sites d'annonces reconnus

Leboncoin, SeLoger, PAP, Bien'ici, Logic-Immo, Figaro Immobilier, Orpi, Century 21, Laforêt, Foncia, Nexity, Guy Hoquet, ParuVendu, Lodgis, LocService, Studapart.

La lecture prend, dans l'ordre : les données complètes de l'annonce (Leboncoin), les données structurées schema.org, puis le titre et le texte de la page (loyer charges comprises ou hors charges, charges, surface, pièces, meublé, code postal, année de construction, classe énergie, complément de loyer, loyer de référence majoré annoncé). Quand la page ne publie pas d'adresse, la position est lue sur l'image de carte du quartier (Mapbox, Google) ; le caractère meublé, dans la liste des caractéristiques ou dans les données de la page (`isFurnished`). Les pages de résultats de recherche et les annonces de vente, de parking ou de bureaux sont ignorées. Les colocations sont signalées comme non vérifiées.

Si une annonce n'est pas reconnue, la fenêtre de l'extension propose **Copier le diagnostic** : ce que l'extension lit sur la page (titre, données structurées, position, montants trouvés, début du texte), à transmettre pour adapter la lecture à ce site.

## Vos données restent sur votre appareil

- Pas de compte, pas de serveur Check mon loyer, aucune statistique.
- Le loyer, la surface et le reste de l'annonce ne quittent jamais le navigateur : le calcul est fait localement.
- Seule la **localisation du logement** part vers des services publics : la Géoplateforme de l'IGN (géocodage de l'adresse ou du quartier, îlots IRIS), puis le service du territoire concerné (Ville de Paris, Métropole de Lyon, Montpellier Méditerranée Métropole) et le catalogue data.gouv.fr. Pour Bordeaux, la grille et les zones sont dans l'extension : seuls le géocodage et les îlots IRIS passent par le réseau. Les suggestions d'adresses envoient le texte saisi (à partir de 3 caractères) et la ville du logement au géocodeur de la Géoplateforme. Les requêtes partent sans cookies et sans en-tête `Referer` : ces services ne voient pas l'annonce consultée.
- Les résultats sont gardés 15 minutes en mémoire, les grilles 24 heures.
- La seule donnée enregistrée est la liste des sites où vous avez masqué la pastille (`chrome.storage.local`).

## Comment ça marche

```
page d'annonce ──(content/extract.js)──▶ { loyer, charges, surface, pièces, meublé, localisation, époque, DPE }
      │
      ▼  message « check »
background.js ──▶ lib/check.js
      │            1. localisation : adresse → géocodage ; coordonnées de l'annonce → zone de 500 m ; ville → zone large
      │            2. territoire encadré d'après le code INSEE (lib/territories.js)
      │            3. lignes de grille du ou des secteurs possibles (lib/sources/*)
      │            4. verdict (lib/verdict.js) : plafond mini/maxi selon ce qui reste inconnu, comparé au loyer hors charges
      ▼
content/ui.js : pastille puis panneau, formulaire de correction qui relance le calcul
```

Chaque source renvoie des lignes au même format (`lib/grid.js`) : `{ zone, year, rooms, period: { from, to }, furnished, min, ref, max }`. Les époques (« Avant 1946 », « 1971-1990 », « apres_2005 »…) sont lues comme des intervalles d'années, et le triplet minoré / référence / majoré est remis dans l'ordre par ses valeurs (−30 %, +20 %) plutôt que par la position des colonnes.

| Source | Localisation | Grille |
|---|---|---|
| `paris` | `intersects(geo_shape, …)` sur le point ou la zone (Opendatasoft) | grille en vigueur au 1er juillet |
| `lyon` | IRIS du point (Géoplateforme), puis `codeiris` dans la couche WFS | `valeurs` : pièces → époque → meublé, niveaux reconnus par leur contenu |
| `montpellier` | contours des zones, ou IRIS → zone | classeur `.xlsx` lu sans dépendance (`lib/xlsx.js`) |

### Bordeaux : mise à jour annuelle

Bordeaux ne publie ni sa grille ni ses zones en données interrogeables : elles sont intégrées à l'extension (`extension/lib/data/`).

- **Grille** (chaque 15 juillet) : télécharger le tableur `Tableaux_loyers_reference_Bordeaux_Arrete_….xlsx` sur la page de la préfecture de la Gironde, puis `node tools/bordeaux-grille.mjs <fichier.xlsx>`. Le script vérifie les 256 lignes (4 zones × 4 tailles × 4 époques × vide/meublé × appartement/maison) et la cohérence de chaque triplet.
- **Zones** (seulement si la préfecture change le découpage) : remplacer `tools/bordeaux/carte-zones.webp` par la nouvelle carte, puis `python3 tools/bordeaux/zones.py` (numpy et Pillow). Le script classe les couleurs, cale la carte sur le contour de la commune (`tools/bordeaux/contour-bordeaux.geojson`, IGN Admin Express, Licence ouverte) et écrit une grille d'environ 28 m de côté.

À l'exécution, la zone d'une adresse est celle de son îlot IRIS (contours de la Géoplateforme), d'après la part de l'îlot couverte par chaque zone sur la carte ; si le service des îlots ne répond pas, la carte est lue directement autour du point avec une marge de 40 m.

### Ajouter un territoire

Écrire `extension/lib/sources/<id>.js` qui renvoie les lignes de grille pour une zone `{ lat, lon, radius, citycode }`, l'enregistrer dans `lib/check.js`, renseigner `source` dans `lib/territories.js`, et ajouter l'hôte du service dans `host_permissions` du manifeste.

## Tests

```bash
npm test
```

Tests unitaires : époques, triplets, verdict (époque inconnue, charges non précisées, complément de loyer), lecture d'annonces types (Leboncoin, SeLoger, PAP, Bien'ici, pages ignorées), les trois sources en ligne avec réponses simulées (dont un vrai classeur `.xlsx` généré), et Bordeaux (grille de l'arrêté, zones en des lieux connus, maison ou appartement, repli sur la carte sans îlots).

```bash
CHROME_PATH=/chemin/vers/chrome npm run e2e
```

Test de bout en bout : charge l'extension dans Chrome (profil temporaire, headless), sert des pages d'annonce enregistrées à leur vraie adresse (`tests/fixtures/`) et simule les services de données. Vérifie la pastille, le panneau, la correction par le formulaire et la fenêtre de l'extension, et enregistre des captures.

```bash
npm run check:live
```

Interroge en direct les services publics avec le code de l'extension (Paris, Lyon, Villeurbanne, Montpellier, Bordeaux, Mérignac). À lancer avant une publication et après chaque nouvelle grille annuelle.

`npm run icons` régénère les icônes.

## Limites connues

- **Pas encore vérifiée sur les vrais sites ni sur les vrais services.** L'extension a été écrite dans un environnement sans accès à ces sites : la lecture des annonces suit leur structure publique connue, et les adresses et formats des services de données viennent de leur documentation et de clients existants. À la première utilisation, lancer `npm run check:live`, puis ouvrir quelques annonces réelles ; si une valeur est mal lue, le formulaire du panneau permet de la corriger.
- Les grilles en données ouvertes sont indicatives : seul l'arrêté préfectoral fait foi.
- Le risque de dépassement est une estimation : il pondère les époques par la répartition de toutes les résidences principales de la commune (propriétaires compris), et compte à parts égales les autres inconnues. Pour Villeurbanne, la répartition vient d'un recensement antérieur relayé par un site tiers.
- Plaine Commune et Est Ensemble ne sont pas encore calculés (grilles distinctes pour les maisons et les appartements, comme Bordeaux).
- Bordeaux : les zones viennent de la carte officielle, calée sur le contour de la commune à quelques dizaines de mètres près. La zone d'une adresse est celle de son îlot IRIS ; un îlot que la carte partage entre deux zones reçoit les deux (fourchette de plafonds).
- Quand l'annonce ne donne qu'une position approximative, le plafond couvre les secteurs voisins : indiquer l'adresse dans le formulaire l'affine.
- Les baux de colocation, les chambres et les logements de fonction ne sont pas vérifiés.
