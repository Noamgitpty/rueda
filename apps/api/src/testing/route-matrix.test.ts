/**
 * US-043 — tests de sécurité automatisés de l'API, sur l'application RÉELLE (`ApiModule`, ordre et
 * durcissement de main.ts ; adaptateurs en mémoire : api-harness.ts). Sans base : `test:unit`.
 *
 * 1. Matrice des routes (`apps/api/security/route-matrix.json`) : complète (toute route d'un
 *    contrôleur a une entrée et inversement), cohérente (rôles connus, IDOR décrit) ; pour CHAQUE
 *    route, authentification requise comme la matrice le dit : anonyme ⇒ 401 hors `public` ;
 *    compte sans rôle interne ⇒ 403 FORBIDDEN et staff sans TOTP ⇒ 403 2FA_REQUIRED sur `staff`.
 *    Les cellules staff par rôle et par pays sont prouvées sur PostgreSQL (route-matrix.int.test.ts).
 * 2. En-têtes de sécurité sur toute réponse (succès, 401, 403, 404, 413), sans `X-Powered-By`.
 * 3. Taille des corps : au-delà de API_BODY_LIMIT_BYTES ⇒ 413, corps `{ code, messageKey }`.
 * 4. CORS : aucune en-tête `Access-Control-Allow-*`, requête préliminaire comprise.
 * 5. Forçage par le client : `org_id`, `country`, identifiant d'utilisateur posés en en-tête, en
 *    paramètre ou dans le corps ne changent jamais le principal (il ne vient que du cookie).
 * 6. Aucune donnée personnelle dans les erreurs : corps JSON illisible, route inconnue, identifiants
 *    refusés, inscription invalide : ni l'email, ni le téléphone, ni l'URL ne sont renvoyés.
 * Les attendus viennent de 17 §2.3 et §6.6, 16 ADM-001 et de la matrice, jamais du code testé.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_BODY_LIMIT_BYTES, SECURITY_HEADERS } from '../http-hardening.js';
import { startApiHarness, cookieOf } from './api-harness.js';
import type { ApiHarness, HttpReply } from './api-harness.js';
import { controllerRoutes } from './controller-routes.js';
import { ROUTE_MATRIX } from './route-matrix.js';

const STAFF_ROLES = ['SUPPORT_AGENT', 'OPS_AGENT', 'FINANCE', 'ADMIN', 'SUPERADMIN'];
const UUID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';
/** Donnée personnelle fictive (jamais réelle) qui ne doit revenir dans aucune erreur. */
const EMAIL = 'maria.lopez.us043@example.test';
const PHONE = '+50760001234';

/** Chemin concret d'une route (paramètres remplacés). */
const pathOf = (route: string): { method: string; path: string } => {
  const [method, template] = route.split(' ') as [string, string];
  return {
    method,
    path: template.replace(/\{[A-Za-z]+\}/g, (p) => (p === '{provider}' ? 'fake' : UUID)),
  };
};

const jsonHeaders = { 'content-type': 'application/json' };

describe('matrice des routes : complète et cohérente', () => {
  it('toute route d’un contrôleur a une entrée ; aucune entrée fantôme', () => {
    const routes = controllerRoutes();
    expect(routes.length).toBeGreaterThan(0);
    expect(Object.keys(ROUTE_MATRIX.routes).sort()).toEqual(routes);
  });

  it('acteurs : anonyme, voyageur, hôte, co-hôte, staff sans TOTP et chaque rôle interne', () => {
    expect(ROUTE_MATRIX.acteurs).toEqual([
      'anonyme',
      'voyageur',
      'hote',
      'cohote',
      'staff_sans_mfa',
      ...STAFF_ROLES,
      'ADMIN_tous_pays',
      'SUPERADMIN_tous_pays',
    ]);
  });

  it('route staff : permission, rôles connus et portée ; route avec identifiant d’objet de pays : IDOR décrit', () => {
    for (const [route, e] of Object.entries(ROUTE_MATRIX.routes)) {
      expect(['public', 'session', 'staff'], route).toContain(e.acces);
      if (e.acces === 'staff') {
        expect(e.permission, route).toMatch(/^[a-z]+\.[a-z_]+/);
        expect(e.roles?.length, route).toBeGreaterThan(0);
        for (const r of e.roles ?? []) expect(STAFF_ROLES, route).toContain(r);
        expect(['pays', 'tous_les_pays', 'sans_pays'], route).toContain(e.portee);
        if (e.portee === 'pays') expect(e.idor, route).toBeTruthy();
      } else {
        expect(e.roles, route).toBeUndefined();
      }
    }
  });
});

describe('API réelle (ApiModule + durcissement), adaptateurs en mémoire', () => {
  let h: ApiHarness;
  beforeAll(async () => {
    h = await startApiHarness();
  });
  afterAll(async () => {
    await h.close();
  });

  const send = (route: string, headers: Record<string, string> = {}): Promise<HttpReply> => {
    const { method, path } = pathOf(route);
    return h.call(method, path, {
      headers: { ...jsonHeaders, ...headers },
      ...(method === 'GET' ? {} : { body: '{}' }),
    });
  };

  const assertHeaders = (r: HttpReply, where: string): void => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      if (name === 'Cache-Control' || name === 'Content-Security-Policy') {
        expect(r.headers[name.toLowerCase()], `${where} ${name}`).toBeTruthy();
      } else {
        expect(r.headers[name.toLowerCase()], `${where} ${name}`).toBe(value);
      }
    }
    expect(r.headers['x-powered-by'], where).toBeUndefined();
    expect(
      Object.keys(r.headers).filter((k) => k.startsWith('access-control-')),
      where,
    ).toEqual([]);
  };

  it('authentification requise : anonyme ⇒ 401 AUTH_REQUIRED sur toute route non publique', async () => {
    for (const [route, e] of Object.entries(ROUTE_MATRIX.routes)) {
      const r = await send(route);
      assertHeaders(r, route);
      if (e.acces === 'public') {
        expect([401, 403], `${route} ${r.status} ${r.text}`).not.toContain(r.status);
      } else {
        expect(r.status, `${route} ${r.text}`).toBe(401);
        expect(JSON.parse(r.text)).toMatchObject({ code: 'AUTH_REQUIRED' });
      }
    }
  });

  it('cookie de session forgé, mal formé ou en double ⇒ 401 comme l’anonyme', async () => {
    const forged = [
      '__Host-session=' + 'A'.repeat(43),
      '__Host-session=not-a-token',
      `__Host-session=${h.sessions.voyageur.token}; __Host-session=${h.sessions.staff.token}`,
      `session=${h.sessions.staff.token}`,
    ];
    for (const cookie of forged) {
      for (const route of ['GET /auth/session', 'GET /staff/audit', 'POST /console/actions']) {
        const r = await send(route, { cookie });
        expect(r.status, `${route} ${cookie.slice(0, 30)}`).toBe(401);
      }
    }
  });

  it('voyageur (session sans rôle interne) : routes session admises, routes staff ⇒ 403 FORBIDDEN', async () => {
    for (const [route, e] of Object.entries(ROUTE_MATRIX.routes)) {
      const r = await send(route, cookieOf(h.sessions.voyageur));
      assertHeaders(r, route);
      if (e.acces === 'staff') {
        expect(r.status, `${route} ${r.text}`).toBe(403);
        expect(JSON.parse(r.text)).toMatchObject({ code: 'FORBIDDEN' });
      } else {
        expect([401, 403], `${route} ${r.status} ${r.text}`).not.toContain(r.status);
      }
    }
  });

  it('staff sans TOTP : routes staff ⇒ 403 2FA_REQUIRED', async () => {
    for (const [route, e] of Object.entries(ROUTE_MATRIX.routes)) {
      if (e.acces !== 'staff') continue;
      const r = await send(route, cookieOf(h.sessions.staff_sans_mfa));
      expect(r.status, `${route} ${r.text}`).toBe(403);
      expect(JSON.parse(r.text)).toMatchObject({ code: '2FA_REQUIRED' });
    }
  });

  it('staff élevé : les gardes laissent passer (la permission est jugée en base, test:int)', async () => {
    for (const [route, e] of Object.entries(ROUTE_MATRIX.routes)) {
      if (e.acces !== 'staff') continue;
      const r = await send(route, cookieOf(h.sessions.staff));
      expect([401], `${route} ${r.text}`).not.toContain(r.status);
      expect(r.text, route).not.toMatch(/2FA_REQUIRED|"FORBIDDEN"/);
    }
  });

  it('écriture authentifiée sans JSON (CSRF) ⇒ refus, jamais exécutée', async () => {
    const r = await h.call('POST', '/console/actions', {
      headers: { ...cookieOf(h.sessions.staff), 'content-type': 'text/plain' },
      body: 'x',
    });
    expect([400, 415], r.text).toContain(r.status);
  });

  it('corps au-delà de la limite ⇒ 413 PAYLOAD_TOO_LARGE, sans écho, en-têtes posés', async () => {
    const big = JSON.stringify({ email: EMAIL, pad: 'x'.repeat(API_BODY_LIMIT_BYTES) });
    for (const path of ['/auth/login', '/auth/signup', '/console/actions']) {
      const r = await h.call('POST', path, {
        headers: { ...jsonHeaders, ...cookieOf(h.sessions.staff) },
        body: big,
      });
      expect(r.status, path).toBe(413);
      expect(JSON.parse(r.text)).toEqual({
        code: 'PAYLOAD_TOO_LARGE',
        messageKey: 'common.auth.requestInvalid',
      });
      assertHeaders(r, path);
    }
    // juste sous la limite : admis par l'analyseur (la route décide ensuite)
    const ok = JSON.stringify({ email: 'x', password: 'y'.repeat(API_BODY_LIMIT_BYTES - 64) });
    expect(Buffer.byteLength(ok)).toBeLessThan(API_BODY_LIMIT_BYTES);
    const r = await h.call('POST', '/auth/login', { headers: jsonHeaders, body: ok });
    expect(r.status).not.toBe(413);
  });

  it('CORS : aucune origine croisée autorisée, requête préliminaire comprise', async () => {
    for (const route of [
      'GET /brand',
      'POST /auth/login',
      'GET /auth/session',
      'POST /console/actions',
    ]) {
      const { path, method } = pathOf(route);
      const pre = await h.call('OPTIONS', path, {
        headers: {
          origin: 'https://attaquant.example',
          'access-control-request-method': method,
          'access-control-request-headers': 'content-type',
        },
      });
      expect(
        Object.keys(pre.headers).filter((k) => k.startsWith('access-control-')),
        route,
      ).toEqual([]);
      const simple = await h.call(method, path, {
        headers: {
          origin: 'https://attaquant.example',
          ...jsonHeaders,
          ...cookieOf(h.sessions.voyageur),
        },
        ...(method === 'GET' ? {} : { body: '{}' }),
      });
      expect(simple.headers['access-control-allow-origin'], route).toBeUndefined();
      expect(simple.headers['access-control-allow-credentials'], route).toBeUndefined();
    }
  });

  it('forçage par le client : org_id, pays et identifiant posés par le client n’ont aucun effet', async () => {
    const voyageur = h.sessions.voyageur;
    const forged = {
      'x-org-id': UUID,
      'x-rueda-org-id': UUID,
      'x-country': 'ZZ',
      'x-user-id': h.sessions.staff.userId,
      'x-actor-kind': 'STAFF',
      'x-forwarded-for': '203.0.113.7',
    };
    const r = await h.call('GET', `/auth/session?org_id=${UUID}&country=ZZ&userId=${UUID}`, {
      headers: { ...cookieOf(voyageur), ...forged },
    });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text)).toMatchObject({ userId: voyageur.userId });
    // un voyageur qui se déclare staff, d'un pays ou d'un compte d'hôte reste un voyageur
    const s = await h.call('POST', '/console/actions', {
      headers: { ...jsonHeaders, ...cookieOf(voyageur), ...forged },
      body: JSON.stringify({ orgId: UUID, org_id: UUID, country: 'ZZ', actorKind: 'STAFF' }),
    });
    expect(s.status).toBe(403);
    expect(JSON.parse(s.text)).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('aucune donnée personnelle dans les erreurs (corps illisible, route inconnue, identifiants, inscription)', async () => {
    const replies: [string, HttpReply][] = [];
    // corps JSON illisible qui CONTIENT la donnée : le message brut de JSON.parse la reprendrait
    replies.push([
      'json',
      await h.call('POST', '/auth/login', {
        headers: jsonHeaders,
        body: `{"email": "${EMAIL}", "phone": ${PHONE}`,
      }),
    ]);
    // route inconnue avec la donnée dans le chemin et la requête (« Cannot GET /… »)
    replies.push([
      '404',
      await h.call('GET', `/trips/${encodeURIComponent(EMAIL)}?phone=${encodeURIComponent(PHONE)}`),
    ]);
    // identifiants refusés (anti-énumération) et inscription invalide
    replies.push([
      'login',
      await h.call('POST', '/auth/login', {
        headers: jsonHeaders,
        body: JSON.stringify({ email: EMAIL, password: 'mauvais-mot-de-passe' }),
      }),
    ]);
    replies.push([
      'signup',
      await h.call('POST', '/auth/signup', {
        headers: jsonHeaders,
        body: JSON.stringify({ email: `${EMAIL}@@`, password: 'x', legalFirstName: PHONE }),
      }),
    ]);
    // identifiant d'objet invalide dans le chemin
    replies.push(['param', await h.call('GET', `/brand/assets/${encodeURIComponent(EMAIL)}`)]);
    for (const [label, r] of replies) {
      expect(r.status, `${label} ${r.text}`).toBeGreaterThanOrEqual(400);
      expect(r.status, `${label} ${r.text}`).toBeLessThan(500);
      for (const secret of [EMAIL, encodeURIComponent(EMAIL), PHONE, 'maria.lopez']) {
        expect(r.text, label).not.toContain(secret);
      }
      expect(r.text, label).not.toMatch(
        /Cannot (GET|POST)|Unexpected token|SyntaxError|at [A-Za-z]+ \(/,
      );
      const body = JSON.parse(r.text) as { code?: unknown };
      expect(typeof body.code, label).toBe('string');
      assertHeaders(r, label);
    }
    expect(JSON.parse(replies[0]?.[1].text ?? '{}')).toEqual({
      code: 'REQUEST_INVALID',
      messageKey: 'common.auth.requestInvalid',
    });
    expect(replies[1]?.[1].status).toBe(404);
    expect(JSON.parse(replies[1]?.[1].text ?? '{}')).toEqual({
      code: 'NOT_FOUND',
      messageKey: 'common.auth.requestInvalid',
    });
    // ni le journal de l'application
    expect(h.logs.join('\n')).not.toContain(EMAIL);
  });
});
