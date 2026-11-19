-- =============================================================================
-- TEST 003 (production) — send_recap_email : droits, identité et journal d'envoi
-- =============================================================================
-- LECTURE SEULE : une seule requête SELECT sur le catalogue, aucune donnée créée ni modifiée.
-- Utilisable en production, après migrations/003_send_recap_email_lockdown.sql.
-- (La version avec fausses données et ROLLBACK est dans
--  003_send_recap_email_test_projet_de_test.sql : projet de TEST uniquement.)
-- Résultat attendu : toutes les lignes avec ✅.
-- =============================================================================

WITH verifs (n, name, ok, detail) AS (
  SELECT 1, 'send_recap_email refusée à anon',
         has_function_privilege('anon', 'send_recap_email(text)', 'EXECUTE') = false, 'attendu : refusé'
  UNION ALL
  SELECT 2, 'send_recap_email autorisée à authenticated',
         has_function_privilege('authenticated', 'send_recap_email(text)', 'EXECUTE') = true, 'attendu : autorisé'
  UNION ALL
  SELECT 3, 'search_path fixé sur send_recap_email',
         p.proconfig IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'),
         COALESCE(array_to_string(p.proconfig, ', '), 'aucun')
  FROM pg_proc p
  WHERE p.proname = 'send_recap_email' AND p.pronamespace = 'public'::regnamespace
  UNION ALL
  SELECT 4, 'send_recap_email lit l''identité dans le JWT',
         position('auth.jwt()' IN pg_get_functiondef('send_recap_email(text)'::regprocedure)) > 0,
         'le code contient auth.jwt()'
  UNION ALL
  SELECT 5, 'recap_email_log : aucun droit direct pour ' || r,
         has_table_privilege(r, 'public.recap_email_log', 'SELECT') = false
         AND has_table_privilege(r, 'public.recap_email_log', 'INSERT') = false,
         'attendu : aucun accès'
  FROM (VALUES ('anon'), ('authenticated')) AS roles(r)
)
SELECT CASE WHEN ok THEN '✅ OK' ELSE '❌ ÉCHEC' END AS resultat, name, detail
FROM verifs ORDER BY n, name;
