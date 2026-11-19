-- =============================================================================
-- RETOUR ARRIÈRE 004 — Rend le droit UPDATE sur toutes les colonnes de profiles
-- =============================================================================
-- ⚠ À ÉVITER : cela rouvre la faille (un joueur connecté peut se donner le rôle admin).
--   À n'utiliser que si le site est bloqué par la migration 004 et qu'aucune alternative
--   n'est possible ; refermer ensuite le plus vite possible.
-- Restaure l'état constaté avant la migration : UPDATE sur toute la table pour anon et authenticated.
-- =============================================================================

REVOKE UPDATE (nom) ON TABLE public.profiles FROM authenticated;

GRANT UPDATE ON TABLE public.profiles TO anon, authenticated;
