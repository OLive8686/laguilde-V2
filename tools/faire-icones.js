// =============================================================================
// faire-icones.js — Fabrique les icônes du site (onglet du navigateur, écran d'accueil)
// =============================================================================
// Rôle : produire icons/favicon-32.png, icons/favicon-64.png et icons/apple-touch-icon.png à partir
// du logo de La Guilde, posé sur une plaque crème (le logo contient du bordeaux, illisible sur
// le fond sombre d'un onglet). À relancer si le logo change.
//
// Aucune dépendance : le script pilote Chrome ou Edge (déjà installé) avec Node 22 ou plus.
//
// Usage :   node tools/faire-icones.js [<logo>] [<dossier de sortie>]
// Défauts : node tools/faire-icones.js Logo_guilde_final.webp icons
//
// La plaque des icônes est crème (PLAQUE) : un onglet de navigateur peut être clair ou sombre, on ne peut
// pas choisir la version du logo, donc on lui donne son propre fond.
// =============================================================================

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const [, , logo = 'Logo_guilde_final.webp', dossier = 'icons'] = process.argv;
const PLAQUE = '#fbf3ec';                 // crème
const ICONES = [
  // nom du fichier, côté en px, arrondi (% du côté), part du côté occupée par le logo
  { nom: 'favicon-32.png', cote: 32, arrondi: 22, logo: 0.84 },
  { nom: 'favicon-64.png', cote: 64, arrondi: 22, logo: 0.84 },
  // iOS arrondit lui-même les coins et n'aime pas la transparence : carré plein
  { nom: 'apple-touch-icon.png', cote: 180, arrondi: 0, logo: 0.74 },
];

const candidats = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const navigateur = candidats.find((c) => fs.existsSync(c));
if (!navigateur) { console.error('Chrome ou Edge introuvable (définir CHROME_PATH).'); process.exit(1); }

const mime = /\.png$/i.test(logo) ? 'image/png' : /\.webp$/i.test(logo) ? 'image/webp' : 'image/jpeg';
const dataUrl = 'data:' + mime + ';base64,' + fs.readFileSync(logo).toString('base64');

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9300 + Math.floor(Math.random() * 400);
const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-icones-'));
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
  await cmd('Page.navigate', { url: 'about:blank' });
  await attendre(300);
  fs.mkdirSync(dossier, { recursive: true });
  for (const ic of ICONES) {
    await cmd('Emulation.setDeviceMetricsOverride', { width: ic.cote, height: ic.cote, deviceScaleFactor: 1, mobile: false });
    await cmd('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } }); // coins arrondis transparents
    const taille = Math.round(ic.cote * ic.logo);
    await cmd('Runtime.evaluate', {
      expression: `document.documentElement.style.background='transparent'; document.body.style.cssText='margin:0;background:transparent';
        document.body.innerHTML='<div style="width:${ic.cote}px;height:${ic.cote}px;background:${PLAQUE};border-radius:${ic.arrondi}%;display:flex;align-items:center;justify-content:center"><img id="a" style="width:${taille}px;height:auto;display:block" src=${JSON.stringify(dataUrl)}></div>';`,
    });
    await cmd('Runtime.evaluate', { awaitPromise: true, expression: `document.getElementById('a').decode()` });
    await attendre(200);
    const r = await cmd('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: ic.cote, height: ic.cote, scale: 1 } });
    const fichier = path.join(dossier, ic.nom);
    fs.writeFileSync(fichier, Buffer.from(r.result.data, 'base64'));
    console.log(fichier + ' : ' + ic.cote + 'x' + ic.cote + ' px, ' + fs.statSync(fichier).size + ' octets');
  }
  ws.close();
}

main().catch((e) => { console.error('ERREUR', e.message || e); process.exitCode = 1; })
  .finally(() => { chrome.kill(); try { fs.rmSync(profil, { recursive: true, force: true }); } catch (e) { /* ignoré */ } setTimeout(() => process.exit(), 300); });
