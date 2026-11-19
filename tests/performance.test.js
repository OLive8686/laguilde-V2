// =============================================================================
// Tests STATIQUES des garde-fous de la branche « chargement plus rapide » (lecture de fichiers)
// =============================================================================
// Ne lancent pas le site : ils vérifient que les règles de sécurité et de cohérence ajoutées avec les
// optimisations ne sont pas défaites par une modification ultérieure.
// Lancer :   node --test "tests/*.test.js"
// =============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const racine = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(racine, f), 'utf8');
const js = lire('app.supabase.js');

/** Extrait le contenu d'un tableau « var NOM = [ ... ];  » du fichier JS partagé. */
function tableau(nom) {
  const m = js.match(new RegExp('var ' + nom + " = \\[([^\\]]*)\\]"));
  assert.ok(m, nom + ' introuvable');
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
}

test('la copie publique en liste blanche ne contient aucune colonne d\'e-mail ni de nom d\'inscrit', () => {
  for (const nom of ['COLONNES_CACHE_PROGRAMME', 'COLONNES_CACHE_CRENEAUX']) {
    for (const colonne of tableau(nom)) {
      assert.doesNotMatch(colonne, /email|mail|tel|phone|noms_inscrits/i, nom + ' : colonne sensible « ' + colonne + ' »');
    }
  }
});

test('la copie publique n\'est sauvegardée que si toutes les requêtes publiques ont réussi', () => {
  assert.match(js, /var publicOk = results\.slice\(0, privateStart\)\.every\(/);
  assert.match(js, /if \(publicOk\) savePublicCache\(allData\)/);
});

test('la copie publique n\'est jamais lue pour un utilisateur connecté', () => {
  assert.match(js, /function readPublicCache\(\) \{\s*if \(currentUser \|\| _accessToken\) return null;/);
});

test('les pages dont l\'accès dépend du rôle attendent la vérification de session', () => {
  const m = js.match(/var PAGES_SELON_ROLE = \[([^\]]*)\]/);
  assert.ok(m);
  for (const page of ['admin.html', 'espace-mj.html', 'mes-inscriptions.html']) assert.ok(m[1].includes(page), page + ' doit attendre le rôle réel');
});

test('un seul rafraîchissement de session à la fois (jeton de rafraîchissement à usage unique)', () => {
  assert.match(js, /var _refreshEnCours = null;/);
  assert.match(js, /_refreshSessionImpl\(\)\.then\(/);
});

test('toutes les pages chargent la même version de app.supabase.js que le préchargement', () => {
  const dansPrefetch = /'app\.supabase\.js\?v=(\d+)'\]/.exec(js)[1];
  for (const f of fs.readdirSync(racine).filter((x) => x.endsWith('.html') && x !== 'index.2026.html')) {
    const m = /app\.supabase\.js\?v=(\d+)/.exec(lire(f));
    if (m) assert.equal(m[1], dansPrefetch, f + ' : version de app.supabase.js différente du préchargement');
  }
});

test('toutes les pages chargent la même version de styles.css que le préchargement', () => {
  const dansPrefetch = /'styles\.css\?v=(\d+)'/.exec(js)[1];
  for (const f of fs.readdirSync(racine).filter((x) => x.endsWith('.html') && x !== 'index.2026.html')) {
    const m = /styles\.css\?v=(\d+)/.exec(lire(f));
    if (m) assert.equal(m[1], dansPrefetch, f + ' : version de styles.css différente du préchargement');
  }
});
