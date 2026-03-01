// =============================================================================
// 📌 SOUS L'ŒIL DE MÉLUSINE — Backend Google Apps Script
// =============================================================================
// Ce script sert d'API pour le site. Il gère :
//   - La lecture du programme et des inscriptions
//   - L'inscription / désinscription aux créneaux
//   - La liste d'attente automatique
//   - Le callback OAuth Discord
//   - Le panneau admin
//
// DÉPLOIEMENT :
//   1. Crée un nouveau projet Google Apps Script (script.google.com)
//   2. Colle ce code dans Code.gs
//   3. Déploie en tant que "Application Web" :
//      - Exécuter en tant que : Moi
//      - Accès : Tout le monde
//   4. Copie l'URL de déploiement dans le site (variable SCRIPT_URL)
//
// CONFIGURATION :
//   Va dans ⚙️ Paramètres du projet → Propriétés de script
//   Et ajoute ces propriétés :
//     - SHEET_ID          → L'ID de ton Google Sheet
//     - ADMIN_PASSWORD    → Mot de passe admin (ex: "melusine2026")
//     - DISCORD_CLIENT_ID → (optionnel) ID de ton app Discord
//     - DISCORD_SECRET    → (optionnel) Secret de ton app Discord
//     - DISCORD_REDIRECT  → (optionnel) URL de ce script + "?action=discord_callback"
//     - SITE_URL          → URL de ton site (ex: "https://pseudo.github.io/melusine")
// =============================================================================

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Récupère une propriété de script (les "variables d'environnement")
 */
function getProp(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || '';
}

/**
 * Ouvre le Google Sheet configuré
 */
function getSheet(tabName) {
  var ss = SpreadsheetApp.openById(getProp('SHEET_ID'));
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    // Crée l'onglet s'il n'existe pas
    sheet = ss.insertSheet(tabName);
    if (tabName === 'inscriptions') {
      sheet.appendRow([
        'timestamp', 'nom', 'email', 'auth_type', 'auth_id',
        'creneau', 'jeu', 'statut'
      ]);
      // En-têtes en gras
      sheet.getRange(1, 1, 1, 8).setFontWeight('bold');
    }
  }
  return sheet;
}

/**
 * Lit toutes les données d'un onglet et les retourne en tableau d'objets
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
 * Retourne une réponse JSON (avec support JSONP si callback présent)
 */
function jsonResponse(data, callback) {
  var json = JSON.stringify(data);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Retourne une page HTML (pour les redirections OAuth)
 */
function htmlRedirect(url) {
  var html = '<html><head><meta http-equiv="refresh" content="0;url=' + url + '"></head>'
    + '<body>Redirection...</body></html>';
  return HtmlService.createHtmlOutput(html);
}

// ─── Emails de confirmation ─────────────────────────────────────────────────

/**
 * Envoie un email de confirmation d'inscription
 */
function sendEmailConfirmation(email, nom, jeu, creneau, statut) {
  if (!email || !email.includes('@')) return;

  var siteUrl = getProp('SITE_URL') || 'le site de la convention';
  var sujet, corps;

  if (statut === 'inscrit') {
    sujet = '🎲 Inscription confirmée — ' + jeu;
    corps = '<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:24px">'
      + '<div style="background:#0D2B2B;border-radius:16px;padding:32px;color:#FDF8F0">'
      + '<h1 style="font-family:serif;color:#D4A843;font-size:24px;margin:0 0 8px">Sous l\'Œil de Mélusine</h1>'
      + '<p style="color:#7A9999;font-size:13px;margin:0 0 24px">Convention JDR · Poitiers</p>'
      + '<div style="background:#22223A;border-radius:12px;padding:24px;margin-bottom:24px">'
      + '<h2 style="color:#4A8B5E;font-size:18px;margin:0 0 12px">✅ Inscription confirmée !</h2>'
      + '<p style="color:#FDF8F0;margin:0 0 8px"><strong>Pseudo :</strong> ' + nom + '</p>'
      + '<p style="color:#FDF8F0;margin:0 0 8px"><strong>Table :</strong> ' + jeu + '</p>'
      + '<p style="color:#FDF8F0;margin:0 0 8px"><strong>Créneau :</strong> ' + creneau + '</p>'
      + '</div>'
      + '<p style="color:#BCC8C8;font-size:14px;line-height:1.6">Votre place est réservée. Vous pouvez annuler ou modifier votre inscription à tout moment sur <a href="' + siteUrl + '" style="color:#D4A843">' + siteUrl + '</a></p>'
      + '<p style="color:#7A9999;font-size:12px;margin-top:24px">À bientôt aux tables ! 🐉</p>'
      + '</div></div>';
  } else if (statut === 'attente') {
    sujet = '⏳ Liste d\'attente — ' + jeu;
    corps = '<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:24px">'
      + '<div style="background:#0D2B2B;border-radius:16px;padding:32px;color:#FDF8F0">'
      + '<h1 style="font-family:serif;color:#D4A843;font-size:24px;margin:0 0 8px">Sous l\'Œil de Mélusine</h1>'
      + '<p style="color:#7A9999;font-size:13px;margin:0 0 24px">Convention JDR · Poitiers</p>'
      + '<div style="background:#22223A;border-radius:12px;padding:24px;margin-bottom:24px">'
      + '<h2 style="color:#D4A843;font-size:18px;margin:0 0 12px">⏳ En liste d\'attente</h2>'
      + '<p style="color:#FDF8F0;margin:0 0 8px"><strong>Pseudo :</strong> ' + nom + '</p>'
      + '<p style="color:#FDF8F0;margin:0 0 8px"><strong>Table :</strong> ' + jeu + '</p>'
      + '<p style="color:#FDF8F0;margin:0 0 8px"><strong>Créneau :</strong> ' + creneau + '</p>'
      + '</div>'
      + '<p style="color:#BCC8C8;font-size:14px;line-height:1.6">Cette table est actuellement complète. Vous êtes en liste d\'attente et serez <strong>automatiquement inscrit·e</strong> si une place se libère. Vous recevrez un email de confirmation.</p>'
      + '<p style="color:#7A9999;font-size:12px;margin-top:24px">Patience, les dés tournent ! 🎲</p>'
      + '</div></div>';
  }

  try {
    MailApp.sendEmail({
      to: email,
      subject: sujet,
      htmlBody: corps
    });
  } catch (err) {
    // Silencieux : si l'envoi échoue, on ne bloque pas l'inscription
    console.log('Erreur envoi email à ' + email + ': ' + err.message);
  }
}

/**
 * Envoie un email quand quelqu'un est promu de la liste d'attente
 */
function sendEmailPromotion(email, nom, jeu, creneau) {
  if (!email || !email.includes('@')) return;

  var siteUrl = getProp('SITE_URL') || 'le site';
  var sujet = '🎉 Place libérée — ' + jeu;
  var corps = '<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:24px">'
    + '<div style="background:#0D2B2B;border-radius:16px;padding:32px;color:#FDF8F0">'
    + '<h1 style="font-family:serif;color:#D4A843;font-size:24px;margin:0 0 8px">Sous l\'Œil de Mélusine</h1>'
    + '<p style="color:#7A9999;font-size:13px;margin:0 0 24px">Convention JDR · Poitiers</p>'
    + '<div style="background:#22223A;border-radius:12px;padding:24px;margin-bottom:24px">'
    + '<h2 style="color:#4A8B5E;font-size:18px;margin:0 0 12px">🎉 Bonne nouvelle !</h2>'
    + '<p style="color:#FDF8F0;font-size:16px;margin:0 0 16px">Une place s\'est libérée et vous êtes maintenant <strong style="color:#4A8B5E">inscrit·e</strong> !</p>'
    + '<p style="color:#FDF8F0;margin:0 0 8px"><strong>Pseudo :</strong> ' + nom + '</p>'
    + '<p style="color:#FDF8F0;margin:0 0 8px"><strong>Table :</strong> ' + jeu + '</p>'
    + '<p style="color:#FDF8F0;margin:0 0 8px"><strong>Créneau :</strong> ' + creneau + '</p>'
    + '</div>'
    + '<p style="color:#BCC8C8;font-size:14px;line-height:1.6">Votre place est désormais réservée. Rendez-vous sur <a href="' + siteUrl + '" style="color:#D4A843">' + siteUrl + '</a> pour gérer vos inscriptions.</p>'
    + '<p style="color:#7A9999;font-size:12px;margin-top:24px">On se retrouve aux tables ! 🐉</p>'
    + '</div></div>';

  try {
    MailApp.sendEmail({ to: email, subject: sujet, htmlBody: corps });
  } catch (err) {
    console.log('Erreur envoi email promo à ' + email + ': ' + err.message);
  }
}

/**
 * Envoie un email de confirmation d'annulation
 */
function sendEmailAnnulation(email, nom, jeu, creneau) {
  if (!email || !email.includes('@')) return;

  var sujet = '❌ Inscription annulée — ' + jeu;
  var corps = '<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:24px">'
    + '<div style="background:#0D2B2B;border-radius:16px;padding:32px;color:#FDF8F0">'
    + '<h1 style="font-family:serif;color:#D4A843;font-size:24px;margin:0 0 8px">Sous l\'Œil de Mélusine</h1>'
    + '<p style="color:#7A9999;font-size:13px;margin:0 0 24px">Convention JDR · Poitiers</p>'
    + '<div style="background:#22223A;border-radius:12px;padding:24px;margin-bottom:24px">'
    + '<h2 style="color:#B8293A;font-size:18px;margin:0 0 12px">Inscription annulée</h2>'
    + '<p style="color:#FDF8F0;margin:0 0 8px"><strong>Table :</strong> ' + jeu + '</p>'
    + '<p style="color:#FDF8F0;margin:0 0 8px"><strong>Créneau :</strong> ' + creneau + '</p>'
    + '</div>'
    + '<p style="color:#BCC8C8;font-size:14px">Votre inscription a bien été annulée. Vous pouvez vous réinscrire à tout moment.</p>'
    + '</div></div>';

  try {
    MailApp.sendEmail({ to: email, subject: sujet, htmlBody: corps });
  } catch (err) {
    console.log('Erreur envoi email annulation à ' + email + ': ' + err.message);
  }
}

// ─── Point d'entrée GET ─────────────────────────────────────────────────────

function doGet(e) {
  var action = (e.parameter.action || '').toString();
  var callback = e.parameter.callback || null;

  try {
    switch (action) {

      case 'get_programme':
        return jsonResponse(getProgrammeAvecPlaces(), callback);

      case 'get_inscriptions':
        return jsonResponse(getInscriptionsPubliques(e.parameter), callback);

      case 'get_mes_inscriptions':
        return jsonResponse(getMesInscriptions(e.parameter), callback);

      case 'inscrire':
        return jsonResponse(inscrire(e.parameter), callback);

      case 'annuler':
        return jsonResponse(annuler(e.parameter), callback);

      case 'discord_auth':
        return discordStartAuth(e);

      case 'discord_callback':
        return discordCallback(e);

      case 'discord_exchange':
        return jsonResponse(discordExchange(e.parameter), callback);

      case 'admin_data':
        return jsonResponse(getAdminData(e.parameter), callback);

      case 'admin_promouvoir':
        return jsonResponse(adminPromouvoir(e.parameter), callback);

      case 'admin_supprimer':
        return jsonResponse(adminSupprimer(e.parameter), callback);

      default:
        return jsonResponse({ ok: true, message: 'API Mélusine active' }, callback);
    }
  } catch (err) {
    return jsonResponse({ error: err.message }, callback);
  }
}

// On utilise aussi doPost pour les requêtes POST (inscription depuis le site)
function doPost(e) {
  var data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ error: 'JSON invalide' });
  }

  try {
    switch (data.action) {
      case 'inscrire':
        return jsonResponse(inscrire(data));
      case 'annuler':
        return jsonResponse(annuler(data));
      default:
        return jsonResponse({ error: 'Action inconnue' });
    }
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

// ─── Programme avec places restantes ────────────────────────────────────────

function getProgrammeAvecPlaces() {
  var programme = readSheet('programme');
  var inscriptions = readSheet('inscriptions');

  // Compter les inscrits (pas en attente, pas annulés) par créneau+jeu
  var counts = {};
  inscriptions.forEach(function(ins) {
    if (ins.statut === 'inscrit') {
      var key = ins.creneau + '|||' + ins.jeu;
      counts[key] = (counts[key] || 0) + 1;
    }
  });

  // Ajouter les infos de places à chaque créneau
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

// ─── Inscriptions publiques (pour afficher les noms) ────────────────────────

function getInscriptionsPubliques(params) {
  var inscriptions = readSheet('inscriptions');
  // Ne retourne que les infos publiques (pas les emails)
  var publiques = inscriptions
    .filter(function(i) { return i.statut === 'inscrit' || i.statut === 'attente'; })
    .map(function(i) {
      return {
        nom: i.nom,
        creneau: i.creneau,
        jeu: i.jeu,
        statut: i.statut
      };
    });
  return { ok: true, inscriptions: publiques };
}

// ─── Mes inscriptions (par email) ───────────────────────────────────────────

function getMesInscriptions(params) {
  var email = (params.email || '').toLowerCase().trim();
  if (!email) return { error: 'Email requis' };

  var inscriptions = readSheet('inscriptions');
  var miennes = inscriptions.filter(function(i) {
    return i.email.toLowerCase().trim() === email
      && (i.statut === 'inscrit' || i.statut === 'attente');
  });

  return { ok: true, inscriptions: miennes };
}

// ─── Inscription ────────────────────────────────────────────────────────────

function inscrire(params) {
  var nom = (params.nom || '').trim();
  var email = (params.email || '').toLowerCase().trim();
  var authType = (params.auth_type || 'email').trim();
  var authId = (params.auth_id || '').trim();
  var creneau = (params.creneau || '').trim();
  var jeu = (params.jeu || '').trim();

  // Validation
  if (!nom) return { error: 'Le nom est requis' };
  if (!email) return { error: "L'email est requis" };
  if (!creneau || !jeu) return { error: 'Créneau et jeu requis' };

  // Vérifier si déjà inscrit à ce créneau (même jeu)
  var inscriptions = readSheet('inscriptions');
  var dejaInscrit = inscriptions.some(function(i) {
    return i.email.toLowerCase().trim() === email
      && i.creneau === creneau
      && i.jeu === jeu
      && (i.statut === 'inscrit' || i.statut === 'attente');
  });

  if (dejaInscrit) {
    return { error: 'Vous êtes déjà inscrit·e à cette table.' };
  }

  // Vérifier si déjà inscrit à un AUTRE jeu sur le même créneau
  var autreJeuMemeCreneau = inscriptions.find(function(i) {
    return i.email.toLowerCase().trim() === email
      && i.creneau === creneau
      && i.jeu !== jeu
      && (i.statut === 'inscrit' || i.statut === 'attente');
  });

  if (autreJeuMemeCreneau) {
    return { error: 'Vous êtes déjà inscrit·e sur ce créneau (' + autreJeuMemeCreneau.jeu + '). Annulez d\'abord votre inscription pour changer de table.' };
  }

  // Vérifier les places disponibles
  var programme = readSheet('programme');
  var creneauInfo = programme.find(function(p) {
    return p.creneau === creneau && p.jeu === jeu;
  });

  if (!creneauInfo) return { error: 'Créneau introuvable' };

  var maxPlaces = parseInt(creneauInfo.places) || 0;
  var inscritsCount = inscriptions.filter(function(i) {
    return i.creneau === creneau && i.jeu === jeu && i.statut === 'inscrit';
  }).length;

  // Déterminer le statut
  var statut = (inscritsCount < maxPlaces) ? 'inscrit' : 'attente';

  // Écrire l'inscription
  var sheet = getSheet('inscriptions');
  sheet.appendRow([
    new Date().toISOString(),  // timestamp
    nom,                        // nom
    email,                      // email
    authType,                   // auth_type
    authId,                     // auth_id
    creneau,                    // creneau
    jeu,                        // jeu
    statut                      // statut
  ]);

  // Envoyer l'email de confirmation
  sendEmailConfirmation(email, nom, jeu, creneau, statut);

  var placesRestantes = Math.max(0, maxPlaces - inscritsCount - (statut === 'inscrit' ? 1 : 0));

  return {
    ok: true,
    statut: statut,
    message: statut === 'inscrit'
      ? 'Inscription confirmée ! 🎲'
      : 'Créneau complet — vous êtes en liste d\'attente. Vous serez notifié·e si une place se libère.',
    places_restantes: placesRestantes
  };
}

// ─── Annulation ─────────────────────────────────────────────────────────────

function annuler(params) {
  var email = (params.email || '').toLowerCase().trim();
  var creneau = (params.creneau || '').trim();
  var jeu = (params.jeu || '').trim();

  if (!email || !creneau || !jeu) return { error: 'Paramètres manquants' };

  var sheet = getSheet('inscriptions');
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var emailCol = headers.indexOf('email');
  var creneauCol = headers.indexOf('creneau');
  var jeuCol = headers.indexOf('jeu');
  var statutCol = headers.indexOf('statut');

  // Trouver et marquer comme annulé
  var annule = false;
  var wasInscrit = false;

  for (var i = 1; i < data.length; i++) {
    if (data[i][emailCol].toString().toLowerCase().trim() === email
        && data[i][creneauCol].toString().trim() === creneau
        && data[i][jeuCol].toString().trim() === jeu
        && (data[i][statutCol] === 'inscrit' || data[i][statutCol] === 'attente')) {

      wasInscrit = (data[i][statutCol] === 'inscrit');
      sheet.getRange(i + 1, statutCol + 1).setValue('annulé');
      annule = true;
      break;
    }
  }

  if (!annule) return { error: 'Inscription introuvable' };

  // Envoyer l'email d'annulation
  sendEmailAnnulation(email, '', jeu, creneau);

  // Si c'était un inscrit, promouvoir le premier en attente
  if (wasInscrit) {
    promouvoirPremierEnAttente(creneau, jeu);
  }

  return { ok: true, message: 'Inscription annulée.' };
}

/**
 * Promouvoit automatiquement le premier en liste d'attente
 */
function promouvoirPremierEnAttente(creneau, jeu) {
  var sheet = getSheet('inscriptions');
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var creneauCol = headers.indexOf('creneau');
  var jeuCol = headers.indexOf('jeu');
  var statutCol = headers.indexOf('statut');
  var timestampCol = headers.indexOf('timestamp');

  // Trouver le premier en attente (par ordre chronologique)
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
    sheet.getRange(premierRow + 1, statutCol + 1).setValue('inscrit');

    // Récupérer nom et email pour envoyer la notification
    var nomCol = headers.indexOf('nom');
    var emailCol = headers.indexOf('email');
    var promuNom = data[premierRow][nomCol] ? data[premierRow][nomCol].toString() : '';
    var promuEmail = data[premierRow][emailCol] ? data[premierRow][emailCol].toString() : '';
    sendEmailPromotion(promuEmail, promuNom, jeu, creneau);
  }
}

// ─── Discord OAuth ──────────────────────────────────────────────────────────

/**
 * Démarre le flux Discord OAuth (redirige vers Discord)
 */
function discordStartAuth(e) {
  // Plus utilisé — la redirection se fait côté client maintenant
  return jsonResponse({ error: 'Utilisez le site pour vous connecter via Discord' });
}

/**
 * Échange le code Discord contre les infos utilisateur (appelé en API par le site)
 * Le site reçoit le code de Discord directement, puis appelle cette action
 */
function discordExchange(params) {
  var code = (params.code || '').trim();
  var redirectUri = (params.redirect_uri || '').trim();

  if (!code) return { error: 'Code Discord manquant' };

  var clientId = getProp('DISCORD_CLIENT_ID');
  var clientSecret = getProp('DISCORD_SECRET');

  if (!clientId || !clientSecret) return { error: 'Discord non configuré côté serveur' };

  // Échanger le code contre un token
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

  // Récupérer les infos utilisateur
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
 * Ancien callback — redirige vers le site si quelqu'un arrive ici par erreur
 */
function discordCallback(e) {
  var siteUrl = getProp('SITE_URL') || '';
  return htmlRedirect(siteUrl + '?error=discord_use_site');
}

// ─── Admin ──────────────────────────────────────────────────────────────────

function getAdminData(params) {
  var password = (params.password || '').trim();
  if (password !== getProp('ADMIN_PASSWORD')) {
    return { error: 'Mot de passe incorrect' };
  }

  var inscriptions = readSheet('inscriptions');
  var programme = readSheet('programme');

  // Stats par créneau
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

function adminPromouvoir(params) {
  var password = (params.password || '').trim();
  if (password !== getProp('ADMIN_PASSWORD')) {
    return { error: 'Mot de passe incorrect' };
  }

  var rowIndex = parseInt(params.row) || 0;
  if (rowIndex < 2) return { error: 'Ligne invalide' };

  var sheet = getSheet('inscriptions');
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var statutCol = headers.indexOf('statut') + 1;

  if (statutCol < 1) return { error: 'Colonne statut introuvable' };

  var currentStatut = sheet.getRange(rowIndex, statutCol).getValue();
  if (currentStatut !== 'attente') {
    return { error: 'Cette inscription n\'est pas en attente' };
  }

  sheet.getRange(rowIndex, statutCol).setValue('inscrit');
  return { ok: true, message: 'Inscription promue !' };
}

function adminSupprimer(params) {
  var password = (params.password || '').trim();
  if (password !== getProp('ADMIN_PASSWORD')) {
    return { error: 'Mot de passe incorrect' };
  }

  var rowIndex = parseInt(params.row) || 0;
  if (rowIndex < 2) return { error: 'Ligne invalide' };

  var sheet = getSheet('inscriptions');
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var statutCol = headers.indexOf('statut') + 1;

  sheet.getRange(rowIndex, statutCol).setValue('supprimé');
  return { ok: true, message: 'Inscription supprimée.' };


}

function testEmail() {
  sendEmailConfirmation('olivier.gramain@gmail.com', 'Olive', 'STRISCIA', 'Samedi 10h-13h', 'inscrit');
}

function forceAuth() {
  MailApp.sendEmail('olivier.gramain@gmail.com', 'Test Mélusine', 'Ceci est un test');
}
