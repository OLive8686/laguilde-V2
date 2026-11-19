# Accès équipe organisatrice : le « rideau »

## Ce que c'est, et ce que ce n'est pas

Pendant la phase fermée, le public ne voit que la page `index.html` (message de fin d'édition) et un champ **« Code d'accès »**. L'équipe saisit le code et le site s'ouvre.

**C'est un rideau, pas une protection.** Il évite que le public tombe sur un site inachevé. Il ne protège rien de confidentiel :

- le site est statique : `acces.js` est lisible par tous, et un code d'un seul mot se retrouve en quelques secondes (le fichier contient son empreinte, pas le mot, mais cela n'y change rien) ;
- quelqu'un qui connaît l'adresse d'une page n'est arrêté que par le script ; désactiver JavaScript contourne le rideau ;
- l'**API Supabase reste joignable** sans passer par ce rideau : les données ne sont protégées que par les politiques RLS et les rôles (joueur, mj, admin) de la base ;
- les fichiers (images, scripts, styles) restent accessibles par leur adresse.

**Ne jamais y faire dépendre une donnée sensible.** La sécurité réelle est côté base (voir la section « Sécurité » de `CLAUDE.md`).

## Comment ça marche

1. Toutes les pages sauf `index.html` chargent `acces.js` en tête. Sans jeton valide, elles se cachent et renvoient vers `index.html`.
2. Sur `index.html`, un bon code enregistre un jeton dans le navigateur (`localStorage`, ou `sessionStorage` si le premier est bloqué) puis ouvre `accueil-2027.html`.
3. Le jeton est l'empreinte du code : **changer le code déconnecte tout le monde**.
4. Toutes les pages portent aussi `noindex` : les moteurs de recherche ne doivent pas les indexer pendant cette phase.

Le code **n'est pas écrit dans le dépôt** (seule son empreinte SHA-256 salée est dans `acces.js`). Le communiquer à l'équipe par un canal privé, jamais sur une page publique.

## Changer le code

1. Calculer la nouvelle empreinte (remplacer `NOUVEAUCODE`) :

   ```
   node -e "console.log(require('crypto').createHash('sha256').update('melusine-equipe:' + 'NOUVEAUCODE'.trim().toLowerCase()).digest('hex'))"
   ```

   Le code saisi n'est pas sensible à la casse ni aux espaces autour. Ne pas le laisser dans l'historique du terminal (effacer la ligne ensuite).
2. Remplacer la valeur de `EMPREINTE` en tête de `acces.js` (64 caractères).
3. Incrémenter `acces.js?v=N` dans toutes les pages (voir `CLAUDE.md`, section Déploiement), pour que les navigateurs prennent la nouvelle version.
4. Lancer `node --test "tests/*.test.js"` et publier.

## Retirer le rideau au lancement public

1. Dans les 8 pages (`accueil-2027`, `programme`, `infos`, `benevoles`, `espace-mj`, `mes-inscriptions`, `admin`, `aide`) : supprimer la ligne `<script src="acces.js…">` et la balise `<meta name="robots" content="noindex">` (elles sont suivies d'un commentaire « rideau »).
2. `index.html` : remplacer la page par l'accueil (voir `docs/DESIGN_V2.md`, « Pour passer en production »), ce qui retire aussi le formulaire et son script.
3. Supprimer `acces.js` et `tests/acces.test.js`.
4. Retirer le bandeau « maquette » de l'accueil si les textes sont validés.
5. Cocher l'item correspondant dans la checklist de `ROADMAP.md`.

## Avant d'ouvrir à de vrais utilisateurs

Le rideau ne remplace pas les correctifs de sécurité de la branche `security/lockdown-rpc` (secret du webhook, contrôle d'identité des fonctions d'annulation et de récapitulatif) ni la revue des politiques RLS. À faire **avant** d'inviter des joueurs, avec ou sans rideau.
