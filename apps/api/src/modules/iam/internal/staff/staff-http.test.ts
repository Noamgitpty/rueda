/**
 * `StaffGuard` sur HTTP, dans un module consommateur qui n'importe que l'index d'IAM (comme SUP) :
 * - sans session : 401 ; session sans rôle interne : 403 FORBIDDEN ; rôle sans TOTP, enrôlement à
 *   finir, facteur verrouillé ou session non élevée : 403 2FA_REQUIRED — le contrôleur n'est
 *   jamais atteint (critère 2 d'US-012, « un rôle sans MFA ne peut rien faire de sensible ») ;
 * - session élevée : le contrôleur reçoit le principal (rôles, preuve de possession) ;
 * - écriture gardée : JSON exigé (CSRF) ; réponse jamais mise en cache ; aucun jeton journalisé.
 * La base est remplacée par un magasin qui rend l'issue de `core.iam_staff_cmd_begin`.
 */
import 'reflect-metadata';
import { Controller, Get, Module, Post, Req, UseGuards } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { FakeAuthStore } from '../../testing/fake-auth-store.js';
import { FakeTotpSecretVault } from '../../testing/fake-totp-vault.js';
import { call, sessionTokenFrom, startAuthApp } from '../../testing/http-harness.js';
import { StaffConsoleModule, StaffGuard, staffPrincipalOf } from '../../index.js';
import { tokenHash } from '../session-token.js';
import type { StaffAccess, StaffAccessOutcome, StaffStore } from './staff-store.js';

let reached = 0;

@Controller('probe-console')
class ProbeConsoleController {
  @Get()
  @UseGuards(StaffGuard)
  read(@Req() request: object): { userId: string | null; roles: number; hash: string | null } {
    reached += 1;
    const p = staffPrincipalOf(request);
    return {
      userId: p?.userId ?? null,
      roles: p?.roles.length ?? 0,
      hash: p?.tokenHash.toString('hex') ?? null,
    };
  }

  @Post()
  @UseGuards(StaffGuard)
  write(): { ok: true } {
    reached += 1;
    return { ok: true };
  }
}

function stubStore(outcome: () => StaffAccessOutcome): StaffStore {
  const access = (): StaffAccess => ({
    outcome: outcome(),
    userId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c',
    factorId: null,
    roles: [{ role: 'OPS_AGENT', countries: ['AA'] }],
  });
  const never = () => Promise.reject(new Error('non appelé'));
  return {
    begin: () => Promise.resolve(access()),
    enrollReveal: never,
    elevate: never,
    mfaAttempt: never,
    suspend: never,
    resetTotp: never,
    auditRead: () => Promise.resolve([]),
  };
}

async function withConsole(
  fn: (
    url: string,
    cookie: string,
    token: string,
    set: (o: StaffAccessOutcome) => void,
  ) => Promise<void>,
  output?: (text: string) => void,
): Promise<void> {
  let current: StaffAccessOutcome = 'MFA_REQUIRED';
  @Module({
    imports: [
      StaffConsoleModule.register({
        store: stubStore(() => current),
        vault: new FakeTotpSecretVault(),
        proofKey: Buffer.alloc(32, 1),
        issuer: 'Console',
      }),
    ],
    controllers: [ProbeConsoleController],
  })
  class ProbeConsoleModule {}

  const h = await startAuthApp(new FakeAuthStore(), { imports: [ProbeConsoleModule] });
  try {
    await call(h.url, 'POST', '/auth/signup', {
      body: {
        email: 'staff@example.test',
        password: 'Correct-Horse-9',
        legalFirstName: 'Ana',
        legalLastName: 'Pérez',
        locale: 'es',
        termsAccepted: true,
      },
    });
    const login = await call(h.url, 'POST', '/auth/login', {
      body: { email: 'staff@example.test', password: 'Correct-Horse-9' },
    });
    const token = sessionTokenFrom(login.setCookie) ?? '';
    await fn(h.url, `__Host-session=${token}`, token, (o) => {
      current = o;
    });
  } finally {
    output?.(h.output());
    await h.close();
  }
}

describe('StaffGuard : la console exige une session élevée par TOTP', () => {
  it.each([
    ['MFA_REQUIRED', 403, '2FA_REQUIRED'],
    ['TOTP_NOT_ENROLLED', 403, '2FA_REQUIRED'],
    ['ENROLLMENT_REQUIRED', 403, '2FA_REQUIRED'],
    ['LOCKED', 403, '2FA_REQUIRED'],
    ['NOT_STAFF', 403, 'FORBIDDEN'],
    ['AUTH_REQUIRED', 401, 'AUTH_REQUIRED'],
  ] as const)('%s : %i %s, contrôleur jamais atteint', (outcome, status, code) =>
    withConsole(async (url, cookie, _t, set) => {
      set(outcome);
      reached = 0;
      for (const method of ['GET', 'POST'] as const) {
        const r = await call(url, method, '/probe-console', { cookie, body: {} });
        expect(r.status, method).toBe(status);
        expect(r.body, method).toMatchObject({ code });
      }
      expect(reached).toBe(0);
    }),
  );

  it('sans cookie : 401 ; écriture sans JSON : 415 avant tout appel à la base', () =>
    withConsole(async (url, cookie, _t, set) => {
      set('ELEVATED');
      reached = 0;
      expect((await call(url, 'GET', '/probe-console')).status).toBe(401);
      const r = await call(url, 'POST', '/probe-console', { cookie, contentType: 'text/plain' });
      expect(r.status).toBe(415);
      expect(reached).toBe(0);
    }));

  it('session élevée : principal transmis (rôles, preuve de possession), réponse non mise en cache, aucun jeton journalisé', async () => {
    let logs = '';
    let token = '';
    await withConsole(
      async (url, cookie, t, set) => {
        token = t;
        set('ELEVATED');
        const r = await call(url, 'GET', '/probe-console', { cookie });
        expect(r.status).toBe(200);
        expect(r.body).toEqual({
          userId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c',
          roles: 1,
          hash: tokenHash(t).toString('hex'),
        });
        expect(r.headers.get('cache-control')).toBe('no-store');
        expect((await call(url, 'POST', '/probe-console', { cookie, body: {} })).status).toBe(201);
        // GET /staff/me : l'état sert au back-office pour choisir l'écran
        const me = await call(url, 'GET', '/staff/me', { cookie });
        expect(me.body).toEqual({
          state: 'ELEVATED',
          roles: [{ role: 'OPS_AGENT', countries: ['AA'] }],
        });
      },
      (text) => {
        logs = text;
      },
    );
    expect(token).not.toBe('');
    expect(logs).not.toContain(token);
    expect(logs).not.toContain(tokenHash(token).toString('hex'));
  });
});
