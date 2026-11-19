// =============================================================================
// acces.js — « Rideau » d'accès réservé à l'équipe organisatrice
// =============================================================================
// ⚠ CE N'EST PAS UNE PROTECTION. C'est un rideau : il évite que le public tombe sur un site
// inachevé, rien de plus. Le site est statique : ce fichier est lisible par tout le monde, un
// code d'un seul mot se retrouve en une seconde, et l'API Supabase reste joignable sans passer
// par ce rideau. Les vraies protections sont côté base (RLS, rôles joueur / mj / admin).
// Aucune donnée sensible ne doit jamais dépendre de ce code.
//
// Fonctionnement :
//   - Page publique (index.html) : propose un champ « code d'accès ». Un bon code enregistre
//     un jeton dans le navigateur (localStorage, à défaut sessionStorage) puis ouvre le site.
//   - Toutes les autres pages chargent ce fichier en tête : sans jeton valide, elles cachent
//     la page et renvoient vers index.html.
//   - Le jeton est l'empreinte du code : changer le code (donc l'empreinte) déconnecte tout le
//     monde d'un coup.
//   - Le code n'est PAS écrit en clair ici, seulement son empreinte SHA-256 salée.
//
// Changer le code : docs/ACCES_EQUIPE.md. Retirer le rideau au lancement public : même document.
// =============================================================================

(function () {
  'use strict';

  var EMPREINTE = '5e95d17d0ee86266bf6ce82bedd9a0c73e793827568a25dde9f9f9f979581b2b';              // SHA-256 de « melusine-equipe: » + code (minuscules, sans espaces autour)
  var SEL = 'melusine-equipe:';
  var CLE = 'melusine_acces';          // nom du jeton dans le navigateur
  var PAGE_PUBLIQUE = 'index.html';    // seule page visible sans code
  var PAGE_EQUIPE = 'accueil-2027.html'; // où va l'équipe après le code

  /** Vrai si un jeton valide est présent (localStorage ou, à défaut, sessionStorage). */
  function estAccorde() {
    try { if (localStorage.getItem(CLE) === EMPREINTE) return true; } catch (e) { /* stockage bloqué */ }
    try { if (sessionStorage.getItem(CLE) === EMPREINTE) return true; } catch (e) { /* stockage bloqué */ }
    return false;
  }

  /** Enregistre le jeton. Renvoie false si le navigateur bloque tout stockage. */
  function accorder() {
    var ok = false;
    try { localStorage.setItem(CLE, EMPREINTE); ok = true; } catch (e) { /* ignoré */ }
    try { sessionStorage.setItem(CLE, EMPREINTE); ok = true; } catch (e) { /* ignoré */ }
    return ok;
  }

  /** Supprime le jeton (déconnexion du rideau). */
  function revoquer() {
    try { localStorage.removeItem(CLE); } catch (e) { /* ignoré */ }
    try { sessionStorage.removeItem(CLE); } catch (e) { /* ignoré */ }
  }

  /** Calcule l'empreinte SHA-256 salée d'un code saisi (minuscules, espaces autour retirés). */
  function empreinte(code) {
    if (!window.crypto || !window.crypto.subtle) return Promise.reject(new Error('crypto indisponible'));
    var donnees = new TextEncoder().encode(SEL + String(code || '').trim().toLowerCase());
    return window.crypto.subtle.digest('SHA-256', donnees).then(function (tampon) {
      return Array.prototype.map.call(new Uint8Array(tampon), function (o) {
        return ('0' + o.toString(16)).slice(-2);
      }).join('');
    });
  }

  /** Vrai (via une promesse) si le code saisi est le bon. */
  function verifier(code) {
    return empreinte(code).then(function (h) { return h === EMPREINTE; });
  }

  window.MelusineAcces = {
    estAccorde: estAccorde,
    accorder: accorder,
    revoquer: revoquer,
    verifier: verifier,
    PAGE_EQUIPE: PAGE_EQUIPE,
    PAGE_PUBLIQUE: PAGE_PUBLIQUE
  };

  // ── Garde : sur toute page autre que la page publique ──
  var courante = location.pathname.split('/').pop();
  var estPublique = courante === '' || courante === PAGE_PUBLIQUE;
  if (estPublique || estAccorde()) return;

  // Pas de jeton : on cache la page sans clignotement et on renvoie vers la page publique
  var style = document.createElement('style');
  style.textContent = 'html{visibility:hidden!important}';
  (document.head || document.documentElement).appendChild(style);
  location.replace(PAGE_PUBLIQUE);
})();
