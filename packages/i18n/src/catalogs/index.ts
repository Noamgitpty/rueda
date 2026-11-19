import type { CatalogLanguage } from '../locale-profile.ts';
import { EN_MESSAGES } from './en.ts';
import { ES_MESSAGES } from './es.ts';
import { FR_MESSAGES } from './fr.ts';
import { PT_MESSAGES } from './pt.ts';
import type { MessageKey } from './es.ts';
import type { Message, VersionedCatalog } from './types.ts';

export type { MessageKey } from './es.ts';
export type { Catalog, Message, PluralCategory, PluralMessage, VersionedCatalog } from './types.ts';

/**
 * Version des catalogues (catalogue versionné, 19 US-014). Les quatre langues partagent la même
 * version : une clé ajoutée en es l'est en en, en fr et en pt dans le même commit. Version 8 :
 * portugais du Brésil (DEC-FONDATEUR-18) et sens changé de `common.brand.assetInvalid` et
 * `common.brand.contentLocaleMissing` (quatre langues exigées). Version 9 : coquille et PWA
 (US-048) : `web.shell.*`, `web.offline.*`, `common.offline.restored` et clés `web.s01.*` de
 l'accueil reprises de 10b §4.3. Version 10 : limitation de débit et anti-abus (US-052) :
 `common.rateLimit.*`. Version 11 : inscription et consentements versionnés (US-102) :
 `common.legal.*`, e-mails d'identité `common.auth.emailVerification.*` et
 `common.auth.accountExists.*`, clés `web.s15.*` du prototype US-033 devenues officielles et
 `web.legal.*`. Version 12 : cadre des actions de console (US-101) : `common.auth.actionRequested`,
 `common.auth.actionRefused`, `common.auth.selfApproval`, `backoffice.approvals.*`, nouvelles
 `backoffice.action.*`, et sens élargi de `backoffice.action.heading` et `backoffice.action.subject`
 (le sujet n'est plus seulement un voyage). Version 13 : compte d'hôte d'une personne physique
 (US-107) : `common.host.*` et `backoffice.action.CREATE_HOST_ACCOUNT`. Version 14 : blocs de contenu éditables (US-121) :
 `common.brand.contentKeyNotEditable`, `backoffice.content.gaps.*` (langues nommées par
 `Intl.DisplayNames`). Version 15 : catalogue de référence des véhicules (US-113) :
 `common.vehicle.*`. Version 16 : files de revue,
 fiche 360°, notes, dossiers, pièces et restrictions (US-109) : `common.ops.*`, `common.evidence.*`,
 `backoffice.queues.*`, `backoffice.queue.*`, `backoffice.kyc.*`, `backoffice.profile.*`,
 `backoffice.restriction.*`, `backoffice.case.*`, `backoffice.evidence.*`, `backoffice.action.RESTRICT_ACCOUNT`
 et `LIFT_RESTRICTION`. Version 17 : vérification du téléphone par OTP
 (US-104) : `common.otp.*`, `common.error.phoneDigits` (10b §4.3), clés OTP de S15 du prototype
 US-033 devenues officielles (`web.s15.phone`, `.code`, `.verify`, `.codeSent`, `.resendIn`) et
 nouvelles `web.s15.*`. Version 18 : lieux de remise, véhicules et annonces de l'hôte (US-115) :
 `common.listing.*`, `web.host.*`, `web.listing.*`. Version 19 : CGU de l'hôte (US-126) :
 `common.listing.hostTermsRequired`, `web.host.terms.*`, `web.legal.validFrom`,
 `web.legal.translation`, `web.legal.backHost`. Version 20 : calendrier par véhicule, blocages et préavis
 de l'hôte (US-119) : `common.calendar.*`, `web.calendar.*`. Version 21 : vérification d'identité et
 consentement biométrique (US-105) : `common.kyc.*` et `web.s04.*` (écran S04). Version 22 :
 interrupteurs par pays et avertissements réglementaires versionnés (US-125) : `common.regulatory.*`.
 Version 23 : file d'ajout au catalogue véhicules (US-114) : `common.catalogAddition.*`,
 `web.host.car.catalogHint`, `web.host.catalog.*`, `backoffice.catalog.*`,
 `ntf.catalogAdditionApproved.*` et `ntf.catalogAdditionRejected.*`.
 Version 24 : inscription et vérification de l'hôte, profil fiscal (US-123) :
 `common.hostVerification.*`, `web.a07.*` (liste de tâches A07, dont `web.a07.waitingCountry` de
 10b §4.3) et `web.host.verificationLink`. Version 25 : décision KYC de l'ops (US-106) : états
 SM-3, motifs, champs du permis, scores, contrôles cochés et refus `backoffice.kyc.*` ; messages
 au voyageur `web.s04.result.rejected*` et `web.s04.moreInfo.*`.
 Version 26 : documents et éligibilité du véhicule, contestation de plaque (US-124) :
 `common.vehicleDocs.*`, `common.vehicleReview.*`, `web.vehicleDocs.*`, `web.listing.hostName` et
 `backoffice.vehicle.*`.
 Version 27 : fiche technique à compléter d'une variante
 sans fiche du catalogue (import de la douane, suite d'US-113, ADR-109) :
 `backoffice.catalog.specsPending`.
 Version 28 : refus d'une réservation par l'hôte lui-même ou par un compte lié (US-127) :
 `common.booking.selfBookingForbidden.*`.
 Version 29 : dossier de l'hôte signalé dans la console (US-108, revue par exception) :
 `backoffice.host.*`, `backoffice.queues.openHost`, `common.listing.vehicleNotCovered` et
 `common.listing.insurerInactive`.
 Version 30 : numéro de châssis en deux formats, VIN ISO 3779 ou numéro non ISO (correctif
 d'US-124, ADR-113) : `common.vehicleDocs.vinInvalid`, `web.host.car.vinHint`,
 `web.vehicleDocs.declaration.vinHint`.
 Version 31 : publication immédiate d'une
 annonce, retrait et revue de l'ops sur signal (US-118) : `common.listing.published`,
 `.unlisted`, `.hasFutureTrips`, `.vehicleEligibilityRequired`,
 `.areaLooksLikeAddress`, `.cityInvalid`, `.vehicleDescriptionInvalid`, `common.listingReview.*`, `web.host.listing.unlist`, `.relist` ; sens
 changé de `web.host.listing.submit` (« publier »), `web.host.place.area` (sans rue ni numéro),
 `common.listing.photoAdded`, `.deleted`, `.photoMinCount`, `.hostTermsRequired`,
 `.hostNotActivated` (plus de revue systématique, DEC-FONDATEUR-22).
 Version 34 (numéro réservé par l'orchestrateur ; 32 et 33 aux PR en file) : écran « Apparence et
 marque » du back-office (US-120, O02) : `backoffice.o02.*`.
 Version 37 (numéro attribué par l'orchestrateur ; 35 et 36 à US-103 et US-111) : numéro fiscal de
 l'hôte facultatif, « jamais plus lourd que Turo » (US-123, ADR-115) : `web.a07.optional`,
 `web.a07.tax.optionalHint` et `web.a07.tax.reminder` (rappel de l'obligation fiscale de l'hôte).
 Version 38 : nom légal identique au permis (US-103, ADR-117) : `common.kyc.legalName*`
 (changement du nom), `backoffice.kyc.reason.LEGAL_NAME_*`, `backoffice.kyc.holderName` et
 `backoffice.kyc.nameMatch.*` (dossier KYC de la console).
 Version 39 : demandes des personnes saisies par l'action de console HANDLE_DSR (US-111,
 ADR-118) : `backoffice.dsr.*` (type, étape, refus) ; sens de `backoffice.action.HANDLE_DSR`
 inchangé (titre du formulaire).
 Version 40 : correctifs de la red team du lot 1 (US-122, ADR-122) : `common.ops.selfForbidden`
 (séparation des tâches de la console) et `common.vehicleDocs.claimLimitReached` (plafond de
 contestations ouvertes).
 Version 41 : correctifs de la passe n° 2 de la red team du lot 1 (US-122, ADR-124) :
 `common.listing.photoLimitReached` (galerie pleine) et `ntf.tripHostRestricted.*` (voyageur d'un
 trip à venir prévenu quand l'hôte est restreint).
 Version 42 : machine à états du trip (US-207, ADR-126) : `common.trip.transitionForbidden`,
 `common.trip.concurrentUpdate` et `common.trip.noShowTooEarly` (refus des commandes du trip).
 Version 43 : devis versionné (US-202, ADR-125) : `common.quote.unavailable`,
 `common.quote.datesInvalid` et `common.quote.changed` (route du devis).
 Version 45 : espace hôte, accueil et réservations de l'hôte (US-219, ADR-128) : `web.a02.*`
 (prochaines remises et retours), `web.a05.*` (onglets, filtres, voyageur minimisé, gains estimés),
 `common.hostTrips.*` (refus des routes des trips de l'hôte). La version 44 n'est pas utilisée.
 Version 47 : trip fee du voyageur (US-704, ADR-129) : `common.quote.line.tripFee` (libellé de la
 ligne du détail du prix) et `common.quote.line.tripFeeHint` (ce qu'il couvre, remboursé en cas
 d'annulation gratuite) ; `common.quote.*` de la version 43 passés au tutoiement en français
 (10b UX-12).
 Version 48 : recherche publique par zone, lieu, dates et heures (US-201, ADR-127) :
 `common.search.*` (refus de la recherche) et `web.search.*`, `web.listing.dates.*` (S01, liste des
 résultats, dates reprises sur la fiche). La version 46 n'est pas utilisée.
 Version 49 : avis reçus par e-mail et enregistrés par l'ops (US-218, ADR-130) : `backoffice.review.*`
 (formulaire RECORD_REVIEW de la console et refus de la commande liée) ; libellé de
 `backoffice.action.RECORD_REVIEW` corrigé (un avis reçu, pas une modération).
 Version 50 : cartes des résultats de la recherche (US-203, ADR-131) : `web.search.results.count`
 (compteur), `web.search.deposit.*` (montant de la caution de la plateforme, ou mention générique
 « une caution peut être demandée », 16 SRC-011, 08 T70 c) et `web.search.map.*` (carte des
 marqueurs de prix, positions approximatives, liste équivalente).
 Version 51 : fiche du véhicule (US-204, ADR-132) : `web.s03.photos` (10b §4.3),
 `web.listing.gallery.*` (galerie dans l'ordre de l'hôte, photo indisponible),
 `web.listing.slot.*` (dates choisies sur la fiche), `web.listing.meet.exact.*` et
 `web.listing.meet.sameReturn` (lieu exact du voyageur d'un trip confirmé),
 `common.listing.datesNoticeTooShort`, `common.listing.datesUnavailable` et
 `common.listing.meetingPointNotFound` (refus des routes de la fiche).
 Version 52 : checkout, partie back-end (US-208, ADR-133) : `common.quote.notFound`,
 `common.quote.rateLimited`, `common.quote.expired`, `common.quote.lineNotSupported` et
 `common.checkout.*` (refus de la route du checkout : devis engagé, mode sur demande, boîte
 manuelle, conducteur, conditions, pose du hold).
 Version 53 : checkout, écrans (US-208 partie 208b, ADR-134) : `web.listing.total.*` (prix final
 TTC des dates de la fiche S03), `web.s05.*` (checkout une page : récapitulatif, détail du prix,
 validité et prix expiré, conducteur, case de la boîte manuelle de 10b, cases des documents avec
 leur lien, bouton inactif et son aide, hold posé avec `web.s05.hold.until` de 10b, versions
 acceptées) et `web.legal.backCheckout` (retour d'un document au checkout).
 Version 55 (la 54 est réservée à US-209) : protections du voyageur et plans de gains de l'hôte,
 partie serveur (US-226 partie 226a, ADR-136) : `common.quote.protectionRequired`,
 `common.quote.protectionNotEligible`, `common.quote.insurerContractInactive` (refus du devis et du
 checkout), `common.quote.line.protection*` (ligne de protection du détail du prix de S05, nom du
 niveau) et `common.listing.earningsPlanSaved`, `common.listing.earningsPlanNotAvailable` (plan
 de gains du véhicule).
 Version 56 : contrôles bloquants du checkout (US-209 partie 209a, ADR-135 ; la 54, réservée,
 n'a jamais été publiée) : `common.checkout.ageClassMismatch` (âge minimum du conducteur au
 début du trip, ou date de naissance non vérifiée, 16 BKG-012) ; `common.checkout.identityConsentWithdrawn`
 retirée (le consentement retiré rend `KYC_BIOMETRIC_CONSENT_MISSING`, N-122).
 Version 57 : protections et plans de gains, écrans (US-226 partie
 226b, ADR-137) : `web.s05.protection.*` et `web.s05.age.*` (choix du niveau sur S05, âge déclaré,
 niveau grisé « dès {age} ans », prix par jour et pour la période), `common.price.protectionIncluded`
 (« protection de base incluse » près du total des cartes et de la fiche), `web.a11.plan.*` et
 `web.a11.coverage.*` (plan de gains du véhicule, effet sur les nouveaux trips, période couverte) ;
 noms des niveaux en minuscules dans les quatre langues (`common.quote.line.protection*`, revue ux
 de 226a).
 Version 58 : conditions de la fiche S03 (US-205,
 ADR-138) : `web.listing.cancel.*` (annulation gratuite en dates, dernière minute, règle du pays,
 retenue hors fenêtre sans durée écrite, lien vers la politique publiée), `web.listing.distance.*` (distance incluse sur la période, prix du km
 supplémentaire) et `web.listing.protection.*` (assureur partenaire, courtier, RC tiers incluse,
 franchises par niveau, exclusions du contrat, protection indisponible).
 Version 60 (la 59 est réservée à US-223) : conditions du checkout S05 et fiche, partie 205b
 (US-205, ADR-140) : `web.listing.cancel.untilStart` (dernière minute, départ dans moins que la
 fenêtre : gratuite jusqu'au départ, 08 BR-CXL-01), `web.listing.cancel.lastMinuteMinutes` et
 `web.listing.cancel.lateMinutes` (fenêtre de dernière minute du pays qui n'est pas un nombre
 entier d'heures), `web.listing.protection.unavailableShort` (section protection sans répéter le
 bandeau « pas encore réservable », revue ux de 205a n° 7), `web.s05.conditions.*` et
 `web.s05.cancel.retained*` (conditions de S05 : annulation gratuite en dates, retenue hors
 fenêtre en jours et en montant du moteur de règlement, taxes comprises, 10b UX-54) ;
 `web.s05.cancel.ifCancel*` (retenue sans date d'annulation gratuite) ; `web.s05.terms.title`
 renommé « documents que tu acceptes » (un seul titre « Condiciones » à l'écran, revue ux de 205b).
 Version 61 (la 59 est réservée à US-223, la 60 à US-205b) : décision de l'ops sur une réservation
 signalée et déclaration d'entrée, partie 209b (US-209, ADR-141) : `common.kyc.entryDeclared`,
 `common.kyc.entryDateInvalid` (déclaration d'entrée du voyageur à permis étranger, 16 VER-007),
 `common.bookingReview.notBooking` et `backoffice.booking.*` (dossier et décision d'une réservation
 signalée dans la console O01).
 Version 62 (la 61 est celle d'US-209b) : paiement du hold et attente de la preuve (US-223
 partie 223b, ADR-142) : `common.payment.*` (refus de la route du paiement : paiement indisponible,
 capacité bloquante du PSP, réservation en revue, hold échu ou déjà payé, début dépassé, tentatives
 épuisées, moyen indisponible), `web.s05.cta` (« Pagar {amount} », 10b S05 ; N-170) et `web.s05.pay.title`,
 `web.s06.*` (S06 de 10b : `pre.leaving`, `verifying.*` dont `verifying.notify` (promesse de notification d'UX-27), `support`, `payAgain`, états confirmé,
 refusé, échu, non prouvé, remboursé, numéro de réservation), `web.error.paymentDeclined` (heure
 limite lue dans l'API, aucune durée écrite) et `web.error.paidAfterRelease` (10b §4.3) ;
 `web.s05.hold.payment` et `web.s05.hold.ended` retirées (le paiement en ligne existe ; un hold
 non `ACTIVE` ouvre S06) ; `web.s06.interrupted.*` (page de paiement non ouverte, reprise sans
 second débit) ; `web.error.paidAfterRelease` sans liste de voitures proches (la page n'en montre pas).
 Version 64 (la 63 est réservée à US-211) : écrans du voyageur de la revue d'une réservation
 signalée, partie 209c (US-209, ADR-144) : `web.s05.review.*` (S05 d'un hold en revue, heure de la
 réponse lue dans l'API, aucune durée écrite ; réservation approuvée avec la fenêtre de paiement
 réelle ; aide vers la déclaration d'entrée), `web.s05.kyc.link` (lien vers S04 depuis les refus du
 conducteur, UXQ-12), `web.s06.reviewRejected.*` (hold libéré par la revue), `web.s04.entry.*`
 (déclaration d'entrée : statut, date mise en forme par langue) ; `common.payment.underReview` ne
 promet plus d'avis (aucune notification du voyageur avant GL-17).
 Version 65 (la 63 était la réservation d’origine ; la 64 est celle d’US-209c ; US-224a n’a pas ajouté de version) : contrat de location hôte–voyageur, partie 211a
 (US-211, ADR-143) : `ctr.contract.*` (libellés du PDF du contrat, figés dans le document à sa
 génération : parties, plateforme intermédiaire, véhicule, période, prix, protection, caution,
 distance, annulation, retard, territoire, bloc de signature, traduction de courtoisie).
 Version 67 (la 66 est réservée à US-224) : réservation sur demande, partie
 serveur 223c (US-223, ADR-146) : `common.request.*` (demande inconnue, échue, déjà traitée, voyageur
 devenu inéligible, montant non confirmé ; aucun débit dans chaque cas), messages des routes des
 demandes de l'hôte.
 Version 68 (la 66 est réservée à US-224, la 67 est celle d’US-223c) : routes et écrans du contrat
 de location, partie 211b (US-211, ADR-149) : `common.contract.*` (réponses des routes
 `/trips/{id}/contract` : introuvable, en préparation, version remplacée, plus signable, empreinte
 différente, texte effacé, indisponible), `web.contract.*` (résumé, équivalent HTML du PDF, PDF,
 empreinte, signature, versions : écrans S09 et A03), `web.s09.contract.*` (signature du
 voyageur : case, bouton, effet sur la remise), `web.a03.contract.*` (état de la signature vu par
 l'hôte), `web.a05.contract` et `web.s06.confirmed.contract` (liens vers le contrat) ;
 `ctr.contract.period` dit le nom du pays et l'heure locale au lieu du fuseau IANA.
 Version 69 (la 68 est celle d’US-211b) : annulation d’un voyage déclenchée par l’ops, partie
 215b (US-215, ADR-151) : `backoffice.cancel.*` (console O01 : demandeur, motif qualifié en liste
 fermée, confirmation avant envoi, état réel de la demande — en attente, réglée avec le porteur du
 coût et le remboursement par partie, en revue FINANCE, en échec — et la suite à donner ; refus de la
 commande et codes d’une demande garée expliqués).
 Version 70 (la 66 reste sautée, réservée à US-224 qui n'a pas livré de texte ; la 68 est celle
 d’US-211b, la 69 celle d’US-215b) : écrans du mode sur demande, partie 223d (US-223, ADR-152) :
 `web.s05.request.*` et `web.s05.ctaRequest` (S05 d'un hold de demande : autoriser sans débiter),
 `web.s07.request.*` (« demande envoyée », heure limite lue dans l'API, jamais une durée écrite ;
 demande acceptée, capture en cours), `web.s06.request.*` (refus, expiration, capture non aboutie),
 `web.error.requestDeclined` et `web.error.requestExpired` (10b §4.3), `web.a05.accept`,
 `web.a05.decline`, `web.a05.requests.*` et `web.a05.request.*` (demandes de l'hôte : liste,
 détail, confirmation, issue).
 Version 71 (la 70 est celle d’US-223d) : remboursement lu par sa partie, partie 224d (US-224,
 ADR-154) : `common.refund.*` (réponses de la route `/trips/{id}/refunds` : introuvable,
 indisponible), `web.s10.refund.*` (S10 · remboursement du voyageur : montant, rail sur le moyen
 d’origine, date d’émission, jamais une date de réception), `web.refund.*` (états et date
 d’émission vus par le voyageur et l’hôte), `web.a05.refund.*` (jambe HOST seulement, sur le
 détail du trip de l’hôte), `backoffice.refunds.*` (console : états SM-8, rails, parts demandées et
 ordre envoyé, avance, motifs de blocage ADVANCE_CAP_UNSET, HOST_ADVANCE_CAP,
 PLATFORM_BALANCE_UNKNOWN et codes REFUND_EXCEEDS_COLLECTED, SETTLEMENT_SUPERSEDED,
 FIN_REVIEW_REQUIRED, SUPERSEDED_UNSENT, NO_TARGET, MISMATCH expliqués).
 Version 72 (la 71 est celle d’US-224d) : correctifs serveur de la console, partie 215c (US-215,
 ADR-156) : `backoffice.profile.hostTrips` et `backoffice.profile.noHostTrip` (fiche 360° : trips à
 venir des comptes d'hôte de la personne, N-123) ; `ntf.tripHostRestrictionLifted.*` (voyageur d'un
 trip à venir prévenu de la levée de la restriction de son hôte, N-126).
 Version 73 (la 72 est celle d’US-215c) : confirmation de réservation (US-213,
 ADR-157) : `ntf.bookingConfirmed.*` revu (adresse exacte, contrat à signer, permis physique,
 conseils de sécurité de 10b `web.s07.safety` ; jamais le téléphone de l’hôte ; numéros du
 support et de l’assistance de l’assureur : GL-36), `ntf.bookingConfirmedHost.*` (confirmation à
 l’hôte, sans donnée du voyageur), `ntf.bookingRequestReceived.*`, `ntf.bookingRequestDeclined.*`,
 `ntf.bookingRequestExpired.*`, `ntf.bookingRequestFailed.*` et `ntf.bookingRequestFailedHost.*`
 (demandes de réservation : reçue par l’hôte avec l’heure limite de la base ; refus, expiration,
 capture non aboutie), `web.s07.title`, `web.s07.documents`, `web.s07.safety` (S06 confirmé,
 10b S07).
 Version 76 (74 et 75 réservées à des stories en cours ; la 73 est celle d’US-213) : « Mis viajes » et détail du
 trip du voyageur (US-214, ADR-160) : `common.trips.*` (réponses des routes `/trips` et
 `/trips/{id}` : introuvable, indisponible), `web.s08.*` (S08 : sections demandes envoyées, à
 venir, en cours, passés, annulés ; carte du trip ; heure limite de réponse d'une demande ; vide
 `web.s08.none`, texte de `web.s08.empty` de 10b §4.3 dont la clé est tenue par le prototype),
 `web.s09.*` (S09 : lieu de remise, hôte particulier, total payé,
 documents — contrat ; constancia et reçu annoncés —, modification par le support, BR-MOD-01).
 Version 77 (la 76 est celle d’US-214 ; 74 et 75 restent sautées) : reçu des gains de l’hôte et reçu du trip fee, partie 217a (US-217, ADR-161) :
 `common.receipt.*` (réponses de la route `/trips/{id}/receipt` : introuvable, pas encore
 disponible, indisponible) et `common.earnings.*` (réponses de la route
 `/host/accounts/{orgId}/earnings/{month}` : introuvable, indisponible). Les écrans A08 et S09
 (Bêta L3) viendront avec leurs propres clés.
 Version 78 (la 77 est celle d’US-217a) : constancia
 d’arrendamiento et centre juridique (US-212, ADR-162) : `ctr.constancia.*` (texte du PDF de la
 constancia, espagnol qui fait foi puis langue du lecteur, gabarit BROUILLON, GL-39),
 `common.constancia.*` (réponses des routes `/trips/{id}/constancia` et
 `/trips/constancias/search`), `web.constancia.*` (écran de la constancia et recherche de
 l’hôte par plaque et date), `web.contract.documents`, `web.contract.constancia`,
 `web.contract.constanciaSearch`, `web.contract.legalCenter` (liens depuis S09 · contrat et A03),
 `web.legalCenter.*` (centre juridique : positionnement d’intermédiaire entre particuliers,
 documents publiés, documents de chaque voyage, désaccords et médiation, loi applicable).
 Version 81 (79 et 80 réservées à US-225 et US-227, en cours ; la 78 est celle d’US-212) :
 remboursement réparti sur les moyens d’origine (US-224 partie 224f, ADR-166) :
 `backoffice.cancel.outcome.REFUND_RAIL_UNAVAILABLE`, `…REFUND_RAIL_NOT_NATIVE`,
 `…REFUND_EXCEEDS_TENDER` (codes d’une demande d’annulation garée, console).
 Version 82 (la 79 qui lui était réservée a été dépassée par la 81 d’US-224f) : rails de la caution (US-225, ADR-164) : `web.deposit.unavailable` (refus avant le
 paiement avec la durée possible, texte de 10b UX-24) et `web.deposit.unavailableNone` (aucune
 durée possible, PROPOSÉ), affichés par l'écran S05 quand il branchera la décision de la caution.
 Version 83 (la 82 est celle d’US-225) : lieux de prise
 et de retour (US-514, ADR-168) : `common.checkout.oneWayNotAllowed` (lieu de retour différent du
 lieu de prise refusé au checkout, 16 BKG-016 : one-way interdit).
 Version 84 (la 83 est celle d’US-514) : reçu du voyageur et gains de l’hôte
 (US-217 partie 217b, ADR-167) : `web.s09.receipt.*` (S09 · reçu : total payé, trip fee et sa
 taxe de ligne, remboursement dû, mention d’intermédiaire, reçu sans valeur fiscale),
 `web.s09.documents.receiptOpen`, `web.a08.*` (A08 : acquis, à liquider, lignes par voyage,
 pénalité en ligne séparée ; `web.a08.empty`, `web.a08.payoutsOff` de 10b §4.3 et
 `web.a08.title` du prototype US-033 devenues officielles),
 `web.host.earningsLink`.
 Version 85 (la 84 est celle d’US-217b) : caution figée au checkout (US-701, ADR-169) :
 `web.deposit.none` (S05 : aucune caution pour ce trip, 08 BR-PAY-06) et
 `common.payment.depositUnavailable` (réponse 409 `DEPOSIT_RAIL_UNAVAILABLE` /
 `DEPOSIT_PARAM_MISSING` de `POST /checkout/holds/{id}/payment`, avec une sortie : autres dates,
 autre voiture).
 Version 86 (la 85 est celle d’US-701) : fin d’US-212 (partie 212b, ADR-162 n° 6 et n° 10) :
 `web.s05.intermediary` et `web.s05.intermediaryNoHost` (mention d’intermédiaire entre
 particuliers et hôte en prénom et initiale au checkout S05, 19 US-212 critère 3) ; « constancia de
 alquiler » et « empresa de alquiler » au lieu d’« arrendamiento » / « arrendadora » en espagnol
 (`ctr.constancia.title`, `ctr.constancia.platform`, `web.s09.documents.constancia`) ; tutoiement
 du centre juridique (`web.legalCenter.trip.body`, `web.legalCenter.disputes.body1` à `body3`, es
 et fr). Textes juridiques toujours BROUILLON (GL-39).
 Version 87 (la 86 est celle d’US-212b) : décision de la caution (US-702, ADR-172) : avis au
 voyageur `ntf.depositReleased.*` (caution libérée en entier) et `ntf.depositPartiallyCaptured.*`
 (frais annexes annoncés capturés, reste libéré), sur `deposit.decision.executed`.
 Version 88 (la 87 est celle d’US-702) : durcissement argent n° 2 d'US-224 (BOARD
 N-365) : texte pt-BR de `backoffice.cancel.outcome.REFUND_RAIL_NOT_NATIVE` corrigé (« sobre outro
 meio de pagamento », calque de l'espagnol, devient « para um pagamento feito com outro meio ») ;
 es, en, fr inchangés.
 Version 90 (la 88 est celle du durcissement d’US-224 ; la 89 est réservée à US-702b) :
 numéros du support et de l’assistance de l’assureur dans la confirmation de réservation (US-213,
 ADR-174) : `ntf.assistance.<guest|host>.<email|sms>.<numbers|inApp>` (avec les numéros du pays,
 ou renvoi à la réservation dans l’appli tant qu’ils ne sont pas fournis, hors production
 seulement) ; emplacement `{assistance}` ajouté à `ntf.bookingConfirmed.*.body` et
 `ntf.bookingConfirmedHost.*.body`.
 Version 91 (la 89, réservée, n’a pas été prise ; la 90 est celle d’US-213b) : corrections « avant ouverture »
 de la décision de la caution (US-702b, ADR-172) : avis au voyageur
 `ntf.depositBlockedUntilExpiry.*` (annulation de l’autorisation refusée : montant bloqué par la
 banque jusqu’à l’expiration de l’autorisation, rien de prélevé ; 08 E3 repli 4).
 Version 92 (la 91 est celle d’US-702b ; la 89, réservée, n’a pas été prise) : ouverture du mode sur
 demande (US-223, ADR-175 ; BOARD N-246, N-288) : `web.s03.request` (S03 : « {host_name} confirma
 en hasta {count} horas », texte de 10b promu du prototype, qui lit désormais le catalogue
 officiel), `web.s05.request.continue` (bouton du devis S05 d’une annonce sur demande : le voyageur
 envoie sa demande à l’étape suivante, jamais deux boutons « Enviar solicitud » de suite),
 `web.s06.request.authorizationRelease` (S06 refusée ou expirée : l’autorisation de la carte est
 annulée, sans débit) ; es de `web.s06.request.captureFailed.body` aligné sur en (« Estamos
 anulando », BOARD N-289).
 Version 93 (la 92 est celle d’US-223e) : signal « paiement hors plateforme » des textes publics
 de l’hôte (US-222d, ADR-176, comme Turo) : `common.listing.offPlatformPayment` (zone ou ville
 qui proposent un paiement hors de la plateforme : refus rattaché au champ).
 Version 94 (la 93 est celle d’US-222d) : photos guidées de l’état du véhicule (US-303, ADR-179) :
 `common.inspection.*` (refus des routes `/trips/{id}/inspections/…`), `web.inspection.*` (écran
 des photos de départ et de retour de l’hôte et du voyageur, angles du gabarit) et `web.s09c.done`
 de 10b §4.3 (texte portugais ajouté).
 Version 95 (la 94 est celle d’US-303) : compte de versement de l’hôte (US-707) : réponses de
 l’API `common.payoutAccount.*` (état, enregistrement, co-hôte refusé, numéro fiscal exigé,
 numéro de compte ou rail refusés, titulaire discordant, coffre, base ou rail du pays
 indisponibles) et écran `web.a07.payout.*` (compte masqué aux 4 derniers chiffres, statut, retenue de 48 h après un
 changement, formulaire).
 Version 96 (la 95 est celle d’US-707 ; la 94 celle d’US-303) : messagerie par trip et signal du marché gris (US-525, ADR-181) : `common.messages.*`
 (réponses des routes `/trips/{id}/messages` : fil, message envoyé, fil fermé, texte invalide,
 indisponible), `web.s16.*` (S16 : bandeau `web.s16.payOnPlatform` et vide `web.s16.empty` de 10b
 §4.3, prénom de l’autre partie, coordonnées masquées, rappels à l’expéditeur après un signal,
 fenêtre d’écriture, formulaire).
 Version 97 (réservée à US-310 par le pré-mortem du lot 3 ; la 96 est celle d’US-525 ; les 94 et 95 celles d’US-303 et
 US-707) : aide et urgence pendant le trip (US-310, ADR-182) : `web.shell.help` (lien
 d’aide de l’en-tête de chaque écran), `web.help.*` (S17 : urgences et autorité de circulation
 du pays, assistance de l’assureur partenaire, support et sa plage publiée, demande d’aide du trip
 à motif fermé et ses issues, FAQ courte ; `web.help.call`, inutilisée, retirée avant la fusion), `common.help.unavailable`,
 `common.help.authority.<id>` (autorité de circulation de la configuration pays) et la réponse
 automatique hors plage `ntf.helpOffHours.*` / `ntf.helpOffHoursHost.*`.
 Version 98 (la 97 est celle d’US-310) : remise et retour du véhicule entre
 particuliers (US-315, ADR-183) : `common.handover.*` (refus des routes `/trips/{id}/handover/…`,
 dont `common.handover.unavailable` : sans réseau, réessayer, aucune file hors ligne au lot 3),
 `web.a03.arrived`, `web.a03.refuse`, `web.a03.handover` et les 6 points `web.a03.check.*` de
 10b §4.3 (texte portugais ajouté), `web.handover.*` (étapes A03, A04 et S09 · check-in /
 check-out, blocages, relevés, validation, liens du détail du trip).
 */
export const CATALOG_VERSION = 98;

/** Catalogues de base par langue ; la langue d'un profil de locale choisit le sien. */
export const CATALOGS: Readonly<Record<CatalogLanguage, VersionedCatalog<MessageKey>>> = {
  es: { version: CATALOG_VERSION, messages: ES_MESSAGES },
  en: { version: CATALOG_VERSION, messages: EN_MESSAGES },
  fr: { version: CATALOG_VERSION, messages: FR_MESSAGES },
  pt: { version: CATALOG_VERSION, messages: PT_MESSAGES },
};

/** Surcharge régionale : sous-ensemble de clés, mêmes emplacements que la base. */
export type RegionalOverrides = Readonly<Partial<Record<MessageKey, Message>>>;
