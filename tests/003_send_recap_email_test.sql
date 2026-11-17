-- =============================================================================
-- TEST 003 — send_recap_email : identité, rate-limit, droits
-- =============================================================================
-- ⚠ PROJET SUPABASE DE TEST UNIQUEMENT. Prérequis : migrations 001 et 003
-- appliquées (le récap appelle send_email_via_worker, donc le secret Vault).
-- Tout est annulé par le ROLLBACK final. Adresses en @test.invalid.
-- Si une colonne NOT NULL manque dans les INSERT, ajustez-les au schéma.
-- (L'envoi RÉEL d'un récap est testé dans tests/trigger_email_live_test.sql.)
-- =============================================================================

BEGIN;

CREATE TEMP TABLE test_results (n SERIAL, name TEXT, ok BOOLEAN, detail TEXT);

CREATE FUNCTION pg_temp.rec(p_name TEXT, p_ok BOOLEAN, p_detail TEXT DEFAULT '') RETURNS VOID
LANGUAGE sql AS $$ INSERT INTO pg_temp.test_results (name, ok, detail) VALUES (p_name, p_ok, p_detail) $$;

-- Appelle send_recap_email sous un rôle et un JWT donnés, puis revient au propriétaire.
-- Renvoie {"denied": true} si l'exécution est refusée (permission denied).
CREATE FUNCTION pg_temp.call_recap(p_role TEXT, p_claims TEXT, p_email TEXT)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v JSONB;
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  v := public.send_recap_email(p_email);
  RESET ROLE;
  RETURN v;
EXCEPTION WHEN insufficient_privilege THEN
  RETURN jsonb_build_object('denied', true);
END $$;

-- ── Données de test ──
INSERT INTO inscriptions (email, nom, jeu, creneau, statut) VALUES
  ('a@test.invalid', 'Alice', 'Jeu Test A1', 'Samedi 10h-13h', 'inscrit'),
  ('b@test.invalid', 'Bob',   'Jeu Test B1', 'Samedi 10h-13h', 'inscrit');
-- C n'a aucune inscription (pour tester « rien à envoyer »)

-- ── 1. Droits ──
SELECT pg_temp.rec('droits send_recap_email : anon refusé',
  has_function_privilege('anon', 'send_recap_email(text)', 'EXECUTE') = false);
SELECT pg_temp.rec('droits send_recap_email : authenticated autorisé',
  has_function_privilege('authenticated', 'send_recap_email(text)', 'EXECUTE') = true);
SELECT pg_temp.rec('recap_email_log : anon sans accès',
  NOT has_table_privilege('anon', 'recap_email_log', 'SELECT,INSERT,UPDATE,DELETE'));
SELECT pg_temp.rec('recap_email_log : authenticated sans accès',
  NOT has_table_privilege('authenticated', 'recap_email_log', 'SELECT,INSERT,UPDATE,DELETE'));
SELECT pg_temp.rec('recap_email_log : RLS activée',
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.recap_email_log'::regclass));

DO $$
DECLARE
  claims_a       CONSTANT TEXT := '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000000a","email":"a@test.invalid"}';
  claims_c       CONSTANT TEXT := '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000000c","email":"c@test.invalid"}';
  claims_noemail CONSTANT TEXT := '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000dd"}';
  r JSONB;
  v_n INT;
BEGIN
  -- ── 2. anon refusé ──
  r := pg_temp.call_recap('anon', '{"role":"anon"}', 'a@test.invalid');
  PERFORM pg_temp.rec('anon : appel refusé (permission denied)', COALESCE((r->>'denied')::boolean, false), r::text);

  -- ── 3. A demande le récap de B : refusé, aucune trace ──
  r := pg_temp.call_recap('authenticated', claims_a, 'b@test.invalid');
  PERFORM pg_temp.rec('A pour B : erreur', jsonb_exists(r, 'error') AND NOT jsonb_exists(r, 'ok'), r::text);
  SELECT count(*) INTO v_n FROM recap_email_log;
  PERFORM pg_temp.rec('A pour B : aucun créneau de rate-limit consommé', v_n = 0, 'lignes recap_email_log = ' || v_n);

  -- ── 4. p_email NULL / vide : refusé ──
  r := pg_temp.call_recap('authenticated', claims_a, NULL);
  PERFORM pg_temp.rec('A avec e-mail NULL : erreur', jsonb_exists(r, 'error'), r::text);
  r := pg_temp.call_recap('authenticated', claims_a, '');
  PERFORM pg_temp.rec('A avec e-mail vide : erreur', jsonb_exists(r, 'error'), r::text);

  -- ── 5. Compte SSO sans e-mail ──
  r := pg_temp.call_recap('authenticated', claims_noemail, 'b@test.invalid');
  PERFORM pg_temp.rec('JWT sans e-mail : refusé', jsonb_exists(r, 'error') AND (r->>'error') LIKE 'Aucune adresse e-mail%', r::text);
  r := pg_temp.call_recap('authenticated', '{"role":"authenticated","email":null}', 'b@test.invalid');
  PERFORM pg_temp.rec('JWT e-mail null : refusé', jsonb_exists(r, 'error'), r::text);
  r := pg_temp.call_recap('authenticated', '{"role":"authenticated","email":""}', '');
  PERFORM pg_temp.rec('JWT e-mail vide + paramètre vide : refusé', jsonb_exists(r, 'error'), r::text);
  r := pg_temp.call_recap('authenticated', '{"role":"authenticated","email":"   "}', '   ');
  PERFORM pg_temp.rec('JWT e-mail en espaces + paramètre en espaces : refusé', jsonb_exists(r, 'error'), r::text);
  SELECT count(*) INTO v_n FROM recap_email_log;
  PERFORM pg_temp.rec('comptes sans e-mail : aucun créneau consommé', v_n = 0, 'lignes = ' || v_n);

  -- ── 6. « Rien à envoyer » ne consomme pas le créneau ──
  r := pg_temp.call_recap('authenticated', claims_c, 'c@test.invalid');
  PERFORM pg_temp.rec('C sans inscription : erreur « aucune inscription »', jsonb_exists(r, 'error') AND (r->>'error') LIKE 'Aucune inscription%', r::text);
  SELECT count(*) INTO v_n FROM recap_email_log WHERE email = 'c@test.invalid';
  PERFORM pg_temp.rec('C sans inscription : créneau non consommé', v_n = 0);
  INSERT INTO inscriptions (email, nom, jeu, creneau, statut)
    VALUES ('c@test.invalid', 'Carole', 'Jeu Test C1', 'Samedi 10h-13h', 'inscrit');
  r := pg_temp.call_recap('authenticated', claims_c, 'c@test.invalid');
  PERFORM pg_temp.rec('C, une fois inscrite : récap accepté aussitôt', COALESCE((r->>'ok')::boolean, false), r::text);

  -- ── 7. A pour A (casse/espaces) : accepté, puis limité à 1 / 2 minutes ──
  r := pg_temp.call_recap('authenticated', claims_a, '  A@Test.INVALID ');
  PERFORM pg_temp.rec('A pour A (casse/espaces) : accepté', COALESCE((r->>'ok')::boolean, false), r::text);
  SELECT count(*) INTO v_n FROM recap_email_log WHERE email = 'a@test.invalid';
  PERFORM pg_temp.rec('A : créneau enregistré sous l''adresse normalisée', v_n = 1);

  r := pg_temp.call_recap('authenticated', claims_a, 'a@test.invalid');
  PERFORM pg_temp.rec('A, 2e demande immédiate : refusée (rate-limit)',
    jsonb_exists(r, 'error') AND (r->>'error') LIKE '%2 minutes%', r::text);

  -- Autre casse du même compte : même créneau, donc toujours refusé
  r := pg_temp.call_recap('authenticated',
         '{"role":"authenticated","email":"A@TEST.INVALID"}', 'A@test.invalid');
  PERFORM pg_temp.rec('A en majuscules : toujours limité (même adresse normalisée)', jsonb_exists(r, 'error'), r::text);

  -- Après 3 minutes (on antidate le dernier envoi, en tant que propriétaire)
  UPDATE recap_email_log SET last_sent_at = now() - interval '3 minutes' WHERE email = 'a@test.invalid';
  r := pg_temp.call_recap('authenticated', claims_a, 'a@test.invalid');
  PERFORM pg_temp.rec('A, après 3 minutes : de nouveau accepté', COALESCE((r->>'ok')::boolean, false), r::text);

  -- B n'est pas impacté par la limite de A
  r := pg_temp.call_recap('authenticated',
         '{"role":"authenticated","email":"b@test.invalid"}', 'b@test.invalid');
  PERFORM pg_temp.rec('B : limite indépendante de celle de A', COALESCE((r->>'ok')::boolean, false), r::text);
END $$;

SELECT n, CASE WHEN ok THEN '✅ OK' ELSE '❌ ÉCHEC' END AS resultat, name, detail
FROM test_results ORDER BY n;

ROLLBACK;
