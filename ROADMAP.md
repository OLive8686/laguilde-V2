# Roadmap — Version 2027

Document de référence pour la **prochaine édition** de "Sous l'Œil de Mélusine".
Recense la dette technique identifiée pendant l'édition 2026, les fonctionnalités
ajoutées en cours d'année (à préserver lors d'une éventuelle refonte), et les
améliorations envisagées.

À relire en début de cycle de préparation (~janvier/février 2027).

---

## 1. Dette technique prioritaire

### 1.1 Refonte des relations inscriptions ↔ programme (CRITIQUE)

**Problème actuel** : la table `inscriptions` référence `programme` par les valeurs `(creneau, jeu)`, pas par un FK sur `programme.id`. Conséquences observées en mai 2026 :

- Renommer une table dans `programme` rendait les inscriptions "orphelines" (elles gardaient l'ancien nom et disparaissaient de la vue admin par table).
- Un utilisateur avec une page en cache pouvait s'inscrire à une (creneau, jeu) qui n'existait plus dans `programme`, créant une inscription orpheline.

**Mitigations posées en 2026** (à conserver mais qui ne remplacent pas la refonte) :
- Trigger `trg_sync_inscriptions_on_programme_rename` (fichier `programme_sync.sql`) qui propage automatiquement un renommage de `programme.jeu` ou `programme.creneau` aux inscriptions liées.
- (Trigger anti-orphelin envisagé mais pas implémenté faute de temps avant la convention.)

**Refonte cible** :
1. Ajouter `programme_id BIGINT REFERENCES programme(id)` à `inscriptions`.
2. Migration des données : `UPDATE inscriptions SET programme_id = (SELECT id FROM programme WHERE creneau = inscriptions.creneau AND jeu = inscriptions.jeu LIMIT 1)`.
3. Décider du sort de `inscriptions.creneau` et `inscriptions.jeu` :
   - **Option A** (recommandée) : les supprimer, requêter via JOIN sur programme. Plus propre.
   - **Option B** : les garder comme cache lisible, synchronisé par trigger. Évite de modifier tous les SELECT existants.
4. Ajouter contrainte `NOT NULL` + FK avec `ON DELETE RESTRICT` (un admin ne peut pas supprimer une table qui a encore des inscriptions actives).
5. Adapter les fichiers impactés (~6) :
   - `programme.html` : l'INSERT doit envoyer `programme_id` au lieu de `(creneau, jeu)`.
   - `mes-inscriptions.html`, `admin.html` : adapter les filtres et joins.
   - `worker-email.js` : si on stocke encore les valeurs, RAS ; sinon il faut joindre programme.
   - `email_rappels.sql`, `admin_export.sql` : adapter les SELECT.
   - Tous les triggers (`trg_email_inscription`, `trg_promote_first_waiting`, etc.) restent intacts s'ils utilisent `OLD.creneau`/`OLD.jeu`. À vérifier.

**Effort estimé** : 1 à 2 jours, à faire **hors période de convention**.

---

### 1.2 Détection de doublons côté front

Aujourd'hui, le code d'inscription dans `programme.html` ne vérifie pas qu'une inscription identique existe déjà. Combiné à un cache navigateur agressif, on a vu des cas de double-inscription.

Solution : avant l'INSERT, faire un SELECT pour vérifier que `(email, programme_id)` n'a pas déjà une ligne avec statut actif. À combiner avec la refonte 1.1.

---

### 1.3 Migration vers le SDK Supabase officiel (à évaluer)

Actuellement, on utilise un proxy maison dans `app.supabase.js` qui imite l'API du SDK via `fetch()` direct. Raison historique : un bug de lock auth dans le SDK v2 au moment du déploiement initial.

À ré-évaluer : le bug est peut-être corrigé dans une version récente. Si oui, migrer permettrait :
- Réduire ~200 lignes de code maison
- Bénéficier des updates et bugfixes officiels
- Avoir la prise en charge du realtime si jamais on en a besoin

Effort : ~1 jour, sans urgence.

---

### 1.4 Automatisation du rappel J-3

Aujourd'hui, le bouton "Envoyer les rappels J-3" dans `admin.html` est **manuel** : il faut que l'admin pense à le cliquer le mercredi matin.

Amélioration : déclenchement automatique via Cloudflare Worker Cron (le projet a déjà un worker keep-alive `worker.js` avec cron). Calculer la date d'envoi à partir d'une variable de config (`config.rappel_envoi_a` ou date hardcodée par édition).

Risque : si bug le jour J, rattrapage manuel impossible sans intervention.
**Recommandation** : automatiser **et** garder le bouton manuel comme filet de sécurité.

---

### 1.5 Rate limiting plus robuste pour le worker email

Le rate limiting actuel (10/min/IP) utilise une `Map` en mémoire dans le worker Cloudflare. Problèmes :
- Chaque instance du worker a sa propre mémoire (pas partagé)
- Reset à chaque redémarrage du worker
- Peu pertinent pour notre flux pg_net (qui vient toujours de la même plage IP Supabase)

Pour la prochaine édition, soit :
- Le supprimer (l'authentification par `WEBHOOK_SECRET` suffit à prévenir les abus)
- Le déplacer dans Cloudflare KV (rate limiting partagé) si on veut vraiment limiter

---

## 2. Fonctionnalités ajoutées en 2026 (à préserver)

Listées par ordre chronologique d'ajout. Chaque ligne pointe vers le fichier de référence.

### 2.1 Présences à la convention (samedi/dimanche)
- **Table dédiée** `presences` avec RLS et triggers d'auto-création (`presences.sql`)
- **Triggers** : s'inscrire à une table/repas/bénévolat un jour crée auto la présence
- **RPC `annuler_presence`** : décocher une présence annule en cascade les inscriptions/repas/bénévolat du jour
- **Stats admin** via RPC `get_presences_stats` (`presences_admin_stats.sql`) : samedi / dimanche / both / unique
- **UI** : encart "Ma présence" sur `mes-inscriptions.html` + modal post-login pour les nouveaux comptes

### 2.2 Promotion automatique depuis la liste d'attente
- Trigger `trg_promote_first_waiting` (`inscription_promotion.sql`)
- Quand `OLD.statut='inscrit' AND NEW.statut IN ('annulé','supprimé')`, promeut le plus ancien `'attente'` de la même table (tri par `id ASC`)
- L'admin peut toujours promouvoir manuellement hors ordre via `admin.html`

### 2.3 Vue admin par table (`admin.html`)
- Liste détaillée par table validée : inscrits + liste d'attente numérotée
- Boutons "Promouvoir" (override hors ordre) et "Retirer"
- Tri chronologique des tables (samedi avant dimanche)

### 2.4 Email de rappel J-3
- Type `'rappel'` dans `worker-email.js` (builder `buildRappelEmail`)
- RPC `send_reminders` (`email_rappels.sql`) avec 3 modes :
  - **production** : envoi à tous les présents
  - **test** (`p_test_email`) : 1 mail à l'admin avec son propre contenu
  - **preview** (`p_preview_for_email`) : 1 mail à l'admin avec le contenu d'un autre inscrit
- Tri chronologique des sections (via helper SQL `creneau_sort_key`)
- Section "tables MJ" + "tables joueur·euse" distinctes
- Lien de partage événement Facebook
- 3 boutons dans `admin.html` : test, preview, envoyer J-3 (double confirmation)

### 2.5 Export CSV admin (`admin.html`)
- Bouton "Exporter en CSV" → télécharge 5 fichiers en série :
  1. `melusine-programme-...` : tables validées (pour visuel programme)
  2. `melusine-tables-...` : inscriptions par table avec MJ + position en attente
  3. `melusine-benevoles-...` : créneaux bénévoles
  4. `melusine-repas-...` : repas du samedi soir
  5. `melusine-presences-...` : présences à la convention
- RPC unique `get_admin_export_data` (`admin_export.sql`)
- Format CSV avec BOM UTF-8 pour Excel + CRLF + échappement RFC 4180

### 2.6 Synchronisation programme ↔ inscriptions
- Trigger `trg_sync_inscriptions_on_programme_rename` (`programme_sync.sql`)
- Propage automatiquement un renommage `programme.jeu`/`creneau` aux `inscriptions` liées

### 2.7 Améliorations UX et corrections diverses
- Wording adapté pour les MJ sur `mes-inscriptions.html` ("aucune table en tant que joueur·euse")
- Mise en page de la vue admin par table : nom + email empilés sur 2 lignes (évite la troncature)
- Modal post-login désactivé tant que l'utilisateur a déjà des présences ou a cliqué "Plus tard" (flag sessionStorage)

---

## 2.8 Outillage admin pour gestion in-event (CRITIQUE pour 2027)

Pendant l'édition 2026, plusieurs opérations courantes ont dû être faites en SQL direct car aucune UI admin ne les permet. À J-3 d'un événement, ça stresse et c'est risqué. Liste exhaustive des actions à intégrer dans `admin.html` pour la prochaine édition :

### Sur une table (`programme`)
- **Changer le créneau** : modifier `creneau` avec confirmation. Le trigger `trg_sync_inscriptions_on_programme_rename` propage automatiquement aux inscriptions. À ajouter : notification email aux joueurs (nouveau type `'creneau_modifie'`).
- **Renommer la table** : modifier `jeu`. Idem trigger sync. Idem notification.
- **Modifier description / content warning / système / places** : édition basique d'une ligne `programme`.
- **Annuler une table entière** : pop-up de confirmation, supprime la table + annule toutes les inscriptions liées + envoie emails. Statut cible : `'annulé'` (nouveau, à distinguer de `'refusé'` qui est pré-validation).
- **Dupliquer une table** sur un autre créneau (pratique si une table est très demandée et qu'on veut une session bis).

### Sur une inscription
- **Inscription manuelle d'un joueur par l'admin** : pour les cas particuliers le jour J (quelqu'un qui débarque sans compte). Champs : email existant ou nouveau, jeu, créneau, statut. NB : décision 2026 = "on gère sur place", mais l'expérience montre que c'est utile d'avoir l'option même sans s'en servir.
- **Annulation par l'admin** : déjà via bouton ✕. À enrichir : raison facultative qui apparaît dans l'email d'annulation envoyé au joueur.
- **Promotion hors ordre** : déjà via bouton ↑. OK.
- **Déplacer une inscription d'une table à une autre** : équivalent à "annuler + réinscrire" mais sans gap. Utile si l'admin reorganise les groupes.

### Sur les présences
- **Voir la liste des présents par jour** (pas juste les stats agrégées).
- **Ajouter manuellement une présence** pour quelqu'un qui n'apparaît pas dans le système (sans inscription électronique).
- **Pointage le jour J** : checkbox "arrivé·e" sur la liste des présents.

### Sur les comptes (`profiles`)
- **Modifier le pseudo / l'email** d'un utilisateur (cas où il s'est trompé à l'inscription).
- **Fusionner 2 comptes** (cas où un utilisateur s'inscrit 2 fois avec des emails différents).

### Traçabilité
- **Historique des modifications admin** : log de qui a fait quoi (table `audit_log`). Pas critique mais aide quand quelque chose semble bizarre.

### Approche d'implémentation suggérée
- Réutiliser au maximum la **vue par table** existante dans `admin.html`. Ajouter sur chaque ligne table un menu "⋮" avec les actions disponibles.
- Pour les opérations destructives : double confirmation comme pour le rappel J-3 (dialog + saisie d'un mot-clé).
- Émettre les emails appropriés (cf. nouveaux types à créer dans le worker).

---

## 3. Améliorations envisageables (à arbitrer en 2027)

Idées qui sont sorties pendant l'édition 2026 mais qui n'ont pas été retenues, à reconsidérer.

| Idée | Sortie de quel contexte | Décision 2026 | Reconsidérer ? |
|---|---|---|---|
| Drag-and-drop pour réordonner la liste d'attente | Vue admin par table | Non (complexité, peu utile) | Si demande utilisateur forte |
| Ajout manuel à la liste d'attente par l'admin | Vue admin par table | Non (gestion sur place) | À évaluer selon retour terrain |
| Trigger anti-INSERT-orphelin | Bug renommage table | Pas fait (timing convention) | **Oui** — utile même après refonte FK |
| Bouton "Présents sans inscription" dans admin | Recherche des "sans-tables" | Pas fait | Possible (requête SQL fournie, mais pas exposée en UI) |
| Cron automatique pour rappel J-3 | Section 1.4 | Manuel pour 2026 | À faire pour 2027 |

---

## 4. Conventions et choix techniques à valider

Lors de la prochaine édition, revérifier :

- **Date de la convention** : mettre à jour dans `worker-email.js` (constantes `DATE_SAMEDI`, `DATE_DIMANCHE`)
- **Domaine** : `sousloeildemelusine.fr` est-il renouvelé ?
- **Clés et secrets** :
  - `MAILERSEND_API_KEY` (Cloudflare) — vérifier qu'elle est toujours valide
  - `WEBHOOK_SECRET` (Cloudflare + `email-triggers.sql`) — peut être renouvelé
  - Domaine MailerSend vérifié — vérifier statut DNS
- **Lien Facebook événement** : à mettre à jour dans `worker-email.js` (`FB_EVENT_URL`)
- **Lien HelloAsso repas** : à mettre à jour dans `worker-email.js` (cherchez "helloasso.com")
- **Lieu** : `LIEU_NOM`, `LIEU_ADRESSE` dans `worker-email.js` si changement de salle

---

## 5. Checklist de pré-production (pour la prochaine édition)

Avant l'ouverture des inscriptions, vérifier :

- [ ] Toutes les dates dans `worker-email.js` mises à jour
- [ ] DNS MailerSend toujours vérifié (cf. `Activity` du dashboard)
- [ ] Lien Facebook et HelloAsso à jour
- [ ] `seed_data.sql` adapté pour la nouvelle édition (créneaux bénévoles, etc.)
- [ ] Si refonte `programme_id` faite : tester un workflow complet (inscription → annulation → promotion auto → email)
- [ ] Test de l'envoi du rappel J-3 sur un compte admin avant la vraie date
- [ ] Test de l'export CSV (les 5 fichiers)
- [ ] Vue admin par table opérationnelle
- [ ] Modal post-login s'affiche pour un nouveau compte
- [ ] Email de bienvenue / signup Supabase Auth toujours traduit en français (si SMTP custom configuré)

---

## 6. Référence rapide — fichiers SQL à connaître

| Fichier | Quand le lancer | Idempotent ? |
|---|---|---|
| `seed_data.sql` | Une fois par édition (creneaux, programme initial, etc.) | Oui (ON CONFLICT DO NOTHING) |
| `email-triggers.sql` | Une fois par édition (ou à toute modif worker) | Oui |
| `presences.sql` | Une fois | Oui |
| `presences_admin_stats.sql` | Une fois | Oui |
| `inscription_promotion.sql` | Une fois | Oui |
| `email_rappels.sql` | À chaque modif du contenu/format rappel | Oui (DROP+CREATE inclus) |
| `admin_export.sql` | À chaque modif des données exportées | Oui |
| `programme_sync.sql` | Une fois | Oui |

Tous utilisent `CREATE OR REPLACE FUNCTION` et `DROP TRIGGER IF EXISTS` → rejouables sans risque.
