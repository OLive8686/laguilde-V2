// =============================================================================
// SERVICE WORKER — Sous l'Œil de Mélusine
// =============================================================================
// Stratégie : "Stale-While-Revalidate" pour les pages et assets du site,
// "Network-First" pour les appels API (données fraîches prioritaires).
//
// FONCTIONNEMENT :
//   1. À l'installation, met en cache toutes les pages et ressources statiques.
//   2. Pour les requêtes vers le site : sert depuis le cache immédiatement,
//      puis met à jour le cache en arrière-plan (navigation quasi-instantanée).
//   3. Pour les requêtes API (script.google.com) : tente le réseau d'abord,
//      fallback sur le cache si hors ligne (30s de TTL implicite).
//
// MISE À JOUR :
//   Changer CACHE_VERSION force la recréation du cache au prochain chargement.
//   Les anciennes versions sont supprimées automatiquement.
// =============================================================================

var CACHE_VERSION = 'melusine-v4';

// Ressources à mettre en cache dès l'installation
var STATIC_ASSETS = [
  './',
  'index.html',
  'programme.html',
  'infos.html',
  'benevoles.html',
  'mes-inscriptions.html',
  'espace-mj.html',
  'aide.html',
  'styles.css',
  'app.js?v=3',
  'admin.html'
];

// ── Installation : pré-cacher toutes les ressources statiques ───────────────
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function(cache) {
      return cache.addAll(STATIC_ASSETS);
    }).then(function() {
      // Activer immédiatement sans attendre la fermeture des onglets
      return self.skipWaiting();
    })
  );
});

// ── Activation : supprimer les anciens caches ───────────────────────────────
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) { return key !== CACHE_VERSION; })
            .map(function(key) { return caches.delete(key); })
      );
    }).then(function() {
      // Prendre le contrôle de tous les onglets immédiatement
      return self.clients.claim();
    })
  );
});

// ── Interception des requêtes ───────────────────────────────────────────────
self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);

  // Ignorer les requêtes non-GET (POST = écritures, ne pas cacher)
  if (event.request.method !== 'GET') return;

  // Ignorer les requêtes vers d'autres domaines (Google Fonts, etc.)
  // sauf script.google.com (API backend)
  var isAPI = url.hostname === 'script.google.com';
  var isSameSite = url.origin === self.location.origin;

  if (!isSameSite && !isAPI) return;

  // ── Requêtes API : Network-First avec fallback cache ──
  // On essaie le réseau d'abord (données fraîches), cache en backup si offline
  if (isAPI) {
    event.respondWith(
      fetch(event.request).then(function(response) {
        // Cloner et cacher la réponse pour le mode offline
        var clone = response.clone();
        caches.open(CACHE_VERSION).then(function(cache) {
          cache.put(event.request, clone);
        });
        return response;
      }).catch(function() {
        // Hors ligne → servir depuis le cache
        return caches.match(event.request);
      })
    );
    return;
  }

  // ── Ressources du site : Stale-While-Revalidate ──
  // Sert depuis le cache immédiatement (rapide), puis met à jour en arrière-plan
  event.respondWith(
    caches.match(event.request).then(function(cached) {
      // Lancer le fetch réseau en arrière-plan pour mettre à jour le cache
      var fetchPromise = fetch(event.request).then(function(response) {
        // Ne cacher que les réponses valides
        if (response && response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE_VERSION).then(function(cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(function() {
        // Réseau échoué → on a déjà retourné le cache, rien à faire
      });

      // Retourner le cache immédiatement s'il existe, sinon attendre le réseau
      return cached || fetchPromise;
    })
  );
});
