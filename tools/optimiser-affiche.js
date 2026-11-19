// =============================================================================
// optimiser-affiche.js — Redimensionne l'affiche et l'enregistre en WebP optimisé
// =============================================================================
// Rôle : produire img/affiche-2027.webp (léger, adapté au web) à partir de l'affiche
// d'origine (JPEG ou PNG) de docs/. À relancer quand l'affiche est mise à jour
// (par exemple avec le lettrage final).
//
// Aucune dépendance à installer : le script pilote Google Chrome (déjà installé) par son
// protocole DevTools, avec Node 22 ou plus (WebSocket intégré).
//
// Usage :
//   node tools/optimiser-affiche.js <image source> [<fichier de sortie>] [<largeur>] [<qualité 1-100>]
// Exemple (valeurs par défaut) :
//   node tools/optimiser-affiche.js docs/AfficheSOM27_base.jpeg img/affiche-2027.webp 960 80
//
// Contrôle de poids : le script prévient si le fichier dépasse 150 Ko (limite fixée pour
// ne pas alourdir la page d'accueil). Baisser la qualité ou la largeur si besoin.
// =============================================================================

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const [, , source, sortie = 'img/affiche-2027.webp', largeurArg = '960', qualiteArg = '80'] = process.argv;
if (!source) {
  console.error('Usage : node tools/optimiser-affiche.js <image source> [<sortie>] [<largeur>] [<qualité>]');
  process.exit(1);
}
const largeur = Number(largeurArg);
const qualite = Number(qualiteArg);

// Chemins possibles de Chrome ou Edge selon la machine
const candidats = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const navigateur = candidats.find((c) => fs.existsSync(c));
if (!navigateur) { console.error('Chrome ou Edge introuvable (définir CHROME_PATH).'); process.exit(1); }

const octets = fs.readFileSync(source);
const mime = /\.png$/i.test(source) ? 'image/png' : /\.webp$/i.test(source) ? 'image/webp' : 'image/jpeg';
const dataUrl = 'data:' + mime + ';base64,' + octets.toString('base64');

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9500 + Math.floor(Math.random() * 400);
const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-affiche-'));
const chrome = spawn(navigateur, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
  '--remote-debugging-port=' + port, '--user-data-dir=' + profil, 'about:blank'], { stdio: 'ignore' });

async function main() {
  let cible = null;
  for (let i = 0; i < 60 && !cible; i++) {
    await attendre(500);
    try { cible = (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()).find((t) => t.type === 'page'); } catch (e) { /* démarrage */ }
  }
  if (!cible) throw new Error('Chrome ne répond pas');
  const ws = new WebSocket(cible.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const attente = new Map();
  ws.addEventListener('message', (m) => { const x = JSON.parse(m.data); if (x.id && attente.has(x.id)) { attente.get(x.id)(x); attente.delete(x.id); } });
  const cmd = (method, params = {}) => new Promise((res) => { const n = ++id; attente.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });

  await cmd('Page.enable');
  // 1) Charger l'image pour connaître ses dimensions
  await cmd('Emulation.setDeviceMetricsOverride', { width: 800, height: 800, deviceScaleFactor: 1, mobile: false });
  await cmd('Page.navigate', { url: 'about:blank' });
  await attendre(300);
  const dims = (await cmd('Runtime.evaluate', {
    awaitPromise: true, returnByValue: true,
    expression: `new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => ko('image illisible'); i.src = ${JSON.stringify(dataUrl)}; })`,
  })).result.result.value;
  const hauteur = Math.round(largeur * dims.h / dims.w);

  // 2) Afficher l'image à la taille voulue et la capturer en WebP
  await cmd('Emulation.setDeviceMetricsOverride', { width: largeur, height: hauteur, deviceScaleFactor: 1, mobile: false });
  await cmd('Runtime.evaluate', {
    expression: `document.body.style.margin='0'; document.body.innerHTML='<img id="a" style="display:block;width:${largeur}px;height:${hauteur}px" src=${JSON.stringify(dataUrl)}>';`,
  });
  await cmd('Runtime.evaluate', { awaitPromise: true, expression: `document.getElementById('a').decode()` });
  await attendre(300);
  const r = await cmd('Page.captureScreenshot', { format: 'webp', quality: qualite, clip: { x: 0, y: 0, width: largeur, height: hauteur, scale: 1 } });
  fs.mkdirSync(path.dirname(sortie), { recursive: true });
  fs.writeFileSync(sortie, Buffer.from(r.result.data, 'base64'));
  const taille = fs.statSync(sortie).size;
  console.log(sortie + ' : ' + largeur + 'x' + hauteur + ' px, ' + Math.round(taille / 1024) + ' Ko (source ' + dims.w + 'x' + dims.h + ', ' + Math.round(octets.length / 1024) + ' Ko)');
  if (taille > 150 * 1024) console.warn('ATTENTION : plus de 150 Ko. Baisser la qualité ou la largeur.');
  ws.close();
}

main().catch((e) => { console.error('ERREUR', e.message || e); process.exitCode = 1; })
  .finally(() => { chrome.kill(); try { fs.rmSync(profil, { recursive: true, force: true }); } catch (e) { /* ignoré */ } setTimeout(() => process.exit(), 300); });
