# Mélusine — Convention JDR "Sous l'Œil de Mélusine"

## Vue d'ensemble
Site d'inscription pour une convention de jeu de rôle à Poitiers (16-17 mai 2026), organisée par La Guilde Poitiers. Les joueurs consultent le programme et s'inscrivent aux tables. Les MJ proposent des tables. Les admins gèrent le tout.

## Architecture
- **Frontend** : pages HTML statiques + 1 JS partagé + 1 CSS, hébergées sur GitHub Pages (domaine `sousloeildemelusine.fr`)
- **Backend** : Supabase (PostgreSQL + Auth + REST API + RPC)
- **Emails transactionnels** : Cloudflare Worker (`worker-email.js`) déclenché par triggers PostgreSQL via `pg_net`, envoi via MailerSend
- **Authentification** : Supabase Auth — 3 méthodes : email/password, SSO Google, SSO Discord
- **Rôles** : joueur (défaut), mj, admin — stockés dans la table `profiles`

## Fichiers

### Pages HTML
- `index.html` : Accueil
- `programme.html` : Programme des tables et inscription
- `mes-inscriptions.html` : Récap personnel (présence, tables, accompagnants, bénévolat, repas, propositions MJ)
- `infos.html` : Infos pratiques
- `benevoles.html` : Inscription aux créneaux bénévoles
- `aide.html` : FAQ / aide
- `espace-mj.html` : Proposer des tables (rôle `mj` ou `admin`)
- `admin.html` : Panneau admin (stats, validation tables, gestion rôles)

### Code
- `app.supabase.js` : JS partagé — config Supabase, client REST léger (sbQuery/sbInsert/sbUpdate/sbDelete), proxy `APP.supabase.from(...)/rpc(...)`, helpers (escHtml, esc, toast), auth, navigation, rôles, présences. Importé par toutes les pages avec un query string `?v=N` pour le cache busting (à bumper à chaque changement).
- `styles.css` : Feuille de styles unique, partagée par toutes les pages
- `worker-email.js` : Code du Cloudflare Worker (à copier dans le dashboard Cloudflare après modification)

### SQL (Supabase)
- `seed_data.sql` : Données initiales (créneaux bénévoles, programme, restauration, animations)
- `email-triggers.sql` : Triggers PostgreSQL qui déclenchent les emails transactionnels via `pg_net` → Worker
- `presences.sql` : Table `presences` + triggers d'auto-création + RPC `annuler_presence` + RLS
- `presences_admin_stats.sql` : RPC `get_presences_stats` (réservée admin)
- `inscription_promotion.sql` : Trigger `trg_promote_first_waiting` qui promeut auto le 1er en attente quand une place se libère
- `email_rappels.sql` : RPC `send_reminders(p_test_email)` qui envoie le rappel J-3 à toutes les personnes présentes (mode test = un seul destinataire)
- `admin_export.sql` : RPC `get_admin_export_data` qui retourne toutes les données pour l'export CSV admin
- `programme_sync.sql` : Trigger `trg_sync_inscriptions_on_programme_rename` qui propage automatiquement un renommage de table (`programme.jeu` ou `creneau`) aux inscriptions liées

### Documentation
- `CLAUDE.md` : Ce fichier
- `README.md` : Description projet
- `MIGRATION_URL.md` : Notes sur la migration vers le domaine custom
- `TESTS.md` : Notes de tests

## Stack technique
- HTML/CSS/JS vanilla (pas de framework)
- **Pas de SDK Supabase JS** : le proxy dans `app.supabase.js` utilise `fetch()` direct vers l'API REST de Supabase (le SDK avait un bug de lock auth). Mêmes méthodes que le SDK pour rester simple.
- PostgreSQL via Supabase (base de données + Auth + RLS + RPC)
- Cloudflare Worker pour le relais MailerSend
- API Google Identity Services (SSO Google) + API Discord OAuth2 (SSO Discord) — gérées par Supabase Auth

## Tables Supabase
| Table | Rôle |
|---|---|
| `profiles` | Utilisateurs (email, nom, role) — créé auto à la première connexion |
| `programme` | Tables JDR proposées (`statut_table` : en_attente / validé / refusé) |
| `inscriptions` | Inscriptions joueurs aux tables |
| `accompagnants` | Famille/amis liés à un compte (max 3 par compte) |
| `creneaux_benevoles` | Créneaux disponibles pour bénévoles |
| `benevoles` | Inscriptions bénévoles |
| `restauration` | Menu buvette |
| `repas` | Inscriptions au repas du soir |
| `animations` | Activités annexes (hors tables) |
| `config` | Config clé/valeur du site |
| `presences` | **Présence à la convention par jour** (samedi/dimanche), indépendante des inscriptions |

## Gestion des rôles

### Table `profiles`
| email | nom | role | … |

- **joueur** : rôle par défaut, créé automatiquement à la première connexion
- **mj** : peut proposer des tables via l'espace MJ
- **admin** : accès complet (panneau admin, validation tables, gestion rôles)

### Flux
1. L'utilisateur se connecte → `fetchRole` lit `profiles` → crée l'entrée si nouvelle
2. Le rôle est stocké en `localStorage` (`melusine_role`) pour la navigation
3. La navigation s'adapte : liens "Espace MJ" et "Admin" affichés selon le rôle
4. Les pages MJ et admin vérifient le rôle côté client ET côté backend (RLS Supabase)

## Architecture JS (app.supabase.js)
- Pattern : IIFE + exports `window.xxx` pour les onclick handlers
- `window.APP` : objet global exposant l'état (`currentUser`, `currentRole`, `accompagnants`) + `APP.supabase` (proxy REST) + helpers présence (`setPresence`, `annulerPresence`)
- Callbacks de page : `window.onPageInit`, `window.onUserLogin`, `window.onUserLogout` — définis dans le `<script>` de chaque page, appelés par `app.supabase.js`
- Flux init : `DOMContentLoaded` → `initApp()` → `checkAuth` → `fetchRole` → `updateNav` → `onPageInit()`
- Cache : `_allDataCache` mémoire pour éviter les double-fetch (loadTheme + onPageInit). À invalider après chaque écriture via `invalidateCache()` ou `window.invalidateCache`.

## Flux d'inscription (table)
1. L'utilisateur se connecte (email/password, Google SSO, ou Discord SSO)
2. Après SSO, un formulaire de pseudo modifiable s'affiche
3. **Si nouveau** : modal "Quels jours viens-tu ?" pour la présence (samedi/dimanche) — voir section Présences
4. L'utilisateur consulte le programme et clique "S'inscrire" sur une table
5. **Si le joueur a des accompagnants** → un modal "Pour qui ?" apparaît
6. Insertion directe dans `inscriptions` via Supabase (RLS vérifie l'auth)
7. Trigger PostgreSQL → email de confirmation via le Worker
8. Trigger PostgreSQL → auto-création de la présence pour le jour du créneau (`presences`)
9. Si table pleine → liste d'attente automatique
10. En cas d'annulation (statut `inscrit` → `annulé`/`supprimé`), le **trigger SQL `trg_promote_first_waiting`** promeut automatiquement le plus ancien en attente (tri par `id ASC`). L'admin peut aussi promouvoir manuellement quelqu'un hors ordre via le panneau `admin.html`.

## Présences à la convention
Une couche **explicite** au-dessus des inscriptions tables : un utilisateur peut être "inscrit à la convention" un jour donné (samedi 16 mai et/ou dimanche 17 mai) **indépendamment** de ses inscriptions à des tables.

### Logique
- **Auto-création** : s'inscrire à une table, un repas ou un bénévolat un jour donné crée automatiquement la présence pour ce jour (triggers SQL `trg_presence_from_inscription` / `_benevolat` / `_repas`).
- **Saisie explicite** : l'utilisateur peut toggle samedi/dimanche depuis `mes-inscriptions.html` → encart "Ma présence". S'applique aussi aux accompagnants.
- **Modal post-login** : à la 1ère connexion sans présence, on affiche un modal "Quels jours viens-tu ?". Géré via `sessionStorage` (flag `melusine_presence_modal_dismissed`) pour ne pas spammer.
- **Annulation cascade** : décocher une présence → confirm dialog → RPC `annuler_presence` qui annule en cascade tables/repas/bénévolat du jour, puis supprime la présence.
- **Stat admin** : panneau admin affiche `total_samedi` / `total_dimanche` / `total_both` / `total_unique` via la RPC `get_presences_stats` (SECURITY DEFINER, admin only).

### Table `presences`
| email | nom | jour | type_inscrit | nom_accompagnant | date_inscription |

Index unique : `(email, jour, COALESCE(nom_accompagnant, ''))` — 1 présence max par personne par jour.

### Helpers JS
- `APP.setPresence(jour, opts)` : INSERT idempotent
- `APP.annulerPresence(jour, opts)` : RPC cascade

## Accompagnants
Les joueurs peuvent ajouter jusqu'à 3 accompagnants liés à leur compte :
- Identifiés par **(email_parent + nom_accompagnant)**
- Peuvent être inscrits à des tables différentes du joueur principal
- Peuvent avoir leurs propres présences (samedi/dimanche indépendamment du parent)
- Anti-doublon : 1 seule table par créneau par personne
- Suppression → annule automatiquement toutes leurs inscriptions

## Propositions de tables (MJ)
- Le MJ remplit un formulaire (jeu, système, créneau, places, description, content warning)
- Écrit dans `programme` avec `statut_table = "en_attente"`
- L'admin valide ou refuse depuis `admin.html`
- Tables validées (`statut_table = "validé"`) apparaissent dans le programme
- Email automatique au MJ via trigger `trg_email_table_statut`

## API — comment lire/écrire
- **Lecture** : `APP.supabase.from('table').select(...)` (proxy REST)
- **Écriture** : `APP.supabase.from('table').insert/update/delete(...)`
- **RPC** (stored procedures) : `APP.supabase.rpc('nom_fonction', { params })`
- **Tout passe par RLS Supabase** côté DB (filtre par email JWT)
- Les fonctions sensibles (annuler_presence, send_recap_email, get_presences_stats) sont en SECURITY DEFINER pour bypass RLS de manière contrôlée

## Sécurité
- **RLS Supabase** activé sur toutes les tables sensibles (filtre par email JWT côté DB)
- **XSS** : `escHtml()` dans `app.supabase.js`, appliquée partout dans les innerHTML
- **Race conditions** : protection via contraintes uniques DB (ex: index unique sur `presences`)
- **Admin** : rôle `admin` lu depuis `profiles` côté backend dans les RPC (`get_presences_stats`, etc.)
- **MJ** : rôle `mj` ou `admin` vérifié côté backend
- **Secrets** : variables d'env Cloudflare (`MAILERSEND_API_KEY`, `WEBHOOK_SECRET`), JAMAIS dans le code
- **htmlRedirect** : URL sanitisée

## Emails transactionnels
- Triggers PostgreSQL → `pg_net.http_post` → Cloudflare Worker (`worker-email.js`) → MailerSend
- Types : confirmation, promotion, annulation, accompagnant_supprime, table_validee, table_refusee, recap (RPC à la demande), rappel (J-3, déclenché manuellement par l'admin via le bouton dans admin.html)
- Asynchrone (fire-and-forget) — n'impacte jamais la transaction principale
- **À surveiller** : si MailerSend retourne 401 → vérifier `MAILERSEND_API_KEY` dans Cloudflare. Si erreur 422 → vérifier DNS du domaine.

## Déploiement
- **Frontend** : `git push` → GitHub Pages (~3-5 min de cache CDN)
- **Cache busting** : bumper le `?v=N` du `<script src="app.supabase.js?v=N">` dans tous les HTML à chaque changement de `app.supabase.js`. Aussi dans la liste `prefetchAllPages` interne du JS.
- **SQL Supabase** : copier le contenu des fichiers `*.sql` dans Supabase SQL Editor → Run
- **Worker Cloudflare** : copier `worker-email.js` dans le Worker `melusine-email` → Deploy
- **Important** : si l'URL du Worker change, mettre à jour `email-triggers.sql` (`get_email_worker_url()`)

## Conventions
- Langue du code : français pour les commentaires et messages utilisateur
- CSS dans `styles.css`, JS partagé dans `app.supabase.js`, JS page-spécifique inline dans chaque HTML
- Thème visuel : médiéval doré sur parchemin (couleurs principales : `--gold #D4A030`, `--cream`, `--text-light`)
- Polices : Cinzel Decorative (titres), Lora (corps)
