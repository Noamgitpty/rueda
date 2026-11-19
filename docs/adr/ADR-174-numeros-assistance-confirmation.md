# ADR-174 — Numéros du support et de l'assistance de l'assureur dans la confirmation : donnée pays, production refusée sans eux

- **Statut** : PROPOSÉ (US-213, suite N-298, agent de story, claude-opus-5-5, 2026-11-18). Revues exigées : celles de `node scripts/ci/check-story-reviews.mjs`.
- **Complète** : ADR-157 (confirmation de réservation, parties lues en base), ADR-061 (catalogue des notifications), ADR-024 (aucune constante pays).
- **Sources** : 19 US-213 critère 2 (« affiche les numéros du support et de l'assistance de l'assureur ; le téléphone personnel de l'hôte n'y figure pas ») ; 16 NTF-007 ; 08 BR-PROT-05 (assistance 24/7 de l'assureur, contact WhatsApp et téléphone, [NOUS] recommandation LATAM) ; 16 ADM-014 (production refusée sans donnée obligatoire) ; `POUR_LE_FONDATEUR.md` §2.13 ; BOARD N-298.

## Contexte

#225 a livré la confirmation au voyageur et à l'hôte, sans les deux numéros : ils n'existent pas encore. Ce sont des données du fondateur (support de Kmino, assistance prévue par le contrat de l'assureur partenaire de chaque pays). La story ne peut pas les inventer ; elle ne doit pas non plus laisser partir en production une confirmation qui ne les donne pas.

## Décision

1. **Donnée pays, pas une constante** : champ obligatoire `assistanceContacts` de chaque pays de `cfg/data/countries.json` (`null` ou `{ supportPhone, insurerAssistancePhone }`), comme `legalEntity`. Chaque numéro est au format E.164 et commence par l'indicatif du pays (`phone.callingCode`) : un numéro mal formé, celui d'un autre pays ou un champ inconnu refusent le chargement (`CONFIG_INVALID`). Rien n'est écrit en base : la configuration est relue au démarrage.
2. **Production refusée sans eux** : `findReadinessIssues` ajoute `ASSISTANCE_CONTACTS_MISSING` (classe des manques, `PARAM_MISSING`) pour un pays où `assistanceContacts` vaut `null`. La production ne démarre pas, comme sans entité juridique ; la préproduction et les tests démarrent (16 ADM-014, 19 US-110).
3. **Message** : variable de gabarit `assistance` (source `{ from: 'assistance', audience }`), rendue à l'envoi par NTF à partir de la configuration du pays de l'événement :
   - voyageur (`EVT_BOOKING_CONFIRMED`) : le support et l'assistance de l'assureur ;
   - hôte (`EVT_BOOKING_CONFIRMED_HOST`) : le support seulement (l'assistance de l'assureur sert le conducteur pendant le trip) ;
   - numéros absents (hors production seulement) : renvoi à la réservation dans l'appli, jamais un numéro inventé ;
   - e-mail et SMS : textes propres (`ntf.assistance.<guest|host>.<email|sms>.<numbers|inApp>`, catalogue v90, es / en / fr / pt-BR), dans le budget de 3 segments éprouvé avec des numéros à la longueur nationale du pays.
     Le téléphone de l'hôte n'est jamais une source du message (ni variable, ni repli).
4. **Comme Turo** : la confirmation de Turo renvoie au voyage et à l'assistance routière de la plateforme ; ici la protection est vendue pour un assureur partenaire (08 BR-PROT-05), d'où son numéro à côté de celui du support. Rien de plus lourd : aucun écran nouveau, aucune donnée stockée.

## Options écartées

- **Paramètres `param_definition`** (`support_phone[pays]`) : un numéro n'est pas une règle métier versionnée de 17 §7.2 ; il faudrait une nouvelle clé dans les specs, une graine et un type `TEXT` qui n'existe pas.
- **Bloquer l'envoi sans numéros** (erreur de gabarit, lettre morte) : aucune confirmation ne partirait en préproduction et les tests de bout en bout perdraient la preuve du critère 2 ; le refus au démarrage de la production suffit à ce qu'aucun voyageur réel ne reçoive le renvoi.
- **Numéros sur l'écran S06 / S09** : hors du critère d'US-213 (message) ; `web.s06.support` existe déjà ; à reprendre avec le canal du support (BOARD N-203).

## Conséquences

- Au PA et au PY aujourd'hui : `assistanceContacts` = `null` ⇒ renvoi à l'appli en préproduction, production refusée (`PA ASSISTANCE_CONTACTS_MISSING`, `PY ASSISTANCE_CONTACTS_MISSING`), en plus des manques déjà connus (entité juridique, fériés, taux de taxe).
- Pour ouvrir un pays, le fondateur fournit les deux numéros (`POUR_LE_FONDATEUR.md` §2.13) ; une PR revue les inscrit dans `countries.json`. Aucun code ne change.
- WhatsApp (08 BR-PROT-05) : même numéro E.164 ; un lien `wa.me` viendra avec le canal WhatsApp (lot C).
- Preuves : `cfg/internal/parse.test.ts` (champ obligatoire, E.164, indicatif du pays, champ inconnu), `startup.test.ts` (manque dans les deux pays), `ntf/internal/templates.test.ts` (chaque gabarit × langue × canal, numéros fournis ou absents, PA et PY ; voyageur : deux numéros ; hôte : le support seul ; absents : aucun numéro), `sender.test.ts` (numéros relus à l'envoi, absents des journaux, jamais le téléphone de l'hôte).
