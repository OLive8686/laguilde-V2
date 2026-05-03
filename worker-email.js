// =============================================================================
// CLOUDFLARE WORKER — Service d'envoi d'emails transactionnels
// =============================================================================
// Ce Worker reçoit des requêtes POST du frontend (après inscription, annulation,
// validation de table, etc.) et envoie des emails via l'API Resend.
//
// ARCHITECTURE :
//   Frontend (app.js) → POST /send-email → Ce Worker → API Resend → Email
//
// POURQUOI un Worker séparé ?
//   - La clé API Resend reste côté serveur (jamais exposée au frontend)
//   - Découplé du proxy GAS (worker.js) : chaque Worker a une responsabilité
//   - Resend offre 100 emails/jour gratuits (sans carte bancaire)
//
// DÉPLOIEMENT :
//   1. Créer un Worker sur dash.cloudflare.com → Workers & Pages → Create
//   2. Coller ce code dans l'éditeur du Worker
//   3. Ajouter les variables d'environnement dans Settings → Variables :
//      - RESEND_API_KEY  : clé API Resend
//      - WEBHOOK_SECRET  : secret partagé avec pg_net (même valeur que dans email-triggers.sql)
//   4. (Optionnel) Ajouter FROM_EMAIL si vous avez un domaine vérifié sur Resend
//   5. Dans app.js, définir EMAIL_WORKER_URL avec l'URL de ce Worker
//
// RESEND — CONFIGURATION :
//   - Créer un compte sur https://resend.com (gratuit, pas de CB)
//   - Récupérer la clé API dans Settings → API Keys
//   - Par défaut, Resend envoie depuis "onboarding@resend.dev" (limité)
//   - Pour un domaine custom : ajouter un domaine dans Resend → Domains
//     puis configurer les DNS (DKIM, SPF, DMARC)
//
// SÉCURITÉ :
//   - CORS restreint aux origines autorisées (même liste que worker.js)
//   - La clé API est dans une variable d'environnement (jamais dans le code)
//   - Validation stricte du type d'email et des paramètres
//   - Rate limiting basique par IP (10 emails/minute)
//   - Aucune donnée sensible dans les logs
//
// TYPES D'EMAILS SUPPORTÉS :
//   - confirmation : inscription confirmée ou liste d'attente
//   - promotion    : promotion depuis la liste d'attente
//   - annulation   : inscription annulée
//   - accompagnant_supprime : accompagnant supprimé (+ inscriptions annulées)
//   - table_validee  : proposition de table MJ validée par l'admin
//   - table_refusee  : proposition de table MJ refusée par l'admin
//   - recap          : récapitulatif complet des inscriptions
// =============================================================================

// ── Origines autorisées (CORS) — identiques à worker.js ──
const ALLOWED_ORIGINS = [
  'https://sousloeildemelusine.fr',
  'https://olive8686.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];

// ── Couleurs par défaut du thème Mélusine (dark) ──
// Ces valeurs sont utilisées si aucune config custom n'est passée.
const DEFAULT_COLORS = {
  bg:       '#F5EFE5',   // Fond principal (beige clair)
  cardBg:   '#FFFFFF',   // Fond des cartes (blanc)
  accent:   '#D4A030',   // Or / accent (titres, liens)
  text:     '#1A2A3A',   // Texte principal (bleu foncé)
  muted:    '#6A8899',   // Texte secondaire (gris-bleu)
  light:    '#4A6070',   // Texte tertiaire (gris foncé)
  success:  '#4A8B5E',   // Vert succès
  error:    '#B8293A',   // Rouge erreur
};

// ── Types d'emails autorisés ──
// Sécurité : on refuse tout type non listé pour éviter les abus
const ALLOWED_EMAIL_TYPES = [
  'confirmation',
  'promotion',
  'annulation',
  'accompagnant_supprime',
  'table_validee',
  'table_refusee',
  'nouvelle_proposition',
  'proposition_recue',
  'recap',
  'rappel',  // J-3 : rappel envoyé 3 jours avant la convention
];

// ── URL du site (pour les liens dans les emails) ──
const SITE_URL = 'https://sousloeildemelusine.fr/';

// ── Dates de la convention (pour les liens agenda) ──
const DATE_SAMEDI   = '2026-05-16';
const DATE_DIMANCHE = '2026-05-17';

// ── Lieu de la convention (pour les événements agenda) ──
const LIEU_NOM     = 'Salle Gérard Gaschet';
const LIEU_ADRESSE = 'Poitiers';


// =============================================================================
// HELPERS — Headers CORS
// =============================================================================

/**
 * Génère les headers CORS en vérifiant l'origine de la requête.
 * Seules les origines listées dans ALLOWED_ORIGINS sont acceptées.
 * @param {Request} request - La requête entrante
 * @returns {Object} Les headers CORS à inclure dans la réponse
 */
function getCorsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Webhook-Secret',
    'Vary': 'Origin',
  };
}


// =============================================================================
// RATE LIMITING — Protection anti-abus
// =============================================================================
// Rate limiting basique en mémoire. Attention : en production, chaque
// instance du Worker a sa propre mémoire. Pour un rate limiting plus robuste,
// utiliser Cloudflare Rate Limiting (payant) ou KV/Durable Objects.
// Pour notre usage (convention ~200 personnes), c'est largement suffisant.

/** @type {Map<string, {count: number, resetAt: number}>} */
const rateLimitMap = new Map();

/**
 * Vérifie si une IP a dépassé la limite d'envoi (10 emails / minute).
 * @param {string} ip - L'adresse IP du client
 * @returns {boolean} true si la limite est dépassée, false sinon
 */
function isRateLimited(ip) {
  const now = Date.now();
  const limit = rateLimitMap.get(ip);

  // Pas d'entrée ou fenêtre expirée → on crée/recrée
  if (!limit || now > limit.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60000 }); // 1 minute
    return false;
  }

  // Incrémenter le compteur
  limit.count++;
  if (limit.count > 10) {
    return true; // Limite dépassée
  }
  return false;
}


// =============================================================================
// TEMPLATE HTML — Construction des emails
// =============================================================================

/**
 * Construit le HTML complet d'un email avec le thème Mélusine.
 * Structure : en-tête "Sous l'Œil de Mélusine" + carte avec titre/champs + paragraphe + pied.
 *
 * @param {Object} options
 * @param {string} options.titreBloc    - Titre affiché dans la carte (ex: "Inscription confirmée !")
 * @param {string} options.couleurTitre - Couleur CSS du titre (ex: "#4A8B5E")
 * @param {Array}  options.champs       - Liste de { label, valeur } affichés sous le titre
 * @param {string} [options.paragraphe] - Texte libre sous la carte
 * @param {string} [options.pied]       - Petit texte en bas de l'email
 * @param {Object} [options.colors]     - Couleurs custom (écrase les défauts)
 * @returns {string} Le HTML complet de l'email
 */
function buildEmailHtml(options) {
  // Fusionner les couleurs custom avec les défauts
  const c = { ...DEFAULT_COLORS, ...(options.colors || {}) };

  // Construction des lignes de champs (Pseudo, Table, Créneau...)
  let champsHtml = '';
  if (options.champs && options.champs.length > 0) {
    for (const champ of options.champs) {
      champsHtml += `<p style="color:${c.text};margin:0 0 8px"><strong>${champ.label} :</strong> ${champ.valeur}</p>`;
    }
  }

  // Template HTML — identique à l'ancien code.gs mais en template literal
  return `<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:24px">`
    + `<div style="background:${c.bg};border-radius:16px;padding:32px;color:${c.text}">`
    + `<h1 style="font-family:serif;color:${c.accent};font-size:24px;margin:0 0 8px">Sous l'Œil de Mélusine</h1>`
    + `<p style="color:${c.muted};font-size:13px;margin:0 0 24px">Convention JDR &middot; Poitiers</p>`
    + `<div style="background:${c.cardBg};border-radius:12px;padding:24px;margin-bottom:24px">`
    + `<h2 style="color:${options.couleurTitre};font-size:18px;margin:0 0 12px">${options.titreBloc}</h2>`
    + champsHtml
    + `</div>`
    + (options.paragraphe ? `<p style="color:${c.light};font-size:14px;line-height:1.6">${options.paragraphe}</p>` : '')
    + (options.pied ? `<p style="color:${c.muted};font-size:12px;margin-top:24px">${options.pied}</p>` : '')
    // Lien vers le site ajouté automatiquement dans tous les emails
    + `<p style="color:${c.muted};font-size:12px;margin-top:16px;text-align:center;border-top:1px solid ${c.muted}33;padding-top:16px">`
    + `<a href="${SITE_URL}" style="color:${c.accent};text-decoration:none">${SITE_URL}</a>`
    + `</p>`
    + `</div></div>`;
}


// =============================================================================
// LIENS AGENDA — Google Calendar + .ics
// =============================================================================

/**
 * Parse un créneau textuel (ex: "Samedi 10h-13h") en dates start/end
 * au format YYYYMMDDTHHMMSS (pour Google Calendar et .ics).
 *
 * @param {string} creneau - Le créneau textuel
 * @returns {Object|null} { start, end } au format YYYYMMDDTHHMMSS, ou null si non parsable
 */
function parseCreneauDates(creneau) {
  if (!creneau) return null;

  // Déterminer le jour à partir du texte du créneau
  let date;
  const lower = creneau.toLowerCase();
  if (lower.includes('samedi')) date = DATE_SAMEDI;
  else if (lower.includes('dimanche')) date = DATE_DIMANCHE;
  else return null;

  // Extraire les heures : pattern "XXh-YYh" ou "XXh00-YYh00"
  const match = creneau.match(/(\d{1,2})h(\d{2})?[–\-](\d{1,2})h(\d{2})?/i);
  if (!match) return null;

  const startH = parseInt(match[1]);
  const startM = match[2] ? parseInt(match[2]) : 0;
  const endH   = parseInt(match[3]);
  const endM   = match[4] ? parseInt(match[4]) : 0;

  // Si le créneau passe minuit (ex: 21h-01h), la fin est le jour suivant
  let endDate = date;
  if (endH < startH) {
    const d = new Date(date + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    const y  = d.getFullYear();
    const mo = ('0' + (d.getMonth() + 1)).slice(-2);
    const da = ('0' + d.getDate()).slice(-2);
    endDate = `${y}-${mo}-${da}`;
  }

  // Formater en YYYYMMDDTHHMMSS
  const fmt = (d, h, m) => {
    return d.replace(/-/g, '') + 'T' + (h < 10 ? '0' : '') + h + (m < 10 ? '0' : '') + m + '00';
  };

  return { start: fmt(date, startH, startM), end: fmt(endDate, endH, endM) };
}

/**
 * Construit le HTML des liens "Ajouter à l'agenda" pour un email.
 * Génère un lien Google Calendar et un lien .ics (data URI).
 *
 * @param {string} creneau - Le créneau (ex: "Samedi 10h-13h")
 * @param {string} jeu     - Le nom du jeu / événement
 * @param {string} type    - "table" ou "benevole" (adapte le titre)
 * @returns {string} HTML des liens, ou chaîne vide si créneau non parsable
 */
function buildCalendarLinks(creneau, jeu, type) {
  const dates = parseCreneauDates(creneau);
  if (!dates) return '';

  const lieu = `${LIEU_NOM}, ${LIEU_ADRESSE}`;
  const titre = type === 'benevole'
    ? `Bénévolat Mélusine — ${creneau}`
    : `${jeu} — Sous l'Œil de Mélusine`;
  const description = type === 'benevole'
    ? `Créneau bénévole à la convention Sous l'Œil de Mélusine`
    : `Table de JDR : ${jeu} · Créneau : ${creneau}`;

  // Lien Google Calendar
  const gcalUrl = 'https://calendar.google.com/calendar/render?action=TEMPLATE'
    + '&text='     + encodeURIComponent(titre)
    + '&dates='    + dates.start + '/' + dates.end
    + '&location=' + encodeURIComponent(lieu)
    + '&details='  + encodeURIComponent(description)
    + '&ctz=Europe/Paris';

  // Contenu .ics (fichier iCalendar universel — Outlook, Apple Calendar, etc.)
  const ics = 'BEGIN:VCALENDAR\r\n'
    + 'VERSION:2.0\r\n'
    + 'PRODID:-//Melusine//Convention JDR//FR\r\n'
    + 'BEGIN:VEVENT\r\n'
    + 'DTSTART;TZID=Europe/Paris:' + dates.start + '\r\n'
    + 'DTEND;TZID=Europe/Paris:'   + dates.end + '\r\n'
    + 'SUMMARY:'     + titre.replace(/[,;\\]/g, ' ') + '\r\n'
    + 'LOCATION:'    + lieu.replace(/[,;\\]/g, ' ') + '\r\n'
    + 'DESCRIPTION:' + description.replace(/[,;\\]/g, ' ') + '\r\n'
    + 'END:VEVENT\r\n'
    + 'END:VCALENDAR';

  // Encoder le .ics en data URI pour le lien de téléchargement
  const icsDataUri = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);

  return `<p style="margin-top:16px;font-size:13px;color:${DEFAULT_COLORS.muted}">`
    + `📅 Ajouter à mon agenda : `
    + `<a href="${gcalUrl}" target="_blank" style="color:${DEFAULT_COLORS.accent};text-decoration:underline">Google Agenda</a>`
    + ` · `
    + `<a href="${icsDataUri}" download="melusine.ics" style="color:${DEFAULT_COLORS.accent};text-decoration:underline">iCal / Outlook (.ics)</a>`
    + `</p>`;
}


// =============================================================================
// GÉNÉRATEURS D'EMAILS — Un par type, reproduisant code.gs à l'identique
// =============================================================================

/**
 * Génère l'email de confirmation d'inscription (inscrit ou liste d'attente).
 * @param {Object} data - { nom, jeu, creneau, statut ("inscrit"|"attente") }
 * @returns {Object} { subject, html }
 */
function buildConfirmationEmail(data) {
  const { nom, jeu, creneau, statut } = data;
  const champs = [
    { label: 'Pseudo', valeur: nom },
    { label: 'Table',  valeur: jeu },
    { label: 'Créneau', valeur: creneau },
  ];
  const calLinks = buildCalendarLinks(creneau, jeu, 'table');

  if (statut === 'inscrit') {
    return {
      subject: `🎲 Inscription confirmée — ${jeu}`,
      html: buildEmailHtml({
        titreBloc: '✅ Inscription confirmée !',
        couleurTitre: DEFAULT_COLORS.success,
        champs,
        paragraphe: `Votre place est réservée. Vous pouvez annuler ou modifier votre inscription à tout moment sur `
          + `<a href="${SITE_URL}" style="color:${DEFAULT_COLORS.accent}">${SITE_URL}</a>.`
          + calLinks,
        pied: 'À bientôt aux tables ! 🐉',
      }),
    };
  }

  // statut === 'attente'
  return {
    subject: `⏳ Liste d'attente — ${jeu}`,
    html: buildEmailHtml({
      titreBloc: '⏳ En liste d\'attente',
      couleurTitre: DEFAULT_COLORS.accent,
      champs,
      paragraphe: `Cette table est actuellement complète. Vous êtes en liste d'attente et serez `
        + `<strong>automatiquement inscrit·e</strong> si une place se libère. Vous recevrez un email de confirmation.`,
      pied: 'Patience, les dés tournent ! 🎲',
    }),
  };
}

/**
 * Génère l'email de promotion depuis la liste d'attente.
 * @param {Object} data - { nom, jeu, creneau }
 * @returns {Object} { subject, html }
 */
function buildPromotionEmail(data) {
  const { nom, jeu, creneau } = data;
  const calLinks = buildCalendarLinks(creneau, jeu, 'table');

  return {
    subject: `🎉 Place libérée — ${jeu}`,
    html: buildEmailHtml({
      titreBloc: '🎉 Bonne nouvelle !',
      couleurTitre: DEFAULT_COLORS.success,
      champs: [
        { label: 'Pseudo', valeur: nom },
        { label: 'Table',  valeur: jeu },
        { label: 'Créneau', valeur: creneau },
      ],
      paragraphe: `Une place s'est libérée et vous êtes maintenant <strong style="color:${DEFAULT_COLORS.success}">inscrit·e</strong> ! `
        + `Rendez-vous sur <a href="${SITE_URL}" style="color:${DEFAULT_COLORS.accent}">${SITE_URL}</a> pour gérer vos inscriptions.`
        + calLinks,
      pied: 'On se retrouve aux tables ! 🐉',
    }),
  };
}

/**
 * Génère l'email de confirmation d'annulation.
 * @param {Object} data - { nom, jeu, creneau }
 * @returns {Object} { subject, html }
 */
function buildAnnulationEmail(data) {
  const { jeu, creneau } = data;

  return {
    subject: `❌ Inscription annulée — ${jeu}`,
    html: buildEmailHtml({
      titreBloc: 'Inscription annulée',
      couleurTitre: DEFAULT_COLORS.error,
      champs: [
        { label: 'Table',   valeur: jeu },
        { label: 'Créneau', valeur: creneau },
      ],
      paragraphe: 'Votre inscription a bien été annulée. Vous pouvez vous réinscrire à tout moment.',
      pied: '',
    }),
  };
}

/**
 * Génère l'email de suppression d'un accompagnant.
 * @param {Object} data - { nomAccompagnant, nbAnnulees }
 * @returns {Object} { subject, html }
 */
function buildAccompagnantSupprimeEmail(data) {
  const { nomAccompagnant, nbAnnulees } = data;

  return {
    subject: `Accompagnant supprimé — ${nomAccompagnant}`,
    html: buildEmailHtml({
      titreBloc: 'Accompagnant supprimé',
      couleurTitre: DEFAULT_COLORS.error,
      champs: [
        { label: 'Accompagnant',          valeur: nomAccompagnant },
        { label: 'Inscriptions annulées',  valeur: String(nbAnnulees) },
      ],
      paragraphe: "L'accompagnant a été supprimé et ses inscriptions ont été annulées.",
      pied: '',
    }),
  };
}

/**
 * Génère l'email de validation d'une table MJ.
 * @param {Object} data - { jeu, creneau }
 * @returns {Object} { subject, html }
 */
function buildTableValideeEmail(data) {
  const { jeu, creneau } = data;
  const calLinks = buildCalendarLinks(creneau, jeu, 'table');

  return {
    subject: `✅ Table validée — ${jeu}`,
    html: buildEmailHtml({
      titreBloc: '✅ Table validée !',
      couleurTitre: DEFAULT_COLORS.success,
      champs: [
        { label: 'Table',   valeur: jeu },
        { label: 'Créneau', valeur: creneau },
      ],
      paragraphe: `Votre proposition de table a été <strong>validée</strong> par l'équipe organisatrice. `
        + `Elle est maintenant visible dans le programme et les joueurs peuvent s'y inscrire.`
        + `<br><br>Voir le programme : <a href="${SITE_URL}" style="color:${DEFAULT_COLORS.accent}">${SITE_URL}</a>`
        + calLinks,
      pied: 'Merci pour votre participation ! 🎲',
    }),
  };
}

/**
 * Génère l'email de refus d'une table MJ.
 * @param {Object} data - { jeu, creneau }
 * @returns {Object} { subject, html }
 */
function buildTableRefuseeEmail(data) {
  const { jeu, creneau } = data;

  return {
    subject: `❌ Table non retenue — ${jeu}`,
    html: buildEmailHtml({
      titreBloc: 'Table non retenue',
      couleurTitre: DEFAULT_COLORS.error,
      champs: [
        { label: 'Table',   valeur: jeu },
        { label: 'Créneau', valeur: creneau },
      ],
      paragraphe: "Votre proposition de table n'a pas été retenue pour cette édition. "
        + "N'hésitez pas à contacter l'équipe organisatrice si vous avez des questions ou souhaitez proposer une autre table.",
      pied: '',
    }),
  };
}

/**
 * Génère l'email de notification admin pour une nouvelle proposition de table MJ.
 * @param {Object} data - { jeu, mj, email_mj, creneau, places }
 * @returns {Object} { subject, html }
 */
function buildNouvellePropositionEmail(data) {
  const { jeu, mj, email_mj, creneau, places } = data;

  return {
    subject: `📋 Nouvelle proposition de table — ${jeu}`,
    html: buildEmailHtml({
      titreBloc: '📋 Nouvelle proposition de table',
      couleurTitre: DEFAULT_COLORS.accent,
      champs: [
        { label: 'Table', valeur: jeu || 'Non précisé' },
        { label: 'MJ', valeur: (mj || '') + (email_mj ? ' (' + email_mj + ')' : '') },
        { label: 'Créneau', valeur: creneau || 'Non précisé' },
        { label: 'Places', valeur: String(places || '5') },
      ],
      paragraphe: 'Un MJ a proposé une nouvelle table pour la convention. '
        + 'Connectez-vous au <a href="' + SITE_URL + 'admin.html" style="color:' + DEFAULT_COLORS.accent + '">panneau admin</a> pour la valider ou la refuser.',
      pied: '',
    }),
  };
}

/**
 * Génère l'email de confirmation de prise en compte d'une proposition MJ.
 * Envoyé au MJ quand sa table est en attente de validation par les admins.
 * @param {Object} data - { nom, jeu, creneau }
 * @returns {Object} { subject, html }
 */
function buildPropositionRecueEmail(data) {
  const { nom, jeu, creneau } = data;

  return {
    subject: `📋 Proposition reçue — ${jeu}`,
    html: buildEmailHtml({
      titreBloc: '📋 Proposition reçue',
      couleurTitre: DEFAULT_COLORS.accent,
      champs: [
        { label: 'MJ', valeur: nom },
        { label: 'Table', valeur: jeu },
        { label: 'Créneau', valeur: creneau },
      ],
      paragraphe: `Votre proposition de table a bien été prise en compte. Elle est en attente de validation par l'équipe organisatrice. `
        + `Vous recevrez un email dès qu'elle sera validée ou si nous avons des questions.`,
      pied: 'Merci pour votre participation ! 🎲',
    }),
  };
}

/**
 * Génère l'email récapitulatif complet des inscriptions d'un utilisateur.
 * Inclut : tables JDR (joueur + accompagnants), bénévolat, tables MJ.
 *
 * @param {Object} data - {
 *   inscriptions: [{ jeu, creneau, statut, nom_accompagnant? }],
 *   benevoles:    [{ creneau, nom_accompagnant? }],
 *   tablesMJ:     [{ jeu, creneau, statut_table }]
 * }
 * @returns {Object} { subject, html }
 */
function buildRecapEmail(data) {
  const { inscriptions = [], benevoles = [], tablesMJ = [], repas = [] } = data;
  const c = DEFAULT_COLORS;

  let sections = '';

  // --- Section MJ ---
  if (tablesMJ.length > 0) {
    sections += `<h3 style="color:${c.accent};font-size:16px;margin:16px 0 8px">🎲 Mes tables MJ</h3>`;
    for (const t of tablesMJ) {
      const statut = t.statut_table === 'validé' ? '✅ Validée' : '⏳ En attente';
      sections += `<p style="color:${c.text};margin:0 0 4px">• <strong>${t.jeu}</strong> — ${t.creneau} (${statut})</p>`;
      if (t.statut_table === 'validé') {
        sections += buildCalendarLinks(t.creneau, t.jeu + ' (MJ)', 'table');
      }
    }
  }

  // --- Section Joueur (inscriptions personnelles) ---
  const perso = inscriptions.filter(i => !i.nom_accompagnant || i.nom_accompagnant.trim() === '');
  if (perso.length > 0) {
    sections += `<h3 style="color:${c.success};font-size:16px;margin:16px 0 8px">🧑 Mes tables joueur</h3>`;
    for (const i of perso) {
      const statut = i.statut === 'inscrit' ? '✅ Inscrit·e' : '⏳ En attente';
      sections += `<p style="color:${c.text};margin:0 0 4px">• <strong>${i.jeu}</strong> — ${i.creneau} (${statut})</p>`;
      if (i.statut === 'inscrit') {
        sections += buildCalendarLinks(i.creneau, i.jeu, 'table');
      }
    }
  }

  // --- Section Accompagnants ---
  const accs = inscriptions.filter(i => i.nom_accompagnant && i.nom_accompagnant.trim() !== '');
  if (accs.length > 0) {
    sections += `<h3 style="color:${c.accent};font-size:16px;margin:16px 0 8px">👤 Accompagnants</h3>`;
    for (const i of accs) {
      const statut = i.statut === 'inscrit' ? '✅' : '⏳';
      sections += `<p style="color:${c.text};margin:0 0 4px">• ${i.nom_accompagnant} → <strong>${i.jeu}</strong> — ${i.creneau} ${statut}</p>`;
    }
  }

  // --- Section Bénévolat ---
  const benPerso = benevoles.filter(b => !b.nom_accompagnant || b.nom_accompagnant.trim() === '');
  const benAcc   = benevoles.filter(b => b.nom_accompagnant && b.nom_accompagnant.trim() !== '');

  if (benPerso.length > 0) {
    sections += `<h3 style="color:${c.accent};font-size:16px;margin:16px 0 8px">🤝 Bénévolat</h3>`;
    for (const b of benPerso) {
      sections += `<p style="color:${c.text};margin:0 0 4px">• <strong>${b.creneau}</strong></p>`;
      sections += buildCalendarLinks(b.creneau, 'Bénévolat', 'benevole');
    }
  }

  if (benAcc.length > 0) {
    sections += `<h3 style="color:${c.accent};font-size:16px;margin:16px 0 8px">🤝 Bénévolat accompagnants</h3>`;
    for (const b of benAcc) {
      sections += `<p style="color:${c.text};margin:0 0 4px">• ${b.nom_accompagnant} → <strong>${b.creneau}</strong></p>`;
    }
  }

  // --- Section Repas ---
  if (repas.length > 0) {
    sections += `<h3 style="color:${c.accent};font-size:16px;margin:16px 0 8px">🍽️ Repas du samedi soir</h3>`;
    for (const r of repas) {
      var nom = r.nom_accompagnant || r.nom || 'Vous';
      sections += `<p style="color:${c.text};margin:0 0 4px">• ${nom} — inscrit·e</p>`;
    }
    sections += `<p style="color:${c.muted};font-size:13px;margin-top:8px">Paiement en ligne : <a href="https://www.helloasso.com/associations/foyer-du-porteau/evenements/repas-du-soir-convention-sous-l-oeil-de-melusine-2026" style="color:${c.accent};text-decoration:underline">HelloAsso</a></p>`;
  }

  return {
    subject: "📋 Récap de vos inscriptions — Sous l'Œil de Mélusine",
    html: buildEmailHtml({
      titreBloc: '📋 Récapitulatif de vos inscriptions',
      couleurTitre: c.accent,
      champs: [],
      paragraphe: sections
        + `<p style="color:${c.muted};font-size:13px;margin-top:20px">`
        + `Gérez vos inscriptions sur <a href="${SITE_URL}" style="color:${c.accent}">${SITE_URL}</a>.`
        + `</p>`,
      pied: 'À bientôt à la convention ! 🐉',
    }),
  };
}


/**
 * Génère l'email de rappel J-3.
 * Envoyé manuellement par l'admin 3 jours avant la convention pour rappeler
 * le programme aux inscrits. Inclut le récap personnel (tables, repas,
 * bénévolat), les jours de présence, et les infos pratiques.
 *
 * @param {Object} data - {
 *   nom: string,
 *   jours: string[]  ('samedi', 'dimanche'),
 *   inscriptions: [{ jeu, creneau, statut, nom_accompagnant? }],
 *   benevolats:   [{ creneau }],
 *   repas:        [{ nom_accompagnant? }]
 * }
 * @returns {Object} { subject, html }
 */
function buildRappelEmail(data) {
  const { nom = '', jours = [], inscriptions = [], benevolats = [], repas = [] } = data;
  const c = DEFAULT_COLORS;

  // Phrase d'introduction adaptée au(x) jour(s) de présence
  let joursTexte;
  if (jours.includes('samedi') && jours.includes('dimanche')) {
    joursTexte = `<strong>samedi 16 et dimanche 17 mai</strong>`;
  } else if (jours.includes('samedi')) {
    joursTexte = `<strong>samedi 16 mai</strong>`;
  } else if (jours.includes('dimanche')) {
    joursTexte = `<strong>dimanche 17 mai</strong>`;
  } else {
    joursTexte = `<strong>les 16 et 17 mai</strong>`;
  }

  let sections = '';

  // --- Section Tables joueur ---
  const perso = inscriptions.filter(i => !i.nom_accompagnant || i.nom_accompagnant.trim() === '');
  if (perso.length > 0) {
    sections += `<h3 style="color:${c.success};font-size:16px;margin:16px 0 8px">🎲 Vos tables</h3>`;
    for (const i of perso) {
      const statut = i.statut === 'inscrit' ? '✅ Inscrit·e' : '⏳ En attente';
      sections += `<p style="color:${c.text};margin:0 0 4px">• <strong>${i.jeu}</strong> — ${i.creneau} (${statut})</p>`;
    }
  }

  // --- Section Accompagnants ---
  const accs = inscriptions.filter(i => i.nom_accompagnant && i.nom_accompagnant.trim() !== '');
  if (accs.length > 0) {
    sections += `<h3 style="color:${c.accent};font-size:16px;margin:16px 0 8px">👤 Vos accompagnant·e·s</h3>`;
    for (const i of accs) {
      const statut = i.statut === 'inscrit' ? '✅' : '⏳';
      sections += `<p style="color:${c.text};margin:0 0 4px">• ${i.nom_accompagnant} → <strong>${i.jeu}</strong> — ${i.creneau} ${statut}</p>`;
    }
  }

  // --- Section Bénévolat ---
  if (benevolats.length > 0) {
    sections += `<h3 style="color:${c.accent};font-size:16px;margin:16px 0 8px">🤝 Bénévolat</h3>`;
    for (const b of benevolats) {
      sections += `<p style="color:${c.text};margin:0 0 4px">• <strong>${b.creneau}</strong></p>`;
    }
  }

  // --- Section Repas ---
  if (repas.length > 0) {
    sections += `<h3 style="color:${c.accent};font-size:16px;margin:16px 0 8px">🍽️ Repas du samedi soir</h3>`;
    sections += `<p style="color:${c.text};margin:0 0 4px">${repas.length} repas réservé(s).</p>`;
    sections += `<p style="color:${c.muted};font-size:13px;margin-top:4px">Si pas encore réglé : paiement en ligne sur <a href="https://www.helloasso.com/associations/foyer-du-porteau/evenements/repas-du-soir-convention-sous-l-oeil-de-melusine-2026" style="color:${c.accent};text-decoration:underline">HelloAsso</a>.</p>`;
  }

  // Si pas d'inscription, message court
  if (sections === '') {
    sections = `<p style="color:${c.text};margin:0 0 4px">Vous n'êtes inscrit·e à aucune table pour le moment, mais vous êtes attendu·e à la convention !</p>`;
  }

  // --- Infos pratiques ---
  const infosPratiques = ''
    + `<h3 style="color:${c.accent};font-size:16px;margin:20px 0 8px">📍 Infos pratiques</h3>`
    + `<p style="color:${c.text};margin:0 0 4px"><strong>Lieu :</strong> ${LIEU_NOM}, ${LIEU_ADRESSE}</p>`
    + `<p style="color:${c.text};margin:0 0 4px"><strong>Horaires :</strong> samedi 9h-00h, dimanche 9h-17h</p>`
    + `<p style="color:${c.muted};font-size:13px;margin-top:8px">Programme complet : <a href="${SITE_URL}programme.html" style="color:${c.accent}">${SITE_URL}programme.html</a></p>`;

  const intro = `Bonjour ${nom},<br><br>`
    + `La convention <strong>Sous l'Œil de Mélusine</strong> approche : c'est ${joursTexte} ! `
    + `Voici un rappel de votre programme :`;

  return {
    subject: `🎲 J-3 : Rappel pour la convention Mélusine`,
    html: buildEmailHtml({
      titreBloc: '🎲 Plus que 3 jours !',
      couleurTitre: c.success,
      champs: [],
      paragraphe: intro
        + sections
        + infosPratiques
        + `<p style="color:${c.muted};font-size:13px;margin-top:20px">`
        + `Modifier vos inscriptions : <a href="${SITE_URL}mes-inscriptions.html" style="color:${c.accent}">${SITE_URL}mes-inscriptions.html</a>`
        + `</p>`,
      pied: 'À très vite aux tables ! 🐉',
    }),
  };
}


// =============================================================================
// DISPATCHER — Sélectionne le bon générateur selon le type d'email
// =============================================================================

/**
 * Sélectionne et exécute le bon générateur d'email selon le type demandé.
 * @param {string} type - Le type d'email (ex: "confirmation", "annulation")
 * @param {Object} data - Les données nécessaires au générateur
 * @returns {Object} { subject, html }
 * @throws {Error} Si le type n'est pas reconnu
 */
function buildEmail(type, data) {
  switch (type) {
    case 'confirmation':          return buildConfirmationEmail(data);
    case 'promotion':             return buildPromotionEmail(data);
    case 'annulation':            return buildAnnulationEmail(data);
    case 'accompagnant_supprime': return buildAccompagnantSupprimeEmail(data);
    case 'table_validee':         return buildTableValideeEmail(data);
    case 'table_refusee':         return buildTableRefuseeEmail(data);
    case 'nouvelle_proposition':  return buildNouvellePropositionEmail(data);
    case 'proposition_recue':     return buildPropositionRecueEmail(data);
    case 'recap':                 return buildRecapEmail(data);
    case 'rappel':                return buildRappelEmail(data);
    default:
      throw new Error(`Type d'email inconnu : ${type}`);
  }
}


// =============================================================================
// VALIDATION — Vérification des paramètres de la requête
// =============================================================================

/**
 * Vérifie qu'une adresse email a un format valide (regex basique).
 * @param {string} email - L'adresse à vérifier
 * @returns {boolean} true si le format est valide
 */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Valide le body de la requête POST.
 * Vérifie que le type est autorisé, que l'email est valide,
 * et que les données minimales sont présentes selon le type.
 *
 * @param {Object} body - Le body parsé de la requête
 * @returns {string|null} Message d'erreur, ou null si tout est valide
 */
function validateRequest(body) {
  // Type d'email obligatoire et autorisé
  if (!body.type || !ALLOWED_EMAIL_TYPES.includes(body.type)) {
    return `Type d'email invalide ou manquant. Types autorisés : ${ALLOWED_EMAIL_TYPES.join(', ')}`;
  }

  // Email destinataire obligatoire et valide
  if (!body.to || !isValidEmail(body.to)) {
    return 'Adresse email destinataire invalide ou manquante.';
  }

  // Données obligatoires selon le type
  const data = body.data || {};
  switch (body.type) {
    case 'confirmation':
      if (!data.nom || !data.jeu || !data.creneau || !data.statut) {
        return 'Données manquantes pour confirmation : nom, jeu, creneau, statut requis.';
      }
      if (data.statut !== 'inscrit' && data.statut !== 'attente') {
        return 'Statut invalide : doit être "inscrit" ou "attente".';
      }
      break;

    case 'promotion':
      if (!data.nom || !data.jeu || !data.creneau) {
        return 'Données manquantes pour promotion : nom, jeu, creneau requis.';
      }
      break;

    case 'annulation':
      if (!data.jeu || !data.creneau) {
        return 'Données manquantes pour annulation : jeu, creneau requis.';
      }
      break;

    case 'accompagnant_supprime':
      if (!data.nomAccompagnant || data.nbAnnulees === undefined) {
        return 'Données manquantes pour accompagnant_supprime : nomAccompagnant, nbAnnulees requis.';
      }
      break;

    case 'table_validee':
    case 'table_refusee':
    case 'nouvelle_proposition':
    case 'proposition_recue':
      if (!data.jeu) {
        return 'Données manquantes : jeu requis.';
      }
      break;

    case 'recap':
      // Le récap peut avoir des listes vides, pas de validation stricte
      break;

    case 'rappel':
      // Le rappel peut avoir des listes vides (utilisateur sans inscription
      // mais avec présence à la convention) ; validation seulement du nom.
      if (!data.nom) {
        return 'Données manquantes pour rappel : nom requis.';
      }
      break;
  }

  return null; // Tout est valide
}


// =============================================================================
// ENVOI — Appel à l'API MailerSend
// =============================================================================
// MailerSend envoie des emails via le domaine vérifié sousloeildemelusine.fr.
// 3000 emails/mois sur le plan Hobby (gratuit).
//
// Variable d'environnement requise : MAILERSEND_API_KEY
// Variable optionnelle : FROM_EMAIL (défaut: noreply@sousloeildemelusine.fr)
// =============================================================================

/**
 * Envoie un email via l'API MailerSend.
 * @param {string} apiKey    - Clé API MailerSend
 * @param {string} fromEmail - Adresse d'expédition (format "Nom <email>")
 * @param {string} to        - Adresse du destinataire
 * @param {string} subject   - Objet de l'email
 * @param {string} html      - Contenu HTML de l'email
 * @returns {Object} { ok: boolean, error?: string }
 */
async function sendViaMailerSend(apiKey, fromEmail, to, subject, html) {
  try {
    var fromName = 'Sous l oeil de Melusine';
    var fromAddr = fromEmail;
    var match = fromEmail.match(/^(.+?)\s*<(.+?)>$/);
    if (match) { fromName = match[1].trim(); fromAddr = match[2].trim(); }

    const response = await fetch('https://api.mailersend.com/v1/email', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: { email: fromAddr, name: fromName },
        to: [{ email: to }],
        subject: subject,
        html: html,
      }),
    });

    if (response.status === 202 || response.status === 200) {
      return { ok: true };
    }

    const result = await response.json().catch(function() { return {}; });
    console.error('MailerSend error:', response.status, JSON.stringify(result));
    return { ok: false, error: 'MailerSend ' + response.status + ': ' + JSON.stringify(result) };
  } catch (err) {
    console.error('MailerSend fetch error:', err.message);
    return { ok: false, error: err.message };
  }
}


// =============================================================================
// HANDLER PRINCIPAL — Point d'entrée du Worker
// =============================================================================

export default {
  /**
   * Handler HTTP principal du Worker.
   * Accepte uniquement POST /send-email avec un body JSON.
   *
   * Body attendu :
   * {
   *   "type": "confirmation" | "promotion" | "annulation" | ... ,
   *   "to": "email@example.com",
   *   "data": { ... données spécifiques au type ... }
   * }
   *
   * Variables d'environnement requises (dans Cloudflare → Settings → Variables) :
   *   - RESEND_API_KEY  : clé API Resend
   *   - FROM_EMAIL      : adresse d'expédition (optionnel, défaut: "Mélusine <onboarding@resend.dev>")
   *   - WEBHOOK_SECRET  : secret partagé avec pg_net pour authentifier les appels
   *
   * @param {Request} request - La requête HTTP entrante
   * @param {Object}  env     - Variables d'environnement du Worker
   * @returns {Response} Réponse JSON
   */
  async fetch(request, env) {
    // ── Preflight CORS ──
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: getCorsHeaders(request) });
    }

    // ── Seul POST est accepté ──
    if (request.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Méthode non autorisée. Utilisez POST.' }),
        { status: 405, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) } }
      );
    }

    // ── Vérification du secret partagé (webhook) ──
    // Seuls les appels provenant de pg_net (Supabase) doivent inclure ce header.
    // Cela empêche un tiers d'envoyer des emails via ce Worker sans le secret.
    const webhookSecret = request.headers.get('X-Webhook-Secret');
    if (!env.WEBHOOK_SECRET) {
      console.error('WEBHOOK_SECRET non configurée dans les variables d\'environnement.');
      return new Response(
        JSON.stringify({ error: 'Service email non configuré (secret manquant).' }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) } }
      );
    }
    if (!webhookSecret || webhookSecret !== env.WEBHOOK_SECRET) {
      return new Response(
        JSON.stringify({ error: 'Accès refusé : secret invalide.' }),
        { status: 403, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) } }
      );
    }

    // ── Rate limiting par IP ──
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (isRateLimited(clientIP)) {
      return new Response(
        JSON.stringify({ error: 'Trop de requêtes. Réessayez dans une minute.' }),
        { status: 429, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) } }
      );
    }

    // ── Vérifier que la clé API MailerSend est configurée ──
    if (!env.MAILERSEND_API_KEY) {
      console.error('MAILERSEND_API_KEY non configurée.');
      return new Response(
        JSON.stringify({ error: 'Service email non configuré.' }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) } }
      );
    }

    // ── Parser le body JSON ──
    let body;
    try {
      body = await request.json();
    } catch (err) {
      return new Response(
        JSON.stringify({ error: 'Body JSON invalide.' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) } }
      );
    }

    // ── Valider les paramètres ──
    const validationError = validateRequest(body);
    if (validationError) {
      return new Response(
        JSON.stringify({ error: validationError }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) } }
      );
    }

    // ── Construire l'email ──
    let email;
    try {
      email = buildEmail(body.type, body.data || {});
    } catch (err) {
      return new Response(
        JSON.stringify({ error: 'Erreur construction email.' }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) } }
      );
    }

    // ── Envoyer via MailerSend ──
    const fromEmail = env.FROM_EMAIL || 'Sous l oeil de Melusine <noreply@sousloeildemelusine.fr>';
    const result = await sendViaMailerSend(env.MAILERSEND_API_KEY, fromEmail, body.to, email.subject, email.html);

    if (!result.ok) {
      // On retourne 200 quand même — l'email est un bonus, pas un blocage
      // Le frontend ne doit pas afficher d'erreur si l'email échoue
      return new Response(
        JSON.stringify({ ok: false, message: 'Email non envoyé (erreur service).' }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) } }
      );
    }

    return new Response(
      JSON.stringify({ ok: true, message: 'Email envoyé.' }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) } }
    );
  },
};
