-- =============================================================================
-- TEST 002 — annuler_presence : un utilisateur ne peut agir que sur ses données
-- =============================================================================
-- ⚠ PROJET SUPABASE DE TEST UNIQUEMENT. Prérequis : migration 002 appliquée.
-- Tout est annulé par le ROLLBACK final (aucune donnée conservée). Aucun e-mail
-- réel ne doit partir : pg_net n'envoie qu'après un COMMIT (hypothèse à confirmer
-- sur le projet de test ; le test d'envoi réel est tests/trigger_email_live_test.sql).
-- Adresses de test en @test.invalid (domaine réservé, jamais livrable).
-- Si une colonne NOT NULL manque dans les INSERT ci-dessous, ajustez-les au schéma.
--
-- Personnages : A = a@test.invalid, B = b@test.invalid.
-- Simulation d'un utilisateur connecté : on prend le rôle « authenticated » et on
-- pose les « claims » du JWT, comme le fait l'API Supabase (PostgREST).
-- =============================================================================

BEGIN;

CREATE TEMP TABLE test_results (n SERIAL, name TEXT, ok BOOLEAN, detail TEXT);

CREATE FUNCTION pg_temp.rec(p_name TEXT, p_ok BOOLEAN, p_detail TEXT DEFAULT '') RETURNS VOID
LANGUAGE sql AS $$ INSERT INTO pg_temp.test_results (name, ok, detail) VALUES (p_name, p_ok, p_detail) $$;

-- Appelle annuler_presence sous un rôle et un JWT donnés, puis revient au propriétaire.
-- Renvoie {"denied": true} si l'exécution est refusée (permission denied).
CREATE FUNCTION pg_temp.call_annuler(p_role TEXT, p_claims TEXT, p_email TEXT, p_jour TEXT)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v JSONB;
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims, true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  v := public.annuler_presence(p_email, p_jour, NULL);
  RESET ROLE;
  RETURN v;
EXCEPTION WHEN insufficient_privilege THEN
  RETURN jsonb_build_object('denied', true);
END $$;

-- ── Données de test (insérées en tant que propriétaire) ──
INSERT INTO inscriptions (email, nom, jeu, creneau, statut) VALUES
  ('a@test.invalid', 'Alice', 'Jeu Test A1', 'Samedi 10h-13h',   'inscrit'),
  ('a@test.invalid', 'Alice', 'Jeu Test A2', 'Dimanche 10h-13h', 'inscrit'),
  ('b@test.invalid', 'Bob',   'Jeu Test B1', 'Samedi 10h-13h',   'inscrit');
-- Présences (les triggers les créent normalement ; DO NOTHING si déjà là)
INSERT INTO presences (email, nom, jour, type_inscrit) VALUES
  ('a@test.invalid', 'Alice', 'samedi',   'principal'),
  ('a@test.invalid', 'Alice', 'dimanche', 'principal'),
  ('b@test.invalid', 'Bob',   'samedi',   'principal')
ON CONFLICT DO NOTHING;

-- ── 1. Matrice des droits ──
SELECT pg_temp.rec('droits annuler_presence : anon refusé',
  has_function_privilege('anon', 'annuler_presence(text,text,text)', 'EXECUTE') = false);
SELECT pg_temp.rec('droits annuler_presence : authenticated autorisé',
  has_function_privilege('authenticated', 'annuler_presence(text,text,text)', 'EXECUTE') = true);
SELECT pg_temp.rec('droits ensure_presence : anon refusé',
  has_function_privilege('anon', 'ensure_presence(text,text,text,text,text)', 'EXECUTE') = false);
SELECT pg_temp.rec('droits ensure_presence : authenticated refusé',
  has_function_privilege('authenticated', 'ensure_presence(text,text,text,text,text)', 'EXECUTE') = false);

DO $$
DECLARE
  claims_a       CONSTANT TEXT := '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000000a","email":"a@test.invalid"}';
  claims_noemail CONSTANT TEXT := '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000000c"}';
  r JSONB;
  v_n INT;
BEGIN
  -- ── 2. anon est refusé ──
  r := pg_temp.call_annuler('anon', '{"role":"anon"}', 'b@test.invalid', 'samedi');
  PERFORM pg_temp.rec('anon : appel refusé (permission denied)', COALESCE((r->>'denied')::boolean, false), r::text);

  -- ── 3. A vise B : refusé, et B est intact ──
  r := pg_temp.call_annuler('authenticated', claims_a, 'b@test.invalid', 'samedi');
  PERFORM pg_temp.rec('A sur B : réponse = erreur', jsonb_exists(r, 'error') AND NOT jsonb_exists(r, 'ok'), r::text);
  SELECT count(*) INTO v_n FROM inscriptions WHERE email='b@test.invalid' AND statut='inscrit';
  PERFORM pg_temp.rec('A sur B : inscription de B intacte', v_n = 1, 'inscriptions B actives = ' || v_n);
  SELECT count(*) INTO v_n FROM presences WHERE email='b@test.invalid' AND jour='samedi';
  PERFORM pg_temp.rec('A sur B : présence de B intacte', v_n = 1, 'présences B samedi = ' || v_n);

  -- ── 4. p_email vide ou NULL : refusé, rien ne bouge ──
  r := pg_temp.call_annuler('authenticated', claims_a, NULL, 'samedi');
  PERFORM pg_temp.rec('A avec p_email NULL : erreur', jsonb_exists(r, 'error'), r::text);
  r := pg_temp.call_annuler('authenticated', claims_a, '', 'samedi');
  PERFORM pg_temp.rec('A avec p_email vide : erreur', jsonb_exists(r, 'error'), r::text);
  SELECT count(*) INTO v_n FROM inscriptions WHERE email IN ('a@test.invalid','b@test.invalid') AND statut='inscrit';
  PERFORM pg_temp.rec('rien n''a bougé après les refus', v_n = 3, 'inscriptions actives = ' || v_n || ' (attendu 3)');

  -- ── 5. Compte SSO sans e-mail (claim absent / null / vide / espaces) ──
  r := pg_temp.call_annuler('authenticated', claims_noemail, 'b@test.invalid', 'samedi');
  PERFORM pg_temp.rec('JWT sans claim e-mail : refusé', jsonb_exists(r, 'error') AND (r->>'error') LIKE 'Aucune adresse e-mail%', r::text);
  r := pg_temp.call_annuler('authenticated', '{"role":"authenticated","email":null}', 'b@test.invalid', 'samedi');
  PERFORM pg_temp.rec('JWT e-mail null : refusé', jsonb_exists(r, 'error'), r::text);
  r := pg_temp.call_annuler('authenticated', '{"role":"authenticated","email":""}', '', 'samedi');
  PERFORM pg_temp.rec('JWT e-mail vide + p_email vide : refusé (pas de « vide = vide »)', jsonb_exists(r, 'error'), r::text);
  r := pg_temp.call_annuler('authenticated', '{"role":"authenticated","email":"   "}', '   ', 'samedi');
  PERFORM pg_temp.rec('JWT e-mail en espaces + p_email en espaces : refusé', jsonb_exists(r, 'error'), r::text);
  SELECT count(*) INTO v_n FROM inscriptions WHERE email IN ('a@test.invalid','b@test.invalid') AND statut='inscrit';
  PERFORM pg_temp.rec('comptes sans e-mail : aucune donnée touchée', v_n = 3, 'inscriptions actives = ' || v_n);

  -- ── 6. A sur ses propres données, casse et espaces tolérés (lower(trim())) ──
  r := pg_temp.call_annuler('authenticated', claims_a, '  A@Test.INVALID ', 'samedi');
  PERFORM pg_temp.rec('A sur A (casse/espaces) : accepté', COALESCE((r->>'ok')::boolean, false), r::text);
  SELECT count(*) INTO v_n FROM inscriptions WHERE email='a@test.invalid' AND jeu='Jeu Test A1' AND statut='annulé';
  PERFORM pg_temp.rec('A sur A : inscription du samedi annulée', v_n = 1);
  SELECT count(*) INTO v_n FROM inscriptions WHERE email='a@test.invalid' AND jeu='Jeu Test A2' AND statut='inscrit';
  PERFORM pg_temp.rec('A sur A : inscription du dimanche conservée', v_n = 1);
  SELECT count(*) INTO v_n FROM inscriptions WHERE email='b@test.invalid' AND statut='inscrit';
  PERFORM pg_temp.rec('A sur A : B toujours intact', v_n = 1);

  -- ── 7. JWT avec e-mail en majuscules (cas SSO) : même personne ──
  r := pg_temp.call_annuler('authenticated',
         '{"role":"authenticated","email":"B@TEST.invalid"}', 'b@test.invalid', 'samedi');
  PERFORM pg_temp.rec('JWT en majuscules = même utilisateur', COALESCE((r->>'ok')::boolean, false), r::text);
END $$;

-- ── 8. Le REVOKE sur ensure_presence ne casse PAS les triggers ──
-- A (connecté) s'inscrit à une table : le trigger (SECURITY DEFINER) doit créer la
-- présence en appelant ensure_presence avec les droits du propriétaire.
-- ⚠ Dépend de la RLS de la table inscriptions : si l'INSERT est refusé, c'est la
-- RLS (pas ce correctif) ; la colonne « detail » l'indique.
DO $$
DECLARE v_n INT; v_err TEXT;
BEGIN
  DELETE FROM presences WHERE email='a@test.invalid' AND jour='samedi';
  BEGIN
    PERFORM set_config('request.jwt.claims',
      '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000000a","email":"a@test.invalid"}', true);
    SET LOCAL ROLE authenticated;
    INSERT INTO inscriptions (email, nom, jeu, creneau, statut)
      VALUES ('a@test.invalid', 'Alice', 'Jeu Test A3', 'Samedi 14h-17h', 'inscrit');
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  SELECT count(*) INTO v_n FROM presences WHERE email='a@test.invalid' AND jour='samedi';
  PERFORM pg_temp.rec('trigger de présence fonctionne après le REVOKE', v_n = 1,
    COALESCE('INSERT refusé : ' || v_err, 'présence créée par le trigger'));
END $$;

SELECT n, CASE WHEN ok THEN '✅ OK' ELSE '❌ ÉCHEC' END AS resultat, name, detail
FROM test_results ORDER BY n;

ROLLBACK;
