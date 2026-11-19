-- =============================================================================
-- MIGRATION 004 — profiles : plus personne (sauf l'éditeur SQL) ne peut modifier « role »
-- =============================================================================
-- PROBLÈME (constaté le 19/11/2026 sur pg_policies, pg_trigger et column_privileges) :
--   la règle RLS « profiles_update_own » laisse tout utilisateur connecté modifier SA ligne
--   (id = auth.uid()), et le droit UPDATE porte sur TOUTES les colonnes, « role » comprise.
--   Aucun déclencheur ne protège « role » (seuls trg_audit et trg_sync_pseudo existent).
--   => un joueur pouvait se donner le rôle « admin ».
--
-- CORRECTIF : retirer le droit UPDATE sur la table aux rôles de l'API (anon, authenticated),
--   puis ne redonner à « authenticated » que la colonne « nom » (le pseudo, seule colonne
--   modifiée par app.supabase.js). Les règles RLS restent en place (elles s'ajoutent aux droits).
--
-- CONSÉQUENCE : le panneau Admin ne peut plus changer le rôle d'un utilisateur
--   (admin.html, appel PATCH sur profiles) : il reçoit « permission denied ».
--   En attendant une fonction dédiée (SECURITY DEFINER, vérifiant que l'appelant est admin),
--   changer un rôle se fait dans l'éditeur SQL de Supabase :
--     UPDATE public.profiles SET role = 'mj' WHERE lower(email) = lower('adresse@exemple.fr');
--   (l'éditeur s'exécute avec le rôle postgres, non concerné par ce REVOKE).
--
-- NON TRAITÉ ICI : la lecture publique de profiles (règle « profiles_select_public », condition true :
--   noms et e-mails lisibles sans connexion). Fera l'objet de la migration 005.
--
-- Rejouable : oui (REVOKE et GRANT sont idempotents).
-- Retour arrière : migrations/rollback/004_profiles_role_verrouille_rollback.sql
-- Vérification : tests/004_profiles_role_verrouille_test.sql (lecture seule, utilisable en production)
-- =============================================================================

REVOKE UPDATE ON TABLE public.profiles FROM anon, authenticated;

GRANT UPDATE (nom) ON TABLE public.profiles TO authenticated;
