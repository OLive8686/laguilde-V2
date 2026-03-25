# Migration URL — Passage au domaine officiel

## Prérequis
- Accès au DNS du domaine (ex: `sousloeildemelusine.fr`)
- ~30 minutes de travail

---

## Checklist (dans cet ordre)

### 1. DNS — Pointer le domaine vers GitHub Pages (5 min)
Chez ton registrar/hébergeur DNS, ajoute :
- **CNAME** : `www` → `olive8686.github.io`
- **A** records (pour apex domain sans www) :
  - `185.199.108.153`
  - `185.199.109.153`
  - `185.199.110.153`
  - `185.199.111.153`

### 2. GitHub Pages — Configurer le custom domain (2 min)
- Repo → **Settings** → **Pages** → **Custom domain** → `sousloeildemelusine.fr`
- Cocher **Enforce HTTPS** (après propagation DNS, ~10 min)

### 3. Supabase — Mettre à jour les URLs (3 min)
- **Authentication** → **URL Configuration** :
  - **Site URL** : `https://sousloeildemelusine.fr/`
  - **Redirect URLs** : ajouter `https://sousloeildemelusine.fr/**`
- **Table config** (SQL Editor) :
  ```sql
  UPDATE config SET valeur = 'https://sousloeildemelusine.fr/' WHERE cle = 'lien_inscription';
  ```

### 4. Google Cloud Console — OAuth (2 min)
- **APIs & Services** → **Credentials** → ton OAuth Client
- **Authorized JavaScript origins** : ajouter `https://sousloeildemelusine.fr`
- **Authorized redirect URIs** : ne change pas (pointe vers Supabase)
- **Branding** → **Domaines autorisés** : ajouter `sousloeildemelusine.fr`

### 5. Discord Developer Portal — Rien à changer
- Les redirects pointent vers Supabase callback (indépendant du domaine du site)

### 6. Cloudflare Worker email — CORS + URL site (2 min)
- **melusine-email** → **Edit code**
- Ajouter `'https://sousloeildemelusine.fr'` dans `ALLOWED_ORIGINS` (ligne ~50)
- Mettre à jour `SITE_URL` (ligne ~82) : `'https://sousloeildemelusine.fr/'`
- **Deploy**

### 7. Cloudflare Worker keep-alive — Rien à changer
- Le cron ping Supabase directement, pas le site

### 8. MailerSend — Domaine custom (optionnel, 5 min)
Si tu vérifies le domaine dans MailerSend :
- **MailerSend** → **Domains** → **Add Domain** → `sousloeildemelusine.fr`
- Ajouter les enregistrements DNS (DKIM, SPF, DMARC)
- **Cloudflare Worker** → **Settings** → **Variables** → modifier `FROM_EMAIL` :
  `Sous l'Œil de Mélusine <convention@sousloeildemelusine.fr>`

### 9. Frontend — Rien à modifier
- `app.supabase.js` utilise l'URL Supabase (pas l'URL du site) pour les requêtes API
- Les pages HTML n'ont pas d'URL hardcodée
- Le lien du site dans les emails vient de la config Supabase (`lien_inscription`)

---

## Ce qui ne change PAS

| Composant | Pourquoi |
|---|---|
| URL Supabase (`hdbhvwaemrjoantcecuv.supabase.co`) | C'est l'API, pas le site |
| URL Worker email (`melusine-email.olivier-gramain.workers.dev`) | Appelé par pg_net, pas par les users |
| URL Worker keep-alive (`melusineapi.olivier-gramain.workers.dev`) | Cron interne |
| Clés API (Supabase, MailerSend, OAuth) | Indépendantes du domaine |
| Triggers PostgreSQL | Indépendants du domaine |
| RLS policies | Indépendantes du domaine |

---

## Ton intervention (ce que toi seul peux faire)

| Action | Console |
|---|---|
| Ajouter les enregistrements DNS | Registrar / hébergeur |
| Custom domain GitHub Pages | GitHub Settings |
| Site URL + Redirect URLs Supabase | Dashboard Supabase |
| Origine autorisée Google OAuth | Google Cloud Console |
| Domaine MailerSend (optionnel) | Dashboard MailerSend |

## Ce que Claude peut préparer à l'avance
- Mettre à jour `worker-email.js` dans le repo (ALLOWED_ORIGINS + SITE_URL)
- Commit + push

---

## Vérification post-migration
1. `https://sousloeildemelusine.fr/` → le site charge
2. SSO Google → connexion OK
3. SSO Discord → connexion OK
4. Inscription à une table → email reçu avec le bon lien
5. Reset password → email avec le bon lien
6. Liens dans les emails → pointent vers le nouveau domaine

---

## Rollback si problème
1. Retirer le custom domain dans GitHub Pages Settings
2. Remettre `lien_inscription` à `https://olive8686.github.io/laguilde-V2/` dans Supabase
3. Le site redevient accessible à l'ancienne URL immédiatement

## Temps estimé : ~30 minutes (aucun code frontend à modifier)
