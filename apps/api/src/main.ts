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
 * formée : refus de démarrer) et, le temps d'une rotation, `RUEDA_RATE_LIMIT_KEY_PREVIOUS`. Rotation
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
} from './modules/cfg/index.js';
import { postgresCtrAdapters } from './modules/ctr/index.js';
import { postgresIamAdapters, postgresStaffAdapters } from './modules/iam/index.js';
import { postgresPayAdapters } from './modules/pay/index.js';
import { postgresRiskAdapters } from './modules/risk/index.js';
import {
  PgFinanceApprovalStore,
  PgManualActionStore,
  PgOpsConsoleStore,
  unavailableEvidence,
} from './modules/sup/index.js';
import { parseTrustProxy } from './trust-proxy.js';

const DEFAULT_PORT = 3000;

async function bootstrap(): Promise<void> {
  const trustProxy = parseTrustProxy(process.env['RUEDA_API_TRUST_PROXY']);
  // rotation sans coupure du mot de passe (US-051) : PGPASSWORD et, le temps d'une rotation,
  // RUEDA_PGPASSWORD_NEXT (db-pool.ts)
  const pool = createAppPool({ application_name: 'rueda-api' });
  const iam = await postgresIamAdapters(pool);
  // Documents juridiques et consentements (US-102) : commandes core.ctr_* sous app_api.
  const ctr = await postgresCtrAdapters(pool);
  const pay = await postgresPayAdapters(pool, process.env);
  // Console interne (US-012) : coffre TOTP indisponible tant qu'US-003 ne l'a pas livré et clé de
  // preuve lue dans RUEDA_STAFF_MFA_PROOF_KEY (absente : aucune élévation) — fail-closed.
  const staff = postgresStaffAdapters(
    pool,
    process.env,
    process.env['RUEDA_STAFF_TOTP_ISSUER'] ?? 'staff-console',
  );
  // Socle de marque (US-034) : lecture et commandes en base ; stockage objet des actifs
  // indisponible tant qu'US-003 ne l'a pas livré (fail-closed, aucun FAKE en production).
  const brand = {
    store: new PgBrandStore(pool),
    files: new UnavailableBrandFileStore(),
    params: loadBrandParams(),
  };
  // Anti-abus (US-052) : compteurs partagés en base, seuils `rate_limit_*` de la configuration
  // pays, clé HMAC RUEDA_RATE_LIMIT_KEY (absente en production : refus de démarrer), défi
  // anti-robot indisponible tant que SUP-013 n'a pas de fournisseur (soupçon ⇒ refus).
  const risk = postgresRiskAdapters(pool, process.env, new CountryConfigService().config);
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
      },
      brand,
      risk,
      ctr,
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
