/**
 * `POST /console/actions` (US-012) sur HTTP, monté comme en production (IamAuthModule,
 * StaffConsoleModule, SupConsoleModule ; SUP n'importe que l'index d'IAM). La base est remplacée
 * par des magasins qui rendent les issues des commandes (logique prouvée sur PostgreSQL par
 * packages/db/test/l0/l0-staff-console). Prouvé ici :
 * - critère 1 côté HTTP : issue FORBIDDEN de la base => 403 `FORBIDDEN` ;
 * - session non élevée : 403 `2FA_REQUIRED` sans appel de la commande ;
 * - l'acteur n'est jamais lu dans le corps : seule la preuve de possession de la session est
 *   transmise ; corps invalide => 400 sans appel ; 22023 de la base => 400 ;
 * - RECORDED => 201, DUPLICATE => 200, UNAVAILABLE => 409.
 * US-101 : DONE / REQUESTED => 201 (référence de la demande FINANCE), REFUSED => 409 avec l'issue
 * du domaine ; `input` n'admet que des chaînes (aucun montant saisi) ; pièces : UUID, 20 au plus ;
 * la portée pays transmise est celle des rôles de la session ; demandes FINANCE en attente et
 * approbation (SELF_APPROVAL => 409).
 */
import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IamAuthModule, StaffConsoleModule } from '../../iam/index.js';
import type { IamAuthOptions, StaffOptions } from '../../iam/index.js';
import type { ApprovalOutcome, FinanceApprovalStore } from './finance-approval-store.js';
import type {
  ManualActionInput,
  ManualActionOutcome,
  ManualActionStore,
} from './manual-action-store.js';
import type { StaffActor } from './staff-context.js';
import { SupConsoleModule } from './sup-console.module.js';
import { unavailableEvidence } from './evidence.js';
import type { OpsConsoleStore } from './ops-console-store.js';
import type { SqlPool } from './finance-approval-store.js';

/** Files et fiche 360° (US-109) : hors du champ de ce test, tout appel échoue. */
const neverCalled = () => Promise.reject(new Error('non prévu par ce test'));
const ops: OpsConsoleStore = {
  queues: neverCalled,
  claim: neverCalled,
  kycDossier: neverCalled,
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

const TOKEN = 'B'.repeat(43);
const COOKIE = `__Host-session=${TOKEN}`;
let access: 'ELEVATED' | 'MFA_REQUIRED' = 'ELEVATED';
let next: ManualActionOutcome | 'ERROR_22023' = 'RECORDED';
let detail: string | null = null;
let approval: ApprovalOutcome = 'APPROVED';
const received: { hash: string; countries: readonly string[]; input: ManualActionInput }[] = [];
const approvals: { actor: StaffActor; id: string }[] = [];

const never = () => Promise.reject(new Error('non appelé'));
const staffOptions: StaffOptions = {
  store: {
    begin: () =>
      Promise.resolve({
        outcome: access,
        userId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c',
        factorId: null,
        roles: [
          { role: 'FINANCE', countries: ['AA'] },
          { role: 'OPS_AGENT', countries: ['BB', 'AA'] },
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
const iamOptions = {
  store: {},
  notifier: {},
} as unknown as IamAuthOptions;

const store: ManualActionStore = {
  record(actor: StaffActor, input: ManualActionInput) {
    received.push({ hash: actor.tokenHash.toString('hex'), countries: actor.countries, input });
    if (next === 'ERROR_22023') {
      return Promise.reject(Object.assign(new Error('x'), { sqlstate: '22023' }));
    }
    return Promise.resolve({
      outcome: next,
      actionId: input.requestId,
      domainRef: next === 'REQUESTED' || detail === 'REQUESTED' ? input.requestId : null,
      detail,
    });
  },
};
const PENDING_ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5d';
const finance: FinanceApprovalStore = {
  pending: () =>
    Promise.resolve([
      {
        id: PENDING_ID,
        action: 'DECIDE_ADVANCE',
        subjectId: PENDING_ID,
        country: 'AA',
        reason: 'Avance au-delà du plafond',
        requestedAt: new Date('2031-07-01T08:00:00.000Z'),
      },
    ]),
  approve: (actor: StaffActor, id: string) => {
    approvals.push({ actor, id });
    return Promise.resolve(approval);
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

async function post(body: unknown, contentType = 'application/json') {
  const r = await fetch(`${url}/console/actions`, {
    method: 'POST',
    headers: { cookie: COOKIE, 'content-type': contentType },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, body: text ? (JSON.parse(text) as unknown) : null };
}

const valid = () => ({
  requestId: randomUUID(),
  action: 'CANCEL_TRIP_PLATFORM',
  subjectId: randomUUID(),
  reason: 'Voyage annulé par la plateforme',
});

describe('POST /console/actions', () => {
  it('critère 1 : issue FORBIDDEN de la base => 403 FORBIDDEN', async () => {
    access = 'ELEVATED';
    next = 'FORBIDDEN';
    received.length = 0;
    const r = await post(valid());
    expect(r).toEqual({
      status: 403,
      body: { code: 'FORBIDDEN', messageKey: 'common.auth.forbidden' },
    });
    expect(received).toHaveLength(1);
  });

  it('acteur jamais lu dans le corps : seule la preuve de possession de la session part en base', async () => {
    access = 'ELEVATED';
    next = 'RECORDED';
    received.length = 0;
    const piece = randomUUID();
    const body = {
      ...valid(),
      actorUserId: randomUUID(),
      actorRole: 'ADMIN',
      input: { decision: 'APPROVED' },
      evidence: [piece],
    };
    const r = await post(body);
    expect(r.status).toBe(201);
    expect(received[0]?.hash).toBe(createHash('sha256').update(TOKEN).digest('hex'));
    // portée : pays des rôles de la session, jamais du corps
    expect(received[0]?.countries).toEqual(['AA', 'BB']);
    expect(received[0]?.input).toEqual({
      requestId: body.requestId,
      actionCode: body.action,
      subjectId: body.subjectId,
      reason: body.reason,
      input: { decision: 'APPROVED' },
      evidence: [piece],
    });
  });

  it.each([
    ['DUPLICATE', null, 200, 'STAFF_ACTION_RECORDED'],
    ['DUPLICATE', 'REQUESTED', 200, 'STAFF_ACTION_REQUESTED'],
    ['DONE', null, 201, 'STAFF_ACTION_DONE'],
    ['REQUESTED', null, 201, 'STAFF_ACTION_REQUESTED'],
    ['UNAVAILABLE', null, 409, 'STAFF_ACTION_UNAVAILABLE'],
    ['REFUSED', 'ALREADY_PENDING', 409, 'STAFF_ACTION_REFUSED'],
    ['MFA_REQUIRED', null, 403, '2FA_REQUIRED'],
    ['AUTH_REQUIRED', null, 401, 'AUTH_REQUIRED'],
    ['ERROR_22023', null, 400, 'REQUEST_INVALID'],
  ] as const)('issue %s (%s) => %i %s', async (outcome, d, status, code) => {
    access = 'ELEVATED';
    next = outcome;
    detail = d;
    const body = valid();
    const r = await post(body);
    detail = null;
    expect(r.status).toBe(status);
    expect(r.body).toMatchObject({ code });
    if (code === 'STAFF_ACTION_REQUESTED') {
      expect(r.body).toMatchObject({ actionId: body.requestId, approvalId: body.requestId });
    }
    if (outcome === 'REFUSED') {
      expect(r.body).toMatchObject({ values: { reason: 'ALREADY_PENDING' } });
    }
  });

  it('session non élevée : 403 2FA_REQUIRED, la commande n’est pas appelée', async () => {
    access = 'MFA_REQUIRED';
    received.length = 0;
    const r = await post(valid());
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ code: '2FA_REQUIRED' });
    expect(received).toEqual([]);
  });

  it('corps invalide (motif court, action mal formée, sujet non UUID, input tableau) : 400 sans appel ; texte : 415', async () => {
    access = 'ELEVATED';
    received.length = 0;
    for (const patch of [
      { reason: 'court' },
      { action: 'cancel' },
      { subjectId: 'x' },
      { requestId: '1' },
      { input: [1, 2] },
      // l'agent ne saisit jamais un montant : aucune valeur numérique, aucune clé hors forme
      { input: { amountMinor: 2500 } },
      { input: { decision: 12.5 } },
      { input: { decision: { minor: 'x' } } },
      { input: { 'refund-amount': 'x' } },
      { evidence: ['x'] },
      { evidence: [randomUUID(), 'x'] },
      { evidence: 'x' },
      { evidence: Array.from({ length: 21 }, () => randomUUID()) },
    ]) {
      const r = await post({ ...valid(), ...patch });
      expect(r.status, JSON.stringify(patch)).toBe(400);
    }
    expect((await post(valid(), 'text/plain')).status).toBe(415);
    expect(received).toEqual([]);
  });
});

describe('demandes FINANCE à deux personnes (US-101, RLS-24)', () => {
  async function call(method: 'GET' | 'POST', path: string) {
    const r = await fetch(`${url}${path}`, {
      method,
      headers: { cookie: COOKIE, 'content-type': 'application/json' },
      ...(method === 'POST' ? { body: '{}' } : {}),
    });
    const text = await r.text();
    return { status: r.status, body: text ? (JSON.parse(text) as unknown) : null };
  }

  it('GET /console/finance/approvals : demandes en attente, dates ISO', async () => {
    access = 'ELEVATED';
    const r = await call('GET', '/console/finance/approvals?limit=10');
    expect(r).toEqual({
      status: 200,
      body: {
        approvals: [
          {
            id: PENDING_ID,
            action: 'DECIDE_ADVANCE',
            subjectId: PENDING_ID,
            country: 'AA',
            reason: 'Avance au-delà du plafond',
            requestedAt: '2031-07-01T08:00:00.000Z',
          },
        ],
      },
    });
  });

  it.each([
    ['APPROVED', 200, 'STAFF_ACTION_DONE'],
    ['SELF_APPROVAL', 409, 'STAFF_SELF_APPROVAL'],
    ['NOT_PENDING', 409, 'STAFF_ACTION_REFUSED'],
    ['SUBJECT_CHANGED', 409, 'STAFF_ACTION_REFUSED'],
    ['FORBIDDEN', 403, 'FORBIDDEN'],
    ['MFA_REQUIRED', 403, '2FA_REQUIRED'],
  ] as const)('approbation %s => %i %s', async (outcome, status, code) => {
    access = 'ELEVATED';
    approval = outcome;
    approvals.length = 0;
    const r = await call('POST', `/console/finance/approvals/${PENDING_ID}/approve`);
    expect(r.status).toBe(status);
    expect(r.body).toMatchObject({ code });
    // l'approbateur est la personne de la session (preuve de possession), jamais un paramètre
    expect(approvals.map((a) => [a.actor.tokenHash.toString('hex'), a.id])).toEqual([
      [createHash('sha256').update(TOKEN).digest('hex'), PENDING_ID],
    ]);
  });

  it('identifiant mal formé : 400 sans appel ; session non élevée : 403 2FA_REQUIRED', async () => {
    access = 'ELEVATED';
    approvals.length = 0;
    expect((await call('POST', '/console/finance/approvals/x/approve')).status).toBe(400);
    access = 'MFA_REQUIRED';
    expect(
      (await call('POST', `/console/finance/approvals/${PENDING_ID}/approve`)).body,
    ).toMatchObject({ code: '2FA_REQUIRED' });
    expect((await call('GET', '/console/finance/approvals')).body).toMatchObject({
      code: '2FA_REQUIRED',
    });
    expect(approvals).toEqual([]);
    access = 'ELEVATED';
  });
});
