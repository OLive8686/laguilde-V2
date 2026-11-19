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
