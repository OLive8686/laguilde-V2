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
const CACHE_TTL = {
  'get_all_public': 60,    // Données principales : 60s
  'get_programme': 60,
  'get_inscriptions': 30,
  'get_postes_benevoles': 30,
  'get_sheet': 300,         // Config, restauration, animations : 5 min
  'get_role': 10,
  'check_email': 10,
  'ping': 0,                // Jamais caché
};

// ── Headers CORS ──
// Autorise les requêtes depuis GitHub Pages et localhost (dev)
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env, ctx) {
    // Gérer les requêtes preflight CORS (OPTIONS)
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
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
            ...CORS_HEADERS,
          },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: 'Erreur proxy POST' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
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
          ...CORS_HEADERS,
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
          ...CORS_HEADERS,
        },
      });

      // Mettre en cache (ne pas bloquer la réponse)
      ctx.waitUntil(cache.put(cacheRequest, response.clone()));

      return response;
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Erreur proxy GET' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }
  },
};

// ── Proxy direct vers GAS (sans cache) ──
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
        ...CORS_HEADERS,
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Erreur proxy' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }
}
