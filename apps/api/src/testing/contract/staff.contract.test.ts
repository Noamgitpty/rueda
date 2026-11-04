/**
 * US-038 — contrat des routes /staff (US-012) sur l'application réelle : chaque statut déclaré est
 * exercé, chaque réponse validée contre l'OpenAPI. Le magasin du staff est un double à issues
 * réglables (la base juge en production : `core.iam_staff_cmd_*`, prouvé par test:int).
 */
import { afterAll, describe, expect, it } from 'vitest';
import type { StaffOptions } from '../../modules/iam/index.js';
import { missingCoverage } from '../openapi-contract.js';
import {
  closeContractApps,
  contract,
  COUNTRIES,
  coverageOf,
  ID,
  REASON,
  startContractApp,
  textBody,
} from './support.js';
import type { ContractApp } from './support.js';

type Store = StaffOptions['store'];
type Outcome = Awaited<ReturnType<Store['begin']>>['outcome'];

/** Double du magasin : issue d'accès par empreinte de jeton, autres issues réglables. */
class TunableStaffStore implements Store {
  readonly access = new Map<string, Outcome>();
  reveal: 'OK' | 'REFUSED' | 'LOCKED' = 'OK';
  secretRef = 'ref-ok';
  command: 'DONE' | 'FORBIDDEN' = 'DONE';

  begin(hash: Buffer) {
    const outcome = this.access.get(hash.toString('hex')) ?? 'AUTH_REQUIRED';
    return Promise.resolve({
      outcome,
      userId: outcome === 'AUTH_REQUIRED' ? null : ID,
      factorId: null,
      roles: outcome === 'NOT_STAFF' ? [] : [{ role: 'ADMIN', countries: [...COUNTRIES] }],
    });
  }
  enrollReveal() {
    return Promise.resolve({ outcome: this.reveal, factorId: ID, secretRef: this.secretRef });
  }
  elevate() {
    return Promise.resolve('ELEVATED' as const);
  }
  mfaAttempt() {
    return Promise.resolve({
      outcome: 'OK' as const,
      factorId: ID,
      secretRef: this.secretRef,
      lastUsedStep: null,
    });
  }
  suspend() {
    return Promise.resolve(this.command);
  }
  resetTotp() {
    return Promise.resolve(this.command);
  }
  auditRead() {
    return Promise.resolve([
      {
        id: '42',
        at: new Date('2031-07-01T08:00:00.000Z'),
        actorUserId: ID,
        actorRole: 'ADMIN',
        actionCode: 'STAFF_SUSPEND',
        subjectType: 'user',
        subjectId: ID,
        reason: REASON,
        before: { status: 'ACTIVE' },
        after: { status: 'SUSPENDED' },
      },
    ]);
  }
}

class TunableVault {
  storeFails = false;
  store(): Promise<string> {
    return this.storeFails
      ? Promise.reject(new Error('coffre indisponible'))
      : Promise.resolve('ref-new');
  }
  resolve(ref: string): Promise<Buffer | null> {
    return Promise.resolve(ref === 'ref-ok' ? Buffer.alloc(20, 7) : null);
  }
}

describe('contrat HTTP — /staff', () => {
  const apps: ContractApp[] = [];
  const store = new TunableStaffStore();
  const vault = new TunableVault();
  afterAll(closeContractApps);

  async function app(staff: Partial<StaffOptions> = {}): Promise<ContractApp> {
    const a = await startContractApp({
      staff: { store, vault, proofKey: Buffer.alloc(32, 1), ...staff },
    });
    store.access.set(a.hash('voyageur'), 'NOT_STAFF');
    store.access.set(a.hash('staff_sans_mfa'), 'TOTP_NOT_ENROLLED');
    store.access.set(a.hash('staff'), 'ELEVATED');
    apps.push(a);
    return a;
  }

  it('GET /staff/me : 200 (état et rôles), 401 sans session', async () => {
    const { api, cookie } = await app();
    const me = await api.request('GET', '/staff/me', { headers: cookie('staff') });
    expect(me.status).toBe(200);
    expect(me.json).toMatchObject({ state: 'ELEVATED' });
    expect((await api.request('GET', '/staff/me', { headers: cookie('voyageur') })).json).toEqual({
      state: 'NOT_STAFF',
      roles: [],
    });
    expect((await api.request('GET', '/staff/me')).status).toBe(401);
  });

  it('POST /staff/mfa/enroll : 200, 400, 401, 415, 429 (verrou), 503 (coffre)', async () => {
    const { api, cookie, h } = await app();
    const headers = cookie('staff_sans_mfa');
    const enrollmentCode = 'ABCDEFGHIJKLMNOP';
    const ok = await api.request('POST', '/staff/mfa/enroll', {
      headers,
      body: { enrollmentCode },
    });
    expect(ok.status).toBe(200);
    expect(
      (await api.request('POST', '/staff/mfa/enroll', { headers, body: { enrollmentCode: '1' } }))
        .status,
    ).toBe(400);
    store.reveal = 'REFUSED';
    expect(
      (await api.request('POST', '/staff/mfa/enroll', { headers, body: { enrollmentCode } })).json,
    ).toMatchObject({ code: 'AUTH_TOTP_INVALID' });
    store.reveal = 'LOCKED';
    expect(
      (await api.request('POST', '/staff/mfa/enroll', { headers, body: { enrollmentCode } }))
        .status,
    ).toBe(429);
    store.reveal = 'OK';
    store.secretRef = 'ref-absente';
    expect(
      (await api.request('POST', '/staff/mfa/enroll', { headers, body: { enrollmentCode } }))
        .status,
    ).toBe(503);
    store.secretRef = 'ref-ok';
    expect(
      (await api.request('POST', '/staff/mfa/enroll', { body: { enrollmentCode } })).status,
    ).toBe(401);
    expect((await api.request('POST', '/staff/mfa/enroll', textBody(headers))).status).toBe(415);
    expect(h.logs.join('\n')).not.toContain(enrollmentCode);
  });

  it('POST /staff/mfa/verify : 200, 400, 401, 403, 415, 429 (verrou), 503 (sans clé de preuve)', async () => {
    const { api, cookie } = await app();
    const verify = (headers: Record<string, string>, code = '123456') =>
      api.request('POST', '/staff/mfa/verify', { headers, body: { code } });
    expect((await verify(cookie('staff'))).json).toEqual({ state: 'ELEVATED' });
    expect((await verify(cookie('staff'), 'abc')).status).toBe(400);
    expect((await verify({})).status).toBe(401);
    expect((await verify(cookie('staff_sans_mfa'))).json).toMatchObject({ code: '2FA_REQUIRED' });
    expect((await api.request('POST', '/staff/mfa/verify', textBody(cookie('staff')))).status).toBe(
      415,
    );

    const locked = await app();
    store.access.set(locked.hash('staff_sans_mfa'), 'LOCKED');
    expect(
      (
        await locked.api.request('POST', '/staff/mfa/verify', {
          headers: locked.cookie('staff_sans_mfa'),
          body: { code: '123456' },
        })
      ).json,
    ).toMatchObject({ code: 'AUTH_TOTP_LOCKED' });
    store.access.set(locked.hash('staff_sans_mfa'), 'MFA_REQUIRED');
    expect(
      (
        await locked.api.request('POST', '/staff/mfa/verify', {
          headers: locked.cookie('staff_sans_mfa'),
          body: { code: '000000' },
        })
      ).status,
    ).toBe(400);

    const noKey = await app({ proofKey: null });
    expect(
      (
        await noKey.api.request('POST', '/staff/mfa/verify', {
          headers: noKey.cookie('staff'),
          body: { code: '123456' },
        })
      ).json,
    ).toMatchObject({ code: 'STAFF_MFA_UNAVAILABLE' });
  });

  it('POST /staff/members/{id}/suspend et reset-totp : 200, 400, 401, 403, 415, 503', async () => {
    const { api, cookie } = await app();
    const headers = cookie('staff');
    for (const action of ['suspend', 'reset-totp']) {
      const path = `/staff/members/${ID}/${action}`;
      expect((await api.request('POST', path, { headers, body: { reason: REASON } })).status).toBe(
        200,
      );
      expect((await api.request('POST', path, { headers, body: { reason: 'court' } })).status).toBe(
        400,
      );
      expect((await api.request('POST', path, { body: { reason: REASON } })).status).toBe(401);
      expect(
        (await api.request('POST', path, { headers: cookie('voyageur'), body: { reason: REASON } }))
          .status,
      ).toBe(403);
      expect((await api.request('POST', path, textBody(headers))).status).toBe(415);
    }
    store.command = 'FORBIDDEN';
    expect(
      (
        await api.request('POST', `/staff/members/${ID}/suspend`, {
          headers,
          body: { reason: REASON },
        })
      ).json,
    ).toMatchObject({ code: 'FORBIDDEN' });
    store.command = 'DONE';
    vault.storeFails = true;
    expect(
      (
        await api.request('POST', `/staff/members/${ID}/reset-totp`, {
          headers,
          body: { reason: REASON },
        })
      ).status,
    ).toBe(503);
    vault.storeFails = false;
  });

  it('GET /staff/audit : 200, 401, 403', async () => {
    const { api, cookie } = await app();
    const r = await api.request('GET', '/staff/audit?limit=10', { headers: cookie('staff') });
    expect(r.status).toBe(200);
    expect((await api.request('GET', '/staff/audit')).status).toBe(401);
    expect(
      (await api.request('GET', '/staff/audit', { headers: cookie('staff_sans_mfa') })).status,
    ).toBe(403);
  });

  it('429 : limite de débit de la console par IP sur chaque route /staff', async () => {
    const { api, cookie } = await app({
      limits: {
        requestsPerIp: 0,
        requestWindowMs: 60_000,
        mfaPerIp: 1_000,
        mfaPerAccount: 1_000,
        mfaWindowMs: 60_000,
      },
    });
    const headers = cookie('staff');
    for (const [method, path, body] of [
      ['GET', '/staff/me', undefined],
      ['GET', '/staff/audit', undefined],
      ['POST', `/staff/members/${ID}/suspend`, { reason: REASON }],
      ['POST', `/staff/members/${ID}/reset-totp`, { reason: REASON }],
      ['POST', '/staff/mfa/verify', { code: '123456' }],
      ['POST', '/staff/mfa/enroll', { enrollmentCode: 'ABCDEFGHIJKLMNOP' }],
    ] as const) {
      const r = await api.request(method, path, { headers, body });
      expect(r.status, `${method} ${path}`).toBe(429);
    }
  });

  it('couverture : chaque statut déclaré pour /staff est exercé', () => {
    expect(missingCoverage(contract, '/staff', coverageOf(...apps))).toEqual([]);
  });
});
