# Design v2 (maquettes) : ce qui est fait, ce qui reste

Direction retenue : **A « Affiche » pour l'accueil, B « Éditorial » pour les pages d'usage.** Trois pages sont maquettées sur la branche `feature/design-v2`. Rien n'est en production.

## Ce qui est livré

| Fichier | Contenu |
|---|---|
| `v2.css` | Couche visuelle chargée **après** `styles.css`, sans couleur en dur (jetons de `theme.css`). Supprimable sans rien casser |
| `accueil-2027.html` | Nouvel accueil : héros (titre, date, lieu, deux boutons) + affiche, trois actions (jouer, animer, aider), présentation, La Guilde |
| `programme.html` | Filtre « Tous / Samedi / Dimanche » puis créneaux, titres de jour et de créneau, liseré de couleur et jauge par table, description repliée avec « Lire la suite ». Les actions d'inscription sont **inchangées** |
| `infos.html` | Icônes SVG au trait à la place des emoji, cartes alignées à gauche |
| `img/affiche-2027.webp` | Affiche allégée (voir `docs/AFFICHE.md`) |

Contrôles faits : contraste AA mesuré dans Chrome sur les trois pages en sombre et en clair, aucun débordement horizontal à 360 px, filtres du programme testés avec de vrais clics (29 tables = 22 samedi + 7 dimanche).

## Ce qui est PROVISOIRE (à valider ou fournir)

- **Tous les textes de l'accueil** sont des propositions, sauf la présentation de l'événement (reprise de la page Infos). Un bandeau « MAQUETTE — textes provisoires » est affiché.
- **Crédit de l'illustration** : « Louis Hyerlé » affiché ; reste à confirmer **par écrit** son autorisation d'usage sur le site (voir `docs/AFFICHE.md`).
- **Affiche sans lettrage** : à remplacer par la version finale.
- Les valeurs de la table `config` (lieu, dates, tarif) restent celles de 2026 tant que la migration `010` n'est pas appliquée : la page Infos le montre.

## Pour passer en production

1. Valider les maquettes (captures et essai local).
2. Au moment de la réouverture : renommer `accueil-2027.html` en `index.html` (l'ancien accueil est archivé dans `index.2026.html`), retirer le bandeau `.maquette-tag` et la balise `noindex`, et pointer le lien « Accueil » du menu sur `index.html`.
3. Fusionner `v2.css` dans `styles.css` (ou le garder à part) et l'ajouter aux pages qui n'en profitent pas encore.
4. Décliner sur les pages restantes : `benevoles.html`, `espace-mj.html`, `mes-inscriptions.html`, `admin.html`, `aide.html`.
5. Refaire l'audit de contraste, le test des filtres du programme et la recette manuelle d'inscription, d'annulation et de liste d'attente (`TESTS.md`, sections 3 à 6).
6. Incrémenter les `?v=N` (voir `CLAUDE.md`, section Déploiement).

## Points ouverts

- Les titres de page (« Programme », « Bienvenue ») restent centrés alors que le contenu est aligné à gauche : à trancher en regardant les pages.
- Programme : trois pistes non faites, à décider : frise horaire visuelle, recherche par nom de jeu ou de MJ, barre d'inscription fixe en bas sur mobile.
