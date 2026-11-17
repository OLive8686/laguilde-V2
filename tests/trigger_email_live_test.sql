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
--      docs/ROTATION_WEBHOOK_SECRET.md), migrations 001, 002 et 003 appliquées.
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


-- ── BLOC 2b — « Récap » via la VRAIE RPC, en tant qu'utilisateur connecté ──
-- On simule la session d'un utilisateur (rôle « authenticated » + JWT portant
-- votre adresse) et on appelle send_recap_email exactement comme le site.
-- Attendu : réponse {"ok": true, …} puis 1 e-mail récapitulatif dans votre boîte.
-- Relancer ce bloc AUSSITÔT doit renvoyer l'erreur « moins de 2 minutes » (rate-limit).
BEGIN;
SELECT set_config('request.jwt.claims',
  '{"role":"authenticated","email":"__MON_ADRESSE_DE_TEST__"}', true);
SET LOCAL ROLE authenticated;
SELECT send_recap_email('__MON_ADRESSE_DE_TEST__') AS reponse;
COMMIT;   -- le COMMIT est indispensable : pg_net n'envoie qu'après


-- ── BLOC 3 — « Annulation » via la VRAIE RPC annuler_presence ──
-- Même simulation de session. annuler_presence passe l'inscription du samedi à
-- « annulé » ; le trigger d'annulation doit envoyer l'e-mail.
-- Attendu : réponse {"ok": true, "nb_inscriptions_annulees": 1, …} puis 1 e-mail
-- « Inscription annulée ». (Un e-mail de promotion n'est envoyé que s'il y avait
-- quelqu'un en liste d'attente sur cette table : ici non.)
BEGIN;
SELECT set_config('request.jwt.claims',
  '{"role":"authenticated","email":"__MON_ADRESSE_DE_TEST__"}', true);
SET LOCAL ROLE authenticated;
SELECT annuler_presence('__MON_ADRESSE_DE_TEST__', 'samedi', NULL) AS reponse;
COMMIT;

-- (attendre ~10 s puis relancer le SELECT du BLOC 2 : de nouvelles lignes en 200,
--  une par e-mail déclenché)


-- ── BLOC 3b — Contrôle négatif : A ne peut pas agir sur un autre compte ──
-- Attendu : {"error": "Accès refusé : …"} et AUCUN e-mail envoyé à l'autre adresse.
BEGIN;
SELECT set_config('request.jwt.claims',
  '{"role":"authenticated","email":"__MON_ADRESSE_DE_TEST__"}', true);
SET LOCAL ROLE authenticated;
SELECT annuler_presence('autre@example.invalid', 'samedi', NULL) AS reponse;
SELECT send_recap_email('autre@example.invalid') AS reponse;
COMMIT;


-- ── BLOC 4 — Nettoyage ──
-- Peut envoyer un dernier e-mail (trigger sur DELETE). Les triggers
-- d'audit/présence créent aussi des lignes : on les retire.
DELETE FROM inscriptions   WHERE email = '__MON_ADRESSE_DE_TEST__';
DELETE FROM presences      WHERE email = '__MON_ADRESSE_DE_TEST__';
DELETE FROM recap_email_log WHERE email = lower('__MON_ADRESSE_DE_TEST__');
