# Mélusine — Convention JDR "Sous l'Œil de Mélusine"

## Vue d'ensemble
Site d'inscription pour une convention de jeu de rôle à Poitiers (16-17 mai 2026), organisée par La Guilde Poitiers. Les joueurs peuvent consulter le programme et s'inscrire aux tables de JDR.

## Architecture
- **Frontend** : `index.html` — site statique hébergé sur GitHub Pages (https://olive8686.github.io/laguilde-V2/)
- **Backend** : `code.gs` — Google Apps Script déployé en webapp, gère les inscriptions et l'envoi d'emails
- **Base de données** : Google Sheets avec 3 onglets principaux : `programme` (tables de jeu), `inscriptions` (joueurs inscrits) et `accompagnants` (accompagnants liés aux joueurs)
- **Authentification** : 3 méthodes — pseudo/email, SSO Google, SSO Discord

## Fichiers
- `index.html` : Site complet (HTML + CSS + JS inline). Contient la config en haut (SHEET_ID, SCRIPT_URL, GOOGLE_CLIENT_ID, DISCORD_CLIENT_ID)
- `code.gs` : Backend Apps Script. À copier manuellement dans l'éditeur script.google.com après modification. Les secrets (DISCORD_SECRET, ADMIN_PASSWORD) sont dans les Propriétés de script, PAS dans le code.
- `CLAUDE.md` : Ce fichier

## Stack technique
- HTML/CSS/JS vanilla (pas de framework)
- Google Apps Script (backend serverless)
- Google Sheets (BDD)
- API Google Identity Services (SSO Google)
- API Discord OAuth2 (SSO Discord)
- MailApp (emails de confirmation)

## Flux d'inscription
1. L'utilisateur se connecte (pseudo/email, Google SSO, ou Discord SSO)
2. Après SSO, un formulaire de pseudo modifiable s'affiche
3. L'utilisateur consulte le programme et clique "S'inscrire" sur une table
4. **Si le joueur a des accompagnants** → un modal "Pour qui ?" apparaît (moi ou un accompagnant)
5. Le backend vérifie : pas de doublon sur le même créneau, places disponibles
6. Si la table est pleine → liste d'attente automatique
7. Un email de confirmation est envoyé (toujours au joueur principal, même pour un accompagnant)
8. En cas d'annulation, le premier en liste d'attente est promu automatiquement

## Accompagnants
Les joueurs peuvent ajouter jusqu'à 3 accompagnants (enfants, conjoints) liés à leur compte :
- Identifiés par le couple **(email_parent + nom_accompagnant)**
- Peuvent être inscrits à des tables **différentes** du joueur principal
- Même règle anti-doublon : 1 seule table par créneau par personne
- Pas d'email propre → le parent reçoit toutes les notifications
- Suppression d'un accompagnant → annule automatiquement toutes ses inscriptions

### Onglet Google Sheets `accompagnants`
| email_parent | nom_accompagnant | date_ajout |

### Colonnes ajoutées à `inscriptions`
| ... 8 colonnes existantes ... | type_inscrit | nom_accompagnant |
- `type_inscrit` : "principal" ou "accompagnant" (vide = principal pour rétrocompat)
- `nom_accompagnant` : vide si principal, nom de l'accompagnant sinon

### API accompagnants (code.gs)
- `get_accompagnants` : `{ email }` → liste des accompagnants
- `add_accompagnant` : `{ email, nom_accompagnant }` → ajoute (max 3)
- `remove_accompagnant` : `{ email, nom_accompagnant }` → supprime + annule inscriptions

## Flux Discord SSO
Le SSO Discord ne passe PAS par Apps Script pour la redirection (Google encapsule dans un iframe, bloqué par Discord). Le flux est :
1. Le site redirige directement vers Discord OAuth (`loginDiscord()`)
2. Discord redirige vers le site avec un `code` dans l'URL
3. Le site envoie le code à Apps Script via l'action `discord_exchange`
4. Apps Script échange le code contre un token, récupère les infos utilisateur et les renvoie au site

## Déploiement
- **Frontend** : `git push` sur GitHub → GitHub Pages se met à jour (~5 min de cache)
- **Backend** : Copier code.gs dans Apps Script → Déployer → Gérer les déploiements → ✏️ → Nouvelle version → Déployer
- **Important** : Si l'URL de déploiement change, la mettre à jour dans `index.html` (SCRIPT_URL) ET dans Discord Developer (Redirects)

## Conventions
- Langue du code : français pour les commentaires et messages utilisateur
- CSS inline dans index.html (pas de fichier séparé)
- Thème visuel : dark fantasy médiéval (couleurs : #0D2B2B, #D4A843, #4A8B5E)
- Polices : Cinzel Decorative (titres), Lora (corps)

## Points d'attention
- Chaque redéploiement Apps Script peut changer l'URL → vérifier SCRIPT_URL
- Hard refresh (Ctrl+Maj+R) nécessaire après mise à jour GitHub Pages
- Les emails nécessitent l'autorisation `script.send_mail` dans appsscript.json
- Anti-doublon : un joueur (ou accompagnant) ne peut s'inscrire qu'à une seule table par créneau horaire
- Accompagnants : max 3 par joueur, stockés en localStorage (`melusine_accompagnants`) ET côté serveur (onglet `accompagnants`)
