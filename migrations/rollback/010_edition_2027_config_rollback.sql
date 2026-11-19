-- =============================================================================
-- RETOUR ARRIÈRE 010 — restaure la table config depuis config_backup_2026
-- =============================================================================
-- À n'utiliser que si migrations/010_edition_2027_config.sql a été exécutée et que les
-- valeurs 2027 doivent être annulées. Restaure UNIQUEMENT les valeurs des clés
-- sauvegardées ; les clés ajoutées depuis ne sont pas touchées.
-- Prérequis : la table config_backup_2026 existe (créée par la migration).
-- =============================================================================

UPDATE config c
SET valeur = b.valeur
FROM config_backup_2026 b
WHERE c.cle = b.cle
  AND c.cle IN ('lieu_nom', 'lieu_adresse', 'lieu_maps', 'dates_detail', 'tarif',
                'bienvenue_titre', 'bienvenue_texte', 'restauration_intro');

-- Vérifier (8 lignes attendues, valeurs de 2026), puis, une fois sûr :
-- DROP TABLE IF EXISTS config_backup_2026;
