# 15 — Améliorations produit : faire mieux que Turo pour l'Amérique latine (Panama d'abord, Paraguay ensuite)

> **Statut global du fichier : PROPOSÉ.** Rédigé le 2026-10-30 (Phase 6). Aucune de ces idées n'a été testée sur le terrain.
> Sources internes uniquement (aucune navigation sur turo.com) : `05_GUEST_JOURNEYS.md`, `06_HOST_JOURNEYS.md`, `08_BUSINESS_RULES.md`, `09_PRICING_PAYMENTS_AND_PAYOUTS.md`, `10_INSURANCE_TRUST_AND_SAFETY.md`, `11_EDGE_CASES_AND_FAILURES.md`, `12_PANAMA_MARKET.md`, `13_PARAGUAY_MARKET.md`, `14_COMPETITIVE_ANALYSIS.md`, `22_OPEN_QUESTIONS.md`, `sources/SRC_GUEST_DOCS.md` (abrégé **SRC_G**), `sources/SRC_HOST_DOCS.md` (abrégé **SRC_H**), `sources/SRC_TOS_NOTES.md`.
> Hypothèse stratégique de cadrage (12 §10.3, 14 §c) : **lancement au Panama (Panamá City, Tocumen, Albrook), modèle pro-first** (loueurs professionnels et flottes de renting comme première offre), P2P vérifié ensuite, **Paraguay à 12–18 mois**. Pas de VTC, pas de sortie du territoire, pas de livraison en zone d'arrivée d'aéroport tant qu'elle n'est pas autorisée.
> **Révision VERIF_06 (2026-10-30)** : le P0 est scindé en **P0-A** (bêta fermée, l'agence encaisse via son propre compte PSP, la plateforme facture sa commission, aucune détention de fonds) et **P0-B** (la plateforme encaisse et reverse, seulement après avis juridique) ; chaque idée P0 est rattachée aux questions OQ-MK / OQ-PAY qui la conditionnent (§K.0) ; les affirmations surdéclarées sont corrigées (ACODECO, comparaison de prix, Yappy) ; géofencing, support 24/7 et livraison aéroport sortent du P0 sauf justification ; les coûts sont restatés en trois lignes (A) build assisté par IA, (B) tiers, (C) exploitation ; 10 idées manquantes sont ajoutées (§N, IMP-40 à IMP-49). Chaque changement est marqué « (corrigé VERIF_06-<ID>) ». Le backlog détaillé est `04_FEATURE_INVENTORY.csv` (colonne `phase_mvp`) et la feuille de route `18_MVP_AND_ROADMAP.md` ; en cas d'écart de phase, 04 et 18 font foi.
> **Révision VERIF_10 (2026-10-30)** : estimation alignée sur l'énoncé unique de 18 §5 (P0-A complet ≈ 21–42 semaines-équipe, Bêta pilote ≈ 8–14, P1 ≈ 35–76 au barème par ligne ; K.3) ; porte P0-A complétée par OQ-MK-02 lecture b, OQ-PAY-22/07, OQ-MK-09, OQ-BR-21 et OQ-BR-25 (K.0) ; formulations « preuve obligatoire » et « preuve opposable » corrigées (IMP-02, IMP-10) ; IMP-33 et IMP-34 alignées sur 04 (P2). Marques « (corrigé VERIF_10-<ID>) ».

## 0. Conventions

- **Tags « Comment Turo le traite »** : DIRECTEMENT TESTÉ / OBSERVÉ / DOCUMENTÉ / INFÉRÉ (repris des fichiers sources) ; « non vérifiable » quand la recherche ne permet pas de conclure.
- **Phases de lancement** (corrigé VERIF_06-V6-02) : **P0-A** = bêta fermée Panama pro-first où chaque agence encaisse elle-même par son compte PSP (Yappy compris) et la plateforme facture sa commission, sans détention de fonds ; **P0-B** = la plateforme encaisse, détient la caution et reverse, seulement après avis casa de remesas / PSP (OQ-MK-02, OQ-MK-03, OQ-PAY-04, OQ-PAY-05) ; « P0 » seul désigne l'ensemble P0-A + P0-B. Ancienne définition : **P0** = MVP Panama pro-first (jour 1) ; **P1** = 3 à 9 mois après le lancement (consolidation Panama, ouverture P2P si OQ-BR-35 et OQ-BR-16 sont levées) ; **P2** = lancement Paraguay et passage à l'échelle (12–18 mois) ; **P3** = optionnel ou conditionné à un feu vert juridique ou réglementaire.
- **Coûts (corrigé VERIF_06-V6-03)** : chaque fiche donne trois lignes. **(A) Build assisté par IA** en semaines-équipe : 1 semaine-équipe = une semaine d'une petite équipe de 2 développeurs full-stack travaillant avec Claude Code, plus ~0,5 ETP produit/QA ; fourchettes larges, issues de la complexité de la fiche et non d'un devis ; l'assistance IA accélère le code applicatif et les tests, pas les intégrations tierces (sandbox, certification PSP, approbation Meta), la revue humaine ni les textes juridiques. **(B) Coûts tiers** : liste des postes **à chiffrer par devis** (aucun prix n'est inventé). **(C) Coûts d'exploitation** : inducteurs (ETP, astreinte, volumes), non chiffrés. Les montants en USD de la version précédente (hypothèse « 1 semaine-ingénieur ≈ 2 000 USD, nearshore ») sont retirés : ils ne correspondaient pas au mode de développement prévu et n'étaient pas sourcés. L'IA réduit (A), pas (B) ni (C), qui seront probablement dominants en P0.
- **Dépendances** : IDs IMP-xx de ce fichier et questions ouvertes **OQ-BR-xx**, **OQ-MK-xx** et **OQ-PAY-xx** de `22_OPEN_QUESTIONS.md` ; les « portes » sont les questions dont la réponse conditionne le démarrage de l'idée (corrigé VERIF_06-V6-01).
- Les chiffres de marché sont cités avec leur fichier et leur section ; ils conservent le tag de leur source (CONFIRMÉ, DOCUMENTÉ-SECONDAIRE, INFÉRÉ).

## Sommaire

| Bloc | IDs |
|---|---|
| A. Paiements, prix et argent | IMP-01 à IMP-05 |
| B. Communication et support | IMP-06 à IMP-08 |
| C. Identité, check-in, contrat, conformité | IMP-09 à IMP-13 |
| D. Protection et assurance | IMP-14, IMP-15 |
| E. Antivol, fraude et télématique | IMP-16 à IMP-18 |
| F. Outils pros et flottes (offre de la phase 0) | IMP-19 à IMP-24 |
| G. Opérations terrain et litiges | IMP-25 à IMP-27 |
| H. Confiance, croissance et distribution | IMP-28 à IMP-32 |
| I. Segments et expérience | IMP-33 à IMP-35 |
| J. Ouverture P2P et extensions | IMP-36 à IMP-39 |
| Synthèse | §K.0 porte P0, §K classement, §K.3 coûts restatés, §L avantages concurrentiels, §M idées rejetées |
| N. Idées ajoutées après VERIF_06 | IMP-40 à IMP-49 |

---

## A. Paiements, prix et argent

### IMP-01 — Checkout aux moyens de paiement locaux (Yappy, Clave, ACH Xpress au Panama ; QR Bancard et portefeuilles au Paraguay)
**Statut : PROPOSÉ**

1. **Problème résolu** : au Panama, la carte de crédit est minoritaire (ordre de grandeur ~20 % des adultes, ~48 % carte de débit, microdonnées Findex non pondérées, DOCUMENTÉ-SECONDAIRE, 12 §2) ; la carte de débit locale **Clave** (> 2 M de cartes) est souvent refusée par les PSP internationaux ; **Yappy** a traité 487 M de transactions en 2024, dont **56 M de paiements marchands** seulement (431 M de P2P), et compte ~1,4–1,6 M d'utilisateurs (12 §2 ; corrigé VERIF_06-V6-15). Au Paraguay, le **QR représente 64 % des paiements électroniques** et il existe > 7,6 M de comptes de portefeuille électronique (13 §2). Un checkout « carte uniquement » exclut la majorité de la demande locale (50 % de clients locaux historiquement dans la location au Panama, 12 §1.4).
2. **Comment Turo le traite** : cartes Visa/MC/Amex/Discover, débit bancaire standard, Revolut seul prépayé accepté, Apple Pay / Google Pay avec carte de secours ; PayPal, Venmo et autres prépayés refusés ; une carte est toujours exigée, même si une carte cadeau couvre 100 % du montant (DOCUMENTÉ — SRC_G 2.6.7, 2.6.8).
3. **Solution proposée** :
   - *Flux* : à l'écran « Pagar », les moyens pertinents s'affichent d'abord selon le pays et le profil. Panama : carte internationale, carte Clave, Yappy (bouton « Pagar con Yappy » ou lien de paiement), virement ACH Xpress (référence unique ; virement plafonné à rapprochement manuel, **non vérifié comme rail d'encaissement**, retiré du P0 ; corrigé VERIF_06-V6-15). Paraguay : carte (Bancard vPOS ou dLocal), QR Bancard interopérable, Tigo Money / Billetera Personal via un agrégateur.
   - *Règles* : (a) le **loyer** peut être payé par tout moyen ; (b) la **caution** suit IMP-02 ; (c) les frais post-trip (carburant, péages, dommages) exigent soit une carte enregistrée, soit un dépôt (IMP-02) : un guest sans carte ne réserve pas sans dépôt ; (d) paiement non réversible (Yappy, QR, ACH) → choix du mode de remboursement **avant** de payer (IMP-03) ; (e) hold de 10 min sur le créneau pendant un paiement asynchrone, libéré automatiquement (BR-BOOK-10, EC-51) ; (f) routage multi-PSP avec bascule si un PSP tombe (EC-29).
   - *Données* : `PaymentMethod{type, rail, reversible, supportsPreauth, supportsMIT}`, `PaymentIntent{rail, status, expiresAt}`, table de routage par pays et par montant, rapprochement ACH par référence.
4. **Avantages** : ouvre la demande locale sans carte de crédit ; coûts d'encaissement plus faibles sur QR (plafond **1,5 % TTC** au Paraguay, CONFIRMÉ 13 §2) et Yappy (~1 % + ITBMS, source tierce, 12 §2) que sur carte (~3,5 % + 0,50 $ chez PagueloFacil, 12 §2) ; argument face aux loueurs internationaux.
5. **Complexité technique** : moyenne (multi-PSP, paiements asynchrones, rapprochement).
6. **Coût (corrigé VERIF_06-V6-03)** :
   - (A) Build assisté par IA (semaines-équipe) : 2–4 (P0-A : connecteur au compte PSP de chaque agence, Yappy, webhooks, repli par lien de paiement) ; +1–2 en P0-B ; +1,5–3 pour le Paraguay (P2).
   - (B) Tiers, à chiffrer par devis : contrats PSP (Tilopay en primaire, dLocal ou BAC en secours) : commissions par rail, frais fixes, frais Yappy ; certification sandbox.
   - (C) Exploitation, inducteurs : rapprochement des statuts de paiement avec les agences, support paiement.
7. **Impact potentiel** : **fort** sur le taux de conversion du checkout et la part de demande locale.
8. **Lancement** : **P0-A** au Panama : cartes + Yappy (et Clave si le PSP la confirme) **sur le compte PSP de l'agence**, la plateforme ne touchant pas les fonds (04 PAY-004, PAY-033, PAY-034) ; ACH Xpress retiré du P0 ; **P0-B** : même checkout sur un compte de la plateforme, après avis ; **P2** pour les rails paraguayens (corrigé VERIF_06-V6-02).
- **Risque** : moyen (statut juridique de l'encaissement pour compte de tiers : casa de remesas au Panama, PSP au Paraguay) ; **Pertinence locale** : les deux.
- **Dépendances** : OQ-BR-12 (a)(b)(c) **P0** ; IMP-02, IMP-03, IMP-04 ; **portes** : P0-A : OQ-MK-01, OQ-MK-07, OQ-PAY-03, OQ-PAY-07, OQ-PAY-13, OQ-PAY-22 ; P0-B : OQ-MK-02, OQ-MK-03, OQ-PAY-04, OQ-PAY-05 (corrigé VERIF_06-V6-01).

### IMP-02 — Caution sans carte de crédit : dépôt restituable, caution modulée selon la confiance, option « caution-assurance »
**Statut : PROPOSÉ**

1. **Problème résolu** : la caution sur carte de crédit est le principal frein pour une clientèle peu équipée en cartes (12 §2, 13 §2) ; la pré-autorisation sur cartes de débit locales **n'est pas validée** (OQ-BR-12a) ; un loueur local se distingue déjà avec « sans dépôt ni carte de crédit » (Arrendadora Económica, 12 §1.5) ; un précédent de 2018, rapporté par une colonne d'opinion, décrit un débit de caution non justifié rétrocédé après plainte à ACODECO (12 §3.7 ; aucun texte contraignant trouvé ; corrigé VERIF_06-V6-05). Le cas EC-27 (carte refusée pour la caution) n'est pas documenté chez Turo (11 §H).
2. **Comment Turo le traite** : dépôt de 200 à 750 $ selon la classe, l'âge, la zone ou le « système de sécurité » ; remboursement automatique **80 h** après la fin ; un trip avec dépôt est inéligible au BNPL (DOCUMENTÉ — SRC_G 2.5.1–2.5.4). Aucun dépôt hors carte (INFÉRÉ, absence dans SRC_G).
3. **Solution proposée** :
   - *Trois modes de garantie* selon l'éligibilité : (1) **pré-autorisation carte** (si supportée) ; (2) **dépôt restituable** payé par Yappy, ACH ou QR, conservé sur un compte séparé et restitué par virement au compte vérifié du guest (IMP-03) ; (3) **caution-assurance** (« fianza ») : prime non remboursable de quelques dollars par jour couvrant la franchise, portée par l'assureur partenaire (IMP-14), à valider.
   - *Montant modulé* : `deposit = base(classe) × multiplicateur(risque)` ; le multiplicateur baisse avec l'historique (IMP-28 : trips réussis sans incident) et monte pour les pick-ups/4x4, les zones frontalières et les comptes récents (IMP-18).
   - *Restitution* : délai cible **72 h** après le check-out sans incident (contre 80 h chez Turo), affiché dès le checkout ; toute retenue exige un dossier de preuves (photos IMP-10, devis) consultable par le guest (bonne pratique de preuve motivée par le précédent de 2018, pas une exigence identifiée ; corrigé VERIF_06-V6-05).
   - *Données* : `Deposit{mode, amount, rail, heldAt, releaseAt, status, evidenceIds[]}`, ledger séparé pour les fonds de tiers.
4. **Avantages** : location accessible sans carte de crédit ; moins de litiges ACODECO/SEDECO grâce aux preuves documentées de chaque retenue (pratique recommandée, pas une exigence identifiée ; corrigé VERIF_10-V10-14) ; la caution modulée récompense les bons clients.
5. **Complexité technique** : moyenne.
6. **Coût (corrigé VERIF_06-V6-03)** :
   - (A) Build assisté par IA (semaines-équipe) : 0,25–0,5 en P0-A (politique de caution déclarée) ; 2–3 en P0-B (dépôt, rétention, ré-autorisation).
   - (B) Tiers, à chiffrer par devis : PSP (pré-autorisation, frais non restitués en débit puis remboursement) ; assureur pour la caution-assurance ; avis juridique OQ-PAY-06.
   - (C) Exploitation, inducteurs : revue des retenues, litiges de caution, capital immobilisé (P0-B).
7. **Impact potentiel** : **fort** sur la conversion locale et le taux de litiges sur les cautions.
8. **Lancement** : **P0-A** : la caution est prise et restituée par l'agence selon une politique déclarée et affichée, y compris sans carte de crédit (04 PAY-035) ; **P0-B** : dépôt détenu par la plateforme et pré-autorisation limitée aux trips d'environ 3 jours au plus avec un PSP à 7 jours (rétention = durée du trip + 4 j, VERIF_08 V8-01 ; 04 PAY-011, PAY-036) ; **P1** : caution modulée et caution-assurance (04 PAY-039). Risque recalé à 5 tant que l'avis remesas manque (corrigé VERIF_06-V6-02).
- **Risque** : élevé (détention de fonds de tiers = question de licence ; impayés au-delà du dépôt pour des guests sans carte) ; **Pertinence locale** : les deux.
- **Dépendances** : OQ-BR-12 (b)(c), OQ-BR-16, OQ-BR-24 ; IMP-01, IMP-03, IMP-10, IMP-14, IMP-18, IMP-28 ; **portes** : P0-A : OQ-PAY-06 ; P0-B : OQ-MK-02, OQ-PAY-02, OQ-PAY-05, OQ-PAY-13 et règles réseaux (VERIF_08 V8-01, V8-03) (corrigé VERIF_06-V6-01).

### IMP-03 — Moteur de remboursement multi-rails (crédit immédiat ou virement vers un compte vérifié)
**Statut : PROPOSÉ**

1. **Problème résolu** : Yappy, QR et ACH ne sont pas réversibles comme une carte ; un remboursement partiel d'annulation (EC-49) ou une restitution de dépôt (IMP-02) exige un virement sortant et la collecte de coordonnées bancaires, source de fraude et de délais (11 EC-49).
2. **Comment Turo le traite** : NON APPLICABLE — Turo n'accepte que des moyens réversibles ; à défaut, crédit voyage (DOCUMENTÉ — 11 EC-49) ; délais bancaires de 3 à 10 jours ouvrés, Turo ne voit plus le statut une fois émis (DOCUMENTÉ — SRC_G 2.6.9).
3. **Solution proposée** :
   - *Flux* : en payant par un rail non réversible, le guest choisit « Si hay reembolso : crédito inmediato (+5 % de bonus) / transferencia a mi cuenta » ; pour un virement, il saisit un compte à son nom, vérifié par micro-virement ou par le PSP (nom du titulaire = nom KYC).
   - *Règles* : virement ACH Xpress (PA, ≤ 5 000 $ par transaction) ou SIPAP (PY) sous **2 jours ouvrés** (11 EC-49) ; statut visible dans le reçu (« emitido / acreditado ») ; montants PYG sans décimales (EC-32) ; le compte de remboursement n'est pas modifiable dans les 24 h précédant un remboursement (anti-détournement).
   - *Données* : `RefundInstruction{method, accountId, verifiedAt}`, `Refund{rail, amount, currency, status, externalRef}`.
4. **Avantages** : un cas non géré par Turo devient une expérience claire ; moins de tickets « ¿dónde está mi reembolso? » ; le bonus de crédit garde l'argent dans la plateforme.
5. **Complexité technique** : faible à moyenne.
6. **Coût (corrigé VERIF_06-V6-03)** :
   - (A) Build assisté par IA (semaines-équipe) : 1–2 (P0-B / P1).
   - (B) Tiers, à chiffrer par devis : frais de virement banque ou PSP.
   - (C) Exploitation, inducteurs : support des remboursements, contrôle de la titularité des comptes.
7. **Impact potentiel** : moyen (satisfaction, coût du support, fraude au remboursement).
8. **Lancement** : **P0-B**, seulement si la plateforme encaisse des paiements non réversibles ; en P0-A, l'agence rembourse un paiement Yappy par virement avec preuve (04 PAY-021) ; flux repris de 11 EC-49, paramètres « +5 % de bonus » et « compte non modifiable 24 h » à tester ; P1 pour le moteur complet (04 PAY-040) (corrigé VERIF_06-V6-02, V6-16).
- **Risque** : faible ; **Pertinence locale** : les deux.
- **Dépendances** : IMP-01, IMP-04 (mêmes rails de virement) ; OQ-BR-12 (d) ; **portes** : P0-B : OQ-MK-02, OQ-PAY-06, OQ-PAY-07 (corrigé VERIF_06-V6-01).

### IMP-04 — Versements rapides aux loueurs et hôtes sur rails locaux, avec calendrier lisible
**Statut : PROPOSÉ**

1. **Problème résolu** : les loueurs (offre de la phase 0) gèrent leur trésorerie au jour le jour. Stripe n'existe pas pour une entité locale, mais des rails existent : Stripe Global Payouts depuis une entité US/UK vers des particuliers et sociétés au Panama (CONFIRMÉ, 12 §2, §9.3), dLocal, Localpayment (ACH T+0), ACH Xpress plafonné à **5 000 $ par transaction et 1–2 transactions par jour selon la banque** (12 §2). Au Paraguay, ni Stripe ni Global Payouts : dLocal ou compte local + SIPAP (CONFIRMÉ, 13 §9.3).
2. **Comment Turo le traite** : virement bancaire via Stripe uniquement ; 1er versement ≈ 3 jours ouvrés après le trip, puis 3 h ; partiels tous les 7 jours au-delà d'une semaine ; 3–5 jours ouvrés côté banque ; premier versement possible après **14 jours** ; versements suspendus si Stripe re-vérifie (DOCUMENTÉ — SRC_H 5.1).
3. **Solution proposée** :
   - *Règles* : versement initié **J+1 ouvré** après le check-out (J+0 pour les loueurs au statut « Agencia verificada », IMP-28) ; découpage automatique en tranches ≤ 5 000 $ ou bascule vers ACH Directo (12 §2) ; versements partiels hebdomadaires pour les trips de plus de 7 jours (comme Turo) ; regroupement quotidien par loueur ; USD au Panama, PYG ou USD au Paraguay.
   - *Écran « Mis pagos »* : calendrier prévisionnel, statut par versement (programado / enviado / acreditado), retenues expliquées ligne par ligne (dommage en cours, facture annexe), export CSV et rapprochement avec la facture électronique (IMP-13).
   - *Données* : `Payout{rail, amount, currency, scheduledAt, sentAt, externalRef, splitIndex}`, `PayoutAccount{holderName, taxId, bank, verifiedAt}`.
4. **Avantages** : argument commercial n°1 auprès des petits loueurs (trésorerie) ; frais de virement locaux plus faibles qu'un virement international.
5. **Complexité technique** : moyenne.
6. **Coût (corrigé VERIF_06-V6-03)** :
   - (A) Build assisté par IA (semaines-équipe) : 1,5–3 (P0-B).
   - (B) Tiers, à chiffrer par devis : PSP de payouts (dLocal, Localpayment) ou banque ; avis remesas / MTL.
   - (C) Exploitation, inducteurs : KYC des bénéficiaires, rapprochement quotidien, trésorerie.
7. **Impact potentiel** : **fort** sur l'acquisition et la rétention des loueurs.
8. **Lancement** : **P0-B** : aucun versement en P0-A, l'agence est payée directement par son PSP ; versements J+2 seulement après avis remesas / MTL (04 PYO-001, PYO-002, PYO-007). Risque recalé à 5 tant que l'avis manque (score 3,60 au lieu de 3,90) (corrigé VERIF_06-V6-02).
- **Risque** : moyen (qualification casa de remesas au Panama, PSP au Paraguay) ; **Pertinence locale** : les deux.
- **Dépendances** : OQ-BR-12 (c), OQ-BR-14 ; IMP-13, IMP-19 ; **portes** : P0-B : OQ-MK-02, OQ-MK-03, OQ-PAY-04, OQ-PAY-05, OQ-PAY-14 (corrigé VERIF_06-V6-01).

### IMP-05 — Prix « tout compris » transparent en USD et en PYG (protection minimale, taxes et frais inclus)
**Statut : PROPOSÉ**

1. **Problème résolu** : au Panama, les agrégateurs affichent des prix d'appel « dès 5–9 $/j » **hors assurance obligatoire** (prix minimal Kayak) ; le prix au comptoir de 35–55 $/j TTC assurance incluse est **INFÉRÉ, à vérifier par mystery shopping** (12 §1.4), et les mêmes sources donnent un SUV moyen ≈ 30 $/j sur Kayak et 19,95–47,57 $/j TTC assurance incluse dans une enquête ACODECO de 2018. Ces chiffres ne sont pas comparables : **l'écart entre prix d'appel et prix final n'est pas mesuré** et l'« opacité » reste une hypothèse ; mystery shopping de 10 loueurs à faire avant de bâtir le message ; potentiel ramené de 5 à 4 tant que l'écart n'est pas mesuré (corrigé VERIF_06-V6-06). Au Paraguay, le PYG sans décimales et ses gros montants rendent les prix illisibles pour les étrangers (13 §2, EC-32).
2. **Comment Turo le traite** : prix journalier + trip fee de 23,6 % du net **mesuré sur un seul trajet** (DIRECTEMENT TESTÉ, 1 point — 09 §3) ; fourchette ≈ 22–24 % et non-linéarité **INFÉRÉES** de ce seul véhicule (A24-07), formule non publiée ; frais jeune conducteur au barème non publié (OQ-BR-08) ; protection en sus ; taxes en fin de parcours (DIRECTEMENT TESTÉ — 05 G-BOOK-02/06). La livraison aéroport est incluse dans le prix affiché en recherche (« all-in pricing », DOCUMENTÉ — 06 H-AIRPORT).
3. **Solution proposée** :
   - *Règle d'affichage* : prix affiché en recherche et sur la fiche = **loyer + frais de service + protection minimale obligatoire + taxes (ITBMS 7 % au PA, IVA 10 % au PY, à valider OQ-BR-14)** pour les dates saisies ; seules les options (protection supérieure, extras, livraison choisie) s'ajoutent, chacune avec son prix visible.
   - *Frais de service publiés* : barème simple et public (pourcentage fixe par tranche de durée) ; pas de frais opaques « fondés sur le risque » côté guest au lancement : un score de risque (IMP-18) peut augmenter la **caution**, jamais un prix caché.
   - *Devise* : USD au Panama ; PYG sans décimale au Paraguay, avec équivalent USD indicatif (taux du jour, mention « referencial ») ; arrondi d'affichage au palier de 1 000 PYG (règle exacte dans EC-32).
   - *Message* : badge « Precio final, sin sorpresas en el mostrador » et détail déroulant ligne par ligne.
4. **Avantages** : différenciation nette face aux loueurs et aux agrégateurs (14 §c.3) ; moins d'abandons au checkout et de plaintes ACODECO/SEDECO.
5. **Complexité technique** : faible (moteur de prix existant, formule 09 §3).
6. **Coût (corrigé VERIF_06-V6-03)** :
   - (A) Build assisté par IA (semaines-équipe) : 0,5–1.
   - (B) Tiers, à chiffrer par devis : mystery shopping (prestataire ou interne).
   - (C) Exploitation, inducteurs : mise à jour des taux, contrôle des grilles des agences.
7. **Impact potentiel** : **fort** sur la conversion recherche → réservation et sur la confiance.
8. **Lancement** : **P0-A** pour le total TTC (taxes et frais compris) dès la recherche (04 SRC-042), sans frais de service guest en P0-A (04 PRC-012 relève du P0-B) ; prix « tout compris » avec protection minimale en **P1**, après mystery shopping (04 PRC-026) (corrigé VERIF_06-V6-06).
- **Risque** : faible (le prix d'appel paraît plus élevé que chez les agrégateurs ; le message « prix final » doit compenser) ; **Pertinence locale** : les deux.
- **Dépendances** : OQ-BR-14 (taxes), OQ-BR-09 et OQ-BR-16 (coût de la protection minimale) ; IMP-14 ; **portes** : P0-A : OQ-MK-06, OQ-BR-14 ; P1 : OQ-BR-16 (corrigé VERIF_06-V6-01).

---

## B. Communication et support

### IMP-06 — WhatsApp comme canal transactionnel (notifications, codes de vérification, rappels)
**Statut : PROPOSÉ**

1. **Problème résolu** : les touristes en itinérance ne reçoivent pas toujours les SMS ; l'assistance routière locale passe déjà par WhatsApp (ASSA Móvil 24/7 par téléphone et WhatsApp, 12 §4) ; la recherche recommande un service « WhatsApp-first » au Paraguay (13 §5.9) ; le marché informel (Encuentra24, Facebook, TikTok, WhatsApp) vit sur WhatsApp (12 §1.5, 14 §a.1). *Limite* : aucun chiffre de pénétration de WhatsApp n'a été relevé dans la recherche.
2. **Comment Turo le traite** : notifications push, SMS (opt-in) et email ; vérification du téléphone par short code ; **les apps de texto virtuelles ne sont pas supportées et la réception en roaming n'est pas garantie** (DOCUMENTÉ — SRC_G 1.4.6, 10.9).
3. **Solution proposée** :
   - *Canal* : WhatsApp Business Platform (via un fournisseur BSP) pour les **modèles de messages** transactionnels approuvés : confirmation, rappels J−1 et H−2, instructions de retrait, code de remise des clés, alerte de retard, facture annexe, géofence (IMP-16), restitution de dépôt ; code de vérification par WhatsApp en alternative au SMS.
   - *Règles* : opt-in explicite au checkout (Ley 81/2019 au PA, Ley 7593/2025 au PY) ; langue = langue du profil (ES/EN/PT) ; tout message critique (sécurité, non-restitution) est doublé par SMS et email ; aucune pièce d'identité dans WhatsApp (Turo interdit déjà les photos d'identité en messagerie, SRC_G 6.1.1) ; chaque message est journalisé dans le dossier du trip (preuve).
   - *Données* : `NotificationEvent` (catalogue BR-NOTIF, 38 événements dans 08), `ChannelPreference`, `TemplateId`, `DeliveryStatus`.
4. **Avantages** : meilleur taux de lecture que l'email (INFÉRÉ) ; fonctionne en roaming via les données ou le Wi-Fi ; moins de no-shows et de retards.
5. **Complexité technique** : faible.
6. **Coût (corrigé VERIF_06-V6-03)** :
   - (A) Build assisté par IA (semaines-équipe) : 0,5–1.
   - (B) Tiers, à chiffrer par devis : BSP WhatsApp (abonnement) et tarification Meta par message ; SMS de repli.
   - (C) Exploitation, inducteurs : validation des gabarits, suivi des échecs d'envoi.
7. **Impact potentiel** : moyen à fort sur le taux de no-show, la ponctualité du check-in et le volume de tickets.
8. **Lancement** : **P0-A** : coût faible et effet immédiat (04 NTF-001, NTF-002, VER-013).
- **Risque** : faible (dépendance à Meta et à ses tarifs) ; **Pertinence locale** : les deux.
- **Dépendances** : OQ-BR-25 (rétention des données) ; IMP-07, IMP-16 ; **portes** : aucune OQ-MK / OQ-PAY bloquante ; OQ-BR-25 (corrigé VERIF_06-V6-01).

### IMP-07 — Support WhatsApp-first multilingue (ES/EN au lancement, PT ensuite, guaraní à l'oral), triage IA et humain garanti
**Statut : PROPOSÉ**

1. **Problème résolu** : l'espagnol est obligatoire (contrats, ACODECO, police) et l'anglais indispensable : 28,4 % des visiteurs via Tocumen viennent d'Amérique du Nord, dont 494 685 Américains en 2025 (CONFIRMÉ, 12 §1.2). Au Paraguay, le guaraní (parlé par la majorité, utile au téléphone et sur WhatsApp) et le portugais comptent : 60 % des résidences accordées en 2024 l'ont été à des Brésiliens (13 §1.4), 10 % des visiteurs sont brésiliens (13 §1.3) (13 §4.8).
2. **Comment Turo le traite** : bouton « Get help » qui ouvre d'abord un **assistant IA**, puis un agent sur demande ; chats séparés pour la vérification et la facturation ; revues standard en 48 h ; conseil de ne contacter le support qu'**une fois** (les relances retardent) ; support 24/7 aux US, au Canada et en Australie (DOCUMENTÉ — SRC_G 8.7, 8.8 ; SRC_H 9.1). WhatsApp non documenté.
3. **Solution proposée** :
   - *Flux* : un numéro WhatsApp par pays ; l'assistant IA identifie le trip (téléphone vérifié) et répond aux questions fréquentes (horaires, lieu, carburant, extension) ; il **escalade vers un humain en moins de 15 min pour « urgence », « accident », « vol » et « véhicule absent »** (cible P1 ; en P0-A, ces catégories sont routées vers l'assistance de l'assureur et l'urgence de l'agence hors horaires, corrigé VERIF_06-V6-08) : ces catégories ne sont jamais traitées par l'IA seule.
   - *Règles* : SLA affichés (urgence < 15 min 24/7 ; standard < 4 h de 7 h à 22 h) ; transcription versée au dossier ; passage en appel vocal en un clic ; guaraní traité à l'oral par des agents bilingues (pas d'interface écrite en guaraní, voir §M) ; portugais en P2.
   - *Données* : `SupportCase{tripId, channel, category, language, slaDueAt, escalatedAt}`.
4. **Avantages** : réponse dans le canal que les clients utilisent déjà ; différenciation forte face aux loueurs (comptoir) et à Turo (absent de la région).
5. **Complexité technique** : moyenne (helpdesk + LLM + WhatsApp).
6. **Coût (corrigé VERIF_06-V6-03)** :
   - (A) Build assisté par IA (semaines-équipe) : 0,5–1 en P0-A « lite » ; 1–2 en P1 (triage IA, outil de support).
   - (B) Tiers, à chiffrer par devis : outil de helpdesk, LLM, téléphonie, prestataire d'astreinte (P1).
   - (C) Exploitation, inducteurs : ETP de support par plage horaire : premier poste d'exploitation ; 24/7 humain en P1 seulement.
7. **Impact potentiel** : **fort** sur le NPS, la résolution au premier contact et le coût par ticket.
8. **Lancement** : **P0-A « lite »** : ligne d'urgence routée vers l'assistance de l'assureur ou du loueur, support humain es/en en horaires étendus (04 SUP-004, SUP-011) ; **P1** : 24/7 humain et triage IA selon les volumes réels ; portugais et guaraní oral en **P2** (corrigé VERIF_06-V6-08).
- **Risque** : faible à moyen (réponse IA erronée sur un point contractuel : limiter l'IA à une base de réponses validée) ; **Pertinence locale** : les deux.
- **Dépendances** : IMP-06 ; OQ-BR-22 (SLA sinistres) ; **portes** : P0-A : OQ-MK-05 (assistance incluse dans la police flotte ?) (corrigé VERIF_06-V6-01).

### IMP-08 — Relais de messagerie masqué entre hôte et guest avant réservation (questions encadrées, anti-marché gris)
**Statut : PROPOSÉ**

1. **Problème résolu** : en LATAM, on négocie par WhatsApp avant de s'engager (marché informel, 12 §1.5, 14 §a.1) ; si la plateforme interdit tout contact, les clients cherchent le numéro de l'agence et contournent la commission (EC-40). Les loueurs pros ont déjà leur WhatsApp commercial.
2. **Comment Turo le traite** : messagerie disponible **seulement après réservation** ; coordonnées révélées après réservation ; paiement hors plateforme interdit, dommages forfaitaires jusqu'à 5 500 $ (DOCUMENTÉ — SRC_G 8.6, 7.17 ; 10 §4).
3. **Solution proposée** :
   - *Flux* : bouton « Preguntar al anfitrión » sur la fiche ; questions envoyées via la plateforme (in-app ou relais WhatsApp avec numéro masqué) ; réponses de l'hôte dans le même fil.
   - *Règles* : détection et masquage automatiques des numéros, emails, liens et coordonnées bancaires avant réservation ; questions types pré-remplies (siège enfant, frontière, 4x4, lieu de retrait) ; un hôte dont les tentatives de contournement dépassent un seuil perd de la visibilité (BR-TRUST-02) ; temps de réponse affiché sur la fiche.
   - *Données* : `PreBookingThread{listingId, guestId, messages[], redactions[]}`.
4. **Avantages** : répond au besoin culturel de « parler avant de payer » sans perdre la transaction ; le temps de réponse devient un signal de qualité.
5. **Complexité technique** : moyenne (masquage fiable, relais WhatsApp).
6. **Coût (corrigé VERIF_06-V6-03)** :
   - (A) Build assisté par IA (semaines-équipe) : 1–1,5 (P1).
   - (B) Tiers, à chiffrer par devis : messages Meta.
   - (C) Exploitation, inducteurs : modération des signalements.
7. **Impact potentiel** : moyen sur la conversion et sur la fuite de transactions hors plateforme.
8. **Lancement** : **P1** : au lancement, les loueurs pros liés par un contrat-cadre ont moins intérêt à contourner ; le besoin augmente avec le P2P.
- **Risque** : moyen (contournements détournés, charge de modération) ; **Pertinence locale** : les deux.
- **Dépendances** : IMP-06, IMP-07 ; OQ-BR-24 (validité des clauses pénales).

---

## C. Identité, check-in, contrat, conformité

### IMP-09 — Vérification d'identité et de permis « par statut », avant le paiement (cédula PA/PY, cédula E, passeport + date d'entrée, permis ATTT art. 111, Mercosur, IDP)
**Statut : PROPOSÉ**

1. **Problème résolu** : au Panama, un **touriste** conduit avec son permis étranger pendant **90 jours non prorogeables** (art. 110, CONFIRMÉ) ; un **résident** doit avoir un permis panaméen (art. 109) ; un étranger avec **permis spécial de séjour**, dont vraisemblablement le visa nomade DE 198/2021, ne peut conduire **qu'avec un permis de l'ATTT** (art. 111, DOCUMENTÉ-SECONDAIRE / À VALIDER) (12 §3.4, §1.3). Au Paraguay : reconnaissance Mercosur, accords bilatéraux (Chili, Colombie, Espagne), **IDP pour les autres** (13 §3.5). Cas EC-50 (dépassement des 90 jours) et EC-43 (identité frauduleuse) ; au Panama, ~20 M$ de fraudes bancaires confirmées en 2025 (12 §2).
2. **Comment Turo le traite** : photos du permis + selfie + comparaison faciale par un prestataire (biométrie, conservation 3 ans au plus) ; contrôles de crédit et de casier (US) ; screening à chaque réservation ; checklist **après** la réservation, sinon annulation 2 h avant le départ ; revue en 24–48 h ; l'IDP seul est refusé (DOCUMENTÉ — SRC_G 1.4.1–1.4.5 ; 10 §5 ; SRC_H 6). Aucune règle de statut migratoire (NON APPLICABLE, 11 EC-50).
3. **Solution proposée** :
   - *Flux* « Verifícate una vez », à la création du compte ou au plus tard **avant le paiement** : pays de résidence → pièce d'identité (cédula panaméenne, cédula E, cédula paraguaya, passeport) → permis recto/verso → selfie avec détection du vivant + comparaison faciale → au Panama, question de statut : *turista* (date d'entrée, photo du tampon) / *visa especial o nómada* (permis ATTT exigé) / *residente* (permis panaméen exigé).
   - *Règles* : (a) touriste PA : `fin_trip ≤ date_entrée + 90 j`, sinon refus avec proposition de la date maximale (critère d'acceptation d'EC-50) ; (b) résident ou titulaire d'un visa spécial avec permis étranger seul → refus ; (c) PY : permis Mercosur ou d'un pays à accord bilatéral accepté ; autres : IDP + permis national ; (d) 21 ans minimum au lancement (pratique des loueurs, 12 §3.4, 13 §3.5) ; (e) approbation réutilisable 12 mois, nouveau contrôle si un document expire ; (f) l'hôte ne collecte jamais les pièces (BR-VERIF-10) et ne voit que « Verificado ✓ ».
   - *Données* : `IdentityDocument{type, country, numberHash, expiresAt}`, `License{country, class, expiresAt, idpRequired}`, `ImmigrationStatus{type, entryDate, evidenceId}`, `VerificationDecision{level, reasons[], validUntil}` ; consentement biométrique explicite.
4. **Avantages** : la conformité art. 110/111 devient un argument (les loueurs ne la contrôlent pas forcément, INFÉRÉ) ; moins d'annulations tardives que le modèle Turo (vérification après paiement) ; socle du score de risque (IMP-18).
5. **Complexité technique** : moyenne (fournisseur KYC + moteur de règles).
6. **Coût (corrigé VERIF_06-V6-03)** :
   - (A) Build assisté par IA (semaines-équipe) : 1,5–2,5.
   - (B) Tiers, à chiffrer par devis : fournisseur KYC / liveness (par vérification), stockage chiffré ; avis OQ-BR-21.
   - (C) Exploitation, inducteurs : revue manuelle des cas signalés.
7. **Impact potentiel** : **fort** sur la fraude, la conformité et le taux d'annulation tardive.
8. **Lancement** : **P0-A** en mode signalement : collecte du statut et de la date d'entrée, revue manuelle si risque, pas de refus automatique avant l'avis (04 VER-007, ADM-029) ; refus automatique après l'avis OQ-BR-21, remontée en P0 dans 22 (corrigé VERIF_10-V10-09) (condition 4 de 12 §10.3) (corrigé VERIF_06-V6-13).
- **Risque** : moyen (qualification exacte du visa nomade ; acceptation pratique de l'IDP ; biométrie sous Ley 81/2019 et Ley 7593/2025) ; **Pertinence locale** : les deux (règles différentes).
- **Dépendances** : OQ-BR-21 (permis étrangers), OQ-BR-25 (rétention KYC), OQ-BR-01 (seuils d'âge) ; IMP-18, IMP-33 ; **portes** : P0-A : OQ-BR-21 (P0 dans 22, corrigé VERIF_10-V10-09), OQ-BR-25 (corrigé VERIF_06-V6-01).

### IMP-10 — Check-in et check-out guidés, horodatés et utilisables hors ligne (photos, carburant, kilométrage, remise des clés)
**Statut : PROPOSÉ**

1. **Problème résolu** : un précédent de 2018 (colonne d'opinion, 12 §3.7) montre qu'un débit de caution sans preuve documentée peut être contesté devant ACODECO ; aucune exigence réglementaire n'a été trouvée, la preuve sert surtout face à l'assureur et dans les litiges (corrigé VERIF_06-V6-05) ; 53 132 accidents en 2025 au Panama (CONFIRMÉ, 12 §4) et ~52 % de routes non revêtues (CONFIRMÉ) multiplient les petits dommages à départager ; le vol de clés est un mode opératoire documenté (12 §4) ; les lieux de retrait (parkings souterrains, intérieur du pays) peuvent avoir une connexion faible (INFÉRÉ, non mesuré dans la recherche).
2. **Comment Turo le traite** : check-in ouvert 24 h avant ; photo du permis et selfie ; au moins **15 photos extérieures et 8 intérieures** + carburant + compteur, avec métadonnées date, heure et géolocalisation ; fenêtres de 24 h pour téléverser ; clé physique obligatoire ; lockbox à code changé à chaque trip ; cachettes interdites (DOCUMENTÉ — SRC_G 6.1.1–6.1.3, 6.2.2 ; SRC_H 6).
3. **Solution proposée** :
   - *Flux* : assistant photo avec gabarit de cadrage par angle (12 angles extérieurs + 6 intérieurs obligatoires, contre 15 + 8 chez Turo : nombre à justifier sur le pilote (corrigé VERIF_06-V6-17), tableau de bord pour carburant et kilométrage, vidéo 360° optionnelle) ; validation conjointe par l'hôte et le guest sur le même écran (double signature, IMP-12), ou état des lieux unilatéral horodaté si la remise se fait sans contact.
   - *Hors ligne* : les photos sont prises dans l'app avec horodatage et GPS de l'appareil, **hachées (SHA-256) et signées localement** à la prise, puis synchronisées au retour du réseau ; l'empreinte calculée à la réception prouve l'intégrité depuis la réception par le serveur, pas l'absence de retouche avant l'envoi (signature locale sans attestation d'appareil ; corrigé VERIF_06-V6-17).
   - *Remise des clés* : « mostrador » du loueur ; « en mano » avec code de confirmation à 6 chiffres envoyé au guest (IMP-06) et saisi par l'hôte ; lockbox à code unique libéré après vérification ; lockbox interdite par défaut pour les véhicules à risque (pick-ups/4x4).
   - *Données* : `Inspection{phase, photos[]{angle, hash, takenAt, gps}, fuelLevel, odometer, signatures[]}`.
4. **Avantages** : preuve horodatée et documentée, utile face à l'assureur, dans les plaintes ACODECO/SEDECO et devant le juge de transit (force probante non établie, pratique recommandée ; corrigé VERIF_10-V10-14) ; base de l'IA de dommages (IMP-11) ; remise plus rapide au comptoir des loueurs.
5. **Complexité technique** : moyenne (capture hors ligne, intégrité).
6. **Coût (corrigé VERIF_06-V6-03)** :
   - (A) Build assisté par IA (semaines-équipe) : 2–3.
   - (B) Tiers, à chiffrer par devis : stockage et diffusion des photos.
   - (C) Exploitation, inducteurs : formation des agents de comptoir, revue des écarts d'horodatage.
7. **Impact potentiel** : **fort** sur le taux de litiges, le délai de résolution des sinistres et le taux de restitution des dépôts.
8. **Lancement** : **P0-A** : prérequis de tout dommage facturable (04 TRP-002, TRP-004, TRP-052, CLM-034).
- **Risque** : faible ; **Pertinence locale** : les deux.
- **Dépendances** : IMP-12, IMP-06 ; OQ-BR-25 (rétention des photos) ; **portes** : P0-A : OQ-MK-05 (exigences de preuve de l'assureur), OQ-BR-25 (corrigé VERIF_06-V6-01).

### IMP-11 — Inspection de dommages assistée par IA (comparaison avant/après)
**Statut : PROPOSÉ**

1. **Problème résolu** : chez Turo, l'éligibilité d'un sinistre prend jusqu'à 3 jours ouvrés, suivie d'une expertise photo (< 1 jour) ou sur place (5–7 jours), avec des frais de traitement jusqu'à 575 $ (DOCUMENTÉ — SRC_G 7.8) ; les dommages contestés (EC-41) et les débits indus (12 §3.7) sont les litiges les plus coûteux. Avec ~5 accidents déclarés pour 100 véhicules par an au Panama (INFÉRÉ, 12 §4), le volume de petits dommages sera élevé.
2. **Comment Turo le traite** : expertise photo par un **expert tiers** ; métadonnées photo obligatoires ; dommage préexistant : différence entre devis avant et après ; pénalités pour fausse déclaration (DOCUMENTÉ — SRC_H 5.4). Recours à une IA de détection : non vérifiable.
3. **Solution proposée** :
   - *Flux* : au check-out, l'app compare chaque angle aux photos du check-in (IMP-10) et encadre les **différences candidates** (rayure, bosse, jante, pare-brise) ; le guest voit aussitôt « posible daño nuevo detectado » et peut commenter ou contester sur place ; l'hôte confirme ou rejette.
   - *Règles* : l'IA **ne facture jamais seule** ; elle pré-qualifie et estime la gravité (mineur / à expertiser) ; facturation seulement après validation humaine et devis (IMP-27) ; seuil de confiance réglable ; jeu d'entraînement issu des dossiers validés (anonymisés).
   - *Données* : `DamageCandidate{angle, bbox, confidence, status}`, liée à `Inspection` et `Claim`.
4. **Avantages** : détection sur place, avant le départ du guest (moins de « ce n'était pas moi ») ; instruction plus courte ; moins de frais d'expertise.
5. **Complexité technique** : élevée en interne ; moyenne avec un fournisseur d'API spécialisé.
6. **Coût (corrigé VERIF_06-V6-03)** :
   - (A) Build assisté par IA (semaines-équipe) : 2–4 (P1/P2).
   - (B) Tiers, à chiffrer par devis : licence d'inspection par IA.
   - (C) Exploitation, inducteurs : revue humaine des alertes.
7. **Impact potentiel** : moyen (délai et coût des sinistres, litiges) ; fort à l'échelle.
8. **Lancement** : **P1** : exige la capture standardisée d'IMP-10 et un volume minimal ; IMP-10 suffit au P0.
- **Risque** : moyen (faux positifs, dépendance fournisseur, images de tiers) ; **Pertinence locale** : les deux.
- **Dépendances** : IMP-10, IMP-27 ; OQ-BR-23 (frais de traitement).

### IMP-12 — Contrat de location numérique bilingue signé électroniquement (Ley 51/2008 au PA, Ley 6822/2021 au PY), avec « constancia de arrendamiento » en PDF
**Statut : PROPOSÉ**

1. **Problème résolu** : le contrat sert de preuve d'autorisation face à la police, au juge de transit en cas d'accident (12 §9.9) et pour contester une amende imputée au propriétaire (DE 11/2025, 12 §4 ; EC-48). Au Panama, la **Ley 51/2008 modifiée par la Ley 82/2012** encadre la signature électronique, avec la signature qualifiée dont le Registro Público est l'autorité racine (CONFIRMÉ, 12 §3.3). Au Paraguay, la **Ley 6822/2021** remplace la Ley 4017/2010 et seule la **signature qualifiée** équivaut à la signature manuscrite (13 §3.4) ; certification possible des contrats d'adhésion par SEDECO (13 §3.7) ; contrat en espagnol attendu (12 §3.7).
2. **Comment Turo le traite** : contrat de partage de véhicule propre à chaque voyage (un par segment de 30 jours), mis à jour à l'ajout d'un conducteur, accessible dans l'onglet Help ; il sert de preuve à la frontière (DOCUMENTÉ — SRC_G 10.2). Signature qualifiée : non vérifiable.
3. **Solution proposée** :
   - *Flux* : au checkout, le contrat est généré en espagnol (traduction EN ou PT à titre informatif ; l'espagnol prévaut) avec les données du trip et les **exclusions de protection reprises mot pour mot** (IMP-14) ; acceptation par signature électronique simple (case + code par WhatsApp ou SMS + horodatage + hash) ; au check-in, signature de l'état des lieux par les deux parties (IMP-10).
   - *Constancia* : PDF signé par la plateforme avec QR de vérification en ligne (« contrato válido / vigente »), téléchargeable hors ligne pour les contrôles routiers ; nouvelle version à chaque modification (extension, conducteur additionnel).
   - *Option qualifiée* (P1) : pour les trips de plus de 30 jours et les comptes entreprise, signature qualifiée via un prestataire agréé (6 au Paraguay en 2026, 13 §3.4).
   - *Données* : `Contract{version, language, clauses[], hash, signedAt, signers[], verificationUrl}`.
4. **Avantages** : preuve utile dans la plupart des litiges (dommages, amendes, non-restitution) au Panama, où la signature simple est valable (Ley 51/2008) ; au Paraguay seule la signature qualifiée équivaut à la manuscrite (13 §3.4), et la certification SEDECO des contrats d'adhésion reste à vérifier (OQ-BR-24) (corrigé VERIF_06 §5) ; contrôles routiers simplifiés ; base du transfert d'amendes (IMP-26).
5. **Complexité technique** : faible (simple) à moyenne (qualifiée).
6. **Coût (corrigé VERIF_06-V6-03)** :
   - (A) Build assisté par IA (semaines-équipe) : 0,5–1,5.
   - (B) Tiers, à chiffrer par devis : avocat local (modèles de contrat), signature qualifiée au Paraguay, certification SEDECO éventuelle.
   - (C) Exploitation, inducteurs : mise à jour des modèles.
7. **Impact potentiel** : moyen à fort (opposabilité, coût des litiges).
8. **Lancement** : **P0-A** au Panama (signature simple + constancia ; 04 BKG-018, BKG-019, LEG-026) ; signature qualifiée en **P2** pour le Paraguay ; certification SEDECO à vérifier (OQ-BR-24) (corrigé VERIF_06 §5).
- **Risque** : faible sur la technique, moyen sur la force probante devant le juez de tránsito (à valider) ; **Pertinence locale** : les deux.
- **Dépendances** : OQ-BR-24 (clauses), OQ-BR-19 (amendes) ; IMP-10, IMP-14, IMP-26 ; **portes** : P0-A : OQ-MK-01 (qui est partie au contrat), OQ-BR-24 (corrigé VERIF_06-V6-01).

### IMP-13 — Facturation électronique intégrée (PAC au Panama, SIFEN au Paraguay), y compris pour le compte des loueurs
**Statut : PROPOSÉ**

1. **Problème résolu** : au Panama, émission via un **PAC** obligatoire depuis le 01/01/2026 au-delà de certains seuils (DOCUMENTÉ-SECONDAIRE, 12 §3.6), et le projet de loi 30-26 imposerait une facture électronique par transaction aux plateformes (12 §3.6). Au Paraguay, toute société nouvellement inscrite au RUC émet **exclusivement en électronique (SIFEN) dès le premier jour** (CONFIRMÉ, RG DNIT 01/24, 13 §3.8). Les petits loueurs doivent aussi facturer la location ; « qui facture quoi » est la question P0 OQ-BR-14.
2. **Comment Turo le traite** : gains affichés hors TVA et taxe de vente, export CSV, section fiscale ; reçu détaillé mis à jour à chaque frais (DOCUMENTÉ — SRC_H 5.1 ; SRC_G 10.1). Pas de facture électronique fiscale locale (NON APPLICABLE).
3. **Solution proposée** :
   - *Modèle* (à valider par le comptable) : modèle « agent » — la plateforme facture sa commission et ses frais de service ; le loueur facture le loyer ; **la plateforme émet pour le compte du loueur** via l'intégration PAC/SIFEN, sous mandat (le loueur choisit « facturar por mí » ou garde son propre PAC).
   - *Flux* : émission automatique à la clôture du trip et à chaque facture annexe, envoi au guest (email + WhatsApp, PDF avec QR), note de crédit automatique en cas de remboursement ; le guest saisit son RUC au checkout pour une facture nominative (IMP-32).
   - *Données* : `FiscalDocument{country, issuer, type, cufeOrCdc, xml, status}`, mandats de facturation, numérotation par émetteur.
4. **Avantages** : retire une vraie charge administrative aux petits loueurs (argument d'acquisition) ; conformité dès le jour 1 ; données fiables pour un éventuel reporting fiscal (12 §9.10).
5. **Complexité technique** : moyenne.
6. **Coût (corrigé VERIF_06-V6-03)** :
   - (A) Build assisté par IA (semaines-équipe) : 1–2 en P0-A (facture de commission, export compatible PAC) ; +1–2 pour le mandat (P1) ; +1,5–3 pour SIFEN (P2).
   - (B) Tiers, à chiffrer par devis : PAC ou fournisseur SIFEN (par document + abonnement), expert-comptable.
   - (C) Exploitation, inducteurs : comptable local, clôtures mensuelles.
7. **Impact potentiel** : moyen à fort (conformité, rétention des loueurs).
8. **Lancement** : **P0-A** : facture de **commission** au loueur (04 FIN-018) ; émission via PAC seulement si l'entité qui facture est panaméenne, sinon facture de l'entité étrangère ; pour le loyer, l'agence émet sa propre facture électronique et la plateforme fournit un export compatible (04 FIN-002) ; « facturer pour le loueur » (mandat) en **P1** après avis ; SIFEN au jour 1 du Paraguay (**P2**) (corrigé VERIF_06-V6-12).
- **Risque** : faible à moyen (fiscalité mouvante : projet 30-26) ; **Pertinence locale** : les deux.
- **Dépendances** : OQ-BR-14 **P0** ; IMP-04, IMP-32 ; **portes** : P0-A : OQ-MK-06, OQ-PAY-15, OQ-BR-14 (corrigé VERIF_06-V6-01).

---

## D. Protection et assurance

### IMP-14 — Protection locale avec assureur partenaire : exclusions reprises mot pour mot, intégration des polices flotte, garantie de bonne fin de la plateforme
**Statut : PROPOSÉ**

1. **Problème résolu** : au Panama, l'assurance obligatoire est très basse (5 000 / 10 000 / 5 000 B/., montants À VALIDER) et le propriétaire est tenu d'indemniser (art. 234 b) (12 §3.2) ; au Paraguay, **aucune assurance auto obligatoire** et **25–30 % seulement du parc assuré** (13 §3.3) ; aucun produit P2P trouvé chez les assureurs des deux pays (12 §9.4, 13 §9.4) ; un refus de l'assureur alors que la plateforme a vendu une protection crée une crise (EC-47). Le coût d'assurance est **la variable la plus sensible** des unit economics : la marge devient négative si la plateforme l'absorbe (−15 $ par véhicule et par mois au Panama, −31 $ au Paraguay, 12 §9.12, 13 §9.12). Ces chiffres viennent du modèle P2P de Phase 1, retiré de la décision (12 §9.12, V5-05) ; en pro-first, l'assurance est portée par les polices flotte et l'esquisse donne ≈ 42 $ de revenu par véhicule-mois (INFÉRÉ) ; aucun point mort n'est encore calculé (corrigé VERIF_06-V6-11).
2. **Comment Turo le traite** : côté guest, Premier / Standard / Minimum = **65 % / 40 % / 25 % du prix journalier net** (vérifié au centime), refus possible ; RC minimale légale en excédent via Travelers ; côté hôte, plans 70/80/90 % avec franchises de 250 / 1 500 / 2 750 $ ; protection **contractuelle, pas une assurance** ; exclusions : usure, perte de revenus, véhicule de remplacement (DIRECTEMENT TESTÉ / DOCUMENTÉ — 10 §1, §3). Pas d'assureur tiers décideur aux US (11 EC-47). Turo a créé sa propre agence de courtage (10 §5).
3. **Solution proposée** :
   - *Phase 0 (pro-first)* : le loueur déclare sa **police flotte** (assureur, numéro, RC, franchise, exclusions) ; la plateforme la vérifie (attestation, contrôle de validité auprès de l'assureur par API si possible, sinon revue documentaire mensuelle) et affiche ses conditions au guest ; vente optionnelle d'un **rachat de franchise** (CDW) du loueur ou de la plateforme. Le coût de la protection est **toujours facturé au guest** (leçon de 12 §9.12).
   - *Phase 1 (P2P)* : police collective par réservation avec un assureur partenaire (pistes : ASSA, MAPFRE, Internacional, Ancón au Panama ; MAPFRE, Patria, Aseguradora del Este au Paraguay, 12 §3.2, 13 §3.3) : RC complémentaire élevée, dommages, vol ; 3 niveaux de franchise ; prix en pourcentage du loyer avec plancher en USD (10 §1, implications).
   - *Règles* : (a) le texte des exclusions affiché au checkout est **généré depuis la police** (une seule source de vérité) et versionné dans le contrat (IMP-12) ; (b) état `INSURER_DECLINED` → `PLATFORM_GUARANTEE_REVIEW` : si l'exclusion n'avait pas été communiquée, la plateforme indemnise depuis une **réserve de garantie** (11 EC-47) ; (c) audit trimestriel des refus ; (d) exclusions locales explicites : routes non revêtues hors 4x4 labellisés (IMP-16), sortie du territoire, VTC.
   - *Données* : `Policy{insurer, type, coverage, deductible, exclusions[], validUntil}`, `ProtectionPlan`, `ClaimDecision{insurer, status, reason}`, `GuaranteeReserve`.
4. **Avantages** : principal argument face à l'informel, qui n'offre ni contrat ni assurance (14 §c.4) ; exclusions transparentes = moins de crises EC-47 ; la garantie de bonne fin est un engagement que les loueurs n'offrent pas.
5. **Complexité technique** : moyenne (la complexité est surtout contractuelle).
6. **Coût (corrigé VERIF_06-V6-03)** :
   - (A) Build assisté par IA (semaines-équipe) : 0,5–1 en P0-A (polices flotte) ; 2–4 en P1/P2 (police par réservation).
   - (B) Tiers, à chiffrer par devis : courtier, assureur (prime, réserve de garantie éventuelle), avocat (SSRP).
   - (C) Exploitation, inducteurs : négociation avec l'assureur, gestion des sinistres.
7. **Impact potentiel** : **fort** (condition d'existence du P2P, confiance, marge).
8. **Lancement** : **P0-A** : vérification des polices flotte et de leur couverture d'une location distribuée par une plateforme (attestation, échéances, dépublication à expiration ; 04 PRT-019, PRT-009) et affichage aligné des exclusions — **bloquant** tant qu'OQ-MK-05 n'est pas levée ; **P1/P2** : police par réservation (assureur, SSRP) (corrigé VERIF_06-V6-01, §3 idée 3).
- **Risque** : élevé (aucun produit P2P n'existe encore ; refus de couverture ; sinistralité routière élevée) ; **Pertinence locale** : les deux (plus critique au Paraguay, sans socle obligatoire).
- **Dépendances** : OQ-BR-16 **P0**, OQ-BR-09, OQ-BR-22 ; IMP-12, IMP-16, IMP-17, IMP-27 ; **portes** : P0-A : OQ-MK-05 (bloquante) ; P1/P2 : OQ-BR-16 (corrigé VERIF_06-V6-01).

### IMP-15 — Fonds de protection mutuel discrétionnaire (modèle Turo Travels Mutual en Australie), en complément ou en repli
**Statut : PROPOSÉ**

1. **Problème résolu** : si aucun assureur local ne crée de produit P2P par réservation (non trouvé, 12 §9.4, 13 §9.4), le P2P ne peut pas ouvrir ; dépendre d'un seul assureur est un risque (leçon Moobie, 14 §b) ; la branche auto panaméenne est sous pression (sinistralité +19 % à avril 2026, 12 §3.2).
2. **Comment Turo le traite** : en Australie, protection via **Turo Travels Mutual**, mutuelle **discrétionnaire** dont les produits sont « not insurance », réglementés par le Corporations Act et distribués via l'AFSL de Picnic Licensing ; plans 65 % / A$100, 75 % / A$750, 85 % / A$2 500 ; RC A$20 M ; CTP obligatoire ; réseau de réparateurs imposé (DOCUMENTÉ — SRC_H 4.3 ; SRC_TOS_NOTES ; 08 BR-PROT-11). Aux US, Turo combine assurance tierce, rétention propre, **assureur captif** et réserves (DOCUMENTÉ — SRC_H 9.1).
3. **Solution proposée** :
   - *Montage* : fonds alimenté par une cotisation par trip des hôtes membres (pas une prime d'assurance) ; le comité du fonds **décide discrétionnairement** de l'indemnisation des **dommages au véhicule de l'hôte** ; la **RC envers les tiers reste assurée** par un assureur agréé (le fonds ne la remplace jamais).
   - *Règles* : cotisations et sinistres publiés chaque trimestre aux membres ; plafond par sinistre ; réassurance stop-loss au-delà d'un seuil annuel ; éligibilité stricte (GPS, véhicule de moins de 10 ans, IMP-17, IMP-36).
   - *Données* : `MutualFund{balance, contributions, claimsPaid, reinsuranceLayer}`, `MutualDecision{claimId, decision, rationale}`.
4. **Avantages** : indépendance partielle vis-à-vis des assureurs ; coût potentiellement inférieur à une prime commerciale (pas de marge d'assureur) ; hôtes intéressés à la sinistralité.
5. **Complexité technique** : faible pour le logiciel, **élevée** pour la structure juridique et actuarielle.
6. **Coût (corrigé VERIF_06-V6-03)** :
   - (A) Build assisté par IA (semaines-équipe) : 1–2 (P3).
   - (B) Tiers, à chiffrer par devis : juridique et actuariat, capital du fonds, réassurance.
   - (C) Exploitation, inducteurs : gouvernance, comité de décision, reporting.
7. **Impact potentiel** : moyen (marge et indépendance) ; fort si aucun assureur ne suit.
8. **Lancement** : **P3** : rien n'indique qu'un produit « not insurance » soit admis par la SSRP (PA) ou la Superintendencia de Seguros (PY) ; classé en annexe « pistes juridiques », à étudier seulement après validation juridique et si IMP-14 échoue en partie (corrigé VERIF_06-V6-17).
- **Risque** : **élevé** (requalification en activité d'assurance non autorisée, sous-capitalisation, litiges sur la discrétion des décisions) ; **Pertinence locale** : les deux, faisabilité inconnue.
- **Dépendances** : OQ-BR-16 **P0**, OQ-BR-24 ; IMP-14, IMP-17.

---

## E. Antivol, fraude et télématique

### IMP-16 — Géofencing des frontières et des zones exclues, défini par véhicule et par l'hôte, avec alertes graduées
**Statut : PROPOSÉ**

1. **Problème résolu** : exportation de véhicules volés vers le Costa Rica (récupérations par GPS documentées) et 819 vols de véhicules en 2024 au Panama (+11 %), ciblant pick-ups et 4x4 (12 §4) ; au Paraguay, 1 à 7 voitures volées par jour selon la période et exfiltration via le Chili, le Brésil ou la Bolivie (13 §4.1) ; sortie Mercosur soumise à autorisation notariée (13 §4.7) ; routes en terre (Darién, Chaco) qui annulent la protection (EC-53). Cas EC-45 et EC-46.
2. **Comment Turo le traite** : US↔Canada autorisé, Mexique interdit ; le contrat sert de preuve ; **aucun géofencing documenté** ; tout-terrain interdit ; **l'hôte ne peut pas restreindre la zone** (DOCUMENTÉ — 11 EC-45, EC-53 ; SRC_G 7.16).
3. **Solution proposée** :
   - *Zones par défaut* : polygones frontaliers (PA : Paso Canoas, Guabito–Sixaola, Río Sereno ; PY : Ponte da Amizade, Presidente Franco, Encarnación–Posadas, Puerto Falcón–Clorinda, Pedro Juan Caballero, Salto del Guairá, Infante Rivarola) et zones de routes non revêtues (Darién, Chaco hors axes) (11 EC-45/46/53).
   - *Zones de l'hôte* : interdites ou autorisées par véhicule (ex. « berline : pas d'Azuero rural »), affichées obligatoirement au checkout et dans le contrat.
   - *Alertes graduées* : à 20 km d'une frontière → WhatsApp au guest (ES/EN/PT) + alerte ops ; entrée en zone exclue → alerte + horodatage au dossier ; franchissement → incident `BORDER_VIOLATION`, alerte hôte, police en cas de non-restitution ; **immobilisation à distance seulement si elle est validée juridiquement et véhicule à l'arrêt** (OQ-BR-17).
   - *Données* : `GeoZone{polygon, type, scope}`, `GeoEvent{tripId, zoneId, ts, position}`.
4. **Avantages** : prévention plutôt que constat ; preuve GPS jointe automatiquement aux sinistres ; argument décisif pour l'assureur et les loueurs.
5. **Complexité technique** : moyenne (dépend d'IMP-17 pour les positions).
6. **Coût (corrigé VERIF_06-V6-03)** :
   - (A) Build assisté par IA (semaines-équipe) : 0,25–0,5 en P0-A « lite » ; 1,5–3 en P1/P2.
   - (B) Tiers, à chiffrer par devis : données GPS (via IMP-17).
   - (C) Exploitation, inducteurs : astreinte sécurité (P1), procédure avec la police.
7. **Impact potentiel** : **fort** sur le taux de vol, le coût des sinistres et l'acceptation par l'assureur.
8. **Lancement** : **P0-A « lite »** : interdiction contractuelle de sortie du territoire, zones exclues affichées au checkout, présence d'un GPS déclarée par l'agence (04 BKG-023, HST-011) ; **P1** : alertes près des frontières sur les GPS connectés (04 TRP-043) ; **P2** : zones définies par véhicule et alertes graduées (04 TRP-054). 12 §10.3 ne pose qu'une règle d'offre (« pas de sortie vers le Costa Rica »), pas un géofencing logiciel ; repasser en P0 seulement si les polices flotte l'exigent (OQ-MK-05) (corrigé VERIF_06-V6-07).
- **Risque** : moyen (géolocalisation sous Ley 81/2019 et Ley 7593/2025 ; faux positifs) ; **Pertinence locale** : les deux.
- **Dépendances** : IMP-17 ; OQ-BR-17, OQ-BR-18 (option Mercosur), OQ-BR-25 ; **portes** : P0-A lite : OQ-MK-05 ; P1 : OQ-BR-17 (corrigé VERIF_06-V6-01).

### IMP-17 — Intégration des GPS et de la télématique déjà installés (sans boîtier propriétaire) : position, kilométrage, carburant
**Statut : PROPOSÉ**

1. **Problème résolu** : leçon Getaround : boîtier Connect coûteux parmi les facteurs de l'échec (DOCUMENTÉ-SECONDAIRE, 14 §b) → « pas de matériel propriétaire au lancement, s'appuyer sur des GPS tiers déjà installés » (14 §c.7) ; fournisseurs locaux : Autoclick Satelital au Paraguay (> 5 500 clients), Detektor et télématique constructeur (connectHyundai) au Panama (12 §4, 13 §4.6). Les factures de carburant et de kilométrage sont des sources de litige (EC-22, EC-23) ; une panne du tracker pendant un trip n'est pas documentée chez Turo (EC-15, 11 §H).
2. **Comment Turo le traite** : GPS et télématique autorisés pour l'hôte, AirTags interdits ; tracker obligatoire au-delà de seuils de valeur (US ≥ 125 000 $, FR < 10 ans ou ≥ 25 000 €…) ; apps constructeurs pour le déverrouillage ; « Turo Go » absent du centre d'aide actuel ; **pas d'API publique pour les flottes depuis avril 2023** (DOCUMENTÉ — SRC_H 9.3, 6, 8 ; SRC_G 6.1.4, 6.1.6).
3. **Solution proposée** :
   - *Connecteurs* : API des fournisseurs GPS locaux (ou export de leur plateforme), API constructeur quand elle existe, et en dernier recours le téléphone du guest pendant le trip (localisation consentie, moins fiable).
   - *Usages* : position pour le géofencing (IMP-16) ; **kilométrage et carburant relevés automatiquement** au départ et au retour, croisés avec les photos (IMP-10) pour calculer sans contestation les dépassements (BR-MILEAGE-03) et le carburant (BR-FUEL-01) ; alerte « tracker hors ligne depuis X min » pendant un trip à risque (EC-15).
   - *Règles* : GPS **obligatoire** pour les pick-ups, 4x4 et véhicules > 25 000 $ (12 §5.9), et pour toute annonce à Ciudad del Este ou Pedro Juan Caballero (11 EC-45) ; consentement du guest affiché ; données conservées pendant une durée limitée (OQ-BR-25) ; caméra intérieure interdite.
   - *Données* : `TelematicsProvider`, `VehicleDevice{provider, externalId, lastSeenAt}`, `TelemetryReading{ts, position, odometer, fuel}`.
4. **Avantages** : zéro coût de matériel pour la plateforme ; factures annexes objectivées ; exigence probable de l'assureur satisfaite.
5. **Complexité technique** : moyenne (un connecteur par fournisseur).
6. **Coût (corrigé VERIF_06-V6-03)** :
   - (A) Build assisté par IA (semaines-équipe) : 1–2 par connecteur, multiplié par le nombre de fournisseurs GPS retenus (P1) (corrigé VERIF_06-V6-04).
   - (B) Tiers, à chiffrer par devis : accès API des fournisseurs GPS.
   - (C) Exploitation, inducteurs : partenariats fournisseurs.
7. **Impact potentiel** : **fort** (vol, litiges carburant/km, assurabilité).
8. **Lancement** : **P1** : connecteurs vers les GPS des agences pilotes (04 TRP-055), sauf exigence d'assureur constatée (OQ-MK-05) ; la prévalence des GPS dans les flottes est INFÉRÉE (corrigé VERIF_06-V6-07).
- **Risque** : faible à moyen (qualité inégale des API locales ; données personnelles) ; **Pertinence locale** : les deux.
- **Dépendances** : OQ-BR-17, OQ-BR-25 ; IMP-16, IMP-19, IMP-20 ; **portes** : P1 : OQ-MK-05 (corrigé VERIF_06-V6-01).

### IMP-18 — Score de risque de réservation adapté à la LATAM (fraude d'identité, trafic de véhicules, comptes liés)
**Statut : PROPOSÉ**

1. **Problème résolu** : vols « sur commande » de pick-ups et 4x4, clés volées, trafic d'ECU (12 §4) ; un véhicule volé sur trois servirait à des agressions au Paraguay (DOCUMENTÉ-SECONDAIRE, 13 §4.1) ; ~5 000 plaintes pour escroquerie de janvier à novembre 2025 au Panama (12 §2). Leçons Moobie et HyreCar : « underwriting strict, KYC renforcé » (14 §b). Provision fraude et impayés estimée à 4–5 % du GMV (12 §9.12, 13 §9.12) : hypothèse du modèle P2P de Phase 1, sans objet en P0-A où l'agence encaisse (corrigé VERIF_06-V6-11).
2. **Comment Turo le traite** : **Turo Risk Score** (IA/ML) depuis avril 2020 aux US, qui fixe les frais guest en temps réel et filtre au paiement ; caution déclenchée par le « système de sécurité » ; exigences dynamiques de documents ; comptes liés (DOCUMENTÉ — SRC_H 9.1, 9.3 ; SRC_G 1.4.2, 2.5.1 ; 08 BR-TRUST-01).
3. **Solution proposée** :
   - *P0, règles explicites* : signaux = âge du compte, vérification KYC, catégorie du véhicule (pick-up/4x4 = risque élevé), durée (1 jour sur un véhicule ciblé), lieu (proximité d'une frontière), réservation de dernière minute la nuit, appareil ou téléphone déjà vus sur un compte banni, carte ou compte de paiement étranger à l'identité, paiement non réversible sans historique.
   - *Actions graduées* (pas de refus opaque) : caution relevée (IMP-02), justificatif supplémentaire (adresse, billet d'avion), remise en main propre obligatoire, GPS obligatoire, blocage et revue humaine ; chaque décision est journalisée avec ses raisons (recours possible, OQ-BR-24).
   - *P1, modèle statistique* entraîné sur nos incidents, une fois le volume suffisant.
   - *Données* : `RiskAssessment{bookingId, score, signals[], actions[], reviewer}`, empreinte d'appareil, graphe de comptes liés.
4. **Avantages** : réduit la fraude sans pénaliser les bons clients ; rassure assureurs et loueurs ; contrairement à Turo, le score ne modifie pas un prix caché (IMP-05).
5. **Complexité technique** : moyenne (règles) à élevée (ML).
6. **Coût (corrigé VERIF_06-V6-03)** :
   - (A) Build assisté par IA (semaines-équipe) : 0,5–1 en P0-A (règles) ; 3–5 en P1 (modèle).
   - (B) Tiers, à chiffrer par devis : empreinte d'appareil, listes de sanctions.
   - (C) Exploitation, inducteurs : analyste fraude.
7. **Impact potentiel** : **fort** sur le taux de vol et de fraude et sur le loss ratio.
8. **Lancement** : **P0-A** en 5 à 10 règles codées en dur avec revue manuelle (04 ADM-029, PAY-034) ; **P1** en modèle, avec la fraude spécifique LATAM (04 SUP-019, IMP-43) (corrigé VERIF_06 §4).
- **Risque** : moyen (faux positifs et discrimination : la nondiscrimination doit être auditée ; base légale des données) ; **Pertinence locale** : les deux (Paraguay plus exposé).
- **Dépendances** : OQ-BR-02, OQ-BR-24, OQ-BR-25 ; IMP-02, IMP-09, IMP-16, IMP-17 ; **portes** : P0-A : OQ-BR-25 ; P0-B : OQ-MK-02 (sujet obligé LBC si la plateforme encaisse) (corrigé VERIF_06-V6-01).

---

## F. Outils pros et flottes (offre de la phase 0)

### IMP-19 — Console Pro multi-agences : calendrier de flotte, prix en masse, rôles fins, vue « comptoir »
**Statut : PROPOSÉ**

1. **Problème résolu** : l'offre de la phase 0, ce sont des loueurs professionnels (12 §10.3, 14 §c.1) qui gèrent des dizaines de véhicules et plusieurs agences, avec des employés de comptoir (Automarket : 15 agences, > 3 000 véhicules ; Localiza Paraguay : 7 points, ≈ 1 000 véhicules, 14 §a.2). Chez Turo, 84 % des hôtes actifs ont 2 véhicules ou moins (SRC_H 8) : le produit est pensé pour les particuliers.
2. **Comment Turo le traite** : équipes d'hôtes et co-hôtes avec **2 lots de permissions non séparables** (« Trip management » et « Pricing & availability ») ; un co-hôte ne peut pas déclarer un sinistre ni voir les gains ; calendrier multi-véhicules, prix et blocages en masse, groupes par lieu ; l'hôte principal reste responsable (DOCUMENTÉ — SRC_H 8). Power Host : support dédié et financement (DOCUMENTÉ — SRC_H 7).
3. **Solution proposée** :
   - *Structure* : `Organisation` → `Agencias` (lieux, horaires, zones de livraison) → `Vehículos` ; rôles : propriétaire, gérant d'agence, agent de comptoir, comptable, mécanicien ; **permissions granulaires** par action (check-in, prix, sinistres, paiements, factures) et par agence.
   - *Vues* : planning de flotte (Gantt par agence), « hoy en mostrador » (départs et retours du jour avec statut KYC, paiement et caution), alertes (retard, entretien dû, assurance expirant, ITV ou revisado), règles de prix par catégorie (et non par véhicule), affectation au dernier moment d'un véhicule de la catégorie réservée (le guest réserve « SUV compact o similar », comme chez un loueur).
   - *Données* : `Organisation`, `Branch`, `Role`, `Permission`, `VehicleCategory`, `Assignment`.
4. **Avantages** : réduit le coût d'intégration pour les loueurs ; la réservation par catégorie maximise leur utilisation ; base d'une relation « logiciel » qui dépasse la simple place de marché (IMP-22).
5. **Complexité technique** : élevée (pièce maîtresse du back-office).
6. **Coût (corrigé VERIF_06-V6-03)** :
   - (A) Build assisté par IA (semaines-équipe) : 2–3,5 en P0-A (socle) ; +2–4 en P1.
   - (B) Tiers, à chiffrer par devis : aucun poste spécifique.
   - (C) Exploitation, inducteurs : customer success des loueurs.
7. **Impact potentiel** : **fort** sur l'acquisition de l'offre, la densité et la rétention des loueurs.
8. **Lancement** : **P0-A** pour le socle (organisation, lieux, rôles, calendrier, vue comptoir ; 04 FLT-001, FLT-003, CAL-001, TRP-052) ; calendrier multi-véhicules, actions en masse, affectation par catégorie en **P1** (corrigé VERIF_06 §4).
- **Risque** : faible (technique), moyen sur l'adoption (les loueurs ont déjà leurs outils, d'où IMP-20) ; **Pertinence locale** : les deux.
- **Dépendances** : IMP-20, IMP-21, IMP-17 ; OQ-BR-03 (mode demande vs réservation instantanée pour les pros) ; **portes** : P0-A : OQ-MK-07 (valeur perçue par les loueurs) (corrigé VERIF_06-V6-01).

### IMP-20 — API ouverte, iCal bidirectionnel et connecteurs aux logiciels de location des agences
**Statut : PROPOSÉ**

1. **Problème résolu** : un loueur qui vend aussi au comptoir, sur son site et via des agrégateurs risque la **double réservation** (EC-51 : import iCal tardif) ; la saisie manuelle en double fait abandonner les petits loueurs (INFÉRÉ).
2. **Comment Turo le traite** : **pas d'API publique** ; accès tiers coupé en **avril 2023** ; partenaires sous contrat privé ; les hôtes passent par des exports CSV et iCal et des outils tiers fragiles (extensions Chrome, automatisations affectées) (DOCUMENTÉ-SECONDAIRE — SRC_H 8 ; 08 BR-COHOST-03).
3. **Solution proposée** :
   - *API REST publique documentée* (clé par organisation, quotas) : disponibilités, prix, réservations, check-in/out, factures, webhooks (réservation créée, modifiée, annulée, dommage déclaré).
   - *iCal bidirectionnel* pour les petits loueurs sans logiciel ; synchronisation toutes les 5 min, avec la règle « un trip confirmé prime ; un blocage importé en conflit est rejeté et l'hôte alerté » (critère d'acceptation EC-51).
   - *Connecteurs* vers les logiciels de gestion de location utilisés localement (à recenser auprès des loueurs pilotes ; aucun n'est identifié dans la recherche).
   - *Données* : `ApiClient`, `Webhook`, `ExternalCalendar{url, lastSyncAt, conflicts[]}`.
4. **Avantages** : supprime la double saisie ; Turo a fermé cette porte, nous l'ouvrons : argument fort auprès des loueurs et des intégrateurs.
5. **Complexité technique** : moyenne.
6. **Coût (corrigé VERIF_06-V6-03)** :
   - (A) Build assisté par IA (semaines-équipe) : 0,5–1 en P0-A (iCal) ; 2–3 en P1 (API) + 1–2 par connecteur.
   - (B) Tiers, à chiffrer par devis : aucun poste spécifique.
   - (C) Exploitation, inducteurs : support développeurs (P1).
7. **Impact potentiel** : moyen à fort (offre disponible, zéro double réservation).
8. **Lancement** : **P0-A** pour l'iCal bidirectionnel (04 CAL-009 ; règle de conflit reprise de 11 EC-51) ; **P1** pour l'API publique et les connecteurs (04 FLT-010, FLT-018) ; synchro « 5 min » = paramètre à tester, 15 min retenu en P0-A (corrigé VERIF_06-V6-16).
- **Risque** : faible (sécurité de l'API à soigner) ; **Pertinence locale** : les deux.
- **Dépendances** : IMP-19 ; BR-BOOK-10 ; **portes** : aucune OQ-MK / OQ-PAY bloquante (corrigé VERIF_06-V6-01).

### IMP-21 — Onboarding pro express : import de flotte en masse et vérification des documents de l'entreprise en 48 h
**Statut : PROPOSÉ**

1. **Problème résolu** : pour un loueur de 30 véhicules, un parcours véhicule par véhicule est rédhibitoire. Les pièces à contrôler sont spécifiques : Aviso de Operación (Panamá Emprende, 12 §9.1), RUC et facturation SIFEN (13 §5.2), police flotte (12 §9.4), plaques commerciales, revisado ou ITV, absence de nantissement (12 §9.5, 13 §9.5).
2. **Comment Turo le traite** : wizard de 9 étapes **par véhicule**, en commençant par le VIN (DIRECTEMENT TESTÉ jusqu'à l'étape VIN — 06 H-ONB-02) ; approbation et délais d'annonce (08 BR-LIST-08). Pas d'import en masse documenté (non vérifiable).
3. **Solution proposée** :
   - *Flux* : (1) KYB de l'entreprise : registre (SA/SRL/EAS), Aviso de Operación ou patente municipale, RUC, représentant légal (KYC IMP-09), compte bancaire (IMP-04) ; (2) import de flotte par **fichier CSV/Excel** (plaque, VIN, marque, modèle, année, catégorie, agence, police, échéance revisado/ITV) ou par l'API (IMP-20) ; (3) photos d'annonce **par catégorie** (et non par véhicule) avec photo réelle du véhicule au check-in (IMP-10) ; (4) revue par l'équipe sous 48 h ouvrées, avec liste de pièces manquantes par véhicule.
   - *Règles* : véhicule de moins de 8–10 ans au lancement (13 §9.6), plaque commerciale exigée en phase 0 au Panama (12 §10.3), police flotte valide sur toute la période publiée ; alertes d'échéance des documents.
   - *Données* : `BusinessVerification{docs[], status}`, `VehicleImportJob{rows, errors[]}`.
4. **Avantages** : densité de l'offre en quelques semaines au lieu de quelques mois (leçon Pegcar : la densité d'abord, 14 §b).
5. **Complexité technique** : faible.
6. **Coût (corrigé VERIF_06-V6-03)** :
   - (A) Build assisté par IA (semaines-équipe) : 0,5–1 en P0-A (import CSV) ; 1–2 en P1.
   - (B) Tiers, à chiffrer par devis : vérification documentaire éventuelle.
   - (C) Exploitation, inducteurs : chargé d'onboarding.
7. **Impact potentiel** : **fort** sur le délai d'activation de l'offre (densité au lancement).
8. **Lancement** : **P0-A** minimal : import CSV de flotte et KYB revu à la main (04 FLT-011, ADM-004) ; vérification express en 48 h en **P1** (04 FLT-019).
- **Risque** : faible ; **Pertinence locale** : les deux.
- **Dépendances** : IMP-19, IMP-20, IMP-09 ; OQ-BR-28 (véhicules financés) ; **portes** : P0-A : OQ-MK-01 (montage), OQ-MK-05 (polices) (corrigé VERIF_06-V6-01).

### IMP-22 — Moteur de réservation en marque blanche pour le site et le WhatsApp de chaque agence
**Statut : PROPOSÉ**

1. **Problème résolu** : les petits loueurs locaux ont peu d'outils numériques (INFÉRÉ), alors que les leaders se digitalisent (Automarket, 12 §1.5 ; risque cité en 14 §c.5). Un loueur hésite à confier sa clientèle à une place de marché qui pourrait la capter : il veut aussi vendre en direct.
2. **Comment Turo le traite** : non vérifiable (aucun outil de réservation directe pour les hôtes dans la recherche ; la distribution passe par Turo, l'app Uber, ChatGPT et Claude, DOCUMENTÉ — SRC_G 10.6, 10.7).
3. **Solution proposée** :
   - *Produit* : widget de réservation intégrable (iframe/JS) et page de réservation hébergée aux couleurs de l'agence (`agencia.ejemplo.com/reservar`), plus un lien de réservation à partager sur WhatsApp ; même moteur (KYC, paiement local, contrat, caution, factures) que la place de marché.
   - *Règles* : commission réduite sur les réservations directes (ex. frais de traitement seulement) ; le client appartient à l'agence (pas de reciblage par la plateforme sans consentement) ; le client peut créer un compte plateforme qui fonctionne partout.
   - *Données* : `Channel{type: marketplace|direct_widget|direct_link}`, attribution par réservation.
4. **Avantages** : la plateforme devient l'**outil de travail quotidien** du loueur, au-delà d'un canal de vente : fort coût de changement ; chaque réservation directe enrichit le réseau de comptes vérifiés.
5. **Complexité technique** : moyenne.
6. **Coût (corrigé VERIF_06-V6-03)** :
   - (A) Build assisté par IA (semaines-équipe) : 1,5–3 (P1).
   - (B) Tiers, à chiffrer par devis : aucun poste spécifique.
   - (C) Exploitation, inducteurs : accompagnement des intégrations.
7. **Impact potentiel** : moyen à fort sur la rétention des loueurs et le GMV.
8. **Lancement** : **P1** : d'abord prouver la place de marché, puis offrir la marque blanche comme levier de rétention (au P0, un lien de réservation partageable suffit).
- **Risque** : faible à moyen (cannibalisation de la commission place de marché) ; **Pertinence locale** : les deux.
- **Dépendances** : IMP-19, IMP-01, IMP-09, IMP-12 ; **portes** : P1 : OQ-MK-07 (corrigé VERIF_06-V6-01).

### IMP-23 — Tarification intelligente pour marchés à faible densité (benchmark loueurs, saisonnalité, événements)
**Statut : PROPOSÉ**

1. **Problème résolu** : au lancement, il n'y a ni historique ni densité, mais une saisonnalité marquée : pic de décembre à avril (saison sèche et croisières), creux de mai à septembre ; mars est le mois le plus cher chez les agrégateurs et septembre le moins cher (CONFIRMÉ / DOCUMENTÉ-SECONDAIRE, 12 §1.2, §1.4) ; Encarnación a une saison d'été (13 §5.1). Le prix réel des loueurs est opaque (12 §1.4, 13 §1.6).
2. **Comment Turo le traite** : tarification dynamique appliquée à toutes les annonces ; facteurs : modèle, valeur, recherches en temps réel, historique de prix et d'utilisation, prévisions d'offre et de demande, coûts de l'hôte ; recommandations à 90 jours ; alerte si le prix dépasse de 20 % la recommandation, avec moindre visibilité ; « last-minute boost » de +5 % (DOCUMENTÉ — SRC_H 3.1). Ces modèles supposent un volume de données que nous n'aurons pas (INFÉRÉ).
3. **Solution proposée** :
   - *Démarrage à froid* : prix de référence par catégorie et par ville à partir d'un **relevé hebdomadaire des prix publics des loueurs et agrégateurs** (mystery shopping, recommandé en 12 §1.4) ; courbe saisonnière issue des données mensuelles ATP et des agrégateurs ; calendrier d'événements (fêtes nationales, Carnaval, Semana Santa, congrès MICE à Asunción, 13 §1.3) ; prix plancher fixé par le loueur.
   - *Recommandations, pas d'imposition* : l'hôte voit « precio sugerido » avec la justification (« 18 % por encima del mercado para SUV en marzo ») ; pas de pénalité de visibilité au lancement, pour ne pas faire fuir l'offre.
   - *Apprentissage* : bascule progressive vers nos données (taux de conversion par niveau de prix) à mesure que le volume grandit.
   - *Données* : `MarketRate{city, category, date, source}`, `SeasonalityCurve`, `EventCalendar`, `PriceSuggestion{reason}`.
4. **Avantages** : prix cohérents dès le jour 1, sans données propres ; aide les petits loueurs qui n'ont pas de revenue manager ; transparence de la recommandation.
5. **Complexité technique** : moyenne.
6. **Coût (corrigé VERIF_06-V6-03)** :
   - (A) Build assisté par IA (semaines-équipe) : 1,5–3 (P1).
   - (B) Tiers, à chiffrer par devis : données de prix (dans le respect des conditions d'utilisation).
   - (C) Exploitation, inducteurs : analyste pricing.
7. **Impact potentiel** : moyen à fort sur l'utilisation des véhicules et le revenu par véhicule.
8. **Lancement** : **P1** (au P0, des prix de référence statiques par catégorie suffisent).
- **Risque** : faible ; **Pertinence locale** : les deux.
- **Dépendances** : IMP-19, IMP-24 ; OQ-BR-06 (cumul des remises).

### IMP-24 — Tableau de bord de revenus et simulateur localisé (« Calculadora ») pour loueurs et futurs hôtes
**Statut : PROPOSÉ**

1. **Problème résolu** : pour recruter l'offre, il faut chiffrer le gain ; nos hypothèses d'unit economics (450 $ de GMV par véhicule et par mois à Panamá, 280 $ à Asunción ; utilisation de 27–33 %) ne sont pas validées (12 §9.12, 13 §9.12) ; ce sont celles du modèle P2P de Phase 1 : pour la prospection pro-first, partir de l'esquisse ≈ 42 $ par véhicule-mois (12 §9.12, INFÉRÉ) et du taux de commission accepté (OQ-MK-07) (corrigé VERIF_06-V6-11). Le loueur veut savoir quelle catégorie rapporte le plus via la plateforme.
2. **Comment Turo le traite** : Carculator (iframe par pays, 20 marchés US, revenus mensuels et annuels, curseur jours réservés, top 10 des véhicules) ; méthodologie publiée (DIRECTEMENT TESTÉ — 06 H-TOOLS-01) ; onglet « Business » avec gains et performance, export CSV (DOCUMENTÉ — SRC_H 7, 5.1) ; « insights » trimestriels à annuels selon le plan (DOCUMENTÉ — 10 §3).
3. **Solution proposée** :
   - *Simulateur public* par ville (Ciudad de Panamá, Colón, David, Panamá Oeste ; Gran Asunción, Ciudad del Este, Encarnación, cf. 06 H-TOOLS-01) et catégorie : alimenté d'abord par le benchmark d'IMP-23 et une hypothèse d'utilisation **affichée comme hypothèse**, puis par nos données réelles.
   - *Tableau de bord* : revenu par véhicule, utilisation, jours perdus (entretien, sinistre), revenu net après commission et frais, comparaison anonymisée avec la catégorie (« tu SUV rinde 12 % menos que la media »), recommandations actionnables (photos, prix, livraison, remise de durée).
   - *Données* : agrégats par véhicule et par catégorie, seuil minimal d'anonymisation (≥ 5 véhicules, comme la méthodologie Carculator).
4. **Avantages** : outil d'acquisition (simulateur) et de rétention (tableau de bord) ; insights pour tous les hôtes, sans les réserver aux plans les plus chers comme chez Turo.
5. **Complexité technique** : faible.
6. **Coût (corrigé VERIF_06-V6-03)** :
   - (A) Build assisté par IA (semaines-équipe) : 0,5–1,5.
   - (B) Tiers, à chiffrer par devis : aucun poste spécifique.
   - (C) Exploitation, inducteurs : mise à jour des hypothèses.
7. **Impact potentiel** : moyen (acquisition et revenu par véhicule).
8. **Lancement** : **P1** pour le tableau de bord complet ; un simulateur simple peut être prêt dès le P0 pour la prospection.
- **Risque** : faible (promesse de revenus trop optimiste : afficher les hypothèses) ; **Pertinence locale** : les deux.
- **Dépendances** : IMP-23, IMP-19.

---

## G. Opérations terrain et litiges

### IMP-25 — Livraison aéroport (Tocumen PTY, Albrook, ASU) via des points de remise homologués hors emprise, avec suivi de vol
**Statut : PROPOSÉ**

1. **Problème résolu** : **2,24 M de visiteurs** sont entrés par Tocumen en 2025 (75 % des entrées, CONFIRMÉ, 12 §1.2) ; ≈ 0,64 M d'arrivées à ASU (13 §1.3) ; Albrook dessert les vols domestiques (Bocas, David, 12 §1.2). Mais **les règles de livraison P2P en zone d'arrivée ne sont pas trouvées** : livraison « à considérer comme non autorisée tant qu'elle n'est pas validée », avec repli sur un parking public ou un point hors emprise (12 §9.7, 13 §9.7). Les retards de vol (EC-08) et les livraisons ratées (EC-09, non documenté chez Turo) sont fréquents dans un hub de correspondance.
2. **Comment Turo le traite** : permis dans 170+ aéroports (chiffre contradictoire avec « 100+ », OQ-BR-34) ; frais d'accès fixés par l'aéroport ; frais de livraison fixés par l'hôte et plafonnés ; emplacement exact avec photo ; guidage in-app ; hors permis, point de rencontre hors emprise ; ≈ un tiers des trips commencent et finissent à un aéroport, avec +21 % de revenu par trip et −33 % de sinistres (DOCUMENTÉ — 06 H-AIRPORT). Partage des informations de vol (DOCUMENTÉ, non détaillé — SRC_G 10.8).
3. **Solution proposée** :
   - *P0* : (a) loueurs ayant déjà un comptoir ou une navette à l'aéroport : remise au comptoir ; (b) sinon, **points de remise homologués** hors emprise (parking public, hôtel partenaire à proximité, IMP-31), avec photo, plan et horaires ; guidage pas à pas sur WhatsApp (IMP-06).
   - *Suivi de vol* : le guest saisit son numéro de vol ; l'heure de remise se recale automatiquement sur l'arrivée réelle ; tolérance de retard sans frais jusqu'à X h si le retard est prouvé par le statut du vol (réponse à OQ-BR-31 et EC-08) ; l'hôte est prévenu.
   - *P1* : négociation d'un permis ou d'un partenariat parking avec Tocumen S.A. (licitation, redevance, 12 §9.7) et la DINAC (13 §9.7) ; entité `AirportPermit` (zones, frais, plafond de livraison) déjà prévue en 06.
   - *Données* : `PickupPoint{type, geo, photo, hours, airportId}`, `FlightTracking{flightNo, scheduled, estimated, status}`.
4. **Avantages** : capte le segment le plus rentable (touristes nord-américains et européens habitués à la location) sans enfreindre une concession ; le suivi de vol supprime une cause majeure de no-show.
5. **Complexité technique** : moyenne.
6. **Coût (corrigé VERIF_06-V6-03)** :
   - (A) Build assisté par IA (semaines-équipe) : 1–2 (P1).
   - (B) Tiers, à chiffrer par devis : API de statut de vol ; redevance aéroport ou parking (inconnue).
   - (C) Exploitation, inducteurs : négociation et gestion des points de remise.
7. **Impact potentiel** : **fort** sur la demande touristique et la valeur moyenne par trip.
8. **Lancement** : **P1**, hors comptoir, seulement après OQ-MK-08 (04 BKG-041) ; au P0-A, le lieu de remise est le comptoir de l'agence (04 BKG-016) ; 12 §10.1 E5 le dit non bloquant en Phase 0 (corrigé VERIF_06-V6-09).
- **Risque** : élevé (sanctions de l'aéroport en cas de livraison non autorisée ; dépendance à une concession) ; **Pertinence locale** : les deux (Panama en priorité).
- **Dépendances** : OQ-BR-31, OQ-BR-34, OQ-BR-26 ; IMP-06, IMP-31 ; **portes** : P1 : OQ-MK-08 (corrigé VERIF_06-V6-01).

### IMP-26 — Panapass et amendes ATTT : solde vérifié, rapprochement automatique, refacturation et constancia pour l'hôte
**Statut : PROPOSÉ**

1. **Problème résolu** : au Panama, passage sur les corridors sans solde Panapass = **amende ATTT de 10 $ par passage**, cumulative ; ~10 000 conducteurs par mois sans solde ; une dette Panapass bloque le *paz y salvo* ATTT (12 §4) ; le DE 11/2025 impute certaines infractions **au propriétaire** ; fotomultas en phase pilote (12 §4) ; amendes reçues des mois plus tard (EC-24, EC-48). Au Paraguay, péages payés sur place en espèces ou par carte, sans télépéage généralisé (13 §4.4) : enjeu faible.
2. **Comment Turo le traite** : transpondeurs, facturation des péages, transfert de responsabilité pour les infractions à points aux US, refacturation sinon (DOCUMENTÉ par analogie — 11 EC-48 ; 08 BR-TT-01 à 05 ; SRC_G 6.7). Délais de facturation après fermeture : péages et PV 90 jours, puis 180 + 30 j, soit 185 j au plus (DOCUMENTÉ — SRC_G 6.7.1, 6.7.2 ; corrigé VERIF_06-V6-14).
3. **Solution proposée** :
   - *Avant le trip* : l'hôte déclare le numéro Panapass du véhicule ; contrôle d'un **solde minimum** au check-in (photo du solde ou API si disponible) ; option « Panapass prepagado » ajoutée au prix (IMP-05).
   - *Après le trip* : l'hôte importe le relevé Panapass ou l'avis d'amende ; rapprochement automatique avec les dates et heures du trip (et la position GPS, IMP-17) ; facture annexe au guest = montant + frais de gestion publiés ; **PDF de constancia** (contrat + identité vérifiée du conducteur) généré pour que l'hôte conteste l'imputation lorsque la procédure le permet (critère d'acceptation EC-48).
   - *Règles* : fenêtre de facturation de 90 jours ; le guest a 48 h pour contester (BR-REIMB-02) ; prélèvement sur carte enregistrée ou sur le dépôt (IMP-02) ; impayé → compte bloqué jusqu'à régularisation (BR-ACC-10).
   - *Données* : `TollRecord`, `TrafficFine{authority, issuedAt, offenceAt, amount, status}`, `Constancia`.
4. **Avantages** : protège le loueur d'un risque administratif réel (blocage du paz y salvo) ; récupère des sommes aujourd'hui perdues ; argument d'acquisition.
5. **Complexité technique** : faible.
6. **Coût (corrigé VERIF_06-V6-03)** :
   - (A) Build assisté par IA (semaines-équipe) : 1–1,5 (P1).
   - (B) Tiers, à chiffrer par devis : accès Panapass éventuel.
   - (C) Exploitation, inducteurs : traitement des contestations.
7. **Impact potentiel** : moyen (revenu récupéré par le loueur, satisfaction de l'offre).
8. **Lancement** : **P1** (les loueurs gèrent déjà ces flux en interne au P0 ; la valeur augmente avec le P2P, où les particuliers n'ont pas de procédure).
- **Risque** : faible à moyen (transfert légal d'une infraction au conducteur non établi) ; **Pertinence locale** : Panama.
- **Dépendances** : OQ-BR-19 ; IMP-12, IMP-17, IMP-02.

### IMP-27 — Résolution de litiges transparente et rapide : dossier de preuves partagé, délais garantis, médiation, voie de recours
**Statut : PROPOSÉ**

1. **Problème résolu** : un précédent de 2018 (colonne d'opinion, 12 §3.7) rapporte un débit non justifié rétrocédé après plainte ACODECO ; aucun texte contraignant ni sanction chiffrée n'a été trouvé (corrigé VERIF_06-V6-05) ; la validité de clauses comme « décision définitive sans appel », les dommages forfaitaires ou le signalement aux bureaux de crédit est à vérifier en droit local (OQ-BR-24) ; EC-41 (dommage contesté) et EC-42 (représailles dans les avis).
2. **Comment Turo le traite** : deux parcours, règlement direct (devis sous 72 h, retrait ou escalade sous 20 jours) ou dossier Turo (éligibilité en 3 jours ouvrés, expertise, frais jusqu'à 575 $) ; ordre de recouvrement ; échéancier sans frais ; arbitrage imposé dans les ToS ; le support ne communique pas les raisons de certaines décisions (DOCUMENTÉ — SRC_G 7.7–7.13, 7.19, 1.4.4 ; SRC_H 5.4).
3. **Solution proposée** :
   - *Dossier partagé* : chaque partie voit les mêmes pièces (photos IMP-10, alertes IA IMP-11, télématique IMP-17, contrat IMP-12, devis, décision de l'assureur) et une chronologie.
   - *Délais garantis* : déclaration sous 24 h après la fin (comme Turo) ; réponse de l'autre partie sous 72 h ; proposition de la plateforme sous 5 jours ouvrés ; **barème de référence public** des réparations courantes (pare-chocs, jante, rétroviseur) par catégorie, établi avec des carrosseries partenaires, pour plafonner les devis abusifs.
   - *Médiation, puis recours* : médiateur humain de la plateforme ; recours devant un second examinateur indépendant ; information claire sur les voies externes (ACODECO, SEDECO) ; pas de clause « définitive sans appel » avant validation juridique.
   - *Recouvrement* : échéancier sans intérêt sur les rails locaux (prélèvement Yappy ou ACH), en reprenant l'idée Turo (SRC_G 7.13).
   - *Données* : `Dispute{tripId, type, parties, evidence[], deadlines, decision, appeal}`.
4. **Avantages** : moins de plaintes formelles et de chargebacks ; confiance des deux côtés ; dossier plus solide en cas de plainte ACODECO/SEDECO (pratique recommandée, pas une exigence identifiée ; corrigé VERIF_06-V6-05).
5. **Complexité technique** : moyenne.
6. **Coût (corrigé VERIF_06-V6-03)** :
   - (A) Build assisté par IA (semaines-équipe) : 1–2 en P0-A ; +1 en P1.
   - (B) Tiers, à chiffrer par devis : médiateur externe éventuel, carrosseries partenaires.
   - (C) Exploitation, inducteurs : médiateurs, instruction des dossiers.
7. **Impact potentiel** : **fort** sur le coût des litiges, le taux de chargeback et la confiance.
8. **Lancement** : **P0-A** pour le dossier partagé et les délais (04 CLM-006, CLM-034, ADM-008) ; barème de référence et second examen en **P1**.
- **Risque** : moyen (charge opérationnelle, décisions contestées) ; **Pertinence locale** : les deux.
- **Dépendances** : OQ-BR-22, OQ-BR-23, OQ-BR-24 ; IMP-10, IMP-11, IMP-12, IMP-14, IMP-17 ; **portes** : P0-A : OQ-BR-24, OQ-MK-01 (corrigé VERIF_06-V6-01).

---

## H. Confiance, croissance et distribution

### IMP-28 — Programme de réputation bidirectionnel avec badges vérifiés (« Agencia verificada ») et confiance qui réduit la caution
**Statut : PROPOSÉ**

1. **Problème résolu** : la confiance est la barrière n°1 face à l'informel (14 §c.4) ; le marché connaît mal les petits loueurs locaux ; les bons guests ne sont pas récompensés (la fidélité Turo a pris fin, SRC_G 9.1).
2. **Comment Turo le traite** : avis en double aveugle (publication simultanée ou à J+10), sous-notes (propreté, entretien, communication…), texte obligatoire sous 4 étoiles ; All-Star Host (≥ 85 % de 5 étoiles, annulations ≤ 3 %, 20 trips) ; Power Host ; une note de 3 ou moins donnée au guest le bloque chez cet hôte ; seuils de qualité menant à la fermeture du compte (DOCUMENTÉ — SRC_G 8.1–8.5 ; SRC_H 7 ; 06 H-PERF-01).
3. **Solution proposée** :
   - *Avis* : reprendre le double aveugle et les sous-notes de Turo, et ajouter « estado del vehículo vs fotos » et « tiempo en mostrador » ; modération contre les représailles (EC-42).
   - *Badges hôte* : « Agencia verificada » (KYB complet, police flotte vérifiée, IMP-21) ; « Respuesta rápida » ; « Cero cancelaciones » ; critères publiés et recalculés chaque mois (et non chaque trimestre, pour un marché qui démarre).
   - *Niveaux guest* : « Verificado » → « Confiable » (3 trips sans incident) → « Premium » (10 trips) ; chaque niveau **réduit la caution** (IMP-02) et ouvre l'accès à des catégories supérieures.
   - *Données* : `Review{subscores}`, `Badge{criteria, earnedAt, revokedAt}`, `GuestTier`.
4. **Avantages** : la réduction de caution est un bénéfice concret et peu coûteux que les loueurs n'offrent pas ; les badges vérifiés distinguent l'offre de l'informel.
5. **Complexité technique** : faible.
6. **Coût (corrigé VERIF_06-V6-03)** :
   - (A) Build assisté par IA (semaines-équipe) : 0,5–1,5.
   - (B) Tiers, à chiffrer par devis : aucun poste spécifique.
   - (C) Exploitation, inducteurs : modération.
7. **Impact potentiel** : moyen (conversion, rétention des guests).
8. **Lancement** : **P1** (avis simples au P0 ; badges et niveaux quand il y a du volume).
- **Risque** : faible ; **Pertinence locale** : les deux.
- **Dépendances** : IMP-02, IMP-21 ; OQ-BR-27.

### IMP-29 — Parrainage double face : guests (crédit) et loueurs/hôtes (réduction de commission)
**Statut : PROPOSÉ**

1. **Problème résolu** : marché de petite taille (~961 000 automobiles au Panama, 12 §1.1 ; ≈ 3,1 M de véhicules immatriculés au Paraguay, dont 37 % de motos, 13 §1.1) où le bouche-à-oreille et WhatsApp pèsent lourd (INFÉRÉ) ; coût d'acquisition à maîtriser avec des marges contributives de 17–19 % du GMV hors assurance (12 §9.12, 13 §9.12).
2. **Comment Turo le traite** : **aucun parrainage guest** ; parrainage hôte dans 13 marchés US : 300 $ chacun après 3 trips ou 15 jours sans annulation, en 6 mois (DOCUMENTÉ — SRC_G 9.2, 9.3 ; SRC_H 8).
3. **Solution proposée** :
   - *Guest* : lien partageable sur WhatsApp ; le filleul obtient un crédit sur son premier trip, le parrain le reçoit après le trip **terminé** du filleul (pas à l'inscription).
   - *Offre* : un loueur qui recommande un autre loueur obtient une réduction de commission pendant 3 mois après 5 trips réalisés par le filleul.
   - *Anti-abus* : un crédit par identité vérifiée (IMP-09), même appareil ou même moyen de paiement refusés (BR-TRUST-08), plafond mensuel.
   - *Données* : `Referral{referrer, referee, status, rewardIssuedAt}`.
4. **Avantages** : coût d'acquisition variable (payé seulement au résultat) ; utilise le canal naturel de diffusion (WhatsApp).
5. **Complexité technique** : faible.
6. **Coût (corrigé VERIF_06-V6-03)** :
   - (A) Build assisté par IA (semaines-équipe) : 0,5–1.
   - (B) Tiers, à chiffrer par devis : budget des récompenses.
   - (C) Exploitation, inducteurs : contrôle des abus.
7. **Impact potentiel** : moyen sur le coût d'acquisition.
8. **Lancement** : **P1** (le P0 se concentre sur la densité de l'offre et la demande touristique).
- **Risque** : moyen (fraude au parrainage) ; **Pertinence locale** : les deux.
- **Dépendances** : IMP-09, IMP-18.

### IMP-30 — Fidélité légère orientée avantages concrets (caution, surclassement, livraison offerte)
**Statut : PROPOSÉ**

1. **Problème résolu** : 57 % des jours réservés chez Turo viennent de guests récurrents (DOCUMENTÉ — SRC_H 9.1) : la récurrence est un levier majeur ; la clientèle locale (week-ends à la plage, remplacement pendant une réparation, déménagements, 12 §1.4) est récurrente par nature.
2. **Comment Turo le traite** : le **programme de fidélité guest a pris fin le 24/07/2025** ; partenariats Citi/AAdvantage (jusqu'à 30 $ par voyage) et Qatar Avios (DOCUMENTÉ — SRC_G 9.1, 9.5, 9.6).
3. **Solution proposée** :
   - *Pas de points coûteux* : les avantages découlent des niveaux d'IMP-28 (caution réduite, surclassement selon disponibilité, livraison offerte une fois par trimestre, réservation prioritaire en haute saison).
   - *Partenariats de points* (compagnies aériennes, banques locales) en P2-P3 seulement, s'ils sont financés par le partenaire.
   - *Données* : réutilise `GuestTier` (IMP-28).
4. **Avantages** : rétention pour un coût marginal faible ; Turo a abandonné ce terrain.
5. **Complexité technique** : faible.
6. **Coût (corrigé VERIF_06-V6-03)** :
   - (A) Build assisté par IA (semaines-équipe) : 0,25–0,5 (dans IMP-28).
   - (B) Tiers, à chiffrer par devis : coût des avantages.
   - (C) Exploitation, inducteurs : faible.
7. **Impact potentiel** : faible à moyen (fréquence de réservation).
8. **Lancement** : **P2**, une fois la récurrence mesurable ; **fusionnée dans IMP-28** (mêmes niveaux, aucune idée propre) (corrigé VERIF_06-V6-17).
- **Risque** : faible ; **Pertinence locale** : les deux.
- **Dépendances** : IMP-28.

### IMP-31 — Partenariats de distribution avec hôtels, concierges, tour-opérateurs et le programme Panama Stopover
**Statut : PROPOSÉ**

1. **Problème résolu** : séjour moyen d'environ 8 jours et dépense de ~274 B/. par jour (CONFIRMÉ, 12 §1.2) ; **195 000–200 000 voyageurs Stopover** attendus en 2025 (escale gratuite Copa, DOCUMENTÉ-SECONDAIRE, 12 §1.2) ; occupation hôtelière d'environ 56,6 % (12 §1.2) ; MICE au Paraguay ≈ 500 M USD (13 §1.3). 89 % du trafic Turo est organique (DOCUMENTÉ — SRC_H 9.1) : nous n'avons pas cette notoriété.
2. **Comment Turo le traite** : distribution via l'app Uber (US hors NY, OR, WA), ChatGPT et Claude ; partenariats cartes et points (DOCUMENTÉ — SRC_G 10.6, 10.7, 9.5, 9.6). Partenariats hôteliers : non vérifiable.
3. **Solution proposée** :
   - *Partenaires* : hôtels (Ciudad de Panamá, Boquete, Coronado), conciergeries, agences réceptives et tour-opérateurs (Bocas, San Blas, Azuero), organisateurs MICE à Asunción ; le programme Stopover est à approcher, sans aucun accord existant à ce jour.
   - *Outils* : lien ou QR de réservation suivi par partenaire (commission de 5–10 % du loyer, hypothèse), widget pour le site de l'hôtel (IMP-22), **livraison à l'hôtel** comme point de remise homologué (IMP-25), tableau de bord des commissions.
   - *Règles* : le partenaire n'a pas accès aux données personnelles du guest ; commission versée après le trip terminé ; facture de commission électronique (IMP-13).
   - *Données* : `Partner{type, commissionRate}`, attribution par réservation.
4. **Avantages** : acquisition de touristes à coût variable ; l'hôtel devient un point de remise sûr (meilleur que la rue, pas de concession aéroportuaire).
5. **Complexité technique** : faible.
6. **Coût (corrigé VERIF_06-V6-03)** :
   - (A) Build assisté par IA (semaines-équipe) : 0,5–1.
   - (B) Tiers, à chiffrer par devis : commissions des partenaires.
   - (C) Exploitation, inducteurs : business developer local.
7. **Impact potentiel** : moyen à fort sur la demande touristique.
8. **Lancement** : **P1** (premiers partenaires pilotes possibles dès la fin du P0).
- **Risque** : faible ; **Pertinence locale** : les deux (Panama en priorité).
- **Dépendances** : IMP-22, IMP-25, IMP-13.

### IMP-32 — Comptes entreprises : conducteurs multiples, facture électronique au RUC de l'entreprise, politiques de dépense
**Statut : PROPOSÉ**

1. **Problème résolu** : le Panama est un hub régional (sièges régionaux, régime SEM, hub Copa ; pas de statistique dédiée, INFÉRÉ, 12 §1.3) ; au Paraguay, MICE ≈ 500 M USD (13 §1.3), agro dans le Chaco (pick-ups 4x4, 13 §5.4), et Localiza se dit leader du renting d'entreprise (13 §1.6). Une entreprise a besoin d'une facture à son RUC (IMP-13) et de plusieurs conducteurs.
2. **Comment Turo le traite** : aucun article « Turo for Business » trouvé (INFÉRÉ, absence — SRC_G 10.11) ; usage commercial nécessitant un permis professionnel interdit (DOCUMENTÉ — SRC_H 8).
3. **Solution proposée** :
   - *Compte entreprise* : KYB (IMP-21), administrateurs, employés-conducteurs vérifiés individuellement (IMP-09), centres de coût, politique (catégories autorisées, plafond journalier), paiement par carte d'entreprise ou par facture mensuelle (P2, sous réserve de crédit).
   - *Facturation* : facture électronique au RUC de l'entreprise (IMP-13), relevé mensuel consolidé.
   - *Données* : `Company`, `CompanyMember{role, approvedDriver}`, `Policy`, `CostCenter`.
4. **Avantages** : demande de semaine qui complète la demande touristique de week-end ; paniers plus élevés.
5. **Complexité technique** : moyenne.
6. **Coût (corrigé VERIF_06-V6-03)** :
   - (A) Build assisté par IA (semaines-équipe) : 1–2.
   - (B) Tiers, à chiffrer par devis : aucun poste spécifique (risque de crédit si paiement différé).
   - (C) Exploitation, inducteurs : vente B2B.
7. **Impact potentiel** : moyen (utilisation en semaine, revenu par trip).
8. **Lancement** : **P2** (d'abord prouver le cœur B2C ; au Paraguay, le MICE peut justifier une avance).
- **Risque** : faible à moyen (impayés en facturation différée) ; **Pertinence locale** : les deux.
- **Dépendances** : IMP-09, IMP-13, IMP-21.

---

## I. Segments et expérience

### IMP-33 — Locations moyennes durées (1 à 3 mois) pour expatriés et nomades, avec contrôle art. 110/111 et paiement mensuel sur rails locaux
**Statut : PROPOSÉ**

1. **Problème résolu** : 39 773 permis de résidence traités de janvier à septembre 2024 au Panama ; visa nomade DE 198/2021 (12 §1.3) ; au Paraguay, 47 687 demandes de résidence en 2025 (+63 %) et 60 % des résidences 2024 accordées à des Brésiliens (13 §1.4). **Mais** : le résident ne peut plus conduire avec son permis étranger, et le titulaire d'un permis spécial de séjour a besoin d'un permis ATTT (art. 109–111) : le segment nomade est **plus étroit qu'annoncé** (12 §5.8). L'échec de paiement d'un segment mensuel (EC-52) est plus fréquent sans carte de crédit.
2. **Comment Turo le traite** : trips mensuels « en plus forte croissance » ; remise mensuelle recommandée de 45 % ; −61 % de miles par jour et −68 % de sinistres par rapport aux trips courts ; Pay as you go en versements de 30 jours sur carte uniquement ; en cas d'échec de paiement, trip raccourci et véhicule à rendre ; entretien demandé au guest pendant les trips longs (DOCUMENTÉ — 06 H-MONTHLY ; SRC_G 2.6.4 ; 11 EC-52).
3. **Solution proposée** :
   - *Flux* : recherche « Mensual » avec prix par mois tout compris (IMP-05) ; contrôle IMP-09 obligatoire : touriste → durée plafonnée à date d'entrée + 90 j ; visa nomade ou spécial → permis ATTT exigé ; résident → permis local exigé ; aide pédagogique « Cómo obtener tu licencia ATTT » (sans promettre de délai).
   - *Paiement* : 1er mois à la réservation, puis segments de 30 jours prélevés par carte **ou** par lien de paiement Yappy / ACH / QR envoyé sur WhatsApp à J−7 ; 2 relances sur 48 h ; sans régularisation, la fin est ramenée à la fin du segment payé + 24 h de grâce (critère d'EC-52) ; dépôt mensuel plus élevé si paiement non automatique.
   - *Règles* : entretien planifié avec le loueur (fenêtre de 2 semaines, coût à la charge du loueur, comme Turo) ; contrat par segment (IMP-12, signature qualifiée en option) ; kilométrage mensuel plafonné.
4. **Avantages** : utilisation élevée et sinistralité plus faible (selon les données Turo) ; segment mal servi par les loueurs touristiques ; la conformité art. 111 évite une exposition juridique que les concurrents risquent d'ignorer.
5. **Complexité technique** : moyenne.
6. **Coût (corrigé VERIF_06-V6-03)** :
   - (A) Build assisté par IA (semaines-équipe) : 1–2.
   - (B) Tiers, à chiffrer par devis : aucun poste spécifique.
   - (C) Exploitation, inducteurs : suivi des impayés.
7. **Impact potentiel** : moyen à fort sur l'utilisation des véhicules et le revenu récurrent.
8. **Lancement** : **P2** au Panama (après validation d'OQ-BR-21 sur l'art. 111), aligné sur 04 BKG-042 qui fait foi pour le build ; **P2** au Paraguay avec interface en portugais (corrigé VERIF_10-V10-14 ; était P1 au Panama).
- **Risque** : élevé (conducteurs non conformes, impayés sur segments sans carte, non-restitution) ; **Pertinence locale** : les deux.
- **Dépendances** : OQ-BR-21, OQ-BR-05, OQ-BR-11 ; IMP-01, IMP-02, IMP-09, IMP-12.

### IMP-34 — Recherche par usage et par destination, avec compatibilité de route (plage, montagne, 4x4, intérieur)
**Statut : PROPOSÉ**

1. **Problème résolu** : ~52 % du réseau routier panaméen n'est pas revêtu (CONFIRMÉ, 12 §4) ; des destinations exigent un 4x4 (Darién, Azuero rural, montagnes de Chiriquí, 12 §4) ; au Paraguay, routes en terre impraticables après la pluie dans le Chaco (13 §4.3). Un guest qui choisit une berline pour une piste provoque l'EC-53 (protection annulée, dommage non couvert).
2. **Comment Turo le traite** : filtres par type, véhicules verts, accessibilité, animaux, siège enfant, Tesla FSD ; pas de filtre kilométrage illimité ; tout-terrain interdit (DOCUMENTÉ — SRC_G 10.4, 7.16 ; 05 G-SEARCH-05). Pas de recherche par destination ou compatibilité de route (non vérifiable).
3. **Solution proposée** :
   - *Flux* : « ¿A dónde vas? » avec destinations prédéfinies (Boquete, Coronado, Pedasí, Santa Catalina, Bocas vía Almirante ; Encarnación, Chaco, San Bernardino) ; le système recommande les catégories compatibles et signale « Esta ruta requiere 4x4 » ; les véhicules non compatibles restent visibles avec un avertissement et l'exclusion correspondante dans le contrat.
   - *Données* : `Destination{geo, roadType, seasonalRisk, requiredCategory}` maintenue par l'équipe ops ; zones liées au géofencing (IMP-16).
4. **Avantages** : moins de sinistres et de litiges EC-53 ; montée en gamme naturelle vers les SUV et 4x4 (55,9 % des ventes de neufs au Panama sont des SUV, 12 §1.1) ; recherche plus utile qu'une liste de modèles.
5. **Complexité technique** : faible.
6. **Coût (corrigé VERIF_06-V6-03)** :
   - (A) Build assisté par IA (semaines-équipe) : 0,5–1.
   - (B) Tiers, à chiffrer par devis : aucun poste spécifique.
   - (C) Exploitation, inducteurs : maintenance des fiches de destination.
7. **Impact potentiel** : moyen (sinistralité, panier moyen, conversion).
8. **Lancement** : **P2**, aligné sur 04 SRC-046 qui fait foi pour le build (corrigé VERIF_10-V10-14 ; était P1).
- **Risque** : faible ; **Pertinence locale** : les deux.
- **Dépendances** : IMP-16, IMP-14.

### IMP-35 — Application tolérante à la faible connectivité (PWA légère, données critiques hors ligne, repli SMS)
**Statut : PROPOSÉ**

1. **Problème résolu** : les touristes arrivent sans forfait local (problème de SMS en roaming documenté chez Turo, SRC_G 1.4.6) ; au Paraguay, la couverture de l'assistance est faible dans le Chaco (13 §4.6). *Limite* : la couverture mobile elle-même n'est pas mesurée dans la recherche (INFÉRÉ).
2. **Comment Turo le traite** : check-in et check-out « app uniquement » pour les co-hôtes (DOCUMENTÉ — SRC_H 8) ; comportement hors ligne : non vérifiable.
3. **Solution proposée** :
   - *Hors ligne* : contrat et constancia (IMP-12), instructions de retrait, numéro d'urgence, plan du point de remise, code de lockbox (déchiffré à la demande avec un code reçu à l'avance) et capture des photos (IMP-10) disponibles sans réseau.
   - *Poids* : PWA de moins de 2 Mo au premier chargement, images compressées selon le réseau, mode « datos bajos ».
   - *Repli* : messages critiques en SMS si WhatsApp n'est pas livré en 5 min (IMP-06) ; numéro vocal d'urgence affiché dans la constancia.
4. **Avantages** : le trip continue même sans réseau ; moins d'appels au support pendant le retrait.
5. **Complexité technique** : moyenne.
6. **Coût (corrigé VERIF_06-V6-03)** :
   - (A) Build assisté par IA (semaines-équipe) : 1–2.
   - (B) Tiers, à chiffrer par devis : SMS de repli.
   - (C) Exploitation, inducteurs : faible.
7. **Impact potentiel** : moyen (taux de check-in réussi, tickets).
8. **Lancement** : **P1** pour la PWA complète ; au **P0-A**, la capture photo hors ligne est dans IMP-10 (04 TRP-002) ; la faible connectivité n'est pas mesurée (INFÉRÉ) (corrigé VERIF_06-V6-17).
- **Risque** : faible ; **Pertinence locale** : les deux (Paraguay rural et intérieur du Panama).
- **Dépendances** : IMP-06, IMP-10, IMP-12.

---

## J. Ouverture P2P et extensions

### IMP-36 — Éligibilité des véhicules de particuliers : nantissement (prenda, réserve de propriété), inspection, âge
**Statut : PROPOSÉ**

1. **Problème résolu** : au Panama, en cas de vente avec réserve de propriété, le vendeur et l'acheteur sont aussi tenus d'indemniser (art. 234 d) ; encours de crédit auto ~2 212 M$ (12 §9.5, §1.1). Au Paraguay, les contrats de gage interdisent de **changer l'usage** sans accord écrit du créancier (DOCUMENTÉ-SECONDAIRE faible, 13 §9.5) ; les « chileré » (conduite à droite convertie) sont les plus volés (13 §9.6) ; plus de 65 000 véhicules circulent avec un permis temporaire faute de plaques au Panama (12 §1.1).
2. **Comment Turo le traite** : contradiction entre « financé autorisé sous réserve du contrat » et « titre avec financement en cours interdit » (OQ-BR-28) ; éligibilité US (âge, kilométrage, titres interdits) ; rappels de sécurité ; inspection annuelle (DOCUMENTÉ — 08 BR-LIST-02/03/06/07).
3. **Solution proposée** :
   - *Flux d'annonce P2P* : plaque → document d'immatriculation (registro único PA ; cédula verde DRA PY) → déclaration de libre gravamen **ou** certificat DRA sans prenda ni inhibition (PY) **ou** consentement écrit du créancier (modèle de lettre fourni) → revisado ou ITV à jour → photos guidées.
   - *Règles* : moins de 10 ans au lancement P2P ; conduite à droite convertie refusée sans certificat de conversion ; permis temporaire refusé (au Panama, à valider) ; GPS obligatoire selon IMP-17.
   - *Données* : `VehicleTitleCheck{lienStatus, lenderConsentDoc, inspectionValidUntil}`.
4. **Avantages** : évite d'exposer le créancier et la plateforme ; crédibilité auprès des banques (partenaires possibles de financement plus tard).
5. **Complexité technique** : faible.
6. **Coût (corrigé VERIF_06-V6-03)** :
   - (A) Build assisté par IA (semaines-équipe) : 0,5–1.
   - (B) Tiers, à chiffrer par devis : certificats ou inspections.
   - (C) Exploitation, inducteurs : revue documentaire.
7. **Impact potentiel** : moyen (qualité et assurabilité de l'offre P2P).
8. **Lancement** : **P1**, uniquement si le P2P est ouvert (OQ-BR-35).
- **Risque** : faible (filtre) ; il réduit un risque juridique élevé ; **Pertinence locale** : les deux.
- **Dépendances** : OQ-BR-28, OQ-BR-35 **P0** ; IMP-17.

### IMP-37 — Onboarding fiscal des hôtes particuliers (aide au RUC, retenues, relevé annuel)
**Statut : PROPOSÉ**

1. **Problème résolu** : au Paraguay, l'hôte P2P est potentiellement contribuable IRP ou IVA, et la plateforme pourrait devenir agent de retenue ; « les hôtes particuliers sans RUC représentent un **frein majeur** ; une solution d'onboarding RUC et un partenariat comptable pourraient servir de différenciateur » (13 §3.8). Au Panama, la nécessité d'un RUC pour un hôte particulier n'est pas trouvée (12 §9.3) ; le projet 30-26 pourrait créer un reporting de fait (12 §9.10).
2. **Comment Turo le traite** : section fiscale, export CSV, récapitulatif fiscal annuel ; gains affichés hors TVA (DOCUMENTÉ — SRC_H 5.1, 5.2).
3. **Solution proposée** :
   - *Flux* : à l'inscription d'un hôte particulier, questionnaire fiscal (RUC existant ? activité habituelle ?) ; si un RUC est nécessaire, parcours guidé avec un **cabinet comptable partenaire** (forfait négocié) ; enregistrement des retenues éventuelles ; **relevé annuel** des revenus et des retenues.
   - *Règles* : versements bloqués tant que le statut fiscal requis n'est pas complet (si la loi l'exige) ; règles paramétrées par pays selon l'avis du comptable.
   - *Données* : `HostTaxProfile{country, taxId, regime, withholdingRate}`, `AnnualStatement`.
4. **Avantages** : lève un frein d'entrée réel pour l'offre P2P paraguayenne ; prépare la conformité aux futures obligations de reporting.
5. **Complexité technique** : moyenne.
6. **Coût (corrigé VERIF_06-V6-03)** :
   - (A) Build assisté par IA (semaines-équipe) : 1–1,5.
   - (B) Tiers, à chiffrer par devis : partenariat comptable.
   - (C) Exploitation, inducteurs : coordination avec le cabinet.
7. **Impact potentiel** : moyen (activation des hôtes particuliers au Paraguay).
8. **Lancement** : **P2** (Paraguay + P2P).
- **Risque** : moyen (règles fiscales incertaines) ; **Pertinence locale** : Paraguay surtout.
- **Dépendances** : OQ-BR-14, OQ-BR-35 ; IMP-13, IMP-04.

### IMP-38 — Automatisations sans code pour les hôtes (messages programmés, relances, factures annexes, règles de disponibilité)
**Statut : PROPOSÉ**

1. **Problème résolu** : les loueurs répètent les mêmes tâches (instructions, rappels de retour, demandes de photos, facturation carburant) ; chez Turo, les outils tiers qui automatisaient ces tâches ont été touchés par la fermeture de l'API (DOCUMENTÉ-SECONDAIRE — SRC_H 8).
2. **Comment Turo le traite** : messages programmables par l'hôte, **interdits aux co-hôtes** ; ajustement automatique du calendrier ; modifications automatiques si elles respectent les réglages (DOCUMENTÉ — SRC_H 8, 6 ; 08 BR-BOOK-07).
3. **Solution proposée** :
   - *Règles « si… alors… »* avec modèles prêts à l'emploi : « 24 h antes del retiro → enviar instrucciones + ubicación » ; « retraso > 30 min → aviso al guest y al mostrador » ; « combustible < nivel de salida → generar factura según tabla » (validée par un humain) ; « mantenimiento cada 5 000 km → bloquear calendario ».
   - *Garde-fous* : aucune automatisation ne peut facturer sans validation, ni contacter le guest hors des modèles approuvés ; journal de chaque exécution.
   - *Données* : `AutomationRule{trigger, conditions, actions, enabled}`, `AutomationRun`.
4. **Avantages** : temps gagné pour les petites équipes ; qualité de service homogène.
5. **Complexité technique** : moyenne.
6. **Coût (corrigé VERIF_06-V6-03)** :
   - (A) Build assisté par IA (semaines-équipe) : 1–2 (en partie dans IMP-06 / IMP-19).
   - (B) Tiers, à chiffrer par devis : messages.
   - (C) Exploitation, inducteurs : faible.
7. **Impact potentiel** : faible à moyen (productivité des loueurs, ponctualité).
8. **Lancement** : **P2** ; **fusionnée dans IMP-06 et IMP-19** (son « problème » est un fait Turo sans lien LATAM) (corrigé VERIF_06-V6-17).
- **Risque** : faible ; **Pertinence locale** : les deux.
- **Dépendances** : IMP-06, IMP-19, IMP-17.

### IMP-39 — Option « avec chauffeur » par mise en relation avec des transporteurs touristiques licenciés (sans chauffeur fourni par la plateforme)
**Statut : PROPOSÉ**

1. **Problème résolu** : une partie des touristes (croisiéristes, voyageurs d'affaires, groupes) ne veut pas conduire dans un pays où l'on compte 53 132 accidents par an (12 §4). Mais un extra « con chofer » peut **requalifier la prestation en transport de passagers** (DE 331/2017 au Panama ; régime paraguayen), un domaine instable et politiquement sensible : le DE 10/2026 a été abrogé en quelques jours (12 §1.4, §9.13 ; OQ-BR-15).
2. **Comment Turo le traite** : non vérifiable (aucune option chauffeur dans la recherche ; les limousines sont exclues, SRC_G 10.10 ; l'usage commercial est interdit, SRC_H 8).
3. **Solution proposée** :
   - *Uniquement une mise en relation* : catalogue séparé « Traslados y tours con conductor » proposé par des **transporteurs détenteurs des licences requises** (vérifiées), facturés par eux ; la plateforme perçoit une commission d'apporteur et ne fournit ni véhicule P2P ni chauffeur.
   - *Règles* : jamais d'extra « chauffeur » sur une annonce de location ; vérification des licences de transport et de l'assurance passagers ; activation seulement après avis d'un avocat.
4. **Avantages** : répond à une demande réelle sans exposer la place de marché au régime du transport de passagers.
5. **Complexité technique** : faible à moyenne.
6. **Coût (corrigé VERIF_06-V6-03)** :
   - (A) Build assisté par IA (semaines-équipe) : 1–1,5.
   - (B) Tiers, à chiffrer par devis : avis juridique.
   - (C) Exploitation, inducteurs : vérification des transporteurs.
7. **Impact potentiel** : faible à moyen (revenu additionnel).
8. **Lancement** : **P3** : conditionnée à OQ-BR-15 ; classée en annexe « pistes juridiques » (corrigé VERIF_06-V6-17).
- **Risque** : **élevé** (requalification, lobby du transport, 12 §9.13) ; **Pertinence locale** : les deux.
- **Dépendances** : OQ-BR-15 ; IMP-31.

---

## K. Classement de toutes les idées (PROPOSÉ)

### K.0 Porte P0 (corrigé VERIF_06-V6-01)

Le P0 n'est pas un MVP inconditionnel : il ne démarre qu'après les réponses suivantes (`22_OPEN_QUESTIONS.md`).

| Porte | Questions | Ce qu'elle débloque |
|---|---|---|
| **P0-A** (bêta fermée, l'agence encaisse) | **OQ-MK-01** (art. 288 : « representación o agencia »), **OQ-MK-02 lecture b** (le flux « l'agence encaisse » n'est pas une activité de casa de remesas ; corrigé VERIF_10-V10-04), **OQ-MK-05** (polices flotte couvrant la distribution par plateforme), **OQ-MK-06** (ITBMS, retenue 12,5 %, facture de l'agence), **OQ-MK-07** (commission acceptée : viabilité), **OQ-PAY-03** (Tilopay : commande sur le compte de l'agence), **OQ-BR-24** (clauses des CGU et du contrat), **OQ-PAY-22** et **OQ-PAY-07** (remboursement Yappy), **OQ-MK-09** (Ley 81 : transferts, enregistrement, violation), **OQ-BR-21** (permis étrangers, en mode signalement tant qu'elle n'est pas tranchée), **OQ-BR-25** (durées de conservation, valeurs prudentes en attendant) (corrigé VERIF_10-V10-05, V10-09, V10-14) | IMP-01 (rails via l'agence), 05, 06, 07 lite, 09, 10, 12, 13 (commission), 14 (polices), 16 lite, 18 (règles), 19, 20, 21, 27, IMP-40 à 46, 48 |
| **P0-B** (la plateforme encaisse et reverse) | **OQ-MK-02** (casa de remesas), **OQ-MK-03** (MTL si entité US), **OQ-PAY-02** (validité des pré-autorisations), **OQ-PAY-04** (dLocal Platforms), **OQ-PAY-05** (split ou payout PSP et remesas), **OQ-PAY-13** (débit local et MIT), OQ-PAY-15 (facture et split), OQ-BR-12, OQ-BR-14 ; **OQ-PAY-17** (ré-autorisation), **OQ-PAY-18** (règles réseaux sur les dommages), **OQ-PAY-21** (préfinancement des payouts), OQ-PAY-19, OQ-PAY-22 (VERIF_08 V8-01, V8-03) | IMP-02 (dépôt détenu), 03, 04, la partie P0-B d'IMP-01 |
| Repli Paraguay | **OQ-MK-04** (statut PSP au BCP), OQ-PAY-10, OQ-PAY-11 | bascule si l'avis OQ-MK-01 est négatif sans montage viable (12 §10.3) |

OQ-MK-05 est une dépendance bloquante d'IMP-14 ; OQ-MK-07 est une condition de viabilité de tout le P0. Séquencement (corrigé VERIF_10-V10-03) : un avis préliminaire écrit sur OQ-MK-01 et OQ-MK-02 (lecture b) précède le lot 1 du build, l'avis définitif précède le lot 2 (18 §4).

### K.1 Formule de notation

Chaque idée est notée de 1 à 5 sur quatre axes :
- **Potentiel (Pot)** : impact attendu sur la métrique visée (conversion, densité de l'offre, sinistralité, rétention). 5 = fort et prouvé par les données de la recherche.
- **Effort (Eff)** : complexité technique + coût de build + effort opérationnel. 5 = très lourd.
- **Risque (Rsq)** : juridique, financier, réputationnel ou d'exécution. 5 = très élevé.
- **Pertinence locale (Loc)** : 5 = critique dans les deux pays et dès le Panama ; 3 = un seul pays ou un segment secondaire.

**Score = 0,40 × Pot + 0,25 × Loc + 0,20 × (6 − Eff) + 0,15 × (6 − Rsq)** (échelle de 1 à 5). Le potentiel pèse le plus ; l'effort et le risque sont inversés (plus ils sont faibles, plus le score monte).

**Limite de la formule** : elle ne capture pas les **prérequis**. IMP-14 (protection) et IMP-04 (versements) ont un score inférieur à celui d'idées plus simples, mais sans eux le lancement n'a pas lieu. La phase (colonne de droite) prime donc sur le score pour l'ordonnancement ; le score sert à arbitrer **à l'intérieur** d'une phase.

### K.2 Tableau

| Rang | ID | Idée | Pot | Eff | Rsq | Loc | Score | Phase (corrigée VERIF_06) | Porte (OQ) |
|---|---|---|---|---|---|---|---|---|---|
| 1 | IMP-05 | Prix tout compris USD/PYG | 5 | 2 | 2 | 5 | **4,65** | P0-A / P1 | P0-A : OQ-MK-06, OQ-BR-14 ; P1 : OQ-BR-16 |
| 2 | IMP-10 | Check-in/out guidé, hors ligne | 5 | 3 | 2 | 5 | **4,45** | P0-A | P0-A : OQ-MK-05, OQ-BR-25 |
| 3 | IMP-01 | Paiements locaux au checkout | 5 | 3 | 3 | 5 | **4,30** | P0-A / P0-B | P0-A : OQ-MK-01, OQ-MK-07, OQ-PAY-03, OQ-PAY-07, OQ-PAY-13, OQ-PAY-22 ; P0-B : OQ-MK-02, OQ-MK-03, OQ-PAY-04, OQ-PAY-05 |
| 4 | IMP-09 | KYC par statut avant paiement | 5 | 3 | 3 | 5 | **4,30** | P0-A | P0-A : OQ-BR-21, OQ-BR-25 |
| 5 | IMP-16 | Géofencing frontières et zones | 5 | 3 | 3 | 5 | **4,30** | P0-A lite / P1 / P2 | P0-A lite : OQ-MK-05 ; P1 : OQ-BR-17 |
| 6 | IMP-06 | WhatsApp transactionnel | 4 | 2 | 2 | 5 | **4,25** | P0-A | aucune OQ-MK / OQ-PAY bloquante ; OQ-BR-25 |
| 7 | IMP-12 | Contrat e-signé + constancia | 4 | 2 | 2 | 5 | **4,25** | P0-A | P0-A : OQ-MK-01, OQ-BR-24 |
| 8 | IMP-19 | Console Pro multi-agences | 5 | 4 | 2 | 5 | **4,25** | P0-A / P1 | P0-A : OQ-MK-07 |
| 9 | IMP-21 | Onboarding pro express | 4 | 2 | 2 | 5 | **4,25** | P0-A / P1 | P0-A : OQ-MK-01, OQ-MK-05 |
| 10 | IMP-02 | Caution sans carte de crédit | 5 | 3 | 4 | 5 | **4,15** | P0-A / P0-B / P1 | P0-A : OQ-PAY-06 ; P0-B : OQ-MK-02, OQ-PAY-02, OQ-PAY-05, OQ-PAY-13 + règles réseaux |
| 11 | IMP-07 | Support WhatsApp-first multilingue | 4 | 3 | 2 | 5 | **4,05** | P0-A lite / P1 | P0-A : OQ-MK-05 |
| 12 | IMP-13 | Facture électronique PAC/SIFEN | 4 | 3 | 2 | 5 | **4,05** | P0-A / P1 | P0-A : OQ-MK-06, OQ-PAY-15, OQ-BR-14 |
| 13 | IMP-17 | Intégration GPS tiers | 4 | 3 | 2 | 5 | **4,05** | P1 | P1 : OQ-MK-05 |
| 14 | IMP-31 | Partenariats hôtels et tour-opérateurs | 4 | 2 | 2 | 4 | **4,00** | P1 | — |
| 15 | IMP-14 | Protection assureur partenaire + garantie | 5 | 4 | 4 | 5 | **3,95** | P0-A / P1 | P0-A : OQ-MK-05 ; P1/P2 : OQ-BR-16 |
| 16 | IMP-04 | Versements rapides sur rails locaux | 4 | 3 | 3 | 5 | **3,90** | P0-B | P0-B : OQ-MK-02, OQ-MK-03, OQ-PAY-04, OQ-PAY-05, OQ-PAY-14 |
| 17 | IMP-18 | Score de risque LATAM | 4 | 3 | 3 | 5 | **3,90** | P0-A / P1 | P0-A : OQ-BR-25 ; P0-B : OQ-MK-02 |
| 18 | IMP-27 | Litiges transparents | 4 | 3 | 3 | 5 | **3,90** | P0-A / P1 | P0-A : OQ-BR-24, OQ-MK-01 |
| 19 | IMP-03 | Remboursement multi-rails | 3 | 2 | 2 | 5 | **3,85** | P0-B / P1 | P0-B : OQ-MK-02, OQ-PAY-06, OQ-PAY-07 |
| 20 | IMP-20 | API ouverte + iCal bidirectionnel | 4 | 3 | 2 | 4 | **3,80** | P0-A / P1 | aucune OQ-MK / OQ-PAY bloquante |
| 21 | IMP-22 | Réservation en marque blanche | 4 | 3 | 2 | 4 | **3,80** | P1 | P1 : OQ-MK-07 |
| 22 | IMP-23 | Pricing pour marchés à faible densité | 4 | 3 | 2 | 4 | **3,80** | P1 | — |
| 23 | IMP-24 | Tableau de bord revenus + simulateur | 3 | 2 | 1 | 4 | **3,75** | P1 | — |
| 24 | IMP-34 | Recherche par usage et route | 3 | 2 | 1 | 4 | **3,75** | P2 (corrigé VERIF_10-V10-14) | — |
| 25 | IMP-28 | Réputation, badges, caution réduite | 3 | 2 | 2 | 4 | **3,60** | P1 | — |
| 26 | IMP-36 | Éligibilité véhicules P2P (prenda) | 3 | 2 | 2 | 4 | **3,60** | P1 | — |
| 27 | IMP-35 | App tolérante à la faible connectivité | 3 | 3 | 1 | 4 | **3,55** | P1 | — |
| 28 | IMP-25 | Aéroport via points homologués + suivi de vol | 4 | 3 | 4 | 4 | **3,50** | P1 | P1 : OQ-MK-08 |
| 29 | IMP-33 | Moyenne durée expatriés et nomades | 4 | 3 | 4 | 4 | **3,50** | P2 (corrigé VERIF_10-V10-14) | — |
| 30 | IMP-29 | Parrainage double face | 3 | 2 | 3 | 4 | **3,45** | P1 | — |
| 31 | IMP-32 | Comptes entreprises | 3 | 3 | 2 | 4 | **3,40** | P2 | — |
| 32 | IMP-26 | Panapass et amendes | 3 | 2 | 2 | 3 | **3,35** | P1 | — |
| 33 | IMP-08 | Relais de messagerie masqué pré-réservation | 3 | 3 | 3 | 4 | **3,25** | P1 | — |
| 34 | IMP-37 | Onboarding fiscal des hôtes particuliers | 3 | 3 | 3 | 4 | **3,25** | P2 | — |
| 35 | IMP-11 | Inspection de dommages par IA | 3 | 4 | 3 | 4 | **3,05** | P1 | — |
| 36 | IMP-30 | Fidélité légère | 2 | 2 | 2 | 3 | **2,95** | P2 (fusion IMP-28) | — |
| 37 | IMP-38 | Automatisations sans code | 2 | 3 | 1 | 3 | **2,90** | P2 (fusion IMP-06/19) | — |
| 38 | IMP-15 | Fonds mutuel discrétionnaire | 3 | 5 | 5 | 3 | **2,30** | P3 (annexe juridique) | — |
| 39 | IMP-39 | Chauffeur via transporteurs licenciés | 2 | 3 | 5 | 3 | **2,30** | P3 (annexe juridique) | — |

**Lecture (corrigé VERIF_06-V6-04, V6-10)** : le score reste exact (39/39 recalculés par VERIF_06) mais sa saisie est fragile : Loc = 5 pour 18 idées, Pot = 5 sans preuve (tout est PROPOSÉ), Eff non relié à une grille, Rsq d'IMP-04 et d'IMP-02 sous-estimés tant que l'avis remesas manque (IMP-04 : 3,60 avec Rsq = 5 ; IMP-05 : 4,25 avec Pot = 4). **Le score ne sert donc pas à choisir le P0** : le P0-A est fixé par la porte §K.0 et par le P0 minimal de VERIF_06 §4, et le détail du backlog est dans 04 (`phase_mvp`). L'ancienne fourchette « 300 000 à 560 000 USD » est **retirée** : non reproductible (somme des bornes 295–564 k$), elle chiffrait des builds complets, parties P1 comprises, et excluait le socle marketplace, la QA, la sécurité et tous les coûts tiers et d'exploitation.

### K.3 Coûts restatés en trois lignes (corrigé VERIF_06-V6-03, V6-04)

Hypothèses : une petite équipe de 2 développeurs full-stack (dont un senior) avec Claude Code, ~0,5 ETP produit/QA, design ponctuel ; revue humaine de chaque changement ; revue de sécurité avant la bêta. Les fourchettes sont des ordres de grandeur, pas des engagements ; elles ne tiennent pas compte des délais externes (avis, contrats, certification PSP), traités dans `18_MVP_AND_ROADMAP.md`.

**(A) Build assisté par IA (semaines-équipe)**

| Périmètre | Fourchette | Commentaire |
|---|---|---|
| Idées P0-A (parts P0-A d'IMP-01, 02, 05, 06, 07, 09, 10, 12, 13, 14, 16, 18, 19, 20, 21, 27 et IMP-40, 44, 45, 46) | ≈ 17–33 | somme des lignes (A) des fiches ; **non additive** avec le socle (IMP-19 recoupe calendrier et annonces, IMP-45 le back-office) |
| **P0-A complet par epics** (147 lignes de 04 ; socle, durcissement, sécurité et recette interne compris) | **≈ 21–42** | estimation de référence, énoncé unique et hypothèses dans 18 §5 (corrigé VERIF_10-V10-01) |
| **Bêta pilote** (tranche mince, colonne `beta_pilote` de 04 : 76 lignes construites, opérations manuelles pour le reste) | **≈ 8–14** | barème 6–14, borne basse relevée (intégrations KYC et PSP non accélérées) ; incluse dans les 21–42, pas en plus (corrigé VERIF_10-V10-01) |
| P0-B (encaissement, caution, débits post-trip, versements, rapprochement) | ≈ 5–10 | après avis ; hors éventuelle mise en conformité LBC |
| P1 | ≈ 35–76 | barème par ligne identique au P0-A (342 lignes, lignes seules) ; l'ancienne fourchette 25–45 supposait des lignes 2 à 2,5 fois plus légères sans justification ; à ré-estimer par epic avant toute date (corrigé VERIF_10-V10-02) |

**(B) Coûts tiers, à chiffrer par devis** : PSP (Tilopay, secours dLocal / BAC : commissions, frais fixes, frais Yappy, certification) ; fournisseur KYC / liveness ; BSP WhatsApp et messages Meta ; SMS de repli ; PAC (si entité panaméenne) puis fournisseur SIFEN (Paraguay) ; signature électronique qualifiée (Paraguay) ; hébergement, stockage des photos, sauvegardes, monitoring ; outil de helpdesk ; avocats (Panama : art. 288, remesas, contrats ; États-Unis : MTL ; Paraguay : statut PSP) ; expert-comptable ; courtier et assureur (attestations de polices flotte, puis produit P2P) ; plus tard : API GPS, statut de vol, inspection IA, payouts, réserve de garantie.

**(C) Coûts d'exploitation, inducteurs** : support humain es/en (plages horaires, puis 24/7 en P1) ; ops KYC, KYB et revue des annonces ; revue des réservations à risque ; instruction des dommages et litiges ; onboarding et customer success des agences ; facturation et recouvrement des commissions ; comptabilité et fiscalité ; en P0-B, rapprochement quotidien et trésorerie des fonds de tiers ; astreinte sécurité (P1). Ces postes ne sont pas réduits par l'assistance IA et seront probablement dominants la première année ; le point mort (véhicules actifs × commission face à (B) + (C)) reste à calculer avec la commission obtenue en entretiens (OQ-MK-07) (corrigé VERIF_06-V6-11).

---

## L. Les 10 vrais avantages concurrentiels (PROPOSÉ)

Critère : un avantage ne compte que s'il est **difficile à copier** par Turo, par TripWip/Drivana (entrants P2P régionaux, 14 §a.1), par les loueurs qui se digitalisent (Automarket, Localiza) ou par l'informel.

| # | Avantage (IDs) | Pourquoi c'est difficile à copier |
|---|---|---|
| 1 | **Stack de paiement locale complète** : encaissement Yappy/Clave/ACH/QR, dépôt sans carte, remboursements multi-rails, versements J+1 (IMP-01 à IMP-04) — conditionnel : en P0-A la stack est celle du PSP de chaque agence, la version complète est P0-B après avis remesas / PSP (corrigé VERIF_06-V6-02) | Exige un montage juridique (casa de remesas, PSP au BCP, OQ-BR-12), des contrats PSP pays par pays et un ledger de fonds de tiers. Turo est bâti sur Stripe et la carte (SRC_G 2.6.7, SRC_H 5.1) ; un loueur n'a pas besoin de payouts multi-parties. Plusieurs mois d'avance par pays. |
| 2 | **Protection locale négociée** avec exclusions alignées et garantie de bonne fin (IMP-14), et priorité ou exclusivité avec l'assureur | 14 §c.8 : la barrière se lève pour tout le monde dès qu'un assureur crée un produit ; un **accord de priorité ou d'exclusivité** et un historique de sinistralité propre retardent les suivants. La fragmentation assurantielle est justement ce qui a tenu Turo hors de la LATAM (14 §b). |
| 3 | **Moteur de conformité conducteur** art. 110/111 PA, Mercosur et IDP PY, intégré avant paiement (IMP-09, IMP-33) | Connaissance réglementaire fine et règles maintenues ; Turo n'a aucune règle de statut migratoire (11 EC-50) ; un acteur généraliste les découvrira par ses sinistres. |
| 4 | **Antivol sans matériel** : connecteurs vers les GPS déjà installés, géofences frontalières, score de risque local (IMP-16 à IMP-18) | Connecteurs à construire fournisseur par fournisseur ; polygones et règles calibrés sur les vols réels ; les données d'incident propres s'accumulent avec le temps. Leçon Getaround (14 §b) : le concurrent qui choisit le boîtier propriétaire porte un coût que nous n'avons pas. |
| 5 | **Logiciel de travail des loueurs** : console multi-agences, API ouverte, marque blanche, factures pour leur compte (IMP-19 à IMP-22, IMP-13) | Coût de changement : le loueur qui gère son planning, sa vente directe et sa facturation chez nous ne part pas pour quelques points de commission. Turo a fermé son API en 2023 (SRC_H 8) ; un P2P pur comme TripWip vise les particuliers. |
| 6 | **Facturation électronique native PAC/SIFEN** pour la plateforme et les loueurs (IMP-13) | Intégrations fiscales nationales lourdes et règles mouvantes (projet 30-26, RG DNIT 52/2026) ; aucun acteur étranger ne les fera avant d'avoir une base de clients locale. |
| 7 | **Preuve de bout en bout** : état des lieux signé hors ligne, contrat e-signé avec constancia, dossier de litige partagé (IMP-10, IMP-12, IMP-27) | Copiable en partie techniquement, mais la valeur vient de l'acceptation par les acteurs locaux (ACODECO, juges de transit, assureurs) et d'un historique de décisions cohérentes : cela prend du temps. |
| 8 | **Relation WhatsApp-first** en ES/EN, puis PT et guaraní oral (IMP-06, IMP-07) | La technologie est copiable ; l'exploitation (agents bilingues, 24/7 à partir du P1 (corrigé VERIF_06-V6-08), base de connaissances locale, SLA tenus) ne l'est pas rapidement et coûte cher à un acteur distant. |
| 9 | **Densité pro dès le jour 1** grâce à l'onboarding express et aux contrats-cadres avec les petits loueurs (IMP-21) | Premier entrant sur l'offre professionnelle locale : les flottes déjà intégrées et satisfaites constituent un fossé ; c'est l'erreur de densité qui a tué Pegcar (14 §b). |
| 10 | **Points de remise homologués et réseau de partenaires hôteliers et touristiques** (IMP-25, IMP-31) — P1, après OQ-MK-08 (corrigé VERIF_06-V6-09) | Relations locales négociées une par une (hôtels, parkings, tour-opérateurs, éventuellement Tocumen S.A.) ; un acteur sans équipe sur place ne peut pas les reproduire vite. |

**Ce qui n'est pas un avantage durable** : le prix tout compris (IMP-05) et le simulateur (IMP-24) sont indispensables mais copiables en quelques semaines ; leur valeur est d'être **là le premier jour**.

---

## M. Idées envisagées puis rejetées (PROPOSÉ)

| Idée | Pourquoi elle est rejetée (ou reportée sans ID) | Source |
|---|---|---|
| **Boîtier télématique propriétaire** (type Getaround Connect ou Turo Go) au lancement | Coût matériel et logistique cité parmi les facteurs de l'échec de Getaround ; Turo Go a disparu du centre d'aide actuel ; des GPS tiers existent déjà dans les flottes (IMP-17). | 14 §b, §c.7 ; SRC_G 6.1.4 ; SRC_H 6 |
| **Segment VTC (Uber, InDrive, Bolt) en P2P** | Échecs de HyreCar et de Moobie (sinistralité, usure, impayés, fraude) ; instabilité réglementaire (DE 10/2026 abrogé) ; insécurité des chauffeurs au Paraguay. Éventuellement plus tard, avec des flottes pros seulement. | 12 §1.4, §5.3 ; 13 §1.5 ; 14 §b |
| **Option « sortie vers le Costa Rica » ou « Mercosur »** au lancement | Trafic de véhicules volés vers le Costa Rica ; exfiltration au Paraguay ; autorisation notariée, carta verde et registre argentin non validés (OQ-BR-18). Option Mercosur à réexaminer en P3. | 12 §9.11 ; 13 §4.7 ; 11 EC-45/46 |
| **Coupure moteur automatique à distance** comme réponse par défaut au géofencing | Légalité non établie (OQ-BR-17) et risque pour la sécurité si le véhicule roule ; conservée seulement comme action manuelle, véhicule à l'arrêt, après validation juridique (IMP-16). | 22 OQ-BR-17 |
| **Paiement en espèces remis à l'hôte au moment du retrait** | Recrée le marché gris (pas de trace, pas de commission, aucun recours) ; Turo l'interdit aussi. Le cash est servi via des rails traçables (ACH, QR, Yappy) ; d'éventuels réseaux d'encaissement en espèces via un PSP sont à étudier sans ID, car aucun réseau de ce type n'est documenté dans la recherche. | SRC_G 7.17 ; 08 BR-TRUST-02 |
| **BNPL (Affirm, Klarna, Afterpay) au lancement** | Ces fournisseurs ne sont pas documentés au Panama ni au Paraguay dans la recherche ; Turo les exclut déjà dès qu'il y a un dépôt ; l'enjeu local n'est pas le crédit mais l'absence de carte, que traitent IMP-01 et IMP-02. | SRC_G 2.6.5, 2.5.4 |
| **Frais de service guest « fondés sur le risque », non publiés** (type Turo Risk Score sur le prix) | Contraire au positionnement prix final (IMP-05) et exposé au droit de la consommation (ACODECO, SEDECO) ; le risque se traduit plutôt en caution ou en justificatifs (IMP-18). | 09 §3 ; SRC_H 9.1 ; 12 §3.7 |
| **Comptoirs en propre à Tocumen ou ASU dès le P0** | Licitation, droit d'entrée et minimum garanti (12 §9.7) ; coût fixe incompatible avec un MVP ; les comptoirs des loueurs partenaires et les points homologués suffisent (IMP-25). | 12 §9.7 ; 13 §9.7 |
| **Assureur captif ou porteur de risque en propre** | Capital et agrément hors de portée d'une startup au lancement ; Turo ne l'a fait qu'à grande échelle. Le fonds mutuel (IMP-15) reste une piste P3, et seulement s'il est légal. | SRC_H 9.1 |
| **Interface écrite complète en guaraní** | Faible usage écrit attendu (INFÉRÉ) ; la valeur est au téléphone et sur WhatsApp à l'oral (IMP-07). À réévaluer avec des données d'usage. | 13 §4.8 |
| **Programme de points coalisé** (compagnie aérienne, banque) au lancement | Coûteux et sans preuve d'effet ; Turo a lui-même arrêté sa fidélité guest en 2025. Remplacé par des avantages fondés sur la confiance (IMP-28, IMP-30). | SRC_G 9.1 |
| **Chauffeur fourni par la plateforme** | Requalification en transport de passagers (DE 331/2017) et lobby du transport ; remplacé par la simple mise en relation avec des transporteurs licenciés (IMP-39, P3). | 12 §9.13 ; 22 OQ-BR-15 |
| **Pénalités de visibilité si le prix s'écarte de la recommandation** (comme Turo à +20 %) | Dans un marché à faible densité, cela ferait fuir l'offre pro, qui a sa propre politique de prix ; IMP-23 recommande sans sanctionner. | SRC_H 3.1 |
| **Mode « demande de réservation » généralisé** | Les délais de réponse dégradent la conversion ; à n'ouvrir éventuellement qu'à certains loueurs pros (question OQ-BR-03), pas comme règle par défaut. | 22 OQ-BR-03 ; SRC_H 6 |
| **Sous-location de véhicules aux chauffeurs VTC par des flottes pros dès le P0** | Même avec des flottes, la recherche recommande d'attendre 6 à 12 mois de données de sinistralité. | 12 §1.4 (corrigé VERIF_02-C-06) |

---

## N. Idées ajoutées après VERIF_06 (PROPOSÉ)

Idées manquantes listées par VERIF_06 §3, au même format abrégé. Elles ne sont pas notées dans §K (la phase prime sur le score).

### IMP-40 — Facturation de la commission aux loueurs, relevé mensuel et contrat-cadre (corrigé VERIF_06-§3.1)
**Statut : PROPOSÉ**
1. **Problème résolu** : le modèle économique recommandé pour la Phase 0 (12 §10.3 : l'agence encaisse, la plateforme facture sa commission) n'avait aucune fiche.
2. **Solution proposée** : contrat-cadre signé en ligne (service facturé au loueur, parité de prix, non-contournement, KYB, polices, mandat) ; commission par agence (défaut 12 %, fourchette à tester 10–20 %) sur les trips terminés ; relevé mensuel par trip ; facture et relance ; suspension des nouvelles réservations à J+30 d'impayé. 04 : FIN-018, PYO-013, LEG-025.
3. **Lancement** : **P0-A**. 4. **Coût** : (A) 1–2 semaines-équipe ; (B) PAC si entité panaméenne, avocat pour le contrat ; (C) facturation et recouvrement.
- **Dépendances** : IMP-13, IMP-21 ; **portes** : OQ-MK-01, OQ-MK-06, OQ-MK-07.

### IMP-41 — Prérequis juridiques du P0, avec échéance avant tout build de paiement (corrigé VERIF_06-§3.2)
**Statut : PROPOSÉ (non produit)**
1. **Problème résolu** : les conditions bloquantes de 12 §10.3 (art. 288, casa de remesas, MTL, statut PSP au Paraguay, polices flotte) n'étaient rattachées à aucune idée.
2. **Solution proposée** : liste datée des avis à obtenir, propriétaire, échéance et effet sur le périmètre (P0-A, P0-B, bascule Paraguay) ; suivie dans 18 §4 (chemin critique).
3. **Lancement** : **avant P0-A** (l'avis OQ-MK-01 conditionne le pays). 4. **Coût** : (A) 0 ; (B) avocats Panama, États-Unis, Paraguay, comptable ; (C) pilotage.
- **Portes** : OQ-MK-01 à OQ-MK-06, OQ-PAY-03 à OQ-PAY-05.

### IMP-42 — Vérification des polices flotte et avenant « distribution par plateforme » (corrigé VERIF_06-§3.3)
**Statut : PROPOSÉ**
1. **Problème résolu** : condition 6 bloquante de 12 §10.3 ; IMP-14 la mentionnait sans en faire un prérequis.
2. **Solution proposée** : attestation de l'assureur, échéancier de validité, exclusion « location via tiers » contrôlée, dépublication automatique à l'expiration. 04 : PRT-019, PRT-009, LST-013.
3. **Lancement** : **P0-A**. 4. **Coût** : (A) 0,5–1 semaine-équipe (inclus dans IMP-14) ; (B) courtier, coût d'un éventuel avenant ; (C) suivi des échéances.
- **Portes** : OQ-MK-05.

### IMP-43 — Fraude spécifique LATAM (corrigé VERIF_06-§3.4)
**Statut : PROPOSÉ**
1. **Problème résolu** : IMP-18 ignorait les faux justificatifs Yappy/ACH (captures d'écran), les liens de paiement frauduleux, les fausses cédulas et faux permis, le SIM-swap sur les codes WhatsApp/SMS et les vols sur commande (12 §2 : ~20 M$ de fraudes bancaires confirmées, > 5 000 plaintes pour escroquerie).
2. **Solution proposée** : P0-A : règles simples dans la revue de risque et preuve de paiement par webhook (IMP-44) ; P1 : contrôles dédiés (re-vérification après changement de numéro, contrôle documentaire renforcé, signaux d'appareil). 04 : ADM-029, PAY-034, SUP-019.
3. **Lancement** : **P0-A** (règles) / **P1**. 4. **Coût** : (A) inclus dans IMP-18 en P0-A, 1–2 en P1 ; (B) signaux d'appareil, KYC renforcé ; (C) analyste fraude.
- **Portes** : OQ-BR-25.

### IMP-44 — Preuve de paiement non réversible avant la remise des clés (corrigé VERIF_06-§3.5)
**Statut : PROPOSÉ**
1. **Problème résolu** : avec Yappy ou un lien de paiement, une capture d'écran peut être falsifiée.
2. **Solution proposée** : la réservation n'est payée que sur webhook ou IPN signé du PSP de l'agence (ou confirmation de l'agence dans son back-office PSP) ; le check-in est bloqué sinon. 04 : PAY-034.
3. **Lancement** : **P0-A**. 4. **Coût** : (A) 0,25–0,5 semaine-équipe ; (B) aucun ; (C) traitement des exceptions.
- **Portes** : OQ-PAY-03.

### IMP-45 — Back-office d'exploitation (corrigé VERIF_06-§3.6)
**Statut : PROPOSÉ**
1. **Problème résolu** : presque toutes les idées P0 supposent une revue manuelle (IMP-02, 09, 18, 21, 27) sans outil prévu.
2. **Solution proposée** : console interne avec rôles, 2FA et journal d'audit ; files KYC, KYB, annonces, réservations à risque, dommages et litiges, véhicules en retard ; paramètres Panama. 04 : ADM-001 à ADM-008, ADM-014, ADM-022, ADM-029, ADM-031, CLM-006.
3. **Lancement** : **P0-A**. 4. **Coût** : (A) 1,5–3 semaines-équipe ; (B) aucun poste spécifique ; (C) ETP ops (revues, litiges).
- **Portes** : aucune.

### IMP-46 — Conformité des données et filtrage LBC des loueurs (corrigé VERIF_06-§3.7)
**Statut : PROPOSÉ**
1. **Problème résolu** : consentement biométrique et GPS, registre et conservation (Ley 81/2019, Ley 7593/2025) exigés dès IMP-09, 16 et 17 alors qu'OQ-BR-25 est P1 ; filtrage LBC/sanctions des loueurs (sujet obligé si casa de remesas, 12 §2, §9.8).
2. **Solution proposée** : consentements versionnés, politique de rétention, journal d'accès aux données personnelles, sauvegardes ; filtrage sanctions à l'onboarding des agences. 04 : VER-004, LEG-002, LEG-009, VER-028, ADM-032.
3. **Lancement** : **P0-A**. 4. **Coût** : (A) 0,5–1 semaine-équipe ; (B) liste de sanctions, avocat (durées de conservation) ; (C) traitement des demandes de droits.
- **Portes** : OQ-BR-25 (P0 dans 22, corrigé VERIF_10-V10-09), OQ-MK-02.

### IMP-47 — Intégration aux logiciels de location locaux et distribution via les agrégateurs (corrigé VERIF_06-§3.8)
**Statut : PROPOSÉ**
1. **Problème résolu** : IMP-20 reconnaît qu'aucun logiciel local n'est identifié ; les agrégateurs (Kayak, Rentcars) sont le vrai concurrent pro-first (14 §a.0).
2. **Solution proposée** : entretiens avec les loueurs avant le build pour lister leurs outils (avec OQ-MK-07) ; connecteurs en P1 ; flux vers les agrégateurs à évaluer en P2. 04 : FLT-018, MKT-018.
3. **Lancement** : entretiens **avant P0-A** ; build **P1 / P2**. 4. **Coût** : (A) 1–2 par connecteur ; (B) accès API éventuels ; (C) partenariats.
- **Portes** : OQ-MK-07.

### IMP-48 — Alternatives de caution complémentaires (corrigé VERIF_06-§3.9)
**Statut : PROPOSÉ**
1. **Problème résolu** : la caution sur carte de crédit exclut une partie des résidents ; en P0-A la caution reste chez l'agence.
2. **Solution proposée** : P0-A : politique de caution de l'agence affichée (crédit, débit, espèces, Yappy ou virement restitué) et filtre « sin tarjeta de crédito » ; P0-B : débit différé post-trip avec mandat sur carte locale, conforme aux règles réseaux ; franchise portée par le loueur. 04 : PAY-035, PAY-037, PAY-039.
3. **Lancement** : **P0-A** / **P0-B** / **P1**. 4. **Coût** : (A) inclus dans IMP-02 ; (B) avis OQ-PAY-06 ; (C) litiges de caution.
- **Portes** : OQ-PAY-06, OQ-PAY-13.

### IMP-49 — B2B minimal : facture au RUC et conducteur additionnel (corrigé VERIF_06-§3.10)
**Statut : PROPOSÉ**
1. **Problème résolu** : hub régional et voyageurs d'affaires (12 §1.3, INFÉRÉ) ; IMP-32 est P2.
2. **Solution proposée** : facture de l'agence au RUC de l'entreprise et conducteur additionnel vérifié ; demande à valider en entretiens. 04 : ACC-034.
3. **Lancement** : **P1**. 4. **Coût** : (A) 0,5–1 semaine-équipe ; (B) aucun ; (C) faible.
- **Portes** : aucune.

---

*Fin du fichier. Toutes les propositions de ce document sont au statut **PROPOSÉ** ; les coûts tiers et d'exploitation sont à chiffrer par devis ; les décisions juridiques, fiscales et assurantielles dépendent des questions OQ-MK-01 à OQ-MK-07, OQ-PAY-02 à OQ-PAY-05, OQ-PAY-13, OQ-PAY-15 et OQ-BR-12, 14, 16, 24 et 35 de `22_OPEN_QUESTIONS.md` (corrigé VERIF_06-V6-01).*
