# VERIF_04 — Audit indépendant de 08_BUSINESS_RULES.md, 11_EDGE_CASES_AND_FAILURES.md et 22_OPEN_QUESTIONS.md

> **Auditeur :** agent indépendant. Je n'ai rédigé aucun des documents revus. **Date :** 2026-10-30.
> **Périmètre :** 08 (197 règles `### BR-…`, 38 lignes NOTIF, 6 machines à états Mermaid, pseudo-algorithme BR-CXL), 11 (53 cas EC-01 à EC-53), 22 (35 questions OQ-BR).
> **Méthode :**
> - Confrontation ligne à ligne avec `sources/SRC_GUEST_DOCS.md`, `sources/SRC_HOST_DOCS.md` et `sources/SRC_TOS_NOTES.md`.
> - Relecture de 6 articles officiels dans leur version publique `help.turo.com/en_us/<slug>.md`, téléchargés le 2026-10-30.
> - Prise en compte de `VERIF_01` et de `VERIF_03`.
> - Contrôle automatique : identifiants dupliqués, renvois BR orphelins, couverture des OQ.
> - Rejeu manuel du pseudo-algorithme sur 13 scénarios.
>
> **Aucune tentative de contourner le 403 de turo.com.** Les affirmations OBSERVÉ / DIRECTEMENT TESTÉ (05/06/09/10) n'ont pas été rejouées, seulement contrôlées pour leur cohérence.
> **Fichiers revus non modifiés.** Ce rapport est écrit dans le nouveau dossier du projet (`C:\Users\noamm\Documents\turo-audit-latam\…`). J'ai vérifié par `cmp` que 08, 11, 22, SRC_G, SRC_H et VERIF_03 y sont identiques à ceux de l'ancien dossier.

**Bilan : 2 CRITIQUE, 12 MAJEUR, 22 MINEUR** (36 constats). 43 règles confirmées.

---

## 1. Tableau des constats

| ID | Fichier : règle | Problème | Gravité | Preuve | Correction proposée |
|---|---|---|---|---|---|
| A01 | 08 : pseudo-algorithme BR-CXL, branche 1 (`if actor == HOST: … return full(trip)`) | Un **no-show guest déclaré par l'hôte** (`actor = HOST`, `reason = GUEST_NO_SHOW`) sort par la branche 1, donc en **remboursement intégral**. Même problème pour une annulation par l'hôte « à cause du guest » sur un tarif **remboursable** (permis invalide, autre conducteur envoyé). Or BR-CXL-08 dit : « Annulation exécutée par Turo **ou l'hôte** », avec une retenue de 2 jours ou de 75 % d'un jour. Le résultat dépend donc de l'acteur technique qui clique, et non de la cause. Le modèle de `actor` n'est défini nulle part. | **CRITIQUE** | 08 BR-CXL-08 ; SRC_G 4.1.5 ; https://help.turo.com/en_us/guest-trip-start-failures-HJUfENeVq.md (MAJ 2026-09-15) ; scénario S4 ci-dessous | Router d'abord sur `reason`, jamais sur `actor`. Traiter `GUEST_NO_SHOW` et `HOST_CANCELLED_DUE_TO_GUEST` **avant** la branche hôte, avec une règle explicite : remboursable → branche 4, version no-show ; NR → 0. Ajouter une énumération fermée `CancellationReason` avec, pour chaque motif, la table « remboursement guest / gains hôte / pénalité hôte / avis automatique ». |
| A02 | 08 : `computeHostEarnings` (note sous l'algorithme) et 11 : EC-01, critère 1 (« l'hôte reçoit sa part de 92 ») | Les gains de l'hôte sont calculés sur le **montant retenu au guest**, qui **inclut le trip fee** (92 = 2 × (120 + 18)/3). Cela contredit BR-PRICE-06 : « le trip fee n'est pas partagé avec l'hôte ». L'article officiel dit « your share of … one day's average **trip price** », sans le trip fee. Le test d'acceptation EC-01 est donc faux, et un développeur qui l'implémente verserait à l'hôte une part du revenu de la plateforme. | **CRITIQUE** | https://help.turo.com/en_us/trips-canceled-by-guests-or-turo-hosts-BkGMU4gV9.md (MAJ 2026-09-11) ; SRC_H H90 (« part hôte de 75 % d'une journée ») ; 08 BR-PRICE-06 | Définir deux assiettes : `guestRetained = penaltyDays × (tripPrice + tripFee)/days` et `hostBase = penaltyDays × tripPrice/days`, puis `hostEarnings = hostBase × host_share_pct_figé + deliveryRule`. Corriger EC-01 : gains hôte = part × 80 (2 × 120/3), pas part × 92. |
| A03 | 08 : algorithme, branche 4 ; BR-CXL-06 ; BR-PRICE-08 | Les **frais de conducteur additionnel** sont absents de `refundBase`. Ils sont donc retenus lors d'une annulation tardive remboursable, alors que BR-PRICE-08 (SRC_G 2.9.3) les dit « remboursés en cas d'annulation d'un trip remboursable ». En NR, BR-PRICE-08 ne les retient que si le conducteur a été approuvé, mais l'algorithme renvoie toujours `ZERO`. Pour le no-show, l'article officiel ne les liste pas : le cas n'est pas documenté. | MAJEUR | SRC_G 2.9.3 ; guest-trip-start-failures (.md : « additional driver fees … not listed ») | Ajouter `+ trip.additionalDriverFee` (remboursable) et `+ (driverApproved ? 0 : additionalDriverFee)` (NR). Marquer le cas no-show INFÉRÉ et l'inscrire dans 22. |
| A04 | 08 : algorithme, `refundTax = taxOn(refundBase)` ; BR-CXL-06 (« taxes au prorata ») | Deux règles fiscales incompatibles. (1) Le **prorata** donne `taxePayée × montantRemboursé / montantTaxable`. (2) `taxOn(refundBase)` **recalcule** la taxe sur une base qui contient la protection et les Extras, alors qu'ils ne sont peut-être pas taxables. Il recalcule aussi sans tenir compte des surtaxes fixes, comme la surtaxe P2P de 1 $/jour en Floride (BR-PRICE-12). Les montants diffèrent dès le premier centime (voir S2 : 6,44 contre 10,99 dans l'exemple). | MAJEUR | 08 BR-CXL-06 ; BR-PRICE-12 ; scénario S2 | Choisir une méthode : remboursement de la taxe **ligne par ligne**, chaque ligne remboursée emportant sa propre taxe. Exclure les surtaxes fixes par jour, qui sont remboursées seulement si la journée l'est. Rédiger la règle pour PA (ITBMS) et PY (IVA) en attendant OQ-BR-14. |
| A05 | 08 : BR-FUEL-01, BR-MILEAGE-03, BR-REIMB-01, tableau BR-PROT-06 (colonne « Fenêtre factures »), SM-1 (« factures 72–120h ») | 08 conclut que « le plan, plus spécifique, **prime** (INFÉRÉ) ». C'est contraire à sa **propre règle de résolution n° 2** (l'article le plus récent prime) et à VERIF_03 F10. L'article H59 (MAJ 2026-09-21, le plus récent) donne **72 h fixes** pour le carburant, la recharge et la distance supplémentaire, sans aucune mention de fenêtre par plan. Le tableau BR-PROT-06 présente 120/96/72 h comme un fait. | MAJEUR | https://help.turo.com/en_us/reimbursement-invoice-guidelines-hosts-SyCDS4eVc.md (« no more than 72 hours after a trip ends » ; aucune fenêtre 3/4/5 jours) ; VERIF_03 F10 | Pour décrire Turo : « 72 h (H59, 2026-09-21, le plus récent) ; H31/H32 (plus anciens) indiquent 3/4/5 jours selon le plan : contradiction ouverte ». Dans BR-PROT-06, marquer la colonne « contredite par H59 ». [NOUS] : 72 h fixes, `{param}`. Remonter OQ-BR-13 en P1. |
| A06 | 11 : EC-36, critère d'acceptation ; 08 : BR-CXL-13 / BR-HP-03 (exemptions) | Le test prend un hôte avec **8 trips et 0 annulation** et attend 50 USD de pénalité et `RESTRICTED`. Or la règle d'exemption documentée « **première annulation sur les 10 derniers trips réservés** » s'applique exactement à ce cas. 08 ne dit pas ce que lève l'exemption : les frais, les métriques, la dépublication ou le webinaire. La source officielle dit seulement « fees **and/or** remove a metrics impact », à la discrétion de Turo. | MAJEUR | https://help.turo.com/en_us/excusing-host-cancellation-fee-rk1bAtBB9.md (MAJ 2026-04-28) ; SRC_H H83, H87 | Ajouter une OQ « portée de l'exemption ». [NOUS] : table `exemption → {fee_waived, metrics_waived, delisting_waived, auto_review}`. Réécrire EC-36 avec un hôte ayant déjà 1 annulation dans ses 10 derniers trips, ou en précisant « exemption non demandée ». |
| A07 | 08 : SM-1 (PENDING_REQUIREMENTS, CHECKIN_OPEN) | Transitions manquantes. (a) `PENDING_REQUIREMENTS` n'a aucune sortie vers `CHECKIN_OPEN` (le check-in ouvre à T−24 h), `CANCELLED_BY_GUEST` ou `CANCELLED_BY_HOST`. Un guest ne peut donc pas annuler tant que sa checklist est ouverte. (b) `CHECKIN_OPEN → CANCELLED_BY_PLATFORM` manque. L'échéance BR-CXL-07 (T−2 h) tombe **après** l'ouverture du check-in (T−24 h), de même qu'un rappel CA/HI, un incident T&S ou une fermeture de compte survenus dans les 24 h. (c) Un état exclusif ne permet pas de cumuler « exigences en attente » et « check-in ouvert ». | MAJEUR | 08 SM-1 ; BR-VERIF-05 ; BR-PICKUP-01 ; BR-CXL-14 | Sortir les exigences de l'état principal : drapeau `requirements_status ∈ {NONE, PENDING, SATISFIED, FAILED}`, évalué à T−2 h. Ou ajouter les transitions `PENDING_REQUIREMENTS → CHECKIN_OPEN / CANCELLED_BY_GUEST / CANCELLED_BY_HOST` et `CHECKIN_OPEN → CANCELLED_BY_PLATFORM`. |
| A08 | 08 : SM-1 (TERMINATED_EARLY, UNRETURNED, COMPLETED) | (a) `TERMINATED_EARLY` et `UNRETURNED` ne sortent que vers `RETURNED` : un vol non retrouvé ou une perte totale (EC-13, BR-DAMAGE-09/10) reste en **impasse**. (b) `COMPLETED → [*]` ne permet pas la réouverture que demandent EC-24 (« trip COMPLETED rouvert pour facturation ») et EC-31 (chargeback sur un trip COMPLETED). (c) « fenêtres closes » ignore les péages et PV : 90 j, et jusqu'à ~185 j via le support. | MAJEUR | 08 SM-1 ; 11 EC-13, EC-24, EC-31 ; BR-TT-02 | Ajouter `UNRETURNED → VEHICLE_LOST → POST_TRIP` et `TERMINATED_EARLY → POST_TRIP` (véhicule non restituable). Gérer les factures tardives et les chargebacks comme des **objets liés** (Invoice, Dispute) qui ne changent pas l'état du trip, ou ajouter `COMPLETED → IN_DISPUTE`. Définir la liste exacte des fenêtres qui conditionnent `COMPLETED`. |
| A09 | 08 : SM-4 (SETTLEMENT → HOST_PAID / GUEST_INVOICED) ; 11 : EC-47 | (a) Le paiement de l'hôte et la facture du guest sont des branches **exclusives**, alors qu'ils se produisent en parallèle. `GUEST_PAID → CLOSED` peut fermer un dossier dont l'hôte n'a pas été payé, et inversement. (b) `EVIDENCE_COLLECTION` n'a pas de sortie à l'expiration des 15 jours (BR-DAMAGE-02). (c) `THEFT_INVESTIGATION` n'a pas de sortie « véhicule retrouvé intact ». (d) EC-47 s'appuie sur des états `INSURER_DECLINED` / `PLATFORM_GUARANTEE_REVIEW` qui sont annoncés comme « à ajouter » mais absents du diagramme. | MAJEUR | 08 SM-4 ; 11 EC-47 | Utiliser des régions parallèles (`state SETTLEMENT { --  }`) ou deux sous-machines `HostReimbursement` et `GuestLiability`. `CLOSED` exige les deux terminées. Ajouter `EVIDENCE_COLLECTION → INELIGIBLE : pièces manquantes à J+15`, `THEFT_INVESTIGATION → CLOSED : retrouvé sans dommage`, et les deux états de EC-47. |
| A10 | 22 : OQ-BR-35 (P0) ; 08 / 11 | La question P0 sur la **légalité même du P2P** (plaque « particular » au PA, statut fiscal de l'hôte au PY) n'est reprise comme risque **dans aucune** règle ni aucun cas. Les règles BR-ACC-06, BR-LIST-01 et BR-PAYOUT-05 [NOUS] supposent le P2P possible. Par ailleurs, OQ-BR-33 et OQ-BR-34 se disent « cités dans 08 », mais 08 ne cite que VERIF_01 V20/V19 (contrôle par script : ces OQ ne figurent ni dans 08 ni dans 11). | MAJEUR | Script de couverture : OQ-BR-32 à 35 absents de 08 et de 11 ; 22 ligne OQ-BR-35 | Ajouter dans 08 (Conventions) un bloc « Prérequis bloquants P0 » : OQ-BR-12/14/16/24/35, avec la règle « aucune règle [NOUS] d'onboarding hôte particulier n'est implémentable avant OQ-BR-35 ». Citer OQ-BR-33 dans BR-CXL-08 / BR-PICKUP-04 et OQ-BR-34 dans BR-PICKUP-09. |
| A11 | 08 : algorithme, branche 1 ; 08 / 11 : règles [NOUS] de remboursement intégral | Plusieurs règles [NOUS] promettent un **remboursement intégral**, mais l'algorithme n'a pas de code de motif correspondant et calculerait un remboursement partiel : retard de notre file de revue (BR-VERIF-05 [NOUS], EC-07) ; panne du PSP à la caution (EC-27) ; suspension « pour risque non prouvé » (EC-39) ; événement régional (BR-MOD-10 [NOUS], EC-16) ; refus de swap (BR-MOD-08 : « refus du guest = annulation intégralement remboursée ») ; véhicule `RESTRICTED` pour dommage (BR-DAMAGE-13). | MAJEUR | 08 BR-VERIF-05, BR-MOD-08, BR-MOD-10 ; 11 EC-07, EC-16, EC-27, EC-39 | Étendre l'énumération : `PLATFORM_REVIEW_DELAY`, `PSP_FAILURE`, `RISK_SUSPENSION_UNPROVEN`, `REGIONAL_EVENT`, `SWAP_REFUSED`, `VEHICLE_RESTRICTED`, chacun avec la ligne correspondante de la table (A01). Ajouter un test unitaire par motif. |
| A12 | 08 : BR-CXL-06, BR-CXL-08 (« part hôte + 50 % livraison ») ; BR-PROT-08 | Depuis le **08/10/2026**, la part du plan s'applique à la livraison aux US et au Canada (BR-PROT-08, VERIF_03 F02). Les règles d'annulation donnent à l'hôte « 50 % de la livraison » sans dire s'il s'agit de 50 % **brut** ou de **part × 50 %**. L'article officiel dit « You receive half of any delivery fee », sans lien avec le plan. | MAJEUR | trips-canceled-by-guests-or-turo-hosts (.md, 2026-09-11) ; how-vehicle-delivery-works-hosts (cité par VERIF_03 F02) | Écrire : « Turo : ½ livraison (H84, 2026-09-11) ; interaction avec la part de plan sur la livraison (08/10/2026) **non documentée** → nouvelle OQ ». [NOUS] : `hostDelivery = 0.5 × deliveryFee × delivery_share_pct` (paramètre). |
| A13 | 08 : BR-BOOK-03 [NOUS] | « Tolérance de **59 min** avant de compter un jour supplémentaire, **cohérent avec BR-RETURN-03 (0–29 min gratuites)** » : 59 ≠ 29. Avec cette tolérance, un trip de 24 h 45 min est facturé 1 jour à la réservation, alors qu'un retour avec 45 min de retard coûte ½ jour. Les deux règles sont incohérentes, et c'est la question P0 OQ-BR-04. | MAJEUR | 08 BR-BOOK-03, BR-RETURN-03 | `billable_days = max(1, ceil((end − start − 29 min) / 24 h))`, ou bien imposer des durées réservables en multiples de 24 h et laisser l'excédent à BR-RETURN-03. Une seule constante, `graceMinutes = 29`. |
| A14 | 08 : SM-6 | (a) Les gains issus d'une **annulation** (tardive, no-show, T&S < 24 h) n'ont aucune entrée dans le diagramme, car `ACCRUING` signifie « trip en cours ». (b) `NEGATIVE_BALANCE → [*]` termine le versement, alors que la dette doit être reportée. (c) `PARTIAL_SCHEDULED` ne peut pas passer en `ON_HOLD` (réclamation, vérification Stripe). (d) `ACCRUING → PARTIAL_SCHEDULED` ne prévoit pas de retour en `ACCRUING` pour le reste du trip. | MAJEUR | 08 SM-6 ; BR-PAYOUT-03/04 | Une instance de `Payout` par lot (partiel ou final), avec une entrée `[*] → SCHEDULED : gains d'annulation`. `NEGATIVE_BALANCE` devient une écriture du `host_ledger`, pas un état terminal. Ajouter `PARTIAL_SCHEDULED → ON_HOLD`. |
| A15 | 08 : BR-CXL-12, BR-PAY-08, NOTIF-05 | Le « crédit de rebooking **24 h** » n'est exact que pour une annulation à **moins de 24 h** du départ. Entre **24 et 72 h**, le crédit dure **jusqu'à l'heure de départ d'origine**. 08 confond aussi la mise à disposition des fonds (24 h) et le crédit discrétionnaire. SRC_G 4.2.3 donne la nuance, que 08 a perdue. | MINEUR | https://help.turo.com/en_us/how-to-rebook-a-canceled-trip-guests-HyO3VDkL9.md (MAJ 2026-10-20) ; SRC_G 4.2.2–4.2.3 | Reprendre la table à deux lignes de SRC_G 4.2.3 et distinguer « fonds disponibles 24 h » et « crédit (24 h / jusqu'au départ) ». |
| A16 | 08 : BR-PRICE-09 | Renvoi « Part hôte sur la livraison : voir **BR-PROT-09** ». BR-PROT-09 traite des exclusions hôte ; la bonne règle est **BR-PROT-08**. | MINEUR | 08 BR-PRICE-09, BR-PROT-08/09 | Corriger le renvoi. |
| A17 | 08 : BR-PICKUP-05 | « Turo Go absent du centre d'aide actuel » : il survit dans le résumé de H90 (VERIF_03 F07). | MINEUR | VERIF_03 F07 | Reprendre la formulation de F07. |
| A18 | 08 : BR-CXL-13, BR-HP-03 | « ≤ 20 trips » / « > 20 trips » : la source distingue **réservés** (≤ 20) et **complétés** (> 20), ce qui change le compteur à implémenter. | MINEUR | VERIF_03 F17 ; H83 | Écrire « ≤ 20 trips réservés » / « > 20 trips complétés » et définir les deux compteurs. |
| A19 | 08 : BR-HP-04 | « En dessous : fermeture du compte » : H10 alterne entre « removed » et « restriction ». | MINEUR | VERIF_03 F18 | Ajouter la nuance. |
| A20 | 08 : BR-HP-02 | Il manque que les seuils doivent être tenus pendant **≥ 3 mois** au UK, au CA et en AU. Au Canada, l'avantage vitrage/pneus est réservé aux sinistres du plan More earnings ; aux US, il vaut « regardless of plan ». | MINEUR | VERIF_03 F08, F09 | Compléter. |
| A21 | 08 : BR-RETURN-03 | SRC_H (H69, ligne « Retard ») ajoute **« 50 $ de frais de retour non conforme »** au barème de retard ; 08 ne le reprend pas et ne signale pas l'écart avec SRC_G 6.3.1. | MINEUR | SRC_H §3 ligne H69 ; SRC_G 6.3.1 | Relire H69 et indiquer si les 50 $ se cumulent avec le retard ≥ 2 h (contradiction à signaler sinon). |
| A22 | 08 : BR-PAY-03 | « **≥ 14 jours** → 7 jours avant » : la source dit « 3 à 13 jours » et « **plus de** 14 jours », ce qui laisse 14 jours exactement non couvert. 08 a tranché sans le dire. | MINEUR | SRC_G 2.6.3 | Écrire « 14 j (borne ambiguë dans la source, INFÉRÉ ≥ 14) ». |
| A23 | 08 : algorithme, branche 3 | Pour une réservation faite **moins d'1 h** avant le départ, `freeUntil = bookedAt + 1h` tombe **après** `trip.start`. Le guest peut donc annuler gratuitement après l'heure de début, ce qui chevauche la fenêtre de no-show. Non traité. | MINEUR | Scénario S11 | [NOUS] : `freeUntil = min(bookedAt + 1h, trip.start)`, ou documenter l'acceptation de ce cas. |
| A24 | 08 : algorithme, branche 4 ; BR-CXL-06 | L'**assistance routière renforcée** n'est remboursée qu'en no-show. Pour une annulation guest tardive avant le départ, elle est retenue. Non documenté (SRC_G 4.1.2 ne la cite pas), et non marqué INFÉRÉ. | MINEUR | SRC_G 4.1.2 ; canceling-a-trip-with-your-host (.md : renvoie à la policy pour ces lignes) | Marquer INFÉRÉ. [NOUS] : rembourser tout add-on non consommé avant `trip.start`. |
| A25 | 08 : algorithme, branche 2 | NR + `PLATFORM_INCOMPLETE_STEPS` après la grâce → `ZERO` : ce cas n'est pas documenté (BR-CXL-07 ne traite que le remboursable) et n'est pas marqué INFÉRÉ. | MINEUR | 08 BR-CXL-07, BR-CXL-14 | Ajouter un commentaire `# INFÉRÉ` et une OQ. |
| A26 | 08 : BR-CXL-13 | Pénalité de 25 $ / 50 $ : la borne « exactement 24 h » et l'horodatage de référence (demande d'annulation, heure serveur, fuseau du véhicule) ne sont pas précisés. | MINEUR | 08 BR-CXL-13 | Voir réécriture R04. |
| A27 | 08 : SM-1 | `QUOTE` n'a pas de sortie (abandon). Après un no-show, il n'y a pas d'état d'attente de la déclaration pendant 72 h. `NO_SHOW_*`, `CANCELLED_*` et `REFUSED_AT_PICKUP` sont terminaux, alors que des litiges sont possibles (« le guest prétend être venu », EC-01). | MINEUR | 08 SM-1 ; 11 EC-01 | Ajouter `QUOTE → [*] : abandon / TTL`, `CHECKIN_OPEN → START_WINDOW_EXPIRED → NO_SHOW_GUEST`, et une transition `→ IN_DISPUTE` depuis les états d'annulation. |
| A28 | 08 : SM-2 | `SNOOZED`, `UNLISTED` et `RESTRICTED` ne peuvent pas passer en `REMOVED_BY_PLATFORM` à la fermeture du compte. `SNOOZED` ne peut pas passer en `RESTRICTED` (rappel publié pendant un snooze). Il manque `DRAFT → DELETED` (« Start over »). `REJECTED` et `BLOCKED_ELIGIBILITY` n'ont pas d'état terminal. | MINEUR | 08 SM-2 ; BR-LIST-06/09 ; BR-HP-05 | Ajouter ces transitions. |
| A29 | 08 : SM-3 | `APPEAL` ne mène qu'à `APPROVED` ou `BANNED`. Un appel rejeté équivaut donc à un bannissement, ce qui est plus sévère que la règle [NOUS] « appel 1 fois ». `REJECTED` et `REVOKED` sans appel dans les 15 jours n'ont ni délai d'expiration ni état terminal. `MORE_INFO_REQUIRED` n'a pas d'expiration. Le lien avec SM-1 (révocation d'un conducteur ayant un trip BOOKED) n'est pas décrit. | MINEUR | 08 SM-3 ; BR-VERIF-11 [NOUS] | `APPEAL → REJECTED_FINAL` ; `REJECTED/REVOKED → REJECTED_FINAL : J+15 sans appel` ; ajouter la règle « REVOKED ⇒ annulation des trips BOOKED selon EC-39 ». |
| A30 | 08 : SM-5 | `HOST_RESPONSE → AWAITING_GUEST : hôte révise` relance une minuterie de 48 h, alors que BR-REIMB-02 dit que la fenêtre « ne peut pas être rouverte ». Il manque aussi le chemin vers un échéancier (BR-PAY-10). | MINEUR | 08 BR-REIMB-02 ; SM-5 | Préciser qu'une révision est une **nouvelle facture**, avec sa propre fenêtre de 48 h. Ajouter `UNPAID → PAYMENT_PLAN`. |
| A31 | 08 : SM-4, ligne `APPRAISAL --> SETTLEMENT : expertise photo (<1 j)…` | Syntaxe Mermaid : un `<` dans un libellé passe en général, mais il peut être interprété comme une balise HTML selon le niveau de sécurité du rendu. C'est le seul caractère à risque trouvé (aucun `;`, `{`, `}` ni `#` dans les 6 blocs). Les diagrammes n'ont **pas** été passés dans un parseur Mermaid : c'est une relecture manuelle. | MINEUR | Grep des blocs Mermaid | Écrire « moins d'1 j ». Ajouter un contrôle CI `mmdc -i 08.md`. |
| A32 | 08 : SM-6 (libellés) | Un diagramme marqué [NOUS] mélange des valeurs Turo (« +3h, ~3 j ouvrés 1er trip chez Turo ») et [NOUS] (J+2) dans le même libellé : risque qu'un développeur implémente la valeur Turo. | MINEUR | 08 SM-6 | Ne garder que les paramètres [NOUS] dans les diagrammes et renvoyer aux BR pour les valeurs Turo. |
| A33 | 08 : en-tête | « Statut du fichier : **EN COURS** » (ligne 5), puis « Statut : **COMPLET** » (ligne 6). | MINEUR | 08 l. 5–6 | Supprimer la ligne 5. |
| A34 | 22 : OQ-BR-26, OQ-BR-32 | OQ-BR-26 reste ouverte alors que VERIF_03 F02 a tranché : la part du plan vaut aux US/CA depuis le 08/10/2026, et le taux de 90 % ne vaut qu'en AU/UK. OQ-BR-32 (attente de VERIF_03) est résolue par VERIF_03 et par le présent rapport. | MINEUR | VERIF_03 F02 | Clore OQ-BR-26 (réponse : centre d'aide) et OQ-BR-32 (renvoi vers VERIF_03/04, constats A05, A12, A17–A20). |
| A35 | 11 : EC-01, critère 1 | En plus de A02, le critère omet la ½ livraison due à l'hôte et ne dit pas quelle valeur de `noShowGraceMinutes` le test utilise (60 [NOUS]). | MINEUR | 11 EC-01 | « Then l'hôte reçoit part × 80 + règle livraison (A12) ». |
| A36 | 11 : EC-18 | Le critère applique des frais de **5 %** ([NOUS] BR-PRICE-15) et 72 h de contestation ([NOUS] BR-REIMB-02), mais la colonne « Ce que fait Turo » cite 3 % et 48 h. Le résultat est correct pour [NOUS], mais le test devrait citer ses paramètres. | MINEUR | 11 EC-18 | Écrire `adminFeePct = 5 % {param}` et `disputeWindow = 72 h {param}` dans le Given. |

**Étiquetage ([NOUS] présenté comme un fait Turo ; back-office interne présenté comme un fait)** : je n'ai trouvé **aucun cas grave**. Les sections [NOUS] sont systématiquement balisées. Les machines à états sont déclarées PROPOSÉ. Les mécanismes internes (verrouillage BR-BOOK-10, processus d'approbation BR-LIST-08, back-office sinistres BR-DAMAGE-11, Risk Score BR-TRUST-01) sont marqués INFÉRÉ. Seules réserves : A24/A25 (inférences non marquées dans l'algorithme) et A32 (mélange de valeurs dans SM-6).

**Identifiants** : 197 identifiants `### BR-…` uniques (aucun doublon) ; 53 EC uniques ; 38 NOTIF. **Aucun renvoi BR orphelin** dans 08, 11 ou 22 (contrôle par script). En revanche, un renvoi existe mais vise la mauvaise règle (A16).

---

## 2. Rejeu du pseudo-algorithme de remboursement (BR-CXL)

**Trip de référence (remboursable, 3 jours)** :

| Composante | Montant |
|---|---|
| tripPrice | 120 |
| tripFee | 18 |
| protection | 30 |
| extras | 15 |
| enhancedRoadside | 9 |
| additionalDriverFee | 15 |
| deliveryFee | 40 |
| youngDriverFee | 0 |
| Taxe | 7 % sur prix + trip fee (9,66) |

Total payé : 256,66, plus une caution à part. `avgDayCost` = 46.

Variante **≤ 2 jours** : prix 80, trip fee 12, `avgDayCost` = 46.

| # | Scénario | Résultat de l'algorithme | Résultat attendu (règles textuelles) | Verdict |
|---|---|---|---|---|
| S1 | Fenêtre gratuite : réservé à T−5 j, annulé à T−2 j | Branche 3 → `full` = 256,66 | BR-CXL-01 : intégral | OK |
| S2 | Hors fenêtre, trip > 2 j : annulé à T−10 h | Retenue 46 ; `refundBase` = 92 + 30 + 15 + 0 + 20 = 157 ; `taxOn(157)` = 10,99 → **167,99** | BR-CXL-06 : 92 + protection + Extras + 50 % livraison + **frais conducteur additionnel 15** (BR-PRICE-08) + taxe au prorata (7 % × 92 = 6,44) → **178,44** | **ÉCART** (A03, A04) ; assistance renforcée 9 retenue (A24) |
| S3 | Hors fenêtre, trip ≤ 2 j | Retenue 0,5 × 46 = 23 ; base 69 + … | BR-CXL-06 : ½ jour | OK sur la retenue ; mêmes écarts annexes qu'en S2 |
| S4 | No-show guest, remboursable, 3 j, déclaré par l'hôte (`actor = HOST`) | Branche 1 → **`full`** | BR-CXL-08 : retenue de 2 × 46 = 92 → 46 + annexes | **ÉCART CRITIQUE** (A01) |
| S4b | Idem, exécuté par la plateforme (`actor = PLATFORM`) | Branche 4, `penaltyDays` = 2 → 46 + 30 + 15 + 9 + 20 + taxe | BR-CXL-08 | OK (sauf frais conducteur additionnel, cas non documenté) |
| S5 | NR, annulé 5 h après la réservation (réservé à T−10 j) | Branche 2 → `full` | BR-CXL-02 : intégral pendant la grâce | OK |
| S6 | NR, annulé 3 jours après la réservation | `ZERO` + caution libérée | BR-CXL-02 : 0. BR-PRICE-08 : frais conducteur remboursés si aucun conducteur n'est approuvé | Écart mineur (A03) |
| S7 | L'hôte annule (motif ordinaire), remboursable ou NR | `full` + crédit 24 h | BR-CXL-12 : intégral. Crédit : 24 h si moins de 24 h avant le départ, sinon jusqu'au départ (entre 24 et 72 h) | OK sur le montant ; crédit mal décrit (A15) |
| S7b | L'hôte annule à cause du guest (permis), tarif **remboursable** | `full` | BR-CXL-08 : permis invalide = no-show → partiel | **ÉCART** (A01) |
| S8 | Plateforme, étapes non faites, remboursable 3 j (réservé à T−3 j, annulé à T−2 h) | Branche 4 → partiel (1 jour) | BR-CXL-07 / BR-CXL-14 : partiel | OK. En NR : `ZERO` (A25, INFÉRÉ) |
| S8b | Idem, mais l'échec vient du retard de **notre** file de revue ([NOUS] BR-VERIF-05, EC-07) | Partiel | [NOUS] : intégral | **ÉCART** (A11) |
| S9 | Commun accord prouvé, NR | `full` ; gains hôte 0 | BR-CXL-05 | OK |
| S10 | Dernière minute : réservé à T−24 h 30, annulé 50 min après | Seuil 25 h → `full`. (Avec la policy à 24 h : `freeUntil` = T−24 h = réservation + 30 min → partiel) | Divergence volontaire documentée (OQ-BR-30) | OK (cohérent avec EC-35) |
| S11 | Réservé à T−30 min, annulé à T+20 min sans check-in | `freeUntil` = T+30 min → `full` | Non défini (chevauche le no-show) | Lacune (A23) |
| S12 | Plateforme T&S, annulé à T−10 h | `full` ; gains hôte selon BR-CXL-06 (< 24 h) | BR-CXL-14 (policy, non recoupé) | OK. Le calcul hôte reprend l'erreur d'assiette A02 |
| S13 | Vol retardé, justificatif valable, hôte de bonne foi mais sans accord possible | `full` (`TRANSPORT_DELAY_VALID`) ; hôte payé « comme un no-show » | BR-CXL-10 | OK, à condition que `computeHostEarnings` reçoive un indicateur `goodFaith` : la note ne cite que « transport sans effort de bonne foi → 0 » |

**Bilan du rejeu** : 13 scénarios principaux et 3 variantes. 8 conformes ; 5 écarts, dont 2 critiques (S4, S7b sur la même cause A01) ; 3 lacunes ou écarts mineurs (S6, S7, S11).

---

## 3. Revue des machines à états

| SM | Complétude | Impasses / états non terminaux | Transitions documentées manquantes | Syntaxe Mermaid |
|---|---|---|---|---|
| SM-1 Trip | Partielle | `QUOTE` (abandon) ; `TERMINATED_EARLY` et `UNRETURNED` sans issue si le véhicule n'est pas restitué ; `COMPLETED` non réouvrable | `PENDING_REQUIREMENTS → CHECKIN_OPEN / CANCELLED_BY_GUEST / CANCELLED_BY_HOST` ; `CHECKIN_OPEN → CANCELLED_BY_PLATFORM` (T−2 h, rappel, T&S) ; refus de swap (BR-MOD-08) non distingué ; litige après annulation ou no-show | Valide à la relecture (`[*]`, auto-transitions, libellés après `:`) |
| SM-2 Annonce | Bonne | `REJECTED` et `BLOCKED_ELIGIBILITY` sans état terminal | `SNOOZED/UNLISTED/RESTRICTED → REMOVED_BY_PLATFORM` ; `SNOOZED → RESTRICTED` ; `DRAFT → DELETED` | Valide |
| SM-3 Vérification | Bonne | `REJECTED`, `REVOKED` et `MORE_INFO_REQUIRED` sans délai d'expiration | `APPEAL → REJECTED_FINAL` ; lien vers SM-1 en cas de révocation | Valide |
| SM-4 Sinistre | Partielle | Branches exclusives hôte/guest (A09) ; `EVIDENCE_COLLECTION` sans expiration ; vol retrouvé intact | `INSURER_DECLINED`, `PLATFORM_GUARANTEE_REVIEW` (EC-47) ; frais de traitement (BR-DAMAGE-07) ; parcours direct ≤ 20 j → `CLOSED` à l'échéance | Valide (risque `<`, A31) ; deux points d'entrée `[*]` autorisés |
| SM-5 Facture annexe | Bonne | — | `UNPAID → PAYMENT_PLAN` ; statut de la révision (A30) | Valide |
| SM-6 Versement | Partielle | `NEGATIVE_BALANCE` terminal (A14) | Entrée des gains d'annulation ; `PARTIAL_SCHEDULED → ON_HOLD` | Valide |

**États terminaux** : définis pour les 6 machines (`[*]`). Les manques sont les **sorties d'erreur ou d'expiration** et le **parallélisme** (SM-1 exigences ; SM-4 hôte/guest).

---

## 4. Règles trop vagues pour être implémentées : 15 réécritures prioritaires

Conventions pour toutes les réécritures : horodatages serveur en UTC ; échéances calculées dans `vehicle.timezone` ; montants en `amount_minor` (USD exposant 2, PYG exposant 0) ; bornes notées explicitement.

| # | Règle | Manque | Réécriture proposée |
|---|---|---|---|
| R01 | BR-BOOK-03 (OQ-BR-04, P0) | Arrondi des jours ; incohérence 59/29 min (A13) | `billable_days = max(1, ceil((end − start − 29 min) / 24 h))` ; `graceMinutes = 29` partagé avec BR-RETURN-03 ; calcul sur la durée réelle en UTC (indépendant du changement d'heure). |
| R02 | BR-CXL-06/08, `avgDayCost` | Assiette, version du prix, arrondi | `avgDayCostGuest = round_half_up((tripPrice_net_after_discounts + tripFee) / billable_days)` sur la **version de prix en vigueur à l'annulation** ; `avgDayPriceHost = round_half_up(tripPrice_net / billable_days)` (sans trip fee) ; en unités mineures. |
| R03 | BR-CXL-01 | Bornes et inclusivité | `lastMinute = (start − bookedAt) < 25 h` ; `freeUntil = lastMinute ? min(bookedAt + 60 min, start) : start − 24 h` ; gratuité si `cancelRequestedAt ≤ freeUntil` (borne incluse) ; `cancelRequestedAt` = réception serveur de la demande. |
| R04 | BR-CXL-13 | Borne de 24 h, devise, acteur | Acteur : hôte ou co-hôte avec permission Trip management. `fee = (start − cancelRequestedAt) > 24 h ? 25 : 50` en devise du pays (`{param}` par devise, sans conversion), débitée au `host_ledger` à l'horodatage d'annulation. Exemptions évaluées **avant** le débit, selon la table de portée (A06). |
| R05 | BR-CXL-08 / BR-PICKUP-04 | Minuteries | `noShowAt = start + noShowGraceMinutes (60)`. L'hôte peut déclarer si `now ≥ noShowAt` **et** si un message de l'hôte remonte à au moins 15 min sans réponse. Fenêtre de déclaration : `[noShowAt, start + 72 h]`. Sans déclaration ni check-in à `start + 72 h` → `NO_SHOW_GUEST` automatique ([NOUS]). |
| R06 | BR-RETURN-03 | Mesure du retard, bornes, plafond ≥ 24 h | `late = checkout_at − scheduled_end`, où `checkout_at` = fin de check-out serveur, ou position GPS hors lieu si non fait. `[0, 30 min)` : 0 ; `[30 min, 2 h)` : 0,5 × `avgDayPriceHost` ; `[2 h, 24 h)` : 1 × + 20 `{param}` ; `≥ 24 h` : `ceil(late / 24 h)` × `avgDay` + 20 + `UNRETURNED` ; frais admin `{param}` % par ligne. |
| R07 | BR-PAY-06 [NOUS] | Point de départ de la libération | `release_at = (checkout_at ?? scheduled_end) + 72 h`, suspendu tant qu'un `Claim` est `REPORTED…`, qu'une `Invoice` est `AWAITING_GUEST/DISPUTED` ou qu'une assistance reste due. Pré-autorisation renouvelée si `release_at > auth_expiry`, sinon débit puis remboursement. |
| R08 | BR-PAYOUT-02 [NOUS] | Jours ouvrés, calendrier, heure limite | `payout_at` = 2ᵉ jour ouvré **du pays du véhicule** (calendrier des fériés PA/PY) après `trip.end`, lot quotidien à 10:00 heure locale ; 1er versement d'un hôte : 5ᵉ jour ouvré ; bloqué si une réclamation est ouverte (`ON_HOLD`). |
| R09 | BR-REIMB-01 | Origine des délais, fenêtre unique | `deadline = trip.end_effective + 72 h` (carburant, recharge, km, nettoyage, tabac, retard) ; `+ 90 j` (péages, PV ; `+ 120 j` [NOUS]) ; `end_effective = checkout_at ?? scheduled_end`. Soumission refusée côté serveur au-delà. |
| R10 | BR-PRICE-05 [NOUS] | Ordre, assiette, plafond | `discount_pct = min(duration_pct + nr_pct + promo_pct, 60 %)` appliqué au **sous-total des prix journaliers** ; une seule ligne par remise sur le reçu, montant de chaque ligne `round_half_up(subtotal × pct)` ; le trip fee est calculé **après** remises. |
| R11 | BR-PRICE-14 / BR-PRICE-12 | Lignes taxables, ordre des arrondis | Tableau `line_type → taxable (PA/PY)` versionné ; `tax_line = round_half_up(line_amount × rate)` ; total = Σ lignes + Σ taxes ; répartition hôte/plateforme par plus grand reste, résidu à la plateforme. |
| R12 | `computeHostEarnings` (BR-CXL) | Assiette, livraison, part figée | `host = penaltyDays × avgDayPriceHost × host_share_pct_frozen + 0,5 × deliveryFee × delivery_share_pct` ; 0 si `reason ∈ {HOST_ACCOUNT_CLOSED, MUTUAL_AGREEMENT, TRANSPORT_NO_GOOD_FAITH, cancel ≤ freeUntil}` ; versé selon R08. |
| R13 | BR-MOD-02 [NOUS] | Échéance de référence pour le délai de réponse | `response_deadline = min(submitted_at + {8 h lieu \| 12 h extension/raccourci}, affected_time − 1 h)` où `affected_time` = début (changement de lieu ou de départ) ou fin prévue (extension) ; expiration = refus automatique, notification aux deux parties. |
| R14 | BR-HP-03 | Taux d'annulation | `rate = cancellations_by_host_not_excused(365 j glissants) / trips_booked(365 j)` ; seuil `> 5 %` appliqué si `completed_trips > 20`, sinon compteur d'annulations sur la vie du compte ; recalcul quotidien à 00:00 UTC. |
| R15 | BR-DAMAGE-01 | « Fin du trip » : prévue (CGU) ou réelle (aide) | `claim_deadline = max(scheduled_end, checkout_at) + 24 h` ([NOUS], le plus protecteur pour l'hôte et cohérent avec les photos post-trip ≤ 24 h) ; au-delà : `REJECTED_LATE` sauf vol (BR-DAMAGE-10). |

Autres règles vagues à traiter ensuite :
- BR-PAY-02 [NOUS] : validité des autorisations par acquéreur.
- BR-REVIEW-05 [NOUS] : base de la moyenne guest.
- BR-TT-02 : origine des 90 jours.
- BR-VERIF-04 [NOUS] : « 4 h ouvrées » (horaires du support non définis).
- BR-PICKUP-09 : préavis aéroport à 12 h.

---

## 5. Prise en compte de VERIF_03 (non disponible pour le rédacteur)

| Constat VERIF_03 | État dans 08 | Verdict |
|---|---|---|
| F02 : livraison et Extras à la part du plan (US/CA) depuis le 08/10/2026 ; FR depuis le 19/10/2026 ; 90 % en AU/UK | BR-PROT-08 correct | Reflété. Effet sur les annulations non traité (A12) ; OQ-BR-26 à clore (A34) |
| F03/F04 : commission de 0 à 35 % en part variable | BR-PROT-07 (65 % à 0–2 j) ; aucune fourchette 10–30 % erronée dans 08 | Reflété |
| F10 : 72 h fixes (H59, le plus récent) contre fenêtres par plan | 08 fait primer le plan | **Non reflété** (A05) |
| F07 : Turo Go | Non reflété | A17 |
| F08/F09 : Power Host | Non reflété | A20 |
| F17 : trips réservés / complétés | Non reflété | A18 |
| F18 : fermeture / restriction | Non reflété | A19 |
| F01 : 3 300 / 1 800 mi | BR-MILEAGE-02 correct | Reflété |
| F06 : 24 h ouvrées contre 2–3 j ouvrés | BR-DAMAGE-04 + OQ-BR-22 | Reflété |

---

## 6. Liste « confirmé »

### Règles vérifiées contre l'article officiel `.md` (2026-10-30)

- BR-CXL-01 : 24 h ; 1 h si réservé moins de 24 h avant. https://help.turo.com/en_us/canceling-a-trip-with-your-host-HJyUE4xN9.md (MAJ 2026-04-21, « 24 hours throughout »).
- Contradiction 24 h / 25 h de BR-CXL-01 : confirmée. L'article hôte (MAJ 2026-09-11) dit « booked less than 25 hours ». https://help.turo.com/en_us/trips-canceled-by-guests-or-turo-hosts-BkGMU4gV9.md
- BR-CXL-02, côté hôte : NR annulé plus de 24 h après la réservation → gains complets. Même article.
- BR-CXL-06, côté hôte : ½ jour (≤ 2 j) ou 1 jour (> 2 j) de « trip price » ; ½ livraison. Même article.
- BR-CXL-14 : fermeture du compte hôte → 0 gain, quel que soit le moment. Même article. Les cas T&S et étapes non faites ne sont **pas** traités par l'article : le statut « policy, non recoupé » est correct.
- BR-CXL-08 : 2 h US/CA/UK, 30 min AU/FR ; −75 % d'un jour ou −2 jours ; Extras, assistance renforcée, protection, caution, jeune conducteur et 50 % de la livraison remboursés ; NR inéligible ; permis non téléversé 1 h avant sans rencontre possible. https://help.turo.com/en_us/guest-trip-start-failures-HJUfENeVq.md (MAJ 2026-09-15).
- BR-CXL-13 / BR-HP-03, liste des exemptions : 7 motifs exacts. https://help.turo.com/en_us/excusing-host-cancellation-fee-rk1bAtBB9.md (MAJ 2026-04-28).
- BR-REIMB-01 / 02 / 03 : 72 h, 90 j, 48 h guest, 72 h hôte, escalade automatique, facturation en cours de trip à partir de 60 j. https://help.turo.com/en_us/reimbursement-invoice-guidelines-hosts-SyCDS4eVc.md (MAJ 2026-09-21).
- BR-CXL-12 : fonds disponibles 24 h. https://help.turo.com/en_us/how-to-rebook-a-canceled-trip-guests-HyO3VDkL9.md (MAJ 2026-10-20). La durée du crédit est mal décrite (A15).

### Règles conformes à la source citée (SRC_G / SRC_H / TOS)

**Comptes, vérification, conducteurs**
- BR-ACC-04 (SRC_G 1.2.1)
- BR-ACC-05 (1.2.2–1.2.4)
- BR-VERIF-03 (TOS : FCRA, score d'assurance)
- BR-VERIF-05 (1.4.5)
- BR-VERIF-08 (2.9.1, 2.9.4)
- BR-PICKUP-07 (2.9.2)

**Annulations et modifications**
- BR-CXL-03 (4.1.1)
- BR-CXL-10 (4.1.7)
- BR-MOD-02 / 03 / 04 / 07 (5.2–5.9)
- BR-MOD-10 (4.1.8)

**Paiements et prix**
- BR-PAY-02 (2.6.2)
- BR-PAY-04 (2.6.4)
- BR-PAY-05 (2.6.5)
- BR-PAY-06 (2.5.1–2.5.4)
- BR-PRICE-01 / 02 (H28)
- BR-PRICE-08 (2.4.8, 2.9.3)
- BR-PRICE-14 (TOS, arrondis)
- BR-PRICE-16 (2.7.2 : « non cumulable »)

**Retour, carburant, kilométrage, péages**
- BR-RETURN-02 (6.2.1)
- BR-RETURN-03 (6.3.1–6.3.2 ; voir A21)
- BR-FUEL-01, montants (6.5.1)
- BR-MILEAGE-01 / 02 (H25 ; 3 300 / 1 800 mi)
- BR-RETURN-06 (2.3.5)
- BR-CSP-01 (6.6.1)

**Protections et dommages**
- BR-PROT-02 (3.2–3.5)
- BR-PROT-06, parts et franchises (H31/H32)
- BR-PROT-07 (H33)
- BR-PROT-08 (H33, H26, H27)
- BR-PROT-09 (H31)
- BR-PROT-10 (TOS : attorney-in-fact)
- BR-DAMAGE-05 (3.3–3.5)
- BR-DAMAGE-07 (3.7 ; contradiction 150 / 575 $ correctement signalée)
- BR-DAMAGE-09 (3.5, H31)
- BR-DAMAGE-10 (TOS : 12 h)
- BR-TRUST-03 (TOS : 5 500 $)

**Hôtes, versements, avis, annonces**
- BR-BOOK-01 (H21)
- BR-LIST-06 (H06)
- BR-HP-01 (H101)
- BR-HP-04, seuils (H10)
- BR-HP-05 (H107)
- BR-PAYOUT-02 / 03 (H46)
- BR-REIMB-06 (H107)
- BR-REVIEW-01 / 02 / 04 / 05 / 07 (8.1–8.5)
- BR-TRUST-06 (8.6, 8.10)

**Arithmétique des cas limites, recalculée et exacte** :
- EC-22 : 550 km × 0,20 = 110,00.
- EC-23 : 20 + 10 + 20 = 50.
- EC-32 : 1 228 920 PYG ; 748 125 + 249 375 = 997 500 ; 166 250,5 → 166 251.
- EC-33 : 01:30 UTC−3 = 04:30 UTC.
- EC-34 : fin maximale le 11 à 08:00.
- EC-50 : 2026-08-01 + 90 j = 2026-10-30 ; 2026-11-05 = J+96.
- EC-18 : 20 × 1,05 = 21,00 (avec les paramètres [NOUS]).

---

## 7. Limites

- Pages turo.com en 403 (cancellation policy, host-hub) non relues : les points « policy, non recoupé » restent non vérifiables.
- Diagrammes Mermaid relus à la main, pas compilés.
- Environ 155 règles de 08 n'ont été contrôlées que par cohérence, sans retour ligne à ligne à la source.
- Les règles [NOUS] ne sont pas jugées sur le fond (choix produit), seulement sur leur cohérence interne et leur précision.
