// =============================================================================
// tools/mesurer-chargement.js — Mesure le temps d'affichage de Programme et Bénévoles
// =============================================================================
// Rôle : lancer le site en local (petit serveur Node) dans un vrai Chrome sans fenêtre, charger une
// page plusieurs fois, et noter le temps écoulé jusqu'à ce que le « skeleton » (rectangles grisés
// animés, classe .loading-shimmer) ait disparu. Les requêtes vers Supabase sont RÉELLES (lecture
// seule, clé publique du site, aucune écriture).
//
// Limites :
//   - visiteur NON connecté uniquement (aucun identifiant n'est utilisé) : le parcours « connecté »
//     fait des requêtes en plus, il n'est donc pas mesuré ici ;
//   - les durées dépendent du réseau et de la machine qui lance la mesure : comparer AVANT / APRÈS
//     sur la même machine, pas des chiffres absolus ;
//   - le rideau d'accès équipe est contourné en posant son jeton (public, c'est l'empreinte du dépôt)
//     dans le navigateur de test ; ça ne modifie pas le site.
//
// Utilisation (depuis la racine du dépôt, Node 22 ou plus, Chrome installé) :
//   node tools/mesurer-chargement.js                  → programme.html et benevoles.html, 5 essais
//   node tools/mesurer-chargement.js programme.html 3 → une page, 3 essais
// Chaque essai « à froid » vide le stockage du navigateur ; l'essai « à chaud » recharge ensuite
// la page SANS le vider (pour mesurer l'effet d'un éventuel cache de données).
// =============================================================================

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const RACINE = path.join(__dirname, '..');
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].find((p) => fs.existsSync(p));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.webp': 'image/webp', '.png': 'image/png', '.jpeg': 'image/jpeg' };
const PORT_SITE = 8765;
const PORT_CHROME = 9333;

const pages = process.argv[2] ? [process.argv[2]] : ['programme.html', 'benevoles.html'];
const essais = parseInt(process.argv[3] || '5', 10);

/** Serveur statique minimal : sert les fichiers du dépôt (lecture seule, local uniquement). */
function demarrerServeur() {
  const serveur = http.createServer((req, res) => {
    let demande;
    try { demande = decodeURIComponent(req.url.split('?')[0]); } catch (e) { res.writeHead(400); return res.end(); }
    const chemin = path.join(RACINE, demande);
    // « path.relative » et non « startsWith » : un dossier voisin dont le nom commence pareil
    // (ex. « laguilde-V2-copie ») passerait un simple test de préfixe.
    const relatif = path.relative(RACINE, chemin);
    if (relatif.startsWith('..') || path.isAbsolute(relatif) || !fs.existsSync(chemin) || fs.statSync(chemin).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(chemin)] || 'application/octet-stream' });
    fs.createReadStream(chemin).pipe(res);
  });
  return new Promise((ok) => serveur.listen(PORT_SITE, '127.0.0.1', () => ok(serveur)));
}

const attendre = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** Client minimal du protocole DevTools de Chrome (un seul onglet). */
async function ouvrirOnglet() {
  let liste;
  for (let i = 0; i < 50; i++) {
    try { liste = await (await fetch('http://127.0.0.1:' + PORT_CHROME + '/json')).json(); break; } catch (e) { await attendre(200); }
  }
  const cible = liste && liste.find((t) => t.type === 'page');
  if (!cible) throw new Error('Chrome n\'a pas démarré (port ' + PORT_CHROME + ' occupé, Chrome déjà ouvert avec un autre profil, ou installation introuvable) : fermer les fenêtres Chrome de test et relancer.');
  const ws = new WebSocket(cible.webSocketDebuggerUrl);
  await new Promise((ok) => { ws.onopen = ok; });
  let n = 0; const attente = {}; const ecouteurs = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && attente[msg.id]) { attente[msg.id].ok(msg.error ? Promise.reject(new Error('Chrome : ' + msg.error.message)) : (msg.result || {})); delete attente[msg.id]; }
    else ecouteurs.forEach((f) => f(msg));
  };
  return {
    envoyer: (methode, params) => new Promise((ok) => { const id = ++n; attente[id] = { ok }; ws.send(JSON.stringify({ id, method: methode, params: params || {} })); }),
    ecouter: (f) => { ecouteurs.push(f); return () => { const i = ecouteurs.indexOf(f); if (i >= 0) ecouteurs.splice(i, 1); }; },
    fermer: () => ws.close(),
  };
}

/** Une mesure : charge la page et renvoie { ms, requetesSupabase }. */
async function mesurer(onglet, page, viderStockage) {
  let requetes = 0;
  const retirer = onglet.ecouter((msg) => {
    if (msg.method === 'Network.requestWillBeSent' && /supabase\.co\/(rest|auth)\//.test(msg.params.request.url)) requetes++;
  });
  if (viderStockage) await onglet.envoyer('Storage.clearDataForOrigin', { origin: 'http://127.0.0.1:' + PORT_SITE, storageTypes: 'all' });
  await onglet.envoyer('Network.setCacheDisabled', { cacheDisabled: true });
  const debut = Date.now();
  await onglet.envoyer('Page.navigate', { url: 'http://127.0.0.1:' + PORT_SITE + '/' + page });
  // Sonde toutes les 25 ms : le contenu est « prêt » quand plus aucun skeleton n'est visible
  // ET que la grille principale n'est pas vide.
  for (let i = 0; i < 400; i++) {
    await attendre(25);
    const r = await onglet.envoyer('Runtime.evaluate', {
      expression: "(function(){var g=document.getElementById('programmeGrid')||document.getElementById('benevoleGrid');return !!g && g.innerHTML.trim().length>0 && !g.querySelector('.loading-shimmer');})()",
      returnByValue: true,
    });
    if (r && r.result && r.result.value === true) { retirer(); return { ms: Date.now() - debut, requetes }; }
  }
  retirer();
  return { ms: null, requetes };
}

const mediane = (a) => { const t = a.filter((x) => x !== null).sort((x, y) => x - y); return t.length ? t[Math.floor(t.length / 2)] : null; };

(async () => {
  if (!CHROME) { console.error('Chrome introuvable aux emplacements habituels.'); process.exit(1); }
  const serveur = await demarrerServeur();
  const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'melusine-mesure-'));
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT_CHROME, '--user-data-dir=' + profil, '--no-first-run', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
  try {
    const onglet = await ouvrirOnglet();
    await onglet.envoyer('Page.enable'); await onglet.envoyer('Network.enable'); await onglet.envoyer('Runtime.enable');
    // Jeton du rideau d'accès (valeur publique du dépôt, lue dans acces.js), posé avant tout script de la page.
    const empreinte = /var EMPREINTE = '([0-9a-f]+)'/.exec(fs.readFileSync(path.join(RACINE, 'acces.js'), 'utf8'))[1];
    await onglet.envoyer('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.setItem('melusine_acces','" + empreinte + "')}catch(e){}" });

    for (const page of pages) {
      const froid = []; const chaud = []; let reqFroid = 0; let reqChaud = 0;
      for (let i = 0; i < essais; i++) {
        const a = await mesurer(onglet, page, true); froid.push(a.ms); reqFroid = a.requetes;
        const b = await mesurer(onglet, page, false); chaud.push(b.ms); reqChaud = b.requetes;
      }
      console.log('\n' + page + ' (' + essais + ' essais, visiteur non connecté)');
      console.log('  1re visite   : médiane ' + mediane(froid) + ' ms   [' + froid.join(', ') + ']   requêtes Supabase : ' + reqFroid);
      console.log('  2e visite    : médiane ' + mediane(chaud) + ' ms   [' + chaud.join(', ') + ']   requêtes Supabase : ' + reqChaud);
    }
    onglet.fermer();
  } finally {
    chrome.kill(); serveur.close();
    try { fs.rmSync(profil, { recursive: true, force: true }); } catch (e) { /* profil verrouillé : ignoré */ }
  }
})();
