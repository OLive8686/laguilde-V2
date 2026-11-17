-- =============================================================================
-- MIGRATION 001 — Secret du webhook : lecture depuis Supabase Vault
-- =============================================================================
-- Contenu des changements (miroir de email-triggers.sql, fichier source) :
--   1. Nouvelle fonction get_webhook_secret() qui lit le secret dans Vault.
--   2. send_email_via_worker() utilise ce secret au lieu d'une valeur en clair,
--      et reçoit SET search_path.
--   3. REVOKE EXECUTE sur ces deux fonctions pour anon / authenticated.
--
-- ⚠ ORDRE OBLIGATOIRE (voir docs/ROTATION_WEBHOOK_SECRET.md) :
--   a) créer le secret « melusine_webhook_secret » dans Vault (dashboard) ;
--   b) exécuter CETTE migration ;
--   c) mettre la même valeur dans la variable secrète WEBHOOK_SECRET du Worker.
--   Entre (b) et (c), les e-mails échouent en 403 (sans conséquence pour les
--   inscriptions : l'envoi est asynchrone). Faites (b) et (c) à la suite.
--
-- Retour arrière : migrations/rollback/001_webhook_secret_vault_rollback.sql
-- Rejouable : oui (CREATE OR REPLACE, REVOKE idempotent).
-- =============================================================================

-- Garde-fou : on refuse de continuer si le secret n'existe pas encore dans
-- Vault, sinon tous les e-mails échoueraient dès l'application de la migration.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets WHERE name = 'melusine_webhook_secret'
  ) THEN
    RAISE EXCEPTION
      'Secret melusine_webhook_secret introuvable dans Vault. Créez-le d''abord (docs/ROTATION_WEBHOOK_SECRET.md, étape 2).';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION get_webhook_secret()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_secret TEXT;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'melusine_webhook_secret'
  LIMIT 1;

  IF v_secret IS NULL OR v_secret = '' THEN
    RAISE EXCEPTION 'Secret melusine_webhook_secret absent de Supabase Vault';
  END IF;

  RETURN v_secret;
END;
$$;

CREATE OR REPLACE FUNCTION send_email_via_worker(
  email_type TEXT,
  recipient  TEXT,
  payload    JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF recipient IS NULL OR recipient = '' OR position('@' IN recipient) = 0 THEN
    RAISE NOTICE 'Email invalide ignoré : %', COALESCE(recipient, 'NULL');
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := get_email_worker_url(),
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'X-Webhook-Secret',  get_webhook_secret()
    ),
    body    := jsonb_build_object(
      'type', email_type,
      'to',   recipient,
      'data', payload
    )::text
  );

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Erreur envoi email (%) à % : %', email_type, recipient, SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION get_webhook_secret()                         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION send_email_via_worker(TEXT, TEXT, JSONB)     FROM PUBLIC, anon, authenticated;
