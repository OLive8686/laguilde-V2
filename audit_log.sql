-- =============================================================================
-- AUDIT LOG — Archivage automatique de toutes les modifications
-- =============================================================================
-- Crée une table `audit_log` qui enregistre AUTOMATIQUEMENT toute écriture
-- (INSERT/UPDATE/DELETE) faite sur les tables sensibles. Permet de retrouver
-- "qui a fait quoi quand" en cas de comportement inattendu.
--
-- TABLES AUDITÉES :
--   - inscriptions
--   - programme
--   - benevoles
--   - repas
--   - presences
--   - profiles
--   - accompagnants
--
-- TABLES NON AUDITÉES (volontairement, peu critiques) :
--   - config, creneaux_benevoles, restauration, animations, audit_log
--
-- USAGE :
--   - Le tracking est automatique, rien à faire côté code applicatif.
--   - Pour consulter (admin uniquement) :
--       SELECT * FROM audit_log ORDER BY ts DESC LIMIT 50;
--   - Pour filtrer sur une table :
--       SELECT * FROM audit_log WHERE table_name = 'inscriptions' ORDER BY ts DESC;
--   - Pour retracer un changement précis :
--       SELECT ts, op, actor_email, old_row, new_row FROM audit_log
--         WHERE table_name = 'inscriptions' AND row_id = 123 ORDER BY ts;
--
-- COÛTS :
--   - ~50-300 octets par modification, selon la taille des lignes auditées.
--   - Pas de purge automatique : on conserve tout pour cette édition.
--   - Penser à archiver/purger après la convention si la table grossit.
--
-- SÉCURITÉ :
--   - RLS strict : seuls les admins peuvent SELECT.
--   - Pas de policy INSERT depuis le front : les inserts viennent uniquement
--     des triggers (qui sont SECURITY DEFINER et bypassent RLS).
--   - Pas de policy UPDATE/DELETE : l'historique est en append-only.
--   - actor_email = NULL quand l'action vient d'un SQL direct (SQL Editor
--     Supabase, par exemple) — pratique pour distinguer.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Table audit_log
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_log (
    id          BIGSERIAL PRIMARY KEY,
    ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    table_name  TEXT NOT NULL,
    op          TEXT NOT NULL CHECK (op IN ('INSERT', 'UPDATE', 'DELETE')),
    row_id      BIGINT,            -- id de la ligne affectée (NULL si pas d'id)
    actor_email TEXT,              -- email JWT de l'appelant (NULL si SQL direct)
    old_row     JSONB,             -- valeurs avant (NULL pour INSERT)
    new_row     JSONB              -- valeurs après (NULL pour DELETE)
);

-- Index pour les requêtes courantes
CREATE INDEX IF NOT EXISTS idx_audit_ts          ON audit_log (ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_table_ts    ON audit_log (table_name, ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor       ON audit_log (actor_email, ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_table_rowid ON audit_log (table_name, row_id, ts DESC);

COMMENT ON TABLE audit_log IS
  'Archive append-only de toutes les modifications sur les tables sensibles. '
  'Alimentée automatiquement par le trigger trigger_audit_log.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RLS — admin uniquement en SELECT
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_log_select_admin" ON audit_log;

-- Lecture autorisée uniquement aux admins (vérification via profiles)
CREATE POLICY "audit_log_select_admin" ON audit_log
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE lower(trim(p.email)) = lower(trim(coalesce(auth.jwt()->>'email', '')))
              AND p.role = 'admin'
        )
    );

-- Pas de policy INSERT/UPDATE/DELETE : aucune écriture directe depuis le front.
-- Les inserts sont faits par le trigger trigger_audit_log (SECURITY DEFINER).

COMMENT ON POLICY "audit_log_select_admin" ON audit_log IS
  'Seuls les admins (role=admin dans profiles) peuvent lire l''audit log.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Fonction trigger générique
-- ─────────────────────────────────────────────────────────────────────────────
-- Une seule fonction utilisée pour TOUTES les tables auditées. Elle utilise
-- TG_OP (INSERT/UPDATE/DELETE) et TG_TABLE_NAME pour s'adapter.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION trigger_audit_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER  -- Bypass RLS pour insérer dans audit_log
AS $$
DECLARE
    v_actor   TEXT;
    v_row_id  BIGINT;
    v_old     JSONB;
    v_new     JSONB;
BEGIN
    -- Récupérer l'email JWT de l'appelant (NULL si pas de JWT = SQL direct)
    v_actor := lower(trim(coalesce(auth.jwt()->>'email', '')));
    IF v_actor = '' THEN v_actor := NULL; END IF;

    -- Construire old/new selon le type d'opération
    IF TG_OP = 'INSERT' THEN
        v_new := to_jsonb(NEW);
        v_old := NULL;
        -- Tenter de récupérer NEW.id (peut échouer si la table n'a pas de col 'id')
        BEGIN
            v_row_id := (v_new->>'id')::BIGINT;
        EXCEPTION WHEN OTHERS THEN
            v_row_id := NULL;
        END;
    ELSIF TG_OP = 'UPDATE' THEN
        v_new := to_jsonb(NEW);
        v_old := to_jsonb(OLD);
        BEGIN
            v_row_id := (v_new->>'id')::BIGINT;
        EXCEPTION WHEN OTHERS THEN
            v_row_id := NULL;
        END;
    ELSIF TG_OP = 'DELETE' THEN
        v_new := NULL;
        v_old := to_jsonb(OLD);
        BEGIN
            v_row_id := (v_old->>'id')::BIGINT;
        EXCEPTION WHEN OTHERS THEN
            v_row_id := NULL;
        END;
    END IF;

    -- Insertion dans l'audit log
    INSERT INTO audit_log (table_name, op, row_id, actor_email, old_row, new_row)
    VALUES (TG_TABLE_NAME, TG_OP, v_row_id, v_actor, v_old, v_new);

    -- Retour standard pour AFTER trigger : NEW pour INSERT/UPDATE, OLD pour DELETE
    RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
    -- Ne JAMAIS bloquer l'opération principale si l'audit échoue
    -- On log l'erreur mais on continue
    RAISE WARNING 'Audit log erreur (%, %) : %', TG_OP, TG_TABLE_NAME, SQLERRM;
    RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION trigger_audit_log() IS
  'Fonction générique appelée par les triggers d''audit sur chaque table '
  'sensible. Insère une ligne dans audit_log avec OLD/NEW en JSONB.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Triggers sur chaque table sensible
-- ─────────────────────────────────────────────────────────────────────────────
-- Tous AFTER INSERT OR UPDATE OR DELETE — on capture l'état final.
-- DROP IF EXISTS pour idempotence.
-- ─────────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_audit ON inscriptions;
CREATE TRIGGER trg_audit
    AFTER INSERT OR UPDATE OR DELETE ON inscriptions
    FOR EACH ROW EXECUTE FUNCTION trigger_audit_log();

DROP TRIGGER IF EXISTS trg_audit ON programme;
CREATE TRIGGER trg_audit
    AFTER INSERT OR UPDATE OR DELETE ON programme
    FOR EACH ROW EXECUTE FUNCTION trigger_audit_log();

DROP TRIGGER IF EXISTS trg_audit ON benevoles;
CREATE TRIGGER trg_audit
    AFTER INSERT OR UPDATE OR DELETE ON benevoles
    FOR EACH ROW EXECUTE FUNCTION trigger_audit_log();

-- repas et presences peuvent ne pas exister selon l'historique du projet :
-- on encapsule pour éviter d'échouer si la table est absente.
DO $$
BEGIN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_audit ON repas';
    EXECUTE 'CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON repas FOR EACH ROW EXECUTE FUNCTION trigger_audit_log()';
EXCEPTION WHEN undefined_table THEN
    RAISE NOTICE 'Table repas absente, trigger d''audit non créé.';
END $$;

DO $$
BEGIN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_audit ON presences';
    EXECUTE 'CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON presences FOR EACH ROW EXECUTE FUNCTION trigger_audit_log()';
EXCEPTION WHEN undefined_table THEN
    RAISE NOTICE 'Table presences absente, trigger d''audit non créé.';
END $$;

DROP TRIGGER IF EXISTS trg_audit ON profiles;
CREATE TRIGGER trg_audit
    AFTER INSERT OR UPDATE OR DELETE ON profiles
    FOR EACH ROW EXECUTE FUNCTION trigger_audit_log();

DROP TRIGGER IF EXISTS trg_audit ON accompagnants;
CREATE TRIGGER trg_audit
    AFTER INSERT OR UPDATE OR DELETE ON accompagnants
    FOR EACH ROW EXECUTE FUNCTION trigger_audit_log();


-- =============================================================================
-- VÉRIFICATIONS POST-DÉPLOIEMENT
-- =============================================================================
--   -- 1. La table existe
--   SELECT count(*) FROM audit_log;
--
--   -- 2. Les triggers sont actifs sur toutes les tables sensibles
--   SELECT tgrelid::regclass AS table_name, tgname
--   FROM pg_trigger
--   WHERE tgname = 'trg_audit' AND NOT tgisinternal
--   ORDER BY 1;
--
--   -- 3. Test : faire une modif (ex: UPDATE programme SET creneau=creneau)
--   --    puis vérifier qu'une ligne est apparue :
--   SELECT * FROM audit_log ORDER BY ts DESC LIMIT 5;
--
-- REQUÊTES UTILES
--
--   -- Dernières 50 modifications, tous tables confondues
--   SELECT ts, table_name, op, actor_email, row_id FROM audit_log
--   ORDER BY ts DESC LIMIT 50;
--
--   -- Historique d'une ligne précise (ex: inscription id=123)
--   SELECT ts, op, actor_email, old_row, new_row FROM audit_log
--   WHERE table_name = 'inscriptions' AND row_id = 123
--   ORDER BY ts;
--
--   -- Diff lisible entre old et new pour les UPDATE (statut, etc.)
--   SELECT ts, actor_email,
--          old_row->>'statut' AS old_statut,
--          new_row->>'statut' AS new_statut
--   FROM audit_log
--   WHERE table_name = 'inscriptions' AND op = 'UPDATE'
--     AND old_row->>'statut' IS DISTINCT FROM new_row->>'statut'
--   ORDER BY ts DESC;
--
--   -- Modifications faites par un admin précis
--   SELECT ts, table_name, op, row_id FROM audit_log
--   WHERE actor_email = 'olivier.gramain@gmail.com'
--   ORDER BY ts DESC LIMIT 100;
--
--   -- Modifications faites en SQL direct (sans JWT)
--   SELECT ts, table_name, op, row_id FROM audit_log
--   WHERE actor_email IS NULL
--   ORDER BY ts DESC LIMIT 50;
--
-- POUR DÉSINSTALLER :
--   DROP TRIGGER IF EXISTS trg_audit ON inscriptions;
--   DROP TRIGGER IF EXISTS trg_audit ON programme;
--   DROP TRIGGER IF EXISTS trg_audit ON benevoles;
--   DROP TRIGGER IF EXISTS trg_audit ON repas;
--   DROP TRIGGER IF EXISTS trg_audit ON presences;
--   DROP TRIGGER IF EXISTS trg_audit ON profiles;
--   DROP TRIGGER IF EXISTS trg_audit ON accompagnants;
--   DROP FUNCTION IF EXISTS trigger_audit_log();
--   DROP TABLE IF EXISTS audit_log;
-- =============================================================================
