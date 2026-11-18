# Valeurs annuelles : où les changer, et ce qu'il reste à fournir pour 2027

## Principe

Tout ce qui change d'une édition à l'autre est regroupé à **trois endroits** :

| Où | Contient | Qui le lit |
|---|---|---|
| `edition.js` (site) | Année, dates ISO du samedi et du dimanche, lieu (nom court, ville), liens HelloAsso et Facebook, préfixe de stockage de l'outil du jour J | Toutes les pages, `app.supabase.js`, l'outil du jour J |
| Bloc `EDITION` en tête de `worker-email.js` (e-mails) | Mêmes dates et lieu, plus les horaires et les deux liens | Les gabarits d'e-mails (rappel J-3, récap, liens agenda) |
| Table `config` (base Supabase) | Lieu détaillé (adresse, plan), dates avec horaires, tarif, textes de bienvenue et de restauration | La page Infos (`infos.html`) |

Les libellés (« samedi 8 mai », « 8 & 9 mai 2027 ») sont **calculés** à partir des dates ISO : une date ne se saisit qu'une fois par fichier.

**`edition.js` et le bloc du Worker doivent rester identiques** (dates, lieu, année, et liens renseignés ou non). Le test `tests/edition.test.js` le vérifie.

## Valeurs de l'édition 2027 déjà posées

- Samedi **8 mai 2027**, dimanche **9 mai 2027**.
- Lieu : **Foyer du Porteau, Poitiers**.
- Préfixe de stockage de l'outil du jour J : `m27` (les pointages de 2026, sous `m26`, ne sont plus lus).

## À fournir par l'organisateur (rien n'a été inventé)

| À fournir | Où le poser | Tant que c'est vide |
|---|---|---|
| Lien HelloAsso du repas du samedi soir 2027 | `edition.js` (`links.helloassoMeal`) **et** Worker (`helloassoMealUrl`) | Le bloc « Paiement en ligne » est masqué sur les pages ; il est absent des e-mails |
| Lien de l'événement Facebook 2027 | `edition.js` (`links.facebookEvent`) **et** Worker (`facebookEventUrl`) | Le paragraphe de partage est absent du rappel J-3 |
| Horaires de l'édition (ex. « samedi 9h-00h, dimanche 9h-17h ») | Worker (`horaires`) | La ligne « Horaires » est absente du rappel J-3 |
| Adresse, plan Google Maps, horaires détaillés, tarif | Table `config` : modèle `migrations/010_edition_2027_config.sql` (à compléter, non exécuté) | La page Infos affiche les valeurs 2026 de la base |
| Textes de bienvenue et de restauration 2027 | Table `config` (même modèle) | Idem |
| Créneaux JDR 2027 | `espace-mj.html`, liste `creneauxJDR` (marquée `TODO(à fournir)`) | Les MJ se voient proposer les créneaux de 2026 |
| Créneaux bénévoles 2027 | Table `creneaux_benevoles` (et `seed_data.sql` si on rejoue le seed) | La page Bénévoles affiche ceux de 2026 |

## Occurrences « 2026 » ou dates 2026 qui restent (relevé du 18/11/2026)

| Fichier | Ce que c'est | Action |
|---|---|---|
| `index.html` (lignes 7, 36, 39, 47) | Page de fin d'édition 2026 | Volontaire : à remplacer par l'accueil 2027 à la réouverture (23/01/2027). L'ancien accueil est archivé dans `index.2026.html` |
| `index.2026.html` | Archive de l'accueil 2026 | Volontaire : ne pas toucher, à restaurer et adapter |
| `admin.html` (lignes 123 et 129) | Un commentaire daté et le lien vers `melusine-convention-2026.html` | Le nom du fichier de l'outil du jour J contient « 2026 » : le renommer est facultatif (mettre à jour le lien de `admin.html` en même temps) |
| `seed_data.sql` (ligne 2) | Commentaire d'en-tête « 16-17 mai 2026 » | À mettre à jour quand les créneaux 2027 sont connus. SQL non modifié par ce chantier |
| `email-triggers.sql` (ligne 99) | Cette ligne contient « 2026 » parce que le **secret du webhook** y est écrit en clair (le mot fait partie de sa valeur) : ce n'est pas une date | Traité par le chantier de sécurité (secret en Vault, rotation) |
| Table `config` (base) | Valeurs 2026 des clés listées plus haut | À mettre à jour via le modèle `010` après l'avoir complété |
| `CLAUDE.md`, `ROADMAP.md`, `TESTS.md` | Mentions historiques de l'édition 2026 | Volontaire : elles décrivent l'édition passée |

À noter : `jour_from_creneau` (`presences.sql`) ne contient **aucune date** : elle lit seulement « samedi » ou « dimanche » au début du libellé du créneau. Rien à changer.

## Procédure pour une prochaine édition (par exemple 2028)

1. Modifier `edition.js` : année, `saturday`, `sunday`, lieu, liens, `storagePrefix` (par exemple `m28`).
2. Recopier les mêmes valeurs dans le bloc `EDITION` de `worker-email.js`, puis copier le fichier dans le Worker `melusine-email` (Cloudflare → Deploy).
3. Lancer `node --test tests/edition.test.js` : il signale un samedi qui n'en est pas un, une différence entre site et Worker, ou une date de l'édition précédente restée en dur.
4. Incrémenter `?v=N` de `edition.js` dans **toutes** les pages qui le chargent (et dans la liste `prefetchAllPages` de `app.supabase.js`), faute de quoi les navigateurs gardent l'ancienne version en cache.
5. Mettre à jour la table `config` (copie de `migrations/010_edition_2027_config.sql` adaptée) et les créneaux (`espace-mj.html`, bénévoles).
6. Mettre à jour le commentaire d'en-tête de `seed_data.sql` si on rejoue le seed.
7. Purger ou archiver les données de l'édition précédente avant la réouverture.
8. Refaire la recette (`TESTS.md`).

## Ce que ce chantier n'a PAS fait

- Il n'a exécuté aucun SQL ni modifié la base : la migration `010` est un modèle non exécutable (garde-fou en tête de fichier) avec son retour arrière.
- Il n'a pas retiré le `display:none` du bouton « Envoyer les rappels J-3 » de `admin.html`. Ce bouton écrit à toutes les personnes présentes dans la table `presences`, où figurent encore les données 2026 : à réactiver seulement après la purge.
- Il n'a pas touché à la page de fin d'édition (`index.html`) ni à l'archive.
