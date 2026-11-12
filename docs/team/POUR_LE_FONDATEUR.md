# Pour le fondateur — ce qui t'attend, en un seul endroit

> Tenu par l'orchestrateur et mis à jour à chaque nouvelle question. Dernière mise à jour : **2026-11-12**.
> **Rien ici ne bloque le développement.** Chaque point est nécessaire avant la mise en ligne d'un pays, ou utile plus tôt pour gagner du temps. Tant qu'un point est ouvert, l'équipe applique un défaut prudent marqué PROPOSÉ, et les interrupteurs de mise en service restent à `false`.
> Règle permanente : **jamais plus lourd que Turo** (2026-11-12). Tout contrôle plus lourd est désactivé par défaut et ne sera activé que si la loi ou un contrat l'impose, après t'en avoir parlé.

## 1. À envoyer — textes prêts

| #   | Quoi                                                               | À qui                                                                                           | Où est le texte                                                                  | Pourquoi                                                                                                |
| --- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1.1 | Demande d'offre PSP                                                | dLocal, Rapyd, Tilopay (PA), Bancard (PY)                                                       | `demande-offre-psp.md` (notes de session de l'orchestrateur ; copie sur demande) | Choisir le PSP qui répartit chaque paiement et paie les hôtes sans que Kmino détienne l'argent          |
| 1.2 | Demande d'accès à l'information : parc par marque, modèle et année | Registro de Automotores (PY, loi 5282) ; ATTT (PA, loi 6 de 2002) ; en option, douane du Panama | `demandes-registres-vehicules.md` (idem)                                         | Catalogue des véhicules à près de 100 % ; la douane du Paraguay couvre déjà 99 % des modèles identifiés |

## 2. Décisions qui engagent un contrat ou une dépense

| #   | Décision                                                           | Ce qu'on sait                                                                                                                                                                                                                                                            | Défaut appliqué en attendant                          |
| --- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| 2.1 | **Pays de lancement** (Panama ou Paraguay d'abord)                 | Le code traite les deux pays à égalité                                                                                                                                                                                                                                   | Les deux restent fermés                               |
| 2.2 | **PSP** (go / no-go)                                               | Pas de solution clé en main ; candidats principaux dLocal et Rapyd, secours Tilopay (PA, avec Yappy) et Bancard (PY) ; étude `docs/specs/09b_PAYMENT_PARTNERS_PA_PY.md`                                                                                                  | PSP simulé (`FAKE`), jamais actif en production       |
| 2.3 | **Assureur partenaire** (contrat)                                  | Sans contrat, aucun hôte n'est activable. **Questions à lui poser** : quelles preuves de propriété du véhicule il exige, âge et kilométrage maximum, couverture de l'usage en location, franchise                                                                        | `insurer_contract_active` = `false`                   |
| 2.4 | **Fournisseur de vérification d'identité**                         | Veriff, Sumsub, Shufti, Didit, MetaMap, etc. annoncent PA et PY ; **à faire confirmer par écrit** : permis de conduire PA et PY, passeports et permis étrangers (touristes), vérification du visage, contrôle sur registre officiel, stockage des données (loi 81), prix | Fournisseur simulé                                    |
| 2.5 | **Fournisseurs SMS et e-mail**                                     | Nécessaires pour le code de vérification du téléphone et les notifications                                                                                                                                                                                               | Envoi simulé, rien ne part en production              |
| 2.6 | **Hébergement, domaine, budget mensuel** (Q-007)                   | Sauvegardes et alertes (Q-008) et exercice de restauration dans le cloud (Q-009) ont aussi un coût                                                                                                                                                                       | Choix PROPOSÉS dans l'infrastructure, rien n'est créé |
| 2.7 | **Second approbateur humain** des interrupteurs de mise en service | La commande exige deux personnes distinctes ; sans seconde personne, aucun pays ne peut ouvrir                                                                                                                                                                           | Aucun interrupteur ne peut passer à `true`            |
| 2.8 | **Jeton GitHub du compte bot**                                     | Les agents utilisent encore le jeton du compte propriétaire ; il faut basculer sur le bot (sans droit d'admin) avant la production                                                                                                                                       | Action de ta part, avant le premier déploiement       |

## 3. Réglages à trancher en une seule fois (liste groupée, avant la mise en ligne)

Je te présenterai une liste unique avec, pour chaque réglage, la valeur recommandée (comme Turo) ; tu valides ou tu corriges.

- **57 paramètres pays « à décider »** (US-110) : durées, délais, seuils ; la production refuse de démarrer tant qu'il en reste un.
- **Plafonds de prix des annonces** : Panama 5 000 $ par jour et 10 $ par km supplémentaire ; Paraguay 35 000 000 ₲ par jour et 75 000 ₲ par km.
- **Caution** : plus de caution par défaut (DEC-FONDATEUR-21, aucune caution liée à l'âge). Restent à trancher : caution pour les véhicules de **classe luxe** (oui / non) et son **montant**.
- **Âge et kilométrage maximum du véhicule** : proposé 10 ans et 200 000 km ; Turo autour de 12 ans et 130 000 miles (guides tiers). L'assureur en imposera probablement un ; « illimité » est possible si tu le préfères.
- **Préavis de réservation par défaut** : modifiable par chaque hôte ; à aligner sur la valeur par défaut de Turo.

## 4. Avis juridiques et comptables à obtenir

| #   | Question                                                                                                                                                                                                                                                                                         | Pour qui                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| 4.1 | Conditions générales du voyageur et de l'hôte, consentement biométrique, avertissements réglementaires : textes livrés comme **modèles à valider**                                                                                                                                               | Avocat                         |
| 4.2 | **Légalité de la location entre particuliers au Panama** : une source non officielle évoque des inspections techniques de l'ATTT depuis 2025 pour les véhicules mis en location ; l'avis d'opération ne semble pas exigé des personnes physiques                                                 | Avocat (PA)                    |
| 4.3 | **Statut de Kmino** : ne pas devenir transmetteur de fonds (casa de remesas au Panama, enregistrement de PSP au Paraguay) avec le montage retenu                                                                                                                                                 | Avocat, une fois le PSP choisi |
| 4.4 | **Véhicule gagé (prenda) au Paraguay** : une simple déclaration de l'hôte suffit-elle ?                                                                                                                                                                                                          | Avocat (PY)                    |
| 4.5 | **Données personnelles** : loi 81 au Panama, conservation, sous-traitants (KYC, antivirus, hébergeur)                                                                                                                                                                                            | Avocat                         |
| 4.6 | **Fiscalité de l'hôte au Paraguay** : la location d'une voiture par un particulier relève-t-elle de l'IRP, de la TVA ? Le RUC devient obligatoire dans les 30 jours ouvrables après les premiers revenus imposables (RG 69/2020) : c'est l'obligation de l'hôte, pas une condition d'inscription | Comptable (PY)                 |
| 4.7 | **Facturation électronique et ITBMS au Panama** ; facture de la commission de Kmino                                                                                                                                                                                                              | Comptable (PA)                 |

## 5. Quand tu veux, sans urgence

- **Relecture des textes en portugais** par un natif (« confirmado » dans la vérification du téléphone, vocabulaire « vérifier / confirmer »).
- **Revue des parcours** : artefact déjà publié (lien dans la conversation avec l'orchestrateur).

## 6. Déjà tranché par toi (pour mémoire)

| Date       | Décision                                                                                                                                                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-11 | Aucune limite de véhicules par hôte (DEC-FONDATEUR-19)                                                                                                                                                                                       |
| 2026-11-11 | EXC-003 ratifiée                                                                                                                                                                                                                             |
| 2026-11-12 | Antivirus des pièces : ClamAV auto-hébergé (DEC-FONDATEUR-20)                                                                                                                                                                                |
| 2026-11-12 | Aucune caution liée à l'âge du conducteur au Panama et au Paraguay (DEC-FONDATEUR-21)                                                                                                                                                        |
| 2026-11-12 | **Jamais plus lourd que Turo** : pas de pièces obligatoires du véhicule, pas de revue systématique de l'hôte ni des annonces, RUC non exigé à l'inscription, véhicule hors catalogue non bloquant (allègements en cours, vérifiés un par un) |
| 2026-11-12 | Travail continu 24 h sur 24 ; fusion autonome par l'orchestrateur quand la CI est verte et les revues approuvées                                                                                                                             |
