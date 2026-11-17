-- =============================================================================
-- MIGRATION 002 — annuler_presence / ensure_presence : contrôle d'identité et droits
-- =============================================================================
-- Contenu (miroir de presences.sql, qui reste le fichier source) :
--   1. annuler_presence : l'e-mail du JWT (session) est la seule référence.
--      p_email est conservé (pages en cache) mais doit lui être identique
--      (comparaison lower(trim())), sinon erreur. Compte sans e-mail : refusé.
--      + SET search_path.
--   2. REVOKE EXECUTE FROM PUBLIC, anon ; GRANT EXECUTE TO authenticated.
--   3. ensure_presence (réservée aux triggers) : SET search_path + REVOKE total
--      pour PUBLIC, anon, authenticated.
--
-- ⚠ Dérive possible : si presences.sql est modifié plus tard, mettre à jour ce
--   fichier aussi (ou ne rejouer que presences.sql, qui contient la même chose).
-- Retour arrière : migrations/rollback/002_annuler_presence_lockdown_rollback.sql
-- Rejouable : oui.
-- Vérification : tests/002_annuler_presence_test.sql (projet de TEST) puis
--   tests/rest_checks.sh.
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
SET search_path = public, pg_temp
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

REVOKE ALL ON FUNCTION ensure_presence(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION annuler_presence(
    p_email TEXT,
    p_jour TEXT,
    p_nom_accompagnant TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp  -- Empêche le détournement par un objet homonyme
AS $$
DECLARE
    nb_inscriptions INT := 0;
    nb_benevoles    INT := 0;
    nb_repas        INT := 0;
    clean_email     TEXT;
    v_caller_email  TEXT;
BEGIN
    -- ── Identité : l'e-mail du JWT est la référence, jamais le paramètre ──
    v_caller_email := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
    IF v_caller_email = '' THEN
        -- Appel anonyme, ou compte SSO sans e-mail : on ne peut pas savoir à
        -- qui appartiennent les données, donc on refuse.
        RETURN jsonb_build_object('error', 'Aucune adresse e-mail associée à votre session : action impossible');
    END IF;

    clean_email := lower(trim(coalesce(p_email, '')));

    -- Le paramètre doit désigner l'utilisateur connecté (anti-IDOR).
    -- Message volontairement générique : on ne révèle rien sur l'e-mail visé.
    IF clean_email <> v_caller_email THEN
        RETURN jsonb_build_object('error', 'Accès refusé : vous ne pouvez agir que sur votre propre compte');
    END IF;

    -- Validations
    IF position('@' IN clean_email) = 0 THEN
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

REVOKE ALL ON FUNCTION annuler_presence(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION annuler_presence(TEXT, TEXT, TEXT) TO authenticated;
