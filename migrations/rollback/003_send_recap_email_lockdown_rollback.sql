-- =============================================================================
-- RETOUR ARRIÈRE 003 — à n'utiliser qu'en dernier recours
-- =============================================================================
-- ⚠ Revenir en arrière RÉOUVRE la faille : n'importe qui pourrait déclencher un
-- récap vers n'importe quelle adresse (spam depuis le domaine du site).
--
-- Ce fichier rétablit les DROITS d'avant migration. Il ne restaure pas l'ancien
-- CORPS de send_recap_email (sans contrôle d'identité ni rate-limit) : si
-- vraiment nécessaire, récupérez-le dans l'historique Git :
--     git show b9f180c:email-triggers.sql
-- et exécutez uniquement la section « FONCTION RPC : Envoi de récap à la demande ».
-- =============================================================================

GRANT EXECUTE ON FUNCTION send_recap_email(TEXT) TO PUBLIC;
ALTER FUNCTION send_recap_email(TEXT) RESET search_path;

-- La table recap_email_log est conservée (inoffensive, inaccessible depuis l'API).
-- Pour la supprimer aussi : DROP TABLE IF EXISTS recap_email_log;
