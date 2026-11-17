-- =============================================================================
-- RETOUR ARRIÈRE 002 — à n'utiliser qu'en dernier recours
-- =============================================================================
-- ⚠ Revenir en arrière RÉOUVRE la faille : n'importe qui pourrait annuler les
-- inscriptions de n'importe qui en connaissant son e-mail. À ne faire que si
-- le contrôle d'identité bloque un usage légitime, et seulement le temps de
-- corriger.
--
-- Ce fichier rétablit les DROITS d'avant migration. Il ne restaure pas l'ancien
-- CORPS d'annuler_presence (sans contrôle) : si vraiment nécessaire, récupérez-le
-- dans l'historique Git (commit d'avant la migration) :
--     git show b9f180c:presences.sql
-- et exécutez uniquement la section « 5. FONCTION RPC : annuler_presence ».
-- =============================================================================

GRANT EXECUTE ON FUNCTION annuler_presence(TEXT, TEXT, TEXT) TO PUBLIC;
GRANT EXECUTE ON FUNCTION ensure_presence(TEXT, TEXT, TEXT, TEXT, TEXT) TO PUBLIC;

ALTER FUNCTION annuler_presence(TEXT, TEXT, TEXT) RESET search_path;
ALTER FUNCTION ensure_presence(TEXT, TEXT, TEXT, TEXT, TEXT) RESET search_path;
