# Fiche de tests — Sous l'Œil de Mélusine

## Comment utiliser cette fiche
- Tester chaque scénario dans l'ordre
- Cocher ✅ si OK, ❌ si KO (noter le détail)
- Tester sur **desktop** ET **mobile** (ou DevTools responsive)
- Tester en **thème dark** ET **thème clair** (changer dans la Sheet config)
- Vider le cache entre les tests si nécessaire (Ctrl+Maj+R)

---

## 1. ACCUEIL (index.html)

| # | Test | Résultat |
|---|---|---|
| 1.1 | La page se charge sans erreur console | ☐ |
| 1.2 | Le hero affiche le titre, les dates et le lieu | ☐ |
| 1.3 | Les 3 cartes de navigation (Programme, Infos, Bénévoles) sont cliquables | ☐ |
| 1.4 | Les infos pratiques (lieu, dates, tarif) s'affichent depuis la config Sheet | ☐ |
| 1.5 | Le lien Google Maps fonctionne dans les infos | ☐ |
| 1.6 | Le compteur global (inscrits, tables, bénévoles) s'affiche si > 0 | ☐ |
| 1.7 | Le compteur est masqué si tout est à zéro | ☐ |
| 1.8 | Le thème (dark/clair) s'applique correctement sans flash | ☐ |

---

## 2. NAVIGATION

| # | Test | Résultat |
|---|---|---|
| 2.1 | Les liens Accueil, Programme, Infos, Bénévoles fonctionnent | ☐ |
| 2.2 | "Mes inscriptions" apparaît dans la nav quand connecté | ☐ |
| 2.3 | "Mes inscriptions" est masqué quand déconnecté | ☐ |
| 2.4 | Pas de flash visible/invisible du lien "Mes inscriptions" au chargement | ☐ |
| 2.5 | Le bouton "Admin" apparaît à côté du pseudo pour les admins | ☐ |
| 2.6 | Le menu hamburger fonctionne sur mobile | ☐ |
| 2.7 | Le menu mobile se ferme au clic sur un lien | ☐ |

---

## 3. CONNEXION / DÉCONNEXION

### 3.1 Pseudo/Email
| # | Test | Résultat |
|---|---|---|
| 3.1.1 | Clic "Se connecter" → modal s'ouvre | ☐ |
| 3.1.2 | Clic "Pseudo & email" → formulaire s'affiche | ☐ |
| 3.1.3 | Validation avec pseudo vide → erreur | ☐ |
| 3.1.4 | Validation avec email invalide → erreur | ☐ |
| 3.1.5 | Validation OK → toast "Bienvenue", pseudo dans la nav | ☐ |
| 3.1.6 | Après connexion, la session persiste au rechargement de la page | ☐ |

### 3.2 SSO Google
| # | Test | Résultat |
|---|---|---|
| 3.2.1 | Clic "Continuer avec Google" → texte "Chargement de Google..." | ☐ |
| 3.2.2 | Bouton Google officiel apparaît après chargement | ☐ |
| 3.2.3 | Clic sur le bouton Google → popup Google → formulaire de pseudo | ☐ |
| 3.2.4 | Pseudo pré-rempli avec le nom Google, modifiable | ☐ |
| 3.2.5 | Validation du pseudo → connecté avec le bon email | ☐ |

### 3.3 SSO Discord
| # | Test | Résultat |
|---|---|---|
| 3.3.1 | Clic "Continuer avec Discord" → redirection vers Discord | ☐ |
| 3.3.2 | Autorisation sur Discord → retour sur le site (page d'accueil) | ☐ |
| 3.3.3 | Formulaire de pseudo s'affiche après retour | ☐ |
| 3.3.4 | Validation du pseudo → connecté | ☐ |

### 3.4 Déconnexion
| # | Test | Résultat |
|---|---|---|
| 3.4.1 | Clic "Déco" → déconnecté, pseudo disparaît | ☐ |
| 3.4.2 | "Mes inscriptions" disparaît de la nav | ☐ |
| 3.4.3 | Rechargement → reste déconnecté | ☐ |

### 3.5 Modification du pseudo
| # | Test | Résultat |
|---|---|---|
| 3.5.1 | Clic sur le pseudo dans la nav → modal de modification | ☐ |
| 3.5.2 | Changement du pseudo → mis à jour dans la nav | ☐ |

---

## 4. PROGRAMME (programme.html)

| # | Test | Résultat |
|---|---|---|
| 4.1 | Le programme se charge et affiche les tables validées | ☐ |
| 4.2 | Les tables en_attente ou refusées ne sont PAS affichées | ☐ |
| 4.3 | Les onglets de filtre par créneau fonctionnent | ☐ |
| 4.4 | Le nombre de places restantes est correct | ☐ |
| 4.5 | Les pseudos des inscrits sont affichés sous chaque table (👥) | ☐ |
| 4.6 | Les accompagnants sont marqués "(acc.)" dans la liste | ☐ |
| 4.7 | Le bouton "Proposer une table (MJ)" est visible si connecté | ☐ |
| 4.8 | Le bouton MJ est masqué si non connecté | ☐ |
| 4.9 | Programme vide → message "Le programme sera bientôt disponible" | ☐ |

### 4.10 Quota web (places_web)
| # | Test | Résultat |
|---|---|---|
| 4.10.1 | Table avec places_web : affiche "X places en ligne sur Y" | ☐ |
| 4.10.2 | Quota web atteint : "Complet en ligne · X places sur place" (badge or) | ☐ |
| 4.10.3 | Table sans places_web : affiche "X places sur Y" (classique) | ☐ |
| 4.10.4 | Tout complet : "Complet (X/Y)" (badge rouge) | ☐ |

---

## 5. INSCRIPTION AUX TABLES

### 5.1 Inscription simple
| # | Test | Résultat |
|---|---|---|
| 5.1.1 | Non connecté → clic "S'inscrire" → modal de connexion | ☐ |
| 5.1.2 | Connecté → clic "S'inscrire" → toast de confirmation | ☐ |
| 5.1.3 | Après inscription, la table affiche "✅ Inscrit·e" + bouton "Annuler" | ☐ |
| 5.1.4 | Les pseudos des inscrits se mettent à jour | ☐ |
| 5.1.5 | Le compteur de places se met à jour | ☐ |
| 5.1.6 | Email de confirmation reçu avec liens agenda | ☐ |

### 5.2 Anti-doublon
| # | Test | Résultat |
|---|---|---|
| 5.2.1 | Déjà inscrit à cette table → erreur "Vous êtes déjà inscrit·e" | ☐ |
| 5.2.2 | Déjà inscrit sur le même créneau (autre table) → erreur avec nom du jeu | ☐ |

### 5.3 Anti-chevauchement
| # | Test | Résultat |
|---|---|---|
| 5.3.1 | Bénévole sur ce créneau → erreur "Annulez votre bénévolat d'abord" | ☐ |
| 5.3.2 | MJ sur ce créneau → erreur "Vous êtes MJ sur ce créneau" | ☐ |

### 5.4 Liste d'attente
| # | Test | Résultat |
|---|---|---|
| 5.4.1 | Table pleine → inscription en "attente" | ☐ |
| 5.4.2 | Email de liste d'attente reçu | ☐ |
| 5.4.3 | Sur le programme, la table affiche "⏳ En attente" | ☐ |

### 5.5 Annulation
| # | Test | Résultat |
|---|---|---|
| 5.5.1 | Clic "Annuler" sur la carte → inscription annulée | ☐ |
| 5.5.2 | Le bouton repasse à "S'inscrire" | ☐ |
| 5.5.3 | Email d'annulation reçu | ☐ |
| 5.5.4 | Si quelqu'un était en attente → promu automatiquement + email | ☐ |

### 5.6 Accompagnants
| # | Test | Résultat |
|---|---|---|
| 5.6.1 | Si accompagnants ajoutés → modal "Pour qui ?" à l'inscription | ☐ |
| 5.6.2 | Inscription pour soi → fonctionne | ☐ |
| 5.6.3 | Inscription pour un accompagnant → fonctionne | ☐ |
| 5.6.4 | L'accompagnant apparaît dans la liste des inscrits avec "(acc.)" | ☐ |

---

## 6. BÉNÉVOLES (benevoles.html)

| # | Test | Résultat |
|---|---|---|
| 6.1 | Les créneaux bénévoles s'affichent (même non connecté) | ☐ |
| 6.2 | Le nombre de places restantes est correct | ☐ |
| 6.3 | Les pseudos des bénévoles inscrits sont affichés (👥) | ☐ |
| 6.4 | Non connecté → bouton "Se connecter pour s'inscrire" | ☐ |
| 6.5 | Connecté → bouton "S'inscrire" sur les créneaux libres | ☐ |
| 6.6 | Créneau complet → badge "Complet" | ☐ |
| 6.7 | Déjà joueur sur ce créneau → badge grisé "Déjà pris (Joueur : nom)" | ☐ |
| 6.8 | Déjà MJ sur ce créneau → badge grisé "Déjà pris (MJ : nom)" | ☐ |
| 6.9 | Inscription bénévole → toast de confirmation | ☐ |
| 6.10 | "Mes créneaux" affiche les inscriptions bénévoles avec bouton "Annuler" | ☐ |
| 6.11 | Annulation bénévole → créneau redevient disponible | ☐ |

---

## 7. MES INSCRIPTIONS (mes-inscriptions.html)

| # | Test | Résultat |
|---|---|---|
| 7.1 | Non connecté → message de connexion | ☐ |
| 7.2 | Connecté → affiche les 4 sections | ☐ |
| 7.3 | Section JDR : liste des tables inscrites avec badge statut | ☐ |
| 7.4 | Section JDR : bouton "Annuler" fonctionne | ☐ |
| 7.5 | Section Accompagnants : liste des accompagnants | ☐ |
| 7.6 | Ajout d'un accompagnant → apparaît dans la liste | ☐ |
| 7.7 | Max 3 accompagnants → formulaire masqué au max | ☐ |
| 7.8 | Suppression d'un accompagnant → confirm + annulation cascade | ☐ |
| 7.9 | Section Bénévolat : liste des créneaux avec bouton "Annuler" | ☐ |
| 7.10 | Section MJ : propositions avec badge statut (validé/en_attente/refusé) | ☐ |
| 7.11 | Bouton "📧 Recevoir par email le détail de mes inscriptions" fonctionne | ☐ |
| 7.12 | Toast de confirmation avec adresse email | ☐ |
| 7.13 | Email récap reçu avec toutes les inscriptions + liens agenda | ☐ |

---

## 8. ESPACE MJ (espace-mj.html)

| # | Test | Résultat |
|---|---|---|
| 8.1 | Non connecté → message de connexion | ☐ |
| 8.2 | Connecté → formulaire de proposition visible | ☐ |
| 8.3 | Nom du MJ pré-rempli avec le pseudo | ☐ |
| 8.4 | Soumission sans jeu → erreur | ☐ |
| 8.5 | Soumission sans créneau → erreur | ☐ |
| 8.6 | Soumission complète → toast "Table proposée !" | ☐ |
| 8.7 | La proposition apparaît dans "Mes propositions" avec badge "⏳ En attente" | ☐ |
| 8.8 | Compteur de caractères description fonctionne (/500) | ☐ |
| 8.9 | Anti-chevauchement : déjà joueur sur ce créneau → erreur | ☐ |
| 8.10 | Anti-chevauchement : déjà bénévole → erreur | ☐ |
| 8.11 | Anti-doublon : même jeu + même créneau → erreur | ☐ |

---

## 9. INFOS (infos.html)

| # | Test | Résultat |
|---|---|---|
| 9.1 | La section Bienvenue affiche le texte de la config | ☐ |
| 9.2 | Les balises `<strong>` dans le texte de bienvenue sont rendues | ☐ |
| 9.3 | Les infos pratiques (lieu, dates, tarif) sont correctes | ☐ |
| 9.4 | Le lien Google Maps fonctionne | ☐ |
| 9.5 | La restauration affiche les items groupés par catégorie | ☐ |
| 9.6 | Les prix sont formatés correctement (X,XX€) | ☐ |
| 9.7 | Les animations s'affichent | ☐ |
| 9.8 | Les items ne sont PAS invisibles (opacity visible) | ☐ |

---

## 10. ADMIN (admin.html)

| # | Test | Résultat |
|---|---|---|
| 10.1 | Non connecté → message "Connexion requise" avec bouton | ☐ |
| 10.2 | Connecté non-admin → message "Accès restreint" | ☐ |
| 10.3 | Connecté admin → formulaire de mot de passe | ☐ |
| 10.4 | Mauvais mot de passe → erreur | ☐ |
| 10.5 | Bon mot de passe → panneau admin complet | ☐ |
| 10.6 | Stats (inscrits, en attente, total) sont correctes | ☐ |
| 10.7 | Barres de remplissage par table | ☐ |
| 10.8 | Tableau des inscriptions avec actions | ☐ |
| 10.9 | Promouvoir une inscription en attente → fonctionne | ☐ |
| 10.10 | Promouvoir quand table pleine → erreur | ☐ |
| 10.11 | Supprimer une inscription → confirm + suppression | ☐ |
| 10.12 | Suppression d'un inscrit → premier en attente promu | ☐ |
| 10.13 | Propositions MJ en attente affichées | ☐ |
| 10.14 | Valider une proposition → email au MJ + table dans le programme | ☐ |
| 10.15 | Refuser une proposition → email au MJ | ☐ |
| 10.16 | Gestion des rôles : dropdown joueur/mj/admin fonctionne | ☐ |

---

## 11. EMAILS

| # | Test | Résultat |
|---|---|---|
| 11.1 | Email inscription confirmée — design Mélusine, liens agenda | ☐ |
| 11.2 | Email liste d'attente — pas de lien agenda | ☐ |
| 11.3 | Email promotion (place libérée) — liens agenda | ☐ |
| 11.4 | Email annulation | ☐ |
| 11.5 | Email accompagnant supprimé — nombre d'inscriptions annulées | ☐ |
| 11.6 | Email table MJ validée — liens agenda | ☐ |
| 11.7 | Email table MJ refusée | ☐ |
| 11.8 | Email récap à la demande — toutes les sections + liens agenda | ☐ |
| 11.9 | Lien Google Agenda → ouvre le bon événement avec le bon créneau | ☐ |
| 11.10 | Fichier .ics → téléchargeable et importable dans un calendrier | ☐ |
| 11.11 | Couleurs des emails alignées sur le thème (dark/clair) | ☐ |

---

## 12. THÈME

| # | Test | Résultat |
|---|---|---|
| 12.1 | Config `theme` = `dark` → site en thème sombre | ☐ |
| 12.2 | Config `theme` = `clair` → site en thème clair | ☐ |
| 12.3 | Pas de flash dark → clair au chargement (après première visite) | ☐ |
| 12.4 | Nav lisible en thème clair (desktop et mobile) | ☐ |
| 12.5 | Cartes, badges, formulaires lisibles en thème clair | ☐ |
| 12.6 | Admin lisible en thème clair | ☐ |
| 12.7 | Shimmers de chargement adaptés au thème | ☐ |

---

## 13. PERFORMANCE

| # | Test | Résultat |
|---|---|---|
| 13.1 | Première visite : contenu visible en < 3s (avec keep-alive actif) | ☐ |
| 13.2 | Visite suivante : contenu visible instantanément (cache localStorage) | ☐ |
| 13.3 | Les données se rafraîchissent en arrière-plan (stale-while-revalidate) | ☐ |
| 13.4 | Google Sign-In ne charge pas tant qu'on ne clique pas | ☐ |

---

## 14. MOBILE / RESPONSIVE

| # | Test | Résultat |
|---|---|---|
| 14.1 | Toutes les pages sont lisibles sur écran 360px | ☐ |
| 14.2 | Le menu hamburger fonctionne | ☐ |
| 14.3 | Les toasts ne débordent pas de l'écran | ☐ |
| 14.4 | Les formulaires (MJ, accompagnants) sont utilisables sur mobile | ☐ |
| 14.5 | Les modals (connexion, choix accompagnant) sont scrollables si nécessaire | ☐ |
| 14.6 | Les boutons sont assez grands pour être tappés au doigt | ☐ |

---

## 15. SÉCURITÉ (tests manuels)

| # | Test | Résultat |
|---|---|---|
| 15.1 | Inscription avec un pseudo contenant `<script>` → pas d'exécution JS | ☐ |
| 15.2 | Nom d'accompagnant avec `<img onerror=...>` → pas d'exécution | ☐ |
| 15.3 | Double-clic rapide sur "S'inscrire" → une seule inscription | ☐ |
| 15.4 | Accès direct à admin.html sans rôle admin → accès refusé | ☐ |
| 15.5 | Appel API POST sans les bons paramètres → erreur propre | ☐ |

---

## 16. GOOGLE SHEETS (vérifications)

| # | Test | Résultat |
|---|---|---|
| 16.1 | Modifier le programme dans la Sheet → visible sur le site après refresh | ☐ |
| 16.2 | Modifier la config (texte bienvenue) → visible sur Infos après refresh | ☐ |
| 16.3 | Modifier la restauration → visible après refresh | ☐ |
| 16.4 | Changer `theme` dans config → thème change au reload | ☐ |
| 16.5 | Ajouter `places_web` à une table → quota affiché sur le programme | ☐ |
| 16.6 | Valider une table (statut_table = validé) → apparaît dans le programme | ☐ |

---

## Notes de test

**Testeur** : _________________ **Date** : _________________

**Navigateur** : _________________ **Appareil** : _________________

**Thème testé** : ☐ Dark ☐ Clair

**Remarques** :

