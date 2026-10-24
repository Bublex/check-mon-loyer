# Politique de confidentialité de Check mon loyer

Dernière mise à jour : 24 octobre 2026

Check mon loyer est une extension de navigateur gratuite. Sur une annonce de location, elle indique si le loyer respecte l'encadrement des loyers. Cette page explique quelles données elle utilise, où elles vont et ce qu'elle ne fait pas.

## En bref

- **Aucun compte, aucune statistique, aucune publicité.** L'extension n'a pas de serveur : l'éditeur ne reçoit et ne conserve aucune donnée sur vous ni sur les annonces que vous consultez.
- **Le calcul se fait dans votre navigateur.** L'annonce est lue sur votre appareil ; seule la **localisation du logement** part vers des services publics de données, pour trouver la grille des loyers qui s'y applique.
- **Rien n'est vendu ni partagé** à des fins commerciales.

## Ce que l'extension lit sur votre appareil

Sur les sites d'annonces où elle fonctionne (Leboncoin, SeLoger, PAP, Bien'ici, Logic-Immo, Figaro Immobilier, Orpi, Century 21, Laforêt, Foncia, Nexity, Guy Hoquet, ParuVendu, Lodgis, LocService, Studapart), l'extension lit la page de l'annonce ouverte : titre, loyer, charges, surface, nombre de pièces, meublé ou non, époque de construction, classe énergie, localisation (adresse, quartier, code postal ou position de la carte).

Ces informations restent dans votre navigateur. Elle ne lit aucun autre site et n'accède pas à votre historique de navigation.

Les informations que vous saisissez dans l'extension (adresse, surface, charges, réponses aux questions) sont traitées de la même façon.

## Ce qui part vers des services publics de données

Pour calculer le plafond, l'extension interroge des services publics. Elle leur envoie uniquement ce qui est nécessaire pour situer le logement :

| Service | Responsable | Ce qui est envoyé |
| --- | --- | --- |
| Géoplateforme (data.geopf.fr) | Institut national de l'information géographique et forestière (IGN) | L'adresse, le quartier ou la ville du logement, ou sa position sur la carte ; pendant la saisie d'une adresse, le texte tapé (à partir de 3 caractères) et la ville du logement, pour les suggestions ; le code de la commune, pour obtenir les contours des îlots statistiques (IRIS) |
| opendata.paris.fr | Ville de Paris | La position du logement, ou une zone autour du quartier quand l'adresse exacte n'est pas connue |
| data.grandlyon.com | Métropole de Lyon | Les codes des îlots statistiques (IRIS) où se trouve le logement |
| data.gouv.fr | Direction interministérielle du numérique (DINUM) | Une recherche du jeu de données de la Métropole de Lyon, sans information sur le logement |
| data.montpellier3m.fr | Montpellier Méditerranée Métropole | Rien sur le logement : l'extension télécharge la grille et les zones complètes |

Pour Bordeaux, la grille et la carte des zones sont incluses dans l'extension : seule la Géoplateforme est interrogée.

Ces requêtes partent **sans cookies** et **sans en-tête Referer** : les services ne savent pas quelle annonce vous consultez ni sur quel site. Comme pour toute connexion à un site web, ils voient l'adresse IP de votre connexion. Ils la traitent sous leur propre responsabilité, selon leur politique de confidentialité.

L'extension n'envoie jamais le texte de l'annonce, son adresse web, le loyer ni vos réponses à ces services ou à quiconque.

## Ce qui est conservé sur votre appareil

- **Vos préférences**, dans le stockage local de l'extension : la liste des sites où vous avez masqué la pastille. Elle reste sur votre appareil jusqu'à la désinstallation de l'extension ; le bouton « Réafficher sur tous les sites » la vide.
- **Un cache temporaire en mémoire** : les derniers résultats (15 minutes au plus) et les réponses des services de données (un jour au plus), pour éviter de les redemander. Il est effacé dès que le navigateur met l'extension en veille, et au plus tard à sa fermeture.

L'extension n'utilise pas de cookies et ne dépose aucun traceur.

## Le diagnostic

Quand une annonce n'est pas reconnue, le bouton « Copier le diagnostic » copie dans votre presse-papiers une description technique de la page : son adresse web, son titre, le début de son texte et les valeurs lues par l'extension. Rien n'est envoyé : c'est vous qui choisissez de le transmettre. Les numéros de téléphone et les adresses e-mail y sont masqués ; relisez-le avant de le partager, car il peut contenir d'autres éléments de l'annonce, comme le nom de l'annonceur.

## Permissions demandées

- **Stockage** : enregistrer la liste des sites où la pastille est masquée, sur votre appareil.
- **Accès aux sites d'annonces listés plus haut** : lire l'annonce ouverte et afficher le verdict sur la page.
- **Accès aux services de données listés plus haut** : obtenir la localisation et la grille des loyers.

## Vos droits

L'éditeur ne détient aucune donnée vous concernant : il n'a donc rien à vous communiquer, rectifier ou effacer. Pour effacer les données conservées sur votre appareil, désinstallez l'extension.

Pour les données traitées par les services publics cités plus haut (en particulier l'adresse IP de votre connexion), adressez-vous à leur responsable. Vous pouvez aussi introduire une réclamation auprès de la CNIL (cnil.fr).

## Utilisation limitée

L'utilisation des informations reçues par l'extension respecte la politique du Chrome Web Store relative aux données des utilisateurs, y compris les exigences d'utilisation limitée : elles servent uniquement à vérifier le loyer de l'annonce, ne sont ni vendues ni transférées à des tiers, et ne sont pas utilisées à des fins publicitaires.

## Modifications

Toute modification de cette politique est publiée sur cette page, avec sa date de mise à jour. Si une évolution de l'extension changeait les données envoyées (par exemple un nouveau service de données), la politique serait mise à jour avant la publication de la version concernée.

## Contact

Pour toute question : [ouvrir un ticket sur le dépôt de l'extension](https://github.com/Bublex/check-mon-loyer/issues).
