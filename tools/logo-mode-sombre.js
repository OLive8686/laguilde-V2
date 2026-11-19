// =============================================================================
// logo-mode-sombre.js — Fabrique la version « mode sombre » du logo (fond transparent)
// =============================================================================
// Rôle : le logo de La Guilde contient du bordeaux (le dé et le mot « La Guilde »), illisible sur le
// fond sombre du site. Ce script en produit une version où SEUL le bordeaux est éclairci en rose ;
// l'orange, le turquoise et le blanc ne changent pas. Le fond reste transparent : aucune plaque.
// Le site charge cette version quand le thème est sombre (<picture>, prefers-color-scheme).
//
// Principe : chaque pixel dont la teinte est celle du bordeaux (rouge-rose, saturé) voit sa luminosité
// relevée jusqu'à un minimum (LUMINOSITE_MIN). Les pixels déjà plus clairs (traits blancs du dé)
// restent tels quels : la transformation est continue, sans halo.
//
// Aucune dépendance : pilote Chrome ou Edge (déjà installé), Node 22 ou plus.
//
// Usage :   node tools/logo-mode-sombre.js [<logo>] [<sortie>] [<largeur>] [<qualité 1-100>]
// Exemple : node tools/logo-mode-sombre.js Logo_guilde_final.webp img/logo-guilde-sombre-192.webp 192 90
// =============================================================================

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const [, , logo = 'Logo_guilde_final.webp', sortie = 'img/logo-guilde-sombre-192.webp', largeurArg = '192', qualiteArg = '90'] = process.argv;
const largeur = Number(largeurArg);
const qualite = Number(qualiteArg) / 100;
const LUMINOSITE_MIN = 0.72; // luminosité minimale du bordeaux éclairci (≈ 7:1 de contraste sur le fond sombre du site)

const candidats = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const navigateur = candidats.find((c) => fs.existsSync(c));
if (!navigateur) { console.error('Chrome ou Edge introuvable (définir CHROME_PATH).'); process.exit(1); }

const mime = /\.png$/i.test(logo) ? 'image/png' : 'image/webp';
const dataUrl = 'data:' + mime + ';base64,' + fs.readFileSync(logo).toString('base64');

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9200 + Math.floor(Math.random() * 400);
const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-sombre-'));
const chrome = spawn(navigateur, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--remote-debugging-port=' + port, '--user-data-dir=' + profil, 'about:blank'], { stdio: 'ignore' });

// Code exécuté DANS la page : dessine le logo à la bonne taille, éclaircit le bordeaux, exporte en WebP
const TRAITEMENT = `(async () => {
  const img = new Image(); img.src = ${JSON.stringify(dataUrl)}; await img.decode();
  const w = ${largeur}, h = Math.round(w * img.naturalHeight / img.naturalWidth);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h); const p = d.data; let touches = 0;
  for (let i = 0; i < p.length; i += 4) {
    if (p[i + 3] < 8) continue;                       // pixel (presque) transparent : on ne touche pas
    const r = p[i] / 255, gr = p[i + 1] / 255, b = p[i + 2] / 255;
    const mx = Math.max(r, gr, b), mn = Math.min(r, gr, b), l = (mx + mn) / 2, dl = mx - mn;
    if (dl < 0.05) continue;                          // gris, blanc, noir : inchangé
    const s = dl / (1 - Math.abs(2 * l - 1));
    let t = mx === r ? ((gr - b) / dl) % 6 : mx === gr ? (b - r) / dl + 2 : (r - gr) / dl + 4;
    t = (t * 60 + 360) % 360;                          // teinte en degrés
    const bordeaux = (t >= 325 || t <= 14) && s > 0.45;
    if (!bordeaux || l >= ${LUMINOSITE_MIN}) continue;
    const l2 = ${LUMINOSITE_MIN};                      // même teinte et saturation, luminosité relevée
    const c2 = (1 - Math.abs(2 * l2 - 1)) * s, x = c2 * (1 - Math.abs((t / 60) % 2 - 1)), m = l2 - c2 / 2;
    let rr, gg, bb;
    if (t < 60) [rr, gg, bb] = [c2, x, 0]; else if (t < 120) [rr, gg, bb] = [x, c2, 0]; else if (t < 180) [rr, gg, bb] = [0, c2, x];
    else if (t < 240) [rr, gg, bb] = [0, x, c2]; else if (t < 300) [rr, gg, bb] = [x, 0, c2]; else [rr, gg, bb] = [c2, 0, x];
    p[i] = Math.round((rr + m) * 255); p[i + 1] = Math.round((gg + m) * 255); p[i + 2] = Math.round((bb + m) * 255); touches++;
  }
  g.putImageData(d, 0, 0);
  return { dataUrl: c.toDataURL('image/webp', ${qualite}), w, h, touches };
})()`;

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
  const r = (await cmd('Runtime.evaluate', { expression: TRAITEMENT, awaitPromise: true, returnByValue: true })).result;
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
  const v = r.result.value;
  fs.mkdirSync(path.dirname(sortie), { recursive: true });
  fs.writeFileSync(sortie, Buffer.from(v.dataUrl.split(',')[1], 'base64'));
  console.log(sortie + ' : ' + v.w + 'x' + v.h + ' px, ' + Math.round(fs.statSync(sortie).size / 1024 * 10) / 10 + ' Ko, ' + v.touches + ' pixels de bordeaux éclaircis');
  ws.close();
}

main().catch((e) => { console.error('ERREUR', e.message || e); process.exitCode = 1; })
  .finally(() => { chrome.kill(); try { fs.rmSync(profil, { recursive: true, force: true }); } catch (e) { /* ignoré */ } setTimeout(() => process.exit(), 300); });
