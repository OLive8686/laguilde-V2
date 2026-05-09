-- =============================================================================
-- EMAIL DE RAPPEL J-3 — Sous l'Œil de Mélusine
-- =============================================================================
-- Ce fichier ajoute une fonction RPC qui envoie un email de rappel à toutes
-- les personnes inscrites à la convention (au moins une présence enregistrée).
-- Le mail contient leur récap personnel (tables, repas, bénévolat) et les
-- infos pratiques.
--
-- USAGE :
--   - Mode test (admin reçoit lui seul, contenu basé sur ses propres inscriptions) :
--     supabase.rpc('send_reminders', { p_test_email: 'admin@example.com' })
--   - Mode preview (admin reçoit le mail tel qu'il serait envoyé à un autre inscrit) :
--     supabase.rpc('send_reminders', { p_preview_for_email: 'autre@example.com' })
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

-- Supprimer l'ancienne signature (TEXT) si elle existe.
-- Postgres considère que send_reminders(TEXT) et send_reminders(TEXT, TEXT)
-- sont deux fonctions différentes, donc CREATE OR REPLACE ne remplace pas
-- l'ancienne. Sans ce DROP, on aurait deux fonctions homonymes.
-- IF EXISTS rend l'opération idempotente (premier run ou re-run = OK).
DROP FUNCTION IF EXISTS send_reminders(TEXT);

CREATE OR REPLACE FUNCTION send_reminders(
    p_test_email        TEXT DEFAULT NULL,
    p_preview_for_email TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER  -- Bypasse RLS pour lire toutes les présences
AS $$
DECLARE
    v_caller_email   TEXT;
    v_caller_role    TEXT;
    v_test_email     TEXT;
    v_preview_email  TEXT;
    v_count          INT := 0;
    v_user           RECORD;
    v_inscriptions   JSONB;
    v_benevolats     JSONB;
    v_repas          JSONB;
    v_jours          JSONB;
    v_tables_mj      JSONB;
    -- Pour le mode preview : nom réel de la cible (pour afficher dans le payload)
    v_target_nom     TEXT;
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

    v_test_email    := lower(trim(coalesce(p_test_email, '')));
    v_preview_email := lower(trim(coalesce(p_preview_for_email, '')));

    -- =========================================================================
    -- MODE PREVIEW : envoie le mail à l'admin avec le contenu personnalisé
    --                pour la cible (sans jamais notifier la cible elle-même).
    -- =========================================================================
    IF v_preview_email != '' THEN
        -- Récupérer le nom de la cible (en priorité depuis presences,
        -- fallback sur profiles si la cible n'a pas encore de présence)
        SELECT nom INTO v_target_nom
        FROM presences
        WHERE lower(trim(email)) = v_preview_email
          AND type_inscrit = 'principal'
        LIMIT 1;

        IF v_target_nom IS NULL THEN
            SELECT nom INTO v_target_nom
            FROM profiles
            WHERE lower(trim(email)) = v_preview_email
            LIMIT 1;
        END IF;

        IF v_target_nom IS NULL THEN
            RETURN jsonb_build_object('error',
                'Aucun utilisateur trouvé avec cet email : ' || p_preview_for_email);
        END IF;

        -- Inscriptions actives de la cible
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'jeu',              i.jeu,
            'creneau',          i.creneau,
            'statut',           i.statut,
            'nom_accompagnant', COALESCE(i.nom_accompagnant, '')
        )), '[]'::jsonb) INTO v_inscriptions
        FROM inscriptions i
        WHERE lower(trim(i.email)) = v_preview_email
          AND i.statut IN ('inscrit', 'attente');

        -- Bénévolats de la cible
        BEGIN
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'creneau', b.creneau
            )), '[]'::jsonb) INTO v_benevolats
            FROM benevoles b
            WHERE lower(trim(b.email)) = v_preview_email
              AND b.statut = 'inscrit';
        EXCEPTION WHEN undefined_table THEN
            v_benevolats := '[]'::jsonb;
        END;

        -- Repas de la cible
        BEGIN
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'nom_accompagnant', COALESCE(r.nom_accompagnant, '')
            )), '[]'::jsonb) INTO v_repas
            FROM repas r
            WHERE lower(trim(r.email)) = v_preview_email
              AND r.statut = 'inscrit';
        EXCEPTION WHEN undefined_table THEN
            v_repas := '[]'::jsonb;
        END;

        -- Tables MJ de la cible
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'jeu',          pr.jeu,
            'creneau',      pr.creneau,
            'statut_table', pr.statut_table
        )), '[]'::jsonb) INTO v_tables_mj
        FROM programme pr
        WHERE lower(trim(pr.email_mj)) = v_preview_email
          AND COALESCE(pr.statut_table, '') != 'refusé';

        -- Jours de présence de la cible
        SELECT COALESCE(jsonb_agg(DISTINCT p.jour ORDER BY p.jour), '[]'::jsonb)
        INTO v_jours
        FROM presences p
        WHERE lower(trim(p.email)) = v_preview_email
          AND p.type_inscrit = 'principal';

        -- ── Envoyer le mail à L'ADMIN (pas à la cible) ──
        -- Le nom est préfixé "[PREVIEW pour <email>]" pour que l'admin
        -- voie immédiatement, dans le "Bonjour", que c'est une preview.
        -- C'est une astuce qui évite de modifier le worker (pas besoin
        -- de redéploiement Cloudflare pour cette feature back-office).
        PERFORM send_email_via_worker(
            'rappel',
            v_caller_email,
            jsonb_build_object(
                'nom',          '[PREVIEW pour ' || v_preview_email || '] ' || v_target_nom,
                'jours',        v_jours,
                'tablesMJ',     v_tables_mj,
                'inscriptions', v_inscriptions,
                'benevolats',   v_benevolats,
                'repas',        v_repas
            )
        );

        RETURN jsonb_build_object(
            'ok',          true,
            'sent',        1,
            'mode',        'preview',
            'preview_for', v_preview_email,
            'sent_to',     v_caller_email
        );
    END IF;

    -- =========================================================================
    -- MODE TEST OU PRODUCTION : itère sur les présences
    -- (mode test = filtré sur p_test_email, production = tout le monde)
    -- =========================================================================
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

        -- ── Envoyer le mail (asynchrone, fire-and-forget) ──
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

COMMENT ON FUNCTION send_reminders(TEXT, TEXT) IS
  'Envoie un email de rappel J-3 à toutes les personnes présentes à la '
  'convention. Modes : production (par défaut), test (p_test_email — un '
  'seul destinataire), preview (p_preview_for_email — admin reçoit le '
  'rendu personnalisé pour la cible). Réservée aux admins.';


-- =============================================================================
-- VÉRIFICATIONS POST-DÉPLOIEMENT
-- =============================================================================
--   -- 1. La fonction existe avec la nouvelle signature
--   SELECT proname, pronargs FROM pg_proc WHERE proname = 'send_reminders';
--
--   -- 2. Test preview (depuis le frontend, en tant qu'admin) :
--   --    await APP.supabase.rpc('send_reminders',
--   --      { p_preview_for_email: 'autre.user@example.com' });
--   --    → admin reçoit le mail rendu pour cet inscrit
--
-- POUR DÉSINSTALLER :
--   DROP FUNCTION IF EXISTS send_reminders(TEXT, TEXT);
-- =============================================================================
