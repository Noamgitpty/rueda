/**
 * US-102 — inscription avec consentements versionnés (16 ACC-001, LEG-001, LEG-002), sur le FAKE
 * du magasin (la même règle est imposée par la base : l0-ctr-consents) et un canal e-mail FAKE.
 *
 * - critère 1 : formulaire valide, CGU cochées ⇒ compte `PENDING_EMAIL`, consentements CGU et
 *   confidentialité à la version affichée, e-mail de vérification envoyé pendant la requête, dans
 *   la langue choisie (es, en, fr, pt), avec le lien ;
 * - critère 2 : CGU non cochées ⇒ `AUTH_TERMS_NOT_ACCEPTED` et aucun compte ; email existant ⇒
 *   même issue qu'un succès (aucune erreur, aucun second compte, message « compte existant ») ;
 * - opt-in marketing non pré-coché : absent ⇒ aucun consentement de communication ;
 * - version affichée périmée ou aucun document ⇒ refus AVANT l'email (même issue libre / pris).
 */
import { describe, expect, it } from 'vitest';
import { repositoryLocaleConfig } from '../../ntf/index.js';
import type { MessagingChannel, OutboundMessage } from '../../ntf/index.js';
import { FakeAuthStore } from '../testing/fake-auth-store.js';
import { FAST_HASHER } from '../testing/http-harness.js';
import { AuthService } from './auth.service.js';
import { ChannelIdentityNotifier } from './channel-notifier.js';
import { AuthHttpError } from './errors.js';
import { DEFAULT_AUTH_POLICY } from './policy.js';

const CTX = { ip: '203.0.113.9', userAgent: 'vitest' };
const BRAND = 'MarqueTest';
const WEB = new URL('https://web.example.test');

class RecordingChannel implements MessagingChannel {
  readonly channel = 'EMAIL' as const;
  readonly sent: { message: OutboundMessage; at: number }[] = [];
  outcome: 'OK' | 'UNAVAILABLE' = 'OK';
  send = (message: OutboundMessage) => {
    this.sent.push({ message, at: Date.now() });
    return Promise.resolve(
      this.outcome === 'OK'
        ? { status: 'OK' as const, value: { messageId: 'm1' }, replayed: false }
        : { status: 'UNAVAILABLE' as const },
    );
  };
}

function setup() {
  const store = new FakeAuthStore();
  const channel = new RecordingChannel();
  const notifier = new ChannelIdentityNotifier({
    channel,
    locales: repositoryLocaleConfig(),
    webBaseUrl: WEB,
    brand: BRAND,
  });
  const service = new AuthService(store, notifier, FAST_HASHER, DEFAULT_AUTH_POLICY, () =>
    Date.now(),
  );
  return { store, channel, service };
}

const form = (over: Record<string, unknown> = {}) => ({
  email: `ana-${Math.random().toString(36).slice(2)}@example.test`,
  password: 'Correct-Horse-9',
  legalFirstName: 'Ana',
  legalLastName: 'Pérez',
  locale: 'es',
  termsAccepted: true,
  acceptedDocuments: [
    { kind: 'TOS_GUEST', version: 1 },
    { kind: 'PRIVACY', version: 1 },
  ],
  ...over,
});

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return e instanceof AuthHttpError ? e.code : 'OTHER';
  }
};

// Langues et sujets attendus : catalogue 10b §4.3 / @rueda/i18n (relus, jamais calculés ici)
const SUBJECTS: Record<string, string> = {
  es: `Confirma tu correo en ${BRAND}`,
  en: `Confirm your email for ${BRAND}`,
  fr: `Confirme ton adresse e-mail sur ${BRAND}`,
  pt: `Confirme seu e-mail no ${BRAND}`,
};

describe('inscription avec consentements versionnés (US-102)', () => {
  it('critère 1 : compte PENDING_EMAIL, CGU et confidentialité à la version affichée, e-mail en ≤ 1 min', async () => {
    for (const locale of ['es', 'en', 'fr', 'pt']) {
      const { store, channel, service } = setup();
      const input = form({ locale });
      const started = Date.now();
      await service.signup(input, CTX);
      const account = [...store.accounts.values()][0];
      expect(account?.status).toBe('PENDING_EMAIL');
      expect(store.consents.map((c) => [c.kind, c.version, c.accepted])).toEqual([
        ['TOS_GUEST', 1, true],
        ['PRIVACY', 1, true],
      ]);
      expect(channel.sent).toHaveLength(1);
      const sent = channel.sent[0];
      // envoyé pendant la requête : bien en deçà de la minute exigée
      expect((sent?.at ?? Infinity) - started).toBeLessThan(60_000);
      expect(sent?.message.to).toBe(input.email);
      expect(sent?.message.subject).toBe(SUBJECTS[locale]);
      expect(sent?.message.body).toContain(`${WEB.origin}/verify-email?token=`);
      expect(sent?.message.templateKey).toBe('IAM_EMAIL_VERIFICATION');
    }
  });

  it('opt-in marketing : non pré-coché (absent ⇒ rien) ; coché ⇒ consentement versionné', async () => {
    const a = setup();
    await a.service.signup(form(), CTX);
    expect(a.store.consents.some((c) => c.kind === 'MARKETING')).toBe(false);
    const b = setup();
    await b.service.signup(form({ marketingOptIn: true }), CTX);
    expect(b.store.consents.filter((c) => c.kind === 'MARKETING')).toHaveLength(1);
    expect(await codeOf(b.service.signup(form({ marketingOptIn: 'oui' }), CTX))).toBe(
      'REQUEST_INVALID',
    );
  });

  it('critère 2 : CGU non cochées ⇒ AUTH_TERMS_NOT_ACCEPTED, aucun compte, aucun e-mail', async () => {
    const { store, channel, service } = setup();
    for (const termsAccepted of [false, 'true', undefined]) {
      expect(await codeOf(service.signup(form({ termsAccepted }), CTX))).toBe(
        'AUTH_TERMS_NOT_ACCEPTED',
      );
    }
    expect(store.accounts.size).toBe(0);
    expect(store.consents).toEqual([]);
    expect(channel.sent).toEqual([]);
  });

  it('critère 2 : email existant ⇒ même issue qu’un succès, aucun second compte ni consentement', async () => {
    const { store, channel, service } = setup();
    const input = form();
    expect(await codeOf(service.signup(input, CTX))).toBe('OK');
    expect(await codeOf(service.signup({ ...input, password: 'Other-Horse-9' }, CTX))).toBe('OK');
    expect(store.accounts.size).toBe(1);
    expect(store.consents).toHaveLength(2);
    expect(channel.sent.map((s) => s.message.templateKey)).toEqual([
      'IAM_EMAIL_VERIFICATION',
      'IAM_ACCOUNT_EXISTS',
    ]);
  });

  it('version affichée périmée ou aucun document : refus avant l’email, que l’email soit libre ou pris', async () => {
    const { store, service } = setup();
    const taken = form();
    await service.signup(taken, CTX);
    const stale = [
      { kind: 'TOS_GUEST', version: 1 },
      { kind: 'PRIVACY', version: 2 },
    ];
    expect(await codeOf(service.signup(form({ acceptedDocuments: stale }), CTX))).toBe(
      'TERMS_VERSION_CHANGED',
    );
    expect(await codeOf(service.signup({ ...taken, acceptedDocuments: stale }, CTX))).toBe(
      'TERMS_VERSION_CHANGED',
    );
    store.documentVersions = null;
    expect(await codeOf(service.signup(form(), CTX))).toBe('LEGAL_DOCUMENT_UNAVAILABLE');
    expect(await codeOf(service.signup(taken, CTX))).toBe('LEGAL_DOCUMENT_UNAVAILABLE');
    expect(store.accounts.size).toBe(1);
  });

  it('demande mal formée : versions, pays', async () => {
    const { service } = setup();
    for (const over of [
      { acceptedDocuments: [] },
      { acceptedDocuments: [{ kind: 'MARKETING', version: 1 }] },
      { acceptedDocuments: [{ kind: 'TOS_GUEST', version: '1' }] },
      { country: 'zz' },
      { country: 3 },
    ]) {
      expect(await codeOf(service.signup(form(over), CTX)), JSON.stringify(over)).toBe(
        'REQUEST_INVALID',
      );
    }
  });

  it('canal e-mail en panne : réponse inchangée (anti-énumération), compte en attente', async () => {
    const { store, channel, service } = setup();
    channel.outcome = 'UNAVAILABLE';
    expect(await codeOf(service.signup(form(), CTX))).toBe('OK');
    expect([...store.accounts.values()][0]?.status).toBe('PENDING_EMAIL');
  });

  it('le notificateur refuse un canal SMS et une URL avec identifiants', () => {
    const sms = { channel: 'SMS', send: () => Promise.reject(new Error('x')) } as const;
    expect(
      () =>
        new ChannelIdentityNotifier({
          channel: sms,
          locales: repositoryLocaleConfig(),
          webBaseUrl: WEB,
          brand: BRAND,
        }),
    ).toThrow();
    expect(
      () =>
        new ChannelIdentityNotifier({
          channel: new RecordingChannel(),
          locales: repositoryLocaleConfig(),
          webBaseUrl: new URL('https://u:p@web.example.test'),
          brand: BRAND,
        }),
    ).toThrow();
  });
});
