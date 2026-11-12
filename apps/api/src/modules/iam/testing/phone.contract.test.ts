/**
 * US-104 — tests de contrat des routes /phone (vérification du téléphone par OTP), sur le FAKE du
 * magasin (sans base) : chaque réponse HTTP réelle est confrontée à `apps/api/openapi/openapi.json`
 * (corps, codes stables, `Cache-Control`). Attendus : 19 US-104 (code émis à 10:00 et saisi à
 * 10:11 ⇒ OTP_EXPIRED ; 5 codes faux puis un 6e ⇒ OTP_LOCKED 1 h ; contrôle bloquant du paiement),
 * 16 VER-013 (numéro vérifié ailleurs ⇒ ACCOUNT_DUPLICATE_PHONE ; renvoi après 60 s) et
 * l'anti-énumération demandée par la story (réponse identique, numéro libre ou pris). Pays,
 * numéros et paramètres : configuration pays (jamais une constante du code). Données fictives.
 */
import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import { CountryConfigService, resolveParam } from '../../cfg/index.js';
import { ContractClient, repositoryContract } from '../../../testing/openapi-contract.js';
import type { PhoneOtpOptions } from '../internal/iam-auth.module.js';
import { OtpCodeHasher } from '../internal/phone/otp-code.js';
import type { OtpSendGuard, OtpSendRequest } from '../internal/phone/phone-verification.service.js';
import { UnavailablePhoneOtpStore } from '../internal/phone/phone-otp-store.js';
import { FakeAuthStore } from './fake-auth-store.js';
import { FakePhoneOtpStore } from './fake-phone-otp-store.js';
import { sessionTokenFrom, startAuthApp } from './http-harness.js';
import type { AuthHttpHarness } from './http-harness.js';

const PASSWORD = 'Correct-Horse-9';
const CONFIG = new CountryConfigService().config;
const COUNTRIES = [...CONFIG.countries.keys()].sort();
const HASHER = new OtpCodeHasher(Buffer.alloc(32, 7));
/** 16 VER-013 : 10 min, 5 essais, blocage 1 h. */
const TTL_S = 600;
const MAX_ATTEMPTS = 5;
const LOCK_S = 3_600;

const planOf = (country: string) => {
  const plan = CONFIG.countries.get(country)?.phone;
  if (plan === undefined) throw new Error(`pays sans plan : ${country}`);
  return plan;
};

/** Numéro de mobile fictif du pays, forme nationale (comme le voyageur le tape). */
let serial = 0;
function nationalNumber(country: string): string {
  const plan = planOf(country);
  const prefix = plan.mobilePrefixes[0] ?? '';
  serial += 1;
  const digits = String(serial).padStart(plan.nationalLength - prefix.length, '0');
  return `${plan.trunkPrefix ?? ''}${prefix}${digits}`;
}
const e164 = (country: string, national: string): string => {
  const plan = planOf(country);
  const n =
    plan.trunkPrefix !== null && national.startsWith(plan.trunkPrefix)
      ? national.slice(plan.trunkPrefix.length)
      : national;
  return `+${plan.callingCode}${n}`;
};

/** Garde anti-abus enregistreur ; `refuse` lève l'erreur que lèverait AbuseGuard (RISK). */
class RecordingGuard implements OtpSendGuard {
  readonly calls: OtpSendRequest[] = [];
  refuse: 'RATE_LIMITED' | 'RATE_LIMIT_UNAVAILABLE' | null = null;
  checkCostlySend(request: OtpSendRequest): Promise<void> {
    this.calls.push(request);
    if (this.refuse === 'RATE_LIMITED') {
      return Promise.reject(
        new HttpException(
          {
            code: 'RATE_LIMITED',
            messageKey: 'common.rateLimit.retryLater',
            values: { retryAfterS: 3600 },
          },
          429,
        ),
      );
    }
    if (this.refuse === 'RATE_LIMIT_UNAVAILABLE') {
      return Promise.reject(
        new HttpException(
          { code: 'RATE_LIMIT_UNAVAILABLE', messageKey: 'common.rateLimit.unavailable' },
          503,
        ),
      );
    }
    return Promise.resolve();
  }
}

describe('contrat HTTP — /phone', () => {
  const contract = repositoryContract();
  const covered = new Set<string>();
  const harnesses: AuthHttpHarness[] = [];
  afterEach(async () => {
    for (const h of harnesses.splice(0)) await h.close();
  });
  const record = (api: ContractClient) => {
    for (const c of api.covered) covered.add(c);
  };

  async function app(options: { hasher?: OtpCodeHasher | null; store?: 'fake' | 'down' } = {}) {
    let now = Date.now();
    const clock = () => now;
    const auth = new FakeAuthStore(clock);
    const phone = new FakePhoneOtpStore(async (hash) => {
      const s = await auth.resolveSession(hash);
      return s === null ? null : { userId: s.userId, emailVerified: s.emailVerified };
    }, clock);
    const guard = new RecordingGuard();
    const phoneOptions: PhoneOtpOptions = {
      store: options.store === 'down' ? new UnavailablePhoneOtpStore() : phone,
      hasher: options.hasher === undefined ? HASHER : options.hasher,
      sendGuard: guard,
    };
    const h = await startAuthApp(auth, { clock, phone: phoneOptions });
    harnesses.push(h);
    return {
      api: new ContractClient(contract, h.url),
      h,
      phone,
      guard,
      advance: (seconds: number) => {
        now += seconds * 1000;
      },
    };
  }

  /** Personne inscrite, e-mail vérifié sauf demande, connectée ; rend le cookie et l'identifiant. */
  async function person(
    api: ContractClient,
    h: AuthHttpHarness,
    options: { verified?: boolean } = {},
  ): Promise<{ cookie: string; userId: string }> {
    const email = `p-${randomUUID()}@example.test`;
    const signup = await api.request('POST', '/auth/signup', {
      body: {
        email,
        password: PASSWORD,
        legalFirstName: 'Ana',
        legalLastName: 'Prueba',
        locale: 'es',
        termsAccepted: true,
        acceptedDocuments: [
          { kind: 'TOS_GUEST', version: 1 },
          { kind: 'PRIVACY', version: 1 },
        ],
      },
    });
    expect(signup.status).toBe(202);
    if (options.verified !== false) {
      const token = h.notifier.verifications.at(-1)?.token ?? '';
      expect((await api.request('POST', '/auth/verify-email', { body: { token } })).status).toBe(
        200,
      );
    }
    const login = await api.request('POST', '/auth/login', { body: { email, password: PASSWORD } });
    expect(login.status).toBe(200);
    const cookie = `__Host-session=${sessionTokenFrom(login.headers.getSetCookie()) ?? ''}`;
    const session = await api.request('GET', '/auth/session', { headers: { cookie } });
    return { cookie, userId: (session.json as { userId: string }).userId };
  }

  it.each(COUNTRIES)(
    '%s : demande (202, envoi asynchrone, plafonds consultés), état, code juste (200) ; numéro posé et masqué',
    async (country) => {
      const { api, h, phone, guard } = await app();
      const p = await person(api, h);
      const national = nationalNumber(country);
      const sent = await api.request('POST', '/phone/otp', {
        headers: { cookie: p.cookie },
        body: { phone: national, country },
      });
      expect(sent.status).toBe(202);
      expect(sent.json).toMatchObject({
        code: 'OTP_SENT',
        messageKey: 'common.otp.sent',
        values: { resendAfterS: 60, expiresInS: TTL_S },
      });
      const masked = (sent.json as { values: { phone: string } }).values.phone;
      expect(masked.startsWith(`+${planOf(country).callingCode} `)).toBe(true);
      expect(masked.endsWith(national.slice(-2))).toBe(true);
      expect(masked).not.toContain(national.slice(-6, -2));
      // plafonds : numéro, IP, compte et indicatif pays (parade au SMS pumping)
      expect(guard.calls).toEqual([
        {
          channel: 'SMS_OTP',
          country,
          recipient: e164(country, national),
          ip: expect.any(String) as unknown as string,
          account: p.userId,
          prefix: `+${planOf(country).callingCode}`,
        },
      ]);
      const state = await api.request('GET', '/phone', { headers: { cookie: p.cookie } });
      expect(state.status).toBe(200);
      expect(state.json).toMatchObject({
        verified: false,
        phone: null,
        pending: { phone: masked, resendAfterS: 60, expiresInS: TTL_S, attemptsLeft: MAX_ATTEMPTS },
        lockedForS: null,
      });
      expect(
        (state.json as { countries: { code: string }[] }).countries.map((c) => c.code),
      ).toEqual(COUNTRIES);
      phone.issueLatest(p.userId, HASHER.hash('482913'));
      const ok = await api.request('POST', '/phone/verify', {
        headers: { cookie: p.cookie },
        body: { code: '482913' },
      });
      expect(ok.status).toBe(200);
      expect(ok.json).toMatchObject({ code: 'PHONE_VERIFIED' });
      expect(phone.verifiedPhoneOf(p.userId)).toBe(e164(country, national));
      const after = await api.request('GET', '/phone', { headers: { cookie: p.cookie } });
      expect(after.json).toMatchObject({ verified: true, phone: masked, pending: null });
      // même numéro : déjà vérifié, rien ne part
      const again = await api.request('POST', '/phone/otp', {
        headers: { cookie: p.cookie },
        body: { phone: national, country },
      });
      expect(again.status).toBe(200);
      expect(again.json).toMatchObject({ code: 'PHONE_ALREADY_VERIFIED' });
      expect(guard.calls).toHaveLength(1);
      record(api);
    },
  );

  it.each(COUNTRIES)(
    '%s : critère 1 — code émis à 10:00, saisi à 10:11 ⇒ 400 OTP_EXPIRED',
    async (country) => {
      const { api, h, phone, advance } = await app();
      const p = await person(api, h);
      await api.request('POST', '/phone/otp', {
        headers: { cookie: p.cookie },
        body: { phone: nationalNumber(country), country },
      });
      phone.issueLatest(p.userId, HASHER.hash('123456'));
      advance(11 * 60);
      const r = await api.request('POST', '/phone/verify', {
        headers: { cookie: p.cookie },
        body: { code: '123456' },
      });
      expect(r.status).toBe(400);
      expect(r.json).toMatchObject({ code: 'OTP_EXPIRED', messageKey: 'common.otp.expired' });
      expect(phone.verifiedPhoneOf(p.userId)).toBeNull();
      record(api);
    },
  );

  it.each(COUNTRIES)(
    '%s : critère 1 — 5 codes faux puis un 6e (même juste) ⇒ 429 OTP_LOCKED, 60 min ; nouvelle demande refusée',
    async (country) => {
      const { api, h, phone, guard } = await app();
      const p = await person(api, h);
      const national = nationalNumber(country);
      await api.request('POST', '/phone/otp', {
        headers: { cookie: p.cookie },
        body: { phone: national, country },
      });
      phone.issueLatest(p.userId, HASHER.hash('111111'));
      for (let i = 1; i < MAX_ATTEMPTS; i++) {
        const wrong = await api.request('POST', '/phone/verify', {
          headers: { cookie: p.cookie },
          body: { code: '222222' },
        });
        expect(wrong.status).toBe(400);
        expect(wrong.json).toMatchObject({
          code: 'OTP_INVALID',
          values: { attempts: MAX_ATTEMPTS - i },
        });
      }
      const fifth = await api.request('POST', '/phone/verify', {
        headers: { cookie: p.cookie },
        body: { code: '222222' },
      });
      expect(fifth.status).toBe(429);
      expect(fifth.json).toMatchObject({ code: 'OTP_LOCKED', values: { minutes: LOCK_S / 60 } });
      const sixth = await api.request('POST', '/phone/verify', {
        headers: { cookie: p.cookie },
        body: { code: '111111' },
      });
      expect(sixth.status).toBe(429);
      expect(sixth.json).toMatchObject({ code: 'OTP_LOCKED' });
      const blocked = await api.request('POST', '/phone/otp', {
        headers: { cookie: p.cookie },
        body: { phone: national, country },
      });
      expect(blocked.status).toBe(429);
      expect(blocked.json).toMatchObject({ code: 'OTP_LOCKED' });
      // aucun plafond consommé ni défi créé pendant le blocage
      expect(guard.calls).toHaveLength(1);
      expect(phone.challengesOf(p.userId)).toHaveLength(1);
      record(api);
    },
  );

  it('anti-énumération : numéro déjà vérifié par un autre compte ⇒ même 202 qu’un numéro libre ; 409 ACCOUNT_DUPLICATE_PHONE seulement après le code juste', async () => {
    const country = COUNTRIES[0] ?? '';
    const { api, h, phone } = await app();
    const owner = await person(api, h);
    const taken = nationalNumber(country);
    phone.markVerified(owner.userId, e164(country, taken));
    const p = await person(api, h);
    const q = await person(api, h);
    const a = await api.request('POST', '/phone/otp', {
      headers: { cookie: p.cookie },
      body: { phone: taken, country },
    });
    const b = await api.request('POST', '/phone/otp', {
      headers: { cookie: q.cookie },
      body: { phone: nationalNumber(country), country },
    });
    expect(a.status).toBe(b.status);
    const shape = (j: unknown) => {
      const v = j as { code: string; messageKey: string; values: Record<string, unknown> };
      return { code: v.code, messageKey: v.messageKey, keys: Object.keys(v.values).sort() };
    };
    expect(shape(a.json)).toEqual(shape(b.json));
    phone.issueLatest(p.userId, HASHER.hash('909090'));
    const dup = await api.request('POST', '/phone/verify', {
      headers: { cookie: p.cookie },
      body: { code: '909090' },
    });
    expect(dup.status).toBe(409);
    expect(dup.json).toMatchObject({ code: 'ACCOUNT_DUPLICATE_PHONE' });
    expect(phone.verifiedPhoneOf(p.userId)).toBeNull();
    record(api);
  });

  it('renvoi : même numéro avant 60 s ⇒ même 202, rien ne part et aucun plafond consommé ; après 60 s ⇒ nouvel envoi', async () => {
    const country = COUNTRIES[1] ?? COUNTRIES[0] ?? '';
    const { api, h, phone, guard, advance } = await app();
    const p = await person(api, h);
    const national = nationalNumber(country);
    const body = { phone: national, country };
    await api.request('POST', '/phone/otp', { headers: { cookie: p.cookie }, body });
    advance(30);
    const early = await api.request('POST', '/phone/otp', { headers: { cookie: p.cookie }, body });
    expect(early.status).toBe(202);
    expect(early.json).toMatchObject({ code: 'OTP_SENT', values: { resendAfterS: 30 } });
    expect(guard.calls).toHaveLength(1);
    expect(phone.challengesOf(p.userId)).toHaveLength(1);
    advance(30);
    const late = await api.request('POST', '/phone/otp', { headers: { cookie: p.cookie }, body });
    expect(late.status).toBe(202);
    expect(guard.calls).toHaveLength(2);
    expect(phone.challengesOf(p.userId)).toHaveLength(2);
    record(api);
  });

  it('refus avant tout envoi : corps, pays, numéro (chiffres et exemple du pays), e-mail non vérifié, JSON exigé, session', async () => {
    const country = COUNTRIES[0] ?? '';
    const { api, h, phone, guard } = await app();
    const p = await person(api, h);
    const cases: [unknown, number, string][] = [
      [{ phone: '1', country, extra: true }, 400, 'REQUEST_INVALID'],
      [{ phone: nationalNumber(country), country: country.toLowerCase() }, 400, 'REQUEST_INVALID'],
      [{ phone: nationalNumber(country), country: 'ZZ' }, 400, 'COUNTRY_UNKNOWN'],
      [{ phone: '12', country }, 400, 'PHONE_INVALID'],
    ];
    for (const [body, status, code] of cases) {
      const r = await api.request('POST', '/phone/otp', { headers: { cookie: p.cookie }, body });
      expect(r.status, code).toBe(status);
      expect(r.json, code).toMatchObject({ code });
    }
    const invalid = await api.request('POST', '/phone/otp', {
      headers: { cookie: p.cookie },
      body: { phone: '12', country },
    });
    expect(invalid.json).toMatchObject({
      messageKey: 'common.error.phoneDigits',
      values: { digits: planOf(country).nationalLength, example: planOf(country).example },
    });
    // un numéro d'un autre pays configuré est refusé pour ce pays
    const other = COUNTRIES.find((c) => c !== country);
    if (other !== undefined) {
      const foreign = await api.request('POST', '/phone/otp', {
        headers: { cookie: p.cookie },
        body: { phone: e164(other, nationalNumber(other)), country },
      });
      expect(foreign.json).toMatchObject({ code: 'PHONE_INVALID' });
    }
    const pending = await person(api, h, { verified: false });
    const ne = await api.request('POST', '/phone/otp', {
      headers: { cookie: pending.cookie },
      body: { phone: nationalNumber(country), country },
    });
    expect(ne.status).toBe(403);
    expect(ne.json).toMatchObject({ code: 'PHONE_NOT_ELIGIBLE' });
    for (const path of ['/phone/otp', '/phone/verify']) {
      const notJson = await api.request('POST', path, {
        headers: { cookie: p.cookie, 'content-type': 'text/plain' },
        raw: 'x',
      });
      expect(notJson.status, path).toBe(415);
      const anonymous = await api.request('POST', path, { body: {} });
      expect(anonymous.status, path).toBe(401);
    }
    expect((await api.request('GET', '/phone')).status).toBe(401);
    for (const code of ['12345', '1234567', 'abcdef', 123456]) {
      const r = await api.request('POST', '/phone/verify', {
        headers: { cookie: p.cookie },
        body: { code },
      });
      expect(r.status).toBe(400);
      expect(r.json).toMatchObject({ code: 'REQUEST_INVALID' });
    }
    // aucun code demandé : rien à vérifier
    const none = await api.request('POST', '/phone/verify', {
      headers: { cookie: p.cookie },
      body: { code: '000000' },
    });
    expect(none.json).toMatchObject({ code: 'OTP_EXPIRED' });
    expect(guard.calls).toEqual([]);
    expect(phone.requests).toEqual([]);
    record(api);
  });

  it('plafonds anti-abus : refus ⇒ 429 RATE_LIMITED ou 503 RATE_LIMIT_UNAVAILABLE, aucun défi créé', async () => {
    const country = COUNTRIES[0] ?? '';
    const { api, h, phone, guard } = await app();
    const p = await person(api, h);
    for (const [refuse, status] of [
      ['RATE_LIMITED', 429],
      ['RATE_LIMIT_UNAVAILABLE', 503],
    ] as const) {
      guard.refuse = refuse;
      const r = await api.request('POST', '/phone/otp', {
        headers: { cookie: p.cookie },
        body: { phone: nationalNumber(country), country },
      });
      expect(r.status).toBe(status);
      expect(r.json).toMatchObject({ code: refuse });
    }
    expect(phone.challengesOf(p.userId)).toEqual([]);
    record(api);
  });

  it('fail-closed : clé RUEDA_OTP_KEY absente ou base indisponible ⇒ 503 OTP_UNAVAILABLE, rien ne part', async () => {
    const country = COUNTRIES[0] ?? '';
    const noKey = await app({ hasher: null });
    const p = await person(noKey.api, noKey.h);
    const a = await noKey.api.request('POST', '/phone/otp', {
      headers: { cookie: p.cookie },
      body: { phone: nationalNumber(country), country },
    });
    expect(a.status).toBe(503);
    expect(a.json).toMatchObject({ code: 'OTP_UNAVAILABLE' });
    const v = await noKey.api.request('POST', '/phone/verify', {
      headers: { cookie: p.cookie },
      body: { code: '123456' },
    });
    expect(v.status).toBe(503);
    expect(noKey.guard.calls).toEqual([]);
    record(noKey.api);

    const down = await app({ store: 'down' });
    const q = await person(down.api, down.h);
    for (const [method, path, body] of [
      ['GET', '/phone', undefined],
      ['POST', '/phone/otp', { phone: nationalNumber(country), country }],
      ['POST', '/phone/verify', { code: '123456' }],
    ] as const) {
      const r = await down.api.request(method, path, {
        headers: { cookie: q.cookie },
        ...(body !== undefined ? { body } : {}),
      });
      expect(r.status, path).toBe(503);
      expect(r.json, path).toMatchObject({ code: 'OTP_UNAVAILABLE' });
    }
    record(down.api);
  });

  it('paramètre du pays absent (otp_max_attempts) ⇒ 503 OTP_UNAVAILABLE (fail-closed)', async () => {
    const country = COUNTRIES[0] ?? '';
    expect(resolveParam(CONFIG, 'otp_max_attempts', { country, at: new Date() }).value).toBe(
      MAX_ATTEMPTS,
    );
    const { api, h, phone } = await app();
    const p = await person(api, h);
    phone.missingParam = 'otp_max_attempts';
    const r = await api.request('POST', '/phone/otp', {
      headers: { cookie: p.cookie },
      body: { phone: nationalNumber(country), country },
    });
    expect(r.status).toBe(503);
    expect(r.json).toMatchObject({ code: 'OTP_UNAVAILABLE' });
    record(api);
  });

  it('journaux : ni numéro, ni code, ni empreinte', async () => {
    const country = COUNTRIES[0] ?? '';
    const { api, h, phone } = await app();
    const p = await person(api, h);
    const national = nationalNumber(country);
    await api.request('POST', '/phone/otp', {
      headers: { cookie: p.cookie },
      body: { phone: national, country },
    });
    phone.issueLatest(p.userId, HASHER.hash('765432'));
    await api.request('POST', '/phone/verify', {
      headers: { cookie: p.cookie },
      body: { code: '765432' },
    });
    const out = h.output();
    expect(out).not.toContain(national.slice(-7));
    expect(out).not.toContain('765432');
    expect(out).not.toContain(HASHER.hash('765432').toString('hex'));
  });

  it('couverture : chaque statut déclaré pour /phone est exercé', () => {
    const declared = Object.entries(contract.document.paths)
      .filter(([template]) => template.startsWith('/phone'))
      .flatMap(([template, item]) =>
        Object.entries(item).flatMap(([method, op]) =>
          Object.keys(op.responses ?? {}).map((s) => `${method.toUpperCase()} ${template} ${s}`),
        ),
      );
    expect(declared.length).toBeGreaterThan(0);
    expect(declared.filter((d) => !covered.has(d))).toEqual([]);
  });
});
