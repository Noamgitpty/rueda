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
 */
import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IamAuthModule, StaffConsoleModule } from '../../iam/index.js';
import type { IamAuthOptions, StaffOptions } from '../../iam/index.js';
import type {
  ManualActionInput,
  ManualActionOutcome,
  ManualActionStore,
} from './manual-action-store.js';
import { SupConsoleModule } from './sup-console.module.js';

const TOKEN = 'B'.repeat(43);
const COOKIE = `__Host-session=${TOKEN}`;
let access: 'ELEVATED' | 'MFA_REQUIRED' = 'ELEVATED';
let next: ManualActionOutcome | 'ERROR_22023' = 'RECORDED';
const received: { hash: string; input: ManualActionInput }[] = [];

const never = () => Promise.reject(new Error('non appelé'));
const staffOptions: StaffOptions = {
  store: {
    begin: () =>
      Promise.resolve({
        outcome: access,
        userId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c',
        factorId: null,
        roles: [{ role: 'FINANCE', countries: ['AA'] }],
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
  record(tokenHash: Buffer, input: ManualActionInput) {
    received.push({ hash: tokenHash.toString('hex'), input });
    if (next === 'ERROR_22023') {
      return Promise.reject(Object.assign(new Error('x'), { sqlstate: '22023' }));
    }
    return Promise.resolve({ outcome: next, actionId: input.requestId });
  },
};

@Module({
  imports: [
    IamAuthModule.register(iamOptions),
    StaffConsoleModule.register(staffOptions),
    SupConsoleModule.register({ store }),
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
    const body = { ...valid(), actorUserId: randomUUID(), actorRole: 'ADMIN', input: { a: 1 } };
    const r = await post(body);
    expect(r.status).toBe(201);
    expect(received[0]?.hash).toBe(createHash('sha256').update(TOKEN).digest('hex'));
    expect(received[0]?.input).toEqual({
      requestId: body.requestId,
      actionCode: body.action,
      subjectId: body.subjectId,
      reason: body.reason,
      input: { a: 1 },
    });
  });

  it.each([
    ['DUPLICATE', 200, 'STAFF_ACTION_RECORDED'],
    ['UNAVAILABLE', 409, 'STAFF_ACTION_UNAVAILABLE'],
    ['MFA_REQUIRED', 403, '2FA_REQUIRED'],
    ['ERROR_22023', 400, 'REQUEST_INVALID'],
  ] as const)('issue %s => %i %s', async (outcome, status, code) => {
    access = 'ELEVATED';
    next = outcome;
    const r = await post(valid());
    expect(r.status).toBe(status);
    expect(r.body).toMatchObject({ code });
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
    ]) {
      const r = await post({ ...valid(), ...patch });
      expect(r.status, JSON.stringify(patch)).toBe(400);
    }
    expect((await post(valid(), 'text/plain')).status).toBe(415);
    expect(received).toEqual([]);
  });
});
