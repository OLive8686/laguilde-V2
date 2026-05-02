-- =============================================================================
-- PROMOTION AUTOMATIQUE DEPUIS LA LISTE D'ATTENTE
-- =============================================================================
-- Quand une inscription active passe à 'annulé' ou 'supprimé', on promeut
-- AUTOMATIQUEMENT le plus ancien en attente sur la même table (creneau + jeu).
--
-- POURQUOI :
--   Avant ce trigger, l'admin devait promouvoir manuellement les gens en
--   liste d'attente quand une place se libérait. Maintenant c'est instantané
--   pour les annulations utilisateur (mes-inscriptions.html → bouton "Annuler").
--
-- LOGIQUE :
--   - Sur UPDATE inscriptions OF statut
--   - Si OLD.statut = 'inscrit' AND NEW.statut IN ('annulé', 'supprimé')
--   - Trouver la plus ancienne ligne en 'attente' pour ce (creneau, jeu)
--   - La passer à 'inscrit'
--   - Le trigger email existant (trg_email_inscription) enverra automatiquement
--     l'email de promotion à cette personne (cas attente → inscrit)
--
-- INTERACTIONS :
--   - L'admin peut TOUJOURS promouvoir manuellement quelqu'un (court-circuit
--     de l'ordre par date) via le bouton dans admin.html. Cette promotion
--     manuelle ne déclenche PAS ce trigger (elle ne libère pas une place
--     puisqu'elle ajoute un inscrit en plus, le trigger n'est intéressé que
--     par les LIBÉRATIONS de places).
--   - Si la table est déjà pleine et qu'on annule, la promotion fonctionne
--     quand même (on remplace une place par une autre — totaux identiques).
--   - Aucune boucle infinie : le trigger ne se déclenche que sur
--     'inscrit' → 'annulé/supprimé', et il fait 'attente' → 'inscrit'.
--
-- IDEMPOTENT : CREATE OR REPLACE FUNCTION + DROP IF EXISTS TRIGGER.
-- =============================================================================

CREATE OR REPLACE FUNCTION trigger_promote_first_waiting()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER  -- Bypasse RLS pour pouvoir UPDATE n'importe quelle ligne
AS $$
DECLARE
    v_next_id BIGINT;
BEGIN
    -- ── Conditions de déclenchement ──
    -- On promeut UNIQUEMENT quand une place active se libère.
    -- Cas couverts : 'inscrit' → 'annulé' (annulation user)
    --               'inscrit' → 'supprimé' (suppression admin)
    -- Cas NON couverts (et c'est voulu) :
    --   - 'attente' → 'annulé/supprimé' : pas de place libérée, rien à promouvoir
    --   - 'attente' → 'inscrit' : promotion (déclenche trg_email_inscription)
    IF NOT (OLD.statut = 'inscrit' AND NEW.statut IN ('annulé', 'supprimé')) THEN
        RETURN NEW;
    END IF;

    -- ── Trouver le plus ancien en attente sur la même table ──
    -- Tri par id ASC : l'id est strictement croissant à chaque INSERT, donc
    -- équivalent à un tri par date d'inscription (et garanti d'exister, peu
    -- importe le nom exact de la colonne timestamp dans le schéma).
    SELECT id INTO v_next_id
    FROM inscriptions
    WHERE creneau = OLD.creneau
      AND jeu = OLD.jeu
      AND statut = 'attente'
    ORDER BY id ASC
    LIMIT 1;

    -- ── Personne en attente ? Rien à faire ──
    IF v_next_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- ── Promouvoir : statut 'attente' → 'inscrit' ──
    -- Cette mise à jour déclenchera trg_email_inscription qui enverra
    -- l'email de promotion automatiquement.
    UPDATE inscriptions
    SET statut = 'inscrit'
    WHERE id = v_next_id;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION trigger_promote_first_waiting() IS
  'Promeut automatiquement le plus ancien en liste d''attente quand une '
  'inscription active est annulée ou supprimée.';

-- ── Attacher le trigger ──
-- AFTER UPDATE car on veut que la transition de statut soit déjà committée
-- avant de faire l'UPDATE de promotion (cohérence avec les autres triggers).
DROP TRIGGER IF EXISTS trg_promote_first_waiting ON inscriptions;

CREATE TRIGGER trg_promote_first_waiting
    AFTER UPDATE OF statut ON inscriptions
    FOR EACH ROW
    EXECUTE FUNCTION trigger_promote_first_waiting();

COMMENT ON TRIGGER trg_promote_first_waiting ON inscriptions IS
  'Promotion auto du plus ancien en attente quand une place se libère.';


-- =============================================================================
-- VÉRIFICATIONS POST-DÉPLOIEMENT
-- =============================================================================
--
--   -- 1. Le trigger est actif
--   SELECT tgname FROM pg_trigger WHERE tgname = 'trg_promote_first_waiting';
--
--   -- 2. Test de bout en bout (à faire avec une table de test) :
--   --   a) Créer une table avec 2 places
--   --   b) Inscrire 3 personnes : A et B en 'inscrit', C en 'attente'
--   --   c) UPDATE inscriptions SET statut='annulé' WHERE email = 'A...'
--   --   d) Vérifier que C est passé à 'inscrit' et a reçu l'email de promotion
--
-- POUR DÉSINSTALLER :
--   DROP TRIGGER IF EXISTS trg_promote_first_waiting ON inscriptions;
--   DROP FUNCTION IF EXISTS trigger_promote_first_waiting();
-- =============================================================================
