-- =============================================================================
-- RETOUR ARRIÈRE 005 — Rétablit la lecture publique de profiles
-- =============================================================================
-- ⚠ À ÉVITER : cela rouvre la fuite (noms, e-mails et rôles lisibles sans connexion).
--   À utiliser seulement si la 005 bloque le site (ex. liste des comptes vide, rôle non lu)
--   et qu'une correction vers l'avant n'est pas possible tout de suite.
-- =============================================================================

CREATE POLICY profiles_select_public ON public.profiles
  FOR SELECT TO public
  USING (true);

DROP POLICY IF EXISTS profiles_select_own_or_admin ON public.profiles;

DROP FUNCTION IF EXISTS public.is_admin();
