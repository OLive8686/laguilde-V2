// =============================================================================
// SERVICE WORKER — Sous l'Œil de Mélusine
// =============================================================================
// Stratégie :
//   - Pages HTML : Network-First (toujours fraîches, cache en fallback offline)
//   - CSS/JS : Stale-While-Revalidate (rapide + mise à jour en arrière-plan)
//   - API (script.google.com) : Network-First avec fallback cache
//
// POURQUOI Network-First pour les HTML ?
// Les pages HTML contiennent les références versionnées (app.js?v=X).
// Si on cache le HTML, une mise à jour de version ne sera visible qu'au 2e
// chargement, ce qui cause des bugs (ancien + nouveau JS en parallèle).
// Les HTML sont petits (~5KB) donc le coût réseau est négligeable.
//
// MISE À JOUR :
//   Changer CACHE_VERSION force la recréation du cache.
// =============================================================================

var CACHE_VERSION = 'melusine-v6';

// Ressources à pré-cacher (uniquement CSS/JS, pas les HTML)
var STATIC_ASSETS = [
  'styles.css',
  'app.js?v=4'
];

// ── Installation : pré-cacher CSS/JS ────────────────────────────────────────
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function(cache) {
      return cache.addAll(STATIC_ASSETS);
    }).then(function() {
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
      return self.clients.claim();
    })
  );
});

// ── Interception des requêtes ───────────────────────────────────────────────
self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;

  var isAPI = url.hostname === 'script.google.com';
  var isSameSite = url.origin === self.location.origin;

  if (!isSameSite && !isAPI) return;

  // ── Pages HTML : Network-First ──
  // Toujours servir le HTML frais du réseau (contient les refs versionnées).
  // Fallback cache uniquement si hors ligne.
  var isHTML = isSameSite && (url.pathname.endsWith('.html') || url.pathname.endsWith('/'));
  if (isHTML) {
    event.respondWith(
      fetch(event.request).then(function(response) {
        if (response && response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE_VERSION).then(function(cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(function() {
        return caches.match(event.request);
      })
    );
    return;
  }

  // ── API : Network-First avec fallback cache ──
  if (isAPI) {
    event.respondWith(
      fetch(event.request).then(function(response) {
        var clone = response.clone();
        caches.open(CACHE_VERSION).then(function(cache) {
          cache.put(event.request, clone);
        });
        return response;
      }).catch(function() {
        return caches.match(event.request);
      })
    );
    return;
  }

  // ── CSS/JS/assets : Stale-While-Revalidate ──
  // Sert le cache immédiatement, met à jour en arrière-plan.
  event.respondWith(
    caches.match(event.request).then(function(cached) {
      var fetchPromise = fetch(event.request).then(function(response) {
        if (response && response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE_VERSION).then(function(cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(function() {});

      return cached || fetchPromise;
    })
  );
});
