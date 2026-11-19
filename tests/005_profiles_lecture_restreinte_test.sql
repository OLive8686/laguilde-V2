-- =============================================================================
-- TEST 005 — profiles : lecture restreinte (SQL, catalogue uniquement)
-- =============================================================================
-- LECTURE SEULE : une seule requête SELECT, aucune donnée modifiée. Utilisable en production,
-- après migrations/005_profiles_lecture_restreinte.sql. Résultat attendu : toutes les lignes ✅.
-- Contrôle complémentaire à faire hors SQL : un appel anonyme à l'API doit renvoyer 0 profil.
-- =============================================================================

WITH verifs (n, name, ok, detail) AS (
  SELECT 1, 'plus aucune règle SELECT à condition « true » sur profiles',
         NOT EXISTS (SELECT 1 FROM pg_policies
                     WHERE schemaname = 'public' AND tablename = 'profiles' AND cmd = 'SELECT' AND qual = 'true'),
         'attendu : aucune'
  UNION ALL
  SELECT 2, 'règle profiles_select_own_or_admin présente, réservée à authenticated',
         EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname = 'public' AND tablename = 'profiles'
                   AND policyname = 'profiles_select_own_or_admin' AND cmd = 'SELECT' AND roles = '{authenticated}'),
         'attendu : présente'
  UNION ALL
  SELECT 3, 'is_admin() refusée à anon',
         has_function_privilege('anon', 'public.is_admin()', 'EXECUTE') = false, 'attendu : refusé'
  UNION ALL
  SELECT 4, 'is_admin() autorisée à authenticated',
         has_function_privilege('authenticated', 'public.is_admin()', 'EXECUTE') = true, 'attendu : autorisé'
  UNION ALL
  SELECT 5, 'search_path fixé sur is_admin',
         p.proconfig IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'),
         COALESCE(array_to_string(p.proconfig, ', '), 'aucun')
  FROM pg_proc p WHERE p.proname = 'is_admin' AND p.pronamespace = 'public'::regnamespace
)
SELECT CASE WHEN ok THEN '✅ OK' ELSE '❌ ÉCHEC' END AS resultat, name, detail
FROM verifs ORDER BY n, name;
