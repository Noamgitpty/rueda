/**
 * US-222c — red team du lot 2, RT-L2-S01 : rejeu de la suite N-292 (BOARD : « test de contrôleur
 * manquant : `409 STAFF_ACTION_REFUSED` / `SELF_FORBIDDEN` sur `POST /console/actions` »), sur HTTP,
 * monté comme en production (IamAuthModule, StaffConsoleModule, SupConsoleModule ; SUP n'importe que
 * l'index d'IAM), comme `console.controller.test.ts`. TESTS SEULEMENT (L2-PM-39).
 *
 * La garde de séparation des tâches est en base (ADR-122, ADR-124 ; prouvée sous les rôles de
 * production par `packages/db/test/redteam/l1/rt-l1-02-console`, `rt-l1-13-console-self` et
 * `packages/db/test/redteam/l2/rt-l2-s01-suites`) : la commande rend `REFUSED` avec le détail
 * `SELF_FORBIDDEN`. Ce fichier prouve ce qu'en fait la route. Attendus (jamais le code testé) :
 * ADR-106 et 16 A.8 (« issues de la commande […] `SELF_FORBIDDEN` […], rendues par
 * `STAFF_ACTION_REFUSED` (`values.reason`) » ; 16 : `STAFF_ACTION_REFUSED` = 409) ; l'acteur n'est
 * jamais lu dans le corps (17 §2.3 : identité de la session). Attaques : un agent qui agit sur son
 * propre dossier par chaque famille d'action, en se faisant passer pour un autre agent dans le corps ;
 * un détail de refus non conforme ne doit pas être renvoyé tel quel.
 */
import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IamAuthModule, StaffConsoleModule } from '../../iam/index.js';
import type { IamAuthOptions, StaffOptions } from '../../iam/index.js';
import type { FinanceApprovalStore, SqlPool } from './finance-approval-store.js';
import type {
  ManualActionInput,
  ManualActionOutcome,
  ManualActionStore,
} from './manual-action-store.js';
import type { OpsConsoleStore } from './ops-console-store.js';
import type { StaffActor } from './staff-context.js';
import { SupConsoleModule } from './sup-console.module.js';
import { unavailableEvidence } from './evidence.js';

const neverCalled = () => Promise.reject(new Error('non prévu par ce test'));
const ops: OpsConsoleStore = {
  queues: neverCalled,
  claim: neverCalled,
  kycDossier: neverCalled,
  hostDossier: neverCalled,
  bookingReview: neverCalled,
  tripCancellation: neverCalled,
  tripRefunds: neverCalled,
  findUser: neverCalled,
  profile: neverCalled,
  addNote: neverCalled,
  openCase: neverCalled,
  setCaseStatus: neverCalled,
  evidencePermitted: neverCalled,
  recordEvidence: neverCalled,
  catalogAddition: neverCalled,
  resolveCatalogAddition: neverCalled,
  vehicleEligibility: neverCalled,
  decideVehicleEligibility: neverCalled,
  decideListing: neverCalled,
  vehicleClaim: neverCalled,
  decideVehicleClaim: neverCalled,
  vehicleFile: neverCalled,
};
const unusedPool: SqlPool = { query: neverCalled, connect: neverCalled };
const finance: FinanceApprovalStore = { pending: neverCalled, approve: neverCalled };

const TOKEN = 'C'.repeat(43);
const COOKIE = `__Host-session=${TOKEN}`;
const SESSION_HASH = createHash('sha256').update(TOKEN).digest('hex');
const SESSION_USER = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b01';
/** Un autre membre du staff, dont l'agent tente de prendre l'identité dans le corps. */
const OTHER_AGENT = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4b02';

const never = () => Promise.reject(new Error('non appelé'));
const staffOptions: StaffOptions = {
  store: {
    begin: () =>
      Promise.resolve({
        outcome: 'ELEVATED',
        userId: SESSION_USER,
        factorId: null,
        roles: [
          { role: 'OPS_AGENT', countries: ['AA'] },
          { role: 'FINANCE', countries: ['AA'] },
        ],
      }),
    enrollReveal: never,
    elevate: never,
    mfaAttempt: never,
    suspend: never,
    resetTotp: never,
    auditRead: () => Promise.resolve([]),
  },
  vault: { store: never, resolve: never },
  proofKey: null,
  issuer: 'Console',
};
const iamOptions = { store: {}, notifier: {} } as unknown as IamAuthOptions;

/** Issue rendue par la « base » : celle de la garde (REFUSED / SELF_FORBIDDEN) par défaut. */
let next: { outcome: ManualActionOutcome; detail: string | null } = {
  outcome: 'REFUSED',
  detail: 'SELF_FORBIDDEN',
};
const received: { hash: string; input: ManualActionInput; actor: StaffActor }[] = [];
const store: ManualActionStore = {
  record(actor: StaffActor, input: ManualActionInput) {
    received.push({ hash: actor.tokenHash.toString('hex'), input, actor });
    return Promise.resolve({
      outcome: next.outcome,
      actionId: input.requestId,
      domainRef: null,
      detail: next.detail,
    });
  },
};

@Module({
  imports: [
    IamAuthModule.register(iamOptions),
    StaffConsoleModule.register(staffOptions),
    SupConsoleModule.register({ store, finance, ops, evidence: unavailableEvidence(unusedPool) }),
  ],
})
class Root {}

let app: INestApplication;
let url = '';
beforeAll(async () => {
  app = await NestFactory.create(Root, { logger: false });
  await app.listen(0, '127.0.0.1');
  url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
});
afterAll(async () => {
  await app.close();
});

async function post(body: unknown) {
  const r = await fetch(`${url}/console/actions`, {
    method: 'POST',
    headers: { cookie: COOKIE, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

/** Une action par famille du catalogue (US-101, US-106, US-108, US-111, US-215, US-227). */
const ACTIONS = [
  ['HOST_VERIFICATION_DECISION', { decision: 'APPROVED' }],
  ['KYC_DECISION', { decision: 'APPROVED' }],
  ['RESTRICT_ACCOUNT', { kind: 'TS_HOLD' }],
  ['CANCEL_TRIP_PLATFORM', {}],
  ['ISSUE_BORDEREAU', {}],
] as const;

describe('N-292 rejouée — POST /console/actions, refus de la séparation des tâches', () => {
  it.each(ACTIONS)(
    '%s sur son propre dossier, identité d’un autre agent glissée dans le corps : 409 STAFF_ACTION_REFUSED, values.reason = SELF_FORBIDDEN, aucune référence d’action ; seule la session part en base',
    async (action, input) => {
      next = { outcome: 'REFUSED', detail: 'SELF_FORBIDDEN' };
      received.length = 0;
      const requestId = randomUUID();
      const subjectId = randomUUID();
      const r = await post({
        requestId,
        action,
        subjectId,
        reason: 'Décision de l’agent sur son propre dossier (red team)',
        input,
        actorUserId: OTHER_AGENT,
        actorId: OTHER_AGENT,
        onBehalfOf: OTHER_AGENT,
      });
      expect(r.status).toBe(409);
      expect(r.body).toMatchObject({
        code: 'STAFF_ACTION_REFUSED',
        messageKey: 'common.auth.actionRefused',
        values: { reason: 'SELF_FORBIDDEN' },
      });
      expect(r.body).not.toHaveProperty('actionId');
      expect(JSON.stringify(r.body)).not.toContain(OTHER_AGENT);
      // l'acteur est la session (preuve de possession), jamais un champ du corps
      expect(received).toHaveLength(1);
      expect(received[0]?.hash).toBe(SESSION_HASH);
      expect(JSON.stringify(received[0]?.input)).not.toContain(OTHER_AGENT);
      expect(received[0]?.input).toMatchObject({ requestId, actionCode: action, subjectId });
    },
  );

  it('détail de refus non conforme (texte libre, injection) : jamais renvoyé tel quel, reason = REFUSED', async () => {
    for (const detail of ['self forbidden', 'SELF_FORBIDDEN; DROP TABLE x', '<b>SELF</b>', '']) {
      next = { outcome: 'REFUSED', detail };
      const r = await post({
        requestId: randomUUID(),
        action: 'KYC_DECISION',
        subjectId: randomUUID(),
        reason: 'Décision de l’agent sur son propre dossier (red team)',
        input: { decision: 'APPROVED' },
      });
      expect(r.status, detail).toBe(409);
      expect(r.body, detail).toMatchObject({
        code: 'STAFF_ACTION_REFUSED',
        values: { reason: 'REFUSED' },
      });
    }
    next = { outcome: 'REFUSED', detail: 'SELF_FORBIDDEN' };
  });
});
