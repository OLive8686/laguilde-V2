// =============================================================================
// CLOUDFLARE WORKER — Keep-alive Supabase (empêche la mise en sommeil)
// =============================================================================
// Le plan gratuit Supabase pause le projet après 7 jours sans requête.
// Ce Worker fait un ping toutes les 4 minutes via un cron trigger.
//
// Déployé sur : melusineapi.olivier-gramain.workers.dev
// Cron : */4 * * * * (toutes les 4 minutes)
// =============================================================================

export default {
  async fetch(request) {
    return new Response(JSON.stringify({ ok: true, message: 'Mélusine keep-alive' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  },

  async scheduled(event, env, ctx) {
    // Ping Supabase pour éviter la mise en sommeil du plan gratuit
    await fetch('https://hdbhvwaemrjoantcecuv.supabase.co/rest/v1/config?select=cle&limit=1', {
      headers: { 'apikey': 'sb_publishable_YGImet9fG8OKLDf_H0GNyQ_SmY5Mo56' }
    });
  }
};
