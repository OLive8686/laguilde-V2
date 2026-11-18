// =============================================================================
// Tests de la configuration annuelle (edition.js côté site, bloc EDITION du Worker)
// =============================================================================
// Lancer :   node --test tests/edition.test.js        (Node 18 ou plus, aucune dépendance)
//
// Ce que ça protège, à chaque nouvelle édition :
//   - le samedi est bien un samedi, le dimanche un dimanche (faute de frappe fréquente) ;
//   - les libellés (« samedi 8 mai », « 8 & 9 mai 2027 ») sont calculés correctement ;
//   - le site (edition.js) et le Worker disent la même chose (dates, lieu, année) ;
//   - un lien non renseigné MASQUE son bloc au lieu de laisser un lien cassé ;
//   - les e-mails ne contiennent plus la date de l'année précédente.
// =============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const racine = path.join(__dirname, '..');
const lire = (fichier) => fs.readFileSync(path.join(racine, fichier), 'utf8');

// ── Chargement de edition.js avec un faux navigateur ─────────────────────────

/** Faux élément de page : juste ce dont edition.js a besoin. */
function fauxElement(attributs, avecLien) {
  const lien = avecLien ? { href: null, setAttribute(nom, valeur) { if (nom === 'href') this.href = valeur; } } : null;
  return {
    textContent: '',
    hidden: false,
    getAttribute: (nom) => attributs[nom],
    querySelector: () => lien,
    lien,
  };
}

/**
 * Exécute edition.js dans un faux navigateur.
 * @param {string} [source] - Contenu de edition.js (par défaut le vrai fichier)
 * @param {Array} [elements] - Éléments « data-edition » de la fausse page
 * @param {Array} [blocs] - Éléments « data-edition-link » de la fausse page
 */
function chargerEdition(source = lire('edition.js'), elements = [], blocs = []) {
  const avertissements = [];
  const fenetre = { console: { warn: (m) => avertissements.push(m) } };
  const faussePage = {
    readyState: 'complete',
    addEventListener() {},
    querySelectorAll: (selecteur) => (selecteur === '[data-edition]' ? elements : blocs),
  };
  new Function('window', 'document', 'console', source)(fenetre, faussePage, fenetre.console);
  return { EDITION: fenetre.EDITION, avertissements };
}

// ── Chargement du Worker (même méthode que tests/worker-email.test.js) ───────

function chargerWorker(remplacements = []) {
  let source = lire('worker-email.js');
  for (const [de, vers] of remplacements) {
    assert.ok(source.includes(de), 'motif introuvable dans worker-email.js : ' + de);
    source = source.replace(de, vers);
  }
  const fabrique = new Function(
    source.replace('export default {', 'const __worker = {')
    + '\nreturn { EDITION, buildEmail, libelleJours, decomposeDate };'
  );
  return fabrique();
}

// ── 1. edition.js ────────────────────────────────────────────────────────────

test('edition.js : le samedi est un samedi, le dimanche un dimanche (aucun avertissement)', () => {
  const { avertissements } = chargerEdition();
  assert.deepEqual(avertissements.filter((m) => m.includes('doit être un samedi')), []);
});

test('edition.js : une date de samedi fausse déclenche un avertissement', () => {
  const faux = lire('edition.js').replace("saturday: '2027-05-08'", "saturday: '2027-05-07'");
  const { avertissements } = chargerEdition(faux);
  assert.ok(avertissements.some((m) => m.includes('doit être un samedi')));
});

test('edition.js : libellés calculés à partir des dates', () => {
  const { EDITION } = chargerEdition();
  assert.equal(EDITION.dayLabel('samedi'), 'samedi 8 mai');
  assert.equal(EDITION.dayLabel('dimanche'), 'dimanche 9 mai');
  assert.equal(EDITION.dayLabel('samedi', true), 'Samedi 8 mai');
  assert.equal(EDITION.rangeLabel(), '8 & 9 mai 2027');
});

test('edition.js : période à cheval sur deux mois', () => {
  const faux = lire('edition.js')
    .replace("saturday: '2027-05-08'", "saturday: '2027-05-01'")
    .replace("sunday:   '2027-05-09'", "sunday:   '2027-05-02'");
  const { EDITION } = chargerEdition(faux);
  assert.equal(EDITION.rangeLabel(), '1 & 2 mai 2027');
  const cheval = lire('edition.js')
    .replace("saturday: '2027-05-08'", "saturday: '2027-07-31'")
    .replace("sunday:   '2027-05-09'", "sunday:   '2027-08-01'");
  assert.equal(chargerEdition(cheval).EDITION.rangeLabel(), '31 juillet & 1 août 2027');
});

test('edition.js : remplissage des textes de la page', () => {
  const pied = fauxElement({ 'data-edition': 'range' });
  const lieu = fauxElement({ 'data-edition': 'venue' });
  const jours = fauxElement({ 'data-edition': 'days' });
  const inconnu = fauxElement({ 'data-edition': 'nimportequoi' });
  inconnu.textContent = 'inchangé';
  chargerEdition(lire('edition.js'), [pied, lieu, jours, inconnu]);
  assert.equal(pied.textContent, '8 & 9 mai 2027');
  assert.equal(lieu.textContent, 'Foyer du Porteau, Poitiers');
  const pied2 = fauxElement({ 'data-edition': 'venueDot' });
  chargerEdition(lire('edition.js'), [pied2]);
  assert.equal(pied2.textContent, 'Foyer du Porteau · Poitiers');
  assert.equal(jours.textContent, 'Samedi 8 mai · Dimanche 9 mai');
  assert.equal(inconnu.textContent, 'inchangé', 'une clé inconnue ne touche à rien');
});

test('edition.js : lien non renseigné → bloc masqué (jamais de lien cassé)', () => {
  const bloc = fauxElement({ 'data-edition-link': 'helloassoMeal' }, true);
  const { avertissements } = chargerEdition(lire('edition.js'), [], [bloc]);
  assert.equal(bloc.hidden, true);
  assert.equal(bloc.lien.href, null);
  assert.ok(avertissements.some((m) => m.includes('helloassoMeal')), 'un avertissement signale le lien à renseigner');
});

test('edition.js : lien https valide → bloc visible avec le bon href', () => {
  const source = lire('edition.js').replace("helloassoMeal: ''", "helloassoMeal: 'https://exemple.invalid/repas'");
  const bloc = fauxElement({ 'data-edition-link': 'helloassoMeal' }, true);
  chargerEdition(source, [], [bloc]);
  assert.equal(bloc.hidden, false);
  assert.equal(bloc.lien.href, 'https://exemple.invalid/repas');
});

test('edition.js : un lien javascript: ou http: est refusé', () => {
  for (const mauvais of ['javascript:alert(1)', 'http://exemple.invalid', 'data:text/html,x']) {
    const source = lire('edition.js').replace("helloassoMeal: ''", "helloassoMeal: '" + mauvais + "'");
    const bloc = fauxElement({ 'data-edition-link': 'helloassoMeal' }, true);
    chargerEdition(source, [], [bloc]);
    assert.equal(bloc.hidden, true, mauvais + ' doit masquer le bloc');
    assert.equal(bloc.lien.href, null, mauvais + ' ne doit jamais être posé comme href');
  }
});

// ── 2. Cohérence site ↔ Worker ───────────────────────────────────────────────

test('cohérence : le site et le Worker annoncent les mêmes dates, lieu et année', () => {
  const site = chargerEdition().EDITION;
  const worker = chargerWorker().EDITION;
  assert.equal(worker.saturday, site.saturday);
  assert.equal(worker.sunday, site.sunday);
  assert.equal(worker.year, site.year);
  assert.equal(worker.venueName, site.venueName);
  assert.equal(worker.venueCity, site.venueCity);
  assert.equal(Boolean(worker.helloassoMealUrl), Boolean(site.links.helloassoMeal), 'lien HelloAsso renseigné d\'un côté seulement');
  assert.equal(Boolean(worker.facebookEventUrl), Boolean(site.links.facebookEvent), 'lien Facebook renseigné d\'un côté seulement');
  if (worker.helloassoMealUrl) assert.equal(worker.helloassoMealUrl, site.links.helloassoMeal);
  if (worker.facebookEventUrl) assert.equal(worker.facebookEventUrl, site.links.facebookEvent);
});

// ── 3. Worker : libellés et e-mails ──────────────────────────────────────────

test('Worker : libelleJours', () => {
  const { libelleJours } = chargerWorker();
  assert.equal(libelleJours(['samedi', 'dimanche']), 'samedi 8 et dimanche 9 mai');
  assert.equal(libelleJours(['samedi']), 'samedi 8 mai');
  assert.equal(libelleJours(['dimanche']), 'dimanche 9 mai');
  assert.equal(libelleJours([]), 'les 8 et 9 mai');
});

test('Worker : deux mois différents', () => {
  const { libelleJours } = chargerWorker([
    ["saturday: '2027-05-08'", "saturday: '2027-07-31'"],
    ["sunday:   '2027-05-09'", "sunday:   '2027-08-01'"],
  ]);
  assert.equal(libelleJours(['samedi', 'dimanche']), 'samedi 31 juillet et dimanche 1 août');
  assert.equal(libelleJours([]), 'les 31 juillet et 1 août');
});

test('Worker : le samedi et le dimanche configurés tombent les bons jours', () => {
  const { EDITION, decomposeDate } = chargerWorker();
  assert.equal(decomposeDate(EDITION.saturday).jour, 'samedi');
  assert.equal(decomposeDate(EDITION.sunday).jour, 'dimanche');
});

const RAPPEL = {
  nom: 'Alice', jours: ['samedi', 'dimanche'],
  inscriptions: [{ jeu: 'Cthulhu', creneau: 'Samedi 10h-13h', statut: 'inscrit', nom_accompagnant: '' }],
  repas: [{ nom_accompagnant: '' }],
};

test('Worker : le rappel annonce les dates de l\'édition courante et aucune date 2026', () => {
  const { buildEmail } = chargerWorker();
  const { html } = buildEmail('rappel', RAPPEL);
  assert.ok(html.includes('samedi 8 et dimanche 9 mai'));
  assert.ok(html.includes('Foyer du Porteau, Poitiers'));
  for (const ancien of ['2026', '16 mai', '17 mai', 'Gaschet']) {
    assert.ok(!html.includes(ancien), 'le rappel contient encore « ' + ancien + ' »');
  }
});

test('Worker : valeurs non renseignées → passages masqués (horaires, HelloAsso, Facebook)', () => {
  const { buildEmail, EDITION } = chargerWorker();
  // Cette vérification n'a de sens que tant que les valeurs sont vides (À fournir)
  if (EDITION.horaires || EDITION.helloassoMealUrl || EDITION.facebookEventUrl) return;
  const rappel = buildEmail('rappel', RAPPEL).html;
  assert.ok(!rappel.includes('Horaires'));
  assert.ok(!rappel.includes('HelloAsso'));
  assert.ok(!rappel.includes('facebook'));
  const recap = buildEmail('recap', { repas: [{ nom_accompagnant: '' }] }).html;
  assert.ok(!recap.includes('HelloAsso'));
  assert.ok(!recap.includes('href=""'), 'aucun lien vide dans le récap');
});

test('Worker : valeurs renseignées → passages affichés avec les bons liens', () => {
  const { buildEmail } = chargerWorker([
    ["horaires: '',", "horaires: 'samedi 9h-00h, dimanche 9h-17h',"],
    ["helloassoMealUrl: '',", "helloassoMealUrl: 'https://exemple.invalid/repas',"],
    ["facebookEventUrl: '',", "facebookEventUrl: 'https://exemple.invalid/evenement',"],
  ]);
  const rappel = buildEmail('rappel', RAPPEL).html;
  assert.ok(rappel.includes('<strong>Horaires :</strong> samedi 9h-00h, dimanche 9h-17h'));
  assert.ok(rappel.includes('href="https://exemple.invalid/repas"'));
  assert.ok(rappel.includes('href="https://exemple.invalid/evenement"'));
  const recap = buildEmail('recap', { repas: [{ nom_accompagnant: '' }] }).html;
  assert.ok(recap.includes('href="https://exemple.invalid/repas"'));
});

test('Worker : les liens agenda utilisent les dates de l\'édition', () => {
  const { buildEmail } = chargerWorker();
  const { html } = buildEmail('confirmation', { nom: 'A', jeu: 'Cthulhu', creneau: 'Samedi 10h-13h', statut: 'inscrit' });
  assert.ok(html.includes('dates=20270508T100000/20270508T130000'), 'Google Agenda : samedi 8 mai 2027, 10h-13h');
  const dim = buildEmail('confirmation', { nom: 'A', jeu: 'Cthulhu', creneau: 'Dimanche 14h-17h', statut: 'inscrit' }).html;
  assert.ok(dim.includes('dates=20270509T140000/20270509T170000'), 'Google Agenda : dimanche 9 mai 2027, 14h-17h');
});

// ── 4. Plus aucune date de l'édition précédente dans le code ─────────────────

test('code : aucune date 2026 en dur dans le site ni le Worker (hors archive et page de fin d édition)', () => {
  const fichiers = fs.readdirSync(racine).filter((f) =>
    (/\.(html|js)$/.test(f)) && !['index.2026.html', 'index.html'].includes(f));
  const motifs = [/16 mai/i, /17 mai/i, /16 (&|&amp;) 17/i, /2026-05-1[67]/, /Gérard Gaschet/];
  const trouves = [];
  for (const f of fichiers) {
    lire(f).split(/\r?\n/).forEach((ligne, i) => {
      if (motifs.some((m) => m.test(ligne))) trouves.push(f + ':' + (i + 1) + ' → ' + ligne.trim().slice(0, 90));
    });
  }
  assert.deepEqual(trouves, [], 'dates ou lieux 2026 encore en dur :\n' + trouves.join('\n'));
});
