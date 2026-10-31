# 10 — Assurance, confiance et sécurité

> Statut : EN COURS. Section 1 = observations directes ; les sections documentaires seront consolidées depuis `sources/SRC_GUEST_DOCS.md` et `sources/SRC_HOST_DOCS.md`.

## 1. Plans de protection locataire au checkout (OBSERVÉ 2026-10-30, US/Floride, SUV 2022, trip 3 jours)
Titre : « Protection plans — Voyagez en toute sérénité — Ajoutez un plan de protection qui couvre les dommages et le vol. »

| Plan | Promesse affichée | Prix |
|---|---|---|
| **Premier** | Aucun reste à charge pour dommages matériels ou vol, **sauf dommages mécaniques et intérieurs** | 25,19 $/jour |
| **Standard** | Franchise maximale **500 $** (dommage ou vol) | 15,50 $/jour |
| **Minimum** | Franchise maximale **3 000 $** | 9,69 $/jour |
| **Refuser la protection** | — | 0 |

- Mention légale : tous les trips incluent la **responsabilité civile minimale légale, en excédent** (« on an excess basis »), via la police de Turo chez **Travelers Excess and Surplus Lines Company** (lien « *Legal info »).
- Add-on séparé : **Assistance routière améliorée** — 2,99 $/jour — couvre crevaison, clés enfermées, batterie, livraison de carburant, remorquage (l'assistance de base est « gratuite » mais ces interventions sont facturées sans l'add-on — INFÉRÉ à partir du libellé « problèmes courants non pris en charge par l'assistance de base »). Bouton « Skip for now ».
- Prix des plans identiques à 22 et 30 ans (sur ce véhicule). **Formule constatée sur ce seul véhicule (VERIF_01-V09, vérifiée au centime ; généralisation à d'autres véhicules INFÉRÉE, A24-07)** : prix/jour = **65 % (Premier) / 40 % (Standard) / 25 % (Minimum) du prix journalier net** (116,28 $ / 3 j = 38,76 $ → 25,19 / 15,50 / 9,69). L'hypothèse « fonction de la valeur du véhicule » est retirée. Un plancher de 10 $/j pour Minimum cité par une source tierce est contredit (9,69 $ observés). Premier interdit aux moins de 21 ans (DOCUMENTÉ SRC_GUEST_DOCS).
- Sur la fiche véhicule : « Insurance via Travelers ».

**Implications produit (PROPOSÉ)** : modèle « protection à 3 niveaux + refus + add-on assistance » à reproduire, mais au Panama/Paraguay il faudra un assureur local partenaire (cf. 12/13). Turo tarife la protection en **pourcentage du prix journalier** ; [NOUS] faire de même avec un plancher en devise locale et un ajustement par classe de valeur si l'assureur partenaire l'exige.

## 2. Signaux de confiance observés
- Badge **All-Star Host** (« Turo's highest-rated hosts ») sur cartes et fiche.
- Note + nombre de trips, ancienneté de l'hôte, réponses publiques aux avis.
- Lien **Report listing** sur chaque fiche.
- Mention télématique / données de localisation (fiche).
- Vérification conducteur **après** réservation (bandeau checkout) → friction minimisée avant paiement, contrôle après.
- Règles de conduite avec amendes forfaitaires (fumer 150 $, saleté 150 $).

## 3. Plans hôte (« host earnings plans ») — DOCUMENTÉ (page officielle https://turo.com/us/en/car-rental/united-states/insurance, lue le 2026-10-30)
Chaque plan inclut : RC tiers (Travelers, jusqu'à $750 000), remboursement contractuel des dommages physiques, assistance routière de base, + « incidental support » et « host insights ».

| Plan | Part hôte du prix du trip | Damage responsibility (franchise hôte par trip) | Délai supplémentaire pour réclamer distance/carburant | Fréquence des « insights » |
|---|---|---|---|---|
| **More peace of mind** | **70 %** | **$250** | +2 jours | trimestrielle |
| **Balanced** | **80 %** | **$1 500** | +1 jour | semestrielle |
| **More earnings** | **90 %** | **$2 750** | 0 | annuelle |

Règles associées :
- La part hôte s'applique au **trip + frais de livraison + Extras**.
- **Part hôte dynamique selon le délai de réservation** dans 9 marchés (Austin, Dallas, Detroit, Las Vegas, Maui, Philadelphia, Phoenix, San Diego, Seattle) : 65–80 % / 75–90 % / **85–100 %** ; plus la réservation est anticipée, plus la part hôte est élevée (risque accru des réservations de dernière minute).
- Remboursement dommages = **contractuel, pas une assurance** ; Turo paie au-delà de la franchise hôte, plafonné au min(coût réparation jusqu'à ACV, $200 000).
- **Exclusions** : usure normale, perte de revenus d'hébergement (loss of hosting income), véhicule de remplacement pendant la réparation.
- Processus dommages : l'hôte notifie Turo avec **photos avant et après trip dans les 24 h suivant la fin du trip** ; un agent Turo le contacte **sous 1 à 3 jours** ; l'hôte paie sa franchise, Turo rembourse le reste.
- Assistance routière : « certain roadside assistance fees may be charged ».
- New York : RC minimale de l'État ; option More peace of mind → $300 000 combinés.

**Lecture business (INFÉRÉ)** : la plateforme monétise le risque deux fois — côté guest (trip fee ≈ 22–24 % du net, mesuré en G-BOOK-06, non linéaire + plans de protection payants) et côté hôte (commission de 10/20/30 % selon le plan, et **0 à 35 %** avec la part dynamique selon l'anticipation — corrigé VERIF_03). La franchise hôte est un levier de partage du risque très puissant à reproduire.

## 4. Page Trust & Safety (DOCUMENTÉ — https://turo.com/us/en/car-rental/united-states/trust-and-safety)
- Hôte : RC $750k + protection contractuelle contre **vol** et dommages physiques ; **« We screen each guest »** (filtrage de chaque guest) ; **ligne d'urgence 24 h** + support.
- Guest : choix du package de protection ; chaque véhicule doit respecter des **standards d'éligibilité** (sécurité, état, opérations) ; assistance routière de base + support d'urgence pendant chaque trip.
- Bonnes pratiques : consulter les profils ; noter et évaluer après chaque trip (**avis bidirectionnels**) ; **ne jamais publier adresse/email/téléphone** — Turo ne révèle **noms, numéros et lieux qu'une fois le trip réservé** (masquage des coordonnées pré-réservation) ; exclusion des membres irrespectueux.

## 5. Politiques additionnelles (DOCUMENTÉ — https://turo.com/us/en/policies/additional-policies, lu le 2026-10-30)
- **Biometric data privacy policy** (rév. 24/10/2024) : la vérification d'identité et de permis peut générer des **données biométriques (géométrie faciale)** via des prestataires tiers, en comparant une **photo fournie par l'utilisateur (selfie) et le permis** ; usage limité à la vérification + conformité légale ; **consentement préalable** là où la loi l'exige (BIPA Illinois, CUBI Texas, WA HB 1493) ; **conservation max 3 ans après la dernière interaction**.
  → Confirme le flux KYC : **selfie + photo du permis + face match** par un fournisseur (non nommé ici).
- **Cookies** : nécessaires (dont **détection de comportements irréguliers / antifraude**), performance (Google Analytics), fonctionnalité, publicité ; préférences modifiables dans le footer.
- **Insurance license disclosures** (rév. 12/09/2025) : **Turo Insurance Agency, LLC** est courtier (« insurance producer ») résident en Arizona et non-résident dans ~22 États (dont surplus lines CA, HI) → Turo a créé sa propre **agence de courtage** pour distribuer les protections.
- **Payment plan terms** (rév. 06/11/2024) : Turo peut proposer aux guests de régler en **plusieurs échéances** les **sommes dues pour frais annexes (incidentals) et réclamations dommages** ; **pas un prêt, sans intérêts ni frais** ; échéancier confirmé par email ; impayé → **cession à une société de recouvrement**.
  → Fonctionnalité back-office à prévoir : `DebtBalance` + `PaymentPlan` + transfert au recouvrement.
- Privacy supplements (Californie, CCPA) : catégories collectées incluent identifiants, géolocalisation, informations financières, **informations médicales** (?), description physique, inférences.
