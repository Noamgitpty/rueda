# 01 — Synthèse pour le fondateur

> État au 2026-10-30. Synthèse des fichiers 04 à 22 ; chaque chiffre renvoie à sa source. Rien ici n'est nouveau : en cas d'écart, le fichier cité fait foi. Statuts de preuve : voir `00_README.md` §3. **Audité dans `24_FINAL_AUDIT_AND_GAPS.md` ; corrections appliquées (24 « Suivi des corrections »).**
>
> **Limites à lire d'abord** (24, A24-06 à A24-08) : (1) les observations de Turo viennent **d'une seule session** (2026-10-30) et **n'ont été rejouées par aucun tiers** (turo.com renvoie 403 aux auditeurs) ; (2) les montants du trip fee et des protections viennent **d'un seul trajet** sur un seul véhicule ; (3) les parcours trip réel, réclamation et KYC **n'ont pas été observés** : ils sont seulement documentés par le centre d'aide.

## 1. Ce que fait Turo, et comment (mécanique clé)

Turo est une place de marché de location de voitures entre propriétaires (« hôtes », particuliers ou professionnels) et locataires (« guests »). Le guest cherche par lieu et dates, réserve et paie en ligne ; Turo encaisse, vérifie le conducteur, fournit la protection et reverse à l'hôte. Observé sur le marché US (`/us/en`), le 2026-10-30, en une seule session non rejouée par un tiers.

| Mécanique | Chiffres relevés | Statut, source |
|---|---|---|
| Revenu côté hôte | l'hôte garde **70 % / 80 % / 90 %** du prix du trip selon son plan, avec une franchise par trip de **250 $ / 1 500 $ / 2 750 $** ; part dynamique 65–100 % dans 9 villes | DOCUMENTÉ, 10 §3 |
| Revenu côté guest | mesuré sur **1 trajet** (VEH-B, 3 jours) : **27,40 $ de trip fee sur 116,28 $ net (23,6 %)** ; formule non publiée ; la fourchette 22–24 % et la « non-linéarité » sont **INFÉRÉES** de ce seul point, non généralisées | DIRECTEMENT TESTÉ (1 trajet) ; généralisation INFÉRÉE, 09 §3 |
| Protection guest | 3 plans + refus ; mesuré sur **1 véhicule** (VEH-B) : **25,19 / 15,50 / 9,69 $ par jour** (Premier / Standard / Minimum, franchise 0 / 500 / 3 000 $), soit 65 / 40 / 25 % du prix journalier net **sur ce véhicule** ; non généralisé | OBSERVÉ (1 véhicule), 10 §1 |
| Part prise par la plateforme | ≈ **35 % du sous-total HT** sur un exemple **reconstitué** avec un plan hôte **supposé** (80 %), hors protection | INFÉRÉ, 09 §2 |
| Tarif non remboursable | **−10 %** sur le net ; annulation gratuite 24 h seulement | DIRECTEMENT TESTÉ, 09 §3 |
| Annulation (tarif remboursable) | gratuite jusqu'à **24 h** avant le départ (policy ; **25 h** dans l'article d'aide et défaut codé chez nous, OQ-BR-30) (ou **1 h** après la réservation si elle est faite à moins de 24 h) ; ensuite retenue de **1 jour** (trip > 2 jours) ou **½ jour** | DOCUMENTÉ, 08 BR-CXL-01, BR-CXL-06 |
| No-show | guest absent **2 h** après le départ (US) ou permis invalide → retenue plus forte | DOCUMENTÉ, 08 BR-CXL-08 |
| Paiement | payer maintenant, **plus tard (débit automatique à J−7)**, ou en plusieurs fois (BNPL) | DIRECTEMENT TESTÉ, 09 §3 |
| Confiance | vérification du conducteur **après** la réservation (permis + selfie + comparaison faciale ; biométrie conservée au plus 3 ans) ; coordonnées masquées avant réservation ; avis bidirectionnels | DOCUMENTÉ, 10 §2, §4, §5 |
| Dommages | l'hôte déclare avec photos **sous 24 h** après la fin du trip ; Turo paie au-delà de la franchise (remboursement contractuel, pas une assurance) ; RC jusqu'à 750 000 $ (Travelers) | DOCUMENTÉ, 10 §3 |

Ce que l'on retient : Turo monétise **deux fois le risque** (frais guest + commission hôte, protections payantes), réduit la friction avant paiement et sécurise après. Ses règles d'annulation et de no-show ont été reprises comme **référence de calcul** dans 08 (avec 68 vecteurs de test T01–T68), réécrites pour nos pays ([NOUS], PROPOSÉ). **Ces pourcentages de Turo ne sont pas des paramètres de notre produit** (commission par défaut 12 %, OQ-MK-07). La réutilisation fonctionnelle de ces règles est à faire valider par un avocat avant la mise en service (F-21, OQ-MK-10).

## 2. Ce que nous construisons, et en quoi nous différons

**Le produit (MVP = P0-A, 18 §0)** : une place de marché **de loueurs professionnels** (« pro-first ») au Panama et au Paraguay. **L'agence encaisse** le loyer avec son propre prestataire de paiement (PSP), prend la caution et émet sa facture ; **la plateforme facture une commission** à l'agence et **ne détient aucun fonds** (sous réserve des avis juridiques). Remise et retour **au comptoir**. Web mobile-first + **PWA installable** ; aucune application native dans le MVP (DEC-FONDATEUR-06).

**Différences voulues avec Turo** (15 §L, 14 §c, 10b) :
- **prix final tout compris** affiché dès la liste (taxe du pays comprise), en USD et en PYG ;
- **paiements locaux** via le PSP de l'agence (Yappy au Panama si la page du PSP le propose ; cartes, QR au Paraguay) ; Stripe n'est disponible ni pour une entité panaméenne ni au Paraguay (CONFIRMÉ, 12, 13) ;
- **conformité conducteur locale** (touristes, permis étrangers, art. 110/111 au Panama) contrôlée avant la remise ;
- **preuve de bout en bout** : contrat signé et horodaté, constancia bilingue, photos de remise et de retour horodatées par le serveur, dossier de litige exportable ;
- **outil de travail des agences** (console, import CSV de flotte, catalogue de véhicules local) ; relation WhatsApp-first (construite au lot 5 ; SMS / e-mail dans la Bêta) ;
- **design modifiable par le fondateur** à tout moment (back-office « Apparence / Marque », DEC-FONDATEUR-07) ; pas encore de nom de marque (DEC-MARQUE).

**Hors MVP** (18 §2) : la plateforme qui encaisse et reverse (P0-B, après avis), particuliers propriétaires (P2), protections guest (P1), livraison et aéroport hors comptoir (P1), VTC (rejeté), applications natives.

## 3. Recommandation de marché

- **GO CONDITIONNEL — Panama d'abord, Paraguay en repli explicite** (12 §10.3) : écart pondéré **2,88 contre 2,68**, porté par la demande touristique aérienne (**2,24 M** de visiteurs via Tocumen contre **≈ 0,64 M** d'arrivées à Asunción) et la profondeur de l'offre professionnelle. **L'écart est faible (+0,20 sur des notes subjectives sur 5, +0,10 dans le scénario S3) et le Paraguay passe plus de critères éliminatoires** (E4 OUI contre NON VALIDÉ, 12 §10.1) : c'est le pays le moins exposé juridiquement ; la décision se prend sur avis (DEC-PAYS) (A24-16). Le Panama n'est retenu que si un avocat panaméen confirme : (a) que le modèle n'est pas du commerce de détail réservé (**art. 288**) ; (b) que le flux « l'agence encaisse » n'est pas une activité de **casa de remesas**.
- **Décision prise** (DEC-FONDATEUR-04) : **Panama et Paraguay sont construits en parallèle** dès le premier jour (le pays est une configuration : USD / PYG, fuseaux, ITBMS 7 % / IVA 10 %, pièces d'identité, es / en).
- **Le pays de lancement reste à choisir** (DEC-PAYS, 22) sur la base des avis juridiques, **avant le démarrage du lot C** (connecteurs réels). Les avis sont désormais un préalable à la **mise en service**, pas au build (DEC-FONDATEUR-02).
- **Non démontré** : la valeur d'une marketplace de loueurs face aux agrégateurs (Kayak, Rentcars, Expedia) et le taux de commission acceptable (OQ-MK-07 ; défaut 12 % du loyer HT) → entretiens avec 5 à 10 loueurs par pays (F-16).

## 4. Périmètre : Bêta pilote puis P0-A

| Étape | Contenu | Taille |
|---|---|---|
| **Bêta pilote** (lots 0 à 4 du backlog) | 1 à 2 agences du pays de lancement, comptoir uniquement, paiement **par lien du PSP de l'agence**, KYC hébergé, revue par l'ops de chaque réservation, contrat et constancia, check-in / check-out en ligne avec photos, console à deux rôles, deux pays construits | 96 lignes construites de 04 (25 OUI, 71 SIMPLIFIÉ), 58 remplacées par des opérations manuelles, 12 différées (18 §1.0) ; 118 stories, 522 points (19 §7) |
| **P0-A complet** (+ lot 5) | bêta fermée 5 à 10 agences : KYC complet, libre-service agence, mode (a) sous mandat, messagerie, WhatsApp, litiges, grand livre miroir, facturation, rapprochement | 166 lignes de 04 ; 737 points cumulés (19 §7) |
| **Lot C** (après le choix du pays) | PSP réel du pays, facture électronique PAC ou SIFEN, KYC local, porte PAY-041 | 8 stories, 52 points provisoires |
| **P0-B** (après avis favorables) | la plateforme encaisse, caution plateforme, débits post-trip, versements | 13 lignes ; 12 stories, 64 points |

## 5. Effort (aucune promesse calendaire)

- **Équipe** : aucun développeur humain ; une équipe d'agents Claude Code (orchestrateur, agents d'implémentation, agent design, vérificateurs indépendants dont un sur un autre modèle pour l'argent et la sécurité, agent QA, red team) ; le fondateur est le seul humain (DEC-FONDATEUR-05).
- **Énoncé unique** (18 §5.0) : **Bêta pilote ≈ 170 à 300 jours-agent** ; **P0-A complet ≈ 320 à 640 jours-agent** ; lot C non compris (barème 11 à 26 jours-agent, à recalculer quand le PSP est connu). Cohérence arithmétique avec le backlog, **non mesurée** (hypothèse 1 point ≈ ½ jour-agent, choisie par le backlog) : ≈ 261 jours-agent pour la Bêta et ≈ 369 pour le P0-A ; au niveau du lot 0, le backlog (222 points ≈ 111 jours-agent) **dépasse** la fourchette du barème de 18 (A24-20).
- **Coût d'un G0 négatif** (A24-01) : G0 (OQ-MK-07) se tient au premier point hebdomadaire après le lot 0 ; si les entretiens montrent qu'aucune commission n'est acceptable, le build s'arrête après le lot 0, soit ≈ 222 points ≈ 111 jours-agent dépensés (coût assumé).
- **Aucune date n'est promise** : la vitesse réelle sera **mesurée à la fin du lot 0** (story US-027) puis recalée après le lot 1. Les goulots attendus ne sont pas le code mais **votre temps de revue**, les **limites d'usage** des agents, les **comptes externes** et les **avis juridiques**. Mise en service = max(fin du build, avis reçus, choix du pays + lot C + porte PAY-041, textes signés, polices, dotation du support) + recette pilote (2 à 4 semaines proposées).

## 6. Risques principaux

| Risque | Effet | Parade prévue |
|---|---|---|
| **Juridique Panama** : art. 288 ou casa de remesas défavorables | Panama exclu ou montage nécessaire | Paraguay construit en parallèle ; devis et délais demandés dès le début du lot 0 (18 §4) |
| **Juridique Paraguay** : statut PSP (Ley 7503, Résolution BCP n° 25) | flux de paiement à adapter | avis PY en parallèle (12 §10.3) ; le modèle « l'agence encaisse » limite l'exposition |
| **Données personnelles** : Ley 81/2019 (PA), Ley 7593/2025 (PY), biométrie KYC | sanction, blocage du KYC réel | responsable des données désigné (F-19), registre, chiffrement par sujet, avis OQ-MK-09 |
| **Assurance** : polices flotte des agences qui excluent la distribution par plateforme ; pas d'assurance P2P locale | aucune annonce publiable | attestation ou avenant exigés (OQ-MK-05) ; P2P repoussé en P2 |
| **Paiements** : PSP du pays qui refuse ou tarde (Tilopay non validé pour le Panama ; Bancard / upay au Paraguay) ; remboursements Yappy ; validité des pré-autorisations de caution | lot C bloqué | build contre un PSP factice (`FAKE`) ; porte PAY-041 ; repli « lien de paiement + confirmation » (mode b) |
| **PWA sur iOS** : photos importées de la galerie, stockage hors ligne purgé | preuve photo contestable | test au lot 0 (TRP-056, US-026) ; repli comptoir (enveloppe native ou terminal fourni) décidé fin du lot 0 (ADR-005) |
| **Technique** : anti-double réservation, isolation entre agences (RLS) et concurrence prouvables seulement sur un PostgreSQL réel | reprise de la conception | 10 preuves L0-01 à L0-10 en **tout premier** au lot 0 ; un échec bloque le lot 2 |
| **Erreur d'agent « sûre d'elle »** | défaut d'argent ou de sécurité | double revue indépendante, autre famille de modèle pour l'argent / RLS / concurrence, oracles Python indépendants, portes CI bloquantes, red team par lot |
| **Fondateur goulot**, limites d'usage | build ralenti | point hebdomadaire unique (démo + 5 décisions au plus), valeurs par défaut pour toute décision, protocole de reprise ; charge estimée au §9 |
| **Agence défaillante après avoir encaissé** (A24-14) | guest payé sans véhicule ; plaintes ACODECO / SEDECO | KYB renforcé, plafond de prépaiement des agences nouvelles, garantie ou assurance à valider (EC-57, BR-TRUST-09, OQ-MK-11) |
| **Commercial** : commission refusée, contournement après la première location | modèle non viable ; arrêt possible après le lot 0 | entretiens F-16 pendant le lot 0, G0 au premier point après le lot 0 ; clause de non-contournement et rapprochement (FIN-019) |

## 7. Décisions qui vous reviennent (22 fait foi)

Décisions **prises** le 2026-10-30 : DEC-FONDATEUR-02 (construire d'abord), -03 (paiements réels après le choix du pays), -04 (Panama et Paraguay en parallèle), -05 (aucun développeur humain), -06 (agent design, PWA), -07 (design modifiable), -08 (transmissibilité totale), -09 (tests exhaustifs), -10 (autonomie des agents, point hebdomadaire).

Décisions **en attente** — chacune a une valeur par défaut que les agents appliquent tant que vous n'avez pas tranché :

| Décision | Valeur par défaut | À décider avant |
|---|---|---|
| **DEC-MARQUE** : nom et identité (l'agent design proposera 3 à 5 noms et 2 à 3 directions) | nom de code `{brand_name}`, thème neutre | fin du lot 0 |
| **OQ-MK-07** : commission des agences | 12 % du loyer HT | porte G0 (premier point hebdomadaire après le lot 0) |
| **ADR-005** : repli du comptoir si la PWA échoue sur iOS | PWA en ligne | fin du lot 0 (résultat de TRP-056) |
| **OQ-BR-04** : jours facturés, frontière retard / extension | `grace_minutes` = 29 ; détection du retard à 30 min | point hebdomadaire avant le lot 2 |
| **UXQ-08** : revue ops avant le lien de paiement ou après paiement | revue **avant** le lien | point hebdomadaire avant le lot 2 |
| **UXQ-03** : statut et date d'entrée (fournisseur KYC ou checkout) | deux champs au checkout lus par l'ops | avant le lot 2 |
| **J-ADM-031** + OQ-BR-30 / 33 / 46 / 37 / 38 : valeurs pays (pénalités, âges, seuils) | valeurs PROPOSÉES de 17 §7.2 (25 h, 60 min, 1 jour…) | point hebdomadaire avant le lot 2 ; définitives avant la mise en service |
| **DEC-FONDATEUR-01** : la plateforme indemnise-t-elle l'agence quand l'annulation vient d'elle ? | **non** (`platform_funded_host_compensation = false`) | avant la recette du lot 2 ; au plus tard avant la mise en service |
| **UXQ-09** : durée de blocage du véhicule pendant le paiement par lien | 120 min | avant la recette de la Bêta |
| **UXQ-04** : tutoiement / vouvoiement | « tú » interface, « usted » contrat | avant la recette de la Bêta |
| **UXQ-02** : caution de chaque agence pilote | aucune promesse sans déclaration de l'agence | avant la publication des annonces pilotes |
| **UXQ-10** : délai de remboursement par l'agence | 5 jours ouvrés | avant le premier contrat-cadre |
| **UXQ-12** : remboursement garanti si la revue refuse après paiement | oui, annoncé avant paiement | avant la mise en service de la Bêta |
| **OQ-BR-45** : no-show d'une agence inéligible | rembourser le guest | avant la mise en service |
| **DEC-PAYS** : pays de lancement | aucun : les deux sont construits | avant le démarrage du lot C |
| **OQ-BR-47** : caution plateforme (P0-B) ; **DEC-NATIVE** : applications natives | formule de 08 ; aucune application | avant le P0-B ; après la bêta fermée |
| **OQ-MK-10** (F-21) : avis d'avocat sur la reprise fonctionnelle des règles de Turo et la méthode de recherche | aucun texte ni visuel de Turo repris ; plus de lecture en masse | devis pendant le lot 0 ; avis avant la mise en service |
| **OQ-MK-11** : garantie en cas de défaillance d'une agence | plafond de prépaiement (1 jour de loyer pendant les 30 premiers trips) | avant le premier contrat-cadre |

## 8. Vos prochaines actions, dans l'ordre où elles deviennent nécessaires (19 §6)

1. **Avant le lot 0** — **F-15** budget d'usage IA et cloud (abonnements Claude Code, accès API à un modèle d'un autre fournisseur pour les revues indépendantes, plafonds) ; **F-01** organisation GitHub, compte machine des agents et plan GitHub (handoff §4.10) ; **valider votre disponibilité réelle** (§9) ; préparer le poste Windows (Docker Desktop et WSL2, pnpm, GitHub CLI ; `CLAUDE_BUILD_HANDOFF.md` §5).
2. **Début du lot 0** — **F-02** compte cloud avec alertes de budget et coffre de secrets (les agents n'y ont pas accès) ; **F-03** sous-domaine technique et e-mail d'envoi ; demander par écrit **devis et délais** des **avis juridiques** (avocats PA et PY, y compris F-21), de l'avis comptable, et les délais des PSP, assureurs et fournisseurs KYC, **sans commander l'avis** (DEC-FONDATEUR-02 ; 18 §4).
3. **Pendant le lot 0** — **F-16** entretiens avec 5 à 10 loueurs par pays (commission, part confiée) ; **F-05** + **F-20** choisir le nom et la direction visuelle, recherche d'antériorité DIGERPI / DINAPI, domaine ; **F-04** comptes SMS / e-mail, cartes, suivi d'erreurs (lots 0–1) ; **F-06** point hebdomadaire et approbation des 5 premiers déploiements de production.
4. **Avant le lot 1** — **F-19** désigner le responsable des données (Ley 81 / Ley 7593) ; choisir 1 à 2 agences pilotes avant la fin du lot 1.
5. **Avant le lot 2** — **F-10** valeurs J-ADM-031 et décisions du tableau ci-dessus.
6. **Lots 3 à 4** — **F-18** devis d'assurance de la plateforme (RC pro / E&O, cyber) ; **F-17** compte WhatsApp Business (demande au lot 4) ; **F-13** séquestre des clés et exercice de transmission (lot 4).
7. **Avant le lot C** — **DEC-PAYS** ; **F-14** entité juridique, banque, enregistrement fiscal ; **F-07** contrat et bac à sable KYC ; **F-08** contrat et bac à sable PSP, comptes PSP des agences pilotes.
8. **Avant la mise en service** — **F-09** avis, CGU, contrats, mandats, attestation des polices, avis comptable ; **F-21** avis sur la reprise fonctionnelle des règles de Turo et la méthode de recherche ; **F-11** support et ops (7 h–22 h, 7 j/7 ≈ 2,6 ETP de présence, 18 C15) ; **F-12** recette réelle avec les agences pilotes ; souscription F-18.

## 9. Votre charge estimée par semaine (INFÉRÉ, à valider avant le lot 0 ; détail : 19 §6.1)

| Phase | Heures / semaine | Principaux postes |
|---|---|---|
| Démarrage (semaines 1–2 du lot 0) | 15–25 h | poste Windows (WSL 2, Docker, gh), comptes F-01 à F-04, budget F-15, premier point hebdomadaire |
| Lot 0, suite (≈ semaines 3–6) | 12–20 h | 10 à 20 entretiens de loueurs (F-16) et relevé de prix, nom et direction visuelle (F-05, F-20), demandes de devis (F-09, F-21) |
| Lots 1 à 4 (régime de build) | 4–8 h | point hebdomadaire 1,5–3 h, acceptations, décisions, 5 premiers déploiements ; pics aux portes de lot |
| Avant la mise en service | 10–20 h | avis, assurance, support, recette réelle avec les agences, entité et banque |
| Exploitation de la Bêta | 5–15 h | escalades ops et litiges |

Hypothèses : les agents préparent listes, ordres du jour et brouillons ; avocats, courtier et comptable font leur propre travail ; aucune durée calendaire n'est connue avant la mesure d'US-027. Si votre disponibilité est inférieure à la borne basse, le lot 0 et G0 reculent d'autant.
