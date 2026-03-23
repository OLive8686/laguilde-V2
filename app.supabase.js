// =============================================================================
// SOUS L'ŒIL DE MÉLUSINE — Code JavaScript partagé (app.supabase.js)
// =============================================================================
// Version Supabase : remplace Google Apps Script + Cloudflare Worker par
// des appels directs à Supabase (auth + base de données).
//
// Ce fichier contient le code commun à toutes les pages du site :
//   - Configuration (URL Supabase, clé publique)
//   - Helpers (escHtml, esc, toast)
//   - Authentification (login, logout, SSO Google/Discord via Supabase Auth)
//   - Navigation (menu responsive, scroll)
//   - Gestion des rôles (lecture depuis la table profiles)
//   - Chargement des données (requêtes directes Supabase)
//
// Prérequis : le SDK Supabase JS v2 doit être chargé AVANT ce fichier :
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script src="app.supabase.js?v=1"></script>
//
// Importé par : index.html, espace-mj.html, admin.html
// =============================================================================

(function() {
'use strict';

// =============================================================================
// CONFIGURATION SUPABASE
// =============================================================================
// URL du projet Supabase et clé publique (anon key).
// La clé anon est publique — elle ne donne accès qu'aux données autorisées
// par les Row Level Security (RLS) policies définies côté Supabase.
const SUPABASE_URL = 'https://hdbhvwaemrjoantcecuv.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_YGImet9fG8OKLDf_H0GNyQ_SmY5Mo56';

// Initialisation du client Supabase
// window.supabase est fourni par le SDK chargé via <script> dans le HTML.
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// =============================================================================

// ── État global ─────────────────────────────────────────────────────────────
// L'état d'authentification est géré par Supabase (session stockée
// automatiquement dans localStorage par le SDK). On garde des variables
// locales pour un accès rapide depuis le code de la page.
let currentUser = null;   // { nom, email, id } — null si déconnecté
let currentRole = 'joueur';
let accompagnants = [];
let pendingInscription = null;
let pendingSSOUser = null;

// Exposer l'état global en lecture pour les pages spécifiques (espace-mj, admin, etc.)
window.APP = {
    get currentUser() { return currentUser; },
    get currentRole() { return currentRole; },
    get accompagnants() { return accompagnants; },
    set accompagnants(val) { accompagnants = val; },
    SUPABASE_URL: SUPABASE_URL,
    SUPABASE_KEY: SUPABASE_ANON_KEY,
    // Référence au client Supabase pour les pages qui ont besoin de requêtes custom
    get supabase() { return supabase; }
};

// =============================================================================
// SÉCURITÉ XSS
// =============================================================================

/**
 * Échappe les caractères HTML dangereux pour empêcher les injections XSS.
 * @param {string} str - Chaîne à échapper
 * @returns {string} Chaîne échappée
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
 * @param {string} str - Chaîne à échapper partiellement
 * @returns {string} Chaîne avec balises sûres préservées
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
 * @param {string} s - Chaîne à échapper
 * @returns {string} Chaîne sûre pour un attribut onclick
 */
function esc(s) {
    return (s||'').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '');
}

// =============================================================================
// TOASTS (notifications utilisateur)
// =============================================================================

/**
 * Affiche une notification temporaire en bas de l'écran.
 * @param {string} msg - Message à afficher
 * @param {string} type - Type de toast : 'info', 'success', 'error'
 * @param {Object} options - Options supplémentaires (linkText, linkHref)
 */
function toast(msg, type='info', options) {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    if (options && options.linkText && options.linkHref) {
        var link = document.createElement('a');
        link.textContent = ' ' + options.linkText;
        link.href = options.linkHref;
        link.style.cssText = 'color:inherit;font-weight:600;text-decoration:underline;margin-left:6px';
        el.appendChild(link);
    }
    document.getElementById('toasts').appendChild(el);
    setTimeout(() => { el.style.opacity='0'; setTimeout(() => el.remove(), 300); }, 4000);
}

// =============================================================================
// CHARGEMENT DES DONNÉES (remplace callAPI / callAPIPost / fetchAllPublic)
// =============================================================================
// Toutes les lectures passent maintenant par des requêtes directes Supabase.
// Plus besoin de proxy Cloudflare Worker ni de cache localStorage :
// Supabase répond en ~50-100ms (vs ~7s pour Google Apps Script).

/**
 * Charge TOUTES les données publiques + données utilisateur en parallèle.
 * Remplace l'ancien fetchAllPublic() qui faisait un seul appel GAS.
 * Ici on fait plusieurs requêtes Supabase en parallèle (bien plus rapide).
 *
 * @returns {Object} Objet contenant config, programme, inscriptions, etc.
 *   Structure similaire à l'ancien get_all_public pour compatibilité.
 */
async function fetchAllData() {
    try {
        // --- Requêtes publiques (pas besoin d'être connecté) ---
        var queries = [
            // Config : paramètres clé/valeur du site
            supabase.from('config').select('*'),

            // Programme : tables validées ou sans statut (rétro-compatibilité)
            supabase.from('programme').select('*')
                .or('statut_table.eq.validé,statut_table.eq.'),

            // Inscriptions : uniquement les inscriptions actives (pour compter les places)
            // On ne récupère que les colonnes nécessaires pour l'affichage public
            supabase.from('inscriptions').select('nom, creneau, jeu, statut, type_inscrit, nom_accompagnant')
                .in('statut', ['inscrit', 'attente'])
        ];

        // --- Requêtes privées (seulement si connecté) ---
        if (currentUser && currentUser.email) {
            // Mes inscriptions personnelles (toutes, y compris annulées pour l'historique)
            queries.push(
                supabase.from('inscriptions').select('*')
                    .eq('email', currentUser.email)
            );

            // Mes accompagnants
            queries.push(
                supabase.from('accompagnants').select('*')
                    .eq('email_parent', currentUser.email)
            );
        }

        var results = await Promise.all(queries);

        // Extraire les résultats
        var configRows = results[0].data || [];
        var programmeRows = results[1].data || [];
        var inscriptionsRows = results[2].data || [];

        // Construire l'objet config clé/valeur (même format que l'ancien backend)
        var config = {};
        configRows.forEach(function(row) {
            if (row.cle) config[row.cle.trim()] = (row.valeur || '').trim();
        });

        // Construire l'objet de retour compatible avec l'ancien format
        var allData = {
            ok: true,
            config: config,
            programme: programmeRows,
            inscriptions: inscriptionsRows
        };

        // Données privées si connecté
        if (currentUser && currentUser.email && results.length > 3) {
            allData.mes_inscriptions = results[3].data || [];

            if (results.length > 4) {
                var mesAccompagnants = results[4].data || [];
                allData.mes_accompagnants = mesAccompagnants;
                // Stocker les accompagnants localement pour les modals "Pour qui ?"
                accompagnants = mesAccompagnants;
            }
        }

        return allData;
    } catch(e) {
        console.error('fetchAllData erreur:', e);
        return null;
    }
}

// Cache config en mémoire (évite les appels multiples dans la même page)
var _configCacheClient = null;

/**
 * Charge la configuration du site depuis la table config.
 * Mise en cache mémoire : un seul appel réseau par session de page.
 * @returns {Object} Objet clé/valeur de la config
 */
async function fetchConfig() {
    if (_configCacheClient) return _configCacheClient;
    try {
        var { data, error } = await supabase.from('config').select('*');
        if (error) throw error;
        if (!data) return null;
        var c = {};
        data.forEach(function(row) {
            if (row.cle) c[row.cle.trim()] = (row.valeur || '').trim();
        });
        _configCacheClient = c;
        return c;
    } catch(e) {
        console.error('fetchConfig erreur:', e);
        return null;
    }
}

/**
 * Lit les données d'une table Supabase.
 * Remplace l'ancien fetchSheetData() qui lisait un onglet Google Sheet.
 * @param {string} table - Nom de la table Supabase
 * @returns {Array} Lignes de la table
 */
async function fetchSheetData(table) {
    try {
        var { data, error } = await supabase.from(table).select('*');
        if (error) throw error;
        return data || [];
    } catch(e) {
        console.error('fetchSheetData erreur:', e);
        return null;
    }
}

/**
 * Alias de fetchAllData pour compatibilité avec le code existant.
 * Les pages qui appelaient fetchAllPublic() continuent de fonctionner.
 */
async function fetchAllPublic() {
    return fetchAllData();
}

// =============================================================================
// RÔLES
// =============================================================================

/**
 * Récupère le rôle de l'utilisateur depuis la table roles.
 * Appelé après chaque connexion.
 * Si l'utilisateur n'existe pas dans la table, il est considéré comme "joueur".
 *
 * @returns {string} Le rôle de l'utilisateur ('joueur', 'mj', 'admin')
 */
async function fetchRole() {
    if (!currentUser || !currentUser.email) return 'joueur';
    try {
        var { data, error } = await supabase
            .from('roles')
            .select('role')
            .eq('email', currentUser.email)
            .maybeSingle();

        if (error) throw error;

        if (data && data.role) {
            currentRole = data.role;
        } else {
            // Nouveau joueur : créer l'entrée dans roles avec le rôle par défaut
            currentRole = 'joueur';
            await supabase.from('roles').insert({
                email: currentUser.email,
                nom: currentUser.nom || '',
                role: 'joueur',
                date_inscription: new Date().toISOString()
            });
        }
        return currentRole;
    } catch(e) {
        console.error('fetchRole erreur:', e);
        return 'joueur';
    }
}

/**
 * Met à jour la navigation selon l'état de connexion.
 * "Mes inscriptions" visible si connecté. Admin via le bouton dans le user area.
 */
function updateNavForRole() {
    var inscriptionsLink = document.getElementById('navInscriptionsLink');
    if (inscriptionsLink) inscriptionsLink.style.display = currentUser ? '' : 'none';
}

// =============================================================================
// AUTHENTIFICATION (via Supabase Auth)
// =============================================================================
// Supabase gère automatiquement :
//   - Le stockage de la session (localStorage)
//   - Le refresh des tokens JWT
//   - Les callbacks OAuth (Google, Discord)
//   - La réinitialisation de mot de passe par email

/**
 * Met à jour l'état local après connexion.
 * Extrait le nom/email depuis l'objet user Supabase.
 * @param {Object} supabaseUser - Objet user retourné par Supabase Auth
 */
function setUserFromSupabase(supabaseUser) {
    if (!supabaseUser) return;

    // Le nom peut venir de user_metadata (inscription email) ou des données OAuth
    var meta = supabaseUser.user_metadata || {};
    var nom = meta.nom || meta.full_name || meta.name || meta.preferred_username || '';
    var email = supabaseUser.email || '';

    currentUser = {
        id: supabaseUser.id,
        nom: nom,
        email: email
    };
}

/**
 * Finalise la connexion : récupère le rôle, met à jour la nav, appelle les callbacks.
 * Appelé après toute connexion réussie (email, Google, Discord).
 */
async function finalizeLogin() {
    await fetchRole();
    updateNavUser();
    updateNavForRole();

    // Rediriger vers la page d'origine si on vient d'un SSO
    var returnPage = localStorage.getItem('melusine_return_page');
    if (returnPage) {
        localStorage.removeItem('melusine_return_page');
        if (window.location.href !== returnPage) {
            window.location.href = returnPage;
            return;
        }
    }

    // Appeler le callback de la page si défini
    if (window.onUserLogin) window.onUserLogin();
    closeAuthModal();
}

/**
 * Déconnexion : vide la session Supabase + l'état local.
 */
async function logout() {
    try {
        await supabase.auth.signOut();
    } catch(e) {
        console.error('Erreur logout:', e);
    }
    currentUser = null;
    currentRole = 'joueur';
    accompagnants = [];
    updateNavUser();
    updateNavForRole();
    // Appeler le callback de la page si défini
    if (window.onUserLogout) window.onUserLogout();
}

/**
 * Met à jour l'affichage de la zone utilisateur dans la navigation.
 * Si connecté : affiche le pseudo (cliquable pour modifier), bouton admin si admin, bouton déco.
 * Si déconnecté : affiche le bouton "Se connecter".
 */
function updateNavUser() {
    const area = document.getElementById('navUserArea');
    if (!area) return;
    if (currentUser) {
        var adminBtn = currentRole === 'admin' ? '<a href="admin.html" class="nav-user-btn" style="font-size:11px;padding:4px 10px">Admin</a>' : '';
        area.innerHTML = '<div class="nav-user"><span class="nav-user-name" title="' + escHtml(currentUser.email) + '" onclick="editPseudo()" style="cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px">' + escHtml(currentUser.nom) + '</span>' + adminBtn + '<button class="nav-user-btn logout" onclick="logout()">Déco</button></div>';
    } else {
        area.innerHTML = '<button class="nav-user-btn" onclick="openAuthModal()">Se connecter</button>';
    }
}

// ── Modals d'authentification ────────────────────────────────────────────────

/**
 * Ouvre le modal de connexion.
 * Si creneau + jeu sont fournis, l'utilisateur essaie de s'inscrire à une table.
 * @param {string} creneau - Créneau de la table (optionnel)
 * @param {string} jeu - Nom du jeu (optionnel)
 */
function openAuthModal(creneau, jeu) {
    if (creneau && jeu) {
        pendingInscription = { creneau, jeu };
        // Persister pour survivre aux redirections SSO
        localStorage.setItem('melusine_pending', JSON.stringify(pendingInscription));
        document.getElementById('modalGame').textContent = jeu;
        document.getElementById('modalSubtext').textContent = 'Créneau : ' + creneau;
    } else {
        document.getElementById('modalGame').textContent = '';
        document.getElementById('modalSubtext').textContent = 'Connectez-vous pour gérer vos inscriptions';
    }
    showAuthOptions();
    document.getElementById('authModal').classList.add('active');
}

/**
 * Ferme le modal d'authentification.
 */
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

/**
 * Affiche les options d'authentification (choix entre email, Google, Discord).
 */
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
 * Affiche le formulaire de réinitialisation de mot de passe.
 * Utilisé après que l'utilisateur clique sur le lien reçu par email.
 */
function showResetForm() {
    hideAllAuthForms();
    document.getElementById('resetForm').classList.add('active');
    document.getElementById('inputResetPassword').focus();
}

/**
 * Affiche le formulaire de choix de pseudo après un SSO (Google/Discord).
 * Le pseudo proposé par défaut est le nom récupéré du provider.
 * @param {Object} ssoUser - Infos du provider : { nom, email, auth_type }
 */
function showPseudoForm(ssoUser) {
    pendingSSOUser = ssoUser;
    hideAllAuthForms();
    document.getElementById('pseudoForm').classList.add('active');
    document.getElementById('inputPseudo').value = ssoUser.nom;
    document.getElementById('inputPseudo').focus();
    document.getElementById('inputPseudo').select();
    const provider = ssoUser.auth_type === 'google' ? 'Google' : 'Discord';
    document.getElementById('pseudoHint').textContent = 'Connecté·e via ' + provider + ' (' + ssoUser.email + '). Choisissez votre pseudo :';
}

/**
 * Confirme le pseudo choisi après un SSO.
 * Met à jour le user_metadata dans Supabase avec le pseudo choisi.
 */
async function confirmPseudo() {
    const pseudo = document.getElementById('inputPseudo').value.trim();
    if (!pseudo) { toast('Entrez un pseudo', 'error'); return; }

    try {
        // Mettre à jour le pseudo dans Supabase Auth (user_metadata)
        var { error } = await supabase.auth.updateUser({
            data: { nom: pseudo }
        });
        if (error) throw error;

        // Mettre à jour l'état local
        if (currentUser) {
            currentUser.nom = pseudo;
        }

        // Mettre à jour la table roles si elle existe
        if (currentUser && currentUser.email) {
            await supabase.from('roles').upsert({
                email: currentUser.email,
                nom: pseudo,
                role: currentRole || 'joueur',
                date_inscription: new Date().toISOString()
            }, { onConflict: 'email' });
        }

        updateNavUser();
        closeAuthModal();
        toast('Bienvenue ' + pseudo + ' !', 'success');

        // Appeler le callback de la page
        if (window.onUserLogin) window.onUserLogin();
    } catch(e) {
        toast('Erreur : ' + e.message, 'error');
    }
    pendingSSOUser = null;
}

// ── Connexion email/mot de passe ────────────────────────────────────────────

/**
 * Connexion par email + mot de passe via Supabase Auth.
 * En cas de succès, Supabase stocke automatiquement la session.
 */
async function loginEmail() {
    var email = document.getElementById('inputEmail').value.trim();
    var password = document.getElementById('inputPassword').value;
    if (!email || !email.includes('@')) { toast('Email invalide', 'error'); return; }
    if (!password) { toast('Entrez votre mot de passe', 'error'); return; }

    try {
        var { data, error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) throw error;

        // setUserFromSupabase est appelé automatiquement par onAuthStateChange
        // mais on le fait aussi ici pour que le toast affiche le bon nom
        setUserFromSupabase(data.user);
        toast('Bienvenue ' + (currentUser.nom || email) + ' !', 'success');
        await finalizeLogin();
    } catch(e) {
        // Messages d'erreur Supabase traduits en français
        var msg = e.message;
        if (msg.includes('Invalid login credentials')) msg = 'Email ou mot de passe incorrect';
        if (msg.includes('Email not confirmed')) msg = 'Veuillez confirmer votre email (vérifiez vos spams)';
        toast(msg, 'error');
    }
}

/**
 * Inscription par pseudo + email + mot de passe via Supabase Auth.
 * Crée un nouveau compte. Supabase peut envoyer un email de confirmation
 * selon la config du projet.
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
        var { data, error } = await supabase.auth.signUp({
            email: email,
            password: password,
            options: {
                // Le pseudo est stocké dans user_metadata (accessible côté client)
                data: { nom: nom }
            }
        });

        if (error) throw error;

        // Vérifier si Supabase demande une confirmation email
        // (dépend de la config : Authentication > Settings > Email Confirmations)
        if (data.user && data.user.identities && data.user.identities.length === 0) {
            // L'utilisateur existe déjà (Supabase retourne un "fake" user sans identities)
            toast('Un compte existe déjà avec cet email. Essayez de vous connecter.', 'error');
            showEmailForm();
            return;
        }

        if (data.session) {
            // Connexion immédiate (pas de confirmation email requise)
            setUserFromSupabase(data.user);
            toast('Compte créé ! Bienvenue ' + nom + ' !', 'success');
            await finalizeLogin();
        } else {
            // Email de confirmation envoyé
            toast('Compte créé ! Vérifiez votre email pour confirmer votre inscription.', 'success');
            showEmailForm();
        }
    } catch(e) {
        var msg = e.message;
        if (msg.includes('already registered')) msg = 'Un compte existe déjà avec cet email';
        if (msg.includes('Password should be')) msg = 'Le mot de passe doit contenir au moins 6 caractères';
        toast(msg, 'error');
    }
}

// ── SSO Google ──────────────────────────────────────────────────────────────

/**
 * Connexion via Google OAuth, gérée entièrement par Supabase.
 * Supabase redirige vers Google, puis revient sur le site avec la session active.
 * Plus besoin de charger le script Google Identity Services.
 */
function loginGoogle() {
    // Sauvegarder la page de retour pour rediriger après le callback OAuth
    localStorage.setItem('melusine_return_page', window.location.href);

    supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
            // Rediriger vers la page actuelle après authentification
            redirectTo: window.location.origin + window.location.pathname
        }
    });
}

// ── SSO Discord ─────────────────────────────────────────────────────────────

/**
 * Connexion via Discord OAuth, gérée entièrement par Supabase.
 * Supabase redirige vers Discord, puis revient sur le site avec la session active.
 * Plus besoin d'échanger le code manuellement via le backend.
 */
function loginDiscord() {
    // Sauvegarder la page de retour pour rediriger après le callback OAuth
    localStorage.setItem('melusine_return_page', window.location.href);

    supabase.auth.signInWithOAuth({
        provider: 'discord',
        options: {
            // Rediriger vers la page actuelle après authentification
            redirectTo: window.location.origin + window.location.pathname
        }
    });
}

// ── Mot de passe oublié ─────────────────────────────────────────────────────

/**
 * Envoie un email de réinitialisation de mot de passe via Supabase Auth.
 * Supabase gère l'envoi de l'email avec un lien sécurisé.
 * On répond toujours "succès" pour ne pas révéler si l'email existe.
 */
async function sendForgotPassword() {
    var email = document.getElementById('inputForgotEmail').value.trim();
    if (!email || !email.includes('@')) { toast('Entrez une adresse email valide', 'error'); return; }

    try {
        var { error } = await supabase.auth.resetPasswordForEmail(email, {
            // URL de redirection après clic sur le lien dans l'email
            redirectTo: window.location.origin + window.location.pathname
        });

        if (error) throw error;

        toast('Si un compte existe avec cet email, un lien de réinitialisation a été envoyé.', 'success');
        // Revenir au formulaire de connexion après 2 secondes
        setTimeout(function() { showEmailForm(); }, 2000);
    } catch(e) {
        // Ne pas révéler si l'email existe ou non
        toast('Si un compte existe avec cet email, un lien de réinitialisation a été envoyé.', 'success');
        setTimeout(function() { showEmailForm(); }, 2000);
    }
}

/**
 * Soumet le nouveau mot de passe après réinitialisation.
 * Supabase gère le token automatiquement via la session récupérée
 * depuis le lien email (le token est dans le hash fragment de l'URL).
 */
async function submitResetPassword() {
    var password = document.getElementById('inputResetPassword').value;
    var confirm = document.getElementById('inputResetConfirm').value;

    if (!password || password.length < 6) { toast('Le mot de passe doit contenir au moins 6 caractères', 'error'); return; }
    if (password !== confirm) { toast('Les mots de passe ne correspondent pas', 'error'); return; }

    try {
        var { data, error } = await supabase.auth.updateUser({
            password: password
        });

        if (error) throw error;

        setUserFromSupabase(data.user);
        toast('Mot de passe mis à jour !', 'success');
        await finalizeLogin();
    } catch(e) {
        toast('Erreur : ' + e.message, 'error');
    }
}

// ── Modification de pseudo ──────────────────────────────────────────────────

/**
 * Ouvre le modal pour modifier le pseudo de l'utilisateur connecté.
 */
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

// ── Détection du callback auth Supabase ─────────────────────────────────────

/**
 * Vérifie si l'URL contient un callback d'authentification Supabase.
 * Après un SSO (Google/Discord) ou un clic sur un lien de reset,
 * Supabase redirige vers le site avec des tokens dans le hash fragment.
 *
 * Cas gérés :
 * - Retour SSO : tokens dans le hash → session restaurée automatiquement
 * - Reset password : event PASSWORD_RECOVERY → afficher le formulaire de reset
 * - Confirmation email : session active → connexion automatique
 */
async function checkAuthCallback() {
    // Supabase met les tokens dans le hash fragment (#access_token=...&type=recovery)
    // Le SDK les détecte automatiquement et restaure la session.
    // On écoute l'événement onAuthStateChange pour réagir.

    // Vérifier si on revient d'un lien de réinitialisation de mot de passe
    // (Supabase utilise le hash fragment : #type=recovery&access_token=...)
    var hash = window.location.hash;
    if (hash && hash.includes('type=recovery')) {
        // Attendre que Supabase ait traité le hash et restauré la session
        // Le formulaire de reset sera affiché par onAuthStateChange (PASSWORD_RECOVERY)
        return;
    }
}

// =============================================================================
// UI COMMUNE
// =============================================================================

/**
 * Initialise les interactions communes à toutes les pages :
 * scroll effects, navigation active, menu mobile, modals, animations.
 */
function initCommonUI() {
    // Scroll effects : nav compacte au scroll, bouton "retour en haut"
    window.addEventListener('scroll', () => {
        var nav = document.getElementById('nav');
        if (nav) nav.classList.toggle('scrolled', scrollY>50);
        var scrollTop = document.getElementById('scrollTop');
        if (scrollTop) scrollTop.classList.toggle('visible', scrollY>500);
    });

    // Navigation active section highlighting
    // Met en surbrillance le lien de navigation correspondant à la section visible
    var allSections = document.querySelectorAll('section[id]');
    if (allSections.length) {
        window.addEventListener('scroll', () => {
            const y = scrollY+100;
            allSections.forEach(s => {
                const link = document.querySelector('.nav-links a[href="#' + s.id + '"]');
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

    // Scroll animations (IntersectionObserver)
    // Les éléments avec la classe .animate-on-scroll apparaissent en fondu
    var obs = new IntersectionObserver(entries => {
        entries.forEach((e,i) => {
            if (e.isIntersecting) { setTimeout(()=>e.target.classList.add('visible'), i*100); obs.unobserve(e.target); }
        });
    }, { threshold:0.1 });
    document.querySelectorAll('.animate-on-scroll').forEach(el => obs.observe(el));
}

/**
 * Ferme le modal de choix (utilisé pour "Pour qui s'inscrire ?").
 */
function closeChoixModal() {
    var modal = document.getElementById('choixModal');
    if (modal) modal.classList.remove('active');
}

// =============================================================================
// INITIALISATION
// =============================================================================

/**
 * Charge le thème depuis la config Supabase et l'applique sur <html>.
 * Valeurs possibles : "dark" (défaut) ou "clair".
 * Le thème est appliqué via data-theme qui switch les CSS variables.
 */
async function loadTheme() {
    try {
        var allData = await fetchAllData();
        var config = allData ? allData.config : await fetchConfig();
        if (config && config.theme) {
            var theme = config.theme.trim().toLowerCase();
            if (theme === 'clair' || theme === 'dark') {
                document.documentElement.setAttribute('data-theme', theme);
                // Sauvegarder en localStorage pour éviter le flash au reload
                localStorage.setItem('melusine_theme', theme);
            }
        }
    } catch(e) { /* silencieux — reste en dark par défaut */ }
}

/**
 * Point d'entrée principal de l'application.
 * Appelé au DOMContentLoaded. Séquence :
 *   1. Vérifier si on revient d'un callback auth (SSO, reset password)
 *   2. Restaurer la session Supabase existante
 *   3. Charger le thème + données
 *   4. Mettre à jour la navigation
 *   5. Initialiser l'UI commune
 *   6. Appeler l'init spécifique de la page
 *   7. Précharger les autres pages
 */
async function initApp() {
    // Écouter les changements d'état d'authentification Supabase.
    // Cet écouteur réagit à : connexion, déconnexion, refresh token,
    // retour SSO, clic sur lien de reset password.
    supabase.auth.onAuthStateChange(async function(event, session) {
        if (event === 'SIGNED_IN' && session && session.user) {
            setUserFromSupabase(session.user);

            // Si c'est un SSO (Google/Discord), proposer de choisir un pseudo
            var provider = session.user.app_metadata && session.user.app_metadata.provider;
            if (provider && provider !== 'email') {
                var meta = session.user.user_metadata || {};
                // Vérifier si l'utilisateur a déjà un pseudo personnalisé
                if (!meta.nom) {
                    var nom = meta.full_name || meta.name || meta.preferred_username || '';
                    showPseudoForm({
                        nom: nom,
                        email: session.user.email,
                        auth_type: provider
                    });
                    document.getElementById('authModal').classList.add('active');
                    return;
                }
            }

            await fetchRole();
            updateNavUser();
            updateNavForRole();
        }

        if (event === 'SIGNED_OUT') {
            currentUser = null;
            currentRole = 'joueur';
            accompagnants = [];
            updateNavUser();
            updateNavForRole();
            if (window.onUserLogout) window.onUserLogout();
        }

        // Événement spécial : l'utilisateur a cliqué sur un lien de reset password
        if (event === 'PASSWORD_RECOVERY') {
            document.getElementById('authModal').classList.add('active');
            showResetForm();
        }
    });

    // Vérifier la session existante (l'utilisateur était peut-être déjà connecté)
    try {
        var { data: { session } } = await supabase.auth.getSession();
        if (session && session.user) {
            setUserFromSupabase(session.user);
            await fetchRole();
        }
    } catch(e) {
        console.error('Erreur restauration session:', e);
    }

    // Vérifier les callbacks d'authentification dans l'URL
    await checkAuthCallback();

    // Mettre à jour la navigation avec l'état actuel
    updateNavUser();
    updateNavForRole();

    // Charger le thème depuis la config
    await loadTheme();

    // Initialiser l'UI commune (scroll, menu mobile, modals, animations)
    initCommonUI();

    // Appeler l'init spécifique de la page si définie
    if (window.onPageInit) await window.onPageInit();

    // Précharger les autres pages en arrière-plan
    prefetchAllPages();
}

/**
 * Précharge toutes les pages et ressources du site en arrière-plan.
 * Utilise <link rel="prefetch"> pour une priorité basse native.
 * Les fichiers sont mis en cache HTTP du navigateur → les navigations
 * suivantes chargeront depuis le cache local.
 */
function prefetchAllPages() {
    // Attendre 1 seconde après le rendu pour ne pas concurrencer le contenu visible
    setTimeout(function() {
        var pages = ['index.html', 'programme.html', 'infos.html', 'benevoles.html', 'mes-inscriptions.html', 'espace-mj.html', 'aide.html', 'styles.css', 'app.supabase.js?v=1'];
        var current = location.pathname.split('/').pop() || 'index.html';
        pages.forEach(function(page) {
            if (page === current) return;
            try {
                var link = document.createElement('link');
                link.rel = 'prefetch';
                link.href = page;
                document.head.appendChild(link);
            } catch(e) { /* silencieux */ }
        });
    }, 1500);
}

// Lancer l'initialisation au chargement du DOM
document.addEventListener('DOMContentLoaded', initApp);

// ── Service Worker ──────────────────────────────────────────────────────────
// Enregistre le SW pour cacher les pages et assets du site.
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function() {});
}

// =============================================================================
// EXPORTS WINDOW
// =============================================================================
// Nécessaires pour les handlers onclick dans le HTML.
// Chaque fonction exportée est utilisée dans au moins une page.

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
window.fetchSheetData = fetchSheetData;
window.fetchConfig = fetchConfig;
window.fetchAllPublic = fetchAllPublic;
window.fetchAllData = fetchAllData;
window.fetchRole = fetchRole;

})();
