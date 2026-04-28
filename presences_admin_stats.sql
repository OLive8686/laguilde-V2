-- =============================================================================
-- STAT ADMIN — Présences à la convention
-- =============================================================================
-- Ce fichier ajoute une fonction RPC qui renvoie les statistiques agrégées
-- de présence à la convention. Réservée aux admins (vérification via la
-- table profiles). N'expose AUCUN email individuel au frontend.
--
-- À exécuter UNE FOIS dans Supabase SQL Editor (idempotent grâce à
-- CREATE OR REPLACE FUNCTION).
--
-- USAGE FRONTEND :
--   var { data, error } = await APP.supabase.rpc('get_presences_stats');
--   data → { total_samedi, total_dimanche, total_both, total_unique }
--   ou { error: '...' } si non admin.
-- =============================================================================

CREATE OR REPLACE FUNCTION get_presences_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER  -- Bypasse RLS pour pouvoir lire toute la table presences
AS $$
DECLARE
    v_email          TEXT;
    v_role           TEXT;
    v_total_samedi   INT;
    v_total_dimanche INT;
    v_total_both     INT;
    v_total_unique   INT;
BEGIN
    -- ── 1. Récupérer l'email de l'utilisateur connecté depuis le JWT ──
    v_email := lower(trim(coalesce(auth.jwt()->>'email', '')));
    IF v_email = '' THEN
        RETURN jsonb_build_object('error', 'Non authentifié');
    END IF;

    -- ── 2. Vérifier que l'utilisateur est admin via la table profiles ──
    -- (c'est le pattern existant du projet : le rôle est dans profiles, pas
    -- dans le JWT)
    SELECT role INTO v_role
    FROM profiles
    WHERE lower(trim(email)) = v_email;

    IF v_role IS NULL OR v_role != 'admin' THEN
        RETURN jsonb_build_object('error', 'Accès admin requis');
    END IF;

    -- ── 3. Calculer les stats ──

    -- Total des personnes présentes samedi (joueurs principaux + accompagnants)
    SELECT COUNT(*) INTO v_total_samedi
    FROM presences
    WHERE jour = 'samedi';

    -- Total des personnes présentes dimanche
    SELECT COUNT(*) INTO v_total_dimanche
    FROM presences
    WHERE jour = 'dimanche';

    -- Personnes présentes les DEUX jours
    -- Une personne = (email, nom_accompagnant) — l'index unique de presences
    SELECT COUNT(*) INTO v_total_both
    FROM (
        SELECT email, COALESCE(nom_accompagnant, '') AS acc
        FROM presences
        GROUP BY email, COALESCE(nom_accompagnant, '')
        HAVING COUNT(DISTINCT jour) = 2
    ) AS personnes_2j;

    -- Total de personnes uniques (présentes au moins un jour)
    SELECT COUNT(*) INTO v_total_unique
    FROM (
        SELECT DISTINCT email, COALESCE(nom_accompagnant, '') AS acc
        FROM presences
    ) AS personnes_uniques;

    -- ── 4. Retourner les stats ──
    RETURN jsonb_build_object(
        'total_samedi',   v_total_samedi,
        'total_dimanche', v_total_dimanche,
        'total_both',     v_total_both,
        'total_unique',   v_total_unique
    );
END;
$$;

COMMENT ON FUNCTION get_presences_stats() IS
  'Stats agrégées de présence à la convention (réservé admin). '
  'N''expose aucun email individuel. Appelable via supabase.rpc(''get_presences_stats'').';


-- =============================================================================
-- VÉRIFICATIONS POST-DÉPLOIEMENT
-- =============================================================================
-- Pour tester depuis le SQL Editor (en tant qu'admin connecté côté front,
-- pas depuis le SQL Editor qui n'a pas de auth.jwt) :
--
--   SELECT get_presences_stats();
--   -- Depuis SQL Editor → retournera "Non authentifié" car pas de JWT.
--   -- Depuis le frontend → retournera les stats si l'appelant est admin.
--
-- POUR DÉSINSTALLER (rollback) :
--   DROP FUNCTION IF EXISTS get_presences_stats();
-- =============================================================================
