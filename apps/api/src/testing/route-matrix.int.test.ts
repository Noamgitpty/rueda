/**
 * test:int — US-043 : matrice d'autorisations des ROUTES (apps/api/security/route-matrix.json) sur
 * l'API RÉELLE de bout en bout : `ApiModule` monté comme main.ts (durcissement compris), adaptateurs
 * PostgreSQL de production (IAM, console, marque, SUP, RISK, PAY) sur la base jetable du banc, sous
 * app_api (assertion L0-05 en tête de chaque test). La permission et la portée pays sont jugées par
 * les commandes de la base, jamais par ce test.
 *
 * Acteurs : anonyme, voyageur, hôte titulaire, co-hôte, staff sans TOTP, puis chaque rôle interne
 * dans CHAQUE pays (session élevée par TOTP). Pour chaque cellule (route × acteur) :
 * - refus attendu : 401 AUTH_REQUIRED, ou 403 FORBIDDEN / 2FA_REQUIRED ;
 * - accès attendu : ni l'un ni l'autre, et jamais 500 (la route peut ensuite refuser la donnée) ;
 * - IDOR entre pays (portée `pays`) : un rôle autorisé qui vise le sujet de l'AUTRE pays ⇒ 403.
 * Seules les limites de débit sont élargies (prouvées par US-052) ; aucun FAKE de paiement réel.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { assertProductionRole, connectAs, releaseClient } from '@rueda/db/testing';
// types du contexte fourni par le globalSetup du banc (inject('ruedaBench'))
import type {} from '@rueda/db/testing/global-setup';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiModule } from '../api.module.js';
import { applyHttpHardening } from '../http-hardening.js';
import { postgresCatAdapters } from '../modules/cat/index.js';
import { loadBrandParams, PgBrandStore, UnavailableBrandFileStore } from '../modules/cfg/index.js';
import { PgConsentStore } from '../modules/ctr/index.js';
import { postgresIamAdapters, postgresStaffAdapters } from '../modules/iam/index.js';
import type { StaffOptions } from '../modules/iam/index.js';
import { postgresPayAdapters } from '../modules/pay/index.js';
import {
  AbuseGuard,
  PgAbuseBoardStore,
  PgRateCounterStore,
  RateKeyHasher,
  UnavailableBotChallenge,
} from '../modules/risk/index.js';
import type { RateLimitPolicy } from '../modules/risk/index.js';
import {
  PgFinanceApprovalStore,
  PgManualActionStore,
  PgOpsConsoleStore,
  unavailableEvidence,
} from '../modules/sup/index.js';
import type { SqlPool } from '../modules/sup/index.js';
import { ROUTE_MATRIX } from './route-matrix.js';

const STAFF_ROLES = ['SUPPORT_AGENT', 'OPS_AGENT', 'FINANCE', 'ADMIN', 'SUPERADMIN'] as const;
type StaffRole = (typeof STAFF_ROLES)[number];
const PHC =
  '$argon2id$v=19$m=65536,t=3,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g';
const PNG = Buffer.concat([
  Buffer.from('89504e470d0a1a0a', 'hex'),
  Buffer.from('0000000d49484452000000010000000108060000001f15c489', 'hex'),
]);

const token = (): string => randomBytes(32).toString('base64url');
const sha = (t: string): Buffer => createHash('sha256').update(t, 'utf8').digest();

let client: pg.Client;
let app: NestExpressApplication;
let port = 0;
let countries: string[] = [];

interface Actor {
  readonly name: string;
  readonly role: StaffRole | null;
  /** Pays du rôle (staff d'un seul pays) ; `null` : sans rôle, ou rôle de TOUS les pays. */
  readonly country: string | null;
  /** Rôle interne qui couvre tous les pays déclarés. */
  readonly allCountries?: boolean;
  readonly cookie: string | null;
  /** Nouvelle session du même acteur : la déconnexion ne doit pas révoquer celle des autres routes. */
  readonly fresh?: () => Promise<string>;
}
const actors: Actor[] = [];
/** Trip d'un compte d'hôte, par pays : sujet de POST /console/actions. */
const tripOf = new Map<string, string>();
/** Personne inscrite dans le pays (CGU acceptées là) : sujet des routes de la fiche 360° (US-109). */
const personOf = new Map<string, { id: string; email: string }>();

async function registerIn(country: string): Promise<{ id: string; email: string }> {
  const id = randomUUID();
  const email = `us109-${id}@example.test`;
  const r = await client.query<{ ok: boolean }>(
    `SELECT core.iam_cmd_register_with_consents($1, $2, $3, 'Matrice', 'Test', 'es', $4, $5, 86400, NULL, $6, '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]'::jsonb, false) AS ok`,
    [id, email, PHC, randomUUID(), randomBytes(32), country],
  );
  if (r.rows[0]?.ok !== true) throw new Error('inscription de test refusée');
  await client.query(`SELECT test_fixture.iam_set_account_status($1, 'ACTIVE')`, [id]);
  return { id, email };
}

/** Dossier de support OUVERT du pays, assigné à un ADMIN du pays (vraie commande, US-109). */
async function caseOf(country: string): Promise<string> {
  const admin = await elevatedStaff('ADMIN', [country]);
  const caseId = randomUUID();
  const { rows } = await client.query<{ outcome: string }>(
    `SELECT outcome FROM core.support_staff_open_case($1, $2, $3, 'ACCOUNT', 'NORMAL', 'PHONE')`,
    [sha(admin.cookie.slice('__Host-session='.length)), caseId, personOf.get(country)?.id],
  );
  if (rows[0]?.outcome !== 'OPENED') throw new Error(`dossier de test : ${rows[0]?.outcome}`);
  return caseId;
}

/** Élément de file KYC neuf du pays (vraie mise en file, fixture 9990). */
async function kycItem(country: string): Promise<string> {
  const subject = await registerIn(country);
  const { rows } = await client.query<{ item_id: string }>(
    `SELECT item_id FROM test_fixture.us109_enqueue('KYC', 'USER_ACCOUNT', $1, $2)`,
    [subject.id, country],
  );
  return rows[0]?.item_id ?? randomUUID();
}

async function register(): Promise<string> {
  const id = randomUUID();
  const r = await client.query<{ ok: boolean }>(
    `SELECT core.iam_cmd_register_with_consents($1, $2, $3, 'Matrice', 'Test', 'es', $4, $5, 86400, NULL, NULL, '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]'::jsonb, false) AS ok`,
    [id, `us043-${id}@example.test`, PHC, randomUUID(), randomBytes(32)],
  );
  if (r.rows[0]?.ok !== true) throw new Error('inscription de test refusée');
  await client.query(`SELECT test_fixture.iam_set_account_status($1, 'ACTIVE')`, [id]);
  return id;
}

async function session(userId: string): Promise<string> {
  const t = token();
  await client.query(`SELECT core.iam_cmd_open_session($1, $2, $3, 3600, 'NONE', NULL, 'int')`, [
    randomUUID(),
    userId,
    sha(t),
  ]);
  return `__Host-session=${t}`;
}

async function elevatedSession(userId: string): Promise<string> {
  const t = token();
  await client.query('SELECT test_fixture.iam_open_elevated_session($1, $2)', [userId, sha(t)]);
  return `__Host-session=${t}`;
}

/** Membre du staff ACTIF, rôle de portée `scope`, facteur TOTP actif, session ÉLEVÉE. */
async function elevatedStaff(
  role: string,
  scope: readonly string[],
): Promise<{ id: string; cookie: string }> {
  const id = await register();
  await client.query(
    `SELECT test_fixture.iam_grant_staff_role($1, $2, $3, $4::text[], NULL, NULL)`,
    [randomUUID(), id, role, scope],
  );
  await client.query('SELECT test_fixture.us043_enable_totp($1)', [id]);
  const t = token();
  await client.query('SELECT test_fixture.iam_open_elevated_session($1, $2)', [id, sha(t)]);
  return { id, cookie: `__Host-session=${t}` };
}

/**
 * Demande FINANCE neuve du pays (US-101) : un bordereau en brouillon (fixture 9700) et une demande
 * ISSUE_BORDEREAU faite par un AUTRE membre FINANCE du pays, par la vraie commande sous le contexte
 * STAFF : l'acteur de la matrice l'approuve donc en seconde personne.
 */
async function financeRequest(country: string): Promise<string> {
  const requester = await elevatedStaff('FINANCE', [country]);
  const hash = sha(requester.cookie.slice('__Host-session='.length));
  const { rows: cur } = await client.query<{ currency: string }>(
    'SELECT currency::text AS currency FROM core.config_country WHERE code = $1',
    [country],
  );
  const bordereau = randomUUID();
  await client.query('SELECT test_fixture.us062_insert_bordereau($1, $2, $3, $4::bigint)', [
    bordereau,
    country,
    cur[0]?.currency,
    '42000',
  ]);
  const approval = randomUUID();
  await client.query('BEGIN');
  try {
    await client.query(
      `SELECT pg_catalog.set_config('app.actor_kind', 'STAFF', true),
              pg_catalog.set_config('app.actor_id', $1, true),
              pg_catalog.set_config('app.country_scope', $2, true),
              pg_catalog.set_config('app.session_token_hash', $3, true)`,
      [requester.id, `{${country}}`, hash.toString('hex')],
    );
    const { rows } = await client.query<{ outcome: string }>(
      `SELECT outcome FROM core.settlement_cmd_request_finance_action($1, $2, 'ISSUE_BORDEREAU', $3,
                                                                    'Matrice US-043 : bordereau de test')`,
      [hash, approval, bordereau],
    );
    await client.query('COMMIT');
    if (rows[0]?.outcome !== 'REQUESTED') throw new Error(`demande FINANCE : ${rows[0]?.outcome}`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
  return approval;
}

/** Requête concrète d'une route pour un sujet du pays `country` (corps valides : la route juge). */
async function requestOf(
  route: string,
  country: string,
): Promise<{ method: string; path: string; body?: unknown }> {
  const id = randomUUID();
  const other = randomUUID();
  switch (route) {
    case 'GET /brand':
      return { method: 'GET', path: '/brand' };
    case 'GET /brand/content':
      return { method: 'GET', path: `/brand/content?locale=es&country=${country}` };
    case 'GET /brand/assets/{id}':
      return { method: 'GET', path: `/brand/assets/${id}` };
    case 'POST /auth/signup':
      return {
        method: 'POST',
        path: '/auth/signup',
        body: {
          email: `us043-${id}@example.test`,
          password: 'mot-de-passe-de-test-solide',
          legalFirstName: 'Matrice',
          legalLastName: 'Test',
          locale: 'es',
          termsAccepted: true,
          acceptedDocuments: [
            { kind: 'TOS_GUEST', version: 1 },
            { kind: 'PRIVACY', version: 1 },
          ],
        },
      };
    case 'POST /auth/login':
      return {
        method: 'POST',
        path: '/auth/login',
        body: { email: `absent-${id}@example.test`, password: 'mauvais-mot-de-passe' },
      };
    case 'GET /auth/session':
      return { method: 'GET', path: '/auth/session' };
    case 'POST /auth/logout':
      return { method: 'POST', path: '/auth/logout', body: {} };
    case 'POST /auth/logout-all':
      return { method: 'POST', path: '/auth/logout-all', body: {} };
    case 'POST /auth/verify-email':
      return { method: 'POST', path: '/auth/verify-email', body: { token: token() } };
    case 'POST /webhooks/{provider}/{publicWebhookId}':
      return {
        method: 'POST',
        path: `/webhooks/fake/wh_${randomBytes(12).toString('hex')}`,
        body: {},
      };
    case 'GET /staff/me':
      return { method: 'GET', path: '/staff/me' };
    case 'POST /staff/mfa/enroll':
      return {
        method: 'POST',
        path: '/staff/mfa/enroll',
        body: { enrollmentCode: 'ABCDEFGHIJKLMNOP' },
      };
    case 'POST /staff/mfa/verify':
      return { method: 'POST', path: '/staff/mfa/verify', body: { code: '123456' } };
    case 'POST /staff/members/{id}/suspend':
    case 'POST /staff/members/{id}/reset-totp': {
      // cible neuve à chaque appel : un membre OPS du seul pays du sujet
      const target = await elevatedStaff('OPS_AGENT', [country]);
      const action = route.endsWith('suspend') ? 'suspend' : 'reset-totp';
      return {
        method: 'POST',
        path: `/staff/members/${target.id}/${action}`,
        body: { reason: 'Matrice US-043 : action de test motivée' },
      };
    }
    case 'GET /staff/audit':
      return { method: 'GET', path: '/staff/audit?limit=5' };
    case 'POST /console/actions':
      return {
        method: 'POST',
        path: '/console/actions',
        body: {
          requestId: id,
          action: 'RECORD_CLAIM',
          subjectId: tripOf.get(country),
          reason: 'Matrice US-043 : sinistre de test motivé',
        },
      };
    case 'GET /console/finance/approvals':
      return { method: 'GET', path: '/console/finance/approvals?limit=5' };
    case 'POST /console/finance/approvals/{id}/approve':
      return {
        method: 'POST',
        path: `/console/finance/approvals/${await financeRequest(country)}/approve`,
        body: {},
      };
    case 'POST /console/brand/assets':
      return {
        method: 'POST',
        path: '/console/brand/assets',
        body: {
          requestId: id,
          kind: 'LOGO',
          contentBase64: PNG.toString('base64'),
          alt: { es: 'Logo', en: 'Logo', fr: 'Logo', pt: 'Logo' },
          licenseNote: 'Image de test US-043',
        },
      };
    case 'POST /console/brand/drafts':
      return {
        method: 'POST',
        path: '/console/brand/drafts',
        body: { requestId: id, brandName: 'Matrice', fromPalette: 'lienzo-tinta' },
      };
    case 'GET /console/brand/versions':
      return { method: 'GET', path: '/console/brand/versions?limit=5' };
    case 'GET /console/brand/versions/{id}':
      return { method: 'GET', path: `/console/brand/versions/${other}` };
    case 'POST /console/brand/versions/{id}/publish':
      return {
        method: 'POST',
        path: `/console/brand/versions/${other}/publish`,
        body: { requestId: id },
      };
    case 'POST /console/brand/rollback':
      return { method: 'POST', path: '/console/brand/rollback', body: { requestId: id } };
    case 'POST /console/content/drafts':
      return {
        method: 'POST',
        path: '/console/content/drafts',
        body: {
          requestId: id,
          // clé du registre des blocs éditables (US-121) : une autre clé est refusée avant la base
          key: 'home.hero.title',
          country,
          bodies: { es: 'Hola', en: 'Hello', fr: 'Bonjour', pt: 'Olá' },
        },
      };
    case 'GET /console/content/gaps':
      return { method: 'GET', path: '/console/content/gaps' };
    case 'POST /console/content/publish':
      return {
        method: 'POST',
        path: '/console/content/publish',
        body: { requestId: id, key: 'home.us043', country, versionNo: 1 },
      };
    case 'POST /console/content/rollback':
      return {
        method: 'POST',
        path: '/console/content/rollback',
        body: { requestId: id, key: 'home.us043', country },
      };
    case 'GET /console/security/abuse':
      return { method: 'GET', path: `/console/security/abuse?country=${country}&hours=1` };
    // documents juridiques et consentements (US-102)
    case 'GET /legal/documents':
      return { method: 'GET', path: '/legal/documents?locale=es' };
    case 'GET /legal/documents/{kind}':
      return { method: 'GET', path: '/legal/documents/PRIVACY?locale=es' };
    case 'GET /legal/consents':
      return { method: 'GET', path: '/legal/consents' };
    case 'POST /legal/consents/accept':
      return {
        method: 'POST',
        path: '/legal/consents/accept',
        body: { documents: [{ kind: 'PRIVACY', version: 1 }] },
      };
    case 'POST /legal/consents/marketing':
      return { method: 'POST', path: '/legal/consents/marketing', body: { optIn: false } };
    // compte d'hôte (US-107) : la personne de la session, dans le pays de la cellule
    // US-109 : files de revue, fiche 360°, notes, dossiers, pièces (sujets du pays de l'acteur)
    case 'GET /console/queues':
      return { method: 'GET', path: '/console/queues?queue=KYC&limit=5' };
    case 'POST /console/queues/items/{id}/claim':
      return {
        method: 'POST',
        path: `/console/queues/items/${await kycItem(country)}/claim`,
        body: { requestId: id },
      };
    case 'POST /console/queues/items/{id}/kyc':
      return {
        method: 'POST',
        path: `/console/queues/items/${await kycItem(country)}/kyc`,
        body: { requestId: id, purpose: 'Matrice US-043 : dossier de test' },
      };
    case 'POST /console/users/search':
      return {
        method: 'POST',
        path: '/console/users/search',
        body: {
          requestId: id,
          email: personOf.get(country)?.email,
          purpose: 'Matrice US-043 : recherche de test',
        },
      };
    case 'POST /console/users/{id}/profile':
      return {
        method: 'POST',
        path: `/console/users/${personOf.get(country)?.id}/profile`,
        body: { requestId: id, purpose: 'Matrice US-043 : fiche de test' },
      };
    case 'POST /console/users/{id}/notes':
      return {
        method: 'POST',
        path: `/console/users/${personOf.get(country)?.id}/notes`,
        body: { requestId: id, body: 'Matrice US-043 : note de test' },
      };
    case 'POST /console/cases':
      return {
        method: 'POST',
        path: '/console/cases',
        body: {
          requestId: id,
          requesterUserId: personOf.get(country)?.id,
          category: 'ACCOUNT',
          priority: 'NORMAL',
          channel: 'PHONE',
        },
      };
    case 'POST /console/cases/{id}/status':
      return {
        method: 'POST',
        path: `/console/cases/${await caseOf(country)}/status`,
        body: { requestId: id, status: 'RESOLVED' },
      };
    case 'POST /console/evidence':
      return {
        method: 'POST',
        path: '/console/evidence',
        body: {
          requestId: id,
          subjectUserId: personOf.get(country)?.id,
          mime: 'image/png',
          contentBase64: PNG.toString('base64'),
        },
      };
    case 'POST /host/accounts':
      return {
        method: 'POST',
        path: '/host/accounts',
        body: { country, holderKind: 'INDIVIDUAL' },
      };
    // lieux, véhicules et annonces de l'hôte (US-115) : compte d'hôte d'aucun acteur de la
    // cellule (identifiant neuf) ⇒ 404, jamais 401 / 403 pour une session (IDOR, 17 §2.3 point 5)
    case 'GET /host/accounts/{orgId}/locations':
    case 'GET /host/accounts/{orgId}/vehicles':
    case 'GET /host/accounts/{orgId}/listings':
    case 'GET /host/accounts/{orgId}/catalog/makes':
      return { method: 'GET', path: `/host/accounts/${id}/${route.split('{orgId}/')[1] ?? ''}` };
    case 'GET /host/accounts/{orgId}/catalog/makes/{makeId}/models':
      return { method: 'GET', path: `/host/accounts/${id}/catalog/makes/${randomUUID()}/models` };
    case 'GET /host/accounts/{orgId}/catalog/models/{modelId}/variants':
      return {
        method: 'GET',
        path: `/host/accounts/${id}/catalog/models/${randomUUID()}/variants`,
      };
    case 'GET /host/accounts/{orgId}/catalog/variants/{variantId}/prefill':
      return {
        method: 'GET',
        path: `/host/accounts/${id}/catalog/variants/${randomUUID()}/prefill`,
      };
    case 'POST /host/accounts/{orgId}/locations':
      return {
        method: 'POST',
        path: `/host/accounts/${id}/locations`,
        body: { label: 'Casa', addressLine: 'Calle Ficticia 1', city: 'Ciudad Ficticia' },
      };
    case 'POST /host/accounts/{orgId}/vehicles':
      return {
        method: 'POST',
        path: `/host/accounts/${id}/vehicles`,
        body: {
          locationId: randomUUID(),
          plate: 'ZZ-0001',
          makeText: 'Marca',
          modelText: 'Modelo',
          year: 2021,
          transmission: 'MANUAL',
          seats: 5,
          fuelType: 'GASOLINE',
        },
      };
    case 'POST /host/accounts/{orgId}/listings':
      return {
        method: 'POST',
        path: `/host/accounts/${id}/listings`,
        body: { vehicleId: randomUUID(), dailyPriceMinor: '1000' },
      };
    case 'PUT /host/accounts/{orgId}/listings/{listingId}/pricing':
      return {
        method: 'PUT',
        path: `/host/accounts/${id}/listings/${randomUUID()}/pricing`,
        body: { dailyPriceMinor: '1000' },
      };
    case 'POST /host/accounts/{orgId}/listings/{listingId}/submit':
      return {
        method: 'POST',
        path: `/host/accounts/${id}/listings/${randomUUID()}/submit`,
        body: {},
      };
    case 'POST /host/accounts/{orgId}/listings/{listingId}/photos':
      return {
        method: 'POST',
        path: `/host/accounts/${id}/listings/${randomUUID()}/photos`,
        body: { dataBase64: 'AAAA' },
      };
    case 'DELETE /host/accounts/{orgId}/listings/{listingId}':
      return { method: 'DELETE', path: `/host/accounts/${id}/listings/${randomUUID()}`, body: {} };
    case 'GET /listings/{listingId}':
      return { method: 'GET', path: `/listings/${randomUUID()}` };
    // téléphone par OTP (US-104) : la personne de la session ; un code faux, jamais un envoi
    case 'GET /phone':
      return { method: 'GET', path: '/phone' };
    case 'POST /phone/otp':
      return { method: 'POST', path: '/phone/otp', body: { phone: '0', country } };
    case 'POST /phone/verify':
      return { method: 'POST', path: '/phone/verify', body: { code: '000000' } };
    default:
      throw new Error(`route sans requête de test : ${route}`);
  }
}

interface Reply {
  readonly status: number;
  readonly code: string | null;
  readonly text: string;
}

function call(method: string, path: string, cookie: string | null, body?: unknown): Promise<Reply> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          'user-agent': 'Mozilla/5.0 (Linux; Android 14) rueda-test',
          accept: 'application/json',
          'accept-language': 'es',
          ...(cookie === null ? {} : { cookie }),
          ...(payload === undefined
            ? {}
            : {
                'content-type': 'application/json',
                'content-length': String(Buffer.byteLength(payload)),
              }),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let code: string | null;
          try {
            const parsed = JSON.parse(text) as { code?: unknown };
            code = typeof parsed.code === 'string' ? parsed.code : null;
          } catch {
            code = null;
          }
          resolve({ status: res.statusCode ?? 0, code, text });
        });
      },
    );
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

type Verdict = 'AUTH_REQUIRED' | 'FORBIDDEN' | '2FA_REQUIRED' | 'acces';

const verdictOf = (r: Reply): Verdict | 'erreur' => {
  if (r.status === 401 && r.code === 'AUTH_REQUIRED') return 'AUTH_REQUIRED';
  if (r.status === 403 && (r.code === 'FORBIDDEN' || r.code === '2FA_REQUIRED')) return r.code;
  if (r.status >= 500 && r.status !== 503) return 'erreur';
  return 'acces';
};

/** Verdict attendu par la matrice (sujet du pays de l'acteur ; `idor` : sujet de l'autre pays). */
function expectedVerdict(route: string, actor: Actor, idor: boolean): Verdict {
  const e = ROUTE_MATRIX.routes[route];
  if (e === undefined) throw new Error(`route absente de la matrice : ${route}`);
  if (e.acces === 'public') return 'acces';
  if (actor.cookie === null) return 'AUTH_REQUIRED';
  if (e.acces === 'session') return 'acces';
  if (actor.name === 'staff_sans_mfa') return '2FA_REQUIRED';
  if (actor.role === null) return 'FORBIDDEN';
  if (!(e.roles ?? []).includes(actor.role)) return 'FORBIDDEN';
  // ressource commune : le rôle doit couvrir tous les pays (ADR-067)
  if (e.portee === 'tous_les_pays' && actor.allCountries !== true) return 'FORBIDDEN';
  return idor && e.portee === 'pays' ? 'FORBIDDEN' : 'acces';
}

beforeAll(async () => {
  client = await connectAs('app_api');
  countries = (
    await client.query<{ code: string }>(
      'SELECT code::text AS code FROM core.config_country ORDER BY code',
    )
  ).rows.map((r) => r.code);
  expect(countries.length).toBeGreaterThanOrEqual(2);
  // personnes sans rôle interne
  const guest = await register();
  actors.push({
    name: 'voyageur',
    role: null,
    country: null,
    cookie: await session(guest),
    fresh: () => session(guest),
  });
  const first = countries[0] as string;
  const holder = await register();
  const org = randomUUID();
  await client.query('SELECT test_fixture.iam_insert_organization($1, $2, $3)', [
    org,
    holder,
    first,
  ]);
  await client.query(
    `SELECT test_fixture.iam_insert_membership($1, $2, $3, 'P2P_HOST', '{}'::uuid[], 'ACTIVE')`,
    [randomUUID(), holder, org],
  );
  actors.push({
    name: 'hote',
    role: null,
    country: null,
    cookie: await session(holder),
    fresh: () => session(holder),
  });
  const cohost = await register();
  await client.query(
    `SELECT test_fixture.iam_insert_membership($1, $2, $3, 'CO_HOST', $4::uuid[], 'ACTIVE')`,
    [randomUUID(), cohost, org, [randomUUID()]],
  );
  actors.push({
    name: 'cohote',
    role: null,
    country: null,
    cookie: await session(cohost),
    fresh: () => session(cohost),
  });
  // staff sans TOTP : rôle ADMIN de tous les pays, aucun facteur
  const noMfa = await register();
  await client.query(
    `SELECT test_fixture.iam_grant_staff_role($1, $2, 'ADMIN', $3::text[], NULL, NULL)`,
    [randomUUID(), noMfa, countries],
  );
  actors.push({
    name: 'staff_sans_mfa',
    role: null,
    country: null,
    cookie: await session(noMfa),
    fresh: () => session(noMfa),
  });
  // rôles qui couvrent TOUS les pays (ressources communes : la marque)
  for (const role of ['ADMIN', 'SUPERADMIN'] as const) {
    const s = await elevatedStaff(role, countries);
    actors.push({
      name: `${role}_tous_pays`,
      role,
      country: null,
      allCountries: true,
      cookie: s.cookie,
      fresh: () => elevatedSession(s.id),
    });
  }
  for (const c of countries) {
    const trip = randomUUID();
    await client.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
      trip,
      randomUUID(),
      randomUUID(),
      randomUUID(),
      c,
      (
        await client.query<{ cur: string }>(
          'SELECT currency::text AS cur FROM core.config_country WHERE code = $1',
          [c],
        )
      ).rows[0]?.cur,
      (
        await client.query<{ tz: string }>(
          'SELECT time_zone AS tz FROM core.config_country WHERE code = $1',
          [c],
        )
      ).rows[0]?.tz,
      '2031-09-01T10:00:00Z',
      '2031-09-03T10:00:00Z',
    ]);
    tripOf.set(c, trip);
    personOf.set(c, await registerIn(c));
    for (const role of STAFF_ROLES) {
      const s = await elevatedStaff(role, [c]);
      actors.push({
        name: `${role}@${c}`,
        role,
        country: c,
        cookie: s.cookie,
        fresh: () => elevatedSession(s.id),
      });
    }
  }

  const env = { ...process.env, RUEDA_ENV: 'test' };
  const singlePool: SqlPool = {
    query: (text, values) => client.query(text, values as unknown[]),
    connect: () =>
      Promise.resolve({
        query: (text: string, values?: readonly unknown[]) =>
          client.query(text, values as unknown[]),
        release: () => undefined,
      } as Awaited<ReturnType<SqlPool['connect']>>),
  };
  const wide: RateLimitPolicy = { limit: () => 1_000_000, isCountry: (c) => countries.includes(c) };
  const vault: StaffOptions['vault'] = {
    store: () => Promise.resolve(`fake-vault:${randomUUID()}`),
    resolve: () => Promise.resolve(null),
  };
  const staff: StaffOptions = {
    ...postgresStaffAdapters(client, env, 'Console'),
    vault,
    limits: {
      requestsPerIp: 1_000_000,
      requestWindowMs: 60_000,
      mfaPerIp: 1_000_000,
      mfaPerAccount: 1_000_000,
      mfaWindowMs: 60_000,
    },
  };
  app = await NestFactory.create<NestExpressApplication>(
    ApiModule.register(
      await postgresIamAdapters(client),
      (await postgresPayAdapters(client, env)).webhooks,
      staff,
      {
        store: new PgManualActionStore(client),
        // une seule connexion de test : la lecture des demandes y ouvre et ferme sa transaction
        finance: new PgFinanceApprovalStore(singlePool),
        // US-109 : commandes réelles ; pièces : adaptateurs de production (indisponibles, 503)
        ops: new PgOpsConsoleStore(client),
        evidence: unavailableEvidence(singlePool),
      },
      {
        store: new PgBrandStore(client),
        files: new UnavailableBrandFileStore(),
        params: loadBrandParams(),
      },
      {
        guard: new AbuseGuard({
          store: new PgRateCounterStore(client),
          hasher: new RateKeyHasher(randomBytes(32)),
          policy: wide,
        }),
        challenge: new UnavailableBotChallenge(),
        board: new PgAbuseBoardStore(client),
        rhythm: { record: () => false },
      },
      { store: new PgConsentStore(client) },
      postgresCatAdapters(client),
    ),
    { rawBody: true, logger: false },
  );
  applyHttpHardening(app);
  await app.listen(0, '127.0.0.1');
  port = (app.getHttpServer().address() as { port: number }).port;
}, 180_000);

afterAll(async () => {
  await app?.close();
  if (client) await releaseClient(client);
});

/**
 * Déconnexions en DERNIER : `logout-all` révoque TOUTES les sessions du compte, celle des autres
 * routes comprise (même avec une session neuve) ; ensuite, plus aucune route n'est appelée.
 */
const LOGOUTS = ['POST /auth/logout', 'POST /auth/logout-all'];
const ROUTES = [
  ...Object.keys(ROUTE_MATRIX.routes)
    .filter((r) => !LOGOUTS.includes(r))
    .sort(),
  ...LOGOUTS,
];

describe('US-043 — matrice des routes sur PostgreSQL (app_api), chaque acteur', () => {
  it('anonyme : chaque route comme la matrice', async () => {
    await assertProductionRole(client, 'app_api');
    await check({ name: 'anonyme', role: null, country: null, cookie: null });
  });

  for (const name of ['voyageur', 'hote', 'cohote', 'staff_sans_mfa']) {
    it(`${name} : chaque route comme la matrice`, async () => {
      await assertProductionRole(client, 'app_api');
      const actor = actors.find((a) => a.name === name);
      if (actor === undefined) throw new Error(name);
      await check(actor);
    });
  }

  for (const name of ['ADMIN_tous_pays', 'SUPERADMIN_tous_pays']) {
    it(`${name} : chaque route comme la matrice (ressources communes comprises)`, async () => {
      await assertProductionRole(client, 'app_api');
      const actor = actors.find((a) => a.name === name);
      if (actor === undefined) throw new Error(name);
      await check(actor);
    }, 120_000);
  }

  for (const role of STAFF_ROLES) {
    it(`${role}, par pays : chaque route, sujet du pays puis de l’autre pays (IDOR)`, async () => {
      await assertProductionRole(client, 'app_api');
      const mine = actors.filter((a) => a.role === role && a.allCountries !== true);
      expect(mine.length).toBe(countries.length);
      for (const actor of mine) await check(actor);
    }, 120_000);
  }
});

async function check(actor: Actor): Promise<void> {
  const wrong: string[] = [];
  const home = actor.country ?? (countries[0] as string);
  const subjects: [string, boolean][] = [[home, false]];
  if (actor.country !== null) {
    const other = countries.find((c) => c !== actor.country);
    if (other !== undefined) subjects.push([other, true]);
  }
  for (const route of ROUTES) {
    for (const [country, idor] of subjects) {
      const e = ROUTE_MATRIX.routes[route];
      if (idor && (e?.acces !== 'staff' || e.portee !== 'pays')) continue;
      const req = await requestOf(route, country);
      // la déconnexion révoque la session : une session neuve du même acteur, jamais la sienne
      const logout = route === 'POST /auth/logout' || route === 'POST /auth/logout-all';
      const cookie = logout && actor.fresh !== undefined ? await actor.fresh() : actor.cookie;
      const r = await call(req.method, req.path, cookie, req.body);
      const seen = verdictOf(r);
      const want = expectedVerdict(route, actor, idor);
      if (seen !== want) {
        wrong.push(
          `${route}${idor ? ' (IDOR autre pays)' : ''} : attendu ${want}, obtenu ${seen} ${r.status} ${r.text.slice(0, 160)}`,
        );
      }
    }
  }
  expect(wrong, actor.name).toEqual([]);
}
