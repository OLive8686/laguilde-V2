-- =============================================================================
-- SYNCHRONISATION INSCRIPTIONS ↔ PROGRAMME (renommage de table)
-- =============================================================================
-- Quand un admin/MJ renomme une table (changement de programme.jeu et/ou
-- programme.creneau), ce trigger propage AUTOMATIQUEMENT le nouveau nom
-- aux inscriptions correspondantes.
--
-- POURQUOI :
--   Les inscriptions sont liées au programme par (creneau, jeu) — pas par
--   un foreign key. Sans ce trigger, un renommage rend les inscriptions
--   "orphelines" (elles gardent l'ancien nom, donc invisibles dans la vue
--   par table de l'admin). C'est arrivé en pratique.
--
-- LOGIQUE :
--   - Trigger AFTER UPDATE OF jeu, creneau ON programme
--   - Si jeu OU creneau change : UPDATE inscriptions WHERE jeu=OLD.jeu AND
--     creneau=OLD.creneau → SET jeu=NEW.jeu, creneau=NEW.creneau
--   - Affecte toutes les lignes liées (statut inscrit, attente, annulé, etc.)
--     pour garder l'historique cohérent.
--
-- INTERACTIONS AVEC LES AUTRES TRIGGERS :
--   - trg_email_inscription se déclenche sur UPDATE OF statut → PAS impacté
--     ici (on ne change que jeu/creneau, pas statut).
--   - trg_promote_first_waiting idem.
--   - Aucune cascade destructive.
--
-- IDEMPOTENT : à exécuter dans Supabase SQL Editor, rejouable sans risque.
-- =============================================================================

CREATE OR REPLACE FUNCTION trigger_sync_inscriptions_on_programme_rename()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER  -- Bypasse RLS pour propager le changement même si l'appelant
                  -- n'a pas le droit d'écrire sur toutes les lignes d'inscriptions
AS $$
DECLARE
    v_count INT;
BEGIN
    -- Skip si rien n'a changé sur ces 2 colonnes (sécurité : on est sur
    -- AFTER UPDATE OF jeu, creneau donc en principe au moins une a changé,
    -- mais une mise à jour avec les mêmes valeurs déclenche aussi le trigger)
    IF NEW.jeu IS NOT DISTINCT FROM OLD.jeu
       AND NEW.creneau IS NOT DISTINCT FROM OLD.creneau THEN
        RETURN NEW;
    END IF;

    -- Propager le nouveau nom aux inscriptions correspondantes.
    -- On met à jour toutes les inscriptions (peu importe le statut) pour
    -- garder l'historique cohérent — y compris les annulées, ça évite des
    -- "ghosts" si on consulte les inscriptions annulées plus tard.
    UPDATE inscriptions
    SET jeu     = NEW.jeu,
        creneau = NEW.creneau
    WHERE jeu     = OLD.jeu
      AND creneau = OLD.creneau;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Renommage programme : % inscriptions resynchronisées (% → %)',
                 v_count,
                 OLD.jeu || ' / ' || OLD.creneau,
                 NEW.jeu || ' / ' || NEW.creneau;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION trigger_sync_inscriptions_on_programme_rename() IS
  'Quand programme.jeu ou programme.creneau change, propage le nouveau '
  'nom aux inscriptions liées (par OLD.jeu, OLD.creneau).';

-- Attacher le trigger
DROP TRIGGER IF EXISTS trg_sync_inscriptions_on_programme_rename ON programme;

CREATE TRIGGER trg_sync_inscriptions_on_programme_rename
    AFTER UPDATE OF jeu, creneau ON programme
    FOR EACH ROW
    EXECUTE FUNCTION trigger_sync_inscriptions_on_programme_rename();

COMMENT ON TRIGGER trg_sync_inscriptions_on_programme_rename ON programme IS
  'Sync auto des inscriptions quand une table est renommée (jeu ou creneau).';


-- =============================================================================
-- VÉRIFICATIONS POST-DÉPLOIEMENT
-- =============================================================================
--   -- 1. Le trigger est actif
--   SELECT tgname FROM pg_trigger WHERE tgname = 'trg_sync_inscriptions_on_programme_rename';
--
--   -- 2. Test (sur une table sans inscrit ou de test) :
--   --    UPDATE programme SET jeu = 'NOUVEAU NOM' WHERE jeu = 'ANCIEN NOM';
--   --    → toutes les inscriptions liées sont automatiquement renommées
--
-- POUR DÉSINSTALLER :
--   DROP TRIGGER IF EXISTS trg_sync_inscriptions_on_programme_rename ON programme;
--   DROP FUNCTION IF EXISTS trigger_sync_inscriptions_on_programme_rename();
-- =============================================================================
