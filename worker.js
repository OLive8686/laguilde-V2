// =============================================================================
// CLOUDFLARE WORKER — Proxy cache pour Google Apps Script
// =============================================================================
// Ce Worker se place entre le frontend et Google Apps Script.
// Il cache les réponses GET (get_all_public, etc.) pendant 60 secondes
// au niveau mondial (edge Cloudflare) pour un temps de réponse ~50ms.
// Les requêtes POST (inscriptions, annulations) passent directement à GAS.
//
// DÉPLOIEMENT :
//   1. Créer un Worker sur dash.cloudflare.com → Workers & Pages → Create
//   2. Coller ce code dans l'éditeur du Worker
//   3. Remplacer GAS_URL ci-dessous par l'URL de déploiement Apps Script
//   4. Dans app.js, remplacer SCRIPT_URL par l'URL du Worker
//
// CACHE :
//   - GET get_all_public : 60 secondes
//   - GET ping : pas caché (keep-alive)
//   - GET autres : 30 secondes
//   - POST : jamais caché (passe directement à GAS)
//
// CORS :
//   Le Worker gère les headers CORS (Access-Control-Allow-Origin)
//   pour éviter les problèmes de cross-origin avec GitHub Pages.
// =============================================================================

// ── URL de ton déploiement Google Apps Script ──
// REMPLACE cette URL par la tienne (celle dans app.js actuellement)
const GAS_URL = 'https://script.google.com/macros/s/AKfycby01lYf4lSk5Du1Bx1eJp1W5vXyhH-sFL_DbtY5PPBSYA5veBJiLQnNbFvubxN8TIZq/exec';

// ── Durée de cache par action (en secondes) ──
// TTL élevé (5 min) car le cron scheduled() pré-chauffe le cache toutes les 4 min.
// Le cache n'expire donc jamais en pratique → tout le monde a ~50ms.
// L'utilisateur qui vient de s'inscrire voit le résultat via le retour POST (pas via le cache).
const CACHE_TTL = {
  'get_all_public': 300,    // Données principales : 5 min (rafraîchi par cron)
  'get_programme': 300,
  'get_inscriptions': 300,
  'get_postes_benevoles': 300,
  'get_sheet': 300,         // Config, restauration, animations : 5 min
  'get_role': 30,
  'check_email': 30,
  'ping': 0,                // Jamais caché
};

// ── Headers CORS ──
// Restreint aux origines autorisées (GitHub Pages du projet)
// Sécurité : empêche un site tiers d'appeler l'API au nom d'un visiteur
const ALLOWED_ORIGINS = [
  'https://olive8686.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];

function getCorsHeaders(request) {
  var origin = request.headers.get('Origin') || '';
  var allowedOrigin = ALLOWED_ORIGINS.indexOf(origin) !== -1 ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

export default {
  async fetch(request, env, ctx) {
    // Gérer les requêtes preflight CORS (OPTIONS)
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: getCorsHeaders(request) });
    }

    // ── POST : passe directement à GAS (pas de cache) ──
    if (request.method === 'POST') {
      try {
        const body = await request.text();
        const gasResponse = await fetch(GAS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: body,
          redirect: 'follow',
        });
        const data = await gasResponse.text();
        return new Response(data, {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            ...getCorsHeaders(request),
          },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: 'Erreur proxy POST' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) },
        });
      }
    }

    // ── GET : cache Cloudflare ──
    const url = new URL(request.url);
    const action = url.searchParams.get('action') || '';

    // Déterminer le TTL pour cette action
    const ttl = CACHE_TTL[action] !== undefined ? CACHE_TTL[action] : 30;

    // Si TTL = 0, pas de cache (ping)
    if (ttl === 0) {
      return proxyToGAS(url, request);
    }

    // Construire l'URL GAS avec les mêmes paramètres
    const gasUrl = new URL(GAS_URL);
    url.searchParams.forEach((value, key) => {
      gasUrl.searchParams.set(key, value);
    });
    const cacheKey = gasUrl.toString();

    // Vérifier le cache Cloudflare
    const cache = caches.default;
    const cacheRequest = new Request(cacheKey);
    let response = await cache.match(cacheRequest);

    if (response) {
      // Cache hit → retourner avec headers CORS
      const cachedBody = await response.text();
      return new Response(cachedBody, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Cache': 'HIT',
          ...getCorsHeaders(request),
        },
      });
    }

    // Cache miss → appeler GAS
    try {
      const gasResponse = await fetch(gasUrl.toString(), { redirect: 'follow' });
      const data = await gasResponse.text();

      // Construire la réponse avec cache-control
      response = new Response(data, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 's-maxage=' + ttl,
          'X-Cache': 'MISS',
          ...getCorsHeaders(request),
        },
      });

      // Mettre en cache (ne pas bloquer la réponse)
      ctx.waitUntil(cache.put(cacheRequest, response.clone()));

      return response;
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Erreur proxy GET' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) },
      });
    }
  },

  // Handler cron : appelé par le trigger Cloudflare toutes les 4 minutes
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduled(event));
  },
};

// ── Cron : pré-chauffage du cache toutes les 4 minutes ──────────────────────
// Configuré dans Cloudflare : Workers → melusineapi → Settings → Triggers → Cron
// Expression : */4 * * * * (toutes les 4 minutes)
// Ce handler appelle get_all_public via GAS et met la réponse en cache.
// Résultat : le cache n'expire jamais → tous les visiteurs ont ~50ms.
async function handleScheduled(event) {
  try {
    const gasUrl = new URL(GAS_URL);
    gasUrl.searchParams.set('action', 'get_all_public');
    const gasResponse = await fetch(gasUrl.toString(), { redirect: 'follow' });
    const data = await gasResponse.text();

    // Mettre en cache avec le même TTL que les requêtes normales
    const cache = caches.default;
    const cacheRequest = new Request(gasUrl.toString());
    const response = new Response(data, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 's-maxage=300',
        'X-Cache': 'CRON',
      },
    });
    await cache.put(cacheRequest, response);
  } catch (err) {
    // Silencieux — le cron réessaiera dans 4 min
  }
}

// ── Proxy direct vers GAS (sans cache) ──
// request est passé pour extraire l'Origin et générer les headers CORS
async function proxyToGAS(url, request) {
  try {
    const gasUrl = new URL(GAS_URL);
    url.searchParams.forEach((value, key) => {
      gasUrl.searchParams.set(key, value);
    });
    const gasResponse = await fetch(gasUrl.toString(), { redirect: 'follow' });
    const data = await gasResponse.text();
    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...getCorsHeaders(request),
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Erreur proxy' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) },
    });
  }
}
