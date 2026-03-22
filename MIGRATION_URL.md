# Migration vers l'URL officielle

## Contexte
Le site est actuellement sur `https://olive8686.github.io/laguilde-V2/`.
Quand le domaine officiel sera disponible (ex : `https://inscriptions.sousloeildemelusine.fr`),
voici les fichiers et services à mettre à jour.

---

## Checklist de migration

### 1. Google Sheet — onglet `config`
- [ ] Clé `lien_inscription` → nouvelle URL (ex : `https://inscriptions.sousloeildemelusine.fr/`)
  - Utilisé dans : emails de confirmation, liens de reset mot de passe, récap email

### 2. Cloudflare Worker — `worker.js`
- [ ] Ajouter la nouvelle origine dans `ALLOWED_ORIGINS` :
  ```javascript
  const ALLOWED_ORIGINS = [
    'https://inscriptions.sousloeildemelusine.fr',
    'https://olive8686.github.io',  // garder l'ancienne pendant la transition
  ];
  ```
- [ ] Redéployer le Worker dans l'éditeur Cloudflare (dash.cloudflare.com → melusineapi → Edit code → Deploy)

### 3. Discord — Redirect URI
- [ ] Discord Developer Portal → Application → OAuth2 → Redirects
- [ ] Ajouter la nouvelle URL racine (ex : `https://inscriptions.sousloeildemelusine.fr/`)
- [ ] Garder l'ancienne pendant la transition

### 4. Google SSO — Origines autorisées
- [ ] Google Cloud Console → API & Services → Credentials → Client OAuth
- [ ] Ajouter dans "Origines JavaScript autorisées" : `https://inscriptions.sousloeildemelusine.fr`
- [ ] Ajouter dans "URI de redirection autorisés" : `https://inscriptions.sousloeildemelusine.fr/`

### 5. Aucun fichier de code à modifier
- `app.js` : `SCRIPT_URL` pointe vers le Worker Cloudflare (ne change pas)
- `code.gs` : lit `lien_inscription` depuis la config Sheet (déjà dynamique)
- Les pages HTML : pas d'URL hardcodée (tout passe par le Worker)

### 6. DNS (si domaine propre)
- [ ] Configurer un enregistrement CNAME ou A vers l'hébergeur
- [ ] Option A : Cloudflare Pages (migrer depuis GitHub Pages)
- [ ] Option B : GitHub Pages custom domain (`CNAME` file dans le repo)
- [ ] Activer HTTPS (automatique avec Cloudflare ou GitHub Pages)

### 7. Service Worker — vider le cache
- [ ] Incrémenter `CACHE_VERSION` dans `sw.js` (ex : `melusine-v7`)
- [ ] Bumper `app.js?v=5` dans tous les HTML + sw.js
- [ ] Commit + push

---

## Ordre recommandé
1. Configurer le DNS + HTTPS
2. Mettre à jour la Sheet (`lien_inscription`)
3. Mettre à jour le Worker CORS
4. Mettre à jour Discord + Google SSO
5. Tester connexion + inscription + reset password
6. Retirer l'ancienne origine du Worker CORS après quelques jours

## Temps estimé : ~30 minutes (aucun code à modifier)
