// =============================================================================
// Tests du rideau d'accès équipe (acces.js) — Node seul, aucune dépendance
// =============================================================================
// Lancer :   node --test "tests/*.test.js"
//
// Le vrai code d'accès n'est jamais écrit dans le dépôt (seule son empreinte l'est). Ces tests
// remplacent donc l'empreinte par celle d'un code de test, avec le même calcul, et vérifient
// la logique : bon et mauvais codes, normalisation, garde des pages, jeton, stockage bloqué.
//
// Rappel : le rideau n'est PAS une protection (voir acces.js). Ces tests vérifient son
// comportement, pas sa résistance à une attaque.
// =============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'acces.js'), 'utf8');
const SEL = 'melusine-equipe:';
const CODE_TEST = 'code-de-test';
const empreinteDe = (code) => crypto.createHash('sha256').update(SEL + code.trim().toLowerCase()).digest('hex');
const EMPREINTE_TEST = empreinteDe(CODE_TEST);

/** Faux stockage (comme localStorage), éventuellement bloqué. */
function fauxStockage(bloque = false, initial = {}) {
  const donnees = { ...initial };
  return {
    getItem: (k) => { if (bloque) throw new Error('bloqué'); return k in donnees ? donnees[k] : null; },
    setItem: (k, v) => { if (bloque) throw new Error('bloqué'); donnees[k] = String(v); },
    removeItem: (k) => { if (bloque) throw new Error('bloqué'); delete donnees[k]; },
    donnees,
  };
}

/**
 * Exécute acces.js dans un faux navigateur et renvoie ce qu'il a fait.
 * @param {Object} options - page (nom du fichier), local, session (faux stockages)
 */
function charger({ page = 'programme.html', local = fauxStockage(), session = fauxStockage(), empreinte = EMPREINTE_TEST } = {}) {
  const redirections = [];
  const styles = [];
  const fenetre = { crypto: globalThis.crypto };
  const faussePage = {
    head: { appendChild: (el) => styles.push(el.textContent) },
    documentElement: { appendChild: (el) => styles.push(el.textContent) },
    createElement: () => ({ textContent: '' }),
  };
  const lieu = { pathname: '/' + page, replace: (url) => redirections.push(url) };
  const code = source.replace(/var EMPREINTE = '[0-9a-f]{64}';/, "var EMPREINTE = '" + empreinte + "';");
  assert.ok(code.includes(empreinte), 'l\'empreinte de test doit remplacer celle du fichier');
  new Function('window', 'document', 'localStorage', 'sessionStorage', 'location', 'TextEncoder', code)(
    fenetre, faussePage, local, session, lieu, TextEncoder);
  return { api: fenetre.MelusineAcces, redirections, styles, local, session };
}

// ── Empreinte et code ────────────────────────────────────────────────────────

test('le fichier contient une empreinte SHA-256 (64 caractères hexadécimaux), pas un mot en clair', () => {
  assert.match(source, /var EMPREINTE = '[0-9a-f]{64}';/);
});

test('verifier : le bon code est accepté', async () => {
  const { api } = charger();
  assert.equal(await api.verifier(CODE_TEST), true);
});

test('verifier : majuscules et espaces autour sont tolérés', async () => {
  const { api } = charger();
  assert.equal(await api.verifier('  Code-De-TEST  '), true);
});

test('verifier : un mauvais code, un code vide ou presque juste sont refusés', async () => {
  const { api } = charger();
  for (const faux of ['', '   ', 'code-de-tes', 'code-de-test!', 'autre', CODE_TEST + ' x']) {
    assert.equal(await api.verifier(faux), false, '« ' + faux + ' » ne doit pas passer');
  }
});

// ── Garde des pages ──────────────────────────────────────────────────────────

test('garde : sans jeton, une page protégée est cachée et renvoie vers index.html', () => {
  const { redirections, styles } = charger({ page: 'programme.html' });
  assert.deepEqual(redirections, ['index.html']);
  assert.ok(styles.some((s) => s.includes('visibility:hidden')), 'la page doit être cachée pendant la redirection');
});

test('garde : toutes les pages du site sont protégées', () => {
  for (const page of ['accueil-2027.html', 'programme.html', 'infos.html', 'benevoles.html', 'espace-mj.html', 'mes-inscriptions.html', 'admin.html', 'aide.html']) {
    assert.deepEqual(charger({ page }).redirections, ['index.html'], page + ' devrait être protégée');
  }
});

test('garde : la page publique (index.html et la racine) n\'est jamais redirigée', () => {
  assert.deepEqual(charger({ page: 'index.html' }).redirections, []);
  assert.deepEqual(charger({ page: '' }).redirections, []);
});

test('garde : un jeton valide laisse passer', () => {
  const local = fauxStockage(false, { melusine_acces: EMPREINTE_TEST });
  const { redirections, styles } = charger({ page: 'programme.html', local });
  assert.deepEqual(redirections, []);
  assert.deepEqual(styles, []);
});

test('garde : un jeton d\'un ancien code est refusé (changer le code déconnecte tout le monde)', () => {
  const local = fauxStockage(false, { melusine_acces: empreinteDe('ancien-code') });
  assert.deepEqual(charger({ page: 'programme.html', local }).redirections, ['index.html']);
});

test('garde : un jeton quelconque ou vide est refusé', () => {
  for (const valeur of ['1', 'true', '', EMPREINTE_TEST.toUpperCase()]) {
    const local = fauxStockage(false, { melusine_acces: valeur });
    assert.deepEqual(charger({ page: 'infos.html', local }).redirections, ['index.html'], '« ' + valeur + ' »');
  }
});

// ── Jeton et stockage ────────────────────────────────────────────────────────

test('accorder : enregistre le jeton, qui ouvre ensuite les pages', () => {
  const premier = charger({ page: 'index.html' });
  assert.equal(premier.api.estAccorde(), false);
  assert.equal(premier.api.accorder(), true);
  assert.equal(premier.local.donnees.melusine_acces, EMPREINTE_TEST);
  const suivant = charger({ page: 'programme.html', local: premier.local, session: premier.session });
  assert.deepEqual(suivant.redirections, []);
  assert.equal(suivant.api.estAccorde(), true);
});

test('stockage local bloqué : le jeton passe par sessionStorage', () => {
  const local = fauxStockage(true);
  const session = fauxStockage();
  const { api } = charger({ page: 'index.html', local, session });
  assert.equal(api.accorder(), true);
  assert.equal(session.donnees.melusine_acces, EMPREINTE_TEST);
  assert.deepEqual(charger({ page: 'programme.html', local, session }).redirections, []);
});

test('tout stockage bloqué : accorder() le signale (le site peut afficher un message)', () => {
  const { api } = charger({ page: 'index.html', local: fauxStockage(true), session: fauxStockage(true) });
  assert.equal(api.accorder(), false);
  assert.equal(api.estAccorde(), false);
});

test('revoquer : supprime le jeton', () => {
  const premier = charger({ page: 'index.html' });
  premier.api.accorder();
  premier.api.revoquer();
  assert.equal(premier.api.estAccorde(), false);
  assert.deepEqual(charger({ page: 'programme.html', local: premier.local, session: premier.session }).redirections, ['index.html']);
});

test('la page d\'arrivée de l\'équipe est celle de la maquette validée', () => {
  const { api } = charger();
  assert.equal(api.PAGE_EQUIPE, 'accueil-2027.html');
  assert.equal(api.PAGE_PUBLIQUE, 'index.html');
});
