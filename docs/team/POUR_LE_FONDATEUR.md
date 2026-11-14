# Pour le fondateur — ce qui t'attend, en un seul endroit

> Tenu par l'orchestrateur et mis à jour à chaque nouvelle question. Dernière mise à jour : **2026-11-14** (suites d'US-036, US-111 et US-112).
> **Rien ici ne bloque le développement.** Chaque point est nécessaire avant la mise en ligne d'un pays, ou utile plus tôt pour gagner du temps. Tant qu'un point est ouvert, l'équipe applique un défaut prudent marqué PROPOSÉ, et les interrupteurs de mise en service restent à `false`.
> Règle permanente : **jamais plus lourd que Turo** (2026-11-12). Tout contrôle plus lourd est désactivé par défaut et ne sera activé que si la loi ou un contrat l'impose, après t'en avoir parlé.

## 1. À envoyer — textes prêts

| #   | Quoi                                                               | À qui                                                                                           | Où est le texte                                                                  | Pourquoi                                                                                                |
| --- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1.1 | Demande d'offre PSP                                                | dLocal, Rapyd, Tilopay (PA), Bancard (PY)                                                       | `demande-offre-psp.md` (notes de session de l'orchestrateur ; copie sur demande) | Choisir le PSP qui répartit chaque paiement et paie les hôtes sans que Kmino détienne l'argent          |
| 1.2 | Demande d'accès à l'information : parc par marque, modèle et année | Registro de Automotores (PY, loi 5282) ; ATTT (PA, loi 6 de 2002) ; en option, douane du Panama | `demandes-registres-vehicules.md` (idem)                                         | Catalogue des véhicules à près de 100 % ; la douane du Paraguay couvre déjà 99 % des modèles identifiés |

## 2. Décisions qui engagent un contrat ou une dépense

Pour chaque point : ce qu'on sait, puis **ma suggestion** (comme Turo, avec le moins de limites possible).

**2.1 Pays de lancement.** Le code traite les deux pays à égalité ; les deux restent fermés en attendant.
→ **Suggestion** : décider après les réponses du PSP et de l'assureur. Penchant pour **le Panama d'abord** : dollar (pas de conversion), Yappy très répandu, tourisme international, versements Stripe confirmés en secours. Le Paraguay suit avec le même code.

**2.2 PSP.** Pas de solution clé en main ; étude `docs/specs/09b_PAYMENT_PARTNERS_PA_PY.md`. PSP simulé en attendant.
→ **Suggestion** : **dLocal** si son produit « Platforms » répartit les paiements et paie les particuliers dans les deux pays ; sinon **Rapyd**. **Tilopay** en complément au Panama pour accepter Yappy. Aucun montage où Kmino garde l'argent.

**2.3 Assureur partenaire.** Sans contrat, aucun hôte n'est activable.
→ **Suggestion** : un contrat comme celui de Turo, où l'assureur couvre le véhicule pendant la location et où les plans de protection sont vendus au voyageur. À négocier : **aucune pièce exigée de l'hôte** au-delà de sa déclaration, de la plaque et du VIN ; âge du véhicule le plus large possible (Turo : environ 12 ans) ; couverture de l'usage en location incluse ; franchise raisonnable.

**2.4 Fournisseur de vérification d'identité.** Veriff, Sumsub, Shufti, Didit, MetaMap annoncent le Panama et le Paraguay.
→ **Suggestion** : le moins cher de ceux qui confirment **par écrit** le permis de conduire panaméen et paraguayen **et** les permis et passeports étrangers (touristes). Parcours minimal comme Turo : permis plus selfie, pas de justificatif de domicile.

**2.5 Fournisseurs SMS et e-mail.**
→ **Suggestion** : un fournisseur SMS international avec **WhatsApp en repli** (très utilisé en Amérique latine) et un service d'e-mail transactionnel classique. Petits coûts, à l'usage.

**2.6 Hébergement, domaine, budget mensuel** (Q-007, Q-008, Q-009). Choix proposés dans l'infrastructure, rien n'est créé.
→ **Suggestion** : démarrer petit (une base gérée et quelques conteneurs), puis grossir avec l'usage. Je te présenterai un chiffrage mensuel avant de créer quoi que ce soit.

**2.7 Second approbateur humain des interrupteurs de mise en service.** La commande exige deux personnes distinctes.
→ **Suggestion** : un associé ou une personne de confiance (comptable, avocat). Son rôle : approuver l'ouverture d'un pays, rien d'autre.

**2.8 Jeton GitHub du compte bot.** Les agents utilisent encore le jeton du compte propriétaire.
→ **Suggestion** : basculer sur le jeton du bot (sans droit d'admin) avant le premier déploiement. C'est une manipulation de quelques minutes, je te guiderai.

**2.9 Paire de clés de séquestre pour l'export de portabilité (US-036, ADR-120).** Pour pouvoir changer d'hébergeur sans perdre l'accès aux données chiffrées, l'export ré-enveloppe chaque clé de données avec une **clé publique** qui t'appartient. Il faut donc une paire de clés (RSA, au moins 3072 bits) : la **clé privée reste hors ligne chez toi** (support chiffré, copie en lieu sûr), la **clé publique** est placée dans la configuration. Je ne crée jamais cette clé et je ne l'affiche jamais ; les commandes exactes sont dans `docs/ops/PORTABILITY.md` § 4 et je te guiderai pas à pas. À faire **avant le premier déploiement cloud**.
→ **Suggestion** : la générer sur un poste hors ligne, sans l'envoyer à personne, garder deux copies chiffrées de la clé privée à deux endroits différents, et ne donner que l'empreinte publique à l'équipe. Aucune limite pour les hôtes : cela ne touche que la sortie des données de la plateforme.

## 3. Réglages à trancher en une seule fois (liste groupée, avant la mise en ligne)

Je te présenterai une liste unique ; pour chaque réglage, ma valeur suggérée (comme Turo, le moins de limites) ; tu valides ou tu corriges.

| Réglage                                                                     | Proposé aujourd'hui                                                                                                                                                                                                  | **Ma suggestion**                                                                                                                                                                                                           |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 57 paramètres pays « à décider » (US-110 : durées, délais, seuils)          | à décider                                                                                                                                                                                                            | Valeurs de Turo, transposées en USD et en PYG ; liste détaillée à venir                                                                                                                                                     |
| Plafond de prix des annonces                                                | PA 5 000 $/jour, 10 $/km ; PY 35 000 000 ₲/jour, 75 000 ₲/km                                                                                                                                                         | Pas de vrai plafond pour l'hôte : seulement un seuil très haut contre les fautes de frappe                                                                                                                                  |
| Caution, véhicules de classe luxe                                           | caution, montant à décider                                                                                                                                                                                           | **Aucune caution au lancement**, même pour le luxe ; la carte enregistrée et les plans de protection couvrent les frais ; on la réactive par pays seulement si les sinistres l'exigent                                      |
| Âge et kilométrage maximum du véhicule                                      | 10 ans, 200 000 km                                                                                                                                                                                                   | **Aligner sur Turo** (environ 12 ans, environ 210 000 km) ou sur ce que l'assureur accepte, en prenant le plus large ; « illimité » si l'assureur le permet                                                                 |
| Préavis de réservation par défaut                                           | 3 h                                                                                                                                                                                                                  | Turo ne publie pas de valeur par défaut (page d'aide relue le 2026-11-13) : on garde 3 h ; chaque hôte la change par lieu (ADR-115)                                                                                         |
| Pièces du véhicule, revue de l'hôte et des annonces, RUC à l'inscription    | désactivés (règle « jamais plus lourd que Turo »)                                                                                                                                                                    | **Les laisser désactivés** ; ne les activer que si l'assureur, le PSP ou la loi l'impose                                                                                                                                    |
| Caution des véhicules de luxe et montant                                    | caution pour la classe LUXE (PROPOSÉ), montant à décider                                                                                                                                                             | Aucune caution au lancement ; à réactiver par pays si les sinistres l'exigent                                                                                                                                               |
| Délai uniforme avant approbation automatique d'un hôte                      | 24 h                                                                                                                                                                                                                 | 24 h, comparable à Turo ; il protège la discrétion des contrôles de sanctions                                                                                                                                               |
| Classe de valeur d'un véhicule non classé (douane, hors catalogue)          | aucune : le véhicule n'est jamais couvert                                                                                                                                                                            | « Standard » par défaut, sous réserve du contrat de l'assureur (**bloquant avant ouverture**)                                                                                                                               |
| Conservation des données (US-111)                                           | demandes d'accès 10 jours ; preuves de paiement 15 mois (plancher) ; engagements de l'hôte 60 mois ; 4 durées sans valeur au Paraguay                                                                                | Valider avec l'avocat ; aligner le Paraguay sur le Panama                                                                                                                                                                   |
| RPO / RTO : perte de données et délai de reprise maximums (US-112, ADR-121) | erreur récente : 15 min / 4 h ; perte de l'instance ou de la zone : 15 min / 4 h ; perte du compte ou de la région : 24 h / 8 h ; fichiers (photos, preuves) : 24 h / 8 h ; plafond de la spécification : 24 h / 8 h | Garder ces valeurs : elles sont déjà sous le plafond et testées par l'exercice de restauration ; ne pas les resserrer avant d'avoir un vrai trafic. Seule la copie hors compte (perte de région) coûte, voir Q-008 et Q-009 |
| Durées de conservation du Paraguay (US-111)                                 | 4 durées (biométrie, webhook) sans valeur au Paraguay : purge à 0 jour, donc données effacées tout de suite                                                                                                          | Reprendre celles du Panama (30 / 30 / 90 / 90 jours) par une nouvelle graine ; le plus court possible reste le plus simple pour les hôtes et les voyageurs, comme Turo. À valider avec l'avocat du Paraguay                 |

## 4. Avis juridiques et comptables à obtenir

Pour chaque point : la question, puis **ma suggestion** de réponse à faire valider.

**4.1 Conditions générales, consentement biométrique, avertissements réglementaires.** Textes livrés comme modèles à valider (avocat).
→ **Suggestion** : un avocat par pays relit les modèles en une seule fois. Garder des textes courts et clairs, comme Turo, sans clauses inutiles.

**4.2 Légalité de la location entre particuliers au Panama** (avocat). Une source non officielle évoque des inspections de l'ATTT depuis 2025 pour les véhicules en location ; l'avis d'opération ne semble pas exigé des personnes physiques.
→ **Suggestion** : faire confirmer que c'est permis. Si une inspection est obligatoire, Kmino **informe** l'hôte et lui fait cocher une déclaration, sans collecter de preuve.

**4.3 Statut de Kmino** (avocat, une fois le PSP choisi) : ne pas devenir transmetteur de fonds.
→ **Suggestion** : un montage où le PSP répartit lui-même chaque paiement ; Kmino ne touche jamais l'argent de l'hôte. L'avocat valide ce montage.

**4.4 Véhicule gagé (prenda) au Paraguay** (avocat).
→ **Suggestion** : une **simple déclaration** de l'hôte (« non gagé, ou accord du créancier ») qui engage sa responsabilité, comme Turo pour la propriété ; aucun document.

**4.5 Données personnelles** (avocat) : loi 81 au Panama, conservation, sous-traitants.
→ **Suggestion** : les déclarations obligatoires minimales, et des sous-traitants qui stockent dans la région ou sous contrat conforme. Le code garde déjà le minimum de données.

**4.6 Fiscalité de l'hôte au Paraguay** (comptable) : IRP et TVA sur la location d'une voiture par un particulier. Le RUC devient obligatoire dans les 30 jours ouvrables après les premiers revenus imposables (RG 69/2020) : c'est l'obligation de l'hôte, pas une condition d'inscription.
→ **Suggestion** : RUC **facultatif** à l'inscription ; un rappel clair de son obligation à l'hôte ; RUC exigé au premier versement seulement si le PSP l'impose.
→ **Fait (PR en brouillon, 2026-11-13)** : RUC facultatif en PA et en PY (`host_tax_id_required_for_activation` = false), rappel dans les 4 langues, numéro exigé avant l'activation seulement si le PSP ne sait pas verser sans lui (ADR-115).

**4.7 Facturation électronique et ITBMS au Panama** (comptable).
→ **Suggestion** : Kmino facture uniquement **sa commission** ; vérifier qu'un hôte particulier n'a pas à émettre de facture électronique pour une location occasionnelle, ou que la plateforme peut émettre un reçu pour lui.

**4.8 Incident de données personnelles : délai et personnes à prévenir** (avocat, OQ-MK-09 ; US-112). Par défaut, l'équipe applique **72 heures depuis la détection**, d'abord pour l'**autorité**, puis pour les **personnes touchées**. Le plan de reprise et le registre des incidents existent (`docs/ops/INCIDENT_RESPONSE.md`) ; des gabarits d'avis en espagnol sont à valider (`docs/legal/notificacion-violacion-datos-borrador.md`).
→ **Suggestion** : garder 72 h pour les deux pays, tant que l'avocat ne confirme pas un délai plus court. Panama : l'autorité de contrôle de la Ley 81 de 2019 (l'ANTAI, à confirmer) puis les personnes touchées. Paraguay : l'autorité compétente selon le texte applicable (à confirmer par l'avocat) puis les personnes touchées. Dans les deux pays, on notifie **ce qui est su** à l'échéance et on complète ensuite ; toi (ou ta personne de confiance, voir 2.7) fais l'envoi, jamais un agent.

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
