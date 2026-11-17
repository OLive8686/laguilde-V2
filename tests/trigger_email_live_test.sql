-- =============================================================================
-- TEST RÉEL D'ENVOI — les triggers envoient-ils vraiment un e-mail ?
-- =============================================================================
-- ⚠ PROJET SUPABASE DE TEST UNIQUEMENT. Ce test VALIDE (COMMIT) des lignes et
-- envoie de VRAIS e-mails : pg_net n'envoie qu'après le commit, il est donc
-- impossible de le faire dans une transaction annulée.
--
-- ⚠ Prérequis (sinon on testerait la production) :
--   1. Un Worker de test (ex. « melusine-email-test ») déployé avec le code de
--      worker-email.js, sa variable secrète WEBHOOK_SECRET, sa MAILERSEND_API_KEY.
--   2. Dans le projet Supabase de test : secret Vault « melusine_webhook_secret »
--      = même valeur que le WEBHOOK_SECRET du Worker de test (procédure :
--      docs/ROTATION_WEBHOOK_SECRET.md), migration 001 appliquée.
--   3. get_email_worker_url() redéfinie pour pointer sur le Worker de TEST
--      (elle est codée en dur sur le Worker de production dans email-triggers.sql) :
--
--        CREATE OR REPLACE FUNCTION get_email_worker_url() RETURNS TEXT
--        LANGUAGE sql IMMUTABLE AS $$ SELECT 'https://VOTRE-WORKER-DE-TEST.workers.dev'::text $$;
--
--      (à exécuter UNIQUEMENT sur le projet de test ; ne pas versionner l'URL de test)
--   4. Remplacer __MON_ADRESSE_DE_TEST__ ci-dessous (toutes les occurrences) par une boîte
--      mail à vous. Ne mettez jamais l'adresse d'un participant réel.
--
-- Exécuter les blocs dans l'ordre, UN PAR UN (chaque bloc est une requête).
-- =============================================================================


-- ── BLOC 0 — Garde-fous : refuse de continuer si la config est dangereuse ──
DO $$
BEGIN
  IF get_email_worker_url() = 'https://melusine-email.olivier-gramain.workers.dev' THEN
    RAISE EXCEPTION 'STOP : get_email_worker_url() pointe sur le Worker de PRODUCTION. Voir prérequis 3.';
  END IF;
  IF '__MON_ADRESSE_DE_TEST__' LIKE '\_\_%' THEN
    RAISE EXCEPTION 'STOP : remplacez __MON_ADRESSE_DE_TEST__ par votre adresse de test.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'melusine_webhook_secret') THEN
    RAISE EXCEPTION 'STOP : secret Vault melusine_webhook_secret absent.';
  END IF;
END $$;


-- ── BLOC 1 — Déclencher le trigger « confirmation » ──
-- Attendu : 1 e-mail « Inscription confirmée » dans votre boîte (quelques secondes).
INSERT INTO inscriptions (email, nom, jeu, creneau, statut)
VALUES ('__MON_ADRESSE_DE_TEST__', 'TestTriggers', 'Test sécurité', 'Samedi 10h-13h', 'inscrit');


-- ── BLOC 2 — (attendre ~10 s) Lire les réponses du Worker ──
-- Attendu : la dernière ligne a status_code = 200 et un contenu contenant « ok ».
--   403 → secrets Vault / Cloudflare différents (refaire la rotation, étapes 2 et 4)
--   500 → WEBHOOK_SECRET ou MAILERSEND_API_KEY manquant côté Worker de test
--   NULL / aucune ligne → pg_net n'a pas encore envoyé, ou l'URL est injoignable
SELECT id, status_code, left(content::text, 160) AS reponse, error_msg, created
FROM net._http_response
ORDER BY created DESC
LIMIT 5;


-- ── BLOC 3 — Déclencher « annulation » ──
-- Attendu : 1 e-mail « Inscription annulée ».
UPDATE inscriptions
SET statut = 'annulé'
WHERE email = '__MON_ADRESSE_DE_TEST__' AND jeu = 'Test sécurité';

-- (attendre ~10 s puis relancer le SELECT du BLOC 2 : nouvelle ligne en 200)


-- ── BLOC 4 — Nettoyage ──
-- Peut envoyer un dernier e-mail (trigger sur DELETE). Les triggers
-- d'audit/présence créent aussi des lignes : on les retire.
DELETE FROM inscriptions  WHERE email = '__MON_ADRESSE_DE_TEST__';
DELETE FROM presences     WHERE email = '__MON_ADRESSE_DE_TEST__';
