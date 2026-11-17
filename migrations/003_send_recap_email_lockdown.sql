-- =============================================================================
-- MIGRATION 003 — send_recap_email : identité, rate-limit en base, droits
-- =============================================================================
-- Contenu (miroir de email-triggers.sql, qui reste le fichier source) :
--   1. Table recap_email_log (dernier envoi par e-mail), RLS sans policy et
--      droits retirés : inaccessible depuis l'API.
--   2. send_recap_email : l'e-mail du JWT est la seule référence ; user_email doit
--      lui être identique (lower(trim())), sinon erreur ; compte sans e-mail :
--      refusé ; 1 récap par adresse toutes les 2 minutes (INSERT … ON CONFLICT
--      atomique) ; SET search_path.
--   3. REVOKE EXECUTE FROM PUBLIC, anon ; GRANT EXECUTE TO authenticated.
--
-- Prérequis : migration 001 appliquée (send_email_via_worker lit le secret Vault).
-- ⚠ Dérive possible : si email-triggers.sql est modifié plus tard, mettre à jour
--   ce fichier aussi.
-- Retour arrière : migrations/rollback/003_send_recap_email_lockdown_rollback.sql
-- Rejouable : oui. Vérification : tests/003_send_recap_email_test.sql (projet de TEST).
-- =============================================================================

-- ── Dernier envoi de récap par e-mail (sert au rate-limit) ──
-- Une ligne par adresse. Inaccessible depuis l'API : RLS activée sans aucune
-- policy + droits de table retirés à anon/authenticated. Seule la fonction
-- SECURITY DEFINER ci-dessous l'écrit. Petite table : à vider avec les données
-- d'une édition (voir README, maintenance).
CREATE TABLE IF NOT EXISTS recap_email_log (
  email        TEXT PRIMARY KEY,                 -- adresse normalisée (lower/trim)
  last_sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE recap_email_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE recap_email_log FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION send_recap_email(user_email TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Données collectées pour le récap
  inscriptions_data JSONB;
  benevoles_data    JSONB;
  tables_mj_data    JSONB;
  clean_email       TEXT;
  v_caller_email    TEXT;
  v_slot_email      TEXT;
BEGIN
  -- ── Identité : l'e-mail du JWT est la référence, jamais le paramètre ──
  v_caller_email := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  IF v_caller_email = '' THEN
    -- Appel anonyme, ou compte SSO sans e-mail : on refuse.
    RETURN jsonb_build_object('error', 'Aucune adresse e-mail associée à votre session : action impossible');
  END IF;

  clean_email := lower(trim(coalesce(user_email, '')));

  -- On ne peut demander le récap que pour son propre compte.
  -- Message générique : on ne révèle rien sur l'adresse visée.
  IF clean_email <> v_caller_email THEN
    RETURN jsonb_build_object('error', 'Accès refusé : vous ne pouvez demander le récap que pour votre propre compte');
  END IF;

  IF position('@' IN clean_email) = 0 THEN
    RETURN jsonb_build_object('error', 'Email invalide');
  END IF;

  -- 1. Collecter les inscriptions (joueur + accompagnants)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'jeu',               i.jeu,
    'creneau',           i.creneau,
    'statut',            i.statut,
    'nom_accompagnant',  COALESCE(i.nom_accompagnant, '')
  )), '[]'::jsonb)
  INTO inscriptions_data
  FROM inscriptions i
  WHERE lower(trim(i.email)) = clean_email
    AND i.statut IN ('inscrit', 'attente');

  -- 2. Collecter les bénévolats
  -- Note : la table benevoles peut ne pas exister encore
  BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'creneau',           b.creneau,
      'nom_accompagnant',  COALESCE(b.nom_accompagnant, '')
    )), '[]'::jsonb)
    INTO benevoles_data
    FROM benevoles b
    WHERE lower(trim(b.email)) = clean_email
      AND b.statut = 'inscrit';
  EXCEPTION WHEN undefined_table THEN
    benevoles_data := '[]'::jsonb;
  END;

  -- 3. Collecter les tables MJ
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'jeu',           p.jeu,
    'creneau',       p.creneau,
    'statut_table',  p.statut_table
  )), '[]'::jsonb)
  INTO tables_mj_data
  FROM programme p
  WHERE lower(trim(p.email_mj)) = clean_email
    AND p.statut_table != 'refusé';

  -- Si rien du tout, ne pas envoyer
  IF inscriptions_data = '[]'::jsonb
     AND benevoles_data = '[]'::jsonb
     AND tables_mj_data = '[]'::jsonb THEN
    RETURN jsonb_build_object('error', 'Aucune inscription trouvée pour cet email.');
  END IF;

  -- ── Rate-limit : 1 récap par adresse toutes les 2 minutes ──
  -- Un seul INSERT … ON CONFLICT décide, de façon atomique (pas de course entre
  -- deux requêtes simultanées) : la ligne n'est mise à jour — et RETURNING ne
  -- renvoie quelque chose — que si le dernier envoi date de plus de 2 minutes.
  -- Placé APRÈS « rien à envoyer » : un essai à vide ne consomme pas le créneau.
  INSERT INTO recap_email_log AS rl (email, last_sent_at)
  VALUES (clean_email, now())
  ON CONFLICT (email) DO UPDATE
    SET last_sent_at = now()
    WHERE rl.last_sent_at <= now() - interval '2 minutes'
  RETURNING rl.email INTO v_slot_email;

  IF v_slot_email IS NULL THEN
    RETURN jsonb_build_object('error', 'Un récap a déjà été envoyé il y a moins de 2 minutes. Réessayez un peu plus tard.');
  END IF;

  -- 4. Envoyer le récap via le Worker
  PERFORM send_email_via_worker(
    'recap',
    clean_email,
    jsonb_build_object(
      'inscriptions', inscriptions_data,
      'benevoles',    benevoles_data,
      'tablesMJ',     tables_mj_data
    )
  );

  RETURN jsonb_build_object('ok', true, 'message', 'Récap envoyé à ' || clean_email || ' !');
END;
$$;

COMMENT ON FUNCTION send_recap_email(TEXT) IS
  'Envoie un email récapitulatif de toutes les inscriptions d''un utilisateur. '
  'Appelable via supabase.rpc(''send_recap_email'', { user_email: ''...'' }). '
  'user_email doit être l''e-mail de la session (JWT) ; 1 envoi par 2 minutes et par adresse.';

-- Droits d'exécution : utilisateurs connectés uniquement.
-- « anon » est nommé explicitement : Supabase lui accorde EXECUTE à part.
REVOKE ALL ON FUNCTION send_recap_email(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION send_recap_email(TEXT) TO authenticated;
