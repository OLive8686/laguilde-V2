// =============================================================================
// edition.js — Valeurs qui changent à CHAQUE édition de la convention
// =============================================================================
// C'est le SEUL fichier du site à modifier chaque année pour les dates, le lieu,
// les liens et le préfixe de stockage de l'outil du jour J. Les pages et
// app.supabase.js lisent ces valeurs ; aucun libellé de date n'est écrit en dur
// ailleurs dans le site. (Côté e-mails, l'équivalent est le bloc EDITION en tête
// de worker-email.js : à garder identique à ce fichier.)
//
// Les libellés (« samedi 8 mai », « 8 & 9 mai 2027 ») sont CALCULÉS à partir des
// dates ISO ci-dessous : on ne saisit une date qu'une seule fois.
//
// Ce que ce fichier ne contient pas : lieu (nom, adresse, plan), dates détaillées avec
// horaires, tarif, textes de bienvenue de la page Infos. Ils viennent de la table
// « config » de la base (clés lieu_nom, lieu_adresse, lieu_maps, dates_detail, tarif,
// bienvenue_titre, bienvenue_texte, restauration_intro) : à mettre à jour dans
// Supabase (voir migrations/010_edition_2027_config.sql et docs/EDITION_2027_A_FAIRE.md).
//
// Chargé AVANT app.supabase.js dans chaque page :
//   <script src="edition.js?v=1"></script>
// Pensez à incrémenter ?v=N dans toutes les pages quand ce fichier change.
// =============================================================================

(function () {
  'use strict';

  var EDITION = {
    // Année affichée dans le site
    year: 2027,

    // Dates des deux jours, au format AAAA-MM-JJ (le samedi doit être un samedi, le
    // dimanche un dimanche : une alerte s'affiche dans la console sinon)
    saturday: '2027-05-08',
    sunday:   '2027-05-09',

    // Lieu (nom court et ville, pour les textes courts ; l'adresse détaillée est dans « config »)
    venueName: 'Foyer du Porteau',
    venueCity: 'Poitiers',

    // Liens propres à l'édition. Laisser vide ('') tant que le lien n'est pas connu :
    // le bloc qui l'utilise est alors MASQUÉ (jamais de lien cassé ou de l'an dernier).
    // TODO(à fournir) : page HelloAsso du repas du samedi soir 2027
    // TODO(à fournir) : événement Facebook 2027
    links: {
      helloassoMeal: '',
      facebookEvent: ''
    },

    // Préfixe des clés localStorage de l'outil du jour J (melusine-convention-2026.html).
    // Le changer à chaque édition évite de relire les pointages de l'année précédente.
    storagePrefix: 'm27'
  };

  var DAYS   = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  var MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août',
                'septembre', 'octobre', 'novembre', 'décembre'];

  /**
   * Découpe une date ISO en jour de la semaine, jour, mois et année (en UTC, donc sans
   * décalage de fuseau horaire).
   * @param {string} iso - Date « AAAA-MM-JJ »
   * @returns {{weekday: string, day: number, month: string, year: number}}
   */
  function parts(iso) {
    var p = String(iso).split('-');
    var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
    return {
      weekday: DAYS[d.getUTCDay()],
      day: Number(p[2]),
      month: MONTHS[Number(p[1]) - 1],
      year: Number(p[0])
    };
  }

  /** Met la première lettre en majuscule. */
  function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  /**
   * Libellé d'un jour de la convention.
   * @param {string} jour - 'samedi' ou 'dimanche'
   * @param {boolean} [majuscule] - true pour « Samedi 8 mai »
   * @returns {string} Par exemple « samedi 8 mai »
   */
  EDITION.dayLabel = function (jour, majuscule) {
    var p = parts(jour === 'dimanche' ? EDITION.sunday : EDITION.saturday);
    var texte = p.weekday + ' ' + p.day + ' ' + p.month;
    return majuscule ? capitalize(texte) : texte;
  };

  /**
   * Libellé court de la période, pour les pieds de page.
   * @returns {string} Par exemple « 8 & 9 mai 2027 »
   */
  EDITION.rangeLabel = function () {
    var a = parts(EDITION.saturday);
    var b = parts(EDITION.sunday);
    if (a.month === b.month) return a.day + ' & ' + b.day + ' ' + b.month + ' ' + b.year;
    return a.day + ' ' + a.month + ' & ' + b.day + ' ' + b.month + ' ' + b.year;
  };

  /**
   * Vrai si la valeur est une adresse https exploitable (garde-fou : pas de lien vide
   * ni de schéma dangereux injecté par erreur dans ce fichier).
   */
  function isHttpsUrl(value) {
    return typeof value === 'string' && /^https:\/\/[^\s"'<>]+$/.test(value);
  }

  /**
   * Remplit les éléments marqués dans la page :
   *   - data-edition="range" | "saturday" | "sunday" | "days" | "venue" | "venueDot" | "year" : le texte est remplacé ;
   *   - data-edition-link="helloassoMeal" | "facebookEvent" : l'adresse du premier lien
   *     contenu est posée ; s'il n'y a pas d'adresse valide, tout le bloc est masqué.
   * Seul textContent / href est utilisé (aucune injection de HTML).
   */
  EDITION.fill = function () {
    var textes = {
      range: EDITION.rangeLabel(),
      saturday: EDITION.dayLabel('samedi', true),
      sunday: EDITION.dayLabel('dimanche', true),
      days: EDITION.dayLabel('samedi', true) + ' · ' + EDITION.dayLabel('dimanche', true),
      venue: EDITION.venueName + ', ' + EDITION.venueCity,
      venueDot: EDITION.venueName + ' · ' + EDITION.venueCity,
      year: String(EDITION.year)
    };
    var i, el, cle;

    var cibles = document.querySelectorAll('[data-edition]');
    for (i = 0; i < cibles.length; i++) {
      el = cibles[i];
      cle = el.getAttribute('data-edition');
      if (Object.prototype.hasOwnProperty.call(textes, cle)) el.textContent = textes[cle];
    }

    var blocs = document.querySelectorAll('[data-edition-link]');
    for (i = 0; i < blocs.length; i++) {
      el = blocs[i];
      cle = el.getAttribute('data-edition-link');
      var lien = el.querySelector('a');
      if (lien && isHttpsUrl(EDITION.links[cle])) {
        lien.setAttribute('href', EDITION.links[cle]);
        el.hidden = false;
      } else {
        el.hidden = true;
        if (window.console) console.warn('EDITION : lien « ' + cle + ' » non renseigné dans edition.js, bloc masqué.');
      }
    }
  };

  // Contrôle de saisie : un samedi qui n'en est pas un est presque toujours une faute de frappe
  if (parts(EDITION.saturday).weekday !== 'samedi' || parts(EDITION.sunday).weekday !== 'dimanche') {
    if (window.console) console.warn('EDITION : « saturday » doit être un samedi et « sunday » un dimanche (vérifier edition.js).');
  }

  window.EDITION = EDITION;

  // Remplissage au chargement (le script est chargé en tête de page : on attend le DOM)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', EDITION.fill);
  } else {
    EDITION.fill();
  }
})();
