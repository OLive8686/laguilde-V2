# Sous l'Œil de Mélusine — site d'inscription

Site d'inscription de la convention de jeu de rôle « Sous l'Œil de Mélusine » (La Guilde Poitiers) : les joueurs consultent le programme et s'inscrivent aux tables, les MJ proposent des tables, les admins gèrent le tout.

> **État (novembre 2026)** : l'édition 2026 est terminée. L'édition 2027 a lieu les 8-9 mai 2027 (périmètre gelé le 10/01/2027, site rouvert le 23/01/2027, lancement public au plus tard le 07/02/2027). Voir `ROADMAP.md`.

## Architecture en bref

```
Navigateur  ──►  Pages HTML statiques (GitHub Pages, sousloeildemelusine.fr)
     │
     └──────►  Supabase : base PostgreSQL, authentification, API REST, fonctions SQL (RPC)
                    │
                    └─ triggers + pg_net ──► Worker Cloudflare « melusine-email » ──► MailerSend ──► e-mail
Worker Cloudflare « keep-alive » : ping Supabase toutes les 4 minutes (évite la mise en pause du plan gratuit)
```

Pas de framework ni de build : HTML, CSS et JavaScript « vanilla ». Les polices sont auto-hébergées (aucun appel à Google Fonts). Le détail (flux d'inscription, rôles, présences, e-mails, sécurité) est dans `CLAUDE.md`.

## Installation et lancement en local

Il n'y a rien à installer : le site est statique.

1. Cloner le dépôt.
2. Servir le dossier avec n'importe quel serveur de fichiers statiques sur le port 8080, par exemple `python -m http.server 8080` (ou l'extension « Live Server » de VS Code), puis ouvrir `http://localhost:8080/programme.html`.
3. La connexion (SSO Google/Discord) ne fonctionne en local que si `http://localhost:8080` est déclaré dans les URL de redirection de Supabase (Authentication → URL Configuration). **Attention : le site local parle à la vraie base de production.** Ne pas tester d'inscriptions avec de vraies adresses.

## Structure des fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Accueil (message de fin d'édition depuis le 18/05/2026) |
| `index.2026.html` | Archive de l'ancien accueil de l'édition 2026 |
| `programme.html` | Programme des tables et inscription |
| `mes-inscriptions.html` | Espace personnel : présence, tables, accompagnants, bénévolat, repas |
| `infos.html`, `aide.html`, `benevoles.html` | Infos pratiques, FAQ, créneaux bénévoles |
| `espace-mj.html` | Proposition de tables (rôle `mj` ou `admin`) |
| `admin.html` | Panneau admin (validation des tables, rôles, rappels, export CSV) |
| `melusine-convention-2026.html` | Outil admin du jour J (pointage ; données gardées dans le navigateur de l'appareil) |
| `app.supabase.js` | JavaScript partagé : connexion, client REST, rôles, présences, aides d'affichage |
| `edition.js` | **Valeurs de l'édition** : année, dates, lieu, liens, préfixe de stockage (seul fichier du site à changer chaque année) |
| `theme.css` | **Jetons visuels** : toutes les couleurs, polices, rayons, ombres ; sombre par défaut, clair automatique |
| `styles.css` | Mise en page et composants, sans couleur en dur |
| `fonts.css`, `fonts/` | Polices auto-hébergées (Cinzel, Cinzel Decorative, Lora ; 116 Ko ; licence SIL OFL) |
| `Logo_guilde_final.webp`, `img/`, `icons/` | Logo de La Guilde (source, versions réduites claire et sombre, icônes d'onglet) ; `logo.png` (ancien) ne sert plus qu'à l'archive `index.2026.html` |
| `v2.css`, `accueil-2027.html`, `img/`, `tools/` | **Maquettes design v2** (branche `feature/design-v2`) : couche visuelle, nouvel accueil, affiche allégée, script d'optimisation (voir `docs/DESIGN_V2.md`, `docs/AFFICHE.md`) |
| `acces.js` | Rideau d'accès équipe (code saisi sur `index.html`) : **pas une protection**, voir `docs/ACCES_EQUIPE.md` |
| `worker-email.js` | Code du Worker d'e-mails `melusine-email` (valeurs annuelles dans son bloc `EDITION`) |
| `tests/` | Tests automatisés Node (`worker-email.test.js`, `edition.test.js`) |
| `docs/EDITION_2027_A_FAIRE.md` | Valeurs annuelles : où les changer, ce qu'il reste à fournir |
| `migrations/` | Modèle de migration préparé, non exécuté (`010`, valeurs 2027 de la table `config`) |
| `worker.js` | Code du Worker de maintien en éveil de Supabase |
| `*.sql` | Base de données : données initiales, triggers, fonctions (voir `CLAUDE.md`) |
| `CNAME` | Domaine personnalisé |
| `ROADMAP.md` | Feuille de route 2027 |
| `TESTS.md`, `tests-melusine.csv` | Fiche de recette (version à cocher, version tableur) |
| `MIGRATION_URL.md` | Procédure de changement de domaine |
| `CLAUDE.md` | Documentation technique détaillée et règles de travail |

## Variables d'environnement et secrets

Il n'y a **pas de fichier `.env`** : le site est statique, sans serveur à configurer. Les valeurs sensibles vivent dans les services, jamais dans le dépôt :

| Valeur | Où elle vit |
|---|---|
| `MAILERSEND_API_KEY` | Variable secrète du Worker `melusine-email` (Cloudflare) |
| `WEBHOOK_SECRET` | Variable secrète du même Worker, et même valeur côté Supabase |
| URL du projet Supabase, clé « publishable » | Dans `app.supabase.js` : publiques par conception (la protection des données repose sur la RLS, pas sur le secret de cette clé) |

## Commandes utiles

| Action | Commande ou geste |
|---|---|
| Lancer en local | `python -m http.server 8080` dans le dossier du dépôt |
| Lancer les tests automatisés (46) | `node --test "tests/*.test.js"` (Node 18 ou plus, rien à installer ; garder les guillemets) |
| Vérifier la syntaxe du Worker | `node --check worker-email.js` |
| Déployer le site | `git push` sur `main` → GitHub Pages (~3-5 min ; Ctrl+Maj+R pour contourner le cache) |
| Déployer le Worker d'e-mails | Copier `worker-email.js` dans le Worker `melusine-email` (dashboard Cloudflare) → Deploy |
| Appliquer un fichier SQL | Supabase → SQL Editor → coller le fichier → Run |
| Changer `app.supabase.js`, `edition.js`, `theme.css`, `styles.css` ou `fonts.css` | Incrémenter leur `?v=N` dans **toutes** les pages qui les chargent (et, pour `app.supabase.js`, dans `prefetchAllPages`) |

Les tests automatisés couvrent le Worker d'e-mails (échappement HTML, authentification) et la configuration annuelle (dates, liens, cohérence site/Worker). Le reste se vérifie avec la recette manuelle `TESTS.md`.

## Maintenance à prévoir

**Chaque année, avant l'ouverture des inscriptions** (checklist complète : `ROADMAP.md`, section 5) :
- mettre à jour les dates, le lieu et les liens (Facebook, HelloAsso) dans **`edition.js`** et dans le bloc `EDITION` de `worker-email.js` (puis `node --test "tests/*.test.js"`), et les valeurs de la table `config` ; marche à suivre dans `docs/EDITION_2027_A_FAIRE.md` ;
- **renouveler le secret du webhook** (`WEBHOOK_SECRET`, côté Cloudflare et côté Supabase) et noter la date ;
- **purger ou archiver les données de l'édition précédente** (inscriptions, présences, bénévoles, repas, accompagnants, copie dans `audit_log`) : ce sont des données personnelles ;
- vérifier la clé `MAILERSEND_API_KEY` et le statut DNS du domaine d'envoi dans MailerSend ;
- vérifier le renouvellement du nom de domaine et que le projet Supabase n'est pas en pause (le Worker de maintien en éveil doit tourner) ;
- ne réactiver le bouton « Envoyer les rappels J-3 » de `admin.html` qu'après la purge, car il écrit à toutes les personnes présentes.

**En cours de saison** : surveiller l'onglet Activity de MailerSend (erreur 401 = clé API invalide ; 422 = problème DNS du domaine d'envoi). Le projet n'a aucune dépendance logicielle locale à mettre à jour.

## Sécurité

Les limites connues et les chantiers en cours (secret du webhook, politiques RLS à relire, jeton de session en `localStorage`) sont dans la section « Sécurité » de `CLAUDE.md`.
