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

> L'ancienne valeur (en clair dans l'historique Git jusqu'à cette migration) est
> **compromise** : elle doit être remplacée, pas seulement masquée.

## Procédure (première mise en place ET rotations suivantes)

Durée : ~15 minutes. À faire à un moment calme (hors période d'inscriptions actives) :
entre les étapes 3 et 4, les e-mails échouent en 403 (les inscriptions, elles, ne sont
pas affectées : l'envoi d'e-mail est asynchrone et ne bloque jamais la base).

1. **Générer la nouvelle valeur, sans l'afficher.** Dans PowerShell :

   ```powershell
   $bytes = New-Object byte[] 32
   [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
   (($bytes | ForEach-Object { $_.ToString('x2') }) -join '') | Set-Clipboard
   ```

   La valeur (64 caractères hexadécimaux) est maintenant dans le presse-papiers, pas à
   l'écran. Ne lancez rien d'autre qui utilise le presse-papiers avant l'étape 4.

2. **La stocker dans Vault (dashboard, pas en SQL).**
   Supabase → votre projet → **Database → Vault → Add new secret** (ou « New secret »).
   - Name : `melusine_webhook_secret`
   - Secret : coller (Ctrl+V)
   - **Rotation** : si le secret existe déjà, modifiez sa valeur (menu ⋯ → Edit) au lieu
     d'en créer un second.

3. **Appliquer la migration** (première fois seulement) : Supabase → **SQL Editor → New
   query**, coller le contenu de `migrations/001_webhook_secret_vault.sql` → **Run**.
   Si le secret n'existe pas, la migration s'arrête avec un message clair : retournez à
   l'étape 2.

4. **Mettre la même valeur côté Worker, tout de suite après.**
   Cloudflare → **Workers & Pages → melusine-email → Settings → Variables and Secrets**
   → `WEBHOOK_SECRET` → **Edit** → type **Secret** → coller (Ctrl+V) → **Deploy**.
   Variante en ligne de commande (la valeur est demandée en saisie masquée) :

   ```bash
   npx wrangler secret put WEBHOOK_SECRET --name melusine-email
   ```

   Si `WEBHOOK_SECRET` était une variable en clair (type « Text »), la repasser en
   « Secret » : les variables « Text » restent lisibles dans le dashboard.

5. **Vider le presse-papiers** : copiez un mot quelconque.

6. **Vérifier que l'ANCIENNE valeur est refusée** (voir ci-dessous).

7. **Vérifier qu'un vrai e-mail part** : `tests/trigger_email_live_test.sql` (projet de
   test) ; en production, faire une inscription de test sur un compte à vous.

## Vérifications

Dans **Git Bash**. `read -rs` demande la valeur en saisie masquée (rien ne s'affiche,
rien n'entre dans l'historique du shell).

```bash
WORKER_URL="https://melusine-email.olivier-gramain.workers.dev"

# 1) Ancienne valeur : doit répondre 403
read -rs OLD_SECRET; echo
curl -s -o /dev/null -w "ancienne valeur -> HTTP %{http_code} (attendu : 403)\n" \
  -X POST "$WORKER_URL" -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: $OLD_SECRET" \
  -d '{"type":"inconnu","to":"verif@example.invalid"}'
unset OLD_SECRET

# 2) Nouvelle valeur : l'authentification passe, le corps est volontairement
#    invalide (type inconnu) → le Worker répond 400 et N'ENVOIE RIEN.
read -rs NEW_SECRET; echo
curl -s -o /dev/null -w "nouvelle valeur -> HTTP %{http_code} (attendu : 400)\n" \
  -X POST "$WORKER_URL" -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: $NEW_SECRET" \
  -d '{"type":"inconnu","to":"verif@example.invalid"}'
unset NEW_SECRET

# 3) Sans en-tête : doit répondre 403
curl -s -o /dev/null -w "sans secret -> HTTP %{http_code} (attendu : 403)\n" \
  -X POST "$WORKER_URL" -H "Content-Type: application/json" \
  -d '{"type":"inconnu","to":"verif@example.invalid"}'
```

Où retrouver l'ancienne valeur pour le test 1 : dans l'historique Git
(`git log -p -S"X-Webhook-Secret" -- email-triggers.sql`). Elle s'affichera dans le
terminal : c'est la valeur compromise, ce n'est pas grave ; ne la copiez nulle part
ailleurs.

| Réponse | Signification |
|---|---|
| 403 sur l'ancienne valeur | Rotation réussie. |
| 403 sur la nouvelle valeur | Vault et Cloudflare n'ont pas la même valeur : refaire 2 et 4. |
| 500 « secret manquant » | `WEBHOOK_SECRET` absent côté Cloudflare (étape 4). |
| 200 sur l'ancienne valeur | **Rotation non appliquée côté Cloudflare** : refaire l'étape 4. |

## Si quelque chose casse

- Les e-mails ne partent plus : vérifier d'abord que les deux valeurs sont identiques
  (refaire 2 puis 4). Journaux : `npx wrangler tail melusine-email` ; côté base :
  `SELECT status_code, created FROM net._http_response ORDER BY created DESC LIMIT 5;`
- Retour arrière : `migrations/rollback/001_webhook_secret_vault_rollback.sql`
  (dernier recours, lire l'avertissement en tête de fichier).

## Maintenance

Renouveler ce secret **une fois par an** (avant chaque édition) et à chaque départ d'une
personne ayant eu accès à Cloudflare ou à Supabase. Noter la date de dernière rotation
dans le README.
