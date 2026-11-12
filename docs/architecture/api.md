<!-- Fichier GÉNÉRÉ depuis apps/api/openapi/openapi.json (US-038, ADR-079) : ne pas modifier à la main. -->
<!-- Régénérer : RUEDA_DOCS_WRITE=1 pnpm --filter @rueda/api exec vitest run src/testing/docs ; la CI échoue si ce fichier n'est plus à jour. -->

# Référence de l’API HTTP

Contrat OpenAPI 3.1.0, version 0.2.0 : [`apps/api/openapi/openapi.json`](../../apps/api/openapi/openapi.json) (fait foi). Contrat HTTP de l'API (US-041, complété par US-038). Écrit à la main et VÉRIFIÉ contre le code (ADR-079) : routes montées par Nest, codes d'erreur des catalogues, couverture de chaque statut par un test de contrat, référence docs/architecture/api.md régénérée.

Chaque statut ci-dessous est exercé par un test de contrat sur l’application réelle (`ContractClient`) ; les codes d’erreur sont ceux des catalogues du code (16 A.8). Corps d’erreur : `{ code, messageKey, values? }` (le client affiche le texte dans sa langue).

## `/auth`

| Méthode | Chemin | operationId | Résumé | Statuts et codes |
| ------- | ------ | ----------- | ------ | ---------------- |
| `POST` | `/auth/login` | `login` | Connexion : jeton dans le cookie __Host-session seulement | **200** application/json<br>**400** REQUEST_INVALID<br>**401** AUTH_INVALID_CREDENTIALS<br>**415** REQUEST_INVALID<br>**429** RATE_LIMITED |
| `POST` | `/auth/logout` | `logout` | Déconnexion (idempotente) | **204** sans corps<br>**415** REQUEST_INVALID |
| `POST` | `/auth/logout-all` | `logoutAll` | Déconnexion de toutes les sessions | **204** sans corps<br>**401** AUTH_REQUIRED<br>**415** REQUEST_INVALID |
| `GET` | `/auth/session` | `getSession` | Principal de la session courante | **200** application/json<br>**401** AUTH_REQUIRED |
| `POST` | `/auth/signup` | `signup` | Inscription (ACC-001) : réponse identique que l'email soit libre ou pris | **202** SIGNUP_ACCEPTED<br>**400** AUTH_EMAIL_INVALID / AUTH_PASSWORD_WEAK / AUTH_TERMS_NOT_ACCEPTED / REQUEST_INVALID / COUNTRY_UNKNOWN<br>**409** TERMS_VERSION_CHANGED<br>**415** REQUEST_INVALID<br>**429** RATE_LIMITED<br>**503** LEGAL_DOCUMENT_UNAVAILABLE |
| `POST` | `/auth/verify-email` | `verifyEmail` | Vérification de l'adresse (lien à usage unique) | **200** EMAIL_VERIFIED<br>**400** AUTH_LINK_EXPIRED / REQUEST_INVALID<br>**415** REQUEST_INVALID |

## `/brand`

| Méthode | Chemin | operationId | Résumé | Statuts et codes |
| ------- | ------ | ----------- | ------ | ---------------- |
| `GET` | `/brand` | `getPublishedBrand` | Version publiée du socle de marque (DSN-002) | **200** application/json<br>**304** sans corps<br>**503** BRAND_VERSION_UNAVAILABLE |
| `GET` | `/brand/assets/{id}` | `getBrandAsset` | Octets d'un actif publié (type vérifié à l'envoi) | **200** image/png, image/jpeg, image/webp, font/woff2<br>**400** REQUEST_INVALID<br>**404** BRAND_VERSION_NOT_FOUND<br>**503** BRAND_ASSET_UNAVAILABLE |
| `GET` | `/brand/content` | `getPublishedContent` | Blocs de contenu publiés dans une langue, repli es signalé (DSN-004) | **200** application/json<br>**400** REQUEST_INVALID |

## `/console`

| Méthode | Chemin | operationId | Résumé | Statuts et codes |
| ------- | ------ | ----------- | ------ | ---------------- |
| `POST` | `/console/actions` | `consoleAction` | Action de console motivée et idempotente : commande de domaine liée ou enregistrement seul (ADM-001, 17 §10, US-101) | **200** application/json<br>**201** application/json<br>**400** REQUEST_INVALID<br>**401** AUTH_REQUIRED<br>**403** FORBIDDEN / 2FA_REQUIRED<br>**409** STAFF_ACTION_UNAVAILABLE / STAFF_ACTION_REFUSED<br>**415** REQUEST_INVALID<br>**429** RATE_LIMITED |
| `POST` | `/console/brand/assets` | `consoleBrandAsset` | Actif de marque (base64, type réel vérifié, 64 Kio au plus) | **201** application/json<br>**400** REQUEST_INVALID<br>**401** AUTH_REQUIRED<br>**403** FORBIDDEN / 2FA_REQUIRED<br>**409** VERSION_CONFLICT<br>**415** REQUEST_INVALID<br>**422** BRAND_ASSET_INVALID<br>**429** RATE_LIMITED<br>**503** BRAND_ASSET_UNAVAILABLE |
| `POST` | `/console/brand/drafts` | `consoleBrandDraft` | Brouillon de marque (jetons DTCG ou palette du dépôt) | **201** application/json<br>**400** REQUEST_INVALID<br>**401** AUTH_REQUIRED<br>**403** FORBIDDEN / 2FA_REQUIRED<br>**409** VERSION_CONFLICT<br>**415** REQUEST_INVALID<br>**422** BRAND_TOKENS_INVALID / FONT_NOT_APPROVED<br>**429** RATE_LIMITED |
| `POST` | `/console/brand/rollback` | `consoleBrandRollback` | Retour arrière en un clic vers la version publiée précédente (ou une cible) | **201** application/json<br>**400** REQUEST_INVALID<br>**401** AUTH_REQUIRED<br>**403** FORBIDDEN / 2FA_REQUIRED<br>**404** BRAND_VERSION_NOT_FOUND<br>**409** VERSION_CONFLICT<br>**415** REQUEST_INVALID<br>**422** BRAND_CONTRAST_INSUFFICIENT / FONT_NOT_APPROVED / BRAND_TOKENS_INVALID<br>**429** RATE_LIMITED |
| `GET` | `/console/brand/versions` | `consoleBrandVersions` | Historique des versions de marque, brouillons compris | **200** application/json<br>**401** AUTH_REQUIRED<br>**403** FORBIDDEN / 2FA_REQUIRED<br>**429** RATE_LIMITED |
| `GET` | `/console/brand/versions/{id}` | `consoleBrandVersion` | Une version de marque (prévisualisation) | **200** application/json<br>**400** REQUEST_INVALID<br>**401** AUTH_REQUIRED<br>**403** FORBIDDEN / 2FA_REQUIRED<br>**404** BRAND_VERSION_NOT_FOUND<br>**429** RATE_LIMITED |
| `POST` | `/console/brand/versions/{id}/publish` | `consoleBrandPublish` | Publication d’un brouillon (contraste d’US-030 recalculé) | **200** application/json<br>**400** REQUEST_INVALID<br>**401** AUTH_REQUIRED<br>**403** FORBIDDEN / 2FA_REQUIRED<br>**404** BRAND_VERSION_NOT_FOUND<br>**409** VERSION_CONFLICT<br>**415** REQUEST_INVALID<br>**422** BRAND_CONTRAST_INSUFFICIENT / FONT_NOT_APPROVED / BRAND_TOKENS_INVALID<br>**429** RATE_LIMITED |
| `POST` | `/console/cases` | `consoleCaseOpen` | Ouverture d'un dossier de support assigné à l'acteur (17 §3.2.13, US-109) | **200** application/json<br>**201** application/json<br>**400** REQUEST_INVALID<br>**401** AUTH_REQUIRED<br>**403** FORBIDDEN / 2FA_REQUIRED<br>**415** REQUEST_INVALID<br>**429** RATE_LIMITED |
| `POST` | `/console/cases/{id}/status` | `consoleCaseStatus` | Changement d'état d'un dossier par son assigné ou un ADMIN du pays (US-109) | **200** application/json<br>**400** REQUEST_INVALID<br>**401** AUTH_REQUIRED<br>**403** FORBIDDEN / 2FA_REQUIRED / STAFF_CASE_REQUIRED<br>**415** REQUEST_INVALID<br>**429** RATE_LIMITED |
| `POST` | `/console/content/drafts` | `consoleContentDraft` | Brouillon d’un bloc de contenu (es, en, fr, pt) | **201** application/json<br>**400** REQUEST_INVALID<br>**401** AUTH_REQUIRED<br>**403** FORBIDDEN / 2FA_REQUIRED<br>**409** VERSION_CONFLICT<br>**415** REQUEST_INVALID<br>**422** CONTENT_BLOCK_REQUIRED_MISSING / CONTENT_KEY_FORBIDDEN / CONTENT_MARKDOWN_FORBIDDEN / CONTENT_KEY_NOT_EDITABLE<br>**429** RATE_LIMITED |
| `GET` | `/console/content/gaps` | `consoleContentGaps` | Blocs publiés à revoir : langue absente, corps hors des règles, clé hors du registre (US-121) | **200** application/json<br>**401** AUTH_REQUIRED<br>**403** FORBIDDEN / 2FA_REQUIRED<br>**429** RATE_LIMITED |
| `POST` | `/console/content/publish` | `consoleContentPublish` | Publication d’une version d’un bloc de contenu | **200** application/json<br>**400** REQUEST_INVALID<br>**401** AUTH_REQUIRED<br>**403** FORBIDDEN / 2FA_REQUIRED<br>**404** CONTENT_BLOCK_NOT_FOUND<br>**409** VERSION_CONFLICT<br>**415** REQUEST_INVALID<br>**422** CONTENT_KEY_FORBIDDEN<br>**429** RATE_LIMITED |
| `POST` | `/console/content/rollback` | `consoleContentRollback` | Retour à la version précédente (ou cible) d’un bloc de contenu | **201** application/json<br>**400** REQUEST_INVALID<br>**401** AUTH_REQUIRED<br>**403** FORBIDDEN / 2FA_REQUIRED<br>**404** CONTENT_BLOCK_NOT_FOUND<br>**409** VERSION_CONFLICT<br>**415** REQUEST_INVALID<br>**422** CONTENT_KEY_FORBIDDEN<br>**429** RATE_LIMITED |
| `POST` | `/console/evidence` | `consoleEvidenceUpload` | Pièce du staff : type réel (JPEG, PNG, HEIC, PDF), taille, droit, antivirus, puis dépôt chiffré (PRIVATE_EVIDENCE, US-109) | **200** application/json<br>**201** application/json<br>**400** REQUEST_INVALID<br>**401** AUTH_REQUIRED<br>**403** FORBIDDEN / 2FA_REQUIRED<br>**415** REQUEST_INVALID<br>**422** EVIDENCE_REJECTED<br>**429** RATE_LIMITED<br>**503** EVIDENCE_UNAVAILABLE |
| `GET` | `/console/finance/approvals` | `consoleFinanceApprovals` | Demandes FINANCE en attente d'une seconde personne (FINANCE et ADMIN du pays, RLS-24) | **200** application/json<br>**401** AUTH_REQUIRED<br>**403** FORBIDDEN / 2FA_REQUIRED<br>**429** RATE_LIMITED |
| `POST` | `/console/finance/approvals/{id}/approve` | `consoleFinanceApprove` | Approbation d'une demande FINANCE par une seconde personne distincte (cmd_approve_finance_action, RLS-24) | **200** application/json<br>**400** REQUEST_INVALID<br>**401** AUTH_REQUIRED<br>**403** FORBIDDEN / 2FA_REQUIRED<br>**409** STAFF_SELF_APPROVAL / STAFF_ACTION_REFUSED<br>**415** REQUEST_INVALID<br>**429** RATE_LIMITED |
| `GET` | `/console/queues` | `consoleQueues` | Files de revue : résumé par file (ouverts, en retard) et éléments d'une file, retard signalé par la base (ADM-029, US-109) | **200** application/json<br>**400** REQUEST_INVALID<br>**401** AUTH_REQUIRED<br>**403** FORBIDDEN / 2FA_REQUIRED<br>**429** RATE_LIMITED |
| `POST` | `/console/queues/items/{id}/claim` | `consoleQueueClaim` | Prise en charge d'un élément de file (assignation à soi), journalisée (US-109) | **200** application/json<br>**400** REQUEST_INVALID<br>**401** AUTH_REQUIRED<br>**403** FORBIDDEN / 2FA_REQUIRED<br>**409** STAFF_ITEM_TAKEN<br>**415** REQUEST_INVALID<br>**429** RATE_LIMITED |
| `POST` | `/console/queues/items/{id}/kyc` | `consoleQueueKycDossier` | Dossier KYC par la file KYC seulement (élément assigné), journalisé READ_C3 avant la lecture (L1-PM-08, US-109) | **200** application/json<br>**400** REQUEST_INVALID<br>**401** AUTH_REQUIRED<br>**403** FORBIDDEN / 2FA_REQUIRED / STAFF_CASE_REQUIRED<br>**415** REQUEST_INVALID<br>**429** RATE_LIMITED |
| `GET` | `/console/security/abuse` | `consoleSecurityAbuse` | Tableau des abus agrégés par heure (security.read_abuse) | **200** application/json<br>**400** REQUEST_INVALID<br>**401** AUTH_REQUIRED<br>**403** FORBIDDEN / 2FA_REQUIRED<br>**429** RATE_LIMITED |
| `POST` | `/console/users/{id}/notes` | `consoleUserNote` | Note interne sur une personne, jamais visible des clients (ADM-005, US-109) | **200** application/json<br>**201** application/json<br>**400** REQUEST_INVALID<br>**401** AUTH_REQUIRED<br>**403** FORBIDDEN / 2FA_REQUIRED / STAFF_CASE_REQUIRED<br>**415** REQUEST_INVALID<br>**429** RATE_LIMITED |
| `POST` | `/console/users/{id}/profile` | `consoleUserProfile` | Fiche 360° (ADM-005) : couverture par dossier ou élément assigné, journalisée READ_C2_SUPPORT (US-109) | **200** application/json<br>**400** REQUEST_INVALID<br>**401** AUTH_REQUIRED<br>**403** FORBIDDEN / 2FA_REQUIRED / STAFF_CASE_REQUIRED<br>**415** REQUEST_INVALID<br>**429** RATE_LIMITED |
| `POST` | `/console/users/search` | `consoleUserSearch` | Recherche d'une personne par son e-mail exact, journalisée (ADM-005, US-109) | **200** application/json<br>**400** REQUEST_INVALID<br>**401** AUTH_REQUIRED<br>**403** FORBIDDEN / 2FA_REQUIRED<br>**404** STAFF_USER_NOT_FOUND<br>**415** REQUEST_INVALID<br>**429** RATE_LIMITED |

## `/host`

| Méthode | Chemin | operationId | Résumé | Statuts et codes |
| ------- | ------ | ----------- | ------ | ---------------- |
| `POST` | `/host/accounts` | `openHostAccount` | Ouverture du compte d'hôte de la personne de la session (personne physique, un par pays ; US-107) | **201** application/json<br>**400** REQUEST_INVALID / COUNTRY_UNKNOWN<br>**401** AUTH_REQUIRED<br>**403** HOST_ACCOUNT_NOT_ELIGIBLE<br>**409** HOST_ACCOUNT_EXISTS<br>**415** REQUEST_INVALID<br>**422** HOST_ENTITY_NOT_ALLOWED / HOST_UNDER_AGE<br>**503** HOST_ACCOUNT_UNAVAILABLE |
| `GET` | `/host/accounts/{orgId}/catalog/makes` | `hostCatalogMakes` | Marques ACTIVE du catalogue de référence (US-113, US-115) | **200** application/json<br>**401** AUTH_REQUIRED<br>**404** HOST_ACCOUNT_NOT_FOUND |
| `GET` | `/host/accounts/{orgId}/catalog/makes/{makeId}/models` | `hostCatalogModels` | Modèles ACTIVE d'une marque (US-113, US-115) | **200** application/json<br>**401** AUTH_REQUIRED<br>**404** HOST_ACCOUNT_NOT_FOUND |
| `GET` | `/host/accounts/{orgId}/catalog/models/{modelId}/variants` | `hostCatalogVariants` | Variantes ACTIVE d'un modèle, communes ou du marché du compte d'hôte (réserve de la revue d'US-113 ; US-115) | **200** application/json<br>**400** REQUEST_INVALID<br>**401** AUTH_REQUIRED<br>**404** HOST_ACCOUNT_NOT_FOUND |
| `GET` | `/host/accounts/{orgId}/catalog/variants/{variantId}/prefill` | `hostCatalogPrefill` | Préremplissage du véhicule depuis une variante du marché du compte (US-113, US-115) | **200** application/json<br>**401** AUTH_REQUIRED<br>**404** HOST_ACCOUNT_NOT_FOUND / CATALOG_VARIANT_NOT_FOUND |
| `GET` | `/host/accounts/{orgId}/listings` | `hostListings` | Annonces du compte d'hôte de la session, hors supprimées (US-115) | **200** application/json<br>**401** AUTH_REQUIRED<br>**404** HOST_ACCOUNT_NOT_FOUND |
| `POST` | `/host/accounts/{orgId}/listings` | `createHostListing` | Annonce DRAFT d'un véhicule du compte (une par véhicule ; prix au pas du pays ; US-115) | **201** application/json<br>**400** REQUEST_INVALID<br>**401** AUTH_REQUIRED<br>**404** HOST_ACCOUNT_NOT_FOUND / VEHICLE_NOT_FOUND<br>**409** LISTING_EXISTS<br>**415** REQUEST_INVALID<br>**422** PRICE_INVALID / MILEAGE_CONFIG_INVALID / REQUEST_MODE_NOT_ALLOWED |
| `DELETE` | `/host/accounts/{orgId}/listings/{listingId}` | `deleteHostListing` | Suppression d'un brouillon, d'une annonce refusée ou bloquée (SM-2 vers DELETED ; US-115) | **200** application/json<br>**401** AUTH_REQUIRED<br>**404** HOST_ACCOUNT_NOT_FOUND / LISTING_NOT_FOUND<br>**409** LISTING_TRANSITION_FORBIDDEN<br>**415** REQUEST_INVALID |
| `POST` | `/host/accounts/{orgId}/listings/{listingId}/photos` | `addHostListingPhoto` | Photo d'annonce (JPEG, PNG, WebP ; type réel, dimensions, métadonnées EXIF retirées, antivirus) ; production : 503 tant que l'antivirus ClamAV et le stockage objet ne sont pas branchés (US-115) | **201** application/json<br>**400** REQUEST_INVALID<br>**401** AUTH_REQUIRED<br>**404** HOST_ACCOUNT_NOT_FOUND / LISTING_NOT_FOUND<br>**409** LISTING_TRANSITION_FORBIDDEN<br>**415** REQUEST_INVALID<br>**422** PHOTO_FORMAT<br>**503** PHOTO_UPLOAD_UNAVAILABLE |
| `PUT` | `/host/accounts/{orgId}/listings/{listingId}/pricing` | `updateHostListingPricing` | Prix journalier et distance incluse (effet sur les nouveaux devis seulement ; un trip confirmé garde son prix ; US-115) | **200** application/json<br>**400** REQUEST_INVALID<br>**401** AUTH_REQUIRED<br>**404** HOST_ACCOUNT_NOT_FOUND / LISTING_NOT_FOUND<br>**409** LISTING_TRANSITION_FORBIDDEN<br>**415** REQUEST_INVALID<br>**422** PRICE_INVALID / MILEAGE_CONFIG_INVALID |
| `POST` | `/host/accounts/{orgId}/listings/{listingId}/submit` | `submitHostListing` | Soumission SM-2 DRAFT vers PENDING_REVIEW : photos, CGU de l'hôte (US-126), compte ACTIVE, pays ouvert (US-115) | **200** application/json<br>**401** AUTH_REQUIRED<br>**404** HOST_ACCOUNT_NOT_FOUND / LISTING_NOT_FOUND<br>**409** LISTING_TRANSITION_FORBIDDEN / TERMS_REACCEPT_REQUIRED<br>**415** REQUEST_INVALID<br>**422** PHOTO_MIN_COUNT / HOST_NOT_ACTIVATED |
| `GET` | `/host/accounts/{orgId}/locations` | `hostLocations` | Lieux de remise du compte d'hôte de la session (exacts : l'hôte seul ; US-115) | **200** application/json<br>**401** AUTH_REQUIRED<br>**404** HOST_ACCOUNT_NOT_FOUND |
| `POST` | `/host/accounts/{orgId}/locations` | `createHostLocation` | Lieu de remise (pays et fuseau du compte d'hôte ; épingle facultative, sans géocodage ; US-115) | **201** application/json<br>**400** REQUEST_INVALID<br>**401** AUTH_REQUIRED<br>**403** HOST_ACCOUNT_SUSPENDED<br>**404** HOST_ACCOUNT_NOT_FOUND<br>**415** REQUEST_INVALID<br>**503** LISTING_UNAVAILABLE |
| `PUT` | `/host/accounts/{orgId}/locations/{locationId}/notice` | `setHostLocationNotice` | Préavis minimum d'un lieu de remise : 60 à 10 080 min au pas de 30, ou null (défaut du pays) ; contrôlé à la pose d'un hold (DATES_NOTICE_TOO_SHORT ; US-119) | **200** application/json<br>**400** REQUEST_INVALID<br>**401** AUTH_REQUIRED<br>**404** HOST_ACCOUNT_NOT_FOUND / LOCATION_NOT_FOUND<br>**415** REQUEST_INVALID |
| `GET` | `/host/accounts/{orgId}/terms` | `getHostTerms` | CGU de l'hôte du compte d'hôte (pays du compte) : version, date, langue, BROUILLON, état d'acceptation (US-126) | **200** application/json<br>**400** REQUEST_INVALID<br>**401** AUTH_REQUIRED<br>**404** HOST_ACCOUNT_NOT_FOUND<br>**503** LEGAL_DOCUMENT_UNAVAILABLE |
| `POST` | `/host/accounts/{orgId}/terms/accept` | `acceptHostTerms` | Accepter la version affichée des CGU de l'hôte : consentement TOS_HOST versionné, langue et horodatage de la base (US-126) | **200** application/json<br>**400** REQUEST_INVALID<br>**401** AUTH_REQUIRED<br>**404** HOST_ACCOUNT_NOT_FOUND<br>**409** TERMS_VERSION_CHANGED<br>**415** REQUEST_INVALID<br>**503** LEGAL_DOCUMENT_UNAVAILABLE |
| `GET` | `/host/accounts/{orgId}/vehicles` | `hostVehicles` | Véhicules du compte d'hôte de la session (US-115) | **200** application/json<br>**401** AUTH_REQUIRED<br>**404** HOST_ACCOUNT_NOT_FOUND |
| `POST` | `/host/accounts/{orgId}/vehicles` | `createHostVehicle` | Véhicule d'un particulier : plaque et VIN normalisés, uniques ; variante du marché du compte (US-115) | **201** application/json<br>**400** REQUEST_INVALID<br>**401** AUTH_REQUIRED<br>**404** HOST_ACCOUNT_NOT_FOUND / LOCATION_NOT_FOUND / CATALOG_VARIANT_NOT_FOUND<br>**409** VEHICLE_PLATE_DUPLICATE / CATALOG_VARIANT_RETIRED<br>**415** REQUEST_INVALID<br>**422** VEHICLE_FIELD_REQUIRED |
| `POST` | `/host/accounts/{orgId}/vehicles/{vehicleId}/blocks` | `createHostBlock` | Blocage par jours (du … au …, inclus) ou par heures (pas de 30 min) en heure locale du véhicule, par la commande de la table d'occupation unique (US-119) | **201** application/json<br>**400** REQUEST_INVALID<br>**401** AUTH_REQUIRED<br>**403** HOST_ACCOUNT_SUSPENDED<br>**404** HOST_ACCOUNT_NOT_FOUND / VEHICLE_NOT_FOUND<br>**409** VEHICLE_UNAVAILABLE / VEHICLE_NOT_LISTED<br>**415** REQUEST_INVALID<br>**422** INVALID_PERIOD<br>**503** LISTING_UNAVAILABLE |
| `DELETE` | `/host/accounts/{orgId}/vehicles/{vehicleId}/blocks/{blockId}` | `deleteHostBlock` | Levée d'un blocage manuel actif du véhicule (BLOCK_REMOVED ; US-119) | **200** application/json<br>**401** AUTH_REQUIRED<br>**404** HOST_ACCOUNT_NOT_FOUND / VEHICLE_NOT_FOUND / BLOCK_NOT_FOUND<br>**415** REQUEST_INVALID |
| `GET` | `/host/accounts/{orgId}/vehicles/{vehicleId}/calendar` | `hostVehicleCalendar` | Calendrier d'un véhicule de l'hôte : occupations actives à venir (trips, holds, blocages, tampons), bornes locales du véhicule, préavis du lieu ; jamais le voyageur (US-119) | **200** application/json<br>**401** AUTH_REQUIRED<br>**404** HOST_ACCOUNT_NOT_FOUND / VEHICLE_NOT_FOUND<br>**503** LISTING_UNAVAILABLE |

## `/identity`

| Méthode | Chemin | operationId | Résumé | Statuts et codes |
| ------- | ------ | ----------- | ------ | ---------------- |
| `GET` | `/identity` | `getIdentityState` | État de la vérification d'identité de la session : statut SM-3, texte du consentement biométrique en vigueur, pays proposés (US-105, 16 VER-001, VER-004) | **200** application/json<br>**400** REQUEST_INVALID / COUNTRY_UNKNOWN<br>**401** AUTH_REQUIRED<br>**503** KYC_PROVIDER_UNAVAILABLE |
| `POST` | `/identity/consent` | `recordBiometricConsent` | Consentement biométrique séparé (VER-004) : acceptation de la version affichée ou retrait (US-105) | **200** application/json<br>**400** REQUEST_INVALID / COUNTRY_UNKNOWN<br>**401** AUTH_REQUIRED<br>**403** KYC_NOT_ELIGIBLE<br>**409** KYC_CONSENT_VERSION_CHANGED<br>**415** REQUEST_INVALID<br>**503** KYC_CONSENT_UNAVAILABLE / KYC_PROVIDER_UNAVAILABLE |
| `POST` | `/identity/verification` | `startIdentityVerification` | Ouverture du parcours hébergé du fournisseur (US-105, 16 VER-001) : sans consentement biométrique, aucune session | **200** application/json<br>**201** application/json<br>**400** REQUEST_INVALID / COUNTRY_UNKNOWN<br>**401** AUTH_REQUIRED<br>**403** KYC_BIOMETRIC_CONSENT_MISSING / PHONE_NOT_VERIFIED / KYC_NOT_ELIGIBLE<br>**409** KYC_IN_REVIEW / KYC_ALREADY_APPROVED<br>**415** REQUEST_INVALID<br>**422** KYC_DOCUMENT_UNSUPPORTED<br>**502** KYC_SESSION_FAILED<br>**503** KYC_PROVIDER_UNAVAILABLE |

## `/kyc`

| Méthode | Chemin | operationId | Résumé | Statuts et codes |
| ------- | ------ | ----------- | ------ | ---------------- |
| `POST` | `/kyc/webhooks/{provider}` | `identityWebhook` | Rappel de décision du fournisseur d'identité (US-105) : signature sur les octets reçus (en-tête x-identity-signature) ; réponse sans corps | **200** sans corps<br>**401** sans corps<br>**404** sans corps<br>**503** sans corps |

## `/legal`

| Méthode | Chemin | operationId | Résumé | Statuts et codes |
| ------- | ------ | ----------- | ------ | ---------------- |
| `GET` | `/legal/consents` | `getConsents` | État des consentements de la session (réacceptation exigée après une version majeure) et historique | **200** application/json<br>**401** AUTH_REQUIRED |
| `POST` | `/legal/consents/accept` | `acceptConsents` | Accepter les versions en vigueur des CGU et de la confidentialité (REACCEPT) | **200** application/json<br>**400** REQUEST_INVALID<br>**401** AUTH_REQUIRED<br>**409** TERMS_VERSION_CHANGED<br>**415** REQUEST_INVALID<br>**503** LEGAL_DOCUMENT_UNAVAILABLE |
| `POST` | `/legal/consents/marketing` | `setMarketingConsent` | Communications commerciales : accord ou révocation (historique conservé) | **200** application/json<br>**400** REQUEST_INVALID<br>**401** AUTH_REQUIRED<br>**415** REQUEST_INVALID<br>**503** LEGAL_DOCUMENT_UNAVAILABLE |
| `GET` | `/legal/documents` | `listLegalDocuments` | Documents juridiques en vigueur (CGU du voyageur, confidentialité, communications) et leur version (US-102) | **200** application/json<br>**400** REQUEST_INVALID / COUNTRY_UNKNOWN<br>**503** LEGAL_DOCUMENT_UNAVAILABLE |
| `GET` | `/legal/documents/{kind}` | `getLegalDocument` | Texte d'un document : version en vigueur, ou version passée (`version`) pour relire ce qui a été accepté | **200** application/json<br>**400** REQUEST_INVALID / COUNTRY_UNKNOWN<br>**404** LEGAL_DOCUMENT_NOT_FOUND |

## `/listings`

| Méthode | Chemin | operationId | Résumé | Statuts et codes |
| ------- | ------ | ----------- | ------ | ---------------- |
| `GET` | `/listings/{listingId}` | `publicListing` | Fiche publique d'une annonce LISTED : colonnes C0, zone approximative du lieu de remise, jamais l'adresse exacte (US-115 critère 4) | **200** application/json<br>**404** LISTING_NOT_FOUND |

## `/phone`

| Méthode | Chemin | operationId | Résumé | Statuts et codes |
| ------- | ------ | ----------- | ------ | ---------------- |
| `GET` | `/phone` | `getPhoneState` | État du téléphone de la personne de la session : numéro vérifié (masqué), code en attente, blocage, pays proposés (US-104) | **200** application/json<br>**401** AUTH_REQUIRED<br>**503** OTP_UNAVAILABLE |
| `POST` | `/phone/otp` | `requestPhoneOtp` | Demande d'un code OTP par SMS pour le numéro saisi (envoi asynchrone ; US-104, 16 VER-013) | **200** PHONE_ALREADY_VERIFIED<br>**202** application/json<br>**400** REQUEST_INVALID / COUNTRY_UNKNOWN / PHONE_INVALID<br>**401** AUTH_REQUIRED<br>**403** PHONE_NOT_ELIGIBLE<br>**415** REQUEST_INVALID<br>**429** OTP_LOCKED / RATE_LIMITED<br>**503** OTP_UNAVAILABLE / RATE_LIMIT_UNAVAILABLE |
| `POST` | `/phone/verify` | `verifyPhoneOtp` | Saisie du code OTP : numéro vérifié (US-104, 16 VER-013) | **200** PHONE_VERIFIED<br>**400** REQUEST_INVALID / OTP_INVALID / OTP_EXPIRED<br>**401** AUTH_REQUIRED<br>**409** ACCOUNT_DUPLICATE_PHONE<br>**415** REQUEST_INVALID<br>**429** OTP_LOCKED<br>**503** OTP_UNAVAILABLE |

## `/regulatory-notices`

| Méthode | Chemin | operationId | Résumé | Statuts et codes |
| ------- | ------ | ----------- | ------ | ---------------- |
| `GET` | `/regulatory-notices` | `getRegulatoryNotices` | Avertissements réglementaires versionnés d’un pays pour un public (US-125, LEG-021) | **200** application/json<br>**400** REQUEST_INVALID |

## `/staff`

| Méthode | Chemin | operationId | Résumé | Statuts et codes |
| ------- | ------ | ----------- | ------ | ---------------- |
| `GET` | `/staff/audit` | `staffAudit` | Journal d'audit de la console (audit.read ; lignes filtrées en base) | **200** application/json<br>**401** AUTH_REQUIRED<br>**403** FORBIDDEN / 2FA_REQUIRED<br>**429** RATE_LIMITED |
| `GET` | `/staff/me` | `staffMe` | État d'accès de la session à la console interne (US-012) | **200** application/json<br>**401** AUTH_REQUIRED<br>**429** RATE_LIMITED |
| `POST` | `/staff/members/{id}/reset-totp` | `staffResetTotp` | Réinitialisation du TOTP d'un autre membre : code d'enrôlement rendu une fois | **200** application/json<br>**400** REQUEST_INVALID<br>**401** AUTH_REQUIRED<br>**403** FORBIDDEN / 2FA_REQUIRED<br>**415** REQUEST_INVALID<br>**429** RATE_LIMITED<br>**503** STAFF_MFA_UNAVAILABLE |
| `POST` | `/staff/members/{id}/suspend` | `staffSuspend` | Suspension d'un membre du staff (iam.staff_roles_write, portée pays) | **200** application/json<br>**400** REQUEST_INVALID<br>**401** AUTH_REQUIRED<br>**403** FORBIDDEN / 2FA_REQUIRED<br>**415** REQUEST_INVALID<br>**429** RATE_LIMITED |
| `POST` | `/staff/mfa/enroll` | `staffMfaEnroll` | Enrôlement TOTP, étape 1 : le code remis hors bande ouvre le secret (affiché une fois) | **200** application/json<br>**400** REQUEST_INVALID / AUTH_TOTP_INVALID<br>**401** AUTH_REQUIRED<br>**415** REQUEST_INVALID<br>**429** RATE_LIMITED / AUTH_TOTP_LOCKED<br>**503** STAFF_MFA_UNAVAILABLE |
| `POST` | `/staff/mfa/verify` | `staffMfaVerify` | Code TOTP : fin d'enrôlement ou élévation de la session | **200** application/json<br>**400** REQUEST_INVALID / AUTH_TOTP_INVALID<br>**401** AUTH_REQUIRED<br>**403** FORBIDDEN / 2FA_REQUIRED<br>**415** REQUEST_INVALID<br>**429** RATE_LIMITED / AUTH_TOTP_LOCKED<br>**503** STAFF_MFA_UNAVAILABLE |

## `/webhooks`

| Méthode | Chemin | operationId | Résumé | Statuts et codes |
| ------- | ------ | ----------- | ------ | ---------------- |
| `POST` | `/webhooks/{provider}/{publicWebhookId}` | `pspWebhook` | Webhook PSP (17 §4.4) : signature sur les octets reçus ; réponse sans corps | **200** sans corps<br>**401** sans corps<br>**404** sans corps<br>**503** sans corps |

## Réponses transverses

Valables pour toute opération (`x-rueda-transverse-responses`) : produites par la garde anti-abus globale ou le durcissement HTTP.

| Statut | Code | Description |
| ------ | ---- | ----------- |
| 403 | BOT_CHALLENGE_REQUIRED | Défi anti-robot exigé et absent ou refusé (garde globale RISK, US-052 ; hors /webhooks) |
| 413 | PAYLOAD_TOO_LARGE | Corps JSON ou formulaire au-delà de API_BODY_LIMIT_BYTES (100 Kio, US-043) |
| 429 | RATE_LIMITED | Limite de débit par IP de la garde globale RISK (US-052) : Retry-After et values.retryAfterS |
| 500 | — | Erreur interne : corps stable sans détail (durcissement HTTP, US-043) |
