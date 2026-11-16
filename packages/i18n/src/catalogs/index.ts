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
 */
export const CATALOG_VERSION = 60;

/** Catalogues de base par langue ; la langue d'un profil de locale choisit le sien. */
export const CATALOGS: Readonly<Record<CatalogLanguage, VersionedCatalog<MessageKey>>> = {
  es: { version: CATALOG_VERSION, messages: ES_MESSAGES },
  en: { version: CATALOG_VERSION, messages: EN_MESSAGES },
  fr: { version: CATALOG_VERSION, messages: FR_MESSAGES },
  pt: { version: CATALOG_VERSION, messages: PT_MESSAGES },
};

/** Surcharge régionale : sous-ensemble de clés, mêmes emplacements que la base. */
export type RegionalOverrides = Readonly<Partial<Record<MessageKey, Message>>>;
