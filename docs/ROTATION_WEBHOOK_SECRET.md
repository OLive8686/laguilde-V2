# Rotation du secret du webhook (Supabase ↔ Worker d'e-mails)

## De quoi s'agit-il ?

Quand la base de données envoie un e-mail (confirmation, annulation…), elle appelle le
Worker Cloudflare `melusine-email` avec un en-tête `X-Webhook-Secret`. Le Worker refuse
tout appel dont l'en-tête ne correspond pas à sa variable `WEBHOOK_SECRET`. C'est le
seul verrou qui empêche un tiers de faire envoyer des e-mails depuis le domaine du site.

Le secret vit à **deux endroits qui doivent contenir la même valeur** :

| Endroit | Nom | Où le modifier |
|---|---|---|
| Supabase Vault | `melusine_webhook_secret` | Dashboard Supabase |
| Cloudflare (variable secrète du Worker) | `WEBHOOK_SECRET` | Dashboard Cloudflare ou `wrangler` |

**Règle : la valeur n'est jamais écrite dans un fichier du dépôt, ni collée dans une
requête SQL** (l'éditeur SQL de Supabase garde un historique des requêtes), ni envoyée par
e-mail ou messagerie.

> L'ancienne valeur (en clair dans l'historique Git jusqu'à la migration 001) est
> **compromise** : elle doit être remplacée, pas seulement masquée.

## Ordre à respecter

Cloudflare est modifié **après** la création du secret dans Vault et **avant** la
migration 001. Raisons :

- dès que Cloudflare a la nouvelle valeur, l'ancienne valeur compromise est refusée : on
  ferme la porte avant de toucher à la base ;
- si la migration échoue ensuite, la situation reste sûre (seuls des e-mails échouent) ;
- on peut vérifier le Worker (étape 5) avant de modifier quoi que ce soit en base.

Contrepartie : entre l'étape 3 et l'étape 6, la base envoie encore l'ancienne valeur, donc
**les e-mails déclenchés par la base échouent en 403**. C'est sans conséquence tant que le
site est en pause (aucune inscription en cours), et l'envoi étant asynchrone, une
inscription n'est jamais bloquée. **Si le site est actif**, enchaînez les étapes 3 et 6 sans
pause, et vérifiez ensuite qui n'a pas reçu son e-mail (relancer avec le récap).

## Procédure

Durée : ~20 minutes. Les commandes sont pour **Windows PowerShell 5.1**.

1. **Générer la nouvelle valeur, sans l'afficher.** Elle est copiée dans le presse-papiers :

   ```powershell
   $bytes = New-Object byte[] 32
   [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
   (($bytes | ForEach-Object { $_.ToString('x2') }) -join '') | Set-Clipboard
   ```

   Ne copiez rien d'autre avant l'étape 3.

2. **La stocker dans Vault (dashboard, pas en SQL).**
   Supabase → votre projet → **Database → Vault → Add new secret**.
   - Name : `melusine_webhook_secret`
   - Secret : coller (Ctrl+V)
   - *Rotation ultérieure* : le secret existe déjà, modifiez sa valeur (menu ⋯ → Edit)
     au lieu d'en créer un second.

3. **Poser la même valeur côté Worker et déployer.**
   Cloudflare → **Workers & Pages → melusine-email → Settings → Variables and Secrets**
   → `WEBHOOK_SECRET` → **Edit** → type **Secret** → coller (Ctrl+V) → **Deploy**.
   Variante en ligne de commande (la valeur est demandée en saisie masquée) :

   ```powershell
   npx wrangler secret put WEBHOOK_SECRET --name melusine-email
   ```

   Si `WEBHOOK_SECRET` était une variable en clair (type « Text »), la repasser en
   « Secret » : les variables « Text » restent lisibles dans le dashboard.
   **C'est à cet instant que l'ancienne valeur cesse d'être acceptée.**

4. **Vider le presse-papiers** : copiez un mot quelconque.

5. **Vérifier le Worker** (voir « Vérifications » plus bas) : ancienne valeur → **403**,
   nouvelle valeur → **400**, sans secret → **403**. Si ce n'est pas le cas, refaites
   l'étape 3 ; rien n'a encore été modifié en base.

6. **Appliquer la migration** (première mise en place uniquement ; pas pour une rotation
   ultérieure) : Supabase → **SQL Editor → New query**, coller le contenu de
   `migrations/001_webhook_secret_vault.sql` → **Run**. Si le secret Vault n'existe pas, la
   migration s'arrête avec un message clair : retournez à l'étape 2. Lancer ensuite
   `tests/001_webhook_secret_test.sql` : toutes les lignes doivent être ✅.

7. **Point de contrôle : un vrai e-mail doit partir.** L'étape 5 prouve que Cloudflare a la
   nouvelle valeur, pas que Vault a la même. Faire les étapes M1 et M1b de
   `docs/RECETTE_MANUELLE.md` : l'e-mail de confirmation arrive et `net._http_response`
   affiche un 200 avec `"ok":true`. Un 403 ici signifie que Vault et Cloudflare diffèrent :
   refaire 2 puis 3.

## Vérifications

Fonctions à coller une fois dans PowerShell (le secret est lu en saisie masquée et transmis
à `curl.exe` par l'entrée standard, pour ne jamais apparaître dans la ligne de commande) :

```powershell
$workerUrl = "https://melusine-email.olivier-gramain.workers.dev"
$body = Join-Path $env:TEMP "melusine-body.json"
Set-Content -Path $body -Value '{"type":"inconnu","to":"verif@example.invalid"}' -Encoding ascii

function Read-HiddenValue {
    param([string]$Prompt)
    $secure = Read-Host -Prompt $Prompt -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Test-Webhook {
    param([string]$Label, [string]$Secret, [string]$Expected)
    if ($Secret) { $headerLine = "X-Webhook-Secret: $Secret" } else { $headerLine = "X-Sans-Secret: 1" }
    $code = $headerLine | curl.exe -s -o NUL -w "%{http_code}" -X POST $workerUrl -H "Content-Type: application/json" -H "@-" -d "@$body"
    if ($code -eq $Expected) { "OK    $Label -> HTTP $code (attendu $Expected)" } else { "ECHEC $Label -> HTTP $code (attendu $Expected)" }
}
```

**Récupérer l'ancienne valeur dans le presse-papiers, sans l'afficher** (elle est dans
l'historique Git, commit `b9f180c`) :

```powershell
git show b9f180c:email-triggers.sql | Select-String 'X-Webhook-Secret": "([^"]+)"' | ForEach-Object { $_.Matches[0].Groups[1].Value } | Set-Clipboard
```

**Les trois appels** (coller la valeur demandée avec Ctrl+V ; rien ne s'affiche) :

```powershell
$old = Read-HiddenValue "Ancienne valeur (Ctrl+V)"
Test-Webhook "ancienne valeur" $old "403"
$old = $null

$new = Read-HiddenValue "Nouvelle valeur (Ctrl+V)"
Test-Webhook "nouvelle valeur" $new "400"
$new = $null

Test-Webhook "sans secret" "" "403"
Remove-Item $body
```

Le 400 sur la nouvelle valeur est voulu : l'authentification passe, le corps est
volontairement invalide (type inconnu) → le Worker répond 400 et **n'envoie rien**.

| Réponse | Signification |
|---|---|
| 403 sur l'ancienne valeur | Rotation réussie côté Cloudflare. |
| 200 sur l'ancienne valeur | **Rotation non appliquée côté Cloudflare** : refaire l'étape 3. |
| 403 sur la nouvelle valeur | La valeur collée n'est pas celle de Cloudflare : refaire l'étape 3 (copier à nouveau depuis le presse-papiers de l'étape 1, ou regénérer). |
| 500 « secret manquant » | `WEBHOOK_SECRET` absent côté Cloudflare (étape 3). |

Même vérification en Bash (Git Bash) : `read -rs OLD_SECRET`, puis
`curl -s -o /dev/null -w "%{http_code}\n" -X POST "$WORKER_URL" -H "Content-Type: application/json" -H "X-Webhook-Secret: $OLD_SECRET" -d '{"type":"inconnu","to":"verif@example.invalid"}'`.

## Si quelque chose casse

- Les e-mails ne partent plus après la migration : les valeurs Vault et Cloudflare
  diffèrent. Refaire 2 puis 3. Journaux : `npx wrangler tail melusine-email` ; côté base :
  `SELECT status_code, created FROM net._http_response ORDER BY created DESC LIMIT 5;`
- Retour arrière : `migrations/rollback/001_webhook_secret_vault_rollback.sql`.
  **À éviter** : il rouvre la fonction d'envoi à tout le monde et ne restaure ni l'ancien
  secret ni les e-mails. Corriger vers l'avant (valeurs identiques) est presque toujours la
  bonne réponse.

## Maintenance

Renouveler ce secret **une fois par an** (avant chaque édition) et à chaque départ d'une
personne ayant eu accès à Cloudflare ou à Supabase. Pour une rotation ultérieure : étapes
1 à 5 et 7 (l'étape 6, la migration, n'est faite qu'une fois). Noter la date de dernière
rotation dans le README.
