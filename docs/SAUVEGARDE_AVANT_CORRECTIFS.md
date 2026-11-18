# Sauvegarde avant les correctifs de sécurité (production)

## Pourquoi, et ce qui est (ou non) à risque

Les migrations `001`, `002` et `003` ne modifient **aucune donnée** : elles changent des
fonctions SQL et créent une table (`recap_email_log`). Ce qui peut écrire dans vos tables,
ce sont les scripts de test (annulés par `ROLLBACK`) et la recette manuelle
(`docs/RECETTE_MANUELLE.md`, inscription puis annulation avec votre compte). La sauvegarde
est une assurance contre un incident, et une photo de l'état avant pour comparer après.

Les sauvegardes contiennent des **données personnelles** (noms, e-mails) : dossier **hors du
dépôt Git**, jamais committé, supprimé (ou purgé avec les données 2026) une fois la recette
terminée. Exemple : `C:\Users\OliveGramain\sauvegardes\melusine-avant-correctifs\`.

Je ne sais pas si votre offre Supabase fait des sauvegardes automatiques (en offre gratuite,
en général non) : vérifier dans **Database → Backups**. À défaut, ces exports sont votre
seule copie.

## Étape A — Fichiers du catalogue (lecture seule)

Dans Supabase → **SQL Editor**, une requête à la fois ; pour chacune, **Download CSV** vers
le dossier de sauvegarde, avec le nom de fichier indiqué.

1. Vérifier les extensions (rien à enregistrer) :

   ```sql
   SELECT extname FROM pg_extension WHERE extname IN ('supabase_vault', 'pg_net');
   ```

   Attendu : **2 lignes**. Sinon, arrêtez-vous : la migration 001 ne pourra pas fonctionner.

2. Définitions actuelles des fonctions → `fonctions_definitions.csv`
   (`send_email_via_worker` est **volontairement absente** : sa définition contient l'ancien
   secret compromis ; elle est de toute façon dans l'historique Git) :

   ```sql
   SELECT p.oid::regprocedure AS fonction, pg_get_functiondef(p.oid) AS definition
   FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('annuler_presence', 'ensure_presence', 'send_recap_email');
   ```

3. Droits actuels → `fonctions_droits.csv` :

   ```sql
   SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS arguments, p.proacl::text AS droits
   FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('annuler_presence', 'ensure_presence', 'send_recap_email', 'send_email_via_worker');
   ```

4. Politiques RLS actuelles → `policies.csv` (sert aussi au chantier suivant, la revue RLS) :

   ```sql
   SELECT tablename, policyname, cmd, roles, qual, with_check
   FROM pg_policies
   WHERE schemaname = 'public'
   ORDER BY tablename, policyname;
   ```

5. Tables et activation de la RLS → `tables_rls.csv` :

   ```sql
   SELECT relname, relrowsecurity
   FROM pg_class
   WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
   ORDER BY 1;
   ```

## Étape B — Fichiers des tables

Pour chaque table : `SELECT * FROM <table>;` dans le SQL Editor, puis **Download CSV** →
`<table>.csv`.

| Table | Touchée par ce chantier ? | Sauvegarder |
|---|---|---|
| `inscriptions` | Oui : recette manuelle, tests SQL annulés | **Indispensable** |
| `presences` | Oui : créée puis supprimée par la recette | **Indispensable** |
| `benevoles`, `repas` | `annuler_presence` y fait des `UPDATE` (sur votre e-mail seulement) | **Indispensable** |
| `profiles` | Non, mais elle porte les rôles (dont le vôtre) | **Indispensable** |
| `programme`, `accompagnants` | Non | Recommandé (données 2026 uniques, absentes du dépôt) |
| `config` | Non | Recommandé (réglages manuels, pas forcément dans `seed_data.sql`) |
| `creneaux_benevoles`, `restauration`, `animations` | Non | Inutile ici |
| `audit_log` | Alimentée, jamais lue par le chantier | Inutile |
| `recap_email_log` | N'existe pas encore (créée par la migration 003) | Rien |
| `auth.users`, Vault | Non touchés | Rien (pas d'export simple, aucune opération ne les modifie) |

## Étape C — Compteurs : la source de vérité

**Pourquoi :** l'éditeur SQL peut **tronquer l'affichage** d'un résultat (je crois à environ
1 000 lignes, non vérifié), et l'export CSV d'un `SELECT *` peut en subir les conséquences
sans prévenir. Un `count(*)` n'est jamais tronqué : c'est lui qui dit combien de lignes
doit contenir chaque fichier.

Exécuter **cette requête** (une ligne par fichier de sauvegarde) et **noter le résultat** :

```sql
SELECT 'inscriptions' AS fichier, count(*) AS lignes FROM inscriptions
UNION ALL SELECT 'presences', count(*) FROM presences
UNION ALL SELECT 'benevoles', count(*) FROM benevoles
UNION ALL SELECT 'repas', count(*) FROM repas
UNION ALL SELECT 'profiles', count(*) FROM profiles
UNION ALL SELECT 'programme', count(*) FROM programme
UNION ALL SELECT 'accompagnants', count(*) FROM accompagnants
UNION ALL SELECT 'config', count(*) FROM config
UNION ALL SELECT 'fonctions_definitions', count(*) FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proname IN ('annuler_presence', 'ensure_presence', 'send_recap_email')
UNION ALL SELECT 'fonctions_droits', count(*) FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proname IN ('annuler_presence', 'ensure_presence', 'send_recap_email', 'send_email_via_worker')
UNION ALL SELECT 'policies', count(*) FROM pg_policies WHERE schemaname = 'public'
UNION ALL SELECT 'tables_rls', count(*) FROM pg_class
  WHERE relnamespace = 'public'::regnamespace AND relkind = 'r';
```

Si vous n'exportez pas une table recommandée (par exemple `config`), retirez simplement la
ligne correspondante ici et dans le script ci-dessous.

## Étape D — Comparer chaque CSV aux compteurs

Dans PowerShell, remplacez chaque `$null` par le nombre de la colonne `lignes` de l'étape C
(même nom de fichier), adaptez `$dossier`, puis collez le tout. `Import-Csv` compte les
**lignes de données** (en-tête exclu) et traite correctement les champs multilignes entre
guillemets, comme les définitions de fonctions ; un simple comptage de lignes de texte se
tromperait.

```powershell
$dossier = "C:\Users\OliveGramain\sauvegardes\melusine-avant-correctifs"
$attendus = [ordered]@{
    inscriptions          = $null
    presences             = $null
    benevoles             = $null
    repas                 = $null
    profiles              = $null
    programme             = $null
    accompagnants         = $null
    config                = $null
    fonctions_definitions = $null
    fonctions_droits      = $null
    policies              = $null
    tables_rls            = $null
}

foreach ($nom in $attendus.Keys) {
    $fichier = Join-Path $dossier "$nom.csv"
    if ($null -eq $attendus[$nom]) { "A RENSEIGNER $nom : mettre le nombre de la requete de compteurs"; continue }
    if (-not (Test-Path $fichier)) { "ECHEC $nom : fichier absent"; continue }
    $lignes = @(Import-Csv -Path $fichier -Encoding UTF8).Count
    if ($lignes -eq $attendus[$nom]) { "OK    $nom : $lignes ligne(s)" } else { "ECHEC $nom : $lignes dans le CSV, $($attendus[$nom]) en base" }
}
```

**Résultat attendu :** une ligne **OK** par fichier, aucune ligne « ECHEC » ni
« A RENSEIGNER ». **Ne commencez pas la procédure de déploiement tant que ce n'est pas le
cas.**

Si un fichier est en ❌ (moins de lignes dans le CSV qu'en base) :
1. ne le gardez pas comme sauvegarde, il est incomplet ;
2. réexportez-le **par tranches**, par exemple `SELECT * FROM inscriptions WHERE id <= 500;`
   puis `WHERE id > 500;`, sous deux noms de fichier, et additionnez les lignes ;
   ou exportez la table depuis **Table Editor** si votre interface le propose ;
3. refaites la comparaison.

Un écart sur `fonctions_definitions` seul est le plus souvent un souci de guillemets dans le
CSV exporté (champs multilignes) : ouvrez le fichier et vérifiez qu'il contient bien une
définition par fonction avant de conclure.

## Après la recette

Rejouer la requête de compteurs de l'étape C et comparer au résultat noté avant :

- les 8 lignes de tables (`inscriptions` … `config`) doivent être **identiques** ;
- `fonctions_definitions`, `fonctions_droits` et `policies` doivent être identiques ;
- `tables_rls` doit avoir **+ 1** (la table `recap_email_log`, créée par la migration 003).

Tout autre écart est à investiguer avant de considérer la recette terminée.
