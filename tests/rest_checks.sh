#!/usr/bin/env bash
# =============================================================================
# CONTRÔLE VIA L'API REST — ce qu'un visiteur anonyme peut (ne pas) appeler
# =============================================================================
# Teste la vraie porte d'entrée (/rest/v1/rpc/...), pas seulement la base :
# un visiteur sans compte envoie la clé publique (« anon ») et tente d'appeler
# chaque fonction sensible. Attendu : refus (HTTP 401 ou 403) pour toutes.
#
# ⚠ Projet de TEST. Aucune écriture n'est possible si le refus fonctionne ; si le
# verrouillage est cassé, les appels utilisent des adresses @example.invalid.
#
# Usage (Git Bash) :
#   export SUPABASE_URL="https://xxxx.supabase.co"      # projet de TEST
#   read -rs ANON_KEY; export ANON_KEY                  # clé publique (anon/publishable)
#   bash tests/rest_checks.sh
# =============================================================================
set -u
: "${SUPABASE_URL:?définir SUPABASE_URL}"
: "${ANON_KEY:?définir ANON_KEY}"

fail=0
# check <fonction> <corps JSON>
check() {
  local fn="$1" body="$2" code
  code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$SUPABASE_URL/rest/v1/rpc/$fn" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
    -H "Content-Type: application/json" -d "$body")
  if [ "$code" = "401" ] || [ "$code" = "403" ]; then
    echo "✅ $fn : refusé (HTTP $code)"
  else
    echo "❌ $fn : HTTP $code (attendu 401/403) — LA FONCTION EST APPELABLE PAR TOUT LE MONDE"
    fail=1
  fi
}

check send_email_via_worker '{"email_type":"confirmation","recipient":"verif@example.invalid","payload":{}}'
check get_webhook_secret    '{}'
check annuler_presence      '{"p_email":"a@example.invalid","p_jour":"samedi","p_nom_accompagnant":null}'
check ensure_presence       '{"p_email":"a@example.invalid","p_nom":"x","p_jour":"samedi","p_type_inscrit":"principal","p_nom_accompagnant":null}'

exit $fail
