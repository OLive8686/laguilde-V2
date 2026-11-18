-- =============================================================================
-- MIGRATION 010 (MODÈLE À COMPLÉTER) — Valeurs de l'édition 2027 dans la table config
-- =============================================================================
-- ⚠ NE PAS EXÉCUTER TEL QUEL. Ce fichier est préparé, jamais appliqué : il contient
-- des valeurs « __A_FOURNIR__ » (informations que seul l'organisateur connaît) et un
-- garde-fou qui interrompt l'exécution. Compléter les valeurs, retirer le garde-fou
-- (bloc « GARDE-FOU » ci-dessous), faire la sauvegarde de config, puis exécuter dans
-- Supabase → SQL Editor.
--
-- POURQUOI : la page Infos lit le lieu, les dates détaillées, le tarif et les textes
-- de bienvenue dans la table « config » (clés lieu_nom, lieu_adresse, lieu_maps,
-- dates_detail, tarif, bienvenue_titre, bienvenue_texte, restauration_intro). Tant que
-- ces lignes ne sont pas mises à jour, le site affiche les valeurs 2026 même si
-- edition.js est à jour : elles priment sur le texte de repli de la page.
--
-- Ce que cette migration NE contient PAS (déjà vérifié) :
--   - presences.sql / jour_from_creneau : la fonction lit seulement « samedi » ou
--     « dimanche » au début du créneau, aucune date : rien à changer ;
--   - seed_data.sql : seul le commentaire d'en-tête mentionne l'année ; ses créneaux
--     sont des libellés sans date. À revoir si les créneaux 2027 diffèrent (voir
--     docs/EDITION_2027_A_FAIRE.md) ;
--   - la purge des données 2026 (inscriptions, présences, etc.) : chantier distinct.
--
-- Retour arrière : migrations/rollback/010_edition_2027_config_rollback.sql
--   (restaure les valeurs depuis la table config_backup_2026 créée ci-dessous).
-- =============================================================================

-- ── GARDE-FOU : supprimer ce bloc une fois les valeurs complétées ──
DO $$
BEGIN
  RAISE EXCEPTION 'Modèle non complété : remplacer les valeurs __A_FOURNIR__ puis retirer ce garde-fou.';
END $$;


-- ── 1. Sauvegarde des valeurs actuelles (sert au retour arrière) ──
CREATE TABLE IF NOT EXISTS config_backup_2026 AS SELECT * FROM config;
-- La copie ne doit pas être lisible depuis l'API : RLS activée sans politique + droits retirés.
ALTER TABLE config_backup_2026 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE config_backup_2026 FROM PUBLIC, anon, authenticated;


-- ── 2. Valeurs de l'édition 2027 ──
-- Colonnes de la table config : cle, valeur (clé/valeur du site).
-- Chaque UPDATE ne touche qu'une ligne existante ; si une clé n'existe pas, l'UPDATE ne
-- modifie rien (vérifier le nombre de lignes affectées : 1 attendu).

UPDATE config SET valeur = 'Foyer du Porteau'            WHERE cle = 'lieu_nom';
UPDATE config SET valeur = '__A_FOURNIR__ (adresse)'      WHERE cle = 'lieu_adresse';
UPDATE config SET valeur = '__A_FOURNIR__ (lien Google Maps en https://…, ou vide)' WHERE cle = 'lieu_maps';

-- Dates détaillées avec horaires (une ligne par jour, séparées par un retour à la ligne)
UPDATE config SET valeur = E'Samedi 8 mai __A_FOURNIR__h →\nDimanche 9 mai __A_FOURNIR__h' WHERE cle = 'dates_detail';

UPDATE config SET valeur = '__A_FOURNIR__ (tarif 2027)'   WHERE cle = 'tarif';

-- Décisions de contenu : à valider par l'organisateur avant de les enregistrer
UPDATE config SET valeur = '__A_FOURNIR__ (titre de bienvenue 2027)' WHERE cle = 'bienvenue_titre';
UPDATE config SET valeur = '__A_FOURNIR__ (texte de bienvenue 2027)' WHERE cle = 'bienvenue_texte';
UPDATE config SET valeur = '__A_FOURNIR__ (introduction restauration 2027)' WHERE cle = 'restauration_intro';


-- ── 3. Vérification (à lancer après exécution) ──
-- SELECT cle, valeur FROM config
-- WHERE cle IN ('lieu_nom','lieu_adresse','lieu_maps','dates_detail','tarif',
--               'bienvenue_titre','bienvenue_texte','restauration_intro')
-- ORDER BY cle;
-- Attendu : 8 lignes, aucune valeur contenant « 2026 », « 16 mai » ou « 17 mai »,
-- aucune valeur contenant « __A_FOURNIR__ ».
