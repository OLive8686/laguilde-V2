-- =============================================================================
-- EMAIL DE RAPPEL J-3 — Sous l'Œil de Mélusine
-- =============================================================================
-- Ce fichier ajoute une fonction RPC qui envoie un email de rappel à toutes
-- les personnes inscrites à la convention (au moins une présence enregistrée).
-- Le mail contient leur récap personnel (tables, repas, bénévolat) et les
-- infos pratiques.
--
-- USAGE :
--   - Mode test (admin reçoit lui seul) :
--     supabase.rpc('send_reminders', { p_test_email: 'admin@example.com' })
--   - Mode production (envoi à tout le monde) :
--     supabase.rpc('send_reminders')
--
-- Réservée aux admins (vérification via la table profiles).
-- Idempotent : à exécuter dans Supabase SQL Editor.
--
-- DÉPENDANCES :
--   - send_email_via_worker (défini dans email-triggers.sql)
--   - Type 'rappel' supporté par le worker (worker-email.js)
-- =============================================================================

CREATE OR REPLACE FUNCTION send_reminders(p_test_email TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER  -- Bypasse RLS pour lire toutes les présences
AS $$
DECLARE
    v_caller_email TEXT;
    v_caller_role  TEXT;
    v_test_email   TEXT;
    v_count        INT := 0;
    v_user         RECORD;
    v_inscriptions JSONB;
    v_benevolats   JSONB;
    v_repas        JSONB;
    v_jours        JSONB;
    v_tables_mj    JSONB;
BEGIN
    -- ── 1. Vérifier que l'appelant est admin ──
    v_caller_email := lower(trim(coalesce(auth.jwt()->>'email', '')));
    IF v_caller_email = '' THEN
        RETURN jsonb_build_object('error', 'Non authentifié');
    END IF;

    SELECT role INTO v_caller_role
    FROM profiles
    WHERE lower(trim(email)) = v_caller_email;

    IF v_caller_role IS NULL OR v_caller_role != 'admin' THEN
        RETURN jsonb_build_object('error', 'Accès admin requis');
    END IF;

    -- Normaliser le test_email (mode test = un seul destinataire)
    v_test_email := lower(trim(coalesce(p_test_email, '')));

    -- ── 2. Itérer sur tous les utilisateurs présents à la convention ──
    -- DISTINCT car un utilisateur peut avoir 2 présences (samedi + dimanche)
    -- On ne prend que les principaux (pas les accompagnants — un seul mail
    -- est envoyé au compte parent qui contient déjà les info des accomp.)
    FOR v_user IN
        SELECT DISTINCT p.email, p.nom
        FROM presences p
        WHERE p.type_inscrit = 'principal'
          AND (v_test_email = '' OR lower(trim(p.email)) = v_test_email)
    LOOP
        -- Inscriptions actives (joueur principal + accompagnants)
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'jeu',              i.jeu,
            'creneau',          i.creneau,
            'statut',           i.statut,
            'nom_accompagnant', COALESCE(i.nom_accompagnant, '')
        )), '[]'::jsonb) INTO v_inscriptions
        FROM inscriptions i
        WHERE lower(trim(i.email)) = lower(trim(v_user.email))
          AND i.statut IN ('inscrit', 'attente');

        -- Bénévolats actifs
        BEGIN
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'creneau', b.creneau
            )), '[]'::jsonb) INTO v_benevolats
            FROM benevoles b
            WHERE lower(trim(b.email)) = lower(trim(v_user.email))
              AND b.statut = 'inscrit';
        EXCEPTION WHEN undefined_table THEN
            v_benevolats := '[]'::jsonb;
        END;

        -- Repas actifs
        BEGIN
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'nom_accompagnant', COALESCE(r.nom_accompagnant, '')
            )), '[]'::jsonb) INTO v_repas
            FROM repas r
            WHERE lower(trim(r.email)) = lower(trim(v_user.email))
              AND r.statut = 'inscrit';
        EXCEPTION WHEN undefined_table THEN
            v_repas := '[]'::jsonb;
        END;

        -- Tables proposées en tant que MJ (statut validé ou en_attente)
        -- Exclut les refusées car elles ne se tiendront pas le jour J.
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'jeu',          pr.jeu,
            'creneau',      pr.creneau,
            'statut_table', pr.statut_table
        )), '[]'::jsonb) INTO v_tables_mj
        FROM programme pr
        WHERE lower(trim(pr.email_mj)) = lower(trim(v_user.email))
          AND COALESCE(pr.statut_table, '') != 'refusé';

        -- Jours de présence (samedi, dimanche, ou les deux)
        SELECT COALESCE(jsonb_agg(DISTINCT p.jour ORDER BY p.jour), '[]'::jsonb)
        INTO v_jours
        FROM presences p
        WHERE lower(trim(p.email)) = lower(trim(v_user.email))
          AND p.type_inscrit = 'principal';

        -- ── 3. Envoyer le mail (asynchrone, fire-and-forget) ──
        PERFORM send_email_via_worker(
            'rappel',
            v_user.email,
            jsonb_build_object(
                'nom',          v_user.nom,
                'jours',        v_jours,
                'tablesMJ',     v_tables_mj,
                'inscriptions', v_inscriptions,
                'benevolats',   v_benevolats,
                'repas',        v_repas
            )
        );
        v_count := v_count + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'ok',   true,
        'sent', v_count,
        'mode', CASE WHEN v_test_email = '' THEN 'production' ELSE 'test' END
    );
END;
$$;

COMMENT ON FUNCTION send_reminders(TEXT) IS
  'Envoie un email de rappel J-3 à toutes les personnes présentes à la '
  'convention. Mode test : passer p_test_email pour ne notifier qu''un seul '
  'destinataire. Réservée aux admins.';


-- =============================================================================
-- VÉRIFICATIONS POST-DÉPLOIEMENT
-- =============================================================================
--   -- 1. La fonction existe
--   SELECT proname FROM pg_proc WHERE proname = 'send_reminders';
--
--   -- 2. Test manuel (depuis le frontend, en tant qu'admin) :
--   --    await APP.supabase.rpc('send_reminders', { p_test_email: 'mon@email.com' });
--   --    → doit envoyer 1 email à mon@email.com et retourner { ok, sent: 1, mode: 'test' }
--
-- POUR DÉSINSTALLER :
--   DROP FUNCTION IF EXISTS send_reminders(TEXT);
-- =============================================================================
