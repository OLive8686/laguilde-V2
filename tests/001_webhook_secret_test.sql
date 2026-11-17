-- =============================================================================
-- TEST 001 — Secret du webhook et verrouillage de send_email_via_worker
-- =============================================================================
-- ⚠ À EXÉCUTER SUR LE PROJET SUPABASE DE TEST, JAMAIS EN PRODUCTION.
-- Prérequis : migrations/001_webhook_secret_vault.sql appliquée, secret
-- « melusine_webhook_secret » créé dans Vault.
--
-- Fonctionnement : tout se passe dans une transaction terminée par ROLLBACK
-- (aucune donnée conservée). Les résultats sont lus dans une table temporaire et
-- affichés par le SELECT final : une ligne par vérification, ✅ ou ❌.
-- Aucune valeur de secret n'est lue ni affichée (seulement sa longueur).
-- =============================================================================

BEGIN;

CREATE TEMP TABLE test_results (n SERIAL, name TEXT, ok BOOLEAN, detail TEXT);

-- ── 1. Droits d'exécution (lecture du catalogue, aucune exécution) ──
INSERT INTO test_results (name, ok, detail)
SELECT 'droits ' || fn || ' pour ' || r,
       has_function_privilege(r, fn, 'EXECUTE') = false,
       'attendu : refusé'
FROM (VALUES ('send_email_via_worker(text,text,jsonb)'), ('get_webhook_secret()')) AS f(fn)
CROSS JOIN (VALUES ('anon'), ('authenticated')) AS roles(r);

-- ── 2. Appels réels refusés pour anon puis authenticated ──
DO $$
DECLARE
  v_role TEXT;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    -- send_email_via_worker
    BEGIN
      EXECUTE format('SET LOCAL ROLE %I', v_role);
      PERFORM send_email_via_worker('confirmation', 'verif@example.invalid', '{}'::jsonb);
      RESET ROLE;
      INSERT INTO pg_temp.test_results (name, ok, detail)
        VALUES ('appel send_email_via_worker par ' || v_role, false, 'ÉCHEC : l''appel a réussi');
    EXCEPTION WHEN insufficient_privilege THEN
      RESET ROLE;
      INSERT INTO pg_temp.test_results (name, ok, detail)
        VALUES ('appel send_email_via_worker par ' || v_role, true, 'refusé (permission denied)');
    END;

    -- get_webhook_secret
    BEGIN
      EXECUTE format('SET LOCAL ROLE %I', v_role);
      PERFORM get_webhook_secret();
      RESET ROLE;
      INSERT INTO pg_temp.test_results (name, ok, detail)
        VALUES ('appel get_webhook_secret par ' || v_role, false, 'ÉCHEC : l''appel a réussi');
    EXCEPTION WHEN insufficient_privilege THEN
      RESET ROLE;
      INSERT INTO pg_temp.test_results (name, ok, detail)
        VALUES ('appel get_webhook_secret par ' || v_role, true, 'refusé (permission denied)');
    END;
  END LOOP;
END $$;

-- ── 3. Le secret existe dans Vault (on ne regarde QUE sa longueur) ──
INSERT INTO test_results (name, ok, detail)
SELECT 'secret présent dans Vault (≥ 32 caractères)',
       COALESCE(max(length(decrypted_secret)), 0) >= 32,
       'longueur = ' || COALESCE(max(length(decrypted_secret)), 0)
FROM vault.decrypted_secrets
WHERE name = 'melusine_webhook_secret';

-- ── 4. Aucun secret en clair dans le code de la fonction ──
-- Si la fonction contenait encore le motif « "X-Webhook-Secret": " » (JSON
-- littéral avec une valeur), c'est que l'ancienne version est encore active.
INSERT INTO test_results (name, ok, detail)
SELECT 'send_email_via_worker sans secret en clair',
       position('"X-Webhook-Secret": "' IN pg_get_functiondef('send_email_via_worker(text,text,jsonb)'::regprocedure)) = 0
       AND position('get_webhook_secret' IN pg_get_functiondef('send_email_via_worker(text,text,jsonb)'::regprocedure)) > 0,
       'le code appelle get_webhook_secret()';

-- ── 5. search_path imposé ──
INSERT INTO test_results (name, ok, detail)
SELECT 'search_path fixé sur ' || p.proname,
       p.proconfig IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'),
       COALESCE(array_to_string(p.proconfig, ', '), 'aucun')
FROM pg_proc p
WHERE p.proname IN ('send_email_via_worker', 'get_webhook_secret')
  AND p.pronamespace = 'public'::regnamespace;

SELECT n, CASE WHEN ok THEN '✅ OK' ELSE '❌ ÉCHEC' END AS resultat, name, detail
FROM test_results ORDER BY n;

ROLLBACK;
