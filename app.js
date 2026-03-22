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

// ── Cache localStorage (stale-while-revalidate) ────────────────────────────
// Affiche les données en cache immédiatement, puis rafraîchit en arrière-plan.
// Réduit le temps d'affichage perçu de ~2-5s (cold start GAS) à ~0ms.
// Le cache expire après 5 minutes (les données sont rafraîchies en background).
var CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Lit une valeur depuis le cache localStorage.
 * Retourne null si absent ou expiré au-delà du TTL x2 (hard expiry).
 */
function cacheGet(key) {
    try {
        var raw = localStorage.getItem('melusine_cache_' + key);
        if (!raw) return null;
        var parsed = JSON.parse(raw);
        // Hard expiry : supprimer le cache après 1 heure (données trop vieilles)
        if (Date.now() - parsed.ts > 60 * 60 * 1000) return null;
        return parsed;
    } catch(e) { return null; }
}

/**
 * Écrit une valeur dans le cache localStorage avec un timestamp.
 */
function cacheSet(key, data) {
    try {
        localStorage.setItem('melusine_cache_' + key, JSON.stringify({ data: data, ts: Date.now() }));
    } catch(e) { /* localStorage plein — silencieux */ }
}

/**
 * Récupère les données d'un onglet Google Sheet.
 * Stratégie stale-while-revalidate :
 *   1. Si cache disponible et pas trop vieux → retourne le cache immédiatement
 *   2. Lance un refresh en arrière-plan pour mettre à jour le cache
 *   3. Si pas de cache → attend la réponse du backend
 */
async function fetchSheetData(tab) {
    var cached = cacheGet('sheet_' + tab);

    // Si cache frais (< TTL), retourner immédiatement + refresh background
    if (cached && (Date.now() - cached.ts < CACHE_TTL)) {
        // Refresh en arrière-plan (fire and forget)
        _fetchSheetFresh(tab).then(function(data) { if (data) cacheSet('sheet_' + tab, data); });
        return cached.data;
    }

    // Pas de cache ou trop vieux → fetch synchrone
    var fresh = await _fetchSheetFresh(tab);
    if (fresh) {
        cacheSet('sheet_' + tab, fresh);
        return fresh;
    }

    // Fallback : retourner le cache périmé plutôt que rien
    return cached ? cached.data : null;
}

/**
 * Fetch frais depuis le backend Apps Script (sans cache).
 */
async function _fetchSheetFresh(tab) {
    if (!SCRIPT_URL) return null;
    try {
        var result = await callAPI({ action: 'get_sheet', tab: tab });
        if (result.ok && result.data) return result.data;
    } catch(e) { /* silencieux */ }
    return null;
}

/**
 * Charge TOUTES les données en un seul appel API.
 * Si l'utilisateur est connecté, inclut aussi ses données privées
 * (inscriptions, accompagnants, bénévolat, propositions MJ, rôle).
 * Réduit le nombre d'appels de 5 à 1 par page.
 * Utilise le cache stale-while-revalidate (5 min).
 * @returns {Object} Données publiques + privées si connecté
 */
async function fetchAllPublic() {
    var cached = cacheGet('all_public');

    if (cached && (Date.now() - cached.ts < CACHE_TTL)) {
        // Refresh en arrière-plan (fire and forget)
        _fetchAllPublicFresh().then(function(data) { if (data) cacheSet('all_public', data); });
        return cached.data;
    }

    var fresh = await _fetchAllPublicFresh();
    if (fresh) {
        cacheSet('all_public', fresh);
        return fresh;
    }
    return cached ? cached.data : null;
}

async function _fetchAllPublicFresh() {
    if (!SCRIPT_URL) return null;
    try {
        // Si connecté, passer l'email pour récupérer les données utilisateur en même temps
        var params = { action: 'get_all_public' };
        if (currentUser && currentUser.email) {
            params.email = currentUser.email;
            params.nom = currentUser.nom || '';
        }
        var result = await callAPI(params);
        if (result.ok) {
            // Si le rôle est retourné, le stocker
            if (result.role) {
                currentRole = result.role;
                localStorage.setItem('melusine_role', currentRole);
            }
            return result;
        }
    } catch(e) { /* silencieux */ }
    return null;
}

// Cache config en mémoire (évite les appels multiples dans la même page)
var _configCacheClient = null;

async function fetchConfig() {
    if (_configCacheClient) return _configCacheClient;
    var data = await fetchSheetData('config');
    if (!data) return null;
    var c = {};
    data.forEach(row => { if (row.cle) c[row.cle.trim()] = (row.valeur || '').trim(); });
    _configCacheClient = c;
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
 * Échappe le HTML mais autorise les balises de mise en forme simples.
 * Utilisé pour les champs de config qui peuvent contenir du formatage
 * (bienvenue_texte, restauration_intro, etc.).
 * Balises autorisées : strong, em, b, i, br, a (avec href https uniquement).
 */
function escHtmlSafe(str) {
    if (!str) return '';
    // D'abord on échappe tout
    var escaped = escHtml(str);
    // Puis on ré-autorise les balises sûres
    escaped = escaped.replace(/&lt;(\/?(strong|em|b|i|br)\s*\/?)&gt;/gi, '<$1>');
    // Ré-autoriser les liens <a href="https://...">texte</a>
    escaped = escaped.replace(/&lt;a\s+href=&quot;(https?:\/\/[^&]*)&quot;[^&]*&gt;/gi, '<a href="$1" target="_blank" rel="noopener">');
    escaped = escaped.replace(/&lt;\/a&gt;/gi, '</a>');
    return escaped;
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
 * Met à jour la navigation selon l'état de connexion.
 * "Mes inscriptions" visible si connecté. Admin via le bouton dans le user area.
 */
function updateNavForRole() {
    var inscriptionsLink = document.getElementById('navInscriptionsLink');
    if (inscriptionsLink) inscriptionsLink.style.display = currentUser ? '' : 'none';
}

// ── Auth ────────────────────────────────────────────────────────────────────

function setUser(user) {
    currentUser = user;
    localStorage.setItem('melusine_user', JSON.stringify(user));
    // Récupérer le rôle puis mettre à jour la nav
    fetchRole().then(function() {
        updateNavUser();
        updateNavForRole();

        // Rediriger vers la page d'origine si on vient d'un SSO (Discord)
        var returnPage = localStorage.getItem('melusine_return_page');
        if (returnPage) {
            localStorage.removeItem('melusine_return_page');
            // Rediriger seulement si on est sur une autre page
            if (window.location.href !== returnPage) {
                window.location.href = returnPage;
                return;
            }
        }

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
        var adminBtn = currentRole === 'admin' ? `<a href="admin.html" class="nav-user-btn" style="font-size:11px;padding:4px 10px">Admin</a>` : '';
        area.innerHTML = `<div class="nav-user"><span class="nav-user-name" title="${escHtml(currentUser.email)}" onclick="editPseudo()" style="cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px">${escHtml(currentUser.nom)}</span>${adminBtn}<button class="nav-user-btn logout" onclick="logout()">Déco</button></div>`;
    } else {
        area.innerHTML = `<button class="nav-user-btn" onclick="openAuthModal()">Se connecter</button>`;
    }
}

function openAuthModal(creneau, jeu) {
    if (creneau && jeu) {
        pendingInscription = { creneau, jeu };
        // Persister pour survivre aux redirections SSO (Discord, Google)
        localStorage.setItem('melusine_pending', JSON.stringify(pendingInscription));
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

/**
 * Cache tous les formulaires du modal auth.
 * Appelé avant d'afficher un formulaire spécifique.
 */
function hideAllAuthForms() {
    document.getElementById('authOptions').style.display='none';
    document.getElementById('emailForm').classList.remove('active');
    document.getElementById('registerForm').classList.remove('active');
    document.getElementById('pseudoForm').classList.remove('active');
    document.getElementById('forgotForm').classList.remove('active');
    document.getElementById('resetForm').classList.remove('active');
    var googleBtn = document.getElementById('googleBtnContainer');
    if (googleBtn) googleBtn.style.display = 'none';
}

function showAuthOptions() {
    hideAllAuthForms();
    document.getElementById('authOptions').style.display='flex';
}

/**
 * Affiche le formulaire de connexion (email + mot de passe).
 */
function showEmailForm() {
    hideAllAuthForms();
    document.getElementById('emailForm').classList.add('active');
    document.getElementById('inputEmail').focus();
}

/**
 * Affiche le formulaire d'inscription (pseudo + email + mot de passe + confirmation).
 */
function showRegisterForm() {
    hideAllAuthForms();
    document.getElementById('registerForm').classList.add('active');
    document.getElementById('inputRegNom').focus();
}

/**
 * Affiche le formulaire "mot de passe oublié" (saisie email).
 */
function showForgotForm() {
    hideAllAuthForms();
    document.getElementById('forgotForm').classList.add('active');
    document.getElementById('inputForgotEmail').focus();
}

/**
 * Affiche le formulaire de réinitialisation de mot de passe (après clic sur le lien email).
 */
function showResetForm() {
    hideAllAuthForms();
    document.getElementById('resetForm').classList.add('active');
    document.getElementById('inputResetPassword').focus();
}

function showPseudoForm(ssoUser) {
    pendingSSOUser = ssoUser;
    hideAllAuthForms();
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
var _googleScriptLoaded = false;

/**
 * Charge le script Google Identity Services à la demande (lazy-load).
 * Appelé uniquement quand l'utilisateur clique sur "Continuer avec Google".
 * Évite de charger ~50KB de JS Google sur chaque page.
 */
function loadGoogleScript() {
    return new Promise(function(resolve) {
        if (_googleScriptLoaded) { resolve(); return; }
        var script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.onload = function() { _googleScriptLoaded = true; resolve(); };
        script.onerror = function() { toast('Erreur chargement Google — utilisez pseudo/email', 'error'); showEmailForm(); };
        document.head.appendChild(script);
    });
}

/**
 * Connexion Google : charge le script GSI à la demande, puis renderButton().
 */
function loginGoogle() {
    if (!GOOGLE_CLIENT_ID) { toast('SSO Google non configuré — utilisez pseudo/email', 'info'); showEmailForm(); return; }

    // Masquer tous les formulaires et afficher le conteneur Google
    hideAllAuthForms();
    var container = document.getElementById('googleBtnContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'googleBtnContainer';
        container.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:16px;padding:20px 0';
        container.innerHTML = '<p style="font-size:15px;color:var(--text-light);text-align:center">Chargement de Google...</p><div id="googleBtnTarget"></div><p style="font-size:14px;color:var(--text-muted);cursor:pointer" onclick="showAuthOptions()">← Retour</p>';
        document.getElementById('authOptions').parentNode.insertBefore(container, document.getElementById('authOptions').nextSibling);
    }
    container.style.display = 'flex';

    // Charger le script Google puis initialiser ET rendre le bouton
    // (tout dans le .then() pour éviter un crash si le script n'est pas encore chargé)
    loadGoogleScript().then(function() {
        if (!_googleInitialized) {
            google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleGoogleLogin });
            _googleInitialized = true;
        }
        container.querySelector('p').textContent = 'Cliquez sur le bouton Google ci-dessous :';

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
    }); // fin loadGoogleScript().then()
}

function loginDiscord() {
    if (!DISCORD_CLIENT_ID || !SCRIPT_URL) { toast('SSO Discord non configuré — utilisez pseudo/email', 'info'); showEmailForm(); return; }
    // Sauvegarder la page de retour pour rediriger après login
    localStorage.setItem('melusine_return_page', window.location.href);
    // Toujours rediriger vers la racine du site (seule URL enregistrée dans Discord)
    var baseUrl = window.location.origin + window.location.pathname.replace(/[^\/]*$/, '');
    const redirectUri = encodeURIComponent(baseUrl);
    window.location.href = 'https://discord.com/api/oauth2/authorize?client_id=' + DISCORD_CLIENT_ID + '&redirect_uri=' + redirectUri + '&response_type=code&scope=identify%20email';
}

/**
 * Connexion par email + mot de passe.
 * Envoie les identifiants en POST au backend pour vérification.
 * En cas de succès, appelle setUser() comme pour les SSO.
 */
async function loginEmail() {
    var email = document.getElementById('inputEmail').value.trim();
    var password = document.getElementById('inputPassword').value;
    if (!email || !email.includes('@')) { toast('Email invalide', 'error'); return; }
    if (!password) { toast('Entrez votre mot de passe', 'error'); return; }

    try {
        var r = await callAPIPost({ action: 'login_email', email: email, password: password });
        if (r.ok) {
            setUser({ nom: r.nom, email: r.email, auth_type: 'email', auth_id: '' });
            toast('Bienvenue ' + r.nom + ' !', 'success');
        }
    } catch(e) {
        toast(e.message, 'error');
    }
}

/**
 * Inscription par pseudo + email + mot de passe.
 * Crée un nouveau compte côté backend, puis connecte l'utilisateur.
 */
async function registerEmail() {
    var nom = document.getElementById('inputRegNom').value.trim();
    var email = document.getElementById('inputRegEmail').value.trim();
    var password = document.getElementById('inputRegPassword').value;
    var confirm = document.getElementById('inputRegConfirm').value;

    if (!nom || nom.length < 2) { toast('Le pseudo doit contenir au moins 2 caractères', 'error'); return; }
    if (!email || !email.includes('@')) { toast('Email invalide', 'error'); return; }
    if (!password || password.length < 6) { toast('Le mot de passe doit contenir au moins 6 caractères', 'error'); return; }
    if (password !== confirm) { toast('Les mots de passe ne correspondent pas', 'error'); return; }

    try {
        var r = await callAPIPost({ action: 'register', nom: nom, email: email, password: password });
        if (r.ok) {
            setUser({ nom: r.nom, email: email, auth_type: 'email', auth_id: '' });
            toast('Compte créé ! Bienvenue ' + r.nom + ' !', 'success');
        }
    } catch(e) {
        toast(e.message, 'error');
    }
}

/**
 * Envoie un email de réinitialisation de mot de passe.
 * Le backend répond toujours "succès" (ne révèle pas si l'email existe).
 */
async function sendForgotPassword() {
    var email = document.getElementById('inputForgotEmail').value.trim();
    if (!email || !email.includes('@')) { toast('Entrez une adresse email valide', 'error'); return; }

    try {
        var r = await callAPIPost({ action: 'forgot_password', email: email });
        toast(r.message || 'Si un compte existe, un email a été envoyé.', 'success');
        // Revenir au formulaire de connexion après 2 secondes
        setTimeout(function() { showEmailForm(); }, 2000);
    } catch(e) {
        toast(e.message, 'error');
    }
}

/**
 * Réinitialise le mot de passe avec le token reçu par email.
 * Le token est lu depuis l'URL (?reset_token=xxx) et stocké dans _resetToken.
 */
var _resetToken = null;

async function submitResetPassword() {
    var password = document.getElementById('inputResetPassword').value;
    var confirm = document.getElementById('inputResetConfirm').value;

    if (!password || password.length < 6) { toast('Le mot de passe doit contenir au moins 6 caractères', 'error'); return; }
    if (password !== confirm) { toast('Les mots de passe ne correspondent pas', 'error'); return; }
    if (!_resetToken) { toast('Token de réinitialisation manquant. Utilisez le lien reçu par email.', 'error'); return; }

    try {
        var r = await callAPIPost({ action: 'reset_password', token: _resetToken, password: password });
        if (r.ok) {
            _resetToken = null;
            // Connecter l'utilisateur automatiquement
            setUser({ nom: r.nom, email: r.email, auth_type: 'email', auth_id: '' });
            toast(r.message || 'Mot de passe mis à jour !', 'success');
        }
    } catch(e) {
        toast(e.message, 'error');
    }
}

function checkAuthCallback() {
    const p = new URLSearchParams(location.search);

    // Détection du token de réinitialisation de mot de passe dans l'URL
    // (l'utilisateur a cliqué sur le lien reçu par email)
    if (p.get('reset_token')) {
        _resetToken = p.get('reset_token');
        // Nettoyer l'URL (ne pas laisser le token visible dans la barre d'adresse)
        history.replaceState({}, '', location.pathname + location.hash);
        // Ouvrir le modal sur le formulaire de reset
        document.getElementById('authModal').classList.add('active');
        showResetForm();
        return;
    }

    if (p.get('code') && !p.get('auth')) {
        const code = p.get('code');
        // Doit correspondre exactement à la redirect_uri envoyée dans loginDiscord()
        var baseUrl = window.location.origin + window.location.pathname.replace(/[^\/]*$/, '');
        const redirectUri = baseUrl;
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
    hideAllAuthForms();
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

    // Hover intent : pré-chauffer GAS au survol des boutons d'inscription
    // Envoie un ping léger pour que le script soit "chaud" quand l'utilisateur clique
    var _pingDone = false;
    document.addEventListener('mouseover', function(e) {
        if (_pingDone) return;
        var btn = e.target.closest('.btn-green, .btn-gold, .btn-primary');
        if (btn && SCRIPT_URL) {
            _pingDone = true;
            fetch(SCRIPT_URL + '?action=ping').catch(function() {});
        }
    });

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

/**
 * Charge le thème depuis la config Sheet et l'applique sur <html>.
 * Valeurs possibles : "dark" (défaut) ou "clair".
 * Le thème est appliqué via data-theme qui switch les CSS variables.
 */
async function loadTheme() {
    try {
        // Utiliser le endpoint groupé (une seule requête pour tout)
        var allData = await fetchAllPublic();
        var config = allData ? allData.config : await fetchConfig();
        if (config && config.theme) {
            var theme = config.theme.trim().toLowerCase();
            if (theme === 'clair' || theme === 'dark') {
                document.documentElement.setAttribute('data-theme', theme);
                // Sauvegarder en localStorage pour les prochains chargements
                // (évite le flash dark → clair au reload)
                localStorage.setItem('melusine_theme', theme);
            }
        }
    } catch(e) { /* silencieux — reste en dark par défaut */ }
}

async function initApp() {
    checkAuthCallback();
    updateNavUser();

    // Un seul appel API charge tout : thème + données publiques + données utilisateur + rôle.
    // fetchAllPublic() passe l'email si connecté → le backend retourne le rôle en bonus.
    // Plus besoin d'appeler fetchRole() séparément.
    await loadTheme();

    updateNavForRole();
    initCommonUI();
    // Appeler l'init spécifique de la page si définie
    if (window.onPageInit) await window.onPageInit();

    // Précharger toutes les pages du site en arrière-plan (fire and forget).
    // Met les HTML + CSS + JS en cache navigateur pour une navigation quasi-instantanée.
    // Exécuté après le rendu de la page courante pour ne pas ralentir le premier affichage.
    prefetchAllPages();
}

/**
 * Précharge toutes les pages et ressources du site en arrière-plan.
 * Utilise fetch() avec priorité basse pour ne pas impacter le chargement en cours.
 * Les fichiers sont mis en cache HTTP du navigateur → les navigations suivantes
 * chargeront depuis le cache local au lieu de faire un aller-retour réseau.
 */
function prefetchAllPages() {
    // Attendre 1 seconde après le rendu pour ne pas concurrencer le contenu visible
    setTimeout(function() {
        var pages = ['index.html', 'programme.html', 'infos.html', 'benevoles.html', 'mes-inscriptions.html', 'espace-mj.html', 'aide.html', 'styles.css', 'app.js?v=2'];
        var current = location.pathname.split('/').pop() || 'index.html';
        pages.forEach(function(page) {
            // Ne pas re-fetcher la page actuelle
            if (page === current) return;
            try {
                // Utiliser <link rel="prefetch"> si supporté (priorité basse native)
                var link = document.createElement('link');
                link.rel = 'prefetch';
                link.href = page;
                document.head.appendChild(link);
            } catch(e) { /* silencieux */ }
        });
    }, 1500);
}

document.addEventListener('DOMContentLoaded', initApp);

// ── Service Worker ──────────────────────────────────────────────────────────
// Enregistre le SW pour cacher les pages et assets du site.
// Le SW intercepte les requêtes et sert depuis le cache local → navigation
// quasi-instantanée entre les pages, même hors ligne.
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function() {});
}

// ── Exports window ──────────────────────────────────────────────────────────
// Nécessaires pour les handlers onclick dans le HTML

window.openAuthModal = openAuthModal;
window.closeAuthModal = closeAuthModal;
window.closeChoixModal = closeChoixModal;
window.showAuthOptions = showAuthOptions;
window.showEmailForm = showEmailForm;
window.showRegisterForm = showRegisterForm;
window.showForgotForm = showForgotForm;
window.showResetForm = showResetForm;
window.showPseudoForm = showPseudoForm;
window.confirmPseudo = confirmPseudo;
window.editPseudo = editPseudo;
window.loginGoogle = loginGoogle;
window.loginDiscord = loginDiscord;
window.loginEmail = loginEmail;
window.registerEmail = registerEmail;
window.sendForgotPassword = sendForgotPassword;
window.submitResetPassword = submitResetPassword;
window.logout = logout;
window.toast = toast;
window.escHtml = escHtml;
window.escHtmlSafe = escHtmlSafe;
window.esc = esc;
window.callAPI = callAPI;
window.callAPIPost = callAPIPost;
window.fetchSheetData = fetchSheetData;
window.fetchConfig = fetchConfig;
window.fetchAllPublic = fetchAllPublic;
window.fetchRole = fetchRole;

})();
