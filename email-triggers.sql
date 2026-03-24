-- =============================================================================
-- TRIGGERS EMAIL — Envoi automatique d'emails via pg_net + Cloudflare Worker
-- =============================================================================
-- Ce fichier contient les triggers PostgreSQL qui envoient des emails
-- automatiquement quand des événements se produisent dans la base Supabase :
--   - Nouvelle inscription (confirmée ou liste d'attente)
--   - Promotion depuis la liste d'attente
--   - Annulation d'inscription
--   - Suppression d'accompagnant
--   - Validation/refus de table MJ par l'admin
--
-- ARCHITECTURE :
--   Trigger PostgreSQL → pg_net (extension Supabase) → Worker Cloudflare → Resend → Email
--
-- PRÉ-REQUIS :
--   1. Extension pg_net activée (Supabase Dashboard → Database → Extensions → pg_net)
--   2. Worker worker-email.js déployé sur Cloudflare Workers
--   3. L'URL du Worker configurée ci-dessous (variable EMAIL_WORKER_URL)
--
-- SÉCURITÉ :
--   - pg_net envoie les requêtes depuis le réseau interne Supabase
--   - Aucune clé API n'est exposée dans les triggers (elle est dans le Worker)
--   - Les triggers sont AFTER (l'opération DB réussit même si l'email échoue)
--
-- DÉPLOIEMENT :
--   1. Modifier EMAIL_WORKER_URL avec l'URL de votre Worker email
--   2. Exécuter ce fichier dans Supabase SQL Editor (Dashboard → SQL Editor → New query)
--   3. Vérifier que pg_net est activé : SELECT * FROM pg_extension WHERE extname = 'pg_net';
--
-- ATTENTION :
--   - Les triggers utilisent pg_net_http_post qui est ASYNCHRONE (fire-and-forget)
--   - Si le Worker est down, les emails sont perdus silencieusement
--   - Pour un système plus robuste, envisager une queue (pg_boss, Supabase Queues)
-- =============================================================================


-- ── Activer pg_net si pas déjà fait ──
-- (Cette commande est idempotente — on peut la relancer sans risque)
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;


-- ── URL du Worker email ──
-- IMPORTANT : remplacer par l'URL réelle après déploiement du Worker
-- On utilise une fonction SQL pour pouvoir la modifier en un seul endroit.
CREATE OR REPLACE FUNCTION get_email_worker_url()
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  -- REMPLACER cette URL par celle de votre Worker Cloudflare
  SELECT 'https://melusine-email.votre-compte.workers.dev'::text
$$;

-- Note : le commentaire ci-dessous documente la raison du choix d'une fonction
-- plutôt qu'une constante. PostgreSQL ne supporte pas les variables globales.
-- Une fonction IMMUTABLE est optimisée par le planificateur (mise en cache).
COMMENT ON FUNCTION get_email_worker_url() IS
  'URL du Cloudflare Worker qui envoie les emails transactionnels. '
  'À modifier après déploiement du Worker.';


-- =============================================================================
-- HELPER — Fonction d'envoi HTTP vers le Worker email
-- =============================================================================

/**
 * Envoie une requête POST au Worker email via pg_net.
 * C'est un wrapper autour de net.http_post qui centralise l'appel.
 *
 * @param email_type  Type d'email (ex: 'confirmation', 'annulation')
 * @param recipient   Adresse email du destinataire
 * @param payload     Objet JSON avec les données spécifiques au type
 */
CREATE OR REPLACE FUNCTION send_email_via_worker(
  email_type TEXT,
  recipient  TEXT,
  payload    JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER  -- Exécuté avec les droits du créateur (nécessaire pour pg_net)
AS $$
BEGIN
  -- Vérification basique de l'email (ne bloque pas si invalide, juste un skip)
  IF recipient IS NULL OR recipient = '' OR position('@' IN recipient) = 0 THEN
    RAISE NOTICE 'Email invalide ignoré : %', COALESCE(recipient, 'NULL');
    RETURN;
  END IF;

  -- Appel asynchrone au Worker via pg_net
  -- pg_net_http_post retourne un ID de requête (bigint) qu'on ignore ici
  PERFORM net.http_post(
    url     := get_email_worker_url(),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := jsonb_build_object(
      'type', email_type,
      'to',   recipient,
      'data', payload
    )::text
  );

EXCEPTION WHEN OTHERS THEN
  -- Ne JAMAIS bloquer l'opération principale si l'email échoue
  -- On log l'erreur mais on continue
  RAISE WARNING 'Erreur envoi email (%) à % : %', email_type, recipient, SQLERRM;
END;
$$;

COMMENT ON FUNCTION send_email_via_worker(TEXT, TEXT, JSONB) IS
  'Envoie un email transactionnel via le Worker Cloudflare. '
  'Appel asynchrone (fire-and-forget) : ne bloque jamais l''opération DB.';


-- =============================================================================
-- TRIGGER 1 : Inscription créée ou statut modifié (inscriptions)
-- =============================================================================
-- Se déclenche quand :
--   - INSERT avec statut 'inscrit' ou 'attente' → email de confirmation
--   - UPDATE du statut 'attente' → 'inscrit'    → email de promotion

CREATE OR REPLACE FUNCTION trigger_email_inscription()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- ── Nouvelle inscription (INSERT) ──
  IF TG_OP = 'INSERT' THEN
    -- Envoyer un email de confirmation (inscrit ou attente)
    IF NEW.statut IN ('inscrit', 'attente') THEN
      PERFORM send_email_via_worker(
        'confirmation',
        NEW.email,
        jsonb_build_object(
          'nom',     COALESCE(NEW.nom, NEW.email),
          'jeu',     COALESCE(NEW.jeu, 'Table inconnue'),
          'creneau', COALESCE(NEW.creneau, 'Créneau non précisé'),
          'statut',  NEW.statut
        )
      );
    END IF;

  -- ── Promotion depuis la liste d'attente (UPDATE) ──
  ELSIF TG_OP = 'UPDATE' THEN
    -- Cas 1 : promotion attente → inscrit
    IF OLD.statut = 'attente' AND NEW.statut = 'inscrit' THEN
      PERFORM send_email_via_worker(
        'promotion',
        NEW.email,
        jsonb_build_object(
          'nom',     COALESCE(NEW.nom, NEW.email),
          'jeu',     COALESCE(NEW.jeu, 'Table inconnue'),
          'creneau', COALESCE(NEW.creneau, 'Créneau non précisé')
        )
      );

    -- Cas 2 : annulation (statut → 'annulé')
    ELSIF NEW.statut = 'annulé' AND OLD.statut IN ('inscrit', 'attente') THEN
      PERFORM send_email_via_worker(
        'annulation',
        NEW.email,
        jsonb_build_object(
          'nom',     COALESCE(NEW.nom, NEW.email),
          'jeu',     COALESCE(NEW.jeu, 'Table inconnue'),
          'creneau', COALESCE(NEW.creneau, 'Créneau non précisé')
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Appliquer le trigger sur la table inscriptions
-- DROP d'abord au cas où il existe déjà (idempotent)
DROP TRIGGER IF EXISTS trg_email_inscription ON inscriptions;

CREATE TRIGGER trg_email_inscription
  AFTER INSERT OR UPDATE OF statut
  ON inscriptions
  FOR EACH ROW
  EXECUTE FUNCTION trigger_email_inscription();

COMMENT ON TRIGGER trg_email_inscription ON inscriptions IS
  'Envoie un email de confirmation (INSERT), promotion (attente→inscrit) '
  'ou annulation (→annulé) via le Worker email.';


-- =============================================================================
-- TRIGGER 2 : Suppression d'inscription (DELETE sur inscriptions)
-- =============================================================================
-- Si une inscription est supprimée (DELETE) au lieu d'être marquée 'annulé',
-- on envoie aussi un email d'annulation.

CREATE OR REPLACE FUNCTION trigger_email_inscription_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Envoyer un email d'annulation uniquement si l'inscription était active
  IF OLD.statut IN ('inscrit', 'attente') THEN
    PERFORM send_email_via_worker(
      'annulation',
      OLD.email,
      jsonb_build_object(
        'nom',     COALESCE(OLD.nom, OLD.email),
        'jeu',     COALESCE(OLD.jeu, 'Table inconnue'),
        'creneau', COALESCE(OLD.creneau, 'Créneau non précisé')
      )
    );
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_email_inscription_delete ON inscriptions;

CREATE TRIGGER trg_email_inscription_delete
  AFTER DELETE
  ON inscriptions
  FOR EACH ROW
  EXECUTE FUNCTION trigger_email_inscription_delete();

COMMENT ON TRIGGER trg_email_inscription_delete ON inscriptions IS
  'Envoie un email d''annulation quand une inscription active est supprimée.';


-- =============================================================================
-- TRIGGER 3 : Accompagnant supprimé (DELETE sur accompagnants)
-- =============================================================================
-- Quand un accompagnant est supprimé, on notifie le parent.
-- Le nombre d'inscriptions annulées en cascade doit être calculé ici
-- (on compte les inscriptions actives de cet accompagnant avant suppression).

CREATE OR REPLACE FUNCTION trigger_email_accompagnant_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  nb_annulees INT;
BEGIN
  -- Compter les inscriptions actives de cet accompagnant
  -- (identifié par email du parent + nom de l'accompagnant)
  SELECT COUNT(*) INTO nb_annulees
  FROM inscriptions
  WHERE email = OLD.email_parent
    AND nom_accompagnant = OLD.nom
    AND statut IN ('inscrit', 'attente');

  -- Envoyer l'email au parent
  PERFORM send_email_via_worker(
    'accompagnant_supprime',
    OLD.email_parent,
    jsonb_build_object(
      'nomAccompagnant', OLD.nom,
      'nbAnnulees',      nb_annulees
    )
  );

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_email_accompagnant_delete ON accompagnants;

CREATE TRIGGER trg_email_accompagnant_delete
  AFTER DELETE
  ON accompagnants
  FOR EACH ROW
  EXECUTE FUNCTION trigger_email_accompagnant_delete();

COMMENT ON TRIGGER trg_email_accompagnant_delete ON accompagnants IS
  'Notifie le parent quand un accompagnant est supprimé, '
  'avec le nombre d''inscriptions annulées en cascade.';


-- =============================================================================
-- TRIGGER 4 : Table MJ validée ou refusée (UPDATE sur programme)
-- =============================================================================
-- Quand l'admin change le statut_table d'une proposition de table :
--   - en_attente → validé  : email de validation au MJ
--   - en_attente → refusé  : email de refus au MJ

CREATE OR REPLACE FUNCTION trigger_email_table_statut()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Vérifier qu'on a bien un changement de statut
  IF OLD.statut_table = NEW.statut_table THEN
    RETURN NEW;
  END IF;

  -- Vérifier qu'il y a un email MJ
  IF NEW.email_mj IS NULL OR NEW.email_mj = '' THEN
    RETURN NEW;
  END IF;

  -- Table validée
  IF NEW.statut_table = 'validé' AND OLD.statut_table = 'en_attente' THEN
    PERFORM send_email_via_worker(
      'table_validee',
      NEW.email_mj,
      jsonb_build_object(
        'jeu',     COALESCE(NEW.jeu, 'Table inconnue'),
        'creneau', COALESCE(NEW.creneau, 'Créneau non précisé')
      )
    );

  -- Table refusée
  ELSIF NEW.statut_table = 'refusé' AND OLD.statut_table = 'en_attente' THEN
    PERFORM send_email_via_worker(
      'table_refusee',
      NEW.email_mj,
      jsonb_build_object(
        'jeu',     COALESCE(NEW.jeu, 'Table inconnue'),
        'creneau', COALESCE(NEW.creneau, 'Créneau non précisé')
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_email_table_statut ON programme;

CREATE TRIGGER trg_email_table_statut
  AFTER UPDATE OF statut_table
  ON programme
  FOR EACH ROW
  EXECUTE FUNCTION trigger_email_table_statut();

COMMENT ON TRIGGER trg_email_table_statut ON programme IS
  'Notifie le MJ quand sa proposition de table est validée ou refusée.';


-- =============================================================================
-- FONCTION RPC : Envoi de récap à la demande
-- =============================================================================
-- Cette fonction est appelée depuis le frontend via supabase.rpc('send_recap_email', { ... }).
-- Elle collecte toutes les inscriptions de l'utilisateur et envoie un récap.
--
-- ATTENTION : cette fonction nécessite de lire les données de l'utilisateur.
-- Elle utilise SECURITY DEFINER pour accéder aux tables avec les droits du créateur
-- (bypasse les RLS). C'est nécessaire car le récap agrège plusieurs tables.

CREATE OR REPLACE FUNCTION send_recap_email(user_email TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  -- Données collectées pour le récap
  inscriptions_data JSONB;
  benevoles_data    JSONB;
  tables_mj_data    JSONB;
  clean_email       TEXT;
BEGIN
  -- Nettoyer l'email
  clean_email := lower(trim(user_email));

  -- Valider l'email
  IF clean_email IS NULL OR clean_email = '' OR position('@' IN clean_email) = 0 THEN
    RETURN jsonb_build_object('error', 'Email invalide');
  END IF;

  -- 1. Collecter les inscriptions (joueur + accompagnants)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'jeu',               i.jeu,
    'creneau',           i.creneau,
    'statut',            i.statut,
    'nom_accompagnant',  COALESCE(i.nom_accompagnant, '')
  )), '[]'::jsonb)
  INTO inscriptions_data
  FROM inscriptions i
  WHERE lower(trim(i.email)) = clean_email
    AND i.statut IN ('inscrit', 'attente');

  -- 2. Collecter les bénévolats
  -- Note : la table benevoles peut ne pas exister encore
  BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'creneau',           b.creneau,
      'nom_accompagnant',  COALESCE(b.nom_accompagnant, '')
    )), '[]'::jsonb)
    INTO benevoles_data
    FROM benevoles b
    WHERE lower(trim(b.email)) = clean_email
      AND b.statut = 'inscrit';
  EXCEPTION WHEN undefined_table THEN
    benevoles_data := '[]'::jsonb;
  END;

  -- 3. Collecter les tables MJ
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'jeu',           p.jeu,
    'creneau',       p.creneau,
    'statut_table',  p.statut_table
  )), '[]'::jsonb)
  INTO tables_mj_data
  FROM programme p
  WHERE lower(trim(p.email_mj)) = clean_email
    AND p.statut_table != 'refusé';

  -- Si rien du tout, ne pas envoyer
  IF inscriptions_data = '[]'::jsonb
     AND benevoles_data = '[]'::jsonb
     AND tables_mj_data = '[]'::jsonb THEN
    RETURN jsonb_build_object('error', 'Aucune inscription trouvée pour cet email.');
  END IF;

  -- 4. Envoyer le récap via le Worker
  PERFORM send_email_via_worker(
    'recap',
    clean_email,
    jsonb_build_object(
      'inscriptions', inscriptions_data,
      'benevoles',    benevoles_data,
      'tablesMJ',     tables_mj_data
    )
  );

  RETURN jsonb_build_object('ok', true, 'message', 'Récap envoyé à ' || clean_email || ' !');
END;
$$;

COMMENT ON FUNCTION send_recap_email(TEXT) IS
  'Envoie un email récapitulatif de toutes les inscriptions d''un utilisateur. '
  'Appelable via supabase.rpc(''send_recap_email'', { user_email: ''...'' }).';


-- =============================================================================
-- RÉSUMÉ DES TRIGGERS ET FONCTIONS CRÉÉS
-- =============================================================================
--
-- FONCTIONS :
--   get_email_worker_url()                     → URL du Worker (à modifier)
--   send_email_via_worker(type, email, data)   → Helper d'envoi HTTP
--   trigger_email_inscription()                → Trigger INSERT/UPDATE inscriptions
--   trigger_email_inscription_delete()         → Trigger DELETE inscriptions
--   trigger_email_accompagnant_delete()        → Trigger DELETE accompagnants
--   trigger_email_table_statut()               → Trigger UPDATE programme
--   send_recap_email(email)                    → RPC pour récap à la demande
--
-- TRIGGERS :
--   trg_email_inscription         ON inscriptions  (AFTER INSERT/UPDATE statut)
--   trg_email_inscription_delete  ON inscriptions  (AFTER DELETE)
--   trg_email_accompagnant_delete ON accompagnants  (AFTER DELETE)
--   trg_email_table_statut        ON programme      (AFTER UPDATE statut_table)
--
-- POUR TESTER :
--   -- Insérer une inscription test
--   INSERT INTO inscriptions (email, nom, jeu, creneau, statut)
--   VALUES ('test@example.com', 'TestJoueur', 'Cthulhu', 'Samedi 10h-13h', 'inscrit');
--
--   -- Vérifier les requêtes pg_net en attente
--   SELECT * FROM net._http_response ORDER BY created DESC LIMIT 5;
--
-- POUR DÉSACTIVER UN TRIGGER (sans le supprimer) :
--   ALTER TABLE inscriptions DISABLE TRIGGER trg_email_inscription;
--   ALTER TABLE inscriptions ENABLE TRIGGER trg_email_inscription;
-- =============================================================================
