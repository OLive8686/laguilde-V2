# Affiche : comment la mettre à jour sur le site

L'illustration de l'affiche est affichée sur l'accueil (`accueil-2027.html`, zone « héros »). Le site utilise une version **allégée** (`img/affiche-2027.webp`, environ 53 Ko) fabriquée à partir de l'image d'origine. Quand l'affiche contiendra le lettrage final, il suffit de refaire cette version.

## Mettre à jour (5 minutes)

1. Déposer la nouvelle image (JPEG ou PNG, de préférence portrait, au moins 1 000 px de large) dans le dossier `docs/`, par exemple `docs/AfficheSOM27_finale.jpeg`.
2. Dans un terminal, depuis la racine du dépôt :

   ```
   node tools/optimiser-affiche.js docs/AfficheSOM27_finale.jpeg img/affiche-2027.webp 960 80
   ```

   - Rien à installer : le script utilise Chrome (ou Edge), déjà présent, et Node 22 ou plus.
   - Les deux derniers nombres sont la largeur (960 px) et la qualité (80). Le script **prévient si le fichier dépasse 150 Ko** : baisser alors la qualité (par exemple 70) ou la largeur.
3. Vérifier le résultat à l'œil : la version web ne doit pas être floue ni avoir de bandes de couleur dans les dégradés.
4. Mettre à jour le texte alternatif (`alt`) de l'image si le visuel change (ce que voit un lecteur d'écran), et le crédit de l'illustration (voir plus bas).
5. Incrémenter le paramètre de version de l'image pour contourner le cache des navigateurs : `img/affiche-2027.webp?v=2` dans `accueil-2027.html`.

Un autre outil convient aussi (par exemple le site squoosh.app) : viser du WebP, 960 px de large, moins de 150 Ko.

## Quand l'affiche porte son propre lettrage

Le titre, la date et le lieu de l'accueil sont écrits en **texte** à côté de l'image, pour rester lisibles, traduisibles et indexables. Si l'affiche contient désormais le même lettrage, il y aura un doublon : décider alors, en regardant la page, de garder le texte (recommandé) ou de simplifier la zone texte. Ne pas supprimer le texte sans le remplacer : les lecteurs d'écran ne lisent pas le texte inclus dans une image.

## Crédit et droits

- La signature de l'artiste est visible sur l'illustration (en bas à droite) : **ne pas recadrer l'image de façon à la couper**.
- Le crédit « Illustration : à créditer » est un **marqueur provisoire** (`accueil-2027.html`, élément `figcaption`). Le remplacer par le nom de l'artiste, avec un lien vers son portfolio si vous en avez l'accord.
- Confirmer par écrit avec l'artiste l'autorisation d'usage sur le site (et, si besoin, sur les autres supports).

## Fichiers

| Fichier | Rôle |
|---|---|
| `docs/AfficheSOM27_base.jpeg` | Illustration d'origine, sans lettrage (non versionnée dans Git) |
| `img/affiche-2027.webp` | Version web allégée, utilisée par le site |
| `tools/optimiser-affiche.js` | Script qui fabrique la version web |
