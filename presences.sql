-- =============================================================================
-- PRÉSENCES À LA CONVENTION — Sous l'Œil de Mélusine
-- =============================================================================
-- Ce fichier crée la table `presences` qui enregistre la présence d'une
-- personne (joueur principal ou accompagnant) à la convention pour un jour
-- donné, INDÉPENDAMMENT des inscriptions à des tables, repas ou bénévolat.
--
-- POURQUOI :
--   Avant, on n'était "présent" que parce qu'on était inscrit à une table.
--   Or, certains participants viennent sans s'inscrire à une table (bénévoles,
--   accompagnants, simples spectateurs, etc.). Cette table rend la présence
--   à la convention explicite et indépendante.
--
-- LOGIQUE :
--   - Une personne peut avoir 0, 1 ou 2 entrées dans cette table
--     (samedi seulement, dimanche seulement, ou les deux).
--   - S'inscrire à une table/repas/bénévolat un jour donné crée AUTOMATIQUEMENT
--     une entrée dans `presences` pour ce jour (via trigger SQL).
--   - Annuler sa présence un jour donné supprime toutes les inscriptions
--     associées à ce jour (via fonction RPC annuler_presence).
--
-- SÉCURITÉ :
--   - Tout est idempotent (CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE)
--   - Aucune modification des tables existantes
--   - Les fonctions sensibles utilisent SECURITY DEFINER comme le reste du projet
--
-- DÉPLOIEMENT :
--   Exécuter ce fichier dans Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- =============================================================================


-- =============================================================================
-- 1. TABLE presences
-- =============================================================================
-- Colonnes :
--   - id                : identifiant auto
--   - email             : email du compte propriétaire (joueur principal)
--   - nom               : nom affiché du joueur principal
--   - jour              : 'samedi' ou 'dimanche'
--   - type_inscrit      : 'principal' ou 'accompagnant'
--   - nom_accompagnant  : NULL si principal, sinon nom de l'accompagnant
--   - date_inscription  : timestamp de création
--
-- CONTRAINTE D'UNICITÉ :
--   Une personne ne peut avoir qu'une seule présence par jour.
--   On utilise un index unique avec COALESCE pour gérer le NULL de
--   nom_accompagnant (en PostgreSQL, NULL != NULL, donc un UNIQUE classique
--   laisserait passer plusieurs lignes (email, jour, NULL)).
-- =============================================================================

CREATE TABLE IF NOT EXISTS presences (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    nom TEXT NOT NULL,
    jour TEXT NOT NULL CHECK (jour IN ('samedi', 'dimanche')),
    type_inscrit TEXT NOT NULL DEFAULT 'principal'
        CHECK (type_inscrit IN ('principal', 'accompagnant')),
    nom_accompagnant TEXT,
    date_inscription TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE presences IS
  'Présence d''une personne (principal ou accompagnant) à la convention '
  'pour un jour donné, indépendamment des inscriptions tables/repas/bénévolat.';

-- Index unique : 1 présence max par (email, jour, accompagnant)
-- Le COALESCE traite NULL comme '' pour que l'unicité fonctionne sur les principaux
CREATE UNIQUE INDEX IF NOT EXISTS idx_presence_unique
    ON presences (email, jour, COALESCE(nom_accompagnant, ''));

-- Index pour les recherches par email (utilisé par fetchAllData)
CREATE INDEX IF NOT EXISTS idx_presences_email ON presences (email);


-- =============================================================================
-- 2. HELPER : extraire le jour depuis un créneau
-- =============================================================================
-- "Samedi 10h-13h" → 'samedi'
-- "Dimanche 14h-17h" → 'dimanche'
-- Tout le reste → NULL (cas non géré, sera ignoré par les triggers)
--
-- IMMUTABLE : permet à PostgreSQL d'optimiser (mise en cache de l'appel).
-- =============================================================================

CREATE OR REPLACE FUNCTION jour_from_creneau(creneau TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    IF creneau IS NULL THEN
        RETURN NULL;
    ELSIF creneau ILIKE 'Samedi%' THEN
        RETURN 'samedi';
    ELSIF creneau ILIKE 'Dimanche%' THEN
        RETURN 'dimanche';
    ELSE
        RETURN NULL;
    END IF;
END;
$$;

COMMENT ON FUNCTION jour_from_creneau(TEXT) IS
  'Extrait ''samedi'' ou ''dimanche'' du début d''un créneau. '
  'Retourne NULL si le créneau ne commence pas par l''un des deux.';


-- =============================================================================
-- 3. HELPER : créer une présence si elle n'existe pas (idempotent)
-- =============================================================================
-- Cette fonction est appelée par les triggers d'auto-création.
-- Elle insère une ligne dans `presences` si elle n'existe pas encore
-- pour cette personne ce jour-là (ON CONFLICT DO NOTHING).
-- =============================================================================

CREATE OR REPLACE FUNCTION ensure_presence(
    p_email TEXT,
    p_nom TEXT,
    p_jour TEXT,
    p_type_inscrit TEXT,
    p_nom_accompagnant TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Skip si jour invalide (créneau non parsable)
    IF p_jour IS NULL OR p_jour NOT IN ('samedi', 'dimanche') THEN
        RETURN;
    END IF;

    -- Skip si email vide
    IF p_email IS NULL OR p_email = '' THEN
        RETURN;
    END IF;

    -- INSERT idempotent grâce à l'index unique
    INSERT INTO presences (email, nom, jour, type_inscrit, nom_accompagnant)
    VALUES (
        p_email,
        COALESCE(p_nom, p_email),
        p_jour,
        COALESCE(p_type_inscrit, 'principal'),
        p_nom_accompagnant
    )
    ON CONFLICT (email, jour, COALESCE(nom_accompagnant, '')) DO NOTHING;
END;
$$;

COMMENT ON FUNCTION ensure_presence IS
  'Crée une présence si elle n''existe pas déjà (idempotent). '
  'Appelée par les triggers d''auto-création.';


-- =============================================================================
-- 4. TRIGGERS D'AUTO-CRÉATION
-- =============================================================================
-- Quand quelqu'un s'inscrit à une table, un repas ou un bénévolat un jour donné,
-- on crée automatiquement sa présence pour ce jour (si pas déjà là).
--
-- IMPORTANT : ces triggers se déclenchent uniquement sur INSERT pour éviter
-- de re-créer une présence qu'on viendrait juste d'annuler.
-- =============================================================================

-- ── Trigger sur inscriptions ──
CREATE OR REPLACE FUNCTION trigger_presence_from_inscription()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Ne créer la présence que pour les inscriptions actives
    IF NEW.statut IN ('inscrit', 'attente') THEN
        PERFORM ensure_presence(
            NEW.email,
            NEW.nom,
            jour_from_creneau(NEW.creneau),
            COALESCE(NEW.type_inscrit, 'principal'),
            NEW.nom_accompagnant
        );
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_presence_from_inscription ON inscriptions;
CREATE TRIGGER trg_presence_from_inscription
    AFTER INSERT ON inscriptions
    FOR EACH ROW
    EXECUTE FUNCTION trigger_presence_from_inscription();

COMMENT ON TRIGGER trg_presence_from_inscription ON inscriptions IS
  'Crée automatiquement une présence pour le jour de la table.';


-- ── Trigger sur benevoles ──
-- Note : les bénévoles sont uniquement des principaux (pas d'accompagnants
-- en bénévolat dans le projet actuel), mais on respecte le pattern par sécurité.
CREATE OR REPLACE FUNCTION trigger_presence_from_benevolat()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF NEW.statut = 'inscrit' THEN
        PERFORM ensure_presence(
            NEW.email,
            NEW.nom,
            jour_from_creneau(NEW.creneau),
            'principal',
            NULL
        );
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_presence_from_benevolat ON benevoles;
CREATE TRIGGER trg_presence_from_benevolat
    AFTER INSERT ON benevoles
    FOR EACH ROW
    EXECUTE FUNCTION trigger_presence_from_benevolat();

COMMENT ON TRIGGER trg_presence_from_benevolat ON benevoles IS
  'Crée automatiquement une présence pour le jour du bénévolat.';


-- ── Trigger sur repas ──
-- Les repas peuvent concerner des accompagnants (cf. type_inscrit, nom_accompagnant
-- dans le pattern existant). On parse le créneau du repas si présent, sinon
-- on utilise un champ 'jour' s'il existe. À défaut, on skip (ensure_presence
-- ignore les jours NULL).
CREATE OR REPLACE FUNCTION trigger_presence_from_repas()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_jour TEXT;
BEGIN
    IF NEW.statut = 'inscrit' THEN
        -- Tenter d'extraire le jour à partir d'un champ 'creneau' ou 'jour' s'il existe.
        -- Si la table repas n'a pas de tels champs, on skip silencieusement.
        BEGIN
            v_jour := jour_from_creneau(NEW.creneau);
        EXCEPTION WHEN undefined_column THEN
            v_jour := NULL;
        END;

        -- Si pas trouvé via creneau, tenter via une colonne 'jour' directe
        IF v_jour IS NULL THEN
            BEGIN
                v_jour := lower(NEW.jour);
                IF v_jour NOT IN ('samedi', 'dimanche') THEN
                    v_jour := NULL;
                END IF;
            EXCEPTION WHEN undefined_column THEN
                v_jour := NULL;
            END;
        END IF;

        PERFORM ensure_presence(
            NEW.email,
            NEW.nom,
            v_jour,
            COALESCE(NEW.type_inscrit, 'principal'),
            NEW.nom_accompagnant
        );
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_presence_from_repas ON repas;
CREATE TRIGGER trg_presence_from_repas
    AFTER INSERT ON repas
    FOR EACH ROW
    EXECUTE FUNCTION trigger_presence_from_repas();

COMMENT ON TRIGGER trg_presence_from_repas ON repas IS
  'Crée automatiquement une présence pour le jour du repas (si déductible).';


-- =============================================================================
-- 5. FONCTION RPC : annuler_presence
-- =============================================================================
-- Appelée depuis le frontend via supabase.rpc('annuler_presence', { ... }).
-- Annule TOUTES les inscriptions (tables, repas, bénévolat) de la personne
-- pour le jour donné, puis supprime la présence.
--
-- SÉCURITÉ : la vérification que l'utilisateur a le droit d'annuler cette
-- présence se fait CÔTÉ FRONTEND (pattern existant du projet, qui filtre
-- toutes les requêtes par currentUser.email côté JS). Cette fonction respecte
-- ce pattern. Pour un durcissement futur, on pourrait vérifier auth.uid().
--
-- IMPORTANT : on UPDATE statut='annulé' (au lieu de DELETE) pour conserver
-- l'historique et déclencher le trigger d'email d'annulation existant.
-- =============================================================================

CREATE OR REPLACE FUNCTION annuler_presence(
    p_email TEXT,
    p_jour TEXT,
    p_nom_accompagnant TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    nb_inscriptions INT := 0;
    nb_benevoles    INT := 0;
    nb_repas        INT := 0;
    clean_email     TEXT;
BEGIN
    clean_email := lower(trim(p_email));

    -- Validations
    IF clean_email IS NULL OR clean_email = '' OR position('@' IN clean_email) = 0 THEN
        RETURN jsonb_build_object('error', 'Email invalide');
    END IF;
    IF p_jour NOT IN ('samedi', 'dimanche') THEN
        RETURN jsonb_build_object('error', 'Jour invalide (samedi ou dimanche attendu)');
    END IF;

    -- 1. Annuler les inscriptions tables du jour pour cette personne
    UPDATE inscriptions
    SET statut = 'annulé'
    WHERE lower(trim(email)) = clean_email
      AND COALESCE(nom_accompagnant, '') = COALESCE(p_nom_accompagnant, '')
      AND jour_from_creneau(creneau) = p_jour
      AND statut IN ('inscrit', 'attente');
    GET DIAGNOSTICS nb_inscriptions = ROW_COUNT;

    -- 2. Annuler les bénévolats du jour (uniquement si principal)
    IF p_nom_accompagnant IS NULL THEN
        UPDATE benevoles
        SET statut = 'annulé'
        WHERE lower(trim(email)) = clean_email
          AND jour_from_creneau(creneau) = p_jour
          AND statut = 'inscrit';
        GET DIAGNOSTICS nb_benevoles = ROW_COUNT;
    END IF;

    -- 3. Annuler les repas du jour
    -- On encapsule dans un BEGIN/EXCEPTION pour gérer le cas où les colonnes
    -- de la table repas seraient différentes (creneau vs jour, etc.)
    BEGIN
        UPDATE repas
        SET statut = 'annulé'
        WHERE lower(trim(email)) = clean_email
          AND COALESCE(nom_accompagnant, '') = COALESCE(p_nom_accompagnant, '')
          AND (
              jour_from_creneau(creneau) = p_jour
              OR lower(jour) = p_jour
          )
          AND statut = 'inscrit';
        GET DIAGNOSTICS nb_repas = ROW_COUNT;
    EXCEPTION WHEN undefined_column THEN
        -- Si la colonne creneau ou jour n'existe pas, tenter sur jour seulement
        BEGIN
            UPDATE repas
            SET statut = 'annulé'
            WHERE lower(trim(email)) = clean_email
              AND COALESCE(nom_accompagnant, '') = COALESCE(p_nom_accompagnant, '')
              AND lower(jour) = p_jour
              AND statut = 'inscrit';
            GET DIAGNOSTICS nb_repas = ROW_COUNT;
        EXCEPTION WHEN undefined_column THEN
            nb_repas := 0;
        END;
    END;

    -- 4. Supprimer la présence elle-même
    DELETE FROM presences
    WHERE lower(trim(email)) = clean_email
      AND jour = p_jour
      AND COALESCE(nom_accompagnant, '') = COALESCE(p_nom_accompagnant, '');

    RETURN jsonb_build_object(
        'ok', true,
        'nb_inscriptions_annulees', nb_inscriptions,
        'nb_benevoles_annules',     nb_benevoles,
        'nb_repas_annules',         nb_repas
    );
END;
$$;

COMMENT ON FUNCTION annuler_presence(TEXT, TEXT, TEXT) IS
  'Annule la présence d''une personne pour un jour donné, et toutes ses '
  'inscriptions (tables, repas, bénévolat) associées à ce jour. '
  'Appelable via supabase.rpc(''annuler_presence'', { p_email, p_jour, p_nom_accompagnant }).';


-- =============================================================================
-- 6. ROW LEVEL SECURITY (RLS)
-- =============================================================================
-- Le projet utilise RLS sur les tables existantes (cf. commentaires dans
-- programme.html, admin.html, app.supabase.js). On active donc RLS sur
-- `presences` avec des policies qui suivent le pattern existant : un
-- utilisateur gère uniquement ses propres présences (filtrage par email).
--
-- POURQUOI :
--   Sans RLS, n'importe qui pourrait lire/modifier les présences de tout le monde
--   en utilisant la clé anon du frontend. RLS impose une vérification côté DB.
--
-- COMMENT ÇA INTERAGIT AVEC LES TRIGGERS :
--   Les triggers d'auto-création (ensure_presence) sont SECURITY DEFINER,
--   donc ils BYPASSENT RLS et peuvent insérer pour n'importe quel utilisateur.
--   C'est ce qu'on veut : si A crée une inscription, le trigger crée la
--   présence de A même si la requête arrive avec le JWT d'un autre user
--   (cas qui n'arrive pas en pratique, mais on est défensifs).
--
-- COMMENT L'ADMIN ACCÈDE-T-IL À TOUTES LES PRÉSENCES ?
--   Pour l'instant, l'admin passera par une RPC SECURITY DEFINER (à ajouter
--   plus tard) ou par le dashboard Supabase. Si tu veux que l'admin puisse
--   lire toutes les présences depuis le frontend, on ajoutera une policy
--   admin basée sur ta table `roles`. À discuter.
-- =============================================================================

-- Activer RLS sur la table presences
ALTER TABLE presences ENABLE ROW LEVEL SECURITY;

-- Idempotence : on supprime les policies existantes avant de les recréer
-- (PostgreSQL ne supporte pas "CREATE POLICY IF NOT EXISTS")
DROP POLICY IF EXISTS "presences_select_own"  ON presences;
DROP POLICY IF EXISTS "presences_insert_own"  ON presences;
DROP POLICY IF EXISTS "presences_delete_own"  ON presences;

-- ── Policy SELECT : un user voit ses propres présences ──
-- auth.jwt()->>'email' renvoie l'email du JWT du user connecté.
-- On lower/trim pour gérer les variations de casse et d'espaces.
CREATE POLICY "presences_select_own" ON presences
    FOR SELECT
    USING (
        lower(trim(email)) = lower(trim(coalesce(auth.jwt()->>'email', '')))
    );

-- ── Policy INSERT : un user peut créer une présence pour son propre email ──
-- Utilisé par le frontend quand l'utilisateur coche "Samedi" ou "Dimanche"
-- dans l'encart "Ma présence à la convention" (étape 2 à venir).
CREATE POLICY "presences_insert_own" ON presences
    FOR INSERT
    WITH CHECK (
        lower(trim(email)) = lower(trim(coalesce(auth.jwt()->>'email', '')))
    );

-- ── Policy DELETE : un user peut supprimer ses propres présences ──
-- En pratique, on passera par la RPC annuler_presence (SECURITY DEFINER),
-- mais cette policy est utile au cas où on voudrait un DELETE direct
-- (ou pour la cohérence avec les autres tables).
CREATE POLICY "presences_delete_own" ON presences
    FOR DELETE
    USING (
        lower(trim(email)) = lower(trim(coalesce(auth.jwt()->>'email', '')))
    );

COMMENT ON POLICY "presences_select_own"  ON presences IS
  'Un utilisateur voit uniquement ses propres présences (filtre par email du JWT).';
COMMENT ON POLICY "presences_insert_own"  ON presences IS
  'Un utilisateur peut créer une présence pour son propre email.';
COMMENT ON POLICY "presences_delete_own"  ON presences IS
  'Un utilisateur peut supprimer ses propres présences (alt. à annuler_presence).';


-- =============================================================================
-- 7. MIGRATION ONE-SHOT — créer les présences manquantes pour les comptes existants
-- =============================================================================
-- Pour les utilisateurs déjà inscrits avant l'ajout de cette table,
-- on crée rétroactivement leurs présences à partir de leurs inscriptions actives.
--
-- IDEMPOTENT : grâce à ON CONFLICT DO NOTHING, on peut relancer sans risque.
-- Tu peux exécuter ce bloc une fois après le déploiement, puis l'oublier.
-- =============================================================================

-- Présences depuis inscriptions actives
INSERT INTO presences (email, nom, jour, type_inscrit, nom_accompagnant)
SELECT DISTINCT
    email,
    COALESCE(nom, email) AS nom,
    jour_from_creneau(creneau) AS jour,
    COALESCE(type_inscrit, 'principal') AS type_inscrit,
    nom_accompagnant
FROM inscriptions
WHERE statut IN ('inscrit', 'attente')
  AND jour_from_creneau(creneau) IS NOT NULL
ON CONFLICT (email, jour, COALESCE(nom_accompagnant, '')) DO NOTHING;

-- Présences depuis bénévolats actifs
INSERT INTO presences (email, nom, jour, type_inscrit, nom_accompagnant)
SELECT DISTINCT
    email,
    COALESCE(nom, email) AS nom,
    jour_from_creneau(creneau) AS jour,
    'principal' AS type_inscrit,
    NULL AS nom_accompagnant
FROM benevoles
WHERE statut = 'inscrit'
  AND jour_from_creneau(creneau) IS NOT NULL
ON CONFLICT (email, jour, COALESCE(nom_accompagnant, '')) DO NOTHING;


-- =============================================================================
-- VÉRIFICATIONS POST-DÉPLOIEMENT
-- =============================================================================
-- Après avoir exécuté ce script, vérifier :
--
--   -- 1. La table existe et a la bonne structure
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'presences' ORDER BY ordinal_position;
--
--   -- 2. Les triggers sont actifs
--   SELECT tgname FROM pg_trigger WHERE tgname LIKE 'trg_presence%';
--
--   -- 3. Les présences rétroactives ont été créées
--   SELECT jour, COUNT(*) FROM presences GROUP BY jour;
--
--   -- 4. La fonction RPC est appelable
--   SELECT annuler_presence('test@example.com', 'samedi', NULL);
--   -- (Doit retourner {"ok": true, ...} ou une erreur métier, pas un crash)
--
-- POUR DÉSINSTALLER (rollback) :
--   DROP POLICY IF EXISTS "presences_select_own" ON presences;
--   DROP POLICY IF EXISTS "presences_insert_own" ON presences;
--   DROP POLICY IF EXISTS "presences_delete_own" ON presences;
--   DROP TRIGGER IF EXISTS trg_presence_from_inscription ON inscriptions;
--   DROP TRIGGER IF EXISTS trg_presence_from_benevolat ON benevoles;
--   DROP TRIGGER IF EXISTS trg_presence_from_repas ON repas;
--   DROP FUNCTION IF EXISTS annuler_presence(TEXT, TEXT, TEXT);
--   DROP FUNCTION IF EXISTS ensure_presence(TEXT, TEXT, TEXT, TEXT, TEXT);
--   DROP FUNCTION IF EXISTS jour_from_creneau(TEXT);
--   DROP FUNCTION IF EXISTS trigger_presence_from_inscription();
--   DROP FUNCTION IF EXISTS trigger_presence_from_benevolat();
--   DROP FUNCTION IF EXISTS trigger_presence_from_repas();
--   DROP TABLE IF EXISTS presences;
-- =============================================================================
