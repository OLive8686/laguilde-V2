# Recette manuelle des correctifs de sécurité (production, avec votre compte)

## À quoi ça sert

Vérifier, avec **votre propre compte** et de **vrais e-mails**, que :
- la base envoie bien les e-mails au Worker avec le nouveau secret (migration 001) ;
- on ne peut agir que sur **son propre** compte (migrations 002 et 003) ;
- un visiteur non connecté est refusé.

Les scripts `tests/00X_*.sql` prouvent l'isolation entre utilisateurs sur des données
factices, mais seul ce test passe par le site réel et par la vraie boîte mail.

## Avant de commencer

- Vous êtes **admin** et pouvez vous connecter à `https://sousloeildemelusine.fr/`.
  L'accueil affiche le message de fin d'édition ; les pages `programme.html` et
  `mes-inscriptions.html` restent accessibles par leur adresse directe.
- Vous recevrez de **vrais e-mails** à votre adresse (dates 2026 : c'est normal).
- La sauvegarde est faite (`docs/SAUVEGARDE_AVANT_CORRECTIFS.md`).
- Relevez les **compteurs « avant »** : exécutez la requête de compteurs de
  `docs/SAUVEGARDE_AVANT_CORRECTIFS.md` (étape C) et gardez le résultat.

Pour chaque étape : faites l'action, comparez à « Résultat attendu », cochez.

## M1 — Inscription : la base envoie l'e-mail de confirmation

*À faire dès la migration 001 appliquée : c'est le contrôle qui prouve que Vault et
Cloudflare contiennent la même valeur.*

1. Ouvrir `https://sousloeildemelusine.fr/programme.html` et vous connecter.
2. Cliquer sur **S'inscrire** sur une table qui a des places.
3. Attendre jusqu'à une minute et ouvrir votre boîte mail.

Résultat attendu : ☐ l'inscription apparaît ; ☐ e-mail « 🎲 Inscription confirmée — *nom du
jeu* » reçu. (Si la table est pleine : « ⏳ Liste d'attente — *nom du jeu* », c'est
également valable.)

## M1b — Vérifier la réponse du Worker côté base

1. Supabase → **SQL Editor** → nouvelle requête, coller :

   ```sql
   SELECT id, status_code, left(content::text, 120) AS reponse, error_msg, created
   FROM net._http_response
   ORDER BY created DESC
   LIMIT 5;
   ```

2. **Run**.

Résultat attendu : ☐ une ligne récente avec `status_code` = **200** et une réponse
contenant `"ok":true`.

| Constat | Signification |
|---|---|
| 200 et `"ok":false` | Le Worker a répondu mais MailerSend a échoué : voir MailerSend → Activity. |
| 403 | Vault et Cloudflare n'ont pas la même valeur : `docs/ROTATION_WEBHOOK_SECRET.md`, étapes 2 puis 3. |
| 500 | `WEBHOOK_SECRET` ou `MAILERSEND_API_KEY` manquant côté Cloudflare. |
| Aucune ligne récente | `pg_net` n'a pas encore envoyé : patienter 30 s et relancer. |

## M2 — Récap à la demande

1. Ouvrir `https://sousloeildemelusine.fr/mes-inscriptions.html`.
2. Cliquer sur **📧 Recevoir par email le détail de mes inscriptions**.

Résultat attendu : ☐ message « Récap envoyé ! Vérifiez votre boîte mail (*votre adresse*) » ;
☐ e-mail récapitulatif reçu.

## M2b — Limite d'envoi (1 par 2 minutes)

1. Recliquer immédiatement sur le même bouton.

Résultat attendu : ☐ un message d'erreur, aucun nouvel e-mail. Le texte exact
« Un récap a déjà été envoyé il y a moins de 2 minutes… » n'apparaît **qu'une fois la
modification de `mes-inscriptions.html` publiée** (GitHub Pages, ~5 min après la
fusion). Avant, le message est le générique « Erreur lors de l'envoi » : c'est aussi un
refus, donc valide.

## M3 — Annulation par la présence

1. Sur `mes-inscriptions.html`, repérer l'encart **Ma présence**.
2. Décocher le jour de la table à laquelle vous vous êtes inscrit en M1.
3. Confirmer la fenêtre « Annuler la présence de … ? ».

Résultat attendu : ☐ l'inscription disparaît de la liste ; ☐ e-mail « ❌ Inscription
annulée — *nom du jeu* » reçu.

## M4 — Impossible d'agir sur un autre compte (connecté)

*Les adresses visées sont fictives (`@example.invalid`) : si le correctif ne marchait pas,
personne de réel ne serait touché.*

1. Toujours connecté, sur `mes-inscriptions.html`, ouvrir les outils du navigateur (F12) →
   onglet **Console**. (Chrome peut demander de taper `allow pasting` avant de coller.)
2. Coller et valider :

   ```js
   APP.supabase.rpc('annuler_presence', { p_email: 'autre@example.invalid', p_jour: 'samedi' }).then(r => console.log(JSON.stringify(r)))
   ```

   Résultat attendu : ☐ `{"data":{"error":"Accès refusé : vous ne pouvez agir que sur votre propre compte"},"error":null}`

3. Coller et valider :

   ```js
   APP.supabase.rpc('send_recap_email', { user_email: 'autre@example.invalid' }).then(r => console.log(JSON.stringify(r)))
   ```

   Résultat attendu : ☐ `data.error` = « Accès refusé : vous ne pouvez demander le récap que pour votre propre compte » ; ☐ aucun e-mail envoyé nulle part.

## M5 — Un visiteur non connecté est refusé

1. Ouvrir une **fenêtre de navigation privée** (non connecté) sur
   `https://sousloeildemelusine.fr/mes-inscriptions.html`.
2. F12 → **Console**, coller et valider :

   ```js
   APP.supabase.rpc('annuler_presence', { p_email: 'autre@example.invalid', p_jour: 'samedi' }).then(r => console.log(JSON.stringify(r)))
   ```

Résultat attendu : ☐ `"data":null` et une `"error"` dont le message contient
**permission denied** (le code exact peut varier).

> **Si vous lisez « Aucune adresse e-mail associée à votre session », ❌ :** la fonction est
> encore appelable par un visiteur anonyme, le `REVOKE` n'a pas été appliqué
> (`migrations/002_annuler_presence_lockdown.sql`).

## C1 — Contrôle automatique côté API (visiteur anonyme, PowerShell)

Reprend `tests/rest_checks.sh` en PowerShell. À lancer **après** les migrations 002 et 003
(avant, `annuler_presence`, `ensure_presence` et `send_recap_email` échouent
normalement). La clé « anon/publishable » est publique (elle est visible dans le code du
site) ; elle est quand même lue en saisie masquée par habitude.

```powershell
function Read-HiddenValue {
    param([string]$Prompt)
    $secure = Read-Host -Prompt $Prompt -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

$supabaseUrl = "https://hdbhvwaemrjoantcecuv.supabase.co"
$anonKey = Read-HiddenValue "Cle publique anon/publishable (Ctrl+V)"
$rpcFile = Join-Path $env:TEMP "melusine-rpc.json"

function Test-AnonDenied {
    param([string]$FunctionName, [string]$Json)
    Set-Content -Path $rpcFile -Value $Json -Encoding ascii
    $code = curl.exe -s -o NUL -w "%{http_code}" -X POST "$supabaseUrl/rest/v1/rpc/$FunctionName" -H "apikey: $anonKey" -H "Authorization: Bearer $anonKey" -H "Content-Type: application/json" -d "@$rpcFile"
    if ($code -eq "401" -or $code -eq "403") { "OK    $FunctionName : refuse (HTTP $code)" } else { "ECHEC $FunctionName : HTTP $code (attendu 401 ou 403)" }
}
function Test-AnonControl {
    $code = curl.exe -s -o NUL -w "%{http_code}" "$supabaseUrl/rest/v1/config?select=cle&limit=1" -H "apikey: $anonKey"
    if ($code -eq "200") { "OK    controle positif : la cle publique fonctionne (HTTP 200)" } else { "ECHEC controle positif : HTTP $code (attendu 200)" }
}

Test-AnonControl
Test-AnonDenied "send_email_via_worker" '{"email_type":"confirmation","recipient":"a@example.invalid","payload":{}}'
Test-AnonDenied "get_webhook_secret" '{}'
Test-AnonDenied "annuler_presence" '{"p_email":"a@example.invalid","p_jour":"samedi","p_nom_accompagnant":null}'
Test-AnonDenied "ensure_presence" '{"p_email":"a@example.invalid","p_nom":"x","p_jour":"samedi","p_type_inscrit":"principal","p_nom_accompagnant":null}'
Test-AnonDenied "send_recap_email" '{"user_email":"a@example.invalid"}'
$anonKey = $null; Remove-Item $rpcFile
```

Résultat attendu : ☐ 6 lignes **OK**. Le « contrôle positif » prouve que la clé fonctionne
(sinon tous les refus pourraient venir d'une clé fausse). Un **404** est un échec : nom ou
signature de fonction introuvable, ce n'est pas un refus. Le contrôle positif suppose que
le rôle anonyme peut lire la table `config` (c'est ce que fait déjà le Worker de
maintien en éveil, `worker.js`).

## Nettoyage

1. Sur `mes-inscriptions.html`, cliquer **Annuler** sur toute inscription restante.
2. *(Facultatif)* retirer votre créneau de limite de récap : dans le SQL Editor,

   ```sql
   DELETE FROM recap_email_log WHERE email = lower('votre@adresse');
   ```

3. Supprimer les fichiers temporaires éventuels :
   `Remove-Item (Join-Path $env:TEMP "melusine-*.json") -ErrorAction SilentlyContinue`
4. Rejouer la requête de **compteurs** et la comparer aux compteurs « avant ».

Résultat attendu : ☐ les compteurs des 8 tables sont **identiques** à ceux d'avant la
recette ; ☐ `fonctions_definitions`, `fonctions_droits` et `policies` identiques ;
☐ `tables_rls` a **+ 1** (la table `recap_email_log`, créée par la migration 003).

## Ce que cette recette ne couvre pas

- Un compte SSO **sans adresse e-mail** (par exemple un compte Discord sans e-mail) :
  impossible à reproduire à la main. Couvert uniquement par `tests/002_annuler_presence_test.sql`
  et `tests/003_send_recap_email_test.sql`.
- Le sujet exact de l'e-mail récapitulatif n'est pas précisé ici : vérifiez simplement qu'un
  e-mail de récap arrive avec vos inscriptions.
