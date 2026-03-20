// =============================================================================
// SOUS L'ŒIL DE MÉLUSINE — Code JavaScript partagé (app.js)
// =============================================================================
// Ce fichier contient le code commun à toutes les pages du site :
//   - Configuration (URLs, IDs)
//   - Helpers (escHtml, esc, callAPI, callAPIPost, toast)
//   - Authentification (login, logout, SSO Google/Discord)
//   - Navigation (menu responsive, scroll)
//   - Gestion des rôles (get_role, redirection selon rôle)
//
// Importé par : index.html, espace-mj.html, admin.html
// =============================================================================

(function() {
'use strict';

// =============================================================================
// 📌 CONFIGURATION
// =============================================================================
const SHEET_ID = '1x_XBv6Y6nih-SevBIE6KRGmg9eDoSGyNpi9VwFHcHjM';
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby01lYf4lSk5Du1Bx1eJp1W5vXyhH-sFL_DbtY5PPBSYA5veBJiLQnNbFvubxN8TIZq/exec';
const GOOGLE_CLIENT_ID = '274189183408-qgjihd7cg6k6tbb4gomeq44gbarih723.apps.googleusercontent.com';
const DISCORD_CLIENT_ID = '1477424032532922530';
// =============================================================================

// ── État global ─────────────────────────────────────────────────────────────
// Stocké en localStorage pour persister entre les pages et les sessions.
let currentUser = JSON.parse(localStorage.getItem('melusine_user') || 'null');
let currentRole = localStorage.getItem('melusine_role') || 'joueur';
let accompagnants = JSON.parse(localStorage.getItem('melusine_accompagnants') || '[]');
let pendingInscription = null;
let pendingSSOUser = null;

// Exposer l'état global en lecture pour les pages spécifiques
window.APP = {
    get currentUser() { return currentUser; },
    get currentRole() { return currentRole; },
    get accompagnants() { return accompagnants; },
    set accompagnants(val) { accompagnants = val; },
    SCRIPT_URL: SCRIPT_URL,
    SHEET_ID: SHEET_ID
};

// ── Google Sheets CSV (fallback) ────────────────────────────────────────────
function getSheetCSV(tab) {
    return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}&_t=${Date.now()}`;
}

/**
 * Récupère les données d'un onglet Google Sheet.
 * Stratégie : backend Apps Script d'abord, puis fallback CSV.
 */
async function fetchSheetData(tab) {
    if (SCRIPT_URL) {
        try {
            var result = await callAPI({ action: 'get_sheet', tab: tab });
            if (result.ok && result.data) return result.data;
        } catch(e) { /* fallback sur CSV */ }
    }
    if (!SHEET_ID) return null;
    try {
        var resp = await fetch(getSheetCSV(tab), { cache: 'no-store' });
        var text = await resp.text();
        var parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
        return parsed.data;
    } catch(e) { return null; }
}

async function fetchConfig() {
    var data = await fetchSheetData('config');
    if (!data) return null;
    var c = {};
    data.forEach(row => { if (row.cle) c[row.cle.trim()] = (row.valeur || '').trim(); });
    return c;
}

// ── Apps Script API ─────────────────────────────────────────────────────────

/**
 * Appel GET vers le backend Apps Script.
 * Utilisé pour les lectures (programme, inscriptions, accompagnants, etc.).
 */
function callAPI(params) {
    if (!SCRIPT_URL) return Promise.reject(new Error('Backend non configuré'));
    const url = new URL(SCRIPT_URL);
    Object.keys(params).forEach(k => url.searchParams.set(k, params[k]));
    return fetch(url).then(r => r.json()).then(d => { if (d.error) throw new Error(d.error); return d; });
}

/**
 * Appel POST vers le backend Apps Script.
 * Utilisé pour les écritures et actions sensibles (admin, inscriptions, MJ).
 */
function callAPIPost(params) {
    if (!SCRIPT_URL) return Promise.reject(new Error('Backend non configuré'));
    return fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(params)
    }).then(r => r.json()).then(d => { if (d.error) throw new Error(d.error); return d; });
}

// ── Sécurité XSS ───────────────────────────────────────────────────────────

/**
 * Échappe les caractères HTML dangereux pour empêcher les injections XSS.
 */
function escHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Échappe une chaîne pour insertion dans un attribut onclick='...'.
 * Gère les apostrophes, backslashes, et retours à la ligne.
 */
function esc(s) {
    return (s||'').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '');
}

// ── Toasts ──────────────────────────────────────────────────────────────────
function toast(msg, type='info') {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    document.getElementById('toasts').appendChild(el);
    setTimeout(() => { el.style.opacity='0'; setTimeout(() => el.remove(), 300); }, 4000);
}

// ── Rôles ───────────────────────────────────────────────────────────────────

/**
 * Récupère le rôle de l'utilisateur depuis le backend et le stocke.
 * Appelé après chaque connexion.
 */
async function fetchRole() {
    if (!currentUser || !SCRIPT_URL) return 'joueur';
    try {
        var r = await callAPI({ action: 'get_role', email: currentUser.email, nom: currentUser.nom });
        currentRole = r.role || 'joueur';
        localStorage.setItem('melusine_role', currentRole);
        return currentRole;
    } catch(e) { return 'joueur'; }
}

/**
 * Met à jour la navigation selon le rôle de l'utilisateur.
 * Affiche/masque les liens Espace MJ et Admin.
 */
function updateNavForRole() {
    var mjLink = document.getElementById('navMjLink');
    var adminLink = document.getElementById('navAdminLink');
    if (mjLink) mjLink.style.display = (currentRole === 'mj' || currentRole === 'admin') ? '' : 'none';
    if (adminLink) adminLink.style.display = currentRole === 'admin' ? '' : 'none';
}

// ── Auth ────────────────────────────────────────────────────────────────────

function setUser(user) {
    currentUser = user;
    localStorage.setItem('melusine_user', JSON.stringify(user));
    // Récupérer le rôle puis mettre à jour la nav
    fetchRole().then(function() {
        updateNavUser();
        updateNavForRole();
        // Appeler le callback de la page si défini
        if (window.onUserLogin) window.onUserLogin();
    });
    closeAuthModal();
}

function logout() {
    currentUser = null;
    currentRole = 'joueur';
    accompagnants = [];
    localStorage.removeItem('melusine_user');
    localStorage.removeItem('melusine_role');
    localStorage.removeItem('melusine_accompagnants');
    updateNavUser();
    updateNavForRole();
    // Appeler le callback de la page si défini
    if (window.onUserLogout) window.onUserLogout();
}

function updateNavUser() {
    const area = document.getElementById('navUserArea');
    if (!area) return;
    if (currentUser) {
        area.innerHTML = `<div class="nav-user"><span class="nav-user-name" title="${escHtml(currentUser.email)}" onclick="editPseudo()" style="cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px">${escHtml(currentUser.nom)}</span><button class="nav-user-btn logout" onclick="logout()">Déco</button></div>`;
    } else {
        area.innerHTML = `<button class="nav-user-btn" onclick="openAuthModal()">Se connecter</button>`;
    }
}

function openAuthModal(creneau, jeu) {
    if (creneau && jeu) {
        pendingInscription = { creneau, jeu };
        document.getElementById('modalGame').textContent = jeu;
        document.getElementById('modalSubtext').textContent = `Créneau : ${creneau}`;
    } else {
        document.getElementById('modalGame').textContent = '';
        document.getElementById('modalSubtext').textContent = 'Connectez-vous pour gérer vos inscriptions';
    }
    showAuthOptions();
    document.getElementById('authModal').classList.add('active');
}

function closeAuthModal() {
    var modal = document.getElementById('authModal');
    if (modal) modal.classList.remove('active');
}

function showAuthOptions() {
    document.getElementById('authOptions').style.display='flex';
    document.getElementById('emailForm').classList.remove('active');
    document.getElementById('pseudoForm').classList.remove('active');
    // Cacher le conteneur du bouton Google si présent
    var googleBtn = document.getElementById('googleBtnContainer');
    if (googleBtn) googleBtn.style.display = 'none';
}

function showEmailForm() {
    document.getElementById('authOptions').style.display='none';
    document.getElementById('emailForm').classList.add('active');
    document.getElementById('pseudoForm').classList.remove('active');
    document.getElementById('inputNom').focus();
}

function showPseudoForm(ssoUser) {
    pendingSSOUser = ssoUser;
    document.getElementById('authOptions').style.display='none';
    document.getElementById('emailForm').classList.remove('active');
    document.getElementById('pseudoForm').classList.add('active');
    document.getElementById('inputPseudo').value = ssoUser.nom;
    document.getElementById('inputPseudo').focus();
    document.getElementById('inputPseudo').select();
    const provider = ssoUser.auth_type === 'google' ? 'Google' : 'Discord';
    document.getElementById('pseudoHint').textContent = `Connecté·e via ${provider} (${ssoUser.email}). Choisissez votre pseudo :`;
}

function confirmPseudo() {
    const pseudo = document.getElementById('inputPseudo').value.trim();
    if (!pseudo) { toast('Entrez un pseudo', 'error'); return; }
    if (!pendingSSOUser) { toast('Erreur, réessayez', 'error'); showAuthOptions(); return; }
    pendingSSOUser.nom = pseudo;
    setUser(pendingSSOUser);
    pendingSSOUser = null;
    toast(`Bienvenue ${pseudo} !`, 'success');
}

window.handleGoogleLogin = function(response) {
    const p = JSON.parse(atob(response.credential.split('.')[1]));
    showPseudoForm({ nom: p.name||p.given_name||'', email: p.email, auth_type:'google', auth_id:p.sub });
};

// Flag pour ne pas initialiser Google SSO plusieurs fois
var _googleInitialized = false;

/**
 * Connexion Google : utilise renderButton() au lieu de prompt().
 * prompt() (FedCM/One Tap) est instable sur Chrome récent — il se fait
 * bloquer ou annuler silencieusement. renderButton() affiche un vrai
 * bouton Google dans le modal, beaucoup plus fiable.
 */
function loginGoogle() {
    if (!GOOGLE_CLIENT_ID) { toast('SSO Google non configuré — utilisez pseudo/email', 'info'); showEmailForm(); return; }

    // Masquer les options d'auth et afficher un conteneur pour le bouton Google
    document.getElementById('authOptions').style.display = 'none';
    // Créer ou réutiliser le conteneur du bouton Google
    var container = document.getElementById('googleBtnContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'googleBtnContainer';
        container.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:16px;padding:20px 0';
        container.innerHTML = '<p style="font-size:15px;color:var(--text-light);text-align:center">Cliquez sur le bouton Google ci-dessous :</p><div id="googleBtnTarget"></div><p style="font-size:14px;color:var(--text-muted);cursor:pointer" onclick="showAuthOptions()">← Retour</p>';
        document.getElementById('authOptions').parentNode.insertBefore(container, document.getElementById('authOptions').nextSibling);
    }
    container.style.display = 'flex';

    // Initialiser une seule fois
    if (!_googleInitialized) {
        google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleGoogleLogin });
        _googleInitialized = true;
    }

    // Rendre le bouton Google officiel dans le conteneur
    var target = document.getElementById('googleBtnTarget');
    target.innerHTML = '';
    google.accounts.id.renderButton(target, {
        theme: 'filled_black',
        size: 'large',
        text: 'signin_with',
        shape: 'pill',
        width: 280
    });
}

function loginDiscord() {
    if (!DISCORD_CLIENT_ID || !SCRIPT_URL) { toast('SSO Discord non configuré — utilisez pseudo/email', 'info'); showEmailForm(); return; }
    const redirectUri = encodeURIComponent(window.location.origin + window.location.pathname);
    window.location.href = 'https://discord.com/api/oauth2/authorize?client_id=' + DISCORD_CLIENT_ID + '&redirect_uri=' + redirectUri + '&response_type=code&scope=identify%20email';
}

function loginEmail() {
    const nom = document.getElementById('inputNom').value.trim();
    const email = document.getElementById('inputEmail').value.trim();
    if (!nom) { toast('Entrez votre pseudo', 'error'); return; }
    if (!email || !email.includes('@')) { toast('Email invalide', 'error'); return; }
    setUser({ nom, email, auth_type:'email', auth_id:'' });
    toast(`Bienvenue ${nom} !`, 'success');
}

function checkAuthCallback() {
    const p = new URLSearchParams(location.search);
    if (p.get('code') && !p.get('auth')) {
        const code = p.get('code');
        const redirectUri = window.location.origin + window.location.pathname;
        history.replaceState({}, '', location.pathname + location.hash);
        toast('Connexion Discord en cours...', 'info');
        callAPI({ action: 'discord_exchange', code: code, redirect_uri: redirectUri })
            .then(data => {
                document.getElementById('authModal').classList.add('active');
                showPseudoForm({ nom: data.nom || '', email: data.email || '', auth_type: 'discord', auth_id: data.auth_id || '' });
            })
            .catch(err => toast('Erreur Discord : ' + err.message, 'error'));
        return;
    }
    if (p.get('auth') === 'discord') {
        const ssoUser = { nom: p.get('nom')||'', email: p.get('email')||'', auth_type:'discord', auth_id: p.get('auth_id')||'' };
        history.replaceState({}, '', location.pathname + location.hash);
        document.getElementById('authModal').classList.add('active');
        showPseudoForm(ssoUser);
    }
    if (p.get('error')) { toast('Erreur : ' + p.get('error'), 'error'); history.replaceState({}, '', location.pathname + location.hash); }
}

function editPseudo() {
    if (!currentUser) return;
    document.getElementById('authModal').classList.add('active');
    document.getElementById('authOptions').style.display='none';
    document.getElementById('emailForm').classList.remove('active');
    document.getElementById('pseudoForm').classList.add('active');
    document.getElementById('inputPseudo').value = currentUser.nom;
    document.getElementById('inputPseudo').focus();
    document.getElementById('inputPseudo').select();
    pendingSSOUser = { ...currentUser };
    document.getElementById('pseudoHint').textContent = 'Modifier votre pseudo :';
}

// ── UI commune ──────────────────────────────────────────────────────────────

function initCommonUI() {
    // Scroll effects
    window.addEventListener('scroll', () => {
        var nav = document.getElementById('nav');
        if (nav) nav.classList.toggle('scrolled', scrollY>50);
        var scrollTop = document.getElementById('scrollTop');
        if (scrollTop) scrollTop.classList.toggle('visible', scrollY>500);
    });

    // Navigation active section highlighting
    var allSections = document.querySelectorAll('section[id]');
    if (allSections.length) {
        window.addEventListener('scroll', () => {
            const y = scrollY+100;
            allSections.forEach(s => {
                const link = document.querySelector(`.nav-links a[href="#${s.id}"]`);
                if (link) { if (y>=s.offsetTop&&y<s.offsetTop+s.offsetHeight) { document.querySelectorAll('.nav-links a').forEach(a=>a.classList.remove('active')); link.classList.add('active'); } }
            });
        });
    }

    // Menu mobile toggle
    var navToggle = document.getElementById('navToggle');
    if (navToggle) {
        navToggle.addEventListener('click', function() {
            this.classList.toggle('open');
            document.getElementById('navLinks').classList.toggle('open');
        });
        document.querySelectorAll('.nav-links a').forEach(l => l.addEventListener('click', () => {
            navToggle.classList.remove('open');
            document.getElementById('navLinks').classList.remove('open');
        }));
    }

    // Scroll to top
    var scrollTopBtn = document.getElementById('scrollTop');
    if (scrollTopBtn) scrollTopBtn.addEventListener('click', () => window.scrollTo({ top:0, behavior:'smooth' }));

    // Modals — fermer en cliquant à l'extérieur
    var authModal = document.getElementById('authModal');
    if (authModal) authModal.addEventListener('click', e => { if (e.target===e.currentTarget) closeAuthModal(); });
    var choixModal = document.getElementById('choixModal');
    if (choixModal) choixModal.addEventListener('click', e => { if (e.target===e.currentTarget) closeChoixModal(); });

    // Scroll animations
    var obs = new IntersectionObserver(entries => {
        entries.forEach((e,i) => {
            if (e.isIntersecting) { setTimeout(()=>e.target.classList.add('visible'), i*100); obs.unobserve(e.target); }
        });
    }, { threshold:0.1 });
    document.querySelectorAll('.animate-on-scroll').forEach(el => obs.observe(el));
}

function closeChoixModal() {
    var modal = document.getElementById('choixModal');
    if (modal) modal.classList.remove('active');
}

// ── Init commune ────────────────────────────────────────────────────────────

async function initApp() {
    checkAuthCallback();
    updateNavUser();
    if (currentUser) {
        await fetchRole();
    }
    updateNavForRole();
    initCommonUI();
    // Appeler l'init spécifique de la page si définie
    if (window.onPageInit) await window.onPageInit();
}

document.addEventListener('DOMContentLoaded', initApp);

// ── Exports window ──────────────────────────────────────────────────────────
// Nécessaires pour les handlers onclick dans le HTML

window.openAuthModal = openAuthModal;
window.closeAuthModal = closeAuthModal;
window.closeChoixModal = closeChoixModal;
window.showAuthOptions = showAuthOptions;
window.showEmailForm = showEmailForm;
window.showPseudoForm = showPseudoForm;
window.confirmPseudo = confirmPseudo;
window.editPseudo = editPseudo;
window.loginGoogle = loginGoogle;
window.loginDiscord = loginDiscord;
window.loginEmail = loginEmail;
window.logout = logout;
window.toast = toast;
window.escHtml = escHtml;
window.esc = esc;
window.callAPI = callAPI;
window.callAPIPost = callAPIPost;
window.fetchSheetData = fetchSheetData;
window.fetchConfig = fetchConfig;
window.fetchRole = fetchRole;

})();
