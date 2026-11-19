-- =============================================================================
-- TEST 004 — profiles : seule la colonne « nom » est modifiable par l'API
-- =============================================================================
-- LECTURE SEULE : une seule requête SELECT sur le catalogue, aucune donnée modifiée.
-- Utilisable en production, après migrations/004_profiles_role_verrouille.sql.
-- Résultat attendu : toutes les lignes avec ✅.
-- =============================================================================

WITH verifs (n, name, ok, detail) AS (
  SELECT 1, 'UPDATE ' || c || ' refusé à ' || r,
         has_column_privilege(r, 'public.profiles', c, 'UPDATE') = false,
         'attendu : refusé'
  FROM (VALUES ('role'), ('email'), ('id'), ('auth_type'), ('created_at')) AS cols(c)
  CROSS JOIN (VALUES ('anon'), ('authenticated')) AS roles(r)
  UNION ALL
  SELECT 2, 'UPDATE nom refusé à anon',
         has_column_privilege('anon', 'public.profiles', 'nom', 'UPDATE') = false, 'attendu : refusé'
  UNION ALL
  SELECT 3, 'UPDATE nom autorisé à authenticated (changement de pseudo)',
         has_column_privilege('authenticated', 'public.profiles', 'nom', 'UPDATE') = true, 'attendu : autorisé'
)
SELECT CASE WHEN ok THEN '✅ OK' ELSE '❌ ÉCHEC' END AS resultat, name, detail
FROM verifs ORDER BY n, name;
