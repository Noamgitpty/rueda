/**
 * US-045 — résilience du travailleur `iam_otp_sender` face au FAKE hostile RÉEL du canal SMS
 * (`FakeMessagingChannel` de `@rueda/fake-adapters`, mode scripté ; 17 §5 « SMS », §12
 * « Résilience » ; ADR-032 « mode hostile » ; ADR-058 ; US-104, ADR-098).
 *
 * Ce qui est prouvé, pour chaque pays de la configuration (numéro = exemple du plan du pays) :
 * - `UNAVAILABLE`, `TIMEOUT_BEFORE` : aucun SMS, échec journalisé (sans numéro ni code), AUCUNE
 *   nouvelle tentative par nous ; le code n'existe plus que par son empreinte (fail-closed : rien
 *   ne permet de vérifier le défi sans le code) ;
 * - `TIMEOUT_AFTER` : le SMS est parti une fois, issue journalisée `TIMEOUT`, aucun renvoi ;
 * - `DUPLICATE` : le fournisseur double le message ; nous ne l'avons demandé qu'UNE fois, avec la
 *   clé `otp:<défi>:<empreinte courte>` ;
 * - `DELAY` : envoi lent mais réussi, une fois ;
 * - événement rejoué (défi déjà émis) : aucun second code ni SMS pour le même défi ; après un COMMIT
 *   perdu, le rejeu porte un AUTRE code et une AUTRE clé (jamais l'ancien code rejoué) ;
 * - panne prolongée : chaque défi est tenté une fois, aucun SMS, aucun renvoi.
 *
 * Attendus tirés du contrat : en-tête de otp-sender.ts (« aucune nouvelle tentative : un échec du
 * canal est journalisé, le défi reste émis » ; clé d'idempotence ; défi déjà émis ⇒ rien n'est
 * envoyé), table de FakeRuntime (ADR-058). La transaction en mémoire reproduit l'issue documentée de
 * `core.iam_worker_otp_issue` (émis une fois, puis `ALREADY_ISSUED`). Jamais de l'instantané du
 * code. Heure virtuelle (FakeClock). Données fictives.
 */
import { describe, expect, it } from 'vitest';
import { FakeClock, FakeMessagingChannel } from '@rueda/fake-adapters';
import type { DomainEvent, SqlClient } from '../../../bus/index.js';
import { CountryConfigService } from '../../../cfg/index.js';
import { repositoryLocaleConfig } from '../../../ntf/index.js';
import { OtpCodeHasher } from './otp-code.js';
import { OtpSender } from './otp-sender.js';
import type { OtpLogEntry } from './otp-sender.js';
import { normalizePhone } from './phone-number.js';

const CONFIG = new CountryConfigService().config;
const COUNTRIES = [...CONFIG.countries.values()];
const KEY_HEX = '11'.repeat(32);
const HASHER = new OtpCodeHasher(Buffer.from(KEY_HEX, 'hex'));
const CHALLENGE = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5d';
// un code est tiré à chaque exécution, même rejouée (le défi déjà émis le refuse ensuite)
const CODES = ['048213', '731590', '506172', '264830', '918407', '375061'];

const event = (challengeId: string, country: string): DomainEvent =>
  ({
    eventId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c',
    type: 'iam.otp.requested',
    schemaVersion: 1,
    aggregateType: 'otp_challenge',
    aggregateId: challengeId,
    aggregateVersion: 0n,
    countryCode: country,
    actor: { userId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5e', role: 'GUEST' },
    correlationId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5f',
    causationId: null,
    payload: { challenge_id: challengeId },
    occurredAt: '2026-11-14T12:00:00.000Z',
    partitionKey: null,
  }) as unknown as DomainEvent;

/**
 * Défis en mémoire : `core.iam_worker_otp_issue` émet l'empreinte une seule fois par défi
 * (`ISSUED`), puis rend `ALREADY_ISSUED` (tâche rejouée). `loseCommit` simule une transaction
 * annulée après l'envoi : l'empreinte n'est pas restée.
 */
function challenges(phone: string, country: string) {
  const stored = new Map<string, Buffer>();
  let pendingCommit: string | null = null;
  const tx: SqlClient = {
    query: <R>(text: string, params?: readonly unknown[]) => {
      if (!text.includes('core.iam_worker_otp_issue')) throw new Error(`requête inattendue`);
      const [id, hash] = (params ?? []) as [string, Buffer];
      const row = stored.has(id)
        ? {
            outcome: 'ALREADY_ISSUED',
            phone_e164: null,
            country_code: null,
            locale: null,
            expires_in_min: null,
          }
        : {
            outcome: 'ISSUED',
            phone_e164: phone,
            country_code: country,
            locale: 'es',
            expires_in_min: 10,
          };
      if (!stored.has(id)) {
        stored.set(id, hash);
        pendingCommit = id;
      }
      return Promise.resolve({ rows: [row] as R[], rowCount: 1 });
    },
  } as SqlClient;
  return {
    tx,
    stored,
    loseCommit: () => {
      if (pendingCommit !== null) stored.delete(pendingCommit);
    },
  };
}

function setup(country: (typeof COUNTRIES)[number]) {
  const r = normalizePhone(country.phone.example, country.phone);
  if (!r.ok) throw new Error('exemple invalide');
  const clock = new FakeClock('2026-11-14T12:00:00Z');
  const sms = new FakeMessagingChannel({ clock, channel: 'SMS' });
  const logs: OtpLogEntry[] = [];
  const draws = [...CODES];
  const sender = new OtpSender({
    hasher: HASHER,
    sms,
    localeConfig: repositoryLocaleConfig(),
    countryOf: (c) => CONFIG.countries.get(c),
    brand: 'Marque de test',
    log: (e) => logs.push(e),
    draw: () => {
      const next = draws.shift();
      if (next === undefined) throw new Error('plus de code');
      return next;
    },
  });
  const db = challenges(r.e164, country.code);
  const run = (challengeId = CHALLENGE) => sender.handle(event(challengeId, country.code), db.tx);
  return { phone: r.e164, clock, sms, logs, sender, db, run };
}

const keyOf = (code: string, challengeId = CHALLENGE) =>
  `otp:${challengeId}:${HASHER.hash(code).subarray(0, 8).toString('hex')}`;

/** Ni le code ni le numéro (ni son empreinte) dans les journaux (17 §6.3). */
function expectCleanLogs(logs: readonly OtpLogEntry[], phone: string): void {
  const text = JSON.stringify(logs);
  for (const code of CODES) expect(text).not.toContain(code);
  expect(text).not.toContain(phone.slice(1));
  expect(text).not.toContain(HASHER.hash(CODES[0] as string).toString('hex'));
}

describe.each(COUNTRIES.map((c) => [c.code, c] as const))(
  'US-045 — OTP par SMS face au fournisseur hostile (%s)',
  (code, country) => {
    it.each([
      ['UNAVAILABLE', 'CHANNEL_UNAVAILABLE'],
      ['TIMEOUT_BEFORE', 'TIMEOUT'],
    ] as const)(
      '%s : aucun SMS, échec journalisé, aucune nouvelle tentative ; seule l’empreinte du code subsiste',
      async (kind, outcome) => {
        const w = setup(country);
        w.sms.runtime.script.script('send', { kind });
        await w.run();
        expect(w.sms.sent()).toEqual([]);
        expect(w.sms.runtime.script.calls('send')).toBe(1);
        expect(w.logs).toEqual([{ event: 'iam.otp.sms', outcome, country: code, reason: null }]);
        // fail-closed : le défi ne porte que l'empreinte du code tiré, jamais le code lui-même ;
        // aucun autre code ne le vérifie
        const stored = w.db.stored.get(CHALLENGE);
        expect(stored?.equals(HASHER.hash(CODES[0] as string))).toBe(true);
        expect(stored?.equals(HASHER.hash(CODES[1] as string))).toBe(false);
        // événement rejoué : défi déjà émis, aucun second envoi par nous
        await w.run();
        expect(w.sms.runtime.script.calls('send')).toBe(1);
        expect(w.sms.sent()).toEqual([]);
        expect(w.logs[1]).toMatchObject({ outcome: 'SKIPPED', reason: 'ALREADY_ISSUED' });
        expectCleanLogs(w.logs, w.phone);
      },
    );

    it('TIMEOUT_AFTER : le SMS est parti une fois, issue journalisée TIMEOUT, aucun renvoi', async () => {
      const w = setup(country);
      w.sms.runtime.script.script('send', { kind: 'TIMEOUT_AFTER' });
      await w.run();
      expect(w.sms.sent()).toHaveLength(1);
      expect(w.sms.sent()[0]).toMatchObject({
        to: w.phone,
        idempotencyKey: keyOf(CODES[0] as string),
      });
      expect(w.logs).toEqual([
        { event: 'iam.otp.sms', outcome: 'TIMEOUT', country: code, reason: null },
      ]);
      await w.run();
      expect(w.sms.runtime.script.calls('send')).toBe(1);
      expect(w.sms.sent()).toHaveLength(1);
      expectCleanLogs(w.logs, w.phone);
    });

    it('DUPLICATE : le fournisseur double le message ; nous ne l’avons demandé qu’une fois, même clé', async () => {
      const w = setup(country);
      w.sms.runtime.script.script('send', { kind: 'DUPLICATE' });
      await w.run();
      await w.run(); // événement rejoué
      expect(w.sms.runtime.script.calls('send')).toBe(1);
      const copies = w.sms.sent();
      expect(copies).toHaveLength(2);
      expect(new Set(copies.map((m) => m.idempotencyKey))).toEqual(
        new Set([keyOf(CODES[0] as string)]),
      );
      // même code dans les deux copies : aucun second code émis pour le défi
      for (const m of copies) expect(m.body).toContain(CODES[0]);
      expect(w.logs.map((l) => l.outcome)).toEqual(['SENT', 'SKIPPED']);
      expectCleanLogs(w.logs, w.phone);
    });

    it('DELAY : envoi lent mais réussi, une seule fois (heure virtuelle)', async () => {
      const w = setup(country);
      const before = w.clock.nowMs();
      w.sms.runtime.script.script('send', { kind: 'DELAY', ms: 20_000 });
      await w.run();
      expect(w.clock.nowMs()).toBe(before + 20_000);
      expect(w.sms.sent()).toHaveLength(1);
      expect(w.logs.map((l) => l.outcome)).toEqual(['SENT']);
    });

    it('COMMIT perdu après TIMEOUT_AFTER : le rejeu porte un autre code et une autre clé, l’ancien code ne vérifie plus', async () => {
      const w = setup(country);
      w.sms.runtime.script.script('send', { kind: 'TIMEOUT_AFTER' });
      await w.run();
      w.db.loseCommit();
      await w.run();
      const sent = w.sms.sent();
      expect(sent.map((m) => m.idempotencyKey)).toEqual([
        keyOf(CODES[0] as string),
        keyOf(CODES[1] as string),
      ]);
      expect(sent[1]?.body).toContain(CODES[1]);
      expect(sent[1]?.body).not.toContain(CODES[0]);
      const stored = w.db.stored.get(CHALLENGE);
      expect(stored?.equals(HASHER.hash(CODES[1] as string))).toBe(true);
      expect(stored?.equals(HASHER.hash(CODES[0] as string))).toBe(false);
    });

    it('panne prolongée (UNAVAILABLE par défaut) : chaque défi tenté une fois, aucun SMS, aucun renvoi', async () => {
      const w = setup(country);
      w.sms.runtime.script.setDefault('send', { kind: 'UNAVAILABLE' });
      const ids = [
        CHALLENGE,
        '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a60',
        '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a61',
      ];
      for (const id of ids) {
        await w.run(id);
        await w.run(id); // rejeu de chaque événement
        w.clock.advance(60_000);
      }
      expect(w.sms.sent()).toEqual([]);
      expect(w.sms.runtime.script.calls('send')).toBe(ids.length);
      expect(w.logs.map((l) => l.outcome)).toEqual([
        'CHANNEL_UNAVAILABLE',
        'SKIPPED',
        'CHANNEL_UNAVAILABLE',
        'SKIPPED',
        'CHANNEL_UNAVAILABLE',
        'SKIPPED',
      ]);
      expectCleanLogs(w.logs, w.phone);
    });
  },
);
