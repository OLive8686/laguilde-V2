// =============================================================================
// Tests STATIQUES de la migration 004 (profiles) : lecture des fichiers SQL, aucune base
// =============================================================================
// Ne valident pas le SQL (aucun moteur PostgreSQL ici) : ils empêchent de rouvrir la faille par
// erreur de rédaction (colonne « role » redevenue modifiable, droits donnés à anon).
// Lancer :   node --test "tests/*.test.js"
// =============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const lire = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const sansCommentaires = (sql) => sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const migration = sansCommentaires(lire('migrations/004_profiles_role_verrouille.sql'));
const retour = sansCommentaires(lire('migrations/rollback/004_profiles_role_verrouille_rollback.sql'));

test('la migration retire UPDATE sur profiles à anon et authenticated', () => {
  assert.match(migration, /REVOKE UPDATE ON TABLE public\.profiles FROM anon, authenticated;/);
});

test('la migration ne redonne que la colonne nom, et seulement à authenticated', () => {
  const grants = migration.match(/GRANT[^;]*;/g) || [];
  assert.equal(grants.length, 1, 'un seul GRANT attendu');
  assert.match(grants[0], /GRANT UPDATE \(nom\) ON TABLE public\.profiles TO authenticated;/);
  assert.doesNotMatch(migration, /GRANT[^;]*\brole\b/i, 'la colonne role ne doit jamais être accordée');
  assert.doesNotMatch(migration, /GRANT[^;]*\banon\b/i, 'anon ne doit rien recevoir');
});

test('le retour arrière restaure l\'état d\'avant (c\'est lui qui rouvre la faille)', () => {
  assert.match(retour, /GRANT UPDATE ON TABLE public\.profiles TO anon, authenticated;/);
});

// ── Migration 005 : lecture restreinte ──
const m5 = sansCommentaires(lire('migrations/005_profiles_lecture_restreinte.sql'));
const r5 = sansCommentaires(lire('migrations/rollback/005_profiles_lecture_restreinte_rollback.sql'));

test('005 : la nouvelle règle de lecture est créée AVANT la suppression de l\'ancienne', () => {
  const creation = m5.indexOf('CREATE POLICY profiles_select_own_or_admin');
  const suppression = m5.indexOf('DROP POLICY IF EXISTS profiles_select_public');
  assert.ok(creation > -1 && suppression > -1 && creation < suppression);
});

test('005 : la règle est réservée à authenticated et ne contient aucune condition « true »', () => {
  assert.match(m5, /FOR SELECT TO authenticated/);
  assert.doesNotMatch(m5.slice(m5.indexOf('CREATE POLICY')), /USING\s*\(\s*true\s*\)/i);
});

test('005 : is_admin() est SECURITY DEFINER, a un search_path et est fermée à anon', () => {
  assert.match(m5, /SECURITY DEFINER/);
  assert.match(m5, /SET search_path = public, pg_temp/);
  assert.match(m5, /REVOKE ALL ON FUNCTION public\.is_admin\(\) FROM PUBLIC, anon;/);
});

test('005 : le retour arrière rétablit la règle publique (c\'est lui qui rouvre la fuite)', () => {
  assert.match(r5, /CREATE POLICY profiles_select_public/);
});
