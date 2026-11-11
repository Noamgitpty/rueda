/**
 * Le port est consommable par un AUTRE module (revue architecture US-010) : un module qui
 * n'importe pas `IamAuthModule.register()` pose `@UseGuards(SessionGuard)` sur ses routes.
 * Le contrôleur ne refait AUCUN contrôle : si la garde laissait passer une requête sans session,
 * ces tests échoueraient (revue code US-010, constat 1). Écritures gardées : JSON exigé (CSRF).
 */
import 'reflect-metadata';
import { Controller, Get, Module, Post, Req, UseGuards } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { FakeAuthStore } from '../testing/fake-auth-store.js';
import { call, sessionTokenFrom, startAuthApp } from '../testing/http-harness.js';
import { SessionGuard, principalOf } from '../index.js';

@Controller('probe')
class ProbeController {
  @Get()
  @UseGuards(SessionGuard)
  read(@Req() request: object): { userId: string | null; emailVerified: boolean | null } {
    const p = principalOf(request);
    return { userId: p?.userId ?? null, emailVerified: p?.emailVerified ?? null };
  }

  @Post()
  @UseGuards(SessionGuard)
  write(): { ok: true } {
    return { ok: true };
  }
}

/** Module consommateur : n'importe rien d'IAM (IamAuthModule est global). */
@Module({ controllers: [ProbeController] })
class ProbeModule {}

async function withProbe(fn: (url: string, cookie: string) => Promise<void>): Promise<void> {
  const h = await startAuthApp(new FakeAuthStore(), { imports: [ProbeModule] });
  try {
    await call(h.url, 'POST', '/auth/signup', {
      body: {
        email: 'probe@example.test',
        password: 'Correct-Horse-9',
        legalFirstName: 'Ana',
        legalLastName: 'Pérez',
        locale: 'fr',
        termsAccepted: true,
        acceptedDocuments: [
          { kind: 'TOS_GUEST', version: 1 },
          { kind: 'PRIVACY', version: 1 },
        ],
      },
    });
    const login = await call(h.url, 'POST', '/auth/login', {
      body: { email: 'probe@example.test', password: 'Correct-Horse-9' },
    });
    await fn(h.url, `__Host-session=${sessionTokenFrom(login.setCookie)}`);
  } finally {
    await h.close();
  }
}

describe('SessionGuard dans un module consommateur', () => {
  it('sans session, cookie forgé ou session révoquée : 401 AUTH_REQUIRED (la garde seule refuse)', () =>
    withProbe(async (url, cookie) => {
      for (const c of [undefined, '__Host-session=forge']) {
        const r = await call(url, 'GET', '/probe', c === undefined ? {} : { cookie: c });
        expect(r.status, String(c)).toBe(401);
        expect(r.body).toEqual({
          code: 'AUTH_REQUIRED',
          messageKey: 'common.auth.sessionRequired',
        });
        expect(r.headers.get('cache-control')).toBe('no-store');
      }
      const ok = await call(url, 'GET', '/probe', { cookie });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ emailVerified: false });
      expect((ok.body as { userId: string }).userId).toMatch(/^[0-9a-f-]{36}$/);
      expect((await call(url, 'POST', '/auth/logout', { cookie })).status).toBe(204);
      const revoked = await call(url, 'GET', '/probe', { cookie });
      expect(revoked.status).toBe(401);
      expect(revoked.body).toMatchObject({ code: 'AUTH_REQUIRED' });
    }));

  it('écriture gardée : JSON exigé (415 avant tout effet), sinon acceptée avec une session', () =>
    withProbe(async (url, cookie) => {
      const form = await call(url, 'POST', '/probe', {
        cookie,
        contentType: 'application/x-www-form-urlencoded',
      });
      expect(form.status).toBe(415);
      expect(form.body).toMatchObject({ code: 'REQUEST_INVALID' });
      expect((await call(url, 'POST', '/probe', { cookie, contentType: null })).status).toBe(415);
      expect((await call(url, 'POST', '/probe', { cookie })).status).toBe(201);
      expect((await call(url, 'POST', '/probe', {})).status).toBe(401);
    }));
});
