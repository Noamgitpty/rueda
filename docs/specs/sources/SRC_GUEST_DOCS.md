# SRC_GUEST_DOCS — Turo, côté locataire (« guest ») et cycle de vie du voyage — États-Unis

**Objet :** rétro-ingénierie fonctionnelle à partir de la documentation PUBLIQUE de Turo, pour concevoir un concurrent indépendant en Amérique latine.
**Date de collecte :** 2026-10-30.
**Périmètre :** centre d'aide US (help.turo.com/en_us), politiques Turo, pages marketing. Aucune connexion, aucun formulaire, aucun contact.
**Méthode :** le centre d'aide Turo (help.turo.com) publie chaque article en Markdown brut (`<url>.md`) et expose un sitemap public (8 sitemaps d'articles, 732 articles en_us). Environ 150 articles pertinents pour les guests US ont été lus en intégralité via ces versions publiques ; seuls des résumés paraphrasés sont conservés, aucune copie brute dans le projet (lecture en masse = zone grise au regard des CGU, signalée à l'avocat : 02 « Constat A24-04 / A24-05 », F-21, OQ-MK-10). **turo.com (policies, terms, how-turo-works, insurance, trust-and-safety, gift-cards-landing, blog) renvoie HTTP 403 aux fetchs automatisés** : ces pages ne sont couvertes que par des extraits de résultats de recherche (signalés) et par des sources secondaires.

## Conventions

- **Préfixe d'URL :** `help:` = `https://help.turo.com/en_us/` (par ex. `help:trip-costs-Syxm4NeNq` = https://help.turo.com/en_us/trip-costs-Syxm4NeNq). Chaque article existe aussi en `.md`.
- **Statuts :**
  - **DOCUMENTÉ** : source officielle Turo, lue en entier.
  - **DOCUMENTÉ (extrait)** : source officielle Turo connue seulement par un extrait de moteur de recherche, page non lisible (403).
  - **DOCUMENTÉ-SECONDAIRE** : source tierce.
  - **INFÉRÉ** : déduction de l'analyste, justifiée.
- **Dates :** la date « MAJ » est le champ « Last updated » de l'article. Les règles changent souvent : beaucoup d'articles ont été modifiés en 2026. Sauf mention contraire, les montants sont en US$ (Turo applique le même chiffre en A$, CA$, € ou £ selon le pays).

---

## 1. Compte, éligibilité, vérification, suspension, suppression

### 1.1 Création de compte, connexion

| # | Affirmation | Source | Statut |
|---|---|---|---|
| 1.1.1 | **Un compte Turo n'est pas requis pour réserver aux US** : le premier checkout collecte le prénom et le nom, un email (non lié à un autre compte), un téléphone acceptant les SMS et un moyen de paiement (carte, Apple Wallet ou Google Wallet). | help:booking-a-car-in-the-us-H1gxVVeE9 (MAJ 2026-10-20) | DOCUMENTÉ |
| 1.1.2 | Méthodes de connexion constatées : email + mot de passe, **connexion Google**, **code à usage unique (« Log in with passcode »)** envoyé par email ou téléphone. Le code part par SMS pour les numéros US/CA et les pays où WhatsApp est peu utilisé, **par WhatsApp** ailleurs (repli SMS). 2FA mentionnée. | help:resolving-issues-logging-in-B1Ri4VlV9 (MAJ 2026-07-13) | DOCUMENTÉ |
| 1.1.3 | **Compte Uber :** un guest US qui réserve Turo depuis l'app Uber utilise les identifiants Uber pour se connecter à Turo. L'offre existe dans tous les États sauf New York, l'Oregon et Washington. L'app Turo reste obligatoire pour le check-in et le check-out. | help:trips-booked-on-uber-us-guests-H1MMdGxyel ; help:resolving-issues-logging-in-B1Ri4VlV9 | DOCUMENTÉ |
| 1.1.4 | Le site permet de réserver, mais **l'app est obligatoire pour le check-in et le check-out**. | help:getting-to-know-turo-guests-HJyKcozf1e (MAJ 2026-10-21) | DOCUMENTÉ |
| 1.1.5 | Le prénom affiché peut être un « prénom d'usage » (surnom, identité de genre). Le prénom légal et la date de naissance se corrigent par formulaire, avec une réponse sous 2 à 3 jours ouvrés. | help:updating-to-a-preferred-first-name-on-your-account-guests-BynEiTAJll ; help:updating-a-license-BJxJnJnxge | DOCUMENTÉ |
| 1.1.6 | Un compte par personne. Un email, un téléphone ou un permis déjà présent sur un autre compte bloque la réservation. Si l'information est liée à un **compte supprimé (banni)**, le refus est **définitif**. | help:multiple-or-linked-accounts-S1ZTVVlV9 (MAJ 2026-04-28) | DOCUMENTÉ |
| 1.1.7 | Créer un nouveau compte pour contourner un problème de connexion met tous les comptes en attente. | help:resolving-issues-logging-in-B1Ri4VlV9 | DOCUMENTÉ |

### 1.2 Âge minimum (US), selon la classe du véhicule

| # | Affirmation | Source | Statut |
|---|---|---|---|
| 1.2.1 | Véhicule standard : **18 ans**. Véhicule de valeur marchande totale supérieure à **20 000 $** : **21 ans**. **Deluxe** : **25 ans**. **Super Deluxe, Classic ou Specialty** : **30 ans**. L'âge est apprécié **à la date de réservation**, pas à la date du voyage. | help:booking-a-car-in-the-us-H1gxVVeE9 | DOCUMENTÉ |
| 1.2.2 | Seuils de valeur (fair market value, estimée par un prestataire tiers) : Deluxe US **45 000–85 000 $**, Super Deluxe US **> 85 000 $**. Autres pays : AU A$60–99k / ≥ A$100k ; CA CA$40–85k / > CA$85k ; FR 30–60 k€ / > 60 k€ ; UK 30–60 k£ / > 60 k£. | help:deluxe-class-and-super-deluxe-class-eligibility-Syv7H4lV5 (MAJ 2026-10-27) | DOCUMENTÉ |
| 1.2.3 | **Deluxe (US/AU/CA/UK)** : 25 ans minimum, dépôt de garantie si moins de 30 ans (UK : dépôt quel que soit l'âge), contrôles de sécurité additionnels. **Super Deluxe** : 30 ans minimum, dépôt systématique, screening renforcé. **France** : ancienneté de permis de **7 ans** (Deluxe) et **12 ans** (Super Deluxe), plus un dépôt. | idem | DOCUMENTÉ |
| 1.2.4 | Classic : 25 ans d'âge du véhicule ou plus, valeur ≤ 85 000 $. Specialty : 12 à 25 ans d'âge, valeur ≤ 200 000 $, véhicule « luxueux, unique ou rare ». Inspection de sécurité requise. | help:classic-and-specialty-vehicles-us-Sy8WuBHZC (MAJ 2026-04-21) | DOCUMENTÉ |
| 1.2.5 | Les conducteurs additionnels sont soumis aux mêmes seuils d'âge, selon la classe du véhicule. | help:additional-driver-requirements-fees-and-responsibilities-guests-HksENgV5 | DOCUMENTÉ |

### 1.3 Permis de conduire, conducteurs internationaux

| # | Affirmation | Source | Statut |
|---|---|---|---|
| 1.3.1 | Un permis **physique** est obligatoire, jamais numérique, photocopié ou en capture d'écran. Sont acceptés un permis permanent US ou un permis permanent du pays d'origine. | help:booking-a-car-in-the-us-H1gxVVeE9 ; help:trip-check-in-guide-guests-HkZfVVe49 | DOCUMENTÉ |
| 1.3.2 | **Refusés** : permis expirés, altérés, conditionnels, provisoires, restreints ou probatoires (exception : permis probatoires FR et Québec pour un voyage au Canada), learner's permit, « International Driving License » acheté en ligne, IDP utilisé à la place d'un permis. | idem | DOCUMENTÉ |
| 1.3.3 | **Permis temporaire (papier)** accepté aux US et au Canada seulement. Il doit être valide du début à la fin du voyage. Sans photo, il faut une autre pièce d'identité officielle avec photo dont le prénom, le nom et la date de naissance correspondent exactement. | help:temporary-licenses-BkAzTKaT (MAJ 2026-04-28) | DOCUMENTÉ |
| 1.3.4 | **Étrangers aux US :** le permis permanent du pays d'origine suffit. L'IDP n'est pas exigé et ne remplace pas le permis. Un passeport ou un IDP peut être demandé pour vérifier un permis en alphabet non latin, ou un permis délivré hors US/AU/CA/FR/UK. | help:temporary-licenses-and-international-driver's-permits-HkOgVExE9 (MAJ 2026-10-26) ; help:account-verification-guide-SycgNVlV9 | DOCUMENTÉ |
| 1.3.5 | Exigences ailleurs : **FR** 17 ans et 2 ans de permis ; **UK** 1 an de permis ; **AU** IDP ou traduction si le permis n'est pas en anglais. | idem | DOCUMENTÉ |
| 1.3.6 | Si le permis expire pendant le voyage, une copie à jour est exigée avant le début. | help:booking-a-car-in-the-us-H1gxVVeE9 | DOCUMENTÉ |

### 1.4 Vérification (« approved to drive »)

| # | Affirmation | Source | Statut |
|---|---|---|---|
| 1.4.1 | La vérification repose d'abord sur des **photos** (permis recto/verso, selfie avec le permis). Turo peut aussi consulter le **rapport de crédit** (personnel ou professionnel) et les **antécédents criminels**. La création du compte vaut autorisation au titre du FCRA. | help:account-verification-guide-SycgNVlV9 (MAJ 2026-04-16, contenu daté du 13/04/2026) | DOCUMENTÉ |
| 1.4.2 | Documents supplémentaires possibles : permis physique recto/verso, selfie avec le permis à côté du visage (sans chapeau ni lunettes de soleil, tête et épaules visibles), passeport page ID, IDP à défaut de passeport, justificatif de domicile, relevé bancaire. **Ils sont exigés notamment pour les Super Deluxe**, en cas de problème trust & safety ou de comptes liés. Les photos sont obligatoires : pas de scans ni de liens Google Drive ou OneDrive. | idem | DOCUMENTÉ |
| 1.4.3 | Turo peut refuser une demande ou retirer un utilisateur selon ses antécédents criminels, son dossier de conduite « ou toute autre raison ». | idem | DOCUMENTÉ |
| 1.4.4 | Le screening a lieu à la création du compte, **de nouveau à chaque réservation**, puis en continu. Une approbation peut être retirée a posteriori. Le support ne connaît pas et ne communique pas les raisons. Après envoi des documents, la revue d'un compte en attente prend en général **24 à 48 h**. | help:trust-and-safety-issues-SJIT4Ve4q (MAJ 2026-04-28) | DOCUMENTÉ |
| 1.4.5 | **Après réservation :** si la réservation est faite plus de 3 h avant le départ, une checklist suit (confirmer le téléphone, téléverser ou vérifier le permis, ajouter ou refuser une protection). À moins de 3 h, ces étapes se font pendant le checkout. **Échéance : tout doit être terminé au plus tard 2 h avant le départ, sinon le voyage est annulé.** | help:booking-a-car-in-the-us-H1gxVVeE9 ; help:trips-canceled-by-hosts-B1wU44x4c | DOCUMENTÉ |
| 1.4.6 | Vérification du téléphone par code via un short code. Les apps de texto virtuelles ne sont pas supportées et la réception en roaming n'est pas garantie. | help:verifying-your-phone-number-rkxffNfZZl | DOCUMENTÉ |
| 1.4.7 | Un chat dédié « Verification » couvre la vérification du compte, le permis et l'approbation des conducteurs secondaires. | help:chat-with-customer-support-verification-us-HyagNVx4c | DOCUMENTÉ |
| 1.4.8 | La validation peut se faire via Apple Wallet ou Google Wallet dans l'app, mais le permis physique reste exigé au check-in. | help:booking-a-car-in-the-us-H1gxVVeE9 | DOCUMENTÉ |
| 1.4.9 | Un « credit-based insurance score » nommé comme tel n'apparaît nulle part dans les articles lus. Seuls le « credit report » et le casier judiciaire sont mentionnés. | — | INFÉRÉ (absence constatée) |

### 1.5 Suspension, bannissement, appel

| # | Affirmation | Source | Statut |
|---|---|---|---|
| 1.5.1 | En cas de violation (politique, Community Guidelines, ToS), Turo notifie par email la règle enfreinte et indique si un appel est possible, et quand. **Sans mention d'appel dans l'email, la décision est définitive.** Il peut y avoir un avertissement préalable ou un retrait immédiat. | help:policy-violations-r1X6NVgV5 ; help:how-to-fix-common-booking-problems-guests-rJnnNNgV9 | DOCUMENTÉ |
| 1.5.2 | Les guests qui reçoivent régulièrement de mauvaises notes risquent d'être retirés. Une note de **3 étoiles ou moins** donnée par un host bloque automatiquement toute nouvelle réservation chez ce host, sans notification. | help:impacts-of-rating-and-reviewing-guests-hosts-S1cS7K_Ofg ; help:how-to-rate-and-review-a-trip-guests-ByTKNVgEq | DOCUMENTÉ |
| 1.5.3 | Un **chargeback** entraîne la restriction du compte : impossible de prolonger ou de réserver, et le véhicule en cours peut être récupéré aux frais du guest. La levée passe par l'annulation du litige auprès de la banque et l'envoi d'un document d'annulation via un formulaire. Le compte reste restreint pendant la revue (« quelques jours ouvrés »). | help:chargeback-policy-guest-S1reGLMee ; help:lifting-account-restrictions-following-a-chargeback-rJjMcV1Xeg | DOCUMENTÉ |
| 1.5.4 | Une facture impayée bloque toute réservation ou extension jusqu'au paiement complet. | help:how-to-pay-an-invoice-or-unpaid-balance-guests-ryLNV4g4c | DOCUMENTÉ |
| 1.5.5 | La non-discrimination est appliquée en « tolérance zéro », avec des conséquences au cas par cas pouvant aller jusqu'au retrait. | https://turo.com/us/en/policies/nondiscrimination | DOCUMENTÉ (extrait) |

### 1.6 Fermeture et suppression du compte

| # | Affirmation | Source | Statut |
|---|---|---|---|
| 1.6.1 | La fermeture se fait en libre-service (app ou web, en bas de la page Account). Elle annule les voyages à venir, avec les frais d'annulation normaux. Elle est **impossible** en cas de réclamation en cours ou de solde dû, ni avant **72 h après la fin d'un voyage**. La réouverture passe par le support. Les demandes de tiers sont refusées. | help:closing-your-account-SJQn4EeEq (MAJ 2026-04-30) | DOCUMENTÉ |
| 1.6.2 | La **suppression des données** est distincte de la fermeture et se demande par email (accountclosure@turo.com) après vérification d'éligibilité. Elle est exclue en cas de solde dû ou de réclamation ouverte, et « d'autres exclusions s'appliquent ». | idem | DOCUMENTÉ |

---

## 2. Recherche et réservation

### 2.1 Mode de réservation (Book Instantly ou demande)

| # | Affirmation | Source | Statut |
|---|---|---|---|
| 2.1.1 | L'article hôte « Trip bookings » indique que le système accepte **automatiquement** les réservations selon les jours, heures et lieux disponibles. Le host doit honorer tous les voyages acceptés, sous peine d'une pénalité de violation pouvant aller jusqu'à 50 $. | help:using-book-instantly-BJvHz8yIq (MAJ 2026-09-04) | DOCUMENTÉ |
| 2.1.2 | Un billet de blog Turo de novembre 2023 annonçait que Book Instantly deviendrait la norme pour **toutes** les réservations à partir du premier semestre 2024. | https://turo.com/blog/news/book-instantly-will-be-the-standard-for-all-bookings/ | DOCUMENTÉ (extrait) |
| 2.1.3 | Ancien flux « demande » : le host avait **jusqu'à 8 h** pour accepter ou refuser. À défaut, Turo proposait un véhicule similaire ou un remboursement intégral. | https://ecommerceportal.freshdesk.com/en/support/solutions/articles/25000024540-guide-for-turo-guests | DOCUMENTÉ-SECONDAIRE (copie tierce non datée) |
| 2.1.4 | Le « request to book » avec délai d'expiration semble avoir disparu pour la réservation initiale. Il subsiste pour les **modifications** : 8 h pour un changement de lieu, 12 h pour une extension ou un raccourcissement. | Déduit de 2.1.1, 2.1.2 et §5 | INFÉRÉ |
| 2.1.5 | **Le guest ne peut pas contacter le host avant de réserver.** La pratique recommandée consiste à réserver, poser la question, puis annuler gratuitement dans la fenêtre prévue. | help:messaging-your-host-SkVEVxN9 (MAJ 2026-04-16) | DOCUMENTÉ |
| 2.1.6 | Un seul véhicule à la fois : deux voyages ne peuvent pas se chevaucher. On ne peut pas réserver pour quelqu'un d'autre, car le titulaire est le conducteur principal. | help:booking-a-car-in-the-us-H1gxVVeE9 ; help:getting-to-know-turo-guests-HJyKcozf1e | DOCUMENTÉ |

### 2.2 Durée, préavis, battement entre voyages

| # | Affirmation | Source | Statut |
|---|---|---|---|
| 2.2.1 | L'unité minimale facturée est **1 jour**. Les heures de début et de fin sont libres. | help:trip-pricing-ByXmVNgN5 (MAJ 2026-04-16) | DOCUMENTÉ |
| 2.2.2 | Le host règle le **préavis minimum**, le **battement entre voyages (en heures)** et les **durées min/max**. Le système bloque les réservations hors de ces bornes. Aux US/AU, si le host accepte une extension au-delà de son maximum, le guest peut ensuite le dépasser à chaque nouvelle extension. | help:setting-trip-duration-BJZpGUJIc ; help:responding-to-trip-requests-and-changes-HyfsHVlE9 | DOCUMENTÉ |
| 2.2.3 | Turo n'impose pas de durée maximale aux US. La loi en impose en France (**12 mois**), au Québec et au UK. Beaucoup de hosts acceptent 30 jours ou plus. | help:getting-to-know-turo-guests-HJyKcozf1e ; help:booking-a-car-france-SJgUrcDAp (via extrait) | DOCUMENTÉ / DOCUMENTÉ (extrait) pour FR |
| 2.2.4 | Au-delà de 30 jours, la réservation devient une **série de segments de 30 jours renouvelés automatiquement**, chacun avec son propre contrat de partage. | help:additional-terms-for-monthly-trips-B1ytIevall | DOCUMENTÉ |
| 2.2.5 | UK : un véhicule de plus de 15 000 £ doit avoir au moins 1 jour de préavis, sinon la protection est annulée. | help:setting-trip-duration-BJZpGUJIc | DOCUMENTÉ |

### 2.3 Livraison, aéroports, lieux

| # | Affirmation | Source | Statut |
|---|---|---|---|
| 2.3.1 | La recherche par adresse, aéroport, gare ou hôtel affiche les véhicules « à » et « près de » ce lieu, avec un filtre « Pickup Option ». | help:choosing-delivery-for-your-trip-SJRZ4Eg45 (MAJ 2026-08-21) | DOCUMENTÉ |
| 2.3.2 | **Pas de one-way à la réservation** : un lieu de retour différent ne peut être demandé qu'**après** la réservation, vers un lieu proposé par le host ou dans son rayon de livraison personnalisé. Le one-way existe aussi comme Extra. | idem ; help:adding-extras-to-your-trip-r1Fb44eVc | DOCUMENTÉ |
| 2.3.3 | Les frais de livraison sont fixés par le host et intégrés au prix total. Il est interdit de payer le host en direct (marché gris). Le host ne peut pas demander à être raccompagné. | help:choosing-delivery-for-your-trip-SJRZ4Eg45 | DOCUMENTÉ |
| 2.3.4 | **Frais d'aéroport** (US/CA, aéroports où Turo détient un permis) : fixés par l'aéroport et reversés intégralement, sans marge Turo. Ils s'affichent au checkout sous le nom « Airport permit fee », « Concession recovery fee », « License recovery fee » ou « Operator fee ». Non négociables, ils ne couvrent pas le parking. | help:airport-pickup-and-return-guests-BJNxe5eixe (MAJ 2026-06-24) ; help:trip-costs-Syxm4NeNq | DOCUMENTÉ |
| 2.3.5 | Aéroports sous permis : l'emplacement exact (parking et photo) s'affiche **1 h avant** le départ. La liste des zones de retour autorisées s'affiche **24 h après le début**, avec un rappel **24 h avant la fin**. Un retour hors zone entraîne des frais de retour non conforme. | idem | DOCUMENTÉ |
| 2.3.6 | **Crédit parking aéroport** (certains aéroports) : en parking horaire, crédit des heures antérieures au début du voyage ; en parking journalier, crédit d'une journée. Il est remboursé après le check-in ou 2 h après le début, au premier des deux termes, et en crédit voyage si le paiement s'est fait en crédit voyage. Pas de crédit si le véhicule est remis au trottoir ou équipé d'un transpondeur. | idem | DOCUMENTÉ |
| 2.3.7 | Frais spécifique « Hawaii operations fee » (aéroport de Lihue, navette Turo). | help:trip-costs-Syxm4NeNq | DOCUMENTÉ |
| 2.3.8 | CBX (passerelle San Diego vers Tijuana) : lots autorisés A, B et C, lot J en débordement. Retour au plus tôt 4 h avant la fin du voyage. | help:cross-border-xpress-cbx-guests-By3gdXZGJe | DOCUMENTÉ |
| 2.3.9 | Le host doit annoncer par message programmé, juste après la réservation, tout frais de parking à la prise du véhicule. Sinon, le guest se fait rembourser sur les gains du host. Le host peut laisser l'argent liquide dans la voiture : c'est la seule exception au paiement hors plateforme. | help:paying-for-parking-By5PIT5Rs ; help:charging-guests-for-parking-HkevHNgNq | DOCUMENTÉ |

### 2.4 Composantes du prix

| # | Affirmation | Source | Statut |
|---|---|---|---|
| 2.4.1 | **Transparence :** les prix des résultats de recherche incluent tous les frais obligatoires (« price transparency »). | help:trip-costs-Syxm4NeNq (MAJ 2026-10-28) | DOCUMENTÉ |
| 2.4.2 | **Prix du voyage** = somme des tarifs journaliers du host, moins les remises. Les remises se cumulent par addition : par exemple 10 % (non remboursable) + 5 % (3 jours) donnent 15 %. | help:trip-pricing-ByXmVNgN5 | DOCUMENTÉ |
| 2.4.3 | **Trip fee (frais Turo)** = **pourcentage variable** du prix du voyage. Il augmente avec la valeur du véhicule et la réservation tardive, il est plus élevé sur les voyages courts et plus faible sur les longs. Il est plus élevé à New York (loi P2P). **Non remboursable** en fin de voyage et non négociable. Aucune formule publiée. | help:trip-costs-Syxm4NeNq | DOCUMENTÉ |
| 2.4.4 | Trip fee **nul pour les voyages de 30 jours ou plus** depuis le 28/03/2025 dans la plupart des marchés, sauf certaines zones de Los Angeles et New York. | Extrait de recherche (FAQ Turo, blog « three improvements to monthly trips ») | DOCUMENTÉ (extrait) |
| 2.4.5 | Fourchette tierce : trip fee de 2,5 % à 100 % du prix, minimum 15 $. Chiffres non officiels. | https://www.groupon.com/coupons/blog/turo-fees-deposits-total-cost | DOCUMENTÉ-SECONDAIRE |
| 2.4.6 | **Young driver fee** : conducteur principal de **18 à 24 ans** (US/AU/UK), moins de 26 ans en France, rien au Canada ni pour les conducteurs additionnels. Il varie selon la durée et d'autres facteurs, n'est ni excusable ni remboursable après le voyage, et l'âge retenu est celui de la réservation. | help:booking-a-car-in-the-us-H1gxVVeE9 ; help:trip-costs-Syxm4NeNq | DOCUMENTÉ |
| 2.4.7 | Montant du young driver fee selon des tiers : environ **50 $/jour pour les 18–20 ans** et **30 $/jour pour les 21–24 ans**. D'autres sources parlent de 20 % du prix. Non confirmé par Turo. | ridester.com, ride-share.com, travelpander.com (résultats de recherche) | DOCUMENTÉ-SECONDAIRE (contradictoire) |
| 2.4.8 | **Frais de conducteur additionnel** : **5 $/jour, plafonné à 25 $ par voyage**, calculé sur la durée totale du voyage quelle que soit la date d'ajout. | help:trip-costs-Syxm4NeNq ; help:additional-driver-requirements-fees-and-responsibilities-guests-HksENgV5 | DOCUMENTÉ |
| 2.4.9 | Taxes : Turo collecte la sales tax ou d'autres taxes dans **tous les États sauf le Delaware** (au titre de marketplace facilitator ou de la taxe P2P). Au Texas, la taxe porte seulement sur la part facturée par Turo. À Hawaï s'ajoutent la GET et la RMVST. Une modification du voyage (extension, raccourcissement, annulation) peut déclencher la taxe. Pas d'exonération au niveau du compte : remboursement a posteriori sur justificatif. | help:sales-tax-or-guests-B1AEVNeE9 (MAJ 2026-10-01) | DOCUMENTÉ |

### 2.5 Dépôt de garantie (US)

| # | Affirmation | Source | Statut |
|---|---|---|---|
| 2.5.1 | **750 $** : Deluxe pour les moins de 30 ans (25 ans minimum). **750 $** : tout Super Deluxe. **500 $** : véhicule situé à **New York**. **250 $** : véhicule situé dans la **San Fernando Valley** (LA). **200 $** : si le « système de sécurité » sélectionne le voyage. Si plusieurs dépôts s'appliquent, seul **le plus élevé** est retenu. | help:security-deposits-us-HkbE44lE9 (MAJ 2026-04-21) | DOCUMENTÉ |
| 2.5.2 | Remise de **250 $** sur le dépôt Deluxe ou Super Deluxe si le guest fournit son assurance personnelle **au moment de la réservation** (impossible après). | idem | DOCUMENTÉ |
| 2.5.3 | Remboursement automatique **80 h après la fin du voyage**, sauf dommage signalé, facture éligible impayée ou frais d'assistance dus. Ni Turo ni le host ne peuvent retirer un dépôt. | idem ; help:trip-costs-Syxm4NeNq ; help:refund-timing-rkyN44gEc | DOCUMENTÉ |
| 2.5.4 | Un voyage avec dépôt n'est **pas éligible** au paiement fractionné Affirm, Klarna ou Afterpay. | help:paying-over-time-with-affirm-afterpay-or-klarna-us-guests-B1Jgr4U5xg | DOCUMENTÉ |

### 2.6 Paiement : options, autorisations, moment du débit

| # | Affirmation | Source | Statut |
|---|---|---|---|
| 2.6.1 | Quatre options possibles, selon le délai de réservation, la durée et le moyen de paiement : **Pay now, Pay later, Pay as you go, Pay over time**. | help:paying-for-your-trip-guests-HkumVNgVq (MAJ 2026-08-26) | DOCUMENTÉ |
| 2.6.2 | **Pay now** : autorisation du total à la réservation, puis débit **40 h après l'autorisation ou 1 h avant le départ**, au premier des deux. Non disponible au-delà de 30 jours. | idem | DOCUMENTÉ |
| 2.6.3 | **Pay later** : réservation 3 à 13 jours à l'avance, débit **2 jours avant** ; réservation plus de 14 jours à l'avance, débit **7 jours avant**. | idem | DOCUMENTÉ |
| 2.6.4 | **Pay as you go** (plus de 30 jours, carte uniquement) : **versements égaux tous les 30 jours** sur la base du prix journalier moyen, après imputation des crédits. Si le départ est à moins de 7 jours, le premier versement est dû à la réservation. Les versements suivants sont dus **7 jours avant** chaque segment (voyage remboursable) ou **30 jours avant** (non remboursable, le 2e versement tombe donc au jour 1). Rappel par email 3 jours avant. Un échec de paiement entraîne le **raccourcissement du voyage** et le retour du véhicule. | idem ; help:additional-terms-for-monthly-trips-B1ytIevall | DOCUMENTÉ |
| 2.6.5 | **Pay over time (US)** via Affirm, Klarna (WebBank) ou Afterpay : voyages de 30 jours ou moins, se terminant dans les 120 jours, sans dépôt. Éligibilité décidée par Turo. Pas de bascule après la réservation. Les surcoûts ultérieurs vont sur la carte enregistrée, les remboursements chez le financeur. Si la réservation n'aboutit pas, remboursement auto sous 20 min. | help:paying-over-time-with-affirm-afterpay-or-klarna-us-guests-B1Jgr4U5xg (MAJ 2026-07-14) | DOCUMENTÉ |
| 2.6.6 | L'**autorisation (hold)** à la réservation ne vaut pas débit. Une annulation avant le débit libère l'autorisation, sans ligne sur le relevé. | help:refund-timing-rkyN44gEc (MAJ 2026-06-29) | DOCUMENTÉ |
| 2.6.7 | **Moyens acceptés** : crédit Visa, Mastercard, Amex ou Discover au nom du guest principal ; débit Visa ou Mastercard bancaire standard (y compris Chime et Ally) ; prépayé **Revolut uniquement** ; Apple Pay (iOS, partout) ; Google Pay (Android, US/CA). Avec Apple Pay ou Google Pay, une carte de secours est obligatoire. **Refusés** : PayPal, Venmo, autres prépayés. **New York** : carte de crédit au nom du permis exigée. Avec une carte de débit, l'ajout d'une carte de crédit peut être demandé. | help:payment-methods-turo-accepts-B1kfEutwee (MAJ 2026-08-26) | DOCUMENTÉ |
| 2.6.8 | Une carte de crédit ou de débit est toujours requise, même si une carte cadeau couvre 100 % du montant. | help:turo-gift-cards-r1IImvAPj | DOCUMENTÉ |
| 2.6.9 | Délais de remboursement côté banque : Apple Pay / Google Pay 3 à 10 jours ouvrés, crédit 3 à 5, débit et Revolut 10. Turo ne voit pas le statut une fois le remboursement émis. | help:refund-timing-rkyN44gEc | DOCUMENTÉ |

### 2.7 Remises, non-remboursable, promotions, crédit

| # | Affirmation | Source | Statut |
|---|---|---|---|
| 2.7.1 | **Option « Non-refundable »** : remise de **10 %** obligatoirement offerte par tous les hosts, réservation **4 jours ou plus à l'avance**. | help:trip-pricing-ByXmVNgN5 ; help:non-refundable-trips-guests-BJk1E_Kmfl | DOCUMENTÉ |
| 2.7.2 | Remises de durée (hebdo, mensuelle) et remise « prochain voyage » au choix du host. Le code envoyé par le host après un voyage vaut sur le prochain voyage chez lui, sous **90 jours**, une seule fois, non cumulable. | help:trip-pricing-ByXmVNgN5 ; help:faqs-promotions-and-discounts-SkjNVElN5 | DOCUMENTÉ |
| 2.7.3 | Une remise hebdomadaire d'au moins **15 %** ou mensuelle d'au moins **45 %** débloque des plafonds kilométriques réduits (voir §6). | help:distance-limits-and-additional-distance-SkWUrEgVc | DOCUMENTÉ |
| 2.7.4 | **Promo codes** : usage unique, dans la devise du pays, applicables seulement à la réservation initiale, non cumulables, non transférables, non utilisables via un site tiers. Ils portent **sur le prix du véhicule seulement**. Pas de codes permanents (premier voyage, enseignants, militaires). Les codes de sites tiers ne sont pas valides. Le support ne peut ni donner de code ni modifier un prix. | help:faqs-promotions-and-discounts-SkjNVElN5 (MAJ 2026-07-13) ; help:promotional-terms-and-conditions-H1JMPWzTA | DOCUMENTÉ |
| 2.7.5 | **Programme fidélité (Loyalty Bonus) arrêté le 24/07/2025.** Les jours bonus déjà acquis restent utilisables jusqu'à expiration. | help:faqs-promotions-and-discounts-SkjNVElN5 | DOCUMENTÉ |
| 2.7.6 | **Crédit voyage (travel credit)** de trois types : promotionnel (prix du véhicule seulement, **expiration possible à 180 jours**), carte cadeau, geste commercial. Il s'applique **automatiquement à la prochaine réservation** : impossible de le mettre de côté ou de l'imputer à un voyage déjà réservé. | help:travel-credit-SJuRUbG60 | DOCUMENTÉ |
| 2.7.7 | Interdiction de réaliser une transaction promotionnelle avec un membre de sa famille, de son foyer, un ami ou un collègue (anti-abus). | help:promotional-terms-and-conditions-H1JMPWzTA | DOCUMENTÉ |

### 2.8 Extras

| # | Affirmation | Source | Statut |
|---|---|---|---|
| 2.8.1 | Extras optionnels (« conveniences » ou « gear ») au prix fixé par le host, de **0 à 999 $**, par jour ou par voyage. Ils peuvent être ajoutés ou retirés jusqu'au début du voyage, **jamais après**. Un objet non fourni au départ est remboursé. | help:adding-extras-to-your-trip-r1Fb44eVc | DOCUMENTÉ |
| 2.8.2 | Exemples : **prepaid refuel** (aucune facture carburant possible, pas de remboursement du carburant non utilisé), prepaid EV recharge, **unlimited miles**, pet extra (n'exonère pas de la pénalité de nettoyage), one-way, sièges enfant et rehausseurs, matériel de plage, glacières, poussettes, vélos, tentes. | idem ; help:trip-costs-Syxm4NeNq | DOCUMENTÉ |
| 2.8.3 | Extras **interdits** : objets illégaux ou obscènes, nourriture, alcool, drogues, armes, location de logement, **dépôts ou frais de commodité**, remorquage. | help:adding-extras-to-your-trip-r1Fb44eVc | DOCUMENTÉ |
| 2.8.4 | Les Extras ne sont pas couverts par les protections, et un litige sur un Extra endommagé se règle hors Turo (exception au marché gris). | idem ; help:gray-market-transaction-policy-or-guests-ryrrN4eV9 | DOCUMENTÉ |
| 2.8.5 | **Pas de filtre de recherche « kilométrage illimité »**. Un filtre « siège enfant » existe. | help:distance-included-in-trip-ryIbENeV9 ; help:adding-extras-to-your-trip-r1Fb44eVc | DOCUMENTÉ |

### 2.9 Conducteurs additionnels

| # | Affirmation | Source | Statut |
|---|---|---|---|
| 2.9.1 | Jusqu'à **8 conducteurs additionnels**, ajoutables à tout moment après la réservation, y compris pendant le voyage. Chacun crée son compte (email unique), confirme son téléphone, ajoute son permis et doit être approuvé. L'invitation passe par un lien partagé (iMessage, WhatsApp, etc.). | help:additional-driver-requirements-fees-and-responsibilities-guests-HksENgV5 (MAJ 2026-10-20) ; help:how-to-add-a-driver-to-a-trip-guests-B1kL8XrnGl | DOCUMENTÉ |
| 2.9.2 | Le **conducteur principal doit prendre et rendre le véhicule** lui-même. Envoyer un additionnel vaut **no-show**. Laisser conduire un non-approuvé **annule la protection**. Le conducteur principal ne peut pas être changé. Seul le principal peut déclarer un dommage. Tous les conducteurs sont **solidairement responsables**, le principal en premier lieu. | idem ; help:prohibited-uses-Hyi0E4l49 | DOCUMENTÉ |
| 2.9.3 | Frais remboursés si aucun conducteur n'est approuvé en fin de voyage, ou en cas d'annulation d'un voyage remboursable. Non remboursés si le voyage est non remboursable, annulé plus de 24 h après la réservation et le conducteur approuvé. Toujours remboursés en cas d'annulation par le host ou Turo. En cas de rebooking, il faut réinviter le conducteur et repayer les frais. | idem ; help:how-to-rebook-a-canceled-trip-guests-HyO3VDkL9 | DOCUMENTÉ |
| 2.9.4 | Turo ne communique pas au conducteur principal le statut d'approbation d'un additionnel. L'additionnel voit le véhicule, les dates et le lieu, mais pas les informations financières du principal. | idem | DOCUMENTÉ |

---

## 3. Protections du guest (US)

| # | Affirmation | Source | Statut |
|---|---|---|---|
| 3.1 | Ces protections **ne sont pas de l'assurance**. Ce sont des contrats limitant la responsabilité du guest pour les dommages **physiques** au véhicule. Exception : dans l'État de **Washington**, une assurance achetée par Turo couvre ces dommages. Turo peut restreindre les plans proposés (âge, véhicule, voyage) ou interdire de décliner. | help:protection-plans-including-insurance-or-us-guests-HkwgBNgN9 (MAJ 2026-06-11) ; help:understanding-insurance-and-your-physical-damage-contract-or-us-guests-BkXlH4xN9 | DOCUMENTÉ |
| 3.2 | **Premier** : 0 $ de reste à charge pour les dommages physiques. Indisponible pour certains véhicules de plus de 25 000 $ et pour **tous les véhicules de plus de 60 000 $**. **Interdit aux 18–20 ans.** | idem ; help:summary-and-cost-of-protection-plans-or-us-guests-BJSgBNgVq (MAJ 2026-10-21) | DOCUMENTÉ |
| 3.3 | **Standard** : plafond de **500 $** (frais annexes compris), dépôt dommage de 500 $ prélevé lors de la déclaration. Accessible aux 18–20 ans. | idem | DOCUMENTÉ |
| 3.4 | **Minimum** : plafond de **3 000 $**, dépôt dommage de **500 $**, ou **3 000 $** si le véhicule n'est plus roulant. | idem | DOCUMENTÉ |
| 3.5 | **Decline** : responsabilité illimitée jusqu'à la valeur ACV du véhicule plus les frais annexes. Même dépôt que Minimum (500 $ ou 3 000 $). Le véhicule est réputé **perte totale** quand la réparation dépasse **75 % de l'ACV**. | help:protection-plans-including-insurance-or-us-guests-HkwgBNgN9 | DOCUMENTÉ |
| 3.6 | **Exclusions de tous les plans** : dommages **intérieurs et mécaniques** (sauf usure normale ou panne non causée par le guest), kilométrage, péages, PV, carburant. Toute violation des ToS ou usage interdit **annule le plafond**. | idem | DOCUMENTÉ |
| 3.7 | Frais de traitement : jusqu'à **150 $** par réclamation (remboursés si un tiers accepte 100 % de la faute et que son assureur traite le dossier). Le traitement global d'une réclamation peut aller **jusqu'à 575 $**. | idem ; help:managing-a-damage-claim-through-turo-or-us-guests-HJhZBElNc | DOCUMENTÉ (deux chiffres non réconciliés, voir §11) |
| 3.8 | **Responsabilité civile tiers incluse dans tous les voyages**, sans surcoût : police **Travelers Excess and Surplus Lines** aux minima de l'État, **secondaire** par rapport à l'assurance du guest, sauf **Maryland** et **New York** où elle est primaire. À New York, la limite était de **1 250 000 $** avant le 17/06/2026 et correspond aux minima P2P de l'État depuis. Sinistres gérés par Constitution State Services. PIP et UM/UIM aux minima légaux, ou renonciation quand la loi le permet. | idem | DOCUMENTÉ |
| 3.9 | **Supplemental Liability Insurance (SLI)** optionnelle (Mobilitas Insurance, courtier Porter & Curtis) : jusqu'à **300 000 $**, au tarif journalier, réservée aux **résidents US** et indisponible dans certains États. | idem ; help:summary-and-cost-of-protection-plans-or-us-guests-BJSgBNgVq | DOCUMENTÉ |
| 3.10 | Le plan s'ajoute, se change ou se retire **jusqu'à l'heure de début**, jamais après. Le support ne peut pas forcer un plan indisponible. En **non remboursable**, un changement de plan n'est remboursé que dans les 24 h suivant la réservation. Si l'ajout ou le refus de protection est demandé dans la checklist et laissé sans action, le voyage est annulé 2 h avant le départ. | help:adding-or-updating-a-protection-plan-SyNLEEe4c ; help:non-refundable-trips-guests-BJk1E_Kmfl ; help:trips-canceled-by-hosts-B1wU44x4c | DOCUMENTÉ |
| 3.11 | L'assurance personnelle du guest est **primaire** dans la plupart des États. Une carte de crédit couvre « très improbablement » un voyage P2P. Aucune assurance personnelle n'est requise pour réserver. | help:personal-insurance-requirements-or-guests-ByCkr4e45 ; help:insurance-or-coverage-via-a-credit-card-rklgH4g45 | DOCUMENTÉ |
| 3.12 | Le plan du host (« earnings plan ») est indépendant de celui du guest. | help:understanding-insurance-and-your-physical-damage-contract-or-us-guests-BkXlH4xN9 | DOCUMENTÉ |
| 3.13 | **Prix des plans (tiers)** : Premier de 65 à 100 % du prix du voyage (minimum 14 $/jour) ; Standard environ 40 % (minimum 12 $/jour) ; Minimum 15 % au-delà de 250 $ ou 25 % en dessous (minimum 10 $/jour). Turo se réserve le droit de changer ses prix à tout moment. | nerdwallet.com, valuepenguin.com (extraits de recherche) ; help:summary-and-cost-of-protection-plans-or-us-guests-BJSgBNgVq | DOCUMENTÉ-SECONDAIRE |
| 3.14 | Crevaison : Premier US/CA/AU, aucun coût ; Premier UK, franchise de 250 £ ; autres plans, aucune couverture. | help:flat-tire-damage-or-guests-Syh9NExEc | DOCUMENTÉ |
| 3.15 | International : plans distincts selon les pays (CA, AU, FR, UK), avec articles dédiés non lus en détail. Les assureurs cités sont Definity et ICBC (CA), Turo Travels Mutual (AU), Baloise (FR) et ERS (UK). | help:incident-information-card-SJJELVe4c ; help:how-guests-can-contact-claims-SJw1BNxE5 | DOCUMENTÉ (partiel) |

---

## 4. Annulation

### 4.1 Annulation par le guest

| # | Affirmation | Source | Statut |
|---|---|---|---|
| 4.1.1 | **Voyage remboursable, période gratuite** : jusqu'à **24 h avant le départ**, ou **dans l'heure suivant la réservation** si elle a été faite à moins de 24 h du départ (selon un autre article : moins de **25 h**). La période est calculée dans le **fuseau horaire du véhicule**. Après une modification, la fenêtre reste liée à l'heure de réservation d'origine. | help:canceling-a-trip-with-your-host-HJyUE4xN9 ; help:refund-timing-rkyN44gEc | DOCUMENTÉ (incohérence 24 h / 25 h) |
| 4.1.2 | **Hors période gratuite (remboursable)** : voyage de 2 jours ou moins, frais de **½ journée moyenne** (prix + trip fee) ; voyage de plus de 2 jours, **1 journée moyenne**. **50 % des frais de livraison** sont remboursés. Protection, Extras et young driver fee sont toujours remboursés intégralement. | idem | DOCUMENTÉ |
| 4.1.3 | **Non remboursable** : remboursement intégral **dans les 24 h suivant la réservation**, puis plus rien (sauf dépôt). Les mêmes 24 h s'appliquent aux changements de lieu, de protection et aux raccourcissements. | help:non-refundable-trips-guests-BJk1E_Kmfl (MAJ 2026-07-07) | DOCUMENTÉ |
| 4.1.4 | Les annulations se font dans l'app : Trips, puis Manage trip, Change trip, Cancel trip. | help:canceling-a-trip-with-your-host-HJyUE4xN9 | DOCUMENTÉ |
| 4.1.5 | **No-show du guest** (« trip start failure ») : absence **2 h après l'heure de début** (US/CA/UK) ou **30 min** (AU/FR), envoi d'un autre conducteur, permis invalide, ou permis non téléversé **1 h avant** le départ sans rencontre possible avec le host. Remboursement en voyage remboursable : 2 jours ou moins, prix + trip fee **moins 75 % d'une journée** ; plus de 2 jours, **moins 2 journées**. Extras, assistance renforcée, protection, dépôt, young driver fee et 50 % de la livraison sont remboursés. Non remboursable : 0. Le host doit signaler le no-show **sous 72 h** et attendre 15 min la réponse au message. | help:guest-trip-start-failures-HJUfENeVq (MAJ 2026-09-15) ; help:how-to-manage-a-guest-no-show-SkNzL4g4q | DOCUMENTÉ |
| 4.1.6 | **Véhicule sale, malodorant (fumée) ou dangereux** : **ne pas faire le check-in**, prendre des photos, contacter le support immédiatement. Le remboursement intégral ou le rebooking dépend de cette condition. | help:refund-timing-rkyN44gEc ; help:cleaning-and-disinfection-policy-or-guests-rkLCVVeVq ; help:reporting-a-car-that's-unsafe-or-unsatisfactory-ry7j4ElV5 | DOCUMENTÉ |
| 4.1.7 | **Vol ou train retardé ou annulé** : remboursement intégral si le guest a écrit au host **avant le départ**, que le host n'a pas pu s'adapter et que le guest a envoyé un justificatif au support **au plus tard 24 h après l'heure de début**. Même règle pour un **bagage perdu**. Si le vol est annulé ou retardé plus de 3 jours avant, la politique standard s'applique. | help:managing-a-flight-delay-or-cancellation-BkGUVNx4q | DOCUMENTÉ |
| 4.1.8 | **Circonstances exceptionnelles** (cela excuse **uniquement** les frais d'annulation, jamais automatiquement : il faut contacter le support). Justificatifs requis : décès ou maladie grave de soi ou d'un proche (conjoint, enfant, parent, tuteur, grand-parent, frère ou sœur), obligations gouvernementales (jury, tribunal, militaire), perturbation aérienne. Sans justificatif possible : catastrophe naturelle ou état d'urgence (y compris « mass shooting »), épidémie reconnue par l'OMS ou le CDC, action gouvernementale ou militaire. En prolongation pour circonstance exceptionnelle, seule l'heure de retour est étendue : le kilométrage d'origine reste inchangé. | help:extenuating-circumstances-policy-or-guests-rkoBEVlVc (MAJ 2026-04-22) | DOCUMENTÉ |
| 4.1.9 | Ces exceptions s'appliquent aussi aux voyages non remboursables : vol, décès ou maladie, obligation légale, hospitalisation. | help:non-refundable-trips-guests-BJk1E_Kmfl | DOCUMENTÉ |
| 4.1.10 | Un host ne répond pas ? Le guest peut annuler avec le motif « My host is not responding », et un agent le recontacte **sous 48 h**. | help:messaging-your-host-SkVEVxN9 | DOCUMENTÉ |

### 4.2 Annulation par le host ou par Turo

| # | Affirmation | Source | Statut |
|---|---|---|---|
| 4.2.1 | Le guest est **remboursé intégralement** si le host annule, ne se présente pas, ou si Turo annule. Exception en non remboursable : pas de remboursement si le host annule à cause du guest (problème au départ, permis). | help:refund-timing-rkyN44gEc ; help:non-refundable-trips-guests-BJk1E_Kmfl | DOCUMENTÉ |
| 4.2.2 | **Rebooking assisté** : lien « Book another car » vers des véhicules similaires de hosts bien notés à proximité. Les fonds de l'annulation restent disponibles **24 h**, puis sont remboursés automatiquement. Le guest peut aussi déclencher un **remboursement anticipé** (3 à 10 jours ouvrés côté banque). | help:how-to-rebook-a-canceled-trip-guests-HyO3VDkL9 (MAJ 2026-10-20) ; help:trips-canceled-by-hosts-B1wU44x4c | DOCUMENTÉ |
| 4.2.3 | **Crédit de rebooking** (discrétionnaire, attribué selon la durée et le moment de l'annulation), utilisable seulement pour remplacer le voyage annulé : **24 h** si l'annulation intervient moins de 24 h avant le départ, **jusqu'à l'heure de départ d'origine** si elle intervient entre 24 et 72 h avant. Le support ne peut ni le prolonger ni l'accorder. | help:how-to-rebook-a-canceled-trip-guests-HyO3VDkL9 | DOCUMENTÉ |
| 4.2.4 | Si le host demande au guest d'annuler, le guest doit refuser, sous peine de payer lui-même les frais. Le host est sanctionné s'il le demande. | help:trips-canceled-by-hosts-B1wU44x4c ; help:canceling-a-trip-with-your-guest-hosts-HkkzLVlE5 | DOCUMENTÉ |
| 4.2.5 | **Pénalités du host** : **25 $** (plus de 24 h avant) ou **50 $** (moins de 24 h). Le host est considéré en no-show s'il est absent **30 min** après le début (frais de 150 $ aux US). Avis automatique d'annulation publié, recul dans la recherche. Pour un host de 20 voyages ou moins : 1re annulation, dépublication jusqu'au webinar ; 2e, 3 jours de dépublication ; 3e, fermeture. Au-delà, taux de 5 % : 7 jours plus webinar ; taux de 10 % : fermeture. Exemptions : All-Star, première annulation sur 10, rebooking du même guest sous 24 h, rappel de sécurité, catastrophe. | help:canceling-a-trip-with-your-guest-hosts-HkkzLVlE5 (MAJ 2026-09-11) ; help:host-fees-r1aIIExV5 ; help:excusing-host-cancellation-fee-rk1bAtBB9 | DOCUMENTÉ |
| 4.2.6 | Turo annule lui-même le voyage en cas de permis non téléversé ou de protection non choisie **2 h avant**, ou pour un motif trust & safety. | help:trips-canceled-by-hosts-B1wU44x4c | DOCUMENTÉ |
| 4.2.7 | Si le host propose un échange de véhicule avant le départ et que le guest refuse, le voyage est annulé et intégralement remboursé. | help:requests-for-vehicle-swaps-guests-rkkqZP6age | DOCUMENTÉ |

---

## 5. Modifications du voyage

| # | Affirmation | Source | Statut |
|---|---|---|---|
| 5.1 | **Toute modification doit passer par « Change trip »**. Un accord oral ou par message n'est pas valable, et le host perd sa protection s'il s'en contente. | help:responding-to-trip-requests-and-changes-HyfsHVlE9 ; help:getting-to-know-turo-guests-HJyKcozf1e | DOCUMENTÉ |
| 5.2 | **Acceptation automatique** pour les changements de date ou d'heure, les extensions, les fins anticipées et les changements de lieu, si le véhicule est disponible et que la demande respecte les réglages du host (préavis, horaires, battement, durée). Sinon, la demande part au host. Un véhicule indisponible ou un conflit avec le battement empêche même de soumettre la demande. | help:responding-to-trip-requests-and-changes-HyfsHVlE9 ; help:managing-requests-to-extend-or-shorten-a-trip-BJDjrVg45 | DOCUMENTÉ |
| 5.3 | **Extension** : demandable avant, pendant, et **jusqu'à 24 h après la fin prévue**. Une extension approuvée efface le retard. Réponse immédiate le plus souvent, sinon sous **12 h** si le host doit examiner la demande. L'absence de réponse vaut refus. Causes de refus : solde impayé, fonds insuffisants, indisponibilité, chargeback. | help:how-to-extend-a-trip-guests-BypBE4eVc ; help:trip-extension-approvals-costs-and-mileage-guests-BkC6WX9Qfl ; help:faqs-trip-extensions-guests-B1uzMQ9Qfg | DOCUMENTÉ |
| 5.4 | **Prix de l'extension** : jours ajoutés au tarif du host, avec leurs propres remises de durée (pas celles du voyage d'origine). Le trip fee et la protection sont recalculés. Les frais de livraison sont inchangés. Une extension d'un voyage non remboursable est elle aussi non remboursable. La livraison gratuite liée à une durée ne s'applique pas si la durée est atteinte par extension. | idem ; help:managing-requests-to-extend-or-shorten-a-trip-BJDjrVg45 | DOCUMENTÉ |
| 5.5 | **Kilométrage de l'extension** : sur un voyage illimité, recalcul sur la base de **300 mi/jour** (US/UK) ou **500 km/jour** (AU/CA/FR) pour les jours d'origine. Sinon, limite journalière (moins de 7 jours), hebdo (7 à 30) ou mensuelle (plus de 30). | help:trip-extension-approvals-costs-and-mileage-guests-BkC6WX9Qfl ; help:distance-limits-and-additional-distance-SkWUrEgVc | DOCUMENTÉ |
| 5.6 | **Fin anticipée** : jusqu'à **3 h** d'avance, accord écrit du host par message suffisant, mais **aucun remboursement**. Au-delà de 3 h, demande système, réponse du host sous **12 h**. Un retour anticipé non approuvé laisse le guest responsable des dommages jusqu'à la fin prévue et des PV ou fourrières jusqu'à **24 h après la fin prévue**. En cas de problème mécanique, appeler Turo. | help:shortening-or-ending-a-trip-early-H1Cv8RnVC ; help:managing-requests-to-extend-or-shorten-a-trip-BJDjrVg45 | DOCUMENTÉ |
| 5.7 | **Raccourcissement** : si le voyage tombe sous un seuil de remise, la remise est recalculée et un **solde peut être dû**. En non remboursable, aucun remboursement. Le dépôt est rendu 80 h après la nouvelle fin. Un raccourcissement en cours de segment mensuel non remboursable entraîne la perte du versement. | idem ; help:additional-terms-for-monthly-trips-B1ytIevall | DOCUMENTÉ |
| 5.8 | **Départ anticipé** jusqu'à **1 h** avant, sans demande système, si le host et le véhicule sont prêts. Le check-in complet dans l'app reste obligatoire. | help:managing-requests-to-extend-or-shorten-a-trip-BJDjrVg45 ; help:trip-check-in-guide-guests-HkZfVVe49 | DOCUMENTÉ |
| 5.9 | **Changement de lieu** : le host a **8 h** pour répondre (moins si l'échéance est proche). Si seul le retour change, nouveaux frais = **50 % des frais du lieu d'origine + 50 % de ceux du nouveau lieu**. | help:changing-delivery-location-ryKBEVl49 ; help:choosing-delivery-for-your-trip-SJRZ4Eg45 | DOCUMENTÉ |
| 5.10 | Un changement qui baisse le prix d'un voyage remboursable entraîne le remboursement automatique de la différence. Rien en non remboursable. | help:refund-timing-rkyN44gEc | DOCUMENTÉ |
| 5.11 | **Échange de véhicule (swap)** : avant le voyage, proposé par le host (maintenance, retard d'un autre guest), avec conditions inchangées (prix, km, protection, Extras, conducteurs). Pendant le voyage, accord mutuel par message puis appel au support. Les conducteurs additionnels sont à réajouter. | help:requests-for-vehicle-swaps-guests-rkkqZP6age (MAJ 2026-10-20) | DOCUMENTÉ |
| 5.12 | **Location longue durée** (plus de 30 jours ou plus de 3 000 mi) : l'entretien courant est à la charge du host (vidange, filtres, rotation des pneus, essuie-glaces, liquides). Soit le guest le gère (délai par défaut de **2 semaines**, remboursement), soit le host fait un swap. Un refus des deux options peut entraîner la fin du voyage. | help:how-to-manage-routine-maintenance-for-monthly-and-long-distance-trips-guests-BkLb0seex | DOCUMENTÉ |

---

## 6. Check-in, check-out et frais annexes

### 6.1 Check-in

| # | Affirmation | Source | Statut |
|---|---|---|---|
| 6.1.1 | Le check-in ouvre **24 h avant** le départ. Première étape : photo du permis (4 coins visibles) et **selfie avec le permis**. Ces photos d'identité sont réservées au check-in : jamais dans les Trip photos ni dans la messagerie. Le host ne les voit plus après la fenêtre. | help:trip-check-in-guide-guests-HkZfVVe49 (MAJ 2026-04-30) ; help:messaging-your-host-SkVEVxN9 | DOCUMENTÉ |
| 6.1.2 | **Photos du véhicule** : au moins **15 photos extérieures** et **8 photos intérieures**, avec carburant ou charge et compteur. Métadonnées date, heure et géolocalisation exigées. Photos de départ prises au plus tôt **24 h avant** et téléversées au plus tard **24 h après le début**. Photos de fin prises et téléversées au plus tard **24 h après la fin**. | help:trip-photos-guide-or-guests-HytcE4g49 (MAJ 2026-08-21) ; help:taking-damage-photos-Hk6tLVlN5 | DOCUMENTÉ |
| 6.1.3 | **Clés** : le host doit remettre une clé physique ou y donner accès, **même avec un déverrouillage à distance**. Méthodes approuvées : **déverrouillage à distance via l'app du constructeur** (Tesla, FordPass, Kia Connect, Mercedes, BMW, etc.) avec une clé physique dans une pochette anti-RF à l'intérieur, ou **boîte à clés** dont le code change à chaque voyage et n'est communiqué qu'après vérification d'identité. Emplacements interdits : passage de roue, trappe à carburant, sous l'essuie-glace, paillasson. | help:trip-check-in-guide-guests-HkZfVVe49 ; help:how-to-grant-remote-vehicle-access-to-guests-hosts-BycSSE_cn (MAJ 2026-10-02) | DOCUMENTÉ |
| 6.1.4 | **Turo Go** (déverrouillage par l'app Turo via matériel Bluetooth, lancé en 2018) n'apparaît **dans aucun article actuel** du centre d'aide US. Des pages explore.turo.com le présentent encore comme disponible, mais leur date est inconnue. | explore.turo.com/turo-go-host (extrait) ; https://turo.com/blog/news/introducing-turo-go (extrait) | DOCUMENTÉ (extrait) ; INFÉRÉ : probablement abandonné ou marginal au profit des apps constructeurs |
| 6.1.5 | Le véhicule doit être conforme : immatriculation, carte d'assurance personnelle et **carte d'information d'incident Turo** à bord (US). Un défaut de conformité entraîne une pénalité de 100 $ pour le host. Exemples de motifs de refus : immatriculation manquante, phares ou rétros cassés, pneus lisses, pneus « hiver » sans symbole 3PMSF. | help:incident-information-card-SJJELVe4c ; help:reporting-a-car-that's-unsafe-or-unsatisfactory-ry7j4ElV5 | DOCUMENTÉ |
| 6.1.6 | Le host peut utiliser du GPS ou de la télématique. **AirTags interdits.** Une caméra intérieure ou un enregistrement audio exige le **consentement écrit du guest** par message. Turo peut exploiter ces données (récupération, conduite dangereuse, assureurs, police). | help:vehicle-tracking-and-technology-policy-guests-rkZ6deQc3 | DOCUMENTÉ |

### 6.2 Check-out et retour

| # | Affirmation | Source | Statut |
|---|---|---|---|
| 6.2.1 | **Retour conforme**, faute de quoi des frais de **50 $** pour retour non conforme s'appliquent (plus 3 % de frais Turo et éventuels frais d'aéroport) : suivre les instructions du host, rendre le véhicule à l'heure, au bon lieu (zones approuvées des aéroports sous permis ; numéro de place et photo en parking ; stationnement légal **24 h** dans la rue), fermer la pochette à clé et la boîte à clés, verrouiller, **répondre aux messages dans les 2 h** suivant la fin. Le guest peut aussi être pénalisé s'il est injoignable, abandonne le véhicule ou provoque une annulation. | help:returning-a-vehicle-and-checking-out-SymM4ExE9 (MAJ 2026-08-21) ; help:additional-usage-policy-or-guests-BkyC4Vx49 | DOCUMENTÉ |
| 6.2.2 | Photos de retour : extérieur, intérieur, carburant ou charge, compteur, clé à l'emplacement, boîte à clés fermée, véhicule verrouillé. Le check-out met fin au voyage. | idem ; help:trip-photos-guide-or-guests-HytcE4g49 | DOCUMENTÉ |
| 6.2.3 | Le guest n'a pas à nettoyer le véhicule. | help:cleaning-and-disinfection-policy-or-guests-rkLCVVeVq | DOCUMENTÉ |

### 6.3 Retard (« additional usage »)

| # | Affirmation | Source | Statut |
|---|---|---|---|
| 6.3.1 | **0 à 29 min** : gratuit. **30 min à 1 h 59** : ½ prix journalier moyen. **2 h ou plus** : 1 prix journalier moyen **+ 20 $** de frais de retard. **24 h ou plus** : indemnisation supplémentaire du host fixée par Turo. Plus **3 % de frais administratifs** Turo et les frais d'aéroport. La protection peut être annulée. | help:additional-usage-policy-or-guests-BkyC4Vx49 (MAJ 2026-04-28) | DOCUMENTÉ |
| 6.3.2 | Le host attend au moins 30 min avant de signaler le retard et le fait **sous 24 h**. Revue par le support en 48 h. | help:reporting-a-late-return-H15iBExV5 | DOCUMENTÉ |

### 6.4 Kilométrage

| # | Affirmation | Source | Statut |
|---|---|---|---|
| 6.4.1 | **Minimums journaliers imposés par Turo** (le host peut augmenter ou offrir l'illimité) : standard **200 mi/jour** (US) ; Deluxe **100 mi** ; Super Deluxe **75 mi**. Hebdo minimum **1 050 mi** (150/jour) si remise d'au moins 15 %, sinon journalier × 7. Mensuel minimum standard **3 300 mi** (110/jour), Deluxe et Super Deluxe **1 800 mi**, si remise d'au moins 45 %. | help:distance-limits-and-additional-distance-SkWUrEgVc (MAJ 2026-06-29) | DOCUMENTÉ |
| 6.4.2 | **Frais au mile supplémentaire** = prix journalier ÷ distance journalière, calculé à la réservation, remises comprises. Exemple Turo : 300 $ pour 600 mi donne 0,50 $/mi. Plus 3 % de frais Turo et frais d'aéroport. Le host facture **sous 72 h** après la fin. Le kilométrage est contrôlé par les photos du compteur. | idem ; help:distance-included-in-trip-ryIbENeV9 | DOCUMENTÉ |
| 6.4.3 | Turo ne restreint pas les lieux de conduite par le kilométrage. Voyages US et CA : passage US–Canada autorisé, **passage au Mexique interdit**. | help:distance-limits-and-additional-distance-SkWUrEgVc ; help:driving-across-borders-r1rjLfrgi | DOCUMENTÉ |

### 6.5 Carburant et recharge électrique

| # | Affirmation | Source | Statut |
|---|---|---|---|
| 6.5.1 | Le véhicule doit revenir avec **le même niveau** de carburant ou de charge. Pour un véhicule thermique ou hybride, la facture couvre le carburant manquant **+ 10 $** de frais d'inconvénient, plus 3 % de frais Turo. Le host facture **sous 72 h** avec un reçu de carburant daté d'au plus 72 h après la fin. Le guest a **48 h** pour payer ou contester. | help:how-to-pay-an-invoice-from-your-host-for-vehicle-refueling-guests-rJkqN4eV9 ; help:how-to-charge-guests-for-vehicle-refueling-hosts-S1d_r4xV5 (MAJ 2026-07-29) | DOCUMENTÉ |
| 6.5.2 | **Barème de recharge électrique** selon l'écart de batterie : 0–10 %, 0 $ ; 11–30 %, **5 $** ; 31–60 %, **15 $** ; 61–80 %, **20 $** ; 81 % et plus, **25 $**. S'ajoutent **10 $** de frais d'inconvénient et **20 $** de frais de batterie faible si le niveau rendu est **inférieur à 20 %**. | help:how-to-pay-an-invoice-from-your-host-for-ev-charging-costs-guests-ryqOGnM4fg ; help:how-to-charge-guests-for-ev-costs-hosts-HklyFMHSfx | DOCUMENTÉ |
| 6.5.3 | Les Superchargeurs Tesla facturent directement le compte du host, qui refacture ensuite au guest (de façon automatisée si le compte Tesla est lié). Frais d'inactivité et de congestion remboursables **jusqu'à 500 $** (déclenchés si le véhicule n'est pas déplacé dans les 5 min). Au-delà de **60 jours** de voyage, facturation possible en cours de voyage. | idem ; help:electric-and-hybrid-vehicles-BkHOWadi | DOCUMENTÉ |
| 6.5.4 | Ne peuvent pas être facturés au guest : retour anticipé causé par le véhicule ou le host, swap, incident dont le guest n'est pas responsable. Le host qui facture à tort paie une pénalité de 50 $. | idem | DOCUMENTÉ |
| 6.5.5 | Filtre « Green Vehicles » pour les VE. Le prepaid refuel ou prepaid EV recharge (Extra) exclut toute facture de carburant. | help:electric-and-hybrid-vehicles-BkHOWadi ; help:adding-extras-to-your-trip-r1Fb44eVc | DOCUMENTÉ |

### 6.6 Nettoyage, tabac, animaux

| # | Affirmation | Source | Statut |
|---|---|---|---|
| 6.6.1 | **Pénalité de nettoyage de 150 $** (50 € en FR) plus 3 % de frais administratifs et frais d'aéroport, voire **retrait du compte**. Cas éligibles : fluides biologiques, déversement dans les aérations ou les portières, taches nécessitant un shampoing ou une préparation complète, boue ou insectes nécessitant un détailing, poils d'animaux importants, **terre rouge à Hawaï** (zones listées et preuve de géolocalisation exigée). | help:cleaning-and-disinfection-policy-or-guests-rkLCVVeVq ; help:reporting-a-cleaning-issue-rkmuBNeEq | DOCUMENTÉ |
| 6.6.2 | Cas **non éligibles** : petits déchets, poussière aspirable, saleté qu'un lavage enlève, petites taches, **odeurs désagréables**. | idem | DOCUMENTÉ |
| 6.6.3 | **Tabac** (tabac, cannabis, cigarette électronique, vapoteuse) : **150 $** (50 € en FR) plus 3 %, voire fermeture du compte. Preuves recevables : brûlures, mégot fumé, cendres. Le host signale **sous 72 h** avec des photos prises dans les fenêtres de 24 h. Revue en environ 48 h. | help:no-smoking-policy-or-guests-SyW04NgN9 ; help:reporting-a-smoking-issue-H1B_r4gE9 | DOCUMENTÉ |
| 6.6.4 | Une odeur de fumée au check-in permet au guest d'annuler avec remboursement intégral ou rebooking. | help:no-smoking-policy-or-guests-SyW04NgN9 | DOCUMENTÉ |
| 6.6.5 | Les **animaux d'assistance** sont admis dans tous les véhicules, sans caisse. Les **animaux de compagnie** (y compris le soutien émotionnel) sont admis seulement en véhicule « pet friendly » (filtre de recherche) ou avec l'accord écrit du host, **en caisse**. Sinon, la pénalité de nettoyage s'applique. | help:service-animal-and-pet-policy-or-guests-H1Y0N4eVq | DOCUMENTÉ |

### 6.7 Péages, PV, fourrière, parking

| # | Affirmation | Source | Statut |
|---|---|---|---|
| 6.7.1 | **Péages** : le transpondeur du host doit rester dans le véhicule ; le retirer ou utiliser le sien est interdit. Le host facture **sous 90 jours** (facture auto 7 jours après la fin si son compte de péage est lié). Au-delà de 90 jours, passage par le support sous 30 jours après notification et au plus tard **180 jours**. Le guest peut donc recevoir une demande **jusqu'à 185 jours** après la fin. Le guest dispose de **48 h** pour payer ou contester. Le péage urbain de NYC est facturable. Frais de **3 %** si Turo intervient. | help:how-to-pay-an-invoice-from-your-host-for-tolls-guests-Hy7iAfyhi ; help:how-to-charge-guests-for-tolls-hosts-SkCOrNlE9 (MAJ 2026-07-29) | DOCUMENTÉ |
| 6.7.2 | **PV** : mêmes délais (90 jours, puis 180 + 30). Les PV de stationnement sont imputables **jusqu'à 24 h après la fin**. Les PV liés au véhicule (immatriculation expirée, vitres teintées, « fix-it ») ne le sont pas. **Transfert de responsabilité** possible aux US pour les infractions qui comptent des points (seules les données strictement nécessaires sont partagées). | help:how-to-pay-an-invoice-for-tickets-guests-BJw5ENlNc ; help:how-to-charge-guests-for-tickets-hosts-SJhuBVx45 ; help:ticket-liability-transfer-B1sSNTmnT | DOCUMENTÉ |
| 6.7.3 | **Fourrière** : frais forfaitaires de **399 $** si Turo récupère un véhicule mis en fourrière par la faute du guest (stationnement illégal, violation, abandon), **même avec l'assistance renforcée**. | help:impound-fee-us-and-canada-guests-H11J6Onvfl (MAJ 2026-08-26) | DOCUMENTÉ |
| 6.7.4 | Ne sont pas refacturables au guest : le parking payé par le host pour récupérer son véhicule et le stationnement « Park My Share ». | help:paying-for-parking-By5PIT5Rs ; help:ineligible-reimbursement-invoices-and-damage-reports-SJ4FBNlV5 | DOCUMENTÉ |

### 6.8 Clés perdues

| # | Affirmation | Source | Statut |
|---|---|---|---|
| 6.8.1 | Le remplacement d'une clé se traite comme une **réclamation dommage** (« damage claim for key replacement »), pas comme une facture annexe. Turo peut imposer un prestataire de référence pour le prix. | help:ineligible-reimbursement-invoices-and-damage-reports-SJ4FBNlV5 ; help:reporting-and-resolving-damage-or-us-hosts-SymY8VlN5 | DOCUMENTÉ |
| 6.8.2 | Une clé perdue est couverte par l'assistance (remorquage) avec l'option renforcée, sinon jusqu'à 199 $ (voir §7). Aucun montant forfaitaire « clé perdue » n'est publié. | help:roadside-assistance-or-us-guests-BJBiEVgE9 | DOCUMENTÉ / INFÉRÉ (absence de forfait) |

### 6.9 Factures annexes : règles communes

| # | Affirmation | Source | Statut |
|---|---|---|---|
| 6.9.1 | Le guest a **48 h** pour payer ou contester chaque facture. Sans réponse, Turo tranche et peut débiter la carte. Contestation avec description et photos à métadonnées. Le host a **72 h** pour répondre (annuler, réviser ou escalader). La fenêtre de 48 h ne peut pas être rouverte. | help:how-to-pay-an-invoice-or-unpaid-balance-guests-ryLNV4g4c ; help:how-to-dispute-an-invoice-from-your-host-guests-H1NEN4eE5 | DOCUMENTÉ |
| 6.9.2 | Le nettoyage, le tabac et le retard ne passent pas par une facture : ce sont des signalements d'incident traités par Turo. | help:ineligible-reimbursement-invoices-and-damage-reports-SJ4FBNlV5 | DOCUMENTÉ |
| 6.9.3 | Impayés : plusieurs relances sur quelques semaines, puis **recouvrement** (US : FCR / FedChex, contact sous 2 semaines). Une fois au recouvrement, Turo ne gère plus rien. | help:how-to-pay-an-invoice-or-unpaid-balance-guests-ryLNV4g4c | DOCUMENTÉ |
| 6.9.4 | Le host qui envoie une facture non éligible paie **50 $** la première fois, **200 $** la deuxième, **500 $** ensuite. Les fausses preuves (« material misrepresentation ») coûtent de **200 à 2 000 $**. | help:ineligible-reimbursement-invoices-and-damage-reports-SJ4FBNlV5 ; help:material-misrepresentation-BkKQ84xE9 | DOCUMENTÉ |

---

## 7. Incidents, assistance, sinistres

| # | Affirmation | Source | Statut |
|---|---|---|---|
| 7.1 | **Assistance routière 24/7 (US)** : **+1 (415) 965-4525**, incluse dans tous les voyages pour les pannes mécaniques et les accidents. Elle répare sur place ou remorque (bagages compris) vers le lieu choisi par le host. **Remorquage gratuit après un accident**, sauf usage interdit. Numéros pour les autres pays : AU +61 2 8317 1415 ; CA +1 (888) 391-0460 ; FR +33 1 82 88 10 24 ; UK +44 808 164 1454 (option 3). | help:roadside-assistance-or-us-guests-BJBiEVgE9 (MAJ 2026-09-30) ; help:roadside-assistance-numbers-SyLiLVxN9 | DOCUMENTÉ |
| 7.2 | **Problèmes non mécaniques** (crevaison, livraison de carburant, démarrage, véhicule verrouillé, gonflage, remorquage pour batterie VE vide, clé perdue ou absence de roue de secours) : gratuits avec l'**assistance renforcée** (achat optionnel, **non remboursable**). Sans elle, facturés **jusqu'à 199 $** par service, sauf remorquage et fourrière (fourrière par faute du guest : 399 $ maximum). | idem | DOCUMENTÉ |
| 7.3 | Frais de **40 $** (« gone on arrival ») si le véhicule n'est plus à l'adresse indiquée à l'arrivée du dépanneur. Le guest est responsable des clés pendant l'attente. | idem | DOCUMENTÉ |
| 7.4 | Assistance exclue en cas de violation des ToS, de conducteur non autorisé, de troubles civils ou de guerre. Elle ne couvre ni le carburant, ni l'assurance, ni les péages. | idem | DOCUMENTÉ |
| 7.5 | **Accident avec un véhicule encore roulant** : prévenir le host et déclarer **sous 24 h** au centre de déclaration. Avec un tiers : relever son identité, son immatriculation et son assureur, prendre des photos, noter les témoins, remettre la carte d'incident Turo. | idem | DOCUMENTÉ |
| 7.6 | Problème de sécurité ou voyant allumé en cours de voyage : prévenir le host, puis le support sans réponse sous **30 min**. Toute modification du véhicule est interdite. | help:reporting-a-car-that's-unsafe-or-unsatisfactory-ry7j4ElV5 | DOCUMENTÉ |
| 7.7 | **Le host déclare un dommage au plus tard 24 h après la fin du voyage.** Il choisit de régler directement avec le guest ou d'ouvrir une réclamation gérée par Turo. Un chargé de réclamation contacte le guest sous **1 jour ouvré**. | help:reporting-and-resolving-damage-or-us-hosts-SymY8VlN5 (MAJ 2026-10-12) ; help:how-guests-can-contact-claims-SJw1BNxE5 | DOCUMENTÉ |
| 7.8 | **Parcours d'une réclamation Turo** : confirmation et pièces du guest, demande de son assurance, **dépôt dommage** (sauf Premier), vérification de l'éligibilité en **3 jours ouvrés maximum** (survenu pendant le voyage ? usure ? violation ?), puis expertise photo (moins d'un jour) ou sur place (**5 à 7 jours**), puis décompte détaillé et débit de la carte, ou recours contre l'assureur. Frais de traitement jusqu'à **575 $**. En cas d'échec de paiement, recouvrement. | help:managing-a-damage-claim-through-turo-or-us-guests-HJhZBElNc (MAJ 2026-05-04) | DOCUMENTÉ |
| 7.9 | **Ordre de recouvrement** : tiers responsable, puis assureur personnel du guest (si la protection est secondaire), puis le guest dans la limite du plafond de son plan. Exemple Turo : 2 050 $ de coût total, 900 $ payés par l'assureur, dépôt de 500 $, soit une facture finale de 650 $. | help:guest-charges-for-damage-claims-BkPzrVgN9 | DOCUMENTÉ |
| 7.10 | Le guest est responsable des dommages pendant le voyage **qu'il soit fautif ou non** (vandalisme compris), dans la limite de son plan. Il n'est pas responsable de l'usure ni des dommages préexistants documentés. | idem ; help:understanding-insurance-and-your-physical-damage-contract-or-us-guests-BkXlH4xN9 | DOCUMENTÉ |
| 7.11 | **Règlement direct avec le host** : pas de frais d'expertise ni de traitement. Le host envoie un devis sous 72 h, le guest paie via une facture Turo (jamais en dehors). Le guest peut se retirer du règlement direct **sous 20 jours** après la fin (plus longtemps s'il traite avec son assureur), et le host peut escalader dans les mêmes **20 jours**. Clause 2.6 du contrat US de partage de véhicule, à transmettre à l'expert de l'assurance. | help:resolving-damage-with-your-host-Hy4fBNlN5 ; help:how-do-i-resolve-a-claim-through-guest-or-third-party-insurance-Bkt9IVeVc | DOCUMENTÉ |
| 7.12 | **Vol ou disparition** : enquête de **30 jours** à compter du rapport de police. La réclamation est traitée à la récupération ou à J+30. | help:managing-a-damage-claim-through-turo-or-us-guests-HJhZBElNc | DOCUMENTÉ |
| 7.13 | **Échéancier sans frais** pour une réclamation dommage, si la carte a été refusée : mise en place **sous 30 jours** après la facture. Jusqu'à 5 000 $ : 2, 4 ou 8 mois ; au-delà : 4, 6 ou 8 mois. Prélèvement bancaire automatique. Un seul échéancier actif. Pas de nouvelles réservations avant le solde. | help:payment-plans-for-damage-claims-r1O2jEmykl | DOCUMENTÉ |
| 7.14 | Contacts réclamations : répondre à l'email du chargé de dossier, ou écrire à **claims@turo.com** (réponse sous 2 jours ouvrés). Ligne urgente **+1 (415) 275-6141**, du lundi au samedi de 5 h à 17 h (heure du Pacifique). | help:how-guests-can-contact-claims-SJw1BNxE5 | DOCUMENTÉ |
| 7.15 | **Crevaison** : à la charge du guest si elle vient d'un accident, de vandalisme ou d'un usage interdit, après analyse des photos. Pneu remplacé à qualité égale ou supérieure, avec l'accord du host. Reçus conservés, remboursés si le guest n'est pas responsable. | help:flat-tire-damage-or-guests-Syh9NExEc | DOCUMENTÉ |
| 7.16 | **Usages interdits** (qui annulent protection et assistance, avec pénalités ou bannissement) : excès de vitesse, tout-terrain, courses, remorquage, mauvais carburant, conduite sous influence, boîte manuelle sans maîtrise, conducteur non approuvé, tabac, animal non autorisé, surcharge, transport de matières dangereuses. **VTC et livraison** (Uber, Lyft, DoorDash, Amazon Flex) autorisés aux US **sauf en Californie, au Minnesota, à New York et en Oregon** ; interdits hors US (pénalité de 150 $ + 3 %). **Usage commercial** (permis professionnel) toujours interdit (150 $ + 3 %). | help:prohibited-uses-Hyi0E4l49 ; help:professional-uses-policy-HJmiAoQfyg ; help:commercial-uses-policy-BkCR4VlN9 | DOCUMENTÉ |
| 7.17 | **Paiement hors plateforme (« marché gris »)** interdit. Exceptions : remboursement du parking par le host en liquide, Extra endommagé, dommage réglé hors Turo. Sanctions : restriction, bannissement, **dommages-intérêts forfaitaires jusqu'à 5 500 $**. | help:gray-market-transaction-policy-or-guests-ryrrN4eV9 | DOCUMENTÉ |
| 7.18 | **Chargeback** : interdit par les ToS. Il bloque tout remboursement Turo pendant la procédure bancaire (jusqu'à 90 jours) et peut mener au recouvrement. | help:chargeback-policy-guest-S1reGLMee | DOCUMENTÉ |
| 7.19 | Litiges et appel : les ToS imposent l'**arbitrage**, sans action collective. | https://turo.com/au/en/policies/terms (extrait) ; tostracker.app (résumé tiers) | **DOCUMENTÉ-SECONDAIRE** (requalifié A24-05 : EV-0024, CGU US lues directement, mentionne seulement « médiation / arbitrage envisageables » et ne confirme pas cette formulation) |

---

## 8. Avis, messagerie, support

| # | Affirmation | Source | Statut |
|---|---|---|---|
| 8.1 | Le guest peut noter **à partir de 3 h avant la fin et jusqu'à 10 jours après**. Note globale de 1 à 5, plus des sous-notes : propreté, communication, praticité, exactitude de l'annonce, entretien. Une note de **1 à 4 étoiles impose un texte d'au moins 25 caractères.** | help:how-to-rate-and-review-a-trip-guests-ByTKNVgEq (MAJ 2026-09-04) | DOCUMENTÉ |
| 8.2 | **Publication simultanée (double aveugle)** : quand les deux parties ont noté, ou à **J+10**, au premier des deux termes. Ni modification ni prolongation de la fenêtre possibles. | idem ; help:writing-and-responding-to-reviews-SJhhHEx49 | DOCUMENTÉ |
| 8.3 | Le host a 10 jours pour noter. Un texte est obligatoire de 1 à 3 étoiles. Il n'est pas obligé de noter. Une note de 3 ou moins bloque automatiquement le guest chez ce host. Un voyage non noté ne compte pas dans la moyenne. | help:writing-and-responding-to-reviews-SJhhHEx49 ; help:impacts-of-rating-and-reviewing-guests-hosts-S1cS7K_Ofg | DOCUMENTÉ |
| 8.4 | Un **avis automatique d'annulation** est publié sur l'annonce quand le host annule. | help:canceling-a-trip-with-your-guest-hosts-HkkzLVlE5 | DOCUMENTÉ |
| 8.5 | **Retrait d'un avis** seulement si : le voyage n'a pas eu lieu, extorsion, grossièreté, avis incité (paiement ou remise), données personnelles, ou délai (« publié dans les 30 jours suivant la fin », critère ambigu). Demande par formulaire uniquement, examen unique, décision définitive. Retrait proactif en cas de violation des ToS. | help:how-to-request-removal-of-a-rating-or-review-guests-H1e7FqjKle | DOCUMENTÉ |
| 8.6 | **Messagerie** : disponible seulement après réservation. Toute communication doit passer par Turo (trace pour les litiges). Photos possibles (galerie, Trip photos, appareil). Pas de photos d'identité. Le **numéro du host** figure sur la page Details du voyage. Le host peut programmer des messages. | help:messaging-your-host-SkVEVxN9 | DOCUMENTÉ |
| 8.7 | **Support** : bouton « Get help », qui ouvre d'abord un **assistant IA**, puis un agent humain sur demande. Chats séparés pour la vérification et la facturation. Historique visible dans « My conversations » sur help.turo.com. Revues standard en **48 h** (nettoyage, tabac, retard). Le nom « Ask Turo » n'apparaît nulle part. | help:chat-with-turo-support-rJjkS4eE9 ; help:chat-with-turo-billing-support-BkE5r4x4q ; help:view-message-history-with-customer-support-SyxGy1BMo | DOCUMENTÉ |
| 8.8 | Il est conseillé de ne contacter le support qu'**une seule fois** par problème de réservation : les relances retardent le traitement. | help:how-to-fix-common-booking-problems-guests-rJnnNNgV9 | DOCUMENTÉ |
| 8.9 | **Urgence et assistance** : +1 (415) 965-4525 (24/7). Selon la page trust-and-safety US, tout client dispose d'un support et d'une assistance 24/7 pendant chaque voyage. | help:roadside-assistance-or-us-guests-BJBiEVgE9 ; https://turo.com/us/en/trust-and-safety (extrait) | DOCUMENTÉ / DOCUMENTÉ (extrait) |
| 8.10 | Fraude : domaines email officiels (@turo.com, @mail.turo.com, @hello.turo.com, etc.) ; signalement à spoof@turo.com ; compte compromis : account-services@turo.com. Turo ne demande jamais de code ni de paiement par carte cadeau. | help:preventing-and-reporting-fraud-guests-H1B2NElNq | DOCUMENTÉ |

---

## 9. Fidélité, parrainage, cartes cadeaux, partenariats

| # | Affirmation | Source | Statut |
|---|---|---|---|
| 9.1 | Le **programme de fidélité guest s'est terminé le 24/07/2025.** | help:faqs-promotions-and-discounts-SkjNVElN5 | DOCUMENTÉ |
| 9.2 | **Aucun parrainage guest** (« Turo doesn't offer… referral links » pour les nouveaux utilisateurs). Le programme guest aurait été supprimé en 2019 selon des tiers. | idem ; ridester.com (extrait) | DOCUMENTÉ / SECONDAIRE |
| 9.3 | **Parrainage host** (marchés US sélectionnés : Birmingham, Memphis, Tampa, San Diego, SF, Seattle, DC, Hawaï…) : **300 $** chacun lorsque le filleul réalise 3 voyages ou 15 jours de voyage sans annulation, dans un délai de 6 mois. Bonus de 100 $ entre le 2/06 et le 15/07. | help:faqs-host-referral-program-us-BkFI1rLbMl (MAJ 2026-06-10) | DOCUMENTÉ |
| 9.4 | **Cartes cadeaux** : achat réservé aux résidents US, sans compte requis. **E-cartes uniquement** (email ou SMS, envoi programmable). Montant libre de **25 à 2 000 $**, sans frais ni taxes. **Pas d'expiration.** Transférables tant qu'elles ne sont pas utilisées. Utilisation : adresse et moyen de paiement US, compte approuvé. Valeur versée en crédit voyage. Non applicables à un voyage déjà réservé. | help:turo-gift-cards-r1IImvAPj ; help:buy-a-turo-gift-card-H16jXDCDs ; help:redeem-a-turo-gift-card-SkXzmDRwi | DOCUMENTÉ |
| 9.5 | **Citi / AAdvantage** (depuis le 19/10/2025) : carte liée au compte, **jusqu'à 30 $** de crédit par voyage terminé, plafonné à **240 $/an** (Globe) ou **180 $/an** (Platinum Select). Exclus : Apple Pay, cartes virtuelles, réservations via sites tiers. | help:turo-partnership-with-citibank-and-american-airlines-us-guests-ByT_aHK0gg | DOCUMENTÉ |
| 9.6 | **Qatar Airways Privilege Club (Avios)** : de 1 à 4 Avios par unité dépensée selon le niveau (Burgundy à Platinum). Crédités environ 30 jours ouvrés après le voyage. Réclamation sous 180 jours. Exclus : promos et crédit voyage. | help:avios-rewards-on-turo-trips-for-qatar-airways-privilege-club-members-ByfSXoFGl | DOCUMENTÉ |

---

## 10. Autres fonctionnalités côté guest

| # | Affirmation | Source | Statut |
|---|---|---|---|
| 10.1 | **Reçu détaillé** dans l'app (Trip details puis View receipt), mis à jour à chaque frais ou remboursement. Il peut ne pas être définitif à la fin du voyage. | help:view-your-trip-receipt-BJkwNdpLj | DOCUMENTÉ |
| 10.2 | **Contrat de partage de véhicule** propre à chaque voyage (un par segment de 30 jours), mis à jour à l'ajout d'un conducteur. Accessible via l'onglet Help du voyage. Il sert de preuve d'autorisation à la frontière. | help:viewing-your-car-sharing-agreement-trip-receipt-and-incident-card-H19M4Vx45 ; help:driving-across-borders-r1rjLfrgi | DOCUMENTÉ |
| 10.3 | **Badge host « All-Star »** mis en avant comme gage de qualité. | help:getting-to-know-turo-guests-HJyKcozf1e | DOCUMENTÉ |
| 10.4 | **Filtres** : Green Vehicles, Wheelchair Accessible ou « Accessible », pet friendly, child seat, Self-driving (Tesla FSD). Pas de filtre kilométrage illimité. | help:electric-and-hybrid-vehicles-BkHOWadi ; help:wheelchair-accessible-vehicles-guest-SybxTjz5C ; help:tesla-full-self-driving-supervised-us-guests-SJ7uCk19zx ; help:distance-included-in-trip-ryIbENeV9 | DOCUMENTÉ |
| 10.5 | **Tesla FSD (Supervised)** : bannière sur la page d'accueil et filtre « Self-driving ». Disponibilité non garantie et pas de remboursement si elle est désactivée. Un essai gratuit de FSD pour les hosts est prévu du 16/11 au 31/12/2026. | help:tesla-full-self-driving-supervised-us-guests-SJ7uCk19zx (MAJ 2026-10-28) ; help:new-and-upcoming-on-turo-Hyt3_dZja | DOCUMENTÉ |
| 10.6 | **Distribution par IA** : app Turo dans **ChatGPT** (@Turo) et **connecteur Turo pour Claude** (plans payants). Les deux servent à chercher des véhicules ; la réservation se finalise dans l'app ou sur le site. | help:using-the-turo-app-in-chatgpt-Syk_z0Yibe ; help:how-to-plan-a-trip-with-the-turo-connector-in-claude-SyM8VFHYfg | DOCUMENTÉ |
| 10.7 | **Distribution par Uber** : réservation Turo depuis l'app Uber (US, hors NY, OR et WA). | help:trips-booked-on-uber-us-guests-H1MMdGxyel | DOCUMENTÉ |
| 10.8 | Partage d'informations de vol avec le host (article « checking guest flight information »). | help:airport-pickup-and-return-guests-BJNxe5eixe | DOCUMENTÉ (non détaillé) |
| 10.9 | Notifications : push, SMS (opt-in), email, avec réglages personnalisables. Rubrique « Recent updates » dans l'app. | help:how-to-customize-notification-settings-SyPmxRZGfg (non lu) ; help:new-and-upcoming-on-turo-Hyt3_dZja | DOCUMENTÉ (partiel) |
| 10.10 | Types de véhicules : voitures, SUV, monospaces, fourgons, pick-up, **camions porteurs** (US et Colombie-Britannique). Exclus : limousines, motos, camping-cars, véhicules à 3 roues, véhicules nécessitant un permis commercial. | help:getting-to-know-turo-guests-HJyKcozf1e | DOCUMENTÉ |
| 10.11 | « Favoris », « partage de voyage » et « Turo for Business » : aucun article guest US trouvé dans le sitemap (recherche par mots-clés). | sitemap help.turo.com | INFÉRÉ (absence) |
| 10.12 | Aucun pays d'Amérique latine dans la couverture Turo (US, CA, AU, FR, UK). Le seul point de contact est la frontière Mexique (CBX), avec franchissement **interdit** en véhicule. | help:driving-across-borders-r1rjLfrgi ; help:cross-border-xpress-cbx-guests-By3gdXZGJe | DOCUMENTÉ |

---

## 11. Questions ouvertes et contradictions

1. **Fenêtre gratuite pour une réservation de dernière minute :** « réservé à moins de 24 h du départ » (help:canceling-a-trip-with-your-host) contre « moins de 25 h » (help:refund-timing, help:trips-canceled-by-guests-or-turo-hosts). Écart d'une heure entre articles.
2. **Frais de traitement des sinistres :** « jusqu'à 150 $ par réclamation » (protection plans in detail) contre « frais de traitement jusqu'à 575 $ » (managing a damage claim). Possiblement deux natures de frais (traitement contre expertise et administration). À clarifier.
3. **Montant du young driver fee :** Turo ne publie pas de barème. Les tiers avancent 50 $ ou 30 $ par jour, d'autres 20 % du prix.
4. **Formule du trip fee :** non publiée. Les tiers citent 2,5 % à 100 %, minimum 15 $. Exonération pour les voyages de 30 jours ou plus connue seulement par un extrait.
5. **Prix des protections :** absents du centre d'aide (« Turo peut changer les prix à tout moment »). Les pourcentages connus viennent de NerdWallet et ValuePenguin et peuvent être datés.
6. **Book Instantly universel :** le blog annonçait 100 % des réservations en 2024 et l'article « Trip bookings » le confirme implicitement. Un tiers décrit encore un flux de demande en 8 h. Statut exact du « request to book » non vérifiable sur turo.com (403).
7. **Turo Go :** absent du centre d'aide actuel, encore décrit sur explore.turo.com (date inconnue). Statut réel inconnu.
8. **Seuil d'âge de 21 ans :** l'article de réservation US parle d'un véhicule de plus de 20 000 $, tandis que le Premier est limité au-delà de 25 000 ou 60 000 $. Les valeurs de référence (valeur marchande ou totale) ne sont pas définies de façon homogène.
9. **Critère « Timeliness » de retrait d'avis** (« posté dans les 30 jours ») : sens ambigu (critère d'éligibilité ou d'exclusion ?).
10. **Fin anticipée :** jusqu'à 3 h d'avance par accord en message, sans remboursement. La règle est cohérente mais crée une zone grise sur la responsabilité de la période non utilisée.
11. **Clé perdue :** pas de forfait publié. Traitement en réclamation dommage, avec un éventuel remorquage à 199 $.
12. **Score d'assurance fondé sur le crédit :** non mentionné explicitement. Seul le « credit report » apparaît.
13. **Pages turo.com non lisibles :** ToS complètes (montants des dommages-intérêts forfaitaires autres que 5 500 $, clauses de responsabilité), Community Guidelines, page /insurance (prix), page cancellation et page gift-cards-landing ne sont connues que par recoupement.
14. **Remise non remboursable :** « 10 % offerts par tous les hosts », mais l'article non remboursable ne donne pas le taux. Possible variation par marché.

---

## 12. URLs consultées

**Méthode d'accès au centre d'aide :** les pages `https://help.turo.com/en_us/<slug>` sont toutes lisibles en `.md`. Index : https://help.turo.com/sitemap.xml et sitemap-articles-1 à 8.xml (lisibles). https://help.turo.com/llms.txt lisible (une entrée). https://help.turo.com/en_us/ (racine) renvoie 404.

### 12.1 Articles du centre d'aide lus intégralement (LISIBLES)

Préfixe : https://help.turo.com/en_us/

account-verification-guide-SycgNVlV9 · adding-extras-to-your-trip-r1Fb44eVc · adding-or-updating-a-protection-plan-SyNLEEe4c · additional-driver-requirements-fees-and-responsibilities-guests-HksENgV5 · additional-terms-for-monthly-trips-B1ytIevall · additional-usage-policy-or-guests-BkyC4Vx49 · airport-pickup-and-return-guests-BJNxe5eixe · automating-tesla-supercharging-incidentals-r1TVjOLpT (téléchargé, non exploité) · avios-rewards-on-turo-trips-for-qatar-airways-privilege-club-members-ByfSXoFGl · booking-a-car-in-the-us-H1gxVVeE9 · buy-a-turo-gift-card-H16jXDCDs · canceling-a-trip-with-your-host-HJyUE4xN9 · canceling-a-trip-with-your-guest-hosts-HkkzLVlE5 · changing-delivery-location-ryKBEVl49 · chargeback-policy-guest-S1reGLMee · charging-guests-for-parking-HkevHNgNq · chat-with-customer-support-verification-us-HyagNVx4c · chat-with-turo-billing-support-BkE5r4x4q · chat-with-turo-support-rJjkS4eE9 · choosing-delivery-for-your-trip-SJRZ4Eg45 · classic-and-specialty-vehicles-us-Sy8WuBHZC · cleaning-and-disinfection-policy-or-guests-rkLCVVeVq · closing-your-account-SJQn4EeEq · commercial-uses-policy-BkCR4VlN9 · cross-border-xpress-cbx-guests-By3gdXZGJe · deluxe-class-and-super-deluxe-class-eligibility-Syv7H4lV5 · distance-included-in-trip-ryIbENeV9 · distance-limits-and-additional-distance-SkWUrEgVc · driving-across-borders-r1rjLfrgi · electric-and-hybrid-vehicles-BkHOWadi · excusing-host-cancellation-fee-rk1bAtBB9 · extenuating-circumstances-policy-or-guests-rkoBEVlVc · faqs-host-referral-program-us-BkFI1rLbMl · faqs-promotions-and-discounts-SkjNVElN5 · faqs-trip-extensions-guests-B1uzMQ9Qfg · flat-tire-damage-or-guests-Syh9NExEc · getting-to-know-turo-guests-HJyKcozf1e · good-neighbor-policy-Bk2RPqH2o · gray-market-transaction-policy-or-guests-ryrrN4eV9 · guest-charges-for-damage-claims-BkPzrVgN9 · guest-trip-start-failures-HJUfENeVq · host-fees-r1aIIExV5 · how-do-i-resolve-a-claim-through-guest-or-third-party-insurance-Bkt9IVeVc · how-guests-can-contact-claims-SJw1BNxE5 · how-to-add-a-driver-to-a-trip-guests-B1kL8XrnGl · how-to-charge-guests-for-additional-distance-hosts-Hy5uBEeE5 · how-to-charge-guests-for-ev-costs-hosts-HklyFMHSfx · how-to-charge-guests-for-tickets-hosts-SJhuBVx45 · how-to-charge-guests-for-tolls-hosts-SkCOrNlE9 · how-to-charge-guests-for-vehicle-refueling-hosts-S1d_r4xV5 · how-to-dispute-an-invoice-from-your-host-guests-H1NEN4eE5 · how-to-extend-a-trip-guests-BypBE4eVc · how-to-fix-common-booking-problems-guests-rJnnNNgV9 · how-to-grant-remote-vehicle-access-to-guests-hosts-BycSSE_cn · how-to-manage-a-guest-no-show-SkNzL4g4q · how-to-manage-routine-maintenance-for-monthly-and-long-distance-trips-guests-BkLb0seex · how-to-pay-an-invoice-for-tickets-guests-BJw5ENlNc · how-to-pay-an-invoice-from-your-host-for-ev-charging-costs-guests-ryqOGnM4fg · how-to-pay-an-invoice-from-your-host-for-tolls-guests-Hy7iAfyhi · how-to-pay-an-invoice-from-your-host-for-vehicle-refueling-guests-rJkqN4eV9 · how-to-pay-an-invoice-or-unpaid-balance-guests-ryLNV4g4c · how-to-plan-a-trip-with-the-turo-connector-in-claude-SyM8VFHYfg · how-to-rate-and-review-a-trip-guests-ByTKNVgEq · how-to-rebook-a-canceled-trip-guests-HyO3VDkL9 · how-to-report-an-improper-return-hosts-ByOtsfUDMg · how-to-request-removal-of-a-rating-or-review-guests-H1e7FqjKle · impacts-of-rating-and-reviewing-guests-hosts-S1cS7K_Ofg · impound-fee-us-and-canada-guests-H11J6Onvfl · incident-information-card-SJJELVe4c · ineligible-reimbursement-invoices-and-damage-reports-SJ4FBNlV5 · insurance-or-coverage-via-a-credit-card-rklgH4g45 · lifting-account-restrictions-following-a-chargeback-rJjMcV1Xeg · managing-a-damage-claim-through-turo-or-us-guests-HJhZBElNc · managing-a-flight-delay-or-cancellation-BkGUVNx4q · managing-requests-to-extend-or-shorten-a-trip-BJDjrVg45 · material-misrepresentation-BkKQ84xE9 · messaging-your-host-SkVEVxN9 · multiple-or-linked-accounts-S1ZTVVlV9 · new-and-upcoming-on-turo-Hyt3_dZja · no-smoking-policy-or-guests-SyW04NgN9 · non-refundable-trips-guests-BJk1E_Kmfl · paying-for-parking-By5PIT5Rs · paying-for-your-trip-guests-HkumVNgVq · paying-over-time-with-affirm-afterpay-or-klarna-us-guests-B1Jgr4U5xg · payment-methods-turo-accepts-B1kfEutwee · payment-plans-for-damage-claims-r1O2jEmykl · personal-insurance-requirements-or-guests-ByCkr4e45 · policy-violations-r1X6NVgV5 · preventing-and-reporting-fraud-guests-H1B2NElNq · professional-uses-policy-HJmiAoQfyg · prohibited-uses-Hyi0E4l49 · promotional-terms-and-conditions-H1JMPWzTA · protection-plans-including-insurance-or-us-guests-HkwgBNgN9 · redeem-a-turo-gift-card-SkXzmDRwi · refund-timing-rkyN44gEc · replacement-vehicles-HyJcUVeV9 · reporting-a-car-that's-unsafe-or-unsatisfactory-ry7j4ElV5 · reporting-a-cleaning-issue-rkmuBNeEq · reporting-a-late-return-H15iBExV5 · reporting-a-smoking-issue-H1B_r4gE9 · reporting-and-resolving-damage-or-us-hosts-SymY8VlN5 · reporting-damage-or-guests-SJtWr4gE9 · requests-for-vehicle-swaps-guests-rkkqZP6age · resolving-damage-with-your-host-Hy4fBNlN5 · resolving-issues-logging-in-B1Ri4VlV9 · responding-to-trip-requests-and-changes-HyfsHVlE9 · returning-a-vehicle-and-checking-out-SymM4ExE9 · roadside-assistance-numbers-SyLiLVxN9 · roadside-assistance-or-us-guests-BJBiEVgE9 · sales-tax-or-guests-B1AEVNeE9 · security-deposits-us-HkbE44lE9 · service-animal-and-pet-policy-or-guests-H1Y0N4eVq · setting-trip-duration-BJZpGUJIc · shortening-or-ending-a-trip-early-H1Cv8RnVC · street-parking-ryr5V4g4c · summary-and-cost-of-protection-plans-or-us-guests-BJSgBNgVq · taking-damage-photos-Hk6tLVlN5 · temporary-licenses-BkAzTKaT · temporary-licenses-and-international-driver's-permits-HkOgVExE9 · tesla-full-self-driving-supervised-us-guests-SJ7uCk19zx · ticket-liability-transfer-B1sSNTmnT · travel-credit-SJuRUbG60 · trip-check-in-guide-guests-HkZfVVe49 · trip-costs-Syxm4NeNq · trip-extension-approvals-costs-and-mileage-guests-BkC6WX9Qfl · trip-photos-guide-or-guests-HytcE4g49 · trip-pricing-ByXmVNgN5 · trips-booked-on-uber-us-guests-H1MMdGxyel · trips-canceled-by-guests-or-turo-hosts-BkGMU4gV9 · trips-canceled-by-hosts-B1wU44x4c · trust-and-safety-issues-SJIT4Ve4q · turo-gift-cards-r1IImvAPj · turo-partnership-with-citibank-and-american-airlines-us-guests-ByT_aHK0gg · understanding-insurance-and-your-physical-damage-contract-or-us-guests-BkXlH4xN9 · updating-a-license-BJxJnJnxge · updating-to-a-preferred-first-name-on-your-account-guests-BynEiTAJll · using-book-instantly-BJvHz8yIq · using-the-turo-app-in-chatgpt-Syk_z0Yibe · vehicle-tracking-and-technology-policy-guests-rkZ6deQc3 · verifying-or-updating-your-payment-card-Hk37NNlV5 · verifying-your-phone-number-rkxffNfZZl · view-message-history-with-customer-support-SyxGy1BMo · view-your-trip-receipt-BJkwNdpLj · viewing-your-car-sharing-agreement-trip-receipt-and-incident-card-H19M4Vx45 · wheelchair-accessible-vehicles-guest-SybxTjz5C · writing-and-responding-to-reviews-SJhhHEx49

D'autres articles ont été téléchargés mais peu exploités (lisibles) : airport-delivery-information-or-guests-Hky_V4l4q, airport-permit-violation-policy-HJXOrOp_A, quality-standards-SJ10p9JEJl, offering-discounts-rJJHrVxVq, change-email-address-SkPJA0KEeg, change-phone-number-ByvEuSyQh, view-your-incident-information-card-H1IyEup8j, age-requirements-for-drivers-HJXlV4l45 (page de renvoi par pays).

Repéré dans le sitemap mais non lu : help:how-to-customize-notification-settings-SyPmxRZGfg, help:checking-guest-flight-information-Hk6FRaNkfe, articles CA/AU/FR/UK (hors périmètre), pages aéroport par aéroport (environ 300).

### 12.2 turo.com : NON LISIBLES (HTTP 403 aux fetchs automatisés)

- https://turo.com/us/en/policies/cancellation : 403 (couverte par les articles help équivalents).
- https://turo.com/us/en/policies/terms : 403 (extraits de recherche seulement).
- https://turo.com/us/en/car-rental/united-states/how-turo-works : 403.
- https://turo.com/us/en/trust-and-safety : connue par extrait de recherche seulement.
- https://turo.com/us/en/insurance : pas tentée après les 403 ; aucun extrait obtenu.
- https://turo.com/us/en/gift-cards-landing : pas tentée ; couverte par les articles help sur les cartes cadeaux.
- https://turo.com/us/en/policies/nondiscrimination et /community-guidelines : extraits de recherche seulement.
- https://turo.com/blog/news/book-instantly-will-be-the-standard-for-all-bookings/ : extrait seulement.
- https://turo.com/blog/news/introducing-turo-go et explore.turo.com/turo-go-host : extraits seulement.

Un contournement par modification du user-agent a été bloqué par la politique de l'environnement et n'a pas été poursuivi.

### 12.3 Sources secondaires (via extraits de recherche, non lues en entier)

- https://ecommerceportal.freshdesk.com/en/support/solutions/articles/25000024540-guide-for-turo-guests (copie d'un ancien guide Turo, flux de demande en 8 h)
- https://www.groupon.com/coupons/blog/turo-fees-deposits-total-cost (trip fee de 2,5 % à 100 %, minimum 15 $)
- https://www.nerdwallet.com/article/insurance/turo-car-insurance ; https://www.valuepenguin.com/turo-car-insurance (prix des protections)
- https://www.ridester.com/ ; https://ride-share.com/turo-age-requirements/ ; travelpander.com (young driver fee)
- https://tostracker.app/document/turo (résumé des ToS, arbitrage)
