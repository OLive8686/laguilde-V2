-- =============================================================================
-- MIGRATION 005 — profiles : fin de la lecture publique (noms, e-mails, rôles)
-- =============================================================================
-- PROBLÈME (constaté le 19/11/2026) : la règle « profiles_select_public » (SELECT, rôle public,
--   condition « true ») laisse n'importe qui, SANS compte, lister tous les profils avec la clé
--   publique du site (visible dans le dépôt) : un appel anonyme à l'API renvoyait 67 profils.
--
-- CORRECTIF :
--   1. fonction is_admin() : dit si l'appelant est admin. SECURITY DEFINER pour lire profiles sans
--      repasser par la règle RLS (sinon la règle qui interroge profiles s'appellerait elle-même :
--      erreur « infinite recursion detected in policy »).
--   2. nouvelle règle « profiles_select_own_or_admin » : un utilisateur connecté lit SA ligne
--      (id = auth.uid(), ou e-mail du jeton identique : fetchRole lit par e-mail) ; un admin lit tout.
--   3. suppression de « profiles_select_public ». La nouvelle règle est créée AVANT la suppression
--      de l'ancienne, pour qu'il n'y ait jamais un instant sans règle de lecture.
--
-- NE CHANGE PAS : la règle UPDATE « profiles_update_own » (déjà bornée à la colonne nom par la 004),
--   les fonctions SECURITY DEFINER (get_admin_export_data, send_reminders… lisent profiles avec les
--   droits de leur propriétaire), ni les autres tables.
--
-- À VÉRIFIER APRÈS : connexion (le rôle se lit), panneau Admin (liste des comptes), et un appel
--   anonyme à l'API qui doit renvoyer 0 profil.
-- Rejouable : oui. Retour arrière : migrations/rollback/005_profiles_lecture_restreinte_rollback.sql
-- Vérification : tests/005_profiles_lecture_restreinte_test.sql (lecture seule)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE role = 'admin'
      AND (id = auth.uid() OR lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
  );
$$;

-- « anon » est nommé explicitement : Supabase lui accorde EXECUTE à part.
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

DROP POLICY IF EXISTS profiles_select_own_or_admin ON public.profiles;
CREATE POLICY profiles_select_own_or_admin ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    OR public.is_admin()
  );

DROP POLICY IF EXISTS profiles_select_public ON public.profiles;
