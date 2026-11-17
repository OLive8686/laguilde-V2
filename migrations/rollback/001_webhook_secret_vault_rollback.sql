-- =============================================================================
-- RETOUR ARRIÈRE 001 — à n'utiliser qu'en dernier recours
-- =============================================================================
-- ⚠ L'ancien secret est COMPROMIS (il a été public dans l'historique Git).
-- Préférez corriger vers l'avant (ex. secret Vault manquant → le recréer)
-- plutôt que de revenir en arrière.
--
-- Ce rollback ne contient volontairement PAS l'ancienne valeur : un secret ne
-- doit pas être réécrit dans un fichier versionné. Il rétablit seulement :
--   - la lecture du secret depuis Vault (comportement conservé),
--   - les droits d'exécution d'origine (PUBLIC) sur send_email_via_worker.
-- Si vous voulez vraiment un secret écrit dans la fonction, remplacez
-- get_webhook_secret() ci-dessous à la main DANS L'ÉDITEUR SQL (sans enregistrer
-- le fichier), puis jetez la requête.
-- =============================================================================

-- Rouvre l'accès à la fonction d'envoi (état d'avant migration : DANGEREUX).
GRANT EXECUTE ON FUNCTION send_email_via_worker(TEXT, TEXT, JSONB) TO PUBLIC;

-- Retire le search_path imposé (état d'avant migration).
ALTER FUNCTION send_email_via_worker(TEXT, TEXT, JSONB) RESET search_path;

-- get_webhook_secret() est conservée (inoffensive : droits propriétaire seul).
-- Pour la supprimer aussi : DROP FUNCTION IF EXISTS get_webhook_secret();
