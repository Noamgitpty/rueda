/**
 * Preuves de la vérification du téléphone par OTP (US-104, migration 0066 ; fixtures 9995) sous
 * les rôles de production app_api et app_worker (assertion L0-05 en tête de chaque connexion,
 * withRole), au Panama (USD) et au Paraguay (PYG). Chaque test crée ses propres personnes par les
 * VRAIES commandes (inscription avec consentements, vérification d'e-mail, ouverture de session).
 *
 * Attendus tirés de 19 US-104 et de 16 VER-013, jamais du code testé :
 * - critère 1 : un code émis à 10:00 et saisi à 10:11 rend OTP_EXPIRED (valable 10 min) ;
 * - critère 1 : après 5 codes faux, un 6e (même juste) rend OTP_LOCKED, pour 1 h ;
 * - 16 VER-013 : numéro vérifié ailleurs ⇒ ACCOUNT_DUPLICATE_PHONE ; « non reçu → renvoi après
 *   60 s » ; États `verified_at` ; 17 §4.5 : `iam.phone.verified` (user_id, channel, line_type) ;
 *   17 §3.2.1 : `code_hash` [C4] (jamais lisible par un rôle applicatif), purge à 30 jours.
 * Durées, essais et blocage sont ceux de 16 VER-013 (10 min, 5 essais, 1 h, renvoi à 60 s), qui
 * sont aussi les valeurs des paramètres des deux pays (17 §7.2 « décidé »).
 *
 * Les empreintes de code sont des octets aléatoires : la base ne voit jamais un code, seulement
 * l'empreinte HMAC calculée par l'application (ADR-098) ; elle compare des empreintes.
 */
import { randomBytes, randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES, uuid } from '../support/avl.ts';
import { newToken, phcArgon2id, SESSION_TTL_S } from '../support/iam.ts';

const DOCS = '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]';
/** 16 VER-013. */
const TTL_MIN = 10;
const MAX_ATTEMPTS = 5;
const LOCK_MIN = 60;
const RESEND_S = 60;

/** Plan de numérotation des pays : données de configuration (jamais une constante du code). */
const NUMBERING = new Map(
  (
    JSON.parse(
      readFileSync(
        new URL('../../../../apps/api/src/modules/cfg/data/countries.json', import.meta.url),
        'utf8',
      ),
    ) as {
      countries: {
        code: string;
        phone: { callingCode: string; nationalLength: number; mobilePrefixes: string[] };
      }[];
    }
  ).countries.map((c) => [c.code, c.phone] as const),
);

/** Numéro de mobile fictif du pays, unique par appel. */
function phoneOf(country: string): string {
  const p = NUMBERING.get(country);
  if (p === undefined) throw new Error(`pays sans plan de numérotation : ${country}`);
  const prefix = p.mobilePrefixes[0] ?? '';
  let rest = '';
  while (rest.length < p.nationalLength - prefix.length) rest += String(randomInt(10));
  return `+${p.callingCode}${prefix}${rest}`;
}

const hash = (): Buffer => randomBytes(32);
const at = (base: Date, seconds: number): string =>
  new Date(base.getTime() + seconds * 1000).toISOString();

interface Person {
  readonly userId: string;
  readonly token: Buffer;
}

/** Personne inscrite par la vraie commande, e-mail vérifié (sauf demande), session ouverte. */
async function person(
  client: pg.ClientBase,
  country: string,
  options: { readonly verifyEmail?: boolean } = {},
): Promise<Person> {
  const userId = uuid();
  const verification = newToken();
  const r = await client.query<{ ok: boolean }>(
    `SELECT core.iam_cmd_register_with_consents($1, $2, $3, 'Ana', 'Pérez', 'es', $4, $5, 86400,
                                                NULL, $6, $7::jsonb, false) AS ok`,
    [userId, `otp-${userId}@example.test`, phcArgon2id(), uuid(), verification.hash, country, DOCS],
  );
  if (r.rows[0]?.ok !== true) throw new Error('inscription de test refusée');
  if (options.verifyEmail !== false) {
    const v = await client.query<{ ok: boolean }>('SELECT core.iam_cmd_verify_email($1) AS ok', [
      verification.hash,
    ]);
    if (v.rows[0]?.ok !== true) throw new Error('vérification d’e-mail refusée');
  }
  const t = newToken();
  const s = await client.query<{ expires_at: Date | null }>(
    `SELECT core.iam_cmd_open_session($1, $2, $3, $4, 'NONE', NULL, 'vitest') AS expires_at`,
    [uuid(), userId, t.hash, SESSION_TTL_S],
  );
  if (!s.rows[0]?.expires_at) throw new Error('session refusée');
  return { userId, token: t.hash };
}

interface Requested {
  readonly outcome: string;
  readonly challenge_id: string | null;
  readonly resend_after_s: number | null;
  readonly expires_in_s: number | null;
  readonly locked_for_s: number | null;
}

/** Transaction validée à l'instant `virtualNow` (horloge virtuelle des tests, 9000). */
const tx = <T>(client: pg.ClientBase, virtualNow: string, fn: () => Promise<T>): Promise<T> =>
  withTestTransaction(client, { virtualNow, commit: true }, fn);

async function request(
  client: pg.ClientBase,
  p: Person,
  phone: string,
  country: string,
  virtualNow: string,
): Promise<Requested> {
  return tx(client, virtualNow, async () => {
    const { rows } = await client.query<Requested>(
      'SELECT * FROM core.iam_cmd_phone_otp_request($1, $2, $3)',
      [p.token, phone, country],
    );
    return rows[0] as Requested;
  });
}

interface Verified {
  readonly outcome: string;
  readonly attempts_left: number | null;
  readonly locked_for_s: number | null;
}

async function verify(
  client: pg.ClientBase,
  p: Person,
  codeHash: Buffer,
  virtualNow: string,
): Promise<Verified> {
  return tx(client, virtualNow, async () => {
    const { rows } = await client.query<Verified>(
      'SELECT * FROM core.iam_cmd_phone_otp_verify($1, $2::bytea[])',
      [p.token, [codeHash]],
    );
    return rows[0] as Verified;
  });
}

interface Issued {
  readonly outcome: string;
  readonly phone_e164: string | null;
  readonly country_code: string | null;
  readonly locale: string | null;
  readonly expires_in_min: number | null;
}

/** Le travailleur `iam_otp_sender` dépose l'empreinte du code (app_worker, contexte posé). */
async function issue(
  challengeId: string,
  codeHash: Buffer,
  virtualNow: string,
  worker = 'iam_otp_sender',
): Promise<Issued> {
  return withRole('app_worker', (w) =>
    tx(w, virtualNow, async () => {
      await w.query(
        `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
                pg_catalog.set_config('app.worker_name', $1, true)`,
        [worker],
      );
      const { rows } = await w.query<Issued>('SELECT * FROM core.iam_worker_otp_issue($1, $2)', [
        challengeId,
        codeHash,
      ]);
      return rows[0] as Issued;
    }),
  );
}

interface ChallengeRow {
  readonly id: string;
  readonly phone_e164: string;
  readonly country_code: string;
  readonly channel: string;
  readonly purpose: string;
  readonly has_code: boolean;
  readonly issued: boolean;
  readonly attempts: number;
  readonly locked_until: Date | null;
  readonly consumed_at: Date | null;
  readonly expires_at: Date;
  readonly created_at: Date;
}

async function challenges(client: pg.ClientBase, userId: string): Promise<ChallengeRow[]> {
  const { rows } = await client.query<ChallengeRow>(
    'SELECT * FROM test_fixture.us104_challenges($1)',
    [userId],
  );
  return rows;
}

async function events(
  client: pg.ClientBase,
  aggregate: string,
): Promise<{ type: string; country_code: string; actor_user_id: string; payload: unknown }[]> {
  const { rows } = await client.query<{
    type: string;
    country_code: string;
    actor_user_id: string;
    payload: unknown;
  }>('SELECT * FROM test_fixture.us104_events($1)', [aggregate]);
  return rows;
}

async function accountPhone(
  client: pg.ClientBase,
  userId: string,
): Promise<{ phone_e164: string | null; phone_verified: boolean }> {
  const { rows } = await client.query<{ phone_e164: string | null; phone_verified: boolean }>(
    'SELECT * FROM test_fixture.us104_account_phone($1)',
    [userId],
  );
  return rows[0] as { phone_e164: string | null; phone_verified: boolean };
}

/** Instant de référence « 10:00 » : maintenant, à la seconde (la session de test est vivante). */
const tenOClock = (): Date => new Date(Math.floor(Date.now() / 1000) * 1000);

const byCountry = COUNTRIES.map((c) => [c.country, c.currency] as const);

describe('US-104 — demande et émission du code (asynchrone, sans code en clair)', () => {
  it.each(byCountry)(
    '%s (%s) : défi sans code, iam.otp.requested ne porte que l’identifiant ; le travailleur dépose l’empreinte',
    async (country) => {
      await withRole('app_api', async (client) => {
        const p = await person(client, country);
        const phone = phoneOf(country);
        const t0 = tenOClock();
        const r = await request(client, p, phone, country, at(t0, 0));
        expect(r).toMatchObject({
          outcome: 'SENT',
          resend_after_s: RESEND_S,
          expires_in_s: TTL_MIN * 60,
          locked_for_s: null,
        });
        const id = r.challenge_id as string;
        const [c] = await challenges(client, p.userId);
        expect(c).toMatchObject({
          id,
          phone_e164: phone,
          country_code: country,
          channel: 'SMS',
          purpose: 'PHONE_VERIFY',
          has_code: false,
          issued: false,
          attempts: 0,
          locked_until: null,
          consumed_at: null,
        });
        expect((c?.expires_at.getTime() ?? 0) - t0.getTime()).toBe(TTL_MIN * 60_000);
        const evts = await events(client, id);
        expect(evts).toEqual([
          {
            type: 'iam.otp.requested',
            aggregate_type: 'otp_challenge',
            country_code: country,
            actor_user_id: p.userId,
            actor_role: 'GUEST',
            payload: { challenge_id: id },
          },
        ]);
        // ni numéro ni code dans l'événement
        expect(JSON.stringify(evts)).not.toContain(phone.slice(1));

        const issued = await issue(id, hash(), at(t0, 2));
        expect(issued).toEqual({
          outcome: 'ISSUED',
          phone_e164: phone,
          country_code: country,
          locale: 'es',
          expires_in_min: TTL_MIN,
        });
        expect((await challenges(client, p.userId))[0]).toMatchObject({
          has_code: true,
          issued: true,
        });
        // tâche rejouée : rien n'est rendu, l'empreinte ne change pas
        expect((await issue(id, hash(), at(t0, 3))).outcome).toBe('ALREADY_ISSUED');
      });
    },
  );

  it('l’empreinte du code n’est lisible par aucun rôle applicatif ; les commandes sont réservées à leur rôle et à leur travailleur', async () => {
    const country = COUNTRIES[0].country;
    let challengeId = '';
    await withRole('app_api', async (client) => {
      const p = await person(client, country);
      const r = await request(client, p, phoneOf(country), country, tenOClock().toISOString());
      challengeId = r.challenge_id as string;
      await expect(
        client.query('SELECT code_hash FROM core.iam_otp_challenge'),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        client.query('SELECT * FROM core.iam_worker_otp_issue($1, $2)', [challengeId, hash()]),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(client.query('SELECT core.iam_worker_otp_prune(10)')).rejects.toMatchObject({
        code: '42501',
      });
    });
    await withRole('app_worker', async (w) => {
      await expect(w.query('SELECT code_hash FROM core.iam_otp_challenge')).rejects.toMatchObject({
        code: '42501',
      });
      await expect(
        w.query('SELECT * FROM core.iam_cmd_phone_otp_request($1, $2, $3)', [
          randomBytes(32),
          phoneOf(country),
          country,
        ]),
      ).rejects.toMatchObject({ code: '42501' });
    });
    // un autre nom de travailleur, ou aucun contexte : refus
    await expect(
      issue(challengeId, hash(), tenOClock().toISOString(), 'ntf_sender'),
    ).rejects.toMatchObject({ code: '42501' });
    await withRole('app_worker', async (w) => {
      await expect(
        w.query('SELECT * FROM core.iam_worker_otp_issue($1, $2)', [challengeId, hash()]),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it.each(byCountry)(
    '%s (%s) : renvoi refusé avant 60 s sur le même numéro (RESEND_WAIT, aucun défi), accepté après ; l’ancien défi n’est plus émis',
    async (country) => {
      await withRole('app_api', async (client) => {
        const p = await person(client, country);
        const phone = phoneOf(country);
        const t0 = tenOClock();
        const first = await request(client, p, phone, country, at(t0, 0));
        const early = await request(client, p, phone, country, at(t0, RESEND_S - 1));
        expect(early).toMatchObject({
          outcome: 'RESEND_WAIT',
          challenge_id: null,
          resend_after_s: 1,
        });
        expect(await challenges(client, p.userId)).toHaveLength(1);
        const later = await request(client, p, phone, country, at(t0, RESEND_S));
        expect(later.outcome).toBe('SENT');
        expect(await challenges(client, p.userId)).toHaveLength(2);
        expect(
          (await issue(first.challenge_id as string, hash(), at(t0, RESEND_S + 1))).outcome,
        ).toBe('SUPERSEDED');
      });
    },
  );
});

describe('US-104 critère 1 — durée de vie de 10 minutes', () => {
  it.each(byCountry)(
    '%s (%s) : code émis à 10:00, saisi à 10:11 ⇒ OTP_EXPIRED, aucun essai compté ; saisi à 10:09:59 ⇒ vérifié',
    async (country) => {
      await withRole('app_api', async (client) => {
        const t0 = tenOClock();
        // 10:11 : expiré
        const late = await person(client, country);
        const code = hash();
        const r = await request(client, late, phoneOf(country), country, at(t0, 0));
        await issue(r.challenge_id as string, code, at(t0, 1));
        expect(await verify(client, late, code, at(t0, 11 * 60))).toEqual({
          outcome: 'OTP_EXPIRED',
          attempts_left: null,
          locked_for_s: null,
        });
        expect((await challenges(client, late.userId))[0]?.attempts).toBe(0);
        expect((await accountPhone(client, late.userId)).phone_verified).toBe(false);

        // 10:09:59 : encore valable
        const inTime = await person(client, country);
        const phone = phoneOf(country);
        const code2 = hash();
        const r2 = await request(client, inTime, phone, country, at(t0, 0));
        await issue(r2.challenge_id as string, code2, at(t0, 1));
        expect((await verify(client, inTime, code2, at(t0, TTL_MIN * 60 - 1))).outcome).toBe(
          'PHONE_VERIFIED',
        );
        expect(await accountPhone(client, inTime.userId)).toEqual({
          phone_e164: phone,
          phone_verified: true,
        });
      });
    },
  );
});

describe('US-104 critère 1 — 5 codes faux, puis blocage d’une heure', () => {
  it.each(byCountry)(
    '%s (%s) : essais restants 4, 3, 2, 1, puis OTP_LOCKED ; le 6e, même juste, ⇒ OTP_LOCKED ; nouvelle demande refusée pendant 1 h, permise après',
    async (country) => {
      await withRole('app_api', async (client) => {
        const p = await person(client, country);
        const phone = phoneOf(country);
        const code = hash();
        const t0 = tenOClock();
        const r = await request(client, p, phone, country, at(t0, 0));
        await issue(r.challenge_id as string, code, at(t0, 1));
        for (let i = 1; i < MAX_ATTEMPTS; i++) {
          expect(await verify(client, p, hash(), at(t0, 10 + i))).toEqual({
            outcome: 'OTP_INVALID',
            attempts_left: MAX_ATTEMPTS - i,
            locked_for_s: null,
          });
        }
        expect(await verify(client, p, hash(), at(t0, 20))).toEqual({
          outcome: 'OTP_LOCKED',
          attempts_left: 0,
          locked_for_s: LOCK_MIN * 60,
        });
        // 6e saisie, le BON code : toujours bloqué
        const sixth = await verify(client, p, code, at(t0, 30));
        expect(sixth.outcome).toBe('OTP_LOCKED');
        expect(sixth.locked_for_s).toBe(LOCK_MIN * 60 - 10);
        expect((await accountPhone(client, p.userId)).phone_verified).toBe(false);
        // pas de contournement par un nouveau code pendant le blocage
        expect(await request(client, p, phone, country, at(t0, 40))).toMatchObject({
          outcome: 'LOCKED',
          challenge_id: null,
          locked_for_s: LOCK_MIN * 60 - 20,
        });
        expect(await request(client, p, phoneOf(country), country, at(t0, 50))).toMatchObject({
          outcome: 'LOCKED',
        });
        // après 1 h : un nouveau défi, compteur remis à zéro
        const after = await request(client, p, phone, country, at(t0, 20 + LOCK_MIN * 60));
        expect(after.outcome).toBe('SENT');
        expect((await challenges(client, p.userId)).at(-1)?.attempts).toBe(0);
      });
    },
  );

  it('un renvoi ne remet pas les échecs à zéro (report sur le nouveau défi)', async () => {
    const country = COUNTRIES[1].country;
    await withRole('app_api', async (client) => {
      const p = await person(client, country);
      const phone = phoneOf(country);
      const t0 = tenOClock();
      const r = await request(client, p, phone, country, at(t0, 0));
      await issue(r.challenge_id as string, hash(), at(t0, 1));
      for (let i = 1; i <= 3; i++) await verify(client, p, hash(), at(t0, 1 + i));
      const again = await request(client, p, phone, country, at(t0, RESEND_S + 5));
      expect(again.outcome).toBe('SENT');
      const code = hash();
      await issue(again.challenge_id as string, code, at(t0, RESEND_S + 6));
      expect(await verify(client, p, hash(), at(t0, RESEND_S + 7))).toMatchObject({
        outcome: 'OTP_INVALID',
        attempts_left: MAX_ATTEMPTS - 4,
      });
      expect((await verify(client, p, hash(), at(t0, RESEND_S + 8))).outcome).toBe('OTP_LOCKED');
    });
  });
});

describe('US-104 — numéro vérifié, unicité et énumération', () => {
  it.each(byCountry)(
    '%s (%s) : code juste ⇒ PHONE_VERIFIED, numéro posé, iam.phone.verified (user_id, channel, line_type) ; code réutilisé ⇒ OTP_EXPIRED',
    async (country) => {
      await withRole('app_api', async (client) => {
        const p = await person(client, country);
        const phone = phoneOf(country);
        const code = hash();
        const t0 = tenOClock();
        const r = await request(client, p, phone, country, at(t0, 0));
        await issue(r.challenge_id as string, code, at(t0, 1));
        expect((await verify(client, p, code, at(t0, 30))).outcome).toBe('PHONE_VERIFIED');
        expect(await accountPhone(client, p.userId)).toEqual({
          phone_e164: phone,
          phone_verified: true,
        });
        const verified = (await events(client, p.userId)).filter(
          (e) => e.type === 'iam.phone.verified',
        );
        expect(verified).toEqual([
          {
            type: 'iam.phone.verified',
            aggregate_type: 'user_account',
            country_code: country,
            actor_user_id: p.userId,
            actor_role: 'GUEST',
            payload: { user_id: p.userId, channel: 'SMS', line_type: null },
          },
        ]);
        expect((await verify(client, p, code, at(t0, 31))).outcome).toBe('OTP_EXPIRED');
        // ce numéro est déjà le sien : rien n'est envoyé
        expect((await request(client, p, phone, country, at(t0, 90))).outcome).toBe(
          'ALREADY_VERIFIED',
        );
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : numéro déjà vérifié par un autre compte ⇒ même réponse SENT qu’un numéro libre ; ACCOUNT_DUPLICATE_PHONE seulement après le code juste',
    async (country) => {
      await withRole('app_api', async (client) => {
        const t0 = tenOClock();
        const owner = await person(client, country);
        const phone = phoneOf(country);
        const code = hash();
        const r = await request(client, owner, phone, country, at(t0, 0));
        await issue(r.challenge_id as string, code, at(t0, 1));
        expect((await verify(client, owner, code, at(t0, 2))).outcome).toBe('PHONE_VERIFIED');

        const other = await person(client, country);
        const free = await person(client, country);
        const taken = await request(client, other, phone, country, at(t0, 10));
        const unknown = await request(client, free, phoneOf(country), country, at(t0, 10));
        const shape = (x: Requested) => ({ ...x, challenge_id: typeof x.challenge_id });
        expect(shape(taken)).toEqual(shape(unknown));
        expect(taken.outcome).toBe('SENT');

        // un code faux ne révèle rien non plus
        await issue(taken.challenge_id as string, code, at(t0, 11));
        expect((await verify(client, other, hash(), at(t0, 12))).outcome).toBe('OTP_INVALID');
        expect((await verify(client, other, code, at(t0, 13))).outcome).toBe(
          'ACCOUNT_DUPLICATE_PHONE',
        );
        expect((await accountPhone(client, other.userId)).phone_verified).toBe(false);
        expect(await accountPhone(client, owner.userId)).toEqual({
          phone_e164: phone,
          phone_verified: true,
        });
      });
    },
  );

  it('compte à e-mail non vérifié ⇒ NOT_ELIGIBLE, rien n’est écrit ; session invalide ⇒ AUTH_REQUIRED', async () => {
    const country = COUNTRIES[0].country;
    await withRole('app_api', async (client) => {
      const p = await person(client, country, { verifyEmail: false });
      expect(
        (await request(client, p, phoneOf(country), country, tenOClock().toISOString())).outcome,
      ).toBe('NOT_ELIGIBLE');
      expect(await challenges(client, p.userId)).toEqual([]);
      const stranger = { userId: uuid(), token: randomBytes(32) };
      expect(
        (await request(client, stranger, phoneOf(country), country, tenOClock().toISOString()))
          .outcome,
      ).toBe('AUTH_REQUIRED');
      expect((await verify(client, stranger, hash(), tenOClock().toISOString())).outcome).toBe(
        'AUTH_REQUIRED',
      );
      const { rows } = await client.query<{ outcome: string }>(
        'SELECT outcome FROM core.iam_phone_otp_state($1)',
        [stranger.token],
      );
      expect(rows).toEqual([{ outcome: 'AUTH_REQUIRED' }]);
      // numéro hors E.164 ou pays inconnu : refus, rien n'est écrit
      const ok = await person(client, country);
      expect(
        (await request(client, ok, '0612345678', country, tenOClock().toISOString())).outcome,
      ).toBe('REQUEST_INVALID');
      expect(
        (await request(client, ok, phoneOf(country), 'ZZ', tenOClock().toISOString())).outcome,
      ).toBe('COUNTRY_UNKNOWN');
      expect(await challenges(client, ok.userId)).toEqual([]);
    });
  });

  it('état du téléphone : numéro en attente, délais et essais restants de la seule personne de la session', async () => {
    const country = COUNTRIES[1].country;
    await withRole('app_api', async (client) => {
      const p = await person(client, country);
      const phone = phoneOf(country);
      const t0 = tenOClock();
      const r = await request(client, p, phone, country, at(t0, 0));
      await issue(r.challenge_id as string, hash(), at(t0, 1));
      await verify(client, p, hash(), at(t0, 2));
      const state = await tx(client, at(t0, 15), async () => {
        const { rows } = await client.query('SELECT * FROM core.iam_phone_otp_state($1)', [
          p.token,
        ]);
        return rows[0] as Record<string, unknown>;
      });
      expect(state).toEqual({
        outcome: 'OK',
        verified_phone: null,
        pending_phone: phone,
        resend_after_s: RESEND_S - 15,
        expires_in_s: TTL_MIN * 60 - 15,
        locked_for_s: null,
        attempts_left: MAX_ATTEMPTS - 1,
      });
    });
  });
});

describe('US-104 — purge à 30 jours (17 §3.2.1)', () => {
  it('le travailleur iam_otp_pruner supprime les défis de plus de 30 jours, pas les autres', async () => {
    const country = COUNTRIES[0].country;
    let userId = '';
    const t0 = tenOClock();
    await withRole('app_api', async (client) => {
      const p = await person(client, country);
      userId = p.userId;
      await request(client, p, phoneOf(country), country, at(t0, 0));
    });
    const prune = (virtualNow: string) =>
      withRole('app_worker', (w) =>
        tx(w, virtualNow, async () => {
          await w.query(
            `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
                    pg_catalog.set_config('app.worker_name', 'iam_otp_pruner', true)`,
          );
          const { rows } = await w.query<{ n: number }>(
            'SELECT core.iam_worker_otp_prune(10000) AS n',
          );
          return rows[0]?.n ?? -1;
        }),
      );
    await prune(at(t0, 29 * 86_400));
    await withRole('app_api', async (client) => {
      expect(await challenges(client, userId)).toHaveLength(1);
    });
    expect(await prune(at(t0, 31 * 86_400))).toBeGreaterThanOrEqual(1);
    await withRole('app_api', async (client) => {
      expect(await challenges(client, userId)).toEqual([]);
    });
  });
});
