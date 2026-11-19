-- =============================================================================
-- TEST 002 (production) — annuler_presence / ensure_presence : droits et identité
-- =============================================================================
-- LECTURE SEULE : une seule requête SELECT sur le catalogue, aucune donnée créée ni modifiée.
-- Utilisable en production, après migrations/002_annuler_presence_lockdown.sql.
-- (La version qui insère de fausses données et annule par ROLLBACK est dans
--  002_annuler_presence_test_projet_de_test.sql : à ne lancer QUE sur un projet de test,
--  car l'éditeur SQL de Supabase peut découper un script et valider ces insertions.)
-- Résultat attendu : toutes les lignes avec ✅.
-- =============================================================================

WITH verifs (n, name, ok, detail) AS (
  SELECT 1, 'annuler_presence refusée à anon',
         has_function_privilege('anon', 'annuler_presence(text,text,text)', 'EXECUTE') = false, 'attendu : refusé'
  UNION ALL
  SELECT 2, 'annuler_presence autorisée à authenticated',
         has_function_privilege('authenticated', 'annuler_presence(text,text,text)', 'EXECUTE') = true, 'attendu : autorisé'
  UNION ALL
  SELECT 3, 'ensure_presence refusée à ' || r,
         has_function_privilege(r, 'ensure_presence(text,text,text,text,text)', 'EXECUTE') = false, 'attendu : refusé'
  FROM (VALUES ('anon'), ('authenticated')) AS roles(r)
  UNION ALL
  SELECT 4, 'search_path fixé sur ' || p.proname,
         p.proconfig IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'),
         COALESCE(array_to_string(p.proconfig, ', '), 'aucun')
  FROM pg_proc p
  WHERE p.proname IN ('annuler_presence', 'ensure_presence') AND p.pronamespace = 'public'::regnamespace
  UNION ALL
  SELECT 5, 'annuler_presence lit l''identité dans le JWT',
         position('auth.jwt()' IN pg_get_functiondef('annuler_presence(text,text,text)'::regprocedure)) > 0,
         'le code contient auth.jwt()'
)
SELECT CASE WHEN ok THEN '✅ OK' ELSE '❌ ÉCHEC' END AS resultat, name, detail
FROM verifs ORDER BY n, name;
