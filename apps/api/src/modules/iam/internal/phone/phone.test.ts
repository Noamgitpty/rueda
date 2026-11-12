/**
 * US-104 — primitives de l'OTP du téléphone (sans base) : normalisation E.164 d'après le plan de
 * numérotation de chaque pays configuré (PA, PY), tirage et empreinte du code, travailleur
 * `iam_otp_sender` (asynchrone, sans code en clair hors de sa mémoire), contrôle bloquant du
 * paiement. Attendus : 16 VER-013 (« code 6 chiffres », « saisie E.164 »), 10b W3 et §4.3
 * (`common.error.phoneDigits`, exemple du pays), 17 §6.3 (journaux sans donnée personnelle) ; pays
 * et plans lus dans la configuration, jamais des constantes du code.
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { CATALOGS } from '@rueda/i18n';
import type { DomainEvent, SqlClient } from '../../../bus/index.js';
import { CountryConfigService } from '../../../cfg/index.js';
import { repositoryLocaleConfig } from '../../../ntf/index.js';
import type { MessagingChannel, OutboundMessage } from '../../../ntf/index.js';
import { AuthHttpError } from '../errors.js';
import {
  drawOtpCode,
  isOtpCode,
  OtpCodeHasher,
  otpHasherFromEnv,
  parseOtpKey,
} from './otp-code.js';
import { OtpSender, otpLocale } from './otp-sender.js';
import type { OtpLogEntry } from './otp-sender.js';
import { maskPhone, normalizePhone } from './phone-number.js';
import { PhoneVerifiedGuard } from './phone-verified.guard.js';
import type { PhoneVerificationService } from './phone-verification.service.js';

const CONFIG = new CountryConfigService().config;
const COUNTRIES = [...CONFIG.countries.values()];
const KEY_HEX = '11'.repeat(32);

describe('normalisation E.164 (plan de numérotation du pays, configuration)', () => {
  it.each(COUNTRIES.map((c) => [c.code, c] as const))(
    '%s : exemple affiché, forme internationale, préfixe interurbain, séparateurs ; mobiles du pays seulement',
    (_code, country) => {
      const plan = country.phone;
      const example = normalizePhone(plan.example, plan);
      expect(example.ok).toBe(true);
      if (!example.ok) return;
      expect(example.e164).toMatch(
        new RegExp(`^\\+${plan.callingCode}[0-9]{${plan.nationalLength}}$`),
      );
      expect(example.prefix).toBe(`+${plan.callingCode}`);
      const national = example.e164.slice(plan.callingCode.length + 1);
      for (const input of [
        example.e164,
        `00${plan.callingCode}${national}`,
        `+${plan.callingCode} ${national.slice(0, 4)}-${national.slice(4)}`,
        `(${national.slice(0, 3)}) ${national.slice(3)}`,
        ...(plan.trunkPrefix === null ? [] : [`${plan.trunkPrefix}${national}`]),
      ]) {
        expect(normalizePhone(input, plan), input).toEqual(example);
      }
      // longueur, premier chiffre (fixe), lettres, autre indicatif, valeurs non textuelles
      const wrongPrefix = `${'0'}${national.slice(1)}`;
      for (const input of [
        national.slice(1),
        `${national}0`,
        wrongPrefix,
        `${national.slice(0, 3)}abc${national.slice(6)}`,
        `+1${national}`,
        '',
        '+'.repeat(40),
      ]) {
        expect(normalizePhone(input, plan).ok, input).toBe(false);
      }
      expect(normalizePhone(12345678, plan).ok).toBe(false);
      expect(normalizePhone(null, plan).ok).toBe(false);
    },
  );

  it('un numéro d’un pays configuré est refusé sous le plan d’un autre', () => {
    const [a, b] = COUNTRIES;
    if (a === undefined || b === undefined) return;
    const fromA = normalizePhone(a.phone.example, a.phone);
    expect(fromA.ok).toBe(true);
    if (fromA.ok) expect(normalizePhone(fromA.e164, b.phone).ok).toBe(false);
  });

  it('masquage : indicatif et deux derniers chiffres seulement', () => {
    for (const c of COUNTRIES) {
      const r = normalizePhone(c.phone.example, c.phone);
      if (!r.ok) throw new Error('exemple invalide');
      const masked = maskPhone(r.e164, c.phone);
      expect(masked.startsWith(`+${c.phone.callingCode} `)).toBe(true);
      expect(masked.endsWith(r.e164.slice(-2))).toBe(true);
      expect(masked.replace(/[^0-9]/g, '')).toBe(`${c.phone.callingCode}${r.e164.slice(-2)}`);
    }
  });
});

describe('code et empreinte', () => {
  it('clé : absente ⇒ null (OTP indisponible) ; mal formée ⇒ refus ; 32 à 64 octets hexadécimaux', () => {
    expect(parseOtpKey(undefined)).toBeNull();
    expect(parseOtpKey('')).toBeNull();
    expect(otpHasherFromEnv({})).toBeNull();
    for (const bad of ['zz'.repeat(32), '11'.repeat(31), '11'.repeat(65), '1'.repeat(65)]) {
      expect(() => parseOtpKey(bad)).toThrow(/RUEDA_OTP_KEY/);
    }
    expect(parseOtpKey(KEY_HEX)?.length).toBe(32);
    expect(otpHasherFromEnv({ RUEDA_OTP_KEY: KEY_HEX })).toBeInstanceOf(OtpCodeHasher);
  });

  it('tirage : 6 chiffres, zéros de tête compris, uniformité grossière sur 20 000 tirages', () => {
    const firstDigit = new Array<number>(10).fill(0);
    const seen = new Set<string>();
    for (let i = 0; i < 20_000; i++) {
      const c = drawOtpCode();
      expect(isOtpCode(c)).toBe(true);
      seen.add(c);
      firstDigit[Number(c[0])] = (firstDigit[Number(c[0])] ?? 0) + 1;
    }
    // 10 % attendus par premier chiffre (zéros de tête compris) ; tolérance large
    for (const n of firstDigit) expect(n).toBeGreaterThan(1_600);
    expect(seen.size).toBeGreaterThan(19_000);
  });

  it('empreinte HMAC-SHA-256 sous la clé, séparation de domaine ; code mal formé refusé', () => {
    const key = Buffer.from(KEY_HEX, 'hex');
    const h = new OtpCodeHasher(key);
    const expected = createHmac('sha256', key).update('rueda-otp-v1\u0000012345', 'utf8').digest();
    expect(h.hash('012345').equals(expected)).toBe(true);
    expect(h.hash('012345').length).toBe(32);
    expect(h.hash('012345').equals(new OtpCodeHasher(Buffer.alloc(32, 2)).hash('012345'))).toBe(
      false,
    );
    for (const bad of ['12345', '1234567', 'abcdef', ' 12345']) {
      expect(() => h.hash(bad)).toThrow();
    }
    expect(() => new OtpCodeHasher(Buffer.alloc(16))).toThrow();
  });
});

/** Transaction enregistreuse : rend l'issue voulue de `core.iam_worker_otp_issue`. */
function issueTx(row: Record<string, unknown> | null) {
  const calls: { text: string; params: readonly unknown[] }[] = [];
  const tx: SqlClient = {
    query: <R>(text: string, params?: readonly unknown[]) => {
      calls.push({ text, params: params ?? [] });
      return Promise.resolve({ rows: (row === null ? [] : [row]) as R[], rowCount: 1 });
    },
  } as SqlClient;
  return { tx, calls };
}

function recordingSms(status: 'OK' | 'UNAVAILABLE' | 'TIMEOUT' = 'OK') {
  const sent: OutboundMessage[] = [];
  const channel: MessagingChannel = {
    channel: 'SMS',
    send: (message) => {
      sent.push(message);
      return Promise.resolve(
        status === 'OK'
          ? { status: 'OK', value: { messageId: 'm-1' }, replayed: false }
          : { status },
      );
    },
  };
  return { channel, sent };
}

const event = (payload: Record<string, unknown>, country: string): DomainEvent =>
  ({
    eventId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c',
    type: 'iam.otp.requested',
    schemaVersion: 1,
    aggregateType: 'otp_challenge',
    aggregateId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5d',
    aggregateVersion: 0n,
    countryCode: country,
    actor: { userId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5e', role: 'GUEST' },
    correlationId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5f',
    causationId: null,
    payload,
    occurredAt: new Date().toISOString(),
    partitionKey: null,
  }) as unknown as DomainEvent;

describe('travailleur iam_otp_sender (asynchrone)', () => {
  const challengeId = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5d';
  const hasher = new OtpCodeHasher(Buffer.from(KEY_HEX, 'hex'));

  it.each(COUNTRIES.map((c) => [c.code, c] as const))(
    '%s : code tiré, empreinte déposée, SMS dans la langue du compte ; journal sans numéro ni code',
    async (code, country) => {
      const r = normalizePhone(country.phone.example, country.phone);
      if (!r.ok) throw new Error('exemple invalide');
      const { tx, calls } = issueTx({
        outcome: 'ISSUED',
        phone_e164: r.e164,
        country_code: code,
        locale: 'fr',
        expires_in_min: 10,
      });
      const sms = recordingSms();
      const logs: OtpLogEntry[] = [];
      const sender = new OtpSender({
        hasher,
        sms: sms.channel,
        localeConfig: repositoryLocaleConfig(),
        countryOf: (c) => CONFIG.countries.get(c),
        brand: 'Marque de test',
        log: (e) => logs.push(e),
        draw: () => '048213',
      });
      await sender.handle(event({ challenge_id: challengeId }, code), tx);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.params[0]).toBe(challengeId);
      expect((calls[0]?.params[1] as Buffer).equals(hasher.hash('048213'))).toBe(true);
      expect(sms.sent).toHaveLength(1);
      const m = sms.sent[0];
      expect(m?.to).toBe(r.e164);
      expect(m?.channel).toBe('SMS');
      expect(m?.locale).toBe(otpLocale('fr', country));
      expect(m?.body).toContain('048213');
      expect(m?.body).toContain('Marque de test');
      expect(m?.idempotencyKey).toBe(
        `otp:${challengeId}:${hasher.hash('048213').subarray(0, 8).toString('hex')}`,
      );
      expect(logs).toEqual([
        { event: 'iam.otp.sms', outcome: 'SENT', country: code, reason: null },
      ]);
      expect(JSON.stringify(logs)).not.toContain('048213');
      expect(JSON.stringify(logs)).not.toContain(r.e164.slice(1));
    },
  );

  it('langue du SMS : celle du compte si le pays la propose, sinon la langue par défaut du pays', () => {
    for (const c of COUNTRIES) {
      expect(otpLocale(null, c)).toBe(c.defaultLocale);
      expect(otpLocale('xx', c)).toBe(c.defaultLocale);
      for (const tag of c.locales) expect(otpLocale(tag, c)).toBe(tag);
    }
  });

  it('défi non émis (rejoué, expiré, bloqué, remplacé) : aucun SMS ; clé ou canal absent : rien n’est émis', async () => {
    const country = COUNTRIES[0];
    if (country === undefined) return;
    for (const outcome of ['ALREADY_ISSUED', 'EXPIRED', 'LOCKED', 'SUPERSEDED', 'GONE']) {
      const { tx } = issueTx({
        outcome,
        phone_e164: null,
        country_code: null,
        locale: null,
        expires_in_min: null,
      });
      const sms = recordingSms();
      const logs: OtpLogEntry[] = [];
      await new OtpSender({
        hasher,
        sms: sms.channel,
        localeConfig: repositoryLocaleConfig(),
        countryOf: (c) => CONFIG.countries.get(c),
        brand: 'x',
        log: (e) => logs.push(e),
      }).handle(event({ challenge_id: challengeId }, country.code), tx);
      expect(sms.sent).toEqual([]);
      expect(logs).toEqual([
        { event: 'iam.otp.sms', outcome: 'SKIPPED', country: country.code, reason: outcome },
      ]);
    }
    for (const [h, withSms, reason] of [
      [null, true, 'OTP_KEY_MISSING'],
      [hasher, false, 'CHANNEL_MISSING'],
    ] as const) {
      const { tx, calls } = issueTx(null);
      const sms = recordingSms();
      const logs: OtpLogEntry[] = [];
      await new OtpSender({
        hasher: h,
        sms: withSms ? sms.channel : null,
        localeConfig: repositoryLocaleConfig(),
        countryOf: (c) => CONFIG.countries.get(c),
        brand: 'x',
        log: (e) => logs.push(e),
      }).handle(event({ challenge_id: challengeId }, country.code), tx);
      expect(calls).toEqual([]);
      expect(sms.sent).toEqual([]);
      expect(logs[0]).toMatchObject({ outcome: 'NOT_SENT', reason });
    }
  });

  it('canal en échec : journalisé, aucune nouvelle tentative (le voyageur redemande après le délai)', async () => {
    const country = COUNTRIES[0];
    if (country === undefined) return;
    const r = normalizePhone(country.phone.example, country.phone);
    if (!r.ok) return;
    for (const status of ['UNAVAILABLE', 'TIMEOUT'] as const) {
      const { tx } = issueTx({
        outcome: 'ISSUED',
        phone_e164: r.e164,
        country_code: country.code,
        locale: 'es',
        expires_in_min: 10,
      });
      const sms = recordingSms(status);
      const logs: OtpLogEntry[] = [];
      await new OtpSender({
        hasher,
        sms: sms.channel,
        localeConfig: repositoryLocaleConfig(),
        countryOf: (c) => CONFIG.countries.get(c),
        brand: 'x',
        log: (e) => logs.push(e),
      }).handle(event({ challenge_id: challengeId }, country.code), tx);
      expect(logs[0]?.outcome).toBe(status === 'UNAVAILABLE' ? 'CHANNEL_UNAVAILABLE' : 'TIMEOUT');
    }
  });

  it('contrat de l’événement rompu (challenge_id absent ou non UUID) : erreur, jamais un envoi', async () => {
    const sms = recordingSms();
    const sender = new OtpSender({
      hasher,
      sms: sms.channel,
      localeConfig: repositoryLocaleConfig(),
      countryOf: (c) => CONFIG.countries.get(c),
      brand: 'x',
      log: () => undefined,
    });
    for (const payload of [{}, { challenge_id: 'x' }, { challenge_id: 12 }]) {
      await expect(sender.handle(event(payload, 'ZZ'), issueTx(null).tx)).rejects.toThrow();
    }
    expect(sms.sent).toEqual([]);
  });

  it('SMS rendu dans les quatre langues, sans emplacement résiduel', () => {
    for (const language of ['es', 'en', 'fr', 'pt'] as const) {
      const text = CATALOGS[language].messages['common.otp.sms'];
      expect(text).toContain('{code}');
      expect(text).toContain('{minutes}');
      expect(text).toContain('{brand}');
    }
  });
});

describe('contrôle bloquant du paiement (US-104 critère 2, US-209)', () => {
  const ctx = (cookie?: string): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ headers: cookie === undefined ? {} : { cookie } }),
      }),
    }) as unknown as ExecutionContext;
  const cookie = `__Host-session=${'a'.repeat(43)}`;

  it('numéro non vérifié ⇒ 403 PHONE_NOT_VERIFIED ; vérifié ⇒ passe ; sans session ⇒ refus', async () => {
    const service = (verified: boolean) =>
      ({
        isVerified: (proof: Buffer | null) => Promise.resolve(proof !== null && verified),
      }) as unknown as PhoneVerificationService;
    await expect(
      new PhoneVerifiedGuard(service(false)).canActivate(ctx(cookie)),
    ).rejects.toMatchObject({ code: 'PHONE_NOT_VERIFIED' });
    await expect(new PhoneVerifiedGuard(service(true)).canActivate(ctx(cookie))).resolves.toBe(
      true,
    );
    await expect(new PhoneVerifiedGuard(service(true)).canActivate(ctx())).rejects.toBeInstanceOf(
      AuthHttpError,
    );
  });

  it('état illisible ⇒ refus (fail-closed), jamais un passage', async () => {
    const down = {
      isVerified: () => Promise.reject(new AuthHttpError('OTP_UNAVAILABLE')),
    } as unknown as PhoneVerificationService;
    await expect(new PhoneVerifiedGuard(down).canActivate(ctx(cookie))).rejects.toMatchObject({
      code: 'OTP_UNAVAILABLE',
    });
  });
});
