// =============================================================================
// Tests du Worker d'e-mails (worker-email.js) — Node seul, aucune dépendance
// =============================================================================
// Lancer :   node --test tests/worker-email.test.js        (Node 18 ou plus)
//
// Ce que ça vérifie :
//   1. escapeHtml() échappe bien &, <, >, " et ' sans toucher aux accents ;
//   2. CHAQUE gabarit d'e-mail affiche en texte (jamais en code) les valeurs
//      saisies par les utilisateurs (pseudo, nom de jeu, créneau, accompagnant) ;
//   3. le sujet et les liens d'agenda ne sont PAS échappés en HTML (un « & » légitime
//      ne doit pas devenir « &amp; » dans un objet de mail ou un titre d'agenda) ;
//   4. l'authentification du Worker (secret du webhook) et la validation des requêtes
//      n'ont pas changé.
//
// Comment le fichier est chargé : worker-email.js est un module Cloudflare
// (« export default »). On le lit tel quel, on remplace « export default » par une
// constante, puis on l'exécute dans une fonction : ainsi on teste EXACTEMENT le code
// qui sera déployé, sans y ajouter d'export réservé aux tests.
// Aucun appel réseau : fetch est remplacé par un faux pour les tests de bout en bout.
// =============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// ── Chargement du Worker ─────────────────────────────────────────────────────

const source = fs.readFileSync(path.join(__dirname, '..', 'worker-email.js'), 'utf8');
assert.ok(source.includes('export default {'), "worker-email.js doit contenir « export default {»");
const loader = new Function(
  source.replace('export default {', 'const __worker = {')
  + '\nreturn { escapeHtml, buildEmail, validateRequest, isValidEmail, worker: __worker };'
);
const { escapeHtml, buildEmail, worker } = loader();

// ── Valeurs hostiles utilisées dans les tests ────────────────────────────────

const SCRIPT = '<script>alert(1)</script>';
const IMG = '<img src=x onerror=alert(1)>';
const QUOTES = '"><b onmouseover="x">cliquez</b>';
const AMP = 'Donjons & Dragons';
const ACCENTS = "Éloïse d'Aubigné — œuvre";

/**
 * Vérifie qu'un HTML ne contient aucune BALISE injectée par les valeurs hostiles.
 * Le texte « onerror=alert(1) » peut apparaître (affiché tel quel, inoffensif) tant que
 * le « < » qui le précède est échappé : seuls les débuts de balise réels sont interdits.
 */
function assertNoInjection(html, contexte) {
  for (const interdit of ['<script', '<img', '<b onmouseover', '"><b']) {
    assert.ok(!html.includes(interdit), contexte + ' : contient « ' + interdit + ' » non échappé');
  }
}

// ── 1. escapeHtml ────────────────────────────────────────────────────────────

test('escapeHtml : les cinq caractères spéciaux', () => {
  assert.equal(escapeHtml('<>&"\''), '&lt;&gt;&amp;&quot;&#39;');
});

test('escapeHtml : <script> devient du texte', () => {
  assert.equal(escapeHtml(SCRIPT), '&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('escapeHtml : pas de double échappement du « & » produit', () => {
  // « & » d'abord : sinon « < » deviendrait « &lt; » puis « &amp;lt; »
  assert.equal(escapeHtml('<'), '&lt;');
  assert.equal(escapeHtml('&amp;'), '&amp;amp;', 'une entité saisie par un utilisateur est affichée telle quelle');
});

test('escapeHtml : accents, emoji et espaces conservés', () => {
  assert.equal(escapeHtml('Éloïse œuvre ✅ 🎲'), 'Éloïse œuvre ✅ 🎲');
});

test('escapeHtml : null, undefined, nombre', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(5), '5');
  assert.equal(escapeHtml(0), '0');
});

// ── 2. Chaque gabarit échappe les valeurs saisies ────────────────────────────

/** Une donnée hostile par champ, pour chaque type d'e-mail (mêmes clés que les gabarits). */
function hostileData() {
  const ligne = { jeu: SCRIPT, creneau: IMG, statut: 'inscrit', nom_accompagnant: QUOTES };
  return {
    confirmation:          { nom: SCRIPT, jeu: IMG, creneau: QUOTES, statut: 'inscrit' },
    confirmation_attente:  { nom: SCRIPT, jeu: IMG, creneau: QUOTES, statut: 'attente' },
    promotion:             { nom: SCRIPT, jeu: IMG, creneau: QUOTES },
    annulation:            { nom: SCRIPT, jeu: IMG, creneau: QUOTES },
    accompagnant_supprime: { nomAccompagnant: SCRIPT, nbAnnulees: 2 },
    table_validee:         { jeu: SCRIPT, creneau: IMG },
    table_refusee:         { jeu: SCRIPT, creneau: IMG },
    nouvelle_proposition:  { jeu: SCRIPT, mj: IMG, email_mj: QUOTES, creneau: SCRIPT, places: 4 },
    proposition_recue:     { nom: SCRIPT, jeu: IMG, creneau: QUOTES },
    recap: {
      inscriptions: [ligne, { ...ligne, nom_accompagnant: '' }, { ...ligne, statut: 'attente' }],
      benevoles:    [{ creneau: IMG, nom_accompagnant: '' }, { creneau: SCRIPT, nom_accompagnant: QUOTES }],
      tablesMJ:     [{ jeu: SCRIPT, creneau: IMG, statut_table: 'validé' }, { jeu: IMG, creneau: SCRIPT, statut_table: 'en_attente' }],
      repas:        [{ nom_accompagnant: SCRIPT }, { nom: IMG }],
    },
    rappel: {
      nom: SCRIPT,
      jours: ['samedi', 'dimanche'],
      tablesMJ:     [{ jeu: SCRIPT, creneau: IMG, statut_table: 'validé' }],
      inscriptions: [ligne, { ...ligne, nom_accompagnant: '' }],
      benevolats:   [{ creneau: IMG }],
      repas:        [{ nom_accompagnant: QUOTES }],
    },
  };
}

const TYPE_DE = (cle) => (cle === 'confirmation_attente' ? 'confirmation' : cle);

for (const [cle, data] of Object.entries(hostileData())) {
  test('gabarit « ' + cle + ' » : valeurs hostiles affichées comme du texte', () => {
    const { subject, html } = buildEmail(TYPE_DE(cle), data);
    assert.equal(typeof subject, 'string');
    assertNoInjection(html, cle);
    // Au moins une valeur est bien présente, sous forme échappée (elle n'a pas disparu)
    assert.ok(html.includes('&lt;script&gt;') || html.includes('&lt;img'), cle + ' : la valeur échappée est absente du HTML');
  });
}

test('gabarit « recap » : une proposition de table et un repas sont échappés dans toutes les sections', () => {
  const { html } = buildEmail('recap', hostileData().recap);
  assert.ok(html.includes('Mes tables MJ'));
  assert.ok(html.includes('Accompagnants'));
  assert.ok(html.includes('Bénévolat accompagnants'));
  assert.ok(html.includes('Repas du samedi soir'));
  assertNoInjection(html, 'recap');
});

test('gabarit « rappel » : le prénom dans « Bonjour » est échappé', () => {
  const { html } = buildEmail('rappel', { nom: SCRIPT, jours: ['samedi'] });
  assert.ok(html.includes('Bonjour &lt;script&gt;alert(1)&lt;/script&gt;,'));
  assertNoInjection(html, 'rappel');
});

test('esperluette, guillemets et apostrophes : affichés correctement (texte échappé)', () => {
  const { html } = buildEmail('confirmation', { nom: ACCENTS, jeu: AMP, creneau: 'Samedi 10h-13h', statut: 'inscrit' });
  assert.ok(html.includes('Donjons &amp; Dragons'), 'le & doit devenir &amp; dans le HTML');
  assert.ok(html.includes('Éloïse d&#39;Aubigné — œuvre'), 'accents conservés, apostrophe échappée');
});

test('valeurs absentes : aucun « undefined » ni « null » affiché', () => {
  const { html } = buildEmail('nouvelle_proposition', { jeu: null, mj: undefined, email_mj: '', creneau: null, places: null });
  assert.ok(!html.includes('undefined'));
  assert.ok(!html.includes('null'));
});

// ── 3. Sujet et agenda : PAS d'échappement HTML ──────────────────────────────

test('sujet : texte brut, le « & » n\'est pas échappé', () => {
  const { subject } = buildEmail('confirmation', { nom: 'A', jeu: AMP, creneau: 'Samedi 10h-13h', statut: 'inscrit' });
  assert.ok(subject.includes('Donjons & Dragons'));
  assert.ok(!subject.includes('&amp;'));
});

test('lien Google Agenda : titre encodé en URL, pas en HTML', () => {
  const { html } = buildEmail('confirmation', { nom: 'A', jeu: AMP, creneau: 'Samedi 10h-13h', statut: 'inscrit' });
  assert.ok(html.includes(encodeURIComponent('Donjons & Dragons — Sous l\'Œil de Mélusine')),
    'le titre de l\'agenda doit être encodé avec encodeURIComponent');
  assert.ok(!html.includes('%26amp%3B'), 'le titre de l\'agenda ne doit pas contenir une entité HTML encodée');
});

// ── 4. Non-régression : structure, types, authentification ──────────────────

test('structure : la carte et les libellés existent toujours', () => {
  const { html } = buildEmail('confirmation', { nom: 'Alice', jeu: 'Cthulhu', creneau: 'Samedi 10h-13h', statut: 'inscrit' });
  assert.ok(html.includes('Sous l\'Œil de Mélusine'));
  assert.ok(html.includes('✅ Inscription confirmée !'));
  assert.ok(html.includes('<strong>Pseudo :</strong> Alice'));
  assert.ok(html.includes('<strong>Table :</strong> Cthulhu'));
});

test('type inconnu : exception', () => {
  assert.throws(() => buildEmail('inconnu', {}), /inconnu/);
});

/** Requête POST vers le Worker, avec une IP distincte pour ne pas déclencher la limite par IP. */
let ipCounter = 0;
function requete({ secret, body }) {
  const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.0.0.' + (++ipCounter) };
  if (secret !== undefined) headers['X-Webhook-Secret'] = secret;
  return new Request('https://worker.test/', { method: 'POST', headers, body: JSON.stringify(body) });
}
const ENV = { WEBHOOK_SECRET: 'secret-de-test', MAILERSEND_API_KEY: 'cle-de-test' };
const CORPS_VALIDE = { type: 'confirmation', to: 'joueur@example.invalid', data: { nom: SCRIPT, jeu: AMP, creneau: 'Samedi 10h-13h', statut: 'inscrit' } };

test('authentification : sans secret → 403', async () => {
  const r = await worker.fetch(requete({ body: CORPS_VALIDE }), ENV);
  assert.equal(r.status, 403);
});

test('authentification : mauvais secret → 403', async () => {
  const r = await worker.fetch(requete({ secret: 'faux', body: CORPS_VALIDE }), ENV);
  assert.equal(r.status, 403);
});

test('authentification : secret non configuré côté Worker → 500', async () => {
  const r = await worker.fetch(requete({ secret: 'x', body: CORPS_VALIDE }), { MAILERSEND_API_KEY: 'k' });
  assert.equal(r.status, 500);
});

test('validation : bon secret mais corps invalide → 400, rien n\'est envoyé', async () => {
  let appels = 0;
  const vrai = globalThis.fetch;
  globalThis.fetch = async () => { appels++; return new Response('{}', { status: 202 }); };
  try {
    const r = await worker.fetch(requete({ secret: ENV.WEBHOOK_SECRET, body: { type: 'inconnu', to: 'x@example.invalid' } }), ENV);
    assert.equal(r.status, 400);
    assert.equal(appels, 0);
  } finally { globalThis.fetch = vrai; }
});

test('de bout en bout : un e-mail valide part vers MailerSend avec le HTML échappé', async () => {
  const envois = [];
  const vrai = globalThis.fetch;
  globalThis.fetch = async (url, options) => { envois.push({ url: String(url), options }); return new Response('{}', { status: 202 }); };
  try {
    const r = await worker.fetch(requete({ secret: ENV.WEBHOOK_SECRET, body: CORPS_VALIDE }), ENV);
    assert.equal(r.status, 200);
    assert.equal(envois.length, 1, 'un seul appel sortant attendu');
    assert.ok(envois[0].url.includes('mailersend.com'), 'appel vers MailerSend');
    assert.equal(envois[0].options.headers.Authorization, 'Bearer ' + ENV.MAILERSEND_API_KEY);
    const envoye = JSON.parse(envois[0].options.body);
    assertNoInjection(JSON.stringify(envoye.html || ''), 'corps envoyé à MailerSend');
    assert.ok(String(envoye.subject).includes('Donjons & Dragons'), 'le sujet reste en texte brut');
  } finally { globalThis.fetch = vrai; }
});
