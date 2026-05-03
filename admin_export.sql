-- =============================================================================
-- EXPORT ADMIN — Données complètes pour génération CSV
-- =============================================================================
-- Cette RPC retourne TOUTES les données nécessaires à l'export CSV admin :
--   - Inscriptions tables (joueurs + accompagnants, inscrits + attente)
--   - Bénévolats (inscrits)
--   - Repas (inscrits)
--   - Présences à la convention
--
-- Réservée aux admins (vérification via la table profiles).
-- SECURITY DEFINER pour bypasser le RLS et lire toutes les données.
--
-- USAGE FRONTEND :
--   var { data, error } = await APP.supabase.rpc('get_admin_export_data');
--   data → { inscriptions: [...], benevoles: [...], repas: [...], presences: [...] }
--   ou { error: '...' } si non admin
-- =============================================================================

CREATE OR REPLACE FUNCTION get_admin_export_data()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_caller_email TEXT;
    v_caller_role  TEXT;
    v_inscriptions JSONB;
    v_benevoles    JSONB;
    v_repas        JSONB;
    v_presences    JSONB;
BEGIN
    -- ── Vérification admin ──
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

    -- ── Inscriptions tables (toutes, même annulées : utile pour l'historique
    --    si l'admin veut investiguer ; on filtrera côté frontend) ──
    -- Tri par jeu, créneau, statut puis id (= ordre chronologique)
    SELECT COALESCE(jsonb_agg(row_to_json(i.*) ORDER BY i.creneau, i.jeu, i.statut, i.id), '[]'::jsonb)
    INTO v_inscriptions
    FROM inscriptions i;

    -- ── Bénévolats ──
    BEGIN
        SELECT COALESCE(jsonb_agg(row_to_json(b.*) ORDER BY b.creneau, b.id), '[]'::jsonb)
        INTO v_benevoles
        FROM benevoles b;
    EXCEPTION WHEN undefined_table THEN
        v_benevoles := '[]'::jsonb;
    END;

    -- ── Repas ──
    BEGIN
        SELECT COALESCE(jsonb_agg(row_to_json(r.*) ORDER BY r.id), '[]'::jsonb)
        INTO v_repas
        FROM repas r;
    EXCEPTION WHEN undefined_table THEN
        v_repas := '[]'::jsonb;
    END;

    -- ── Présences à la convention ──
    SELECT COALESCE(jsonb_agg(row_to_json(p.*) ORDER BY p.jour, p.email, p.nom_accompagnant), '[]'::jsonb)
    INTO v_presences
    FROM presences p;

    RETURN jsonb_build_object(
        'inscriptions', v_inscriptions,
        'benevoles',    v_benevoles,
        'repas',        v_repas,
        'presences',    v_presences
    );
END;
$$;

COMMENT ON FUNCTION get_admin_export_data() IS
  'Retourne toutes les données de la convention pour l''export CSV admin '
  '(inscriptions, bénévolats, repas, présences). Réservée aux admins.';


-- =============================================================================
-- VÉRIFICATIONS POST-DÉPLOIEMENT
-- =============================================================================
--   SELECT proname FROM pg_proc WHERE proname = 'get_admin_export_data';
--
-- POUR DÉSINSTALLER :
--   DROP FUNCTION IF EXISTS get_admin_export_data();
-- =============================================================================
