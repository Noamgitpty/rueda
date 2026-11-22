/**
 * Point d'entrée « API » (processus HTTP). Même image que le travailleur (worker.ts),
 * processus distinct (17 §6.1, §10 point 3).
 *
 * Connexion PostgreSQL : variables standard de libpq (`PGHOST`, `PGPORT`, `PGDATABASE`,
 * `PGUSER` = app_api, `PGPASSWORD` fourni par le gestionnaire de secrets ; docs/ops/ENV_VARS.md).
 * Le démarrage échoue si le rôle n'est pas app_api sans SUPERUSER ni BYPASSRLS (US-010).
 * `RUEDA_API_TRUST_PROXY` règle `trust proxy` (défaut : aucun mandataire, voir trust-proxy.ts).
 * Le démarrage échoue aussi en production si un compte PSP FAKE existe en base ou si une variable
 * `*_ADAPTER=FAKE` est posée (US-019, C19). `rawBody` : la signature d'un webhook PSP porte sur
 * les octets reçus (17 §4.4). Console interne (US-012) : `RUEDA_STAFF_MFA_PROOF_KEY` (secret géré,
 * hexadécimal ; mal formée : refus de démarrer) et `RUEDA_STAFF_TOTP_ISSUER`. Anti-abus (US-052) :
 * `RUEDA_RATE_LIMIT_KEY` (secret géré, hexadécimal, 32 à 64 octets ; absente en production ou mal
 * formée : refus de démarrer) et, le temps d'une rotation, `RUEDA_RATE_LIMIT_KEY_PREVIOUS`. OTP du
 * téléphone (US-104) : `RUEDA_OTP_KEY` (secret géré, hexadécimal, 32 à 64 octets, le même pour le
 * travailleur ; absente : OTP indisponible ; mal formée : refus de démarrer). Rotation
 * du mot de passe de la base sans coupure (US-051) : `RUEDA_PGPASSWORD_NEXT` (db-pool.ts).
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ApiModule } from './api.module.js';
import { createAppPool } from './db-pool.js';
import { applyHttpHardening } from './http-hardening.js';
import {
  CountryConfigService,
  loadBrandParams,
  PgBrandStore,
  UnavailableBrandFileStore,
  UnavailableBrandScanner,
} from './modules/cfg/index.js';
import { postgresCheckoutAdapters } from './modules/avl/index.js';
import { postgresCatAdapters, postgresSearchAdapters } from './modules/cat/index.js';
import type {
  ListingDepositPolicy,
  PublicListingRatings,
  SearchRatings,
} from './modules/cat/index.js';
import { postgresClmTripAdapters } from './modules/clm/index.js';
import { postgresCtrAdapters } from './modules/ctr/index.js';
import { postgresIamAdapters, postgresStaffAdapters } from './modules/iam/index.js';
import { postgresKycAdapters } from './modules/kyc/index.js';
import { postgresPyoAdapters } from './modules/pyo/index.js';
import { postgresMsgAdapters } from './modules/msg/index.js';
import {
  PgDepositRailConfigReader,
  postgresPayAdapters,
  PreCheckoutDepositReader,
} from './modules/pay/index.js';
import { QuoteService, searchQuotePricer } from './modules/prc/index.js';
import { PgListingRatingStore, postgresRevAdapters } from './modules/rev/index.js';
import { availabilityProbeLimiter, postgresRiskAdapters } from './modules/risk/index.js';
import { PgReportStore } from './modules/rpt/index.js';
import {
  PgFinanceApprovalStore,
  PgHelpStore,
  PgManualActionStore,
  PgOpsConsoleStore,
  postgresClaims,
  postgresEvidenceBundle,
  unavailableEvidence,
} from './modules/sup/index.js';
import { postgresTrpAdapters } from './modules/trp/index.js';
import { parseTrustProxy } from './trust-proxy.js';

const DEFAULT_PORT = 3000;

async function bootstrap(): Promise<void> {
  const trustProxy = parseTrustProxy(process.env['RUEDA_API_TRUST_PROXY']);
  // rotation sans coupure du mot de passe (US-051) : PGPASSWORD et, le temps d'une rotation,
  // RUEDA_PGPASSWORD_NEXT (db-pool.ts)
  const pool = createAppPool({ application_name: 'rueda-api' });
  // Documents juridiques et consentements (US-102) : commandes core.ctr_* sous app_api (refus de
  // démarrer si le rôle n'est pas app_api sans SUPERUSER ni BYPASSRLS).
  const ctr = await postgresCtrAdapters(pool);
  // refus C19 (FAKE en production) AVANT tout autre refus de configuration
  const pay = await postgresPayAdapters(pool, process.env);
  // Anti-abus (US-052) : compteurs partagés en base, seuils `rate_limit_*` et `otp_rate_*` de la
  // configuration pays, clé HMAC RUEDA_RATE_LIMIT_KEY (absente en production : refus de démarrer),
  // défi anti-robot indisponible tant que SUP-013 n'a pas de fournisseur (soupçon ⇒ refus).
  const risk = postgresRiskAdapters(pool, process.env, new CountryConfigService().config);
  // OTP du téléphone (US-104) : commandes core.iam_* de 0066, plafonds d'AbuseGuard, empreinte
  // sous RUEDA_OTP_KEY (absente : OTP indisponible ; mal formée : refus de démarrer).
  const iam = await postgresIamAdapters(pool, process.env, risk.guard);
  // Console interne (US-012) : coffre TOTP indisponible tant qu'US-003 ne l'a pas livré et clé de
  // preuve lue dans RUEDA_STAFF_MFA_PROOF_KEY (absente : aucune élévation) — fail-closed.
  const staff = postgresStaffAdapters(
    pool,
    process.env,
    process.env['RUEDA_STAFF_TOTP_ISSUER'] ?? 'staff-console',
  );
  // Socle de marque (US-034) : lecture et commandes en base ; stockage objet des actifs
  // indisponible tant qu'US-003 ne l'a pas livré, antivirus ClamAV (DEC-FONDATEUR-20, US-120)
  // tant que son adaptateur n'est pas livré (fail-closed, aucun FAKE en production).
  const brand = {
    store: new PgBrandStore(pool),
    files: new UnavailableBrandFileStore(),
    scanner: new UnavailableBrandScanner(),
    params: loadBrandParams(),
  };
  // Lieux, véhicules et annonces de l'hôte (US-115) : commandes core.catalog_* sous app_api ;
  // antivirus ClamAV (DEC-FONDATEUR-20, adaptateur à livrer) et stockage objet (US-003) indisponibles : photos 503 (fail-closed).
  const cat = postgresCatAdapters(pool, pool);
  // Vérification d'identité (US-105) : commandes core.kyc_* sous app_api ; AUCUN fournisseur
  // d'identité tant que le registre LEG-010 n'est pas validé (OQ-MK-09) : ouverture 503, rappels 404.
  const kyc = postgresKycAdapters(pool);
  // Recherche publique (US-201, US-203) : fonctions core.catalog_public_cards (0105) et
  // core.catalog_public_areas (0103) sous app_api ; sonde de disponibilité limitée par IP par la
  // garde anti-abus (availability_probe_per_minute) ; total TTC de chaque résultat par le devis
  // provisoire de PRC (configuration pays du dépôt, instant lu en base) ; notes publiques du
  // véhicule par REV (US-218, core.review_listing_ratings : sans avis, badge « Nuevo »).
  const quotes = new QuoteService(new CountryConfigService());
  const listingRatings = new PgListingRatingStore(pool);
  const searchRatings: SearchRatings = {
    ratings: async (ids) =>
      new Map(
        (await listingRatings.ratings(ids)).map((r) => [
          r.listingId,
          {
            averageX100: r.vehicle.averageX100,
            reviewCount: r.vehicle.reviewCount,
            tripCount: r.vehicle.tripCount,
          },
        ]),
      ),
  };
  // Caution annoncée avant le checkout (US-701c, T70 c, ADR-173) : la décision de PAY (stade
  // PRE_CHECKOUT, même lecteur de paramètres que le checkout, sous app_api) sur le pays et la classe
  // rendus par core.catalog_public_deposit_basis (0151) ; jamais les déclencheurs ni la classe
  const preCheckoutDeposits = new PreCheckoutDepositReader(new PgDepositRailConfigReader(pool));
  const listingDeposits: ListingDepositPolicy = {
    notice: async (country, valueClass) => {
      const n = await preCheckoutDeposits.notice(country, valueClass);
      return n.status === 'REQUIRED'
        ? { status: 'REQUIRED', amountMinor: n.amountMinor.toString() }
        : { status: n.status };
    },
  };
  const search = postgresSearchAdapters(
    pool,
    availabilityProbeLimiter(risk.guard),
    searchQuotePricer((ctx) => quotes.params(ctx)),
    searchRatings,
    listingDeposits,
  );
  // Fiche du véhicule (US-204) : notes du véhicule et de l'hôte par REV (même lecture que la
  // recherche) ; annonce sans ligne : badge « Nuevo »
  const listingPageRatings: PublicListingRatings = {
    ratings: async (id) => {
      const r = (await listingRatings.ratings([id]))[0];
      if (r === undefined) return null;
      const one = (x: typeof r.vehicle) => ({
        averageX100: x.averageX100,
        reviewCount: x.reviewCount,
        tripCount: x.tripCount,
      });
      return { vehicle: one(r.vehicle), host: one(r.host) };
    },
  };
  // Checkout (US-208) : devis figé (commande de gel de PRC) et pose du hold CHECKOUT (commandes
  // de 0108) sous app_api ; MÊME instance QuoteService que la recherche et la fiche (même
  // instantané de configuration, revue d'architecture d'US-203)
  // US-205b : paramètres d'annulation du pays (retenue hors fenêtre gratuite affichée sur S05)
  const checkout = postgresCheckoutAdapters(
    pool,
    (ctx) => quotes.params(ctx),
    (ctx) => quotes.cancellationParams(ctx),
  );
  const app = await NestFactory.create<NestExpressApplication>(
    ApiModule.register(
      iam,
      pay.webhooks,
      staff,
      {
        store: new PgManualActionStore(pool),
        finance: new PgFinanceApprovalStore(pool),
        // files de revue, fiche 360°, notes, dossiers (US-109) ; pièces du staff : antivirus, coffre
        // KMS et stockage objet indisponibles tant qu'US-003 et Q-019 ne sont pas livrés (503)
        ops: new PgOpsConsoleStore(pool),
        evidence: unavailableEvidence(pool),
        // aide et urgence du trip (US-310, 0162) : commandes SUP sous app_api
        help: new PgHelpStore(pool),
      },
      brand,
      risk,
      ctr,
      { ...cat, ratings: listingPageRatings },
      kyc,
      search,
      checkout,
      // Photos d'état du véhicule (US-303) : commandes core.trip_* sous app_api ; antivirus ClamAV
      // (DEC-FONDATEUR-20), coffre KMS et stockage à verrou objet (US-003, Q-007) indisponibles :
      // envoi des photos 503 (fail-closed, aucun FAKE en production).
      postgresTrpAdapters(pool),
      // US-707 : compte de versement (aucun coffre ni PSP avant le lot C : enregistrement 503)
      postgresPyoAdapters(pool),
      // US-525 : messagerie par trip (fonctions de 0161 sous app_api)
      postgresMsgAdapters(pool),
      // US-308 : dossier de preuve (portes core.support_staff_*_evidence_bundle sous app_api) ;
      // coffre KMS et stockage à verrou objet (US-003, Q-007) indisponibles : routes 503
      postgresEvidenceBundle(pool),
      // US-317 : avis réciproques en double aveugle (fonctions de 0170 sous app_api)
      postgresRevAdapters(pool),
      // US-309 : déclarations de dommage et décisions (portes core.support_staff_*claim* et
      // core.support_staff_issue_decision sous app_api, 0175)
      postgresClaims(pool),
      // US-311 : vues de la bêta et rapprochement assisté (portes core.report_staff_beta_view et
      // core.finance_staff_* de 0174 sous app_api)
      new PgReportStore(pool),
      // US-318 : sinistres entre particuliers (commandes core.claim_* de 0178 sous app_api)
      postgresClmTripAdapters(pool),
    ),
    { rawBody: true },
  );
  app.set('trust proxy', trustProxy);
  applyHttpHardening(app);
  app.enableShutdownHooks();
  const port = Number(process.env['PORT'] ?? DEFAULT_PORT);
  await app.listen(port);
  // Version servie (US-003) : RUEDA_RELEASE est posée à la construction de l'image de production.
  console.log(
    JSON.stringify({
      level: 'info',
      event: 'api.started',
      release: process.env['RUEDA_RELEASE'] ?? 'unknown',
    }),
  );
}

void bootstrap();
