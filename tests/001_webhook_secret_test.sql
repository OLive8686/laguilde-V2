-- =============================================================================
-- TEST 001 — Secret du webhook et verrouillage de send_email_via_worker
-- =============================================================================
-- LECTURE SEULE : une seule requête SELECT, aucune table créée, aucune donnée modifiée.
-- Utilisable en production. Prérequis : migrations/001_webhook_secret_vault.sql appliquée
-- et secret « melusine_webhook_secret » créé dans Vault.
--
-- Pourquoi une seule requête : l'éditeur SQL de Supabase peut découper un script en plusieurs
-- transactions ; une table temporaire créée au début a alors disparu avant l'affichage
-- (erreur « relation test_results does not exist » de la première version de ce test).
--
-- Résultat attendu : toutes les lignes avec ✅. Aucune valeur de secret n'est lue ni affichée
-- (seulement sa longueur). Si get_webhook_secret() n'existe pas, la requête s'arrête avec
-- une erreur « function does not exist » : la migration 001 n'est alors pas appliquée.
-- =============================================================================

WITH verifs (n, name, ok, detail) AS (

  -- 1. Droits d'exécution refusés à anon et authenticated (lecture du catalogue, aucune exécution)
  SELECT 1, 'droits ' || fn || ' pour ' || r,
         has_function_privilege(r, fn, 'EXECUTE') = false,
         'attendu : refusé'
  FROM (VALUES ('send_email_via_worker(text,text,jsonb)'), ('get_webhook_secret()')) AS f(fn)
  CROSS JOIN (VALUES ('anon'), ('authenticated')) AS roles(r)

  UNION ALL
  -- 2. Le secret existe dans Vault (on ne regarde QUE sa longueur)
  SELECT 2, 'secret présent dans Vault (≥ 32 caractères)',
         COALESCE(max(length(decrypted_secret)), 0) >= 32,
         'longueur = ' || COALESCE(max(length(decrypted_secret)), 0)
  FROM vault.decrypted_secrets
  WHERE name = 'melusine_webhook_secret'

  UNION ALL
  -- 3. Aucun secret en clair dans le code de la fonction, et elle passe par get_webhook_secret()
  SELECT 3, 'send_email_via_worker sans secret en clair',
         position('"X-Webhook-Secret": "' IN pg_get_functiondef('send_email_via_worker(text,text,jsonb)'::regprocedure)) = 0
         AND position('get_webhook_secret' IN pg_get_functiondef('send_email_via_worker(text,text,jsonb)'::regprocedure)) > 0,
         'le code appelle get_webhook_secret()'

  UNION ALL
  -- 4. search_path imposé sur les deux fonctions
  SELECT 4, 'search_path fixé sur ' || p.proname,
         p.proconfig IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'),
         COALESCE(array_to_string(p.proconfig, ', '), 'aucun')
  FROM pg_proc p
  WHERE p.proname IN ('send_email_via_worker', 'get_webhook_secret')
    AND p.pronamespace = 'public'::regnamespace
)
SELECT CASE WHEN ok THEN '✅ OK' ELSE '❌ ÉCHEC' END AS resultat, name, detail
FROM verifs
ORDER BY n, name;
