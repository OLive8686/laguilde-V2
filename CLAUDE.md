# Mélusine — Convention JDR "Sous l'Œil de Mélusine"

## Vue d'ensemble
Site d'inscription pour une convention de jeu de rôle à Poitiers (16-17 mai 2026), organisée par La Guilde Poitiers. Les joueurs consultent le programme et s'inscrivent aux tables. Les MJ proposent des tables. Les admins gèrent le tout.

## Architecture
- **Frontend** : 3 pages HTML + 1 JS partagé + 1 CSS, hébergés sur GitHub Pages
- **Backend** : `code.gs` — Google Apps Script déployé en webapp
- **Base de données** : Google Sheets avec 5 onglets : `programme`, `inscriptions`, `accompagnants`, `config`, `roles`
- **Authentification** : 3 méthodes — pseudo/email, SSO Google, SSO Discord
- **Rôles** : joueur (défaut), mj, admin — stockés dans l'onglet `roles`

## Fichiers

### Pages
- `index.html` : Page publique (accueil, programme, inscriptions, accompagnants, animations, restauration)
- `espace-mj.html` : Espace MJ (proposer des tables, voir ses propositions). Accès : rôle `mj` ou `admin`
- `admin.html` : Panneau admin (stats, inscriptions, validation tables MJ, gestion des rôles). Accès : rôle `admin`

### Code
- `app.js` : JavaScript partagé — config, helpers (escHtml, esc), API (callAPI, callAPIPost), auth, navigation, rôles. Importé par les 3 pages.
- `styles.css` : Feuille de styles unique, partagée par les 3 pages
- `code.gs` : Backend Apps Script. À copier manuellement dans script.google.com après modification.

### Documentation
- `CLAUDE.md` : Ce fichier

## Stack technique
- HTML/CSS/JS vanilla (pas de framework)
- Google Apps Script (backend serverless)
- Google Sheets (BDD)
- API Google Identity Services (SSO Google)
- API Discord OAuth2 (SSO Discord)
- MailApp (emails de confirmation)
- LockService (protection contre les race conditions)

## Gestion des rôles

### Onglet `roles`
| email | nom | role | date_inscription |

- **joueur** : rôle par défaut, créé automatiquement à la première connexion
- **mj** : peut proposer des tables via l'espace MJ
- **admin** : accès complet (panneau admin, validation tables, gestion rôles)

### Flux
1. L'utilisateur se connecte → `get_role` est appelé → crée l'entrée si nouvelle
2. Le rôle est stocké en `localStorage` (`melusine_role`) pour la navigation
3. La navigation s'adapte : liens "Espace MJ" et "Admin" affichés selon le rôle
4. Les pages MJ et admin vérifient le rôle côté client ET côté backend

### API rôles
- `get_role` (GET) : `{ email, nom }` → retourne le rôle (crée si nouveau)
- `set_role` (POST) : `{ password, email, role }` → change le rôle (admin only)
- `get_all_roles` (POST) : `{ password }` → liste tous les utilisateurs

## Architecture JS (app.js)
- Pattern : IIFE + exports `window.xxx` pour les onclick handlers
- `window.APP` : objet global exposant l'état (currentUser, currentRole, accompagnants, SCRIPT_URL, SHEET_ID)
- Callbacks de page : `window.onPageInit`, `window.onUserLogin`, `window.onUserLogout` — définis dans le `<script>` de chaque page, appelés par app.js
- Flux init : `DOMContentLoaded` → `initApp()` → checkAuth → fetchRole → updateNav → `onPageInit()`

## Flux d'inscription
1. L'utilisateur se connecte (pseudo/email, Google SSO, ou Discord SSO)
2. Après SSO, un formulaire de pseudo modifiable s'affiche
3. L'utilisateur consulte le programme et clique "S'inscrire" sur une table
4. **Si le joueur a des accompagnants** → un modal "Pour qui ?" apparaît
5. Le backend vérifie sous verrou (LockService) : pas de doublon, places disponibles
6. Si la table est pleine → liste d'attente automatique
7. Email de confirmation envoyé
8. En cas d'annulation, le premier en liste d'attente est promu automatiquement

## Accompagnants
Les joueurs peuvent ajouter jusqu'à 3 accompagnants liés à leur compte :
- Identifiés par **(email_parent + nom_accompagnant)**
- Peuvent être inscrits à des tables différentes du joueur principal
- Anti-doublon : 1 seule table par créneau par personne
- Suppression → annule automatiquement toutes les inscriptions

## Propositions de tables (MJ)
- Le MJ remplit un formulaire (jeu, système, créneau, places, description, content warning)
- Écrit dans `programme` avec `statut_table = "en_attente"`
- L'admin valide ou refuse depuis `admin.html`
- Tables validées (`statut_table = "validé"`) apparaissent dans le programme
- Contrôle d'accès backend : `hasRole(email, 'mj')` vérifié avant écriture

## API — GET vs POST
- **GET** (`callAPI`) : lectures (programme, inscriptions, accompagnants, config, propositions, rôles)
- **POST** (`callAPIPost`) : écritures et actions sensibles (inscription, annulation, admin, MJ, rôles)
- Le mot de passe admin ne passe **jamais** dans l'URL

## Sécurité
- **XSS** : `escHtml()` dans app.js, appliquée partout dans les innerHTML
- **Race conditions** : `withLock()` (LockService) protège inscription/annulation
- **Validation email** : regex côté backend (`isValidEmail()`)
- **Admin** : mot de passe en POST + rôle `admin` vérifié
- **MJ** : rôle `mj` ou `admin` vérifié côté backend
- **Secrets** : dans les Script Properties, jamais dans le code
- **htmlRedirect** : URL sanitisée

## Déploiement
- **Frontend** : `git push` → GitHub Pages (~5 min de cache)
- **Backend** : Copier code.gs dans Apps Script → Déployer → Nouvelle version
- **Important** : si l'URL change, mettre à jour `app.js` (SCRIPT_URL) ET Discord (Redirects)

## Conventions
- Langue du code : français pour les commentaires et messages utilisateur
- CSS dans `styles.css`, JS partagé dans `app.js`, JS page-spécifique inline dans chaque HTML
- Thème visuel : dark fantasy médiéval (couleurs : #0D2B2B, #D4A843, #4A8B5E)
- Polices : Cinzel Decorative (titres), Lora (corps)
