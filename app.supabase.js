// =============================================================================
// SOUS L'ŒIL DE MÉLUSINE — Code JavaScript partagé (app.supabase.js)
// =============================================================================
// Version Supabase : remplace Google Apps Script + Cloudflare Worker par
// des appels REST directs à Supabase (auth + base de données).
//
// IMPORTANT : on n'utilise PAS le SDK Supabase JS (bug de lock auth v2).
// À la place, on utilise fetch() directement vers l'API REST de Supabase.
// C'est plus léger (~0KB de dépendance) et 100% fiable.
//
// Ce fichier contient le code commun à toutes les pages du site :
//   - Configuration (URL Supabase, clé publique)
//   - Client REST léger (sbQuery, sbInsert, sbUpdate, sbDelete)
//   - Helpers (escHtml, esc, toast)
//   - Authentification (login, logout, SSO Google/Discord via Supabase Auth REST)
//   - Navigation (menu responsive, scroll)
//   - Gestion des rôles (lecture depuis la table profiles)
//   - Chargement des données (requêtes parallèles fetch)
//
// Importé par toutes les pages : index.html, programme.html, etc.
// =============================================================================

(function() {
'use strict';

// =============================================================================
// CONFIGURATION SUPABASE
// =============================================================================
const SUPABASE_URL = 'https://hdbhvwaemrjoantcecuv.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_YGImet9fG8OKLDf_H0GNyQ_SmY5Mo56';

// Token de session (récupéré depuis localStorage après login)
let _accessToken = null;

// Charger le token depuis localStorage au démarrage
try {
    var stored = localStorage.getItem('melusine_session');
    if (stored) {
        var session = JSON.parse(stored);
        if (session && session.access_token) _accessToken = session.access_token;
    }
} catch(e) {}

// =============================================================================
// CLIENT REST LÉGER (remplace le SDK Supabase)
// =============================================================================
// Chaque fonction retourne une Promise qui résout avec { data, error }.
// Même interface que le SDK pour que les pages HTML n'aient pas à changer.

/**
 * Headers communs pour toutes les requêtes Supabase REST.
 * Si l'utilisateur est connecté, inclut le Bearer token pour le RLS.
 */
function sbHeaders(extra) {
    var h = {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + (_accessToken || SUPABASE_ANON_KEY),
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
    };
    if (extra) Object.assign(h, extra);
    return h;
}

/**
 * Rafraîchit le token d'accès si un refresh_token est disponible.
 * Appelé automatiquement quand une requête retourne 401.
 * @returns {boolean} true si le refresh a réussi
 */
async function refreshSession() {
    try {
        var stored = JSON.parse(localStorage.getItem('melusine_session') || '{}');
        if (!stored.refresh_token) return false;
        var r = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', {
            method: 'POST',
            headers: { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: stored.refresh_token })
        });
        if (!r.ok) return false;
        var data = await r.json();
        _accessToken = data.access_token;
        localStorage.setItem('melusine_session', JSON.stringify(data));
        return true;
    } catch(e) {
        return false;
    }
}

/**
 * Requête SELECT sur une table Supabase.
 * @param {string} table - Nom de la table
 * @param {string} query - Query string PostgREST (ex: 'select=*&statut=eq.inscrit')
 * @returns {Promise<{data, error}>}
 */
async function sbQuery(table, query) {
    try {
        var url = SUPABASE_URL + '/rest/v1/' + table + '?' + (query || 'select=*');
        var r = await fetch(url, { headers: sbHeaders() });
        // Si 401 (token expiré), tenter un refresh et réessayer
        if (r.status === 401 && _accessToken) {
            var refreshed = await refreshSession();
            if (refreshed) {
                r = await fetch(url, { headers: sbHeaders() });
            }
        }
        if (!r.ok) {
            var err = await r.json().catch(function() { return { message: r.statusText }; });
            return { data: null, error: err };
        }
        var data = await r.json();
        return { data: data, error: null };
    } catch(e) {
        return { data: null, error: { message: e.message } };
    }
}

/**
 * Requête INSERT sur une table Supabase.
 * @param {string} table - Nom de la table
 * @param {Object|Array} rows - Objet ou tableau d'objets à insérer
 * @returns {Promise<{data, error}>}
 */
async function sbInsert(table, rows) {
    try {
        var url = SUPABASE_URL + '/rest/v1/' + table;
        var r = await fetch(url, {
            method: 'POST',
            headers: sbHeaders(),
            body: JSON.stringify(rows)
        });
        if (!r.ok) {
            var err = await r.json().catch(function() { return { message: r.statusText }; });
            return { data: null, error: err };
        }
        var data = await r.json();
        return { data: data, error: null };
    } catch(e) {
        return { data: null, error: { message: e.message } };
    }
}

/**
 * Requête UPDATE sur une table Supabase.
 * @param {string} table - Nom de la table
 * @param {Object} values - Colonnes à mettre à jour
 * @param {string} filter - Filtre PostgREST (ex: 'id=eq.5' ou 'email=eq.test@test.com&creneau=eq.Samedi')
 * @returns {Promise<{data, error}>}
 */
async function sbUpdate(table, values, filter) {
    try {
        var url = SUPABASE_URL + '/rest/v1/' + table + '?' + filter;
        var r = await fetch(url, {
            method: 'PATCH',
            headers: sbHeaders(),
            body: JSON.stringify(values)
        });
        if (!r.ok) {
            var err = await r.json().catch(function() { return { message: r.statusText }; });
            return { data: null, error: err };
        }
        var data = await r.json();
        return { data: data, error: null };
    } catch(e) {
        return { data: null, error: { message: e.message } };
    }
}

/**
 * Requête DELETE sur une table Supabase.
 * @param {string} table - Nom de la table
 * @param {string} filter - Filtre PostgREST (ex: 'id=eq.5')
 * @returns {Promise<{data, error}>}
 */
async function sbDelete(table, filter) {
    try {
        var url = SUPABASE_URL + '/rest/v1/' + table + '?' + filter;
        var r = await fetch(url, {
            method: 'DELETE',
            headers: sbHeaders()
        });
        if (!r.ok) {
            var err = await r.json().catch(function() { return { message: r.statusText }; });
            return { data: null, error: err };
        }
        var data = await r.json().catch(function() { return []; });
        return { data: data, error: null };
    } catch(e) {
        return { data: null, error: { message: e.message } };
    }
}

/**
 * Objet proxy qui imite l'interface du SDK Supabase : APP.supabase.from('table').select('*')
 * Permet aux pages HTML de fonctionner sans changement.
 */
var supabaseProxy = {
    from: function(table) {
        // Méthodes de filtre communes à select/update/delete
        function makeFilters() {
            var _f = [];
            return {
                _f: _f,
                eq: function(col, val) { _f.push(col + '=eq.' + encodeURIComponent(val)); return this; },
                neq: function(col, val) { _f.push(col + '=neq.' + encodeURIComponent(val)); return this; },
                in: function(col, vals) { _f.push(col + '=in.(' + vals.map(encodeURIComponent).join(',') + ')'); return this; },
                or: function(expr) { _f.push('or=(' + expr + ')'); return this; },
                match: function(obj) { var self = this; Object.keys(obj).forEach(function(k) { self.eq(k, obj[k]); }); return this; },
                order: function(col, opts) { _f.push('order=' + col + '.' + (opts && opts.ascending === false ? 'desc' : 'asc')); return this; },
                limit: function(n) { _f.push('limit=' + n); return this; },
                qs: function() { return _f.join('&'); }
            };
        }
        return {
            // ── SELECT ──────────────────────────────────────────────
            select: function(cols) {
                var q = 'select=' + encodeURIComponent(cols || '*');
                var filters = makeFilters();
                var chain = Object.create(filters);
                // maybeSingle() : retourne le premier résultat ou null
                var _single = false;
                chain.maybeSingle = function() { _single = true; return chain; };
                chain.single = function() { _single = true; return chain; };
                chain.then = function(resolve, reject) {
                    var fullQuery = q + (filters.qs() ? '&' + filters.qs() : '');
                    return sbQuery(table, fullQuery).then(function(result) {
                        if (_single && result.data) {
                            result.data = result.data.length > 0 ? result.data[0] : null;
                        }
                        if (resolve) resolve(result);
                    }, reject);
                };
                chain.catch = function(fn) { return chain.then(undefined, fn); };
                // Rendre chaînable (eq/in/or retournent chain, pas filters)
                ['eq','neq','in','or','match','order','limit'].forEach(function(m) {
                    var orig = chain[m];
                    chain[m] = function() { orig.apply(filters, arguments); return chain; };
                });
                return chain;
            },
            // ── INSERT ──────────────────────────────────────────────
            insert: function(rows) {
                var _promise = sbInsert(table, rows);
                // Supporter .select() après insert (no-op, les données sont déjà retournées)
                _promise.select = function() { return _promise; };
                return _promise;
            },
            // ── UPSERT ──────────────────────────────────────────────
            upsert: function(rows, opts) {
                var onConflict = opts && opts.onConflict ? '&on_conflict=' + opts.onConflict : '';
                return (async function() {
                    try {
                        var url = SUPABASE_URL + '/rest/v1/' + table + '?select=*' + onConflict;
                        var r = await fetch(url, {
                            method: 'POST',
                            headers: sbHeaders({ 'Prefer': 'return=representation,resolution=merge-duplicates' }),
                            body: JSON.stringify(rows)
                        });
                        if (!r.ok) {
                            var err = await r.json().catch(function() { return { message: r.statusText }; });
                            return { data: null, error: err };
                        }
                        var data = await r.json();
                        return { data: data, error: null };
                    } catch(e) {
                        return { data: null, error: { message: e.message } };
                    }
                })();
            },
            // ── UPDATE ──────────────────────────────────────────────
            update: function(values) {
                var filters = makeFilters();
                var chain = Object.create(filters);
                chain.then = function(resolve, reject) {
                    return sbUpdate(table, values, filters.qs()).then(resolve, reject);
                };
                chain.catch = function(fn) { return chain.then(undefined, fn); };
                ['eq','neq','in','or','match'].forEach(function(m) {
                    var orig = chain[m];
                    chain[m] = function() { orig.apply(filters, arguments); return chain; };
                });
                return chain;
            },
            // ── DELETE ──────────────────────────────────────────────
            delete: function() {
                var filters = makeFilters();
                var chain = Object.create(filters);
                chain.then = function(resolve, reject) {
                    return sbDelete(table, filters.qs()).then(resolve, reject);
                };
                chain.catch = function(fn) { return chain.then(undefined, fn); };
                ['eq','neq','in','or','match'].forEach(function(m) {
                    var orig = chain[m];
                    chain[m] = function() { orig.apply(filters, arguments); return chain; };
                });
                return chain;
            }
        };
    },
    // ── FUNCTIONS (Edge Functions) ───────────────────────────────────────
    functions: {
        invoke: async function(name, opts) {
            try {
                var r = await fetch(SUPABASE_URL + '/functions/v1/' + name, {
                    method: 'POST',
                    headers: sbHeaders(),
                    body: JSON.stringify(opts && opts.body ? opts.body : {})
                });
                var data = await r.json().catch(function() { return {}; });
                if (!r.ok) return { data: null, error: data };
                return { data: data, error: null };
            } catch(e) {
                return { data: null, error: { message: e.message } };
            }
        }
    },
    auth: {
        // Placeholder — l'auth est gérée par les fonctions loginGoogle/loginDiscord/etc.
        getUser: async function() {
            if (!_accessToken) return { data: { user: null }, error: null };
            try {
                var r = await fetch(SUPABASE_URL + '/auth/v1/user', { headers: sbHeaders() });
                if (!r.ok) return { data: { user: null }, error: { message: 'Non connecté' } };
                var user = await r.json();
                return { data: { user: user }, error: null };
            } catch(e) {
                return { data: { user: null }, error: { message: e.message } };
            }
        },
        signOut: async function() {
            if (_accessToken) {
                try {
                    await fetch(SUPABASE_URL + '/auth/v1/logout', {
                        method: 'POST',
                        headers: sbHeaders()
                    });
                } catch(e) {}
            }
            _accessToken = null;
            localStorage.removeItem('melusine_session');
            return { error: null };
        },
        signInWithPassword: async function(creds) {
            try {
                var r = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
                    method: 'POST',
                    headers: { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: creds.email, password: creds.password })
                });
                var data = await r.json();
                if (!r.ok) return { data: null, error: data };
                _accessToken = data.access_token;
                localStorage.setItem('melusine_session', JSON.stringify(data));
                return { data: { user: data.user, session: data }, error: null };
            } catch(e) {
                return { data: null, error: { message: e.message } };
            }
        },
        signUp: async function(creds) {
            try {
                var r = await fetch(SUPABASE_URL + '/auth/v1/signup', {
                    method: 'POST',
                    headers: { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: creds.email, password: creds.password, data: creds.options ? creds.options.data : {} })
                });
                var data = await r.json();
                if (!r.ok) return { data: null, error: data };
                if (data.access_token) {
                    _accessToken = data.access_token;
                    localStorage.setItem('melusine_session', JSON.stringify(data));
                }
                return { data: { user: data.user || data, session: data }, error: null };
            } catch(e) {
                return { data: null, error: { message: e.message } };
            }
        },
        resetPasswordForEmail: async function(email) {
            try {
                var redirectTo = (window.location.origin + window.location.pathname).replace(/\/[^\/]*$/, '/index.html');
                var r = await fetch(SUPABASE_URL + '/auth/v1/recover', {
                    method: 'POST',
                    headers: { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: email, gotrue_meta_security: {}, redirect_to: redirectTo })
                });
                if (!r.ok) { var err = await r.json(); return { error: err }; }
                return { error: null };
            } catch(e) {
                return { error: { message: e.message } };
            }
        },
        updateUser: async function(updates) {
            try {
                var r = await fetch(SUPABASE_URL + '/auth/v1/user', {
                    method: 'PUT',
                    headers: sbHeaders(),
                    body: JSON.stringify(updates)
                });
                var data = await r.json();
                if (!r.ok) return { data: null, error: data };
                return { data: { user: data }, error: null };
            } catch(e) {
                return { data: null, error: { message: e.message } };
            }
        },
        signInWithOAuth: function(opts) {
            var provider = opts.provider;
            var redirectTo = opts.options && opts.options.redirectTo
                ? opts.options.redirectTo
                : window.location.href;
            var url = SUPABASE_URL + '/auth/v1/authorize?provider=' + provider
                + '&redirect_to=' + encodeURIComponent(redirectTo);
            window.location.href = url;
            return { error: null };
        }
    }
};

// =============================================================================

// Alias pour que le reste du code (et les pages HTML) puisse utiliser "supabase.from(...)"
const supabase = supabaseProxy;

// ── État global ─────────────────────────────────────────────────────────────
let currentUser = null;   // { nom, email, id } — null si déconnecté
let currentRole = 'joueur';
let accompagnants = [];
let pendingInscription = null;
let pendingSSOUser = null;

// Exposer l'état global en lecture pour les pages spécifiques
window.APP = {
    get currentUser() { return currentUser; },
    get currentRole() { return currentRole; },
    get accompagnants() { return accompagnants; },
    set accompagnants(val) { accompagnants = val; },
    SUPABASE_URL: SUPABASE_URL,
    SUPABASE_KEY: SUPABASE_ANON_KEY,
    // Proxy qui imite le SDK Supabase — les pages HTML utilisent APP.supabase.from('table')...
    get supabase() { return supabaseProxy; }
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
    // Cache simple : si les données ont déjà été chargées dans cette session de page,
    // on retourne le cache au lieu de refaire toutes les requêtes Supabase.
    // Cela évite le double-fetch entre loadTheme() et onPageInit().
    if (_allDataCache) return _allDataCache;
    // Éviter les appels concurrents : si un fetch est déjà en cours, réutiliser la même Promise
    if (_allDataCachePromise) return _allDataCachePromise;
    _allDataCachePromise = _fetchAllDataImpl();
    var result = await _allDataCachePromise;
    _allDataCachePromise = null;
    return result;
}

/**
 * Implémentation réelle de fetchAllData (appelée une seule fois par page).
 */
async function _fetchAllDataImpl() {
    try {
        // --- Requêtes publiques (pas besoin d'être connecté) ---
        var queries = [
            /* 0 */ supabase.from('config').select('*'),
            /* 1 */ supabase.from('programme').select('*').or('statut_table.eq.validé,statut_table.eq.,statut_table.is.null'),
            /* 2 */ supabase.from('inscriptions').select('nom, creneau, jeu, statut, type_inscrit, nom_accompagnant').in('statut', ['inscrit', 'attente']),
            /* 3 */ supabase.from('creneaux_benevoles').select('*'),
            /* 4 */ supabase.from('benevoles').select('*').eq('statut', 'inscrit'),
            /* 5 */ supabase.from('restauration').select('*'),
            /* 6 */ supabase.from('animations').select('*'),
            /* 7 */ supabase.from('repas').select('*').eq('statut', 'inscrit')
        ];

        // --- Requêtes privées (seulement si connecté) ---
        var privateStart = queries.length;
        if (currentUser && currentUser.email) {
            /* 8 */ queries.push(supabase.from('inscriptions').select('*').eq('email', currentUser.email).in('statut', ['inscrit', 'attente']));
            /* 9 */ queries.push(supabase.from('accompagnants').select('*').eq('email_parent', currentUser.email));
            /* 10 */ queries.push(supabase.from('benevoles').select('*').eq('email', currentUser.email).eq('statut', 'inscrit'));
            /* 11 */ queries.push(supabase.from('programme').select('*').eq('email_mj', currentUser.email));
            /* 12 */ queries.push(supabase.from('repas').select('*').eq('email', currentUser.email).eq('statut', 'inscrit'));
        }

        var results = await Promise.all(queries);

        // Config clé/valeur
        var config = {};
        (results[0].data || []).forEach(function(row) {
            if (row.cle) config[row.cle.trim()] = (row.valeur || '').trim();
        });

        // Compteur repas
        var repasAll = results[7].data || [];

        // ── Calcul places restantes pour le programme ──
        // (équivalent de getProgrammeAvecPlaces() dans l'ancien code.gs)
        var programmeRows = results[1].data || [];
        var inscriptionsRows = results[2].data || [];
        var inscCounts = {};
        inscriptionsRows.forEach(function(ins) {
            if (ins.statut === 'inscrit') {
                var key = ins.creneau + '|||' + ins.jeu;
                inscCounts[key] = (inscCounts[key] || 0) + 1;
            }
        });
        programmeRows.forEach(function(p) {
            var key = p.creneau + '|||' + p.jeu;
            var maxPlaces = parseInt(p.places) || 0;
            var placesWeb = p.places_web ? parseInt(p.places_web) : maxPlaces;
            var inscrits = inscCounts[key] || 0;
            p.places_restantes = Math.max(0, maxPlaces - inscrits);
            p.places_web_restantes = Math.max(0, placesWeb - inscrits);
            p.inscrits = inscrits;
            p.complet_web = p.places_web_restantes <= 0;
            p.complet = p.places_restantes <= 0;
            p.has_quota = (p.places_web && parseInt(p.places_web) < maxPlaces);
        });

        // ── Calcul places restantes pour les créneaux bénévoles ──
        // (équivalent de getPostesBenevoles() dans l'ancien code.gs)
        var creneauxBen = results[3].data || [];
        var benevolesAll = results[4].data || [];
        var benCounts = {};
        var benNoms = {};
        benevolesAll.forEach(function(b) {
            benCounts[b.creneau] = (benCounts[b.creneau] || 0) + 1;
            if (!benNoms[b.creneau]) benNoms[b.creneau] = [];
            benNoms[b.creneau].push(b.nom || '');
        });
        creneauxBen.forEach(function(c) {
            var maxP = parseInt(c.places) || 0;
            var ins = benCounts[c.creneau] || 0;
            c.inscrits = ins;
            c.places_restantes = Math.max(0, maxP - ins);
            c.complet = c.places_restantes <= 0;
            c.noms_inscrits = benNoms[c.creneau] || [];
        });

        // Construire l'objet de retour compatible avec l'ancien format
        var allData = {
            ok: true,
            config: config,
            programme: programmeRows,
            inscriptions_publiques: inscriptionsRows,
            inscriptions: inscriptionsRows,  // alias pour compatibilité
            creneaux_benevoles: creneauxBen,
            benevoles_all: benevolesAll,
            restauration: results[5].data || [],
            animations: results[6].data || [],
            repas_count: repasAll.length
        };

        // Données privées si connecté
        if (currentUser && currentUser.email) {
            allData.mes_inscriptions = (results[privateStart] || {}).data || [];
            var mesAcc = (results[privateStart + 1] || {}).data || [];
            allData.mes_accompagnants = mesAcc;
            accompagnants = mesAcc;
            allData.mes_benevoles = (results[privateStart + 2] || {}).data || [];
            allData.mes_propositions = (results[privateStart + 3] || {}).data || [];
            allData.mes_repas = (results[privateStart + 4] || {}).data || [];
        }

        // Stocker dans le cache mémoire pour éviter le double-fetch
        _allDataCache = allData;
        return allData;
    } catch(e) {
        console.error('fetchAllData erreur:', e);
        return null;
    }
}

// Cache config en mémoire (évite les appels multiples dans la même page)
var _configCacheClient = null;
// Cache fetchAllData en mémoire : évite le double-fetch (loadTheme + onPageInit)
var _allDataCache = null;
var _allDataCachePromise = null;

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
 * Récupère le rôle de l'utilisateur depuis la table profiles.
 * Appelé après chaque connexion.
 * Si l'utilisateur n'existe pas dans la table, il est considéré comme "joueur".
 *
 * @returns {string} Le rôle de l'utilisateur ('joueur', 'mj', 'admin')
 */
async function fetchRole() {
    if (!currentUser || !currentUser.email) return 'joueur';
    try {
        // Corrigé : utilise la table 'profiles' (et non 'roles') conformément au schéma Supabase
        var { data, error } = await supabase
            .from('profiles')
            .select('role')
            .eq('email', currentUser.email)
            .maybeSingle();

        if (error) throw error;

        if (data && data.role) {
            currentRole = data.role;
        } else {
            // Nouveau joueur : créer l'entrée dans profiles avec le rôle par défaut
            currentRole = 'joueur';
            await supabase.from('profiles').insert({
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

        // Mettre à jour la table profiles (et non 'roles') conformément au schéma Supabase
        if (currentUser && currentUser.email) {
            await supabase.from('profiles').upsert({
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
/**
 * Vérifie si l'URL contient un callback d'authentification Supabase.
 * Si type=recovery est détecté dans le hash, affiche le formulaire de reset mot de passe.
 * Le token a déjà été extrait et sauvegardé dans initApp() avant cet appel.
 */
async function checkAuthCallback() {
    // Vérifier si on revient d'un lien de réinitialisation de mot de passe
    // (Supabase utilise le hash fragment : #type=recovery&access_token=...)
    // Note : le hash a pu être nettoyé par initApp(), on vérifie aussi un flag en mémoire
    var hash = window.location.hash || '';
    if (hash.includes('type=recovery') || window._pendingRecovery) {
        // Afficher le formulaire de réinitialisation de mot de passe
        // Le token d'accès a déjà été extrait et stocké par initApp()
        openAuthModal();
        showResetForm();
        toast('Choisissez votre nouveau mot de passe', 'info');
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
    // ── Détecter le retour SSO (Google/Discord) ──────────────────────────
    // Après un SSO, Supabase redirige vers le site avec un fragment #access_token=...
    // ou des paramètres ?error=... On les traite ici.
    try {
        var hashParams = {};
        if (window.location.hash) {
            window.location.hash.substring(1).split('&').forEach(function(part) {
                var kv = part.split('=');
                if (kv.length === 2) hashParams[kv[0]] = decodeURIComponent(kv[1]);
            });
        }
        // Si on a un access_token dans le hash → retour SSO réussi ou recovery
        if (hashParams.access_token) {
            _accessToken = hashParams.access_token;
            // Sauvegarder la session complète
            var sessionData = {
                access_token: hashParams.access_token,
                refresh_token: hashParams.refresh_token || '',
                token_type: hashParams.token_type || 'bearer',
                expires_in: hashParams.expires_in || 3600
            };
            localStorage.setItem('melusine_session', JSON.stringify(sessionData));
            // Détecter le type=recovery AVANT de nettoyer le hash
            // On sauvegarde un flag pour que checkAuthCallback() puisse l'utiliser
            if (hashParams.type === 'recovery') {
                window._pendingRecovery = true;
            }
            // Nettoyer l'URL (enlever le fragment)
            history.replaceState(null, '', window.location.pathname + window.location.search);
        }
        // Si erreur dans l'URL (ex: ?error=server_error)
        var urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('error')) {
            var errDesc = urlParams.get('error_description') || urlParams.get('error');
            console.error('Auth error:', errDesc);
            toast('Erreur de connexion : ' + errDesc.replace(/\+/g, ' '), 'error');
            history.replaceState(null, '', window.location.pathname);
        }
    } catch(e) {
        console.error('Erreur traitement callback SSO:', e);
    }

    // ── Restaurer la session existante ─────────────────────────────────
    // Si un token est en localStorage, vérifier qu'il est encore valide
    // et récupérer les infos utilisateur.
    try {
        if (_accessToken) {
            var { data: { user } } = await supabase.auth.getUser();
            if (user) {
                setUserFromSupabase(user);
                await fetchRole();
            } else {
                // Token invalide → nettoyer
                _accessToken = null;
                localStorage.removeItem('melusine_session');
            }
        }
    } catch(e) {
        console.error('Erreur restauration session:', e);
        _accessToken = null;
        localStorage.removeItem('melusine_session');
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

// ── Service Worker : désenregistrer l'ancien SW ─────────────────────────────
// L'ancien SW (version GAS) servait des fichiers cachés qui interfèrent
// avec la nouvelle version Supabase. On le désenregistre proprement.
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(function(registrations) {
        registrations.forEach(function(reg) { reg.unregister(); });
    });
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
