// =============================================================================
// SOUS L'ŒIL DE MÉLUSINE — Backend Google Apps Script (version stable)
// =============================================================================
// Ce script sert d'API pour le site d'inscription à la convention JDR.
//
// PRINCIPE : la configuration (couleurs emails, messages, limites) est lue
// depuis l'onglet "config" de la Google Sheet. Modifier la config ne nécessite
// PAS de redéployer le script. Seul un changement de LOGIQUE (nouveau endpoint,
// nouvelle règle métier) nécessiterait un redéploiement.
//
// FONCTIONS GÉRÉES :
//   - Lecture du programme et des inscriptions
//   - Inscription / désinscription aux créneaux (avec anti-doublon)
//   - Liste d'attente automatique avec promotion
//   - Gestion des accompagnants (ajout, suppression, inscriptions)
//   - Callback OAuth Discord
//   - Panneau admin (stats, promotion manuelle, suppression)
//   - Envoi d'emails de confirmation (templates dynamiques depuis config)
//
// DÉPLOIEMENT (à faire une seule fois, sauf changement de logique) :
//   1. Crée un projet Google Apps Script (script.google.com)
//   2. Colle ce code dans Code.gs
//   3. Déploie en "Application Web" :
//      - Exécuter en tant que : Moi
//      - Accès : Tout le monde
//   4. Copie l'URL de déploiement dans index.html (variable SCRIPT_URL)
//
// PROPRIÉTÉS DE SCRIPT (⚙️ Paramètres → Propriétés de script) :
//   - SHEET_ID          → L'ID de la Google Sheet
//   - ADMIN_PASSWORD    → Mot de passe admin
//   - DISCORD_CLIENT_ID → ID de l'app Discord (optionnel)
//   - DISCORD_SECRET    → Secret de l'app Discord (optionnel)
//
// ONGLET "config" DE LA SHEET (clé / valeur) :
//   Paramètres lus dynamiquement par le script :
//   - max_accompagnants     → Nombre max d'accompagnants par joueur (défaut: 3)
//   - lien_inscription      → URL du site (pour les liens dans les emails)
//   - email_bg              → Couleur de fond emails (défaut: #0D2B2B)
//   - email_card_bg         → Couleur carte interne (défaut: #22223A)
//   - email_accent          → Couleur accent/or (défaut: #D4A843)
//   - email_success         → Couleur succès (défaut: #4A8B5E)
//   - email_error           → Couleur erreur (défaut: #B8293A)
//   - email_text            → Couleur texte principal (défaut: #FDF8F0)
//   - email_muted           → Couleur texte discret (défaut: #7A9999)
//   - email_light           → Couleur texte secondaire (défaut: #BCC8C8)
//   - msg_inscription_ok    → Message inscription confirmée (défaut fourni)
//   - msg_inscription_acc   → Message inscription accompagnant (%NOM% remplacé)
//   - msg_attente           → Message liste d'attente (défaut fourni)
//   - msg_attente_acc       → Message liste d'attente accompagnant (%NOM% remplacé)
//   - msg_annulation        → Message annulation (défaut fourni)
//   - msg_annulation_acc    → Message annulation accompagnant (%NOM% remplacé)
// =============================================================================


// ─── Helpers généraux ────────────────────────────────────────────────────────

/**
 * Récupère une propriété de script (les "variables d'environnement" secrètes).
 * Utilisé uniquement pour les secrets : SHEET_ID, ADMIN_PASSWORD, DISCORD_*.
 * Les paramètres non-secrets sont dans l'onglet "config" de la Sheet.
 * @param {string} key - Le nom de la propriété
 * @returns {string} La valeur, ou chaîne vide si absente
 */
function getProp(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || '';
}

/**
 * Exécute une fonction dans un verrou exclusif (LockService).
 * Empêche les race conditions quand plusieurs utilisateurs écrivent
 * en même temps (ex : deux inscriptions simultanées à la dernière place).
 * Si le verrou n'est pas obtenu dans les 15 secondes, renvoie une erreur.
 * @param {Function} fn - La fonction à exécuter sous verrou
 * @returns {*} Le résultat de la fonction
 */
function withLock(fn) {
  var lock = LockService.getScriptLock();
  var acquired = lock.tryLock(15000); // 15 secondes max d'attente
  if (!acquired) {
    return { error: 'Serveur occupé, réessayez dans quelques secondes.' };
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/**
 * Valide le format d'une adresse email avec une regex simple.
 * Ne vérifie pas que l'adresse existe, juste le format basique.
 * @param {string} email - L'adresse à vérifier
 * @returns {boolean} true si le format est valide
 */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}


// ─── Gestion des rôles ──────────────────────────────────────────────────────
// L'onglet "roles" recense TOUS les utilisateurs inscrits sur le site.
// Chaque email a un rôle : "joueur" (défaut), "mj", ou "admin".
// Le rôle est créé automatiquement à la première connexion.
// Seul un admin peut modifier le rôle d'un utilisateur.
//
// Colonnes : email | nom | role | date_inscription
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Récupère le rôle d'un utilisateur. Si l'utilisateur n'existe pas
 * dans l'onglet roles, crée une entrée avec le rôle "joueur".
 * Appelé à chaque connexion (action "get_role") pour informer le frontend.
 *
 * @param {string} email - L'email de l'utilisateur
 * @param {string} nom   - Le pseudo (pour l'enregistrement initial)
 * @returns {string} Le rôle : "joueur", "mj", ou "admin"
 */
function getOrCreateRole(email, nom) {
  email = (email || '').toLowerCase().trim();
  if (!email) return 'joueur';

  var sheet = getSheet('roles');
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h) { return h.toString().trim(); });
  var emailCol = headers.indexOf('email');
  var roleCol = headers.indexOf('role');

  // Chercher l'utilisateur existant
  for (var i = 1; i < data.length; i++) {
    if (data[i][emailCol] && data[i][emailCol].toString().toLowerCase().trim() === email) {
      return (data[i][roleCol] || 'joueur').toString().trim();
    }
  }

  // Utilisateur inconnu → créer avec le rôle "joueur"
  sheet.appendRow([email, (nom || '').trim(), 'joueur', new Date().toISOString()]);
  return 'joueur';
}

/**
 * Vérifie qu'un utilisateur a au moins le rôle requis.
 * Hiérarchie : admin > mj > joueur.
 * @param {string} email - L'email à vérifier
 * @param {string} roleMinimum - Le rôle minimum requis ("mj" ou "admin")
 * @returns {boolean} true si l'utilisateur a le rôle suffisant
 */
function hasRole(email, roleMinimum) {
  var role = getOrCreateRole(email, '');
  if (roleMinimum === 'admin') return role === 'admin';
  if (roleMinimum === 'mj') return role === 'mj' || role === 'admin';
  return true; // "joueur" → tout le monde
}

/**
 * Change le rôle d'un utilisateur (admin uniquement).
 * @param {Object} params - { password, email, role }
 * @returns {Object} { ok, message } ou { error }
 */
function setRole(params) {
  var password = (params.password || '').trim();
  if (password !== getProp('ADMIN_PASSWORD')) {
    return { error: 'Mot de passe incorrect' };
  }

  var targetEmail = (params.email || '').toLowerCase().trim();
  var newRole = (params.role || '').trim().toLowerCase();

  if (!targetEmail || !isValidEmail(targetEmail)) return { error: 'Email invalide' };
  if (['joueur', 'mj', 'admin'].indexOf(newRole) === -1) {
    return { error: 'Rôle invalide. Valeurs possibles : joueur, mj, admin' };
  }

  var sheet = getSheet('roles');
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h) { return h.toString().trim(); });
  var emailCol = headers.indexOf('email');
  var roleCol = headers.indexOf('role');

  for (var i = 1; i < data.length; i++) {
    if (data[i][emailCol] && data[i][emailCol].toString().toLowerCase().trim() === targetEmail) {
      sheet.getRange(i + 1, roleCol + 1).setValue(newRole);
      return { ok: true, message: 'Rôle de ' + targetEmail + ' changé en ' + newRole };
    }
  }

  return { error: 'Utilisateur non trouvé. Il doit se connecter au moins une fois.' };
}

/**
 * Retourne la liste de tous les utilisateurs avec leurs rôles (admin uniquement).
 * @param {Object} params - { password }
 * @returns {Object} { ok, users: [...] }
 */
function getAllRoles(params) {
  var password = (params.password || '').trim();
  if (password !== getProp('ADMIN_PASSWORD')) {
    return { error: 'Mot de passe incorrect' };
  }

  var users = readSheet('roles');
  return { ok: true, users: users };
}


/**
 * Ouvre un onglet de la Google Sheet. Crée l'onglet avec les bons en-têtes
 * s'il n'existe pas encore (utile lors de la première utilisation).
 * Gère aussi la migration : ajoute les colonnes accompagnants si manquantes.
 * @param {string} tabName - Le nom de l'onglet à ouvrir
 * @returns {GoogleAppsScript.Spreadsheet.Sheet} L'objet Sheet
 */
function getSheet(tabName) {
  var ss = SpreadsheetApp.openById(getProp('SHEET_ID'));
  var sheet = ss.getSheetByName(tabName);

  if (!sheet) {
    // Création automatique de l'onglet s'il n'existe pas
    sheet = ss.insertSheet(tabName);

    if (tabName === 'inscriptions') {
      // 10 colonnes : 8 de base + 2 pour les accompagnants
      sheet.appendRow([
        'timestamp', 'nom', 'email', 'auth_type', 'auth_id',
        'creneau', 'jeu', 'statut', 'type_inscrit', 'nom_accompagnant'
      ]);
      sheet.getRange(1, 1, 1, 10).setFontWeight('bold');
    }

    if (tabName === 'accompagnants') {
      sheet.appendRow(['email_parent', 'nom_accompagnant', 'date_ajout']);
      sheet.getRange(1, 1, 1, 3).setFontWeight('bold');
    }

    if (tabName === 'roles') {
      sheet.appendRow(['email', 'nom', 'role', 'date_inscription']);
      sheet.getRange(1, 1, 1, 4).setFontWeight('bold');
    }
  }

  // Migration : ajoute les colonnes accompagnants si l'onglet inscriptions
  // existait déjà avec seulement 8 colonnes (rétrocompatibilité).
  // Les anciennes lignes auront ces colonnes vides → traitées comme "principal".
  if (tabName === 'inscriptions' && sheet.getLastColumn() > 0) {
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    if (headers.indexOf('type_inscrit') === -1) {
      var nextCol = sheet.getLastColumn() + 1;
      sheet.getRange(1, nextCol).setValue('type_inscrit');
      sheet.getRange(1, nextCol).setFontWeight('bold');
      sheet.getRange(1, nextCol + 1).setValue('nom_accompagnant');
      sheet.getRange(1, nextCol + 1).setFontWeight('bold');
    }
  }

  // Migration : ajoute la colonne statut_table à l'onglet programme
  // pour la fonctionnalité de proposition de table par les MJ.
  // "validé" = visible dans le programme, "en_attente" = en attente de validation admin.
  // Les anciennes lignes sans cette colonne sont traitées comme "validé".
  if (tabName === 'programme' && sheet.getLastColumn() > 0) {
    var progHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    if (progHeaders.indexOf('statut_table') === -1) {
      var nextProgCol = sheet.getLastColumn() + 1;
      sheet.getRange(1, nextProgCol).setValue('statut_table');
      sheet.getRange(1, nextProgCol).setFontWeight('bold');
      // Colonne email_mj : pour identifier qui a proposé la table
      sheet.getRange(1, nextProgCol + 1).setValue('email_mj');
      sheet.getRange(1, nextProgCol + 1).setFontWeight('bold');
    }
  }

  return sheet;
}

/**
 * Lit toutes les lignes d'un onglet et les retourne en tableau d'objets.
 * Chaque objet a pour clés les en-têtes de la première ligne.
 * Les lignes entièrement vides sont ignorées.
 * @param {string} tabName - Le nom de l'onglet à lire
 * @returns {Object[]} Tableau d'objets { colonne: valeur, ... }
 */
function readSheet(tabName) {
  var sheet = getSheet(tabName);
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  var headers = data[0].map(function(h) { return h.toString().trim(); });
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var obj = {};
    var isEmpty = true;
    for (var j = 0; j < headers.length; j++) {
      var val = data[i][j];
      obj[headers[j]] = (val !== undefined && val !== null) ? val.toString().trim() : '';
      if (obj[headers[j]] !== '') isEmpty = false;
    }
    if (!isEmpty) rows.push(obj);
  }
  return rows;
}

/**
 * Retourne une réponse JSON.
 * JSONP désactivé pour des raisons de sécurité : le paramètre callback
 * permettait à n'importe quel site tiers de lire les données via <script>.
 * @param {Object} data - Les données à renvoyer
 * @returns {GoogleAppsScript.Content.TextOutput} La réponse HTTP
 */
function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Retourne une page HTML qui redirige immédiatement vers une URL.
 * Utilisé pour les redirections OAuth (Discord callback legacy).
 * L'URL est encodée pour éviter toute injection HTML via les paramètres.
 * @param {string} url - L'URL de destination
 * @returns {GoogleAppsScript.HTML.HtmlOutput} La page HTML de redirection
 */
function htmlRedirect(url) {
  // Sanitization : on encode les caractères spéciaux HTML dans l'URL
  // pour empêcher une injection via des paramètres malveillants
  var safeUrl = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  var html = '<html><head><meta http-equiv="refresh" content="0;url=' + safeUrl + '"></head>'
    + '<body>Redirection...</body></html>';
  return HtmlService.createHtmlOutput(html);
}


// ─── Configuration dynamique ─────────────────────────────────────────────────
// L'onglet "config" de la Sheet contient des paires clé/valeur.
// On le lit UNE SEULE FOIS par requête et on met en cache le résultat
// dans une variable globale. Cela évite de relire la Sheet à chaque fois
// qu'on a besoin d'un paramètre (performance).
// ─────────────────────────────────────────────────────────────────────────────

// Cache global — rempli au premier appel à getConfig() dans la requête.
// Remis à null entre chaque requête HTTP (Apps Script recrée le contexte).
var _configCache = null;

/**
 * Lit l'onglet "config" et retourne un objet { cle: valeur, ... }.
 * Le résultat est mis en cache pour la durée de la requête.
 * Si une clé n'existe pas dans la Sheet, les fonctions appelantes
 * utilisent une valeur par défaut codée en dur (voir les || 'défaut').
 * @returns {Object} Les paires clé/valeur de l'onglet config
 */
function getConfig() {
  if (_configCache) return _configCache;

  var rows = readSheet('config');
  var config = {};
  rows.forEach(function(row) {
    // L'onglet config a les colonnes "cle" et "valeur"
    if (row.cle) {
      config[row.cle.trim()] = (row.valeur || '').trim();
    }
  });

  _configCache = config;
  return config;
}

/**
 * Raccourci pour lire une valeur de config avec une valeur par défaut.
 * @param {string} key - La clé à chercher dans l'onglet config
 * @param {string} defaultValue - Valeur par défaut si la clé n'existe pas
 * @returns {string} La valeur trouvée ou la valeur par défaut
 */
function cfg(key, defaultValue) {
  var config = getConfig();
  return config[key] || defaultValue || '';
}


// ─── Emails — Template dynamique ────────────────────────────────────────────
// Au lieu de 4 fonctions avec du HTML hardcodé, on a maintenant :
//   1. buildEmailHtml() — génère le HTML à partir des couleurs de la config
//   2. sendEmail()      — envoie l'email (wrapper autour de MailApp)
//   3. Des fonctions "haut niveau" qui appellent les deux précédentes
//
// AVANTAGE : changer les couleurs ou le texte des emails = modifier la Sheet.
// Zéro redéploiement.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Construit le HTML d'un email de notification avec le design Mélusine.
 * Les couleurs sont lues depuis l'onglet config de la Sheet.
 *
 * @param {Object} options - Les paramètres du contenu de l'email
 * @param {string} options.titreBloc   - Le titre dans le bloc coloré (ex: "✅ Inscription confirmée !")
 * @param {string} options.couleurTitre - La couleur du titre du bloc (hex)
 * @param {Object[]} options.champs    - Tableau de { label, valeur } à afficher
 * @param {string} options.paragraphe  - Le texte sous le bloc (HTML autorisé)
 * @param {string} options.pied        - Le petit texte en bas (optionnel)
 * @returns {string} Le HTML complet de l'email
 */
function buildEmailHtml(options) {
  // Couleurs lues depuis la config, avec valeurs par défaut
  var bg       = cfg('email_bg', '#0D2B2B');
  var cardBg   = cfg('email_card_bg', '#22223A');
  var accent   = cfg('email_accent', '#D4A843');
  var textCol  = cfg('email_text', '#FDF8F0');
  var muted    = cfg('email_muted', '#7A9999');
  var light    = cfg('email_light', '#BCC8C8');

  // Construction des lignes de champs (Pseudo, Table, Créneau...)
  var champsHtml = '';
  if (options.champs && options.champs.length > 0) {
    options.champs.forEach(function(c) {
      champsHtml += '<p style="color:' + textCol + ';margin:0 0 8px"><strong>' + c.label + ' :</strong> ' + c.valeur + '</p>';
    });
  }

  // Template HTML — structure identique à l'ancien mais avec couleurs dynamiques
  return '<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:24px">'
    + '<div style="background:' + bg + ';border-radius:16px;padding:32px;color:' + textCol + '">'
    + '<h1 style="font-family:serif;color:' + accent + ';font-size:24px;margin:0 0 8px">Sous l\'Œil de Mélusine</h1>'
    + '<p style="color:' + muted + ';font-size:13px;margin:0 0 24px">Convention JDR · Poitiers</p>'
    + '<div style="background:' + cardBg + ';border-radius:12px;padding:24px;margin-bottom:24px">'
    + '<h2 style="color:' + options.couleurTitre + ';font-size:18px;margin:0 0 12px">' + options.titreBloc + '</h2>'
    + champsHtml
    + '</div>'
    + (options.paragraphe ? '<p style="color:' + light + ';font-size:14px;line-height:1.6">' + options.paragraphe + '</p>' : '')
    + (options.pied ? '<p style="color:' + muted + ';font-size:12px;margin-top:24px">' + options.pied + '</p>' : '')
    + '</div></div>';
}

/**
 * Envoie un email via MailApp. En cas d'erreur, log silencieusement
 * sans bloquer l'opération en cours (inscription, annulation, etc.).
 * @param {string} to - L'adresse email du destinataire
 * @param {string} subject - L'objet de l'email
 * @param {string} htmlBody - Le contenu HTML de l'email
 */
function sendEmail(to, subject, htmlBody) {
  if (!to || !to.includes('@')) return;
  try {
    MailApp.sendEmail({ to: to, subject: subject, htmlBody: htmlBody });
  } catch (err) {
    // On ne bloque pas l'inscription si l'email échoue.
    // Le log reste côté serveur (jamais exposé à l'utilisateur).
    console.log('Erreur envoi email à ' + to + ': ' + err.message);
  }
}

/**
 * Envoie un email de confirmation d'inscription (inscrit ou liste d'attente).
 * Le template et les couleurs viennent de l'onglet config.
 * @param {string} email   - Adresse du destinataire
 * @param {string} nom     - Pseudo affiché dans l'email
 * @param {string} jeu     - Nom du jeu / de la table
 * @param {string} creneau - Le créneau horaire
 * @param {string} statut  - "inscrit" ou "attente"
 */
function sendEmailConfirmation(email, nom, jeu, creneau, statut) {
  var siteUrl = cfg('lien_inscription', '');
  var successColor = cfg('email_success', '#4A8B5E');
  var accentColor  = cfg('email_accent', '#D4A843');

  var champs = [
    { label: 'Pseudo', valeur: nom },
    { label: 'Table', valeur: jeu },
    { label: 'Créneau', valeur: creneau }
  ];

  if (statut === 'inscrit') {
    sendEmail(email, '🎲 Inscription confirmée — ' + jeu, buildEmailHtml({
      titreBloc: '✅ Inscription confirmée !',
      couleurTitre: successColor,
      champs: champs,
      paragraphe: 'Votre place est réservée. Vous pouvez annuler ou modifier votre inscription à tout moment sur '
        + (siteUrl ? '<a href="' + siteUrl + '" style="color:' + accentColor + '">' + siteUrl + '</a>' : 'le site de la convention') + '.',
      pied: 'À bientôt aux tables ! 🐉'
    }));
  } else if (statut === 'attente') {
    sendEmail(email, '⏳ Liste d\'attente — ' + jeu, buildEmailHtml({
      titreBloc: '⏳ En liste d\'attente',
      couleurTitre: accentColor,
      champs: champs,
      paragraphe: 'Cette table est actuellement complète. Vous êtes en liste d\'attente et serez <strong>automatiquement inscrit·e</strong> si une place se libère. Vous recevrez un email de confirmation.',
      pied: 'Patience, les dés tournent ! 🎲'
    }));
  }
}

/**
 * Envoie un email quand quelqu'un est promu de la liste d'attente.
 * @param {string} email   - Adresse du destinataire
 * @param {string} nom     - Pseudo
 * @param {string} jeu     - Nom du jeu
 * @param {string} creneau - Créneau horaire
 */
function sendEmailPromotion(email, nom, jeu, creneau) {
  var siteUrl = cfg('lien_inscription', '');
  var successColor = cfg('email_success', '#4A8B5E');
  var accentColor  = cfg('email_accent', '#D4A843');

  sendEmail(email, '🎉 Place libérée — ' + jeu, buildEmailHtml({
    titreBloc: '🎉 Bonne nouvelle !',
    couleurTitre: successColor,
    champs: [
      { label: 'Pseudo', valeur: nom },
      { label: 'Table', valeur: jeu },
      { label: 'Créneau', valeur: creneau }
    ],
    paragraphe: 'Une place s\'est libérée et vous êtes maintenant <strong style="color:' + successColor + '">inscrit·e</strong> ! '
      + (siteUrl ? 'Rendez-vous sur <a href="' + siteUrl + '" style="color:' + accentColor + '">' + siteUrl + '</a> pour gérer vos inscriptions.' : ''),
    pied: 'On se retrouve aux tables ! 🐉'
  }));
}

/**
 * Envoie un email de confirmation d'annulation.
 * @param {string} email   - Adresse du destinataire
 * @param {string} nom     - Pseudo (ou "nomAccompagnant (accompagnant)")
 * @param {string} jeu     - Nom du jeu
 * @param {string} creneau - Créneau horaire
 */
function sendEmailAnnulation(email, nom, jeu, creneau) {
  var errorColor = cfg('email_error', '#B8293A');

  sendEmail(email, '❌ Inscription annulée — ' + jeu, buildEmailHtml({
    titreBloc: 'Inscription annulée',
    couleurTitre: errorColor,
    champs: [
      { label: 'Table', valeur: jeu },
      { label: 'Créneau', valeur: creneau }
    ],
    paragraphe: 'Votre inscription a bien été annulée. Vous pouvez vous réinscrire à tout moment.',
    pied: ''
  }));
}

/**
 * Envoie un email quand un accompagnant est supprimé.
 * @param {string} email            - Adresse du parent
 * @param {string} nomAccompagnant  - Nom de l'accompagnant supprimé
 * @param {number} nbAnnulees       - Nombre d'inscriptions annulées en cascade
 */
function sendEmailAccompagnantSupprime(email, nomAccompagnant, nbAnnulees) {
  var errorColor = cfg('email_error', '#B8293A');

  sendEmail(email, 'Accompagnant supprimé — ' + nomAccompagnant, buildEmailHtml({
    titreBloc: 'Accompagnant supprimé',
    couleurTitre: errorColor,
    champs: [
      { label: 'Accompagnant', valeur: nomAccompagnant },
      { label: 'Inscriptions annulées', valeur: nbAnnulees.toString() }
    ],
    paragraphe: 'L\'accompagnant a été supprimé et ses inscriptions ont été annulées.',
    pied: ''
  }));
}


// ─── Point d'entrée GET ─────────────────────────────────────────────────────
// Toutes les requêtes du frontend arrivent ici via callAPI() (GET avec query params).
// Le routage se fait via le paramètre "action".
// ─────────────────────────────────────────────────────────────────────────────

function doGet(e) {
  var action = (e.parameter.action || '').toString();

  try {
    switch (action) {

      // --- Lectures publiques (GET uniquement) ---
      case 'get_programme':
        return jsonResponse(getProgrammeAvecPlaces());

      case 'get_sheet':
        return jsonResponse(getSheetData(e.parameter));

      case 'get_inscriptions':
        return jsonResponse(getInscriptionsPubliques(e.parameter));

      case 'get_mes_inscriptions':
        return jsonResponse(getMesInscriptions(e.parameter));

      case 'get_accompagnants':
        return jsonResponse(getAccompagnants(e.parameter));

      case 'get_mes_propositions':
        return jsonResponse(getMesPropositions(e.parameter));

      // --- Rôles (lecture) ---
      case 'get_role':
        var roleEmail = (e.parameter.email || '').toLowerCase().trim();
        var roleNom = (e.parameter.nom || '').trim();
        return jsonResponse({ ok: true, role: getOrCreateRole(roleEmail, roleNom) });

      // --- Discord OAuth (lecture + redirect) ---
      case 'discord_exchange':
        return jsonResponse(discordExchange(e.parameter));

      case 'discord_callback':
        return discordCallback(e);

      default:
        return jsonResponse({ ok: true, message: 'API Mélusine active' });
    }
  } catch (err) {
    return jsonResponse({ error: 'Une erreur est survenue. Réessayez.' });
  }
}

/**
 * Point d'entrée POST — utilisé pour toutes les écritures et actions sensibles.
 * Le body doit être du JSON avec un champ "action".
 * Les actions admin passent obligatoirement par POST pour éviter que le mot
 * de passe apparaisse dans les URL / logs / historique navigateur.
 */
function doPost(e) {
  var data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ error: 'JSON invalide' });
  }

  try {
    switch (data.action) {
      // --- Inscription / Annulation (POST obligatoire — anti-CSRF) ---
      case 'inscrire':
        return jsonResponse(inscrire(data));
      case 'annuler':
        return jsonResponse(annuler(data));

      // --- Accompagnants (POST obligatoire — écritures) ---
      case 'add_accompagnant':
        return jsonResponse(addAccompagnant(data));
      case 'remove_accompagnant':
        return jsonResponse(removeAccompagnant(data));

      // --- MJ (propositions de tables) ---
      case 'proposer_table':
        return jsonResponse(proposerTable(data));

      // --- Admin (actions sensibles — POST obligatoire) ---
      case 'admin_data':
        return jsonResponse(getAdminData(data));
      case 'admin_promouvoir':
        return jsonResponse(adminPromouvoir(data));
      case 'admin_supprimer':
        return jsonResponse(adminSupprimer(data));
      case 'admin_valider_table':
        return jsonResponse(adminValiderTable(data));
      case 'admin_refuser_table':
        return jsonResponse(adminRefuserTable(data));
      case 'get_propositions_en_attente':
        return jsonResponse(getPropositionsEnAttente(data));

      // --- Rôles (admin) ---
      case 'set_role':
        return jsonResponse(setRole(data));
      case 'get_all_roles':
        return jsonResponse(getAllRoles(data));

      default:
        return jsonResponse({ error: 'Action inconnue' });
    }
  } catch (err) {
    return jsonResponse({ error: 'Une erreur est survenue. Réessayez.' });
  }
}


// ─── Lecture générique d'un onglet ──────────────────────────────────────────

/**
 * Lit n'importe quel onglet du Google Sheet et renvoie ses données en JSON.
 * Utilisé pour servir les données fraîches (restauration, animations, config)
 * sans passer par le cache de l'endpoint gviz/tq de Google.
 * Seuls certains onglets sont autorisés (liste blanche) pour éviter
 * d'exposer des données sensibles (inscriptions, accompagnants).
 * @param {Object} params - { tab: string } - nom de l'onglet à lire
 * @returns {Object} { ok, data: [...] }
 */
function getSheetData(params) {
  var tab = (params.tab || '').toString().trim();

  // Liste blanche des onglets publics — sécurité : on n'expose pas
  // les onglets contenant des données personnelles (inscriptions, accompagnants)
  var allowed = ['config', 'restauration', 'animations'];
  if (allowed.indexOf(tab) === -1) {
    return { error: 'Onglet non autorisé : ' + tab };
  }

  var data = readSheet(tab);
  return { ok: true, data: data };
}


// ─── Programme avec places restantes ────────────────────────────────────────

/**
 * Lit l'onglet "programme" et l'onglet "inscriptions", puis calcule
 * le nombre de places restantes pour chaque table.
 * @returns {Object} { ok, programme: [...] } avec places_restantes, inscrits, complet
 */
function getProgrammeAvecPlaces() {
  var allProgramme = readSheet('programme');
  var inscriptions = readSheet('inscriptions');

  // Filtrer : seules les tables validées (ou sans statut pour rétrocompat) sont publiques
  var programme = allProgramme.filter(function(p) {
    return !p.statut_table || p.statut_table === 'validé';
  });

  // Compter les inscrits (statut "inscrit" uniquement) par couple créneau+jeu
  var counts = {};
  inscriptions.forEach(function(ins) {
    if (ins.statut === 'inscrit') {
      var key = ins.creneau + '|||' + ins.jeu;
      counts[key] = (counts[key] || 0) + 1;
    }
  });

  // Ajouter les infos de places à chaque ligne du programme
  programme.forEach(function(p) {
    var key = p.creneau + '|||' + p.jeu;
    var maxPlaces = parseInt(p.places) || 0;
    var inscrits = counts[key] || 0;
    p.places_restantes = Math.max(0, maxPlaces - inscrits);
    p.inscrits = inscrits;
    p.complet = p.places_restantes <= 0;
  });

  return { ok: true, programme: programme };
}


// ─── Inscriptions publiques ─────────────────────────────────────────────────

/**
 * Retourne la liste des inscriptions pour l'affichage public.
 * Les emails ne sont PAS inclus (protection des données personnelles).
 * @returns {Object} { ok, inscriptions: [...] }
 */
function getInscriptionsPubliques(params) {
  var inscriptions = readSheet('inscriptions');
  var publiques = inscriptions
    .filter(function(i) { return i.statut === 'inscrit' || i.statut === 'attente'; })
    .map(function(i) {
      return {
        nom: i.nom,
        creneau: i.creneau,
        jeu: i.jeu,
        statut: i.statut,
        type_inscrit: i.type_inscrit || 'principal',
        nom_accompagnant: i.nom_accompagnant || ''
      };
    });
  return { ok: true, inscriptions: publiques };
}


// ─── Mes inscriptions (par email) ───────────────────────────────────────────

/**
 * Retourne toutes les inscriptions actives liées à un email
 * (inscriptions personnelles + celles des accompagnants du joueur).
 * @param {Object} params - { email: string }
 * @returns {Object} { ok, inscriptions: [...] }
 */
function getMesInscriptions(params) {
  var email = (params.email || '').toLowerCase().trim();
  if (!email) return { error: 'Email requis' };

  var inscriptions = readSheet('inscriptions');
  var miennes = inscriptions.filter(function(i) {
    return i.email.toLowerCase().trim() === email
      && (i.statut === 'inscrit' || i.statut === 'attente');
  }).map(function(i) {
    return {
      nom: i.nom,
      creneau: i.creneau,
      jeu: i.jeu,
      statut: i.statut,
      type_inscrit: i.type_inscrit || 'principal',
      nom_accompagnant: i.nom_accompagnant || ''
    };
  });

  return { ok: true, inscriptions: miennes };
}


// ─── Inscription ────────────────────────────────────────────────────────────

/**
 * Inscrit un joueur (ou un accompagnant) à une table.
 *
 * Vérifications effectuées (côté serveur, JAMAIS confiance au frontend) :
 *   1. Paramètres requis présents et non vides
 *   2. Si accompagnant → vérifie qu'il existe dans l'onglet accompagnants
 *   3. Anti-doublon : pas déjà inscrit à cette même table
 *   4. Anti-doublon : pas déjà inscrit à un autre jeu sur le même créneau
 *   5. Places disponibles → statut "inscrit" ou "attente"
 *
 * @param {Object} params - { nom, email, auth_type, auth_id, creneau, jeu,
 *                            type_inscrit (optionnel), nom_accompagnant (optionnel) }
 * @returns {Object} { ok, statut, message, places_restantes } ou { error }
 */
function inscrire(params) {
  var nom = (params.nom || '').trim();
  var email = (params.email || '').toLowerCase().trim();
  var authType = (params.auth_type || 'email').trim();
  var authId = (params.auth_id || '').trim();
  var creneau = (params.creneau || '').trim();
  var jeu = (params.jeu || '').trim();

  // Paramètres accompagnant (optionnels — vides pour une inscription classique)
  var typeInscrit = (params.type_inscrit || 'principal').trim();
  var nomAccompagnant = (params.nom_accompagnant || '').trim();

  // Validation de base (hors verrou — lecture seule, pas de race condition)
  if (!nom) return { error: 'Le nom est requis' };
  if (!email) return { error: "L'email est requis" };
  if (!isValidEmail(email)) return { error: "Format d'email invalide" };
  if (!creneau || !jeu) return { error: 'Créneau et jeu requis' };

  // Limites de longueur (protection anti-abus)
  if (nom.length > 100) return { error: 'Nom trop long (100 caractères max)' };
  if (creneau.length > 50) return { error: 'Créneau invalide' };
  if (jeu.length > 200) return { error: 'Nom de jeu trop long' };

  // Verrou exclusif : toute la logique de vérification + écriture est protégée
  // pour empêcher deux inscriptions simultanées à la dernière place.
  return withLock(function() {

    // Si c'est un accompagnant, vérifier qu'il existe bien dans la liste du parent
    if (typeInscrit === 'accompagnant') {
      if (!nomAccompagnant) return { error: 'Nom de l\'accompagnant requis' };
      var accompagnants = readSheet('accompagnants');
      var estValide = accompagnants.some(function(a) {
        return a.email_parent.toLowerCase().trim() === email
          && a.nom_accompagnant.trim().toLowerCase() === nomAccompagnant.toLowerCase();
      });
      if (!estValide) {
        return { error: 'Accompagnant non trouvé. Ajoutez-le d\'abord.' };
      }
    }

    var inscriptions = readSheet('inscriptions');

    // Fonction helper : détermine si une ligne d'inscription correspond
    // à la même "personne" (le joueur principal OU un accompagnant précis).
    // Pour le principal : email match ET pas d'accompagnant dans la ligne
    // Pour un accompagnant : email match ET même nom_accompagnant
    var personneMatch = function(i) {
      if (typeInscrit === 'accompagnant') {
        return i.email.toLowerCase().trim() === email
          && (i.nom_accompagnant || '').trim().toLowerCase() === nomAccompagnant.toLowerCase();
      } else {
        return i.email.toLowerCase().trim() === email
          && (!i.nom_accompagnant || i.nom_accompagnant.trim() === '');
      }
    };

    // Anti-doublon : déjà inscrit à cette table ?
    var dejaInscrit = inscriptions.some(function(i) {
      return personneMatch(i)
        && i.creneau === creneau
        && i.jeu === jeu
        && (i.statut === 'inscrit' || i.statut === 'attente');
    });

    if (dejaInscrit) {
      var qui = typeInscrit === 'accompagnant' ? nomAccompagnant + ' est' : 'Vous êtes';
      return { error: qui + ' déjà inscrit·e à cette table.' };
    }

    // Anti-doublon : déjà inscrit à un AUTRE jeu sur le même créneau ?
    var autreJeuMemeCreneau = inscriptions.find(function(i) {
      return personneMatch(i)
        && i.creneau === creneau
        && i.jeu !== jeu
        && (i.statut === 'inscrit' || i.statut === 'attente');
    });

    if (autreJeuMemeCreneau) {
      var qui2 = typeInscrit === 'accompagnant' ? nomAccompagnant + ' est' : 'Vous êtes';
      return { error: qui2 + ' déjà inscrit·e sur ce créneau (' + autreJeuMemeCreneau.jeu + '). Annulez d\'abord pour changer de table.' };
    }

    // Vérifier les places disponibles
    var programme = readSheet('programme');
    var creneauInfo = programme.find(function(p) {
      return p.creneau === creneau && p.jeu === jeu;
    });

    if (!creneauInfo) return { error: 'Créneau introuvable' };

    // Vérifier que la table est bien validée (pas en attente ou refusée)
    if (creneauInfo.statut_table && creneauInfo.statut_table !== 'validé') {
      return { error: 'Cette table n\'est pas encore ouverte aux inscriptions.' };
    }

    var maxPlaces = parseInt(creneauInfo.places) || 0;
    var inscritsCount = inscriptions.filter(function(i) {
      return i.creneau === creneau && i.jeu === jeu && i.statut === 'inscrit';
    }).length;

    // Déterminer le statut : inscrit si places dispo, sinon liste d'attente
    var statut = (inscritsCount < maxPlaces) ? 'inscrit' : 'attente';

    // Le nom affiché dans la ligne : le nom de l'accompagnant si c'en est un
    var nomAffiche = typeInscrit === 'accompagnant' ? nomAccompagnant : nom;

    // Écrire l'inscription (10 colonnes)
    var sheet = getSheet('inscriptions');
    sheet.appendRow([
      new Date().toISOString(),  // timestamp
      nomAffiche,                 // nom (accompagnant ou joueur)
      email,                      // email (toujours celui du parent)
      authType,                   // auth_type
      authId,                     // auth_id
      creneau,                    // creneau
      jeu,                        // jeu
      statut,                     // statut
      typeInscrit,                // 'principal' ou 'accompagnant'
      nomAccompagnant             // vide si principal
    ]);

    // Envoyer l'email de confirmation au parent
    // Le nom dans l'email mentionne l'accompagnant si applicable
    var nomEmail = typeInscrit === 'accompagnant'
      ? nomAccompagnant + ' (accompagnant de ' + nom + ')'
      : nom;
    sendEmailConfirmation(email, nomEmail, jeu, creneau, statut);

    // Calculer les places restantes après cette inscription
    var placesRestantes = Math.max(0, maxPlaces - inscritsCount - (statut === 'inscrit' ? 1 : 0));

    // Messages de retour lus depuis la config (avec valeurs par défaut)
    var message;
    if (statut === 'inscrit') {
      message = typeInscrit === 'accompagnant'
        ? cfg('msg_inscription_acc', '%NOM% est inscrit·e ! 🎲').replace(/%NOM%/g, nomAccompagnant)
        : cfg('msg_inscription_ok', 'Inscription confirmée ! 🎲');
    } else {
      message = typeInscrit === 'accompagnant'
        ? cfg('msg_attente_acc', '%NOM% est en liste d\'attente.').replace(/%NOM%/g, nomAccompagnant)
        : cfg('msg_attente', 'Créneau complet — vous êtes en liste d\'attente. Vous serez notifié·e si une place se libère.');
    }

    return {
      ok: true,
      statut: statut,
      message: message,
      places_restantes: placesRestantes
    };

  }); // fin withLock
}


// ─── Annulation ─────────────────────────────────────────────────────────────

/**
 * Annule l'inscription d'un joueur ou d'un accompagnant à une table.
 * Si le joueur annulé avait le statut "inscrit", le premier en liste
 * d'attente est automatiquement promu.
 *
 * @param {Object} params - { email, creneau, jeu, nom_accompagnant (optionnel) }
 * @returns {Object} { ok, message } ou { error }
 */
function annuler(params) {
  var email = (params.email || '').toLowerCase().trim();
  var creneau = (params.creneau || '').trim();
  var jeu = (params.jeu || '').trim();
  // Paramètre optionnel : si fourni, on annule l'inscription d'un accompagnant
  var nomAccompagnant = (params.nom_accompagnant || '').trim();

  if (!email || !creneau || !jeu) return { error: 'Paramètres manquants' };

  // Verrou exclusif : protège contre annulation + inscription simultanées
  // qui pourraient corrompre le comptage des places
  return withLock(function() {

    var sheet = getSheet('inscriptions');
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var emailCol = headers.indexOf('email');
    var creneauCol = headers.indexOf('creneau');
    var jeuCol = headers.indexOf('jeu');
    var statutCol = headers.indexOf('statut');
    var nomAccCol = headers.indexOf('nom_accompagnant');

    // Chercher la ligne correspondante et la marquer comme "annulé"
    var annule = false;
    var wasInscrit = false;

    for (var i = 1; i < data.length; i++) {
      var rowEmail = data[i][emailCol].toString().toLowerCase().trim();
      var rowCreneau = data[i][creneauCol].toString().trim();
      var rowJeu = data[i][jeuCol].toString().trim();
      var rowStatut = data[i][statutCol];
      var rowNomAcc = nomAccCol >= 0 ? (data[i][nomAccCol] || '').toString().trim() : '';

      // Matcher la bonne "personne" : accompagnant si nom fourni, sinon principal
      var personneMatch;
      if (nomAccompagnant) {
        personneMatch = (rowNomAcc.toLowerCase() === nomAccompagnant.toLowerCase());
      } else {
        personneMatch = (rowNomAcc === '');
      }

      if (rowEmail === email && rowCreneau === creneau && rowJeu === jeu
          && personneMatch
          && (rowStatut === 'inscrit' || rowStatut === 'attente')) {

        wasInscrit = (rowStatut === 'inscrit');
        sheet.getRange(i + 1, statutCol + 1).setValue('annulé');
        annule = true;
        break;
      }
    }

    if (!annule) return { error: 'Inscription introuvable' };

    // Email d'annulation au parent
    var nomAnnule = nomAccompagnant ? nomAccompagnant + ' (accompagnant)' : '';
    sendEmailAnnulation(email, nomAnnule, jeu, creneau);

    // Si c'était un "inscrit" (pas en attente), promouvoir le premier en liste d'attente
    if (wasInscrit) {
      promouvoirPremierEnAttente(creneau, jeu);
    }

    // Message de retour lu depuis la config
    var message = nomAccompagnant
      ? cfg('msg_annulation_acc', 'Inscription de %NOM% annulée.').replace(/%NOM%/g, nomAccompagnant)
      : cfg('msg_annulation', 'Inscription annulée.');

    return { ok: true, message: message };

  }); // fin withLock
}

/**
 * Promouvoit automatiquement le premier en liste d'attente pour
 * un couple créneau+jeu donné. Appelé après chaque annulation d'un "inscrit".
 * Envoie un email de notification au joueur promu.
 * @param {string} creneau - Le créneau horaire
 * @param {string} jeu     - Le nom du jeu
 */
function promouvoirPremierEnAttente(creneau, jeu) {
  var sheet = getSheet('inscriptions');
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var creneauCol = headers.indexOf('creneau');
  var jeuCol = headers.indexOf('jeu');
  var statutCol = headers.indexOf('statut');
  var timestampCol = headers.indexOf('timestamp');

  // Trouver le premier en attente (par ordre chronologique = le plus ancien)
  var premierAttente = null;
  var premierRow = -1;

  for (var i = 1; i < data.length; i++) {
    if (data[i][creneauCol].toString().trim() === creneau
        && data[i][jeuCol].toString().trim() === jeu
        && data[i][statutCol] === 'attente') {
      if (premierAttente === null || data[i][timestampCol] < premierAttente) {
        premierAttente = data[i][timestampCol];
        premierRow = i;
      }
    }
  }

  if (premierRow > 0) {
    // Promouvoir : passer de "attente" à "inscrit"
    sheet.getRange(premierRow + 1, statutCol + 1).setValue('inscrit');

    // Envoyer l'email de notification au joueur promu
    var nomCol = headers.indexOf('nom');
    var emailCol = headers.indexOf('email');
    var promuNom = data[premierRow][nomCol] ? data[premierRow][nomCol].toString() : '';
    var promuEmail = data[premierRow][emailCol] ? data[premierRow][emailCol].toString() : '';
    sendEmailPromotion(promuEmail, promuNom, jeu, creneau);
  }
}


// ─── Accompagnants ──────────────────────────────────────────────────────────
// Un accompagnant est une personne (enfant, conjoint) liée au compte d'un
// joueur principal. Identifié par le couple (email_parent, nom_accompagnant).
// Le nombre max est lu depuis la config (clé "max_accompagnants", défaut 3).
// Pas d'email propre : le parent reçoit toutes les notifications.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retourne la liste des accompagnants d'un utilisateur.
 * @param {Object} params - { email: string }
 * @returns {Object} { ok, accompagnants: [{ nom_accompagnant, date_ajout }] }
 */
function getAccompagnants(params) {
  var email = (params.email || '').toLowerCase().trim();
  if (!email) return { error: 'Email requis' };

  var all = readSheet('accompagnants');
  var mine = all.filter(function(a) {
    return a.email_parent.toLowerCase().trim() === email;
  }).map(function(a) {
    return { nom_accompagnant: a.nom_accompagnant, date_ajout: a.date_ajout };
  });

  return { ok: true, accompagnants: mine };
}

/**
 * Ajoute un accompagnant pour un utilisateur.
 * Le maximum est lu depuis la config (clé "max_accompagnants", défaut 3).
 * Vérifie que le nom n'est pas déjà pris (case-insensitive).
 * @param {Object} params - { email: string, nom_accompagnant: string }
 * @returns {Object} { ok, message } ou { error }
 */
function addAccompagnant(params) {
  var email = (params.email || '').toLowerCase().trim();
  var nomAccompagnant = (params.nom_accompagnant || '').trim();

  // Validation (hors verrou — lecture seule)
  if (!email) return { error: 'Email requis' };
  if (!nomAccompagnant) return { error: 'Nom de l\'accompagnant requis' };
  if (nomAccompagnant.length > 50) return { error: 'Nom trop long (50 caractères max)' };

  // Verrou exclusif : protège contre l'ajout simultané qui dépasserait le max
  return withLock(function() {
    // Lire le maximum depuis la config (défaut: 3)
    var maxAccompagnants = parseInt(cfg('max_accompagnants', '3')) || 3;

    // Vérifier le nombre actuel
    var all = readSheet('accompagnants');
    var mine = all.filter(function(a) {
      return a.email_parent.toLowerCase().trim() === email;
    });

    if (mine.length >= maxAccompagnants) {
      return { error: 'Vous avez déjà ' + maxAccompagnants + ' accompagnants (maximum autorisé).' };
    }

    // Vérifier que ce nom n'existe pas déjà pour ce parent (case-insensitive)
    var dejaExistant = mine.some(function(a) {
      return a.nom_accompagnant.toLowerCase().trim() === nomAccompagnant.toLowerCase();
    });
    if (dejaExistant) {
      return { error: 'Un accompagnant avec ce nom existe déjà.' };
    }

    // Écrire dans l'onglet accompagnants
    var sheet = getSheet('accompagnants');
    sheet.appendRow([email, nomAccompagnant, new Date().toISOString()]);

    return { ok: true, message: 'Accompagnant ajouté : ' + nomAccompagnant };
  }); // fin withLock
}

/**
 * Supprime un accompagnant ET annule toutes ses inscriptions actives.
 * Pour chaque inscription annulée qui avait le statut "inscrit",
 * le premier en liste d'attente est promu automatiquement.
 *
 * @param {Object} params - { email: string, nom_accompagnant: string }
 * @returns {Object} { ok, message, inscriptions_annulees } ou { error }
 */
function removeAccompagnant(params) {
  var email = (params.email || '').toLowerCase().trim();
  var nomAccompagnant = (params.nom_accompagnant || '').trim();

  if (!email || !nomAccompagnant) return { error: 'Paramètres manquants' };

  // Verrou exclusif : protège contre suppression + inscription simultanées
  return withLock(function() {

  // 1. Supprimer de l'onglet accompagnants
  var sheetAcc = getSheet('accompagnants');
  var dataAcc = sheetAcc.getDataRange().getValues();
  var headersAcc = dataAcc[0];
  var emailParentCol = headersAcc.indexOf('email_parent');
  var nomAccCol = headersAcc.indexOf('nom_accompagnant');
  var found = false;

  // Parcours en sens inverse pour ne pas décaler les indices lors du deleteRow
  for (var i = dataAcc.length - 1; i >= 1; i--) {
    if (dataAcc[i][emailParentCol].toString().toLowerCase().trim() === email
        && dataAcc[i][nomAccCol].toString().trim().toLowerCase() === nomAccompagnant.toLowerCase()) {
      sheetAcc.deleteRow(i + 1);
      found = true;
      break;
    }
  }

  if (!found) return { error: 'Accompagnant introuvable' };

  // 2. Annuler toutes les inscriptions actives de cet accompagnant
  var sheetIns = getSheet('inscriptions');
  var dataIns = sheetIns.getDataRange().getValues();
  var headersIns = dataIns[0];
  var insEmailCol = headersIns.indexOf('email');
  var insStatutCol = headersIns.indexOf('statut');
  var insNomAccCol = headersIns.indexOf('nom_accompagnant');
  var insCreneauCol = headersIns.indexOf('creneau');
  var insJeuCol = headersIns.indexOf('jeu');

  var annulees = 0;
  var promotionsNeeded = []; // Tables où il faut promouvoir quelqu'un

  for (var j = 1; j < dataIns.length; j++) {
    if (dataIns[j][insEmailCol].toString().toLowerCase().trim() === email
        && insNomAccCol >= 0
        && (dataIns[j][insNomAccCol] || '').toString().trim().toLowerCase() === nomAccompagnant.toLowerCase()
        && (dataIns[j][insStatutCol] === 'inscrit' || dataIns[j][insStatutCol] === 'attente')) {

      var wasInscrit = (dataIns[j][insStatutCol] === 'inscrit');
      sheetIns.getRange(j + 1, insStatutCol + 1).setValue('annulé');
      annulees++;

      // Si cette inscription occupait une place, il faut promouvoir le suivant
      if (wasInscrit) {
        promotionsNeeded.push({
          creneau: dataIns[j][insCreneauCol].toString().trim(),
          jeu: dataIns[j][insJeuCol].toString().trim()
        });
      }
    }
  }

  // 3. Promouvoir les premiers en attente pour chaque table libérée
  promotionsNeeded.forEach(function(p) {
    promouvoirPremierEnAttente(p.creneau, p.jeu);
  });

  // 4. Email récapitulatif au parent
  if (annulees > 0) {
    sendEmailAccompagnantSupprime(email, nomAccompagnant, annulees);
  }

  return {
    ok: true,
    message: 'Accompagnant "' + nomAccompagnant + '" supprimé.'
      + (annulees > 0 ? ' ' + annulees + ' inscription(s) annulée(s).' : ''),
    inscriptions_annulees: annulees
  };

  }); // fin withLock
}


// ─── Discord OAuth ──────────────────────────────────────────────────────────

/**
 * Échange le code Discord contre les infos utilisateur.
 * Le flux : le site reçoit le code de Discord directement (redirect),
 * puis appelle cette action pour échanger le code côté serveur
 * (le secret Discord ne quitte jamais le serveur).
 *
 * @param {Object} params - { code: string, redirect_uri: string }
 * @returns {Object} { ok, nom, email, auth_id } ou { error }
 */
function discordExchange(params) {
  var code = (params.code || '').trim();
  var redirectUri = (params.redirect_uri || '').trim();

  if (!code) return { error: 'Code Discord manquant' };

  var clientId = getProp('DISCORD_CLIENT_ID');
  var clientSecret = getProp('DISCORD_SECRET');

  if (!clientId || !clientSecret) return { error: 'Discord non configuré côté serveur' };

  // Échanger le code contre un access token auprès de Discord
  var tokenResponse = UrlFetchApp.fetch('https://discord.com/api/oauth2/token', {
    method: 'post',
    payload: {
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirectUri
    },
    muteHttpExceptions: true
  });

  var tokenData = JSON.parse(tokenResponse.getContentText());
  if (!tokenData.access_token) {
    return { error: 'Échec de l\'authentification Discord' };
  }

  // Utiliser le token pour récupérer les infos de l'utilisateur
  var userResponse = UrlFetchApp.fetch('https://discord.com/api/users/@me', {
    headers: { 'Authorization': 'Bearer ' + tokenData.access_token }
  });

  var user = JSON.parse(userResponse.getContentText());

  return {
    ok: true,
    nom: user.global_name || user.username || 'Utilisateur Discord',
    email: user.email || '',
    auth_id: user.id || ''
  };
}

/**
 * Ancien callback Discord — redirige vers le site si quelqu'un arrive ici.
 * Conservé pour ne pas casser les anciennes URL enregistrées chez Discord.
 */
function discordCallback(e) {
  var siteUrl = cfg('lien_inscription', '');
  return htmlRedirect(siteUrl + '?error=discord_use_site');
}


// ─── Admin ──────────────────────────────────────────────────────────────────

/**
 * Retourne toutes les données admin : inscriptions complètes, stats de remplissage.
 * Protégé par le mot de passe admin (stocké dans les Script Properties).
 * @param {Object} params - { password: string }
 * @returns {Object} { ok, inscriptions, stats, total_inscrits, total_attente }
 */
function getAdminData(params) {
  var password = (params.password || '').trim();
  if (password !== getProp('ADMIN_PASSWORD')) {
    return { error: 'Mot de passe incorrect' };
  }

  // Lecture directe de la Sheet pour avoir les vrais numéros de ligne
  // (readSheet() ne retourne pas les index → impossible de cibler une ligne)
  var sheet = getSheet('inscriptions');
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h) { return h.toString().trim(); });

  // Construire les inscriptions avec le vrai numéro de ligne Sheet (_row)
  var inscriptions = [];
  for (var i = 1; i < data.length; i++) {
    var obj = {};
    var isEmpty = true;
    for (var j = 0; j < headers.length; j++) {
      var val = data[i][j];
      obj[headers[j]] = (val !== undefined && val !== null) ? val.toString().trim() : '';
      if (obj[headers[j]] !== '') isEmpty = false;
    }
    if (!isEmpty) {
      // _row = numéro de ligne réel dans la Sheet (1-indexed, en-tête = ligne 1)
      // Utilisé par le frontend pour cibler la bonne ligne lors de promouvoir/supprimer
      obj._row = i + 1;
      inscriptions.push(obj);
    }
  }

  var programme = readSheet('programme');

  // Stats par couple créneau+jeu
  var stats = {};
  programme.forEach(function(p) {
    var key = p.creneau + '|||' + p.jeu;
    stats[key] = {
      creneau: p.creneau,
      jeu: p.jeu,
      max: parseInt(p.places) || 0,
      inscrits: 0,
      attente: 0
    };
  });

  inscriptions.forEach(function(i) {
    var key = i.creneau + '|||' + i.jeu;
    if (stats[key]) {
      if (i.statut === 'inscrit') stats[key].inscrits++;
      else if (i.statut === 'attente') stats[key].attente++;
    }
  });

  return {
    ok: true,
    inscriptions: inscriptions,
    stats: Object.keys(stats).map(function(k) { return stats[k]; }),
    total_inscrits: inscriptions.filter(function(i) { return i.statut === 'inscrit'; }).length,
    total_attente: inscriptions.filter(function(i) { return i.statut === 'attente'; }).length
  };
}

/**
 * Promouvoit manuellement une inscription en attente (admin uniquement).
 * @param {Object} params - { password, row (numéro de ligne dans la Sheet) }
 * @returns {Object} { ok, message } ou { error }
 */
function adminPromouvoir(params) {
  var password = (params.password || '').trim();
  if (password !== getProp('ADMIN_PASSWORD')) {
    return { error: 'Mot de passe incorrect' };
  }

  var rowIndex = parseInt(params.row) || 0;
  if (rowIndex < 2) return { error: 'Ligne invalide' };

  var sheet = getSheet('inscriptions');
  var data = sheet.getDataRange().getValues();
  if (rowIndex > data.length) return { error: 'Ligne hors limites' };

  var headers = data[0].map(function(h) { return h.toString().trim(); });
  var statutCol = headers.indexOf('statut');
  var creneauCol = headers.indexOf('creneau');
  var jeuCol = headers.indexOf('jeu');

  if (statutCol < 0) return { error: 'Colonne statut introuvable' };

  var currentStatut = data[rowIndex - 1][statutCol];
  if (currentStatut !== 'attente') {
    return { error: 'Cette inscription n\'est pas en attente' };
  }

  // Vérifier qu'il reste de la place (protection anti-overbooking)
  var creneau = data[rowIndex - 1][creneauCol].toString().trim();
  var jeu = data[rowIndex - 1][jeuCol].toString().trim();
  var programme = readSheet('programme');
  var creneauInfo = programme.find(function(p) { return p.creneau === creneau && p.jeu === jeu; });
  if (creneauInfo) {
    var maxPlaces = parseInt(creneauInfo.places) || 0;
    var inscritsCount = 0;
    for (var i = 1; i < data.length; i++) {
      if (data[i][creneauCol].toString().trim() === creneau
          && data[i][jeuCol].toString().trim() === jeu
          && data[i][statutCol] === 'inscrit') {
        inscritsCount++;
      }
    }
    if (inscritsCount >= maxPlaces) {
      return { error: 'Table déjà complète (' + inscritsCount + '/' + maxPlaces + '). Promotion impossible.' };
    }
  }

  sheet.getRange(rowIndex, statutCol + 1).setValue('inscrit');
  return { ok: true, message: 'Inscription promue !' };
}

/**
 * Supprime une inscription (admin uniquement). Marque le statut comme "supprimé".
 * Si l'inscription avait le statut "inscrit", promouvoit le premier en attente.
 * @param {Object} params - { password, row (numéro de ligne dans la Sheet) }
 * @returns {Object} { ok, message } ou { error }
 */
function adminSupprimer(params) {
  var password = (params.password || '').trim();
  if (password !== getProp('ADMIN_PASSWORD')) {
    return { error: 'Mot de passe incorrect' };
  }

  var rowIndex = parseInt(params.row) || 0;
  if (rowIndex < 2) return { error: 'Ligne invalide' };

  var sheet = getSheet('inscriptions');
  var data = sheet.getDataRange().getValues();
  if (rowIndex > data.length) return { error: 'Ligne hors limites' };

  var headers = data[0].map(function(h) { return h.toString().trim(); });
  var statutCol = headers.indexOf('statut');
  var creneauCol = headers.indexOf('creneau');
  var jeuCol = headers.indexOf('jeu');

  // Vérifier le statut actuel avant suppression
  var wasInscrit = (data[rowIndex - 1][statutCol] === 'inscrit');
  var creneau = data[rowIndex - 1][creneauCol].toString().trim();
  var jeu = data[rowIndex - 1][jeuCol].toString().trim();

  sheet.getRange(rowIndex, statutCol + 1).setValue('supprimé');

  // Si c'était un inscrit, promouvoir le premier en attente
  if (wasInscrit) {
    promouvoirPremierEnAttente(creneau, jeu);
  }

  return { ok: true, message: 'Inscription supprimée.' + (wasInscrit ? ' Premier en attente promu.' : '') };
}


// ─── Propositions de tables (MJ) ────────────────────────────────────────────
// Un MJ connecté peut proposer une table de JDR. La proposition est écrite
// dans l'onglet "programme" avec statut_table = "en_attente".
// Elle n'apparaît dans le programme public qu'après validation par un admin.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Propose une nouvelle table de JDR (côté MJ).
 * Écrit dans l'onglet programme avec statut_table = "en_attente".
 *
 * Validations :
 *   - Champs obligatoires : jeu, mj, creneau, places, email_mj
 *   - Format email valide
 *   - Nombre de places entre 1 et 20 (protection anti-abus)
 *   - Anti-doublon : pas deux propositions identiques (même MJ + même jeu + même créneau)
 *
 * @param {Object} params - { jeu, mj, systeme, description, content, creneau, places, email_mj }
 * @returns {Object} { ok, message } ou { error }
 */
function proposerTable(params) {
  var jeu = (params.jeu || '').trim();
  var mj = (params.mj || '').trim();
  var systeme = (params.systeme || '').trim();
  var description = (params.description || '').trim();
  var content = (params.content || '').trim();
  var creneau = (params.creneau || '').trim();
  var places = parseInt(params.places) || 0;
  var emailMj = (params.email_mj || '').toLowerCase().trim();

  // Contrôle d'accès : seuls les MJ et admins peuvent proposer des tables
  if (!hasRole(emailMj, 'mj')) {
    return { error: 'Seuls les MJ peuvent proposer des tables. Contactez un administrateur pour obtenir le rôle MJ.' };
  }

  // Validation des champs obligatoires
  if (!jeu) return { error: 'Le nom du jeu est requis' };
  if (!mj) return { error: 'Le nom du MJ est requis' };
  if (!creneau) return { error: 'Le créneau est requis' };
  if (!places || places < 1 || places > 20) return { error: 'Nombre de places invalide (1 à 20)' };
  if (!emailMj) return { error: 'Email requis' };
  if (!isValidEmail(emailMj)) return { error: "Format d'email invalide" };

  // Longueur max des champs texte (protection anti-abus)
  if (jeu.length > 100) return { error: 'Nom du jeu trop long (100 caractères max)' };
  if (description.length > 500) return { error: 'Description trop longue (500 caractères max)' };

  // Anti-doublon : vérifier qu'il n'y a pas déjà une proposition identique
  var programme = readSheet('programme');
  var dejaPropose = programme.some(function(p) {
    return (p.email_mj || '').toLowerCase().trim() === emailMj
      && p.jeu.trim().toLowerCase() === jeu.toLowerCase()
      && p.creneau.trim() === creneau;
  });
  if (dejaPropose) {
    return { error: 'Vous avez déjà proposé ce jeu sur ce créneau.' };
  }

  // Écrire la proposition dans l'onglet programme
  // Les colonnes correspondent à celles du programme existant + statut_table + email_mj
  var sheet = getSheet('programme');
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function(h) { return h.toString().trim(); });

  // Construire la ligne en respectant l'ordre des colonnes existantes
  var newRow = [];
  headers.forEach(function(h) {
    switch (h) {
      case 'jeu': newRow.push(jeu); break;
      case 'mj': newRow.push(mj); break;
      case 'systeme': newRow.push(systeme); break;
      case 'description': newRow.push(description); break;
      case 'content': newRow.push(content); break;
      case 'creneau': newRow.push(creneau); break;
      case 'places': newRow.push(places); break;
      case 'statut_table': newRow.push('en_attente'); break;
      case 'email_mj': newRow.push(emailMj); break;
      default: newRow.push(''); break;
    }
  });

  sheet.appendRow(newRow);

  return { ok: true, message: 'Table proposée ! Un administrateur va la valider.' };
}

/**
 * Retourne les propositions de tables d'un MJ (identifié par son email).
 * Permet au MJ de voir l'état de ses propositions (en_attente, validé, refusé).
 * @param {Object} params - { email: string }
 * @returns {Object} { ok, propositions: [...] }
 */
function getMesPropositions(params) {
  var email = (params.email || '').toLowerCase().trim();
  if (!email) return { error: 'Email requis' };

  var programme = readSheet('programme');
  var miennes = programme.filter(function(p) {
    return (p.email_mj || '').toLowerCase().trim() === email;
  }).map(function(p) {
    return {
      jeu: p.jeu,
      mj: p.mj,
      systeme: p.systeme || '',
      description: p.description || '',
      content: p.content || '',
      creneau: p.creneau,
      places: p.places,
      statut_table: p.statut_table || 'validé'
    };
  });

  return { ok: true, propositions: miennes };
}

/**
 * Valide une proposition de table (admin uniquement).
 * Change le statut de "en_attente" à "validé" → la table apparaît dans le programme public.
 * Identifie la proposition par email_mj + jeu + creneau (combinaison unique).
 * @param {Object} params - { password, email_mj, jeu, creneau }
 * @returns {Object} { ok, message } ou { error }
 */
function adminValiderTable(params) {
  var password = (params.password || '').trim();
  if (password !== getProp('ADMIN_PASSWORD')) {
    return { error: 'Mot de passe incorrect' };
  }

  return _changeStatutTable(params, 'validé');
}

/**
 * Refuse une proposition de table (admin uniquement).
 * Change le statut de "en_attente" à "refusé".
 * @param {Object} params - { password, email_mj, jeu, creneau }
 * @returns {Object} { ok, message } ou { error }
 */
function adminRefuserTable(params) {
  var password = (params.password || '').trim();
  if (password !== getProp('ADMIN_PASSWORD')) {
    return { error: 'Mot de passe incorrect' };
  }

  return _changeStatutTable(params, 'refusé');
}

/**
 * Fonction interne : change le statut_table d'une proposition dans le programme.
 * Cherche la ligne par email_mj + jeu + creneau et met à jour statut_table.
 * @param {Object} params - { email_mj, jeu, creneau }
 * @param {string} newStatut - Le nouveau statut ("validé" ou "refusé")
 * @returns {Object} { ok, message } ou { error }
 */
function _changeStatutTable(params, newStatut) {
  var emailMj = (params.email_mj || '').toLowerCase().trim();
  var jeu = (params.jeu || '').trim();
  var creneau = (params.creneau || '').trim();

  if (!emailMj || !jeu || !creneau) return { error: 'Paramètres manquants' };

  var sheet = getSheet('programme');
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h) { return h.toString().trim(); });
  var emailMjCol = headers.indexOf('email_mj');
  var jeuCol = headers.indexOf('jeu');
  var creneauCol = headers.indexOf('creneau');
  var statutCol = headers.indexOf('statut_table');

  if (statutCol === -1) return { error: 'Colonne statut_table introuvable' };

  for (var i = 1; i < data.length; i++) {
    var rowEmail = emailMjCol >= 0 ? (data[i][emailMjCol] || '').toString().toLowerCase().trim() : '';
    var rowJeu = (data[i][jeuCol] || '').toString().trim();
    var rowCreneau = (data[i][creneauCol] || '').toString().trim();

    if (rowEmail === emailMj && rowJeu.toLowerCase() === jeu.toLowerCase() && rowCreneau === creneau) {
      sheet.getRange(i + 1, statutCol + 1).setValue(newStatut);
      return { ok: true, message: 'Table ' + (newStatut === 'validé' ? 'validée' : 'refusée') + ' : ' + jeu };
    }
  }

  return { error: 'Proposition introuvable' };
}

/**
 * Enrichit getAdminData pour inclure les propositions de tables en attente.
 * L'admin peut voir toutes les propositions et les valider/refuser.
 */
function getPropositionsEnAttente(params) {
  var password = (params.password || '').trim();
  if (password !== getProp('ADMIN_PASSWORD')) {
    return { error: 'Mot de passe incorrect' };
  }

  var programme = readSheet('programme');
  var enAttente = programme.filter(function(p) {
    return p.statut_table === 'en_attente';
  });

  return { ok: true, propositions: enAttente };
}
