# Mélusine — Convention JDR "Sous l'Œil de Mélusine"

## Vue d'ensemble
Site d'inscription pour une convention de jeu de rôle à Poitiers, organisée par La Guilde Poitiers. Les joueurs consultent le programme et s'inscrivent aux tables. Les MJ proposent des tables. Les admins gèrent le tout.

**État (novembre 2026)** : l'édition 2026 (16-17 mai 2026) est terminée. L'édition 2027 a lieu les 8-9 mai 2027. Calendrier : périmètre gelé le 10/01/2027, site rouvert et testé le 23/01/2027, lancement public le 07/02/2027 au plus tard. Pas de refonte de framework avant la convention. Les textes de ce fichier qui parlent encore de dates 2026 décrivent l'édition passée ; les valeurs annuelles sont à mettre à jour (voir `ROADMAP.md`, sections 4 et 5).

## Architecture
- **Frontend** : pages HTML statiques + 1 JS partagé + feuilles de style (`theme.css`, `styles.css`, `fonts.css`) + polices auto-hébergées (aucun appel à Google Fonts), hébergées sur GitHub Pages (domaine `sousloeildemelusine.fr`)
- **Backend** : Supabase (PostgreSQL + Auth + REST API + RPC)
- **Emails transactionnels** : Cloudflare Worker (`worker-email.js`) déclenché par triggers PostgreSQL via `pg_net`, envoi via MailerSend
- **Authentification** : Supabase Auth — 3 méthodes : email/password, SSO Google, SSO Discord
- **Rôles** : joueur (défaut), mj, admin — stockés dans la table `profiles`

## Fichiers

### Pages HTML
- `index.html` : Accueil (depuis le 18/05/2026 : message de fin d'édition ; les autres pages restent accessibles par leur adresse directe, la navigation est masquée)
- `index.2026.html` : Archive de l'ancien accueil de l'édition 2026 (à restaurer ou adapter pour 2027)
- `programme.html` : Programme des tables et inscription
- `mes-inscriptions.html` : Récap personnel (présence, tables, accompagnants, bénévolat, repas, propositions MJ)
- `infos.html` : Infos pratiques
- `benevoles.html` : Inscription aux créneaux bénévoles
- `aide.html` : FAQ / aide
- `espace-mj.html` : Proposer des tables (rôle `mj` ou `admin`)
- `admin.html` : Panneau admin (stats, validation tables, gestion rôles)
- `melusine-convention-2026.html` : Outil admin autonome pour le jour J (pointage, vues par jour, repas). Lit les données via la RPC `get_admin_export_data` (rôle admin vérifié côté base) avec la session de `localStorage` ; les pointages et modifications restent **uniquement dans le navigateur** de l'appareil (clés `m27*` : le préfixe est lu dans `edition.js` et change à chaque édition), jamais renvoyés à Supabase

### Code
- `app.supabase.js` : JS partagé — config Supabase, client REST léger (sbQuery/sbInsert/sbUpdate/sbDelete), proxy `APP.supabase.from(...)/rpc(...)`, helpers (escHtml, esc, toast), auth, navigation, rôles, présences. Importé par toutes les pages avec un query string `?v=N` pour le cache busting (à bumper à chaque changement).
- `edition.js` : **Valeurs qui changent à chaque édition** (année, dates ISO du samedi et du dimanche, lieu, liens HelloAsso et Facebook, préfixe de stockage de l'outil du jour J). Les libellés (« samedi 8 mai ») sont calculés. Un lien vide masque son bloc. Chargé avant `app.supabase.js` dans chaque page. Son équivalent côté e-mails est le bloc `EDITION` en tête de `worker-email.js` : les deux doivent rester identiques (test `tests/edition.test.js`). Marche à suivre : `docs/EDITION_2027_A_FAIRE.md`
- `theme.css` : **Tous les jetons visuels** (couleurs, polices, rayons, espacements, ombres). Thème sombre par défaut, thème clair automatique (`prefers-color-scheme: light`). Aucune couleur en dur ailleurs ; les variantes de texte et de statut sont dérivées pour tenir WCAG AA (tableau des contrastes dans le fichier). Anciens noms de variables (`--cream`, `--gold`, `--teal`…) conservés comme alias
- `styles.css` : Mise en page et composants, partagés par toutes les pages. Ne contient aucune couleur en dur : tout passe par les jetons de `theme.css`
- `fonts.css` et `fonts/` : Polices **auto-hébergées** (Cinzel, Cinzel Decorative, Lora ; woff2 latin, 116 Ko ; licence SIL OFL 1.1, voir `fonts/README.md`)
- **Logo de La Guilde** : `Logo_guilde_final.webp` est la source (fond transparent, 1300 px). Le site charge `img/logo-guilde-192.webp` / `-256.webp` en thème clair et `img/logo-guilde-sombre-192.webp` / `-256.webp` (bordeaux éclairci) en thème sombre, par `<picture>`, sans plaque. Icônes d'onglet et d'écran d'accueil : `icons/` (PNG sur plaque crème). Outils sans dépendance : `tools/optimiser-affiche.js` (réduction), `tools/logo-mode-sombre.js` (version sombre), `tools/faire-icones.js` (icônes). `logo.png` est l'ancien logo : il ne sert plus qu'à l'archive `index.2026.html`
- **Maquettes design v2 (branche `feature/design-v2`, non publiées)** : `v2.css` (couche visuelle chargée après `styles.css`), `accueil-2027.html` (nouvel accueil, textes provisoires, `noindex`), `img/affiche-2027.webp` (affiche allégée), `tools/optimiser-affiche.js` (fabrique la version web de l'affiche). Détail, points provisoires et marche à suivre : `docs/DESIGN_V2.md` et `docs/AFFICHE.md`
- `acces.js` : **Rideau d'accès équipe** (phase fermée). Cache les pages derrière un code saisi sur `index.html` ; le code n'est pas dans le dépôt (empreinte SHA-256 seulement). **Ce n'est pas une protection** : lisible par tous, contournable, ne protège pas l'API Supabase. Fonctionnement, changement de code et retrait au lancement : `docs/ACCES_EQUIPE.md`
- `worker-email.js` : Code du Cloudflare Worker d'e-mails `melusine-email` (à copier dans le dashboard Cloudflare après modification)
- `worker.js` : Code du second Worker Cloudflare, de **maintien en éveil** : un cron ping la base Supabase toutes les 4 minutes pour éviter la mise en pause du plan gratuit. Sans lien avec les e-mails
- `CNAME` : Domaine personnalisé GitHub Pages (`sousloeildemelusine.fr`)

### SQL (Supabase)
- `seed_data.sql` : Données initiales (créneaux bénévoles, programme, restauration, animations)
- `email-triggers.sql` : Triggers PostgreSQL qui déclenchent les emails transactionnels via `pg_net` → Worker
- `presences.sql` : Table `presences` + triggers d'auto-création + RPC `annuler_presence` + RLS
- `presences_admin_stats.sql` : RPC `get_presences_stats` (réservée admin)
- `inscription_promotion.sql` : Trigger `trg_promote_first_waiting` qui promeut auto le 1er en attente quand une place se libère
- `email_rappels.sql` : RPC `send_reminders(p_test_email)` qui envoie le rappel J-3 à toutes les personnes présentes (mode test = un seul destinataire)
- `admin_export.sql` : RPC `get_admin_export_data` qui retourne toutes les données pour l'export CSV admin
- `programme_sync.sql` : Trigger `trg_sync_inscriptions_on_programme_rename` qui propage automatiquement un renommage de table (`programme.jeu` ou `creneau`) aux inscriptions liées
- `audit_log.sql` : Table `audit_log` + trigger générique `trg_audit` sur les tables sensibles (inscriptions, programme, benevoles, repas, presences, profiles, accompagnants) — archive automatique de toutes les modifications avec JSONB old/new + email de l'appelant

### Documentation
- `CLAUDE.md` : Ce fichier
- `README.md` : Présentation, installation, structure, maintenance annuelle
- `ROADMAP.md` : Feuille de route de l'édition 2027 (dette technique, fonctionnalités à préserver, checklist de pré-production)
- `MIGRATION_URL.md` : Notes sur la migration vers le domaine custom
- `TESTS.md` : Fiche de recette (version à cocher) ; `tests-melusine.csv` en est la version tableur
- `docs/EDITION_2027_A_FAIRE.md` : Où changer chaque valeur annuelle, ce qu'il reste à fournir pour 2027, occurrences 2026 restantes, marche à suivre pour la prochaine édition
- `migrations/010_edition_2027_config.sql` : **modèle non exécutable** (garde-fou en tête) pour mettre à jour la table `config` avec les valeurs 2027, avec son retour arrière dans `migrations/rollback/`
- `.gitignore` : exclut le fichier de prompts personnel et les dossiers de captures d'écran (aucune capture ne se commit)

## Stack technique
- HTML/CSS/JS vanilla (pas de framework)
- **Pas de SDK Supabase JS** : le proxy dans `app.supabase.js` utilise `fetch()` direct vers l'API REST de Supabase (le SDK avait un bug de lock auth). Mêmes méthodes que le SDK pour rester simple.
- PostgreSQL via Supabase (base de données + Auth + RLS + RPC)
- Cloudflare Worker pour le relais MailerSend
- API Google Identity Services (SSO Google) + API Discord OAuth2 (SSO Discord) — gérées par Supabase Auth

## Tests automatisés
Node seul (18 ou plus), **aucune dépendance à installer**. Depuis la racine du dépôt :

```
node --test "tests/*.test.js"
```

(Sous Node 24, `node --test tests/` sans motif échoue : garder les guillemets et le motif.) 46 tests :
- `tests/worker-email.test.js` (29) : échappement HTML des 10 gabarits d'e-mails avec des valeurs hostiles, sujets et liens d'agenda non échappés, authentification du Worker (403 sans ou avec mauvais secret), validation, un test de bout en bout avec un faux `fetch`. Le fichier `worker-email.js` est chargé tel quel, sans export ajouté pour les tests.
- `tests/edition.test.js` (17) : samedi/dimanche valides, libellés calculés, cohérence entre `edition.js` et le bloc `EDITION` du Worker, liens vides masqués, liens non https refusés, plus aucune date 2026 en dur dans le code.

À relancer après toute modification de `worker-email.js`, `edition.js` ou des dates. La recette manuelle (parcours complet, droits, e-mails réels) est dans `TESTS.md`.

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
4. Les pages MJ et admin vérifient le rôle côté client. Côté base, seules les RPC admin versionnées dans ce dépôt (`get_presences_stats`, `get_admin_export_data`, `send_reminders`) contrôlent le rôle `admin` ; la protection des écritures MJ/admin repose sur des politiques RLS configurées dans le tableau de bord Supabase, **non versionnées et non auditées** (voir « Sécurité »)

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
- Les lectures et écritures directes passent par la RLS Supabase (filtre par e-mail du JWT) **là où elle est configurée** (voir « Sécurité »)
- Les fonctions sensibles (annuler_presence, send_recap_email, get_presences_stats…) sont en SECURITY DEFINER, donc elles contournent la RLS : **chacune doit vérifier elle-même l'identité de l'appelant** (e-mail du JWT) et avoir un `SET search_path`. À la date de cet audit, `annuler_presence` et `send_recap_email` ne le faisaient pas (correctif dans la branche `security/lockdown-rpc`)

## Sécurité
État vérifié par l'audit du 18/11/2026 (lecture du dépôt ; la base et les tableaux de bord n'ont pas été consultés) :

- **RLS** : seules les tables `presences` et `audit_log` ont leurs politiques versionnées (`presences.sql`, `audit_log.sql`). Pour `profiles`, `inscriptions`, `benevoles`, `repas`, `accompagnants`, `programme`, `config`, les politiques sont dans le tableau de bord Supabase : **à exporter (`pg_policies`) et à relire**, en priorité `profiles` (un utilisateur ne doit pas pouvoir se donner le rôle `admin`). Ne jamais écrire « RLS sur toutes les tables » tant que ce n'est pas vérifié
- **XSS** : `escHtml()` / `esc()` dans `app.supabase.js` et les pages (échantillon vérifié). Dans `worker-email.js`, toute valeur saisie par un utilisateur insérée dans un gabarit d'e-mail passe par `escapeHtml()` (sauf sujets et liens d'agenda, volontairement) ; couvert par `tests/worker-email.test.js`. Règle : tout nouveau gabarit doit échapper ses valeurs dynamiques
- **Session** : le jeton de session Supabase est dans `localStorage` (`melusine_session`) : lisible par tout script injecté. Limite connue, acceptée tant qu'il n'y a pas de refonte de l'authentification ; elle rend la prévention du XSS prioritaire. Aucune Content Security Policy n'est définie
- **Race conditions** : une seule contrainte unique versionnée (`presences`). Les places des tables sont calculées côté navigateur, sans trigger de capacité : deux inscriptions simultanées peuvent dépasser la capacité (chantier de migrations préparées)
- **Admin** : rôle `admin` lu depuis `profiles` dans les RPC `get_presences_stats`, `get_admin_export_data`, `send_reminders` (vérifié)
- **MJ** : le rôle `mj` n'est contrôlé dans aucun fichier SQL du dépôt (à vérifier dans les politiques RLS)
- **Secrets** : `MAILERSEND_API_KEY` et `WEBHOOK_SECRET` sont des variables Cloudflare. **Mais** la valeur du secret du webhook a été écrite en clair dans `email-triggers.sql` (donc dans l'historique Git) : elle est **considérée compromise** et doit être renouvelée. Le correctif (secret dans Supabase Vault, fonctions d'envoi verrouillées) est dans la branche `security/lockdown-rpc`, avec une procédure de rotation. La clé Supabase « publishable » visible dans `app.supabase.js` et `worker.js` est publique par conception ; sa sûreté dépend de la RLS
- **Données personnelles** : `audit_log` copie les lignes modifiées (noms, e-mails) sans purge ; l'outil du jour J garde une copie des données dans le navigateur de l'appareil utilisé. Prévoir une durée de conservation et la purge des données de l'édition précédente
- **htmlRedirect** : URL sanitisée

## Emails transactionnels
- Triggers PostgreSQL → `pg_net.http_post` → Cloudflare Worker (`worker-email.js`) → MailerSend
- Types : confirmation, promotion, annulation, accompagnant_supprime, table_validee, table_refusee, nouvelle_proposition, proposition_recue, recap (RPC à la demande), rappel (J-3, déclenché manuellement par l'admin via le bouton « Envoyer les rappels J-3 » de admin.html, **masqué depuis l'envoi de mai 2026** : ne le réactiver qu'après la purge des données de l'édition précédente, car `send_reminders` écrit à toutes les personnes présentes dans `presences`)
- Asynchrone (fire-and-forget) — n'impacte jamais la transaction principale
- **À surveiller** : si MailerSend retourne 401 → vérifier `MAILERSEND_API_KEY` dans Cloudflare. Si erreur 422 → vérifier DNS du domaine.

## Déploiement
- **Frontend** : `git push` → GitHub Pages (~3-5 min de cache CDN)
- **Cache busting** : bumper le `?v=N` du `<script src="app.supabase.js?v=N">` dans tous les HTML à chaque changement de `app.supabase.js`. Aussi dans la liste `prefetchAllPages` interne du JS. Même principe pour `edition.js?v=N`, `theme.css?v=N`, `styles.css?v=N` et `fonts.css?v=N` (dans toutes les pages qui les chargent), sinon les navigateurs gardent l'ancienne version pendant plusieurs minutes.
- **SQL Supabase** : copier le contenu des fichiers `*.sql` dans Supabase SQL Editor → Run
- **Worker Cloudflare** : copier `worker-email.js` dans le Worker `melusine-email` → Deploy
- **Important** : si l'URL du Worker change, mettre à jour `email-triggers.sql` (`get_email_worker_url()`)

## Conventions
- Langue du code : français pour les commentaires et messages utilisateur
- Couleurs, polices, rayons, ombres, espacements : **uniquement dans `theme.css`** (jetons). Mise en page dans `styles.css`, sans couleur en dur. JS partagé dans `app.supabase.js`, JS page-spécifique inline dans chaque HTML
- Valeurs annuelles (dates, lieu, liens) : **uniquement dans `edition.js`** et dans le bloc `EDITION` de `worker-email.js`. Ne jamais écrire une date ou un lieu en dur dans une page
- Thème visuel : ambiance crépusculaire (acier bleu-gris, accent orange-rouge, crème), sombre par défaut, clair selon le système. Jetons principaux : `--bg`, `--surface`, `--text`, `--accent` (remplissages), `--accent-text` (accent en texte, lisible), `--info-text`, `--success`, `--warning`, `--danger`. Utiliser `rgb(var(--accent-rgb) / 0.15)` pour une transparence
- Polices : Cinzel Decorative (titre de l'événement), Cinzel (titres), Lora (texte), auto-hébergées dans `fonts/`. Pas d'appel à un CDN tiers

## Règles d'autonomie (sessions Claude Code)
- Une branche par chantier, nommée `feature/<sujet>`, créée depuis `main` à jour. Jamais de commit direct sur `main`. Ne pas pousser (pas de `git push`) : l'utilisateur relit en local.
- Ne jamais exécuter de SQL, ne toucher à aucune configuration Supabase, Cloudflare ou MailerSend, ne modifier aucun secret. Tout ce qui touche à la base s'écrit en fichiers de migration avec rollback, **non appliqués**.
- Ne pas modifier la logique métier ni les appels RPC/REST hors du périmètre du chantier. Pas de refonte de framework, pas de nouvelle dépendance sans demander.
- Aucun secret, e-mail personnel ni donnée réelle dans les fichiers, les messages de commit ou les réponses.
- Commits courts, un par sujet. En fin de chantier : fichiers modifiés, ce qui a été vérifié et comment, ce qui ne l'a pas été.
- Une décision de contenu (texte, couleur, règle) : proposer deux options et attendre ; ne pas inventer de contenu officiel.
- Ne jamais utiliser `git add -A` : le dépôt peut contenir des fichiers de travail non suivis qui ne doivent pas être versionnés.
- Ne jamais committer de capture d'écran. Les mettre dans un dossier ignoré (`captures/`, `screenshots/`, `shots/`) ou hors du dépôt, et les supprimer une fois le rapport rendu.
