-- =============================================================================
-- SEED DATA — Sous l'Œil de Mélusine (Convention JDR, 16-17 mai 2026)
-- =============================================================================
-- Ce script insère les données de test dans la base Supabase.
-- À exécuter via l'éditeur SQL de Supabase (Dashboard > SQL Editor).
--
-- Tables concernées :
--   1. creneaux_benevoles — Créneaux de bénévolat
--   2. programme          — Tables de JDR (jeux proposés)
--   3. restauration       — Menu de la buvette / repas
--   4. animations         — Activités annexes (hors tables de JDR)
--
-- Sécurité : ON CONFLICT DO NOTHING évite les doublons si le script
-- est exécuté plusieurs fois.
-- =============================================================================


-- =============================================================================
-- 1. CRÉNEAUX BÉNÉVOLES
-- =============================================================================
-- Colonnes : creneau, description, places
-- Ces créneaux correspondent aux moments où la convention a besoin de
-- bénévoles pour l'accueil, la buvette, l'installation et le rangement.
-- =============================================================================

INSERT INTO creneaux_benevoles (creneau, description, places)
VALUES
    ('Samedi 9h-10h',    'Installation des tables et de la signalétique', 6),
    ('Samedi 10h-13h',   'Accueil des joueurs et buvette',               4),
    ('Samedi 14h-17h',   'Buvette et accueil',                           4),
    ('Samedi 17h-21h',   'Service repas du soir et buvette',             5),
    ('Samedi 21h-00h',   'Buvette et rangement partiel',                 3),
    ('Dimanche 9h-10h',  'Ouverture et mise en place',                   4),
    ('Dimanche 10h-13h', 'Accueil et buvette',                           4),
    ('Dimanche 14h-16h', 'Buvette et rangement final',                   6)
ON CONFLICT DO NOTHING;


-- =============================================================================
-- 2. PROGRAMME — Tables de JDR
-- =============================================================================
-- Colonnes : creneau, jeu, mj, systeme, description, content, places,
--            statut_table, email_mj
-- statut_table = 'validé' → visible dans le programme public.
-- statut_table = 'en_attente' → en attente de validation admin.
--
-- On insère 6 tables réparties sur les 4 créneaux de jeu :
--   - Samedi 10h-13h, Samedi 14h-17h, Samedi 21h-00h, Dimanche 10h-13h
-- =============================================================================

INSERT INTO programme (creneau, jeu, mj, systeme, description, content_warning, places, statut_table, email_mj)
VALUES
    -- ── Samedi matin ─────────────────────────────────────────────────────
    (
        'Samedi 10h-13h',
        'La Malédiction de Strahd',
        'Olivier',
        'D&D 5e',
        'Les brumes de Barovie se referment sur vous. Le comte Strahd von Zarovich vous attend dans son château... Un classique de la dark fantasy, adapté en one-shot de 3h. Pré-tirés fournis, débutants bienvenus.',
        'Horreur gothique, violence modérée',
        5,
        'validé',
        'olivier.mj@example.com'
    ),
    (
        'Samedi 10h-13h',
        'L''Appel de Cthulhu — Le Molosse',
        'Camille',
        'L''Appel de Cthulhu 7e',
        'Nouvelle-Angleterre, 1925. Deux antiquaires passionnés d''occultisme découvrent un étrange amullet de jade dans une tombe ancienne. Inspiré de la nouvelle de Lovecraft. Scénario d''initiation idéal.',
        'Horreur cosmique, folie',
        4,
        'validé',
        'camille.mj@example.com'
    ),

    -- ── Samedi après-midi ────────────────────────────────────────────────
    (
        'Samedi 14h-17h',
        'Striscia — Lames & Intrigues à Venise',
        'Thomas',
        'Striscia',
        'Venise, XVIe siècle. Vous incarnez des spadassins, courtisanes et marchands pris dans un complot qui menace le Doge. Duels au fleuret, intrigues politiques et mascarades. Système narratif léger, aucune expérience requise.',
        NULL,
        6,
        'validé',
        'thomas.mj@example.com'
    ),
    (
        'Samedi 14h-17h',
        'Cérèlthène — Monstres d''Antan',
        'Nadia',
        'Cérèlthène',
        'Dans les forêts ancestrales de Cérèlthène, des créatures que l''on croyait disparues resurgissent. Votre communauté vous envoie enquêter. Un jeu poétique mêlant exploration, folklore et choix moraux.',
        NULL,
        5,
        'validé',
        'nadia.mj@example.com'
    ),

    -- ── Samedi soir ──────────────────────────────────────────────────────
    (
        'Samedi 21h-00h',
        'Cérèlthène — Cosa Nostra',
        'Nadia',
        'Cérèlthène',
        'Les guildes marchandes de Cérèlthène se livrent une guerre souterraine. Trahisons, alliances fragiles et coups bas dans les ruelles d''une cité médiévale-fantastique. Ambiance polar/fantasy sombre.',
        'Trahison, violence entre PJ possible',
        5,
        'validé',
        'nadia.mj@example.com'
    ),

    -- ── Dimanche matin ───────────────────────────────────────────────────
    (
        'Dimanche 10h-13h',
        'Alien — Espoir Perdu',
        'Julien',
        'Alien RPG (Year Zero Engine)',
        'Station spatiale Montero, 2183. Le signal de détresse que vous avez capté ne venait pas d''un vaisseau humain. Huis-clos spatial tendu, où chaque décision peut être la dernière. Pré-tirés fournis.',
        'Horreur spatiale, mort de personnage probable, body horror',
        5,
        'validé',
        'julien.mj@example.com'
    )
ON CONFLICT DO NOTHING;


-- =============================================================================
-- 3. RESTAURATION — Menu buvette et repas
-- =============================================================================
-- Colonnes : categorie, item, prix, description
-- Affiché sur la page Infos, groupé par catégorie.
-- Les prix sont en euros (nombre décimal).
-- =============================================================================

INSERT INTO restauration (categorie, item, prix, description)
VALUES
    -- ── Boissons ─────────────────────────────────────────────────────────
    ('Boissons',       'Café',              0.50,  'Café filtre, à volonté'),
    ('Boissons',       'Thé / Infusion',    0.50,  'Plusieurs variétés disponibles'),
    ('Boissons',       'Soda (canette)',     1.50,  'Coca, Orangina, Ice Tea'),
    ('Boissons',       'Jus de fruit',       1.50,  'Orange ou pomme (bouteille 25cl)'),
    ('Boissons',       'Eau minérale',       0.50,  'Bouteille 50cl'),
    ('Boissons',       'Bière artisanale',   3.00,  'Brasserie locale — Blonde ou Ambrée (33cl)'),

    -- ── Snacks ───────────────────────────────────────────────────────────
    ('Snacks',         'Cookie maison',      1.00,  'Chocolat noir ou noix'),
    ('Snacks',         'Part de cake salé',  2.00,  'Chèvre-courgette ou lardons-oignons'),
    ('Snacks',         'Crêpe',              1.50,  'Sucre, confiture ou Nutella'),
    ('Snacks',         'Fruit frais',        0.50,  'Pomme ou banane'),

    -- ── Repas du samedi soir ─────────────────────────────────────────────
    ('Repas du samedi soir', 'Tartiflette',       6.00, 'Tartiflette maison avec salade verte (sur inscription)'),
    ('Repas du samedi soir', 'Option végétarienne', 6.00, 'Gratin de légumes et fromage (sur inscription)')
ON CONFLICT DO NOTHING;


-- =============================================================================
-- 4. ANIMATIONS — Activités annexes
-- =============================================================================
-- Colonnes : nom, horaire, lieu, description
-- Affiché sur la page Infos, section "Animations".
-- Ce sont les activités en dehors des tables de JDR inscriptibles.
-- =============================================================================

INSERT INTO animations (nom, horaire, lieu, description)
VALUES
    (
        'Initiation au JDR',
        'Samedi 10h-12h',
        'Salle annexe',
        'Vous n''avez jamais joué au jeu de rôle ? Venez découvrir en douceur avec des MJ bienveillants. Sessions courtes de 45 min, sans inscription, dans une ambiance détendue.'
    ),
    (
        'Tournoi de jeux de société',
        'Samedi 14h-17h',
        'Espace jeux de société',
        'Tournoi amical ouvert à tous. Plusieurs jeux proposés : Catan, Splendor, 7 Wonders. Lots à gagner pour les vainqueurs !'
    ),
    (
        'Atelier création de personnage',
        'Dimanche 10h-12h',
        'Salle annexe',
        'Apprenez à créer un personnage de JDR de A à Z. Conseils pour le background, les mécaniques de jeu et l''interprétation. Ouvert à tous les systèmes.'
    ),
    (
        'Brocante rôliste',
        'Samedi 10h - Dimanche 16h',
        'Hall d''entrée',
        'Achetez, vendez ou échangez vos livres de JDR, dés, figurines et accessoires. Déposez vos articles au stand dès le samedi matin.'
    )
ON CONFLICT DO NOTHING;


-- =============================================================================
-- FIN DU SCRIPT
-- =============================================================================
-- Vérification rapide après exécution :
--   SELECT count(*) FROM creneaux_benevoles;  -- attendu : 8
--   SELECT count(*) FROM programme;            -- attendu : 6
--   SELECT count(*) FROM restauration;         -- attendu : 12
--   SELECT count(*) FROM animations;           -- attendu : 4
-- =============================================================================
