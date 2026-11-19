// =============================================================================
// Tests des ressources locales : tout fichier référencé par une page existe
// =============================================================================
// Lancer :   node --test "tests/*.test.js"
//
// Vérifie, pour chaque page HTML, que les images, scripts, feuilles de style, polices et icônes
// référencés avec un chemin LOCAL existent bien dans le dépôt (casse comprise, car GitHub Pages
// distingue majuscules et minuscules). Attrape les liens cassés après un renommage ou un oubli
// de fichier. Vérifie aussi que l'ancien logo n'est plus utilisé par les pages en service.
// =============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const racine = path.join(__dirname, '..');
const pages = fs.readdirSync(racine).filter((f) => f.endsWith('.html'));

/** Liste les chemins locaux référencés par src, href, srcset ou data-… d'une page. */
function referencesLocales(html) {
  const refs = [];
  // Le code JavaScript en ligne construit du HTML par morceaux ('<a href="' + url ...) : on ne regarde que le HTML réel
  html = html.replace(/<script>[\s\S]*?<\/script>/g, '');
  const motif = /\b(?:src|href|srcset)="([^"]+)"/g;
  let m;
  while ((m = motif.exec(html)) !== null) {
    for (const brut of m[1].split(',')) {            // srcset peut contenir plusieurs URL
      const url = brut.trim().split(/\s+/)[0];
      if (!url || /^(https?:|mailto:|tel:|data:|javascript:|#|\/\/)/i.test(url)) continue;
      refs.push(url.split('#')[0].split('?')[0]);
    }
  }
  return refs.filter(Boolean);
}

test('chaque page référence uniquement des fichiers locaux qui existent', () => {
  const manquants = [];
  for (const page of pages) {
    const html = fs.readFileSync(path.join(racine, page), 'utf8');
    for (const ref of referencesLocales(html)) {
      const chemin = path.join(racine, ref);
      // existsSync ne distingue pas la casse sous Windows : on compare aussi le nom exact dans le dossier
      const dossier = path.dirname(chemin);
      const existe = fs.existsSync(chemin) && fs.readdirSync(dossier).includes(path.basename(chemin));
      if (!existe) manquants.push(page + ' → ' + ref);
    }
  }
  assert.deepEqual(manquants, [], 'ressources introuvables :\n' + manquants.join('\n'));
});

test('l\'ancien logo (logo.png) n\'est plus utilisé que par l\'archive de 2026', () => {
  const utilisateurs = pages.filter((p) => /logo\.png/.test(fs.readFileSync(path.join(racine, p), 'utf8')));
  assert.deepEqual(utilisateurs, ['index.2026.html']);
});

test('les logos réduits (clair et sombre) existent aux deux tailles et restent légers', () => {
  for (const f of ['img/logo-guilde-192.webp', 'img/logo-guilde-256.webp', 'img/logo-guilde-sombre-192.webp', 'img/logo-guilde-sombre-256.webp']) {
    const taille = fs.statSync(path.join(racine, f)).size;
    assert.ok(taille > 1000 && taille < 30 * 1024, f + ' : ' + taille + ' octets (attendu entre 1 et 30 Ko)');
  }
});

test('le logo est affiché dans sa version normale (essai : plus de version rose pour le thème sombre)', () => {
  for (const page of pages) {
    const html = fs.readFileSync(path.join(racine, page), 'utf8');
    assert.ok(!/logo-guilde-sombre/.test(html), page + ' : référence encore la version sombre');
  }
});
