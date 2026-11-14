/**
 * US-122 — red team du lot 1, axe OTP téléphone (RT-L1-A06, US-104) : force brute, contournement
 * du blocage, code d'un défi précédent, énumération de numéros, pompage de SMS. Rôles de
 * production seulement (assertion L0-05 par withRole : app_api, et app_worker pour le travailleur
 * d'émission), USD (PA) et PYG (PY). Rapport : docs/team/redteam/L1-rls-abus.md.
 *
 * Chaque test affirme que l'attaque est BLOQUÉE : un test rouge est une faille trouvée (jamais
 * `skip`), sauf le pompage de SMS, éprouvé en CARACTÉRISATION étiquetée « LIMITE DOCUMENTÉE » :
 * le plafond horaire par compte et par indicatif est appliqué par l'API (AbuseGuard, US-052,
 * `otp_rate_per_account_hour` = 5), pas par la base ; le test mesure ce que la base seule laisse
 * passer. Attendus : 16 VER-013 (10 min, 5 essais, blocage 1 h, renvoi à 60 s, « numéro vérifié
 * ailleurs » sans énumération), 17 §6.6 (plafonds), 19 US-104 ; pré-mortem L1-PM-06.
 */
import { randomBytes, randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { withRole, withTestTransaction } from '../../../src/testing/index.ts';
import { newToken, phcArgon2id, SESSION_TTL_S } from '../../support/iam.ts';
import { byCountry, otherOf, uuid } from './support.ts';

const DOCS = '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]';
/** 16 VER-013 : 5 essais ; renvoi du même numéro après 60 s ; durée de vie 10 min. */
const MAX_ATTEMPTS = 5;

const NUMBERING = new Map(
  (
    JSON.parse(
      readFileSync(
        new URL('../../../../../apps/api/src/modules/cfg/data/countries.json', import.meta.url),
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
const now = (): Date => new Date(Math.floor(Date.now() / 1000) * 1000);

interface Person {
  readonly userId: string;
  readonly token: Buffer;
}

/** Personne inscrite par la vraie commande, e-mail vérifié, session ouverte (téléphone non vérifié). */
async function person(client: pg.ClientBase, country: string): Promise<Person> {
  const userId = uuid();
  const verification = newToken();
  const r = await client.query<{ ok: boolean }>(
    `SELECT core.iam_cmd_register_with_consents($1, $2, $3, 'Ana', 'Pérez', 'es', $4, $5, 86400,
                                                NULL, $6, $7::jsonb, false) AS ok`,
    [
      userId,
      `rt-otp-${userId}@example.test`,
      phcArgon2id(),
      uuid(),
      verification.hash,
      country,
      DOCS,
    ],
  );
  if (r.rows[0]?.ok !== true) throw new Error('inscription de test refusée');
  const v = await client.query<{ ok: boolean }>('SELECT core.iam_cmd_verify_email($1) AS ok', [
    verification.hash,
  ]);
  if (v.rows[0]?.ok !== true) throw new Error('vérification d’e-mail refusée');
  return { userId, token: await session(client, userId) };
}

async function session(client: pg.ClientBase, userId: string): Promise<Buffer> {
  const t = newToken();
  const s = await client.query<{ expires_at: Date | null }>(
    `SELECT core.iam_cmd_open_session($1, $2, $3, $4, 'NONE', NULL, 'vitest') AS expires_at`,
    [uuid(), userId, t.hash, SESSION_TTL_S],
  );
  if (!s.rows[0]?.expires_at) throw new Error('session refusée');
  return t.hash;
}

/** Transaction validée à l'instant `virtualNow` (horloge virtuelle des tests). */
const tx = <T>(client: pg.ClientBase, virtualNow: string, fn: () => Promise<T>): Promise<T> =>
  withTestTransaction(client, { virtualNow, commit: true }, fn);

interface Requested {
  readonly outcome: string;
  readonly challenge_id: string | null;
  readonly locked_for_s: number | null;
}

const request = (
  client: pg.ClientBase,
  token: Buffer,
  phone: string,
  country: string,
  virtualNow: string,
): Promise<Requested> =>
  tx(client, virtualNow, async () => {
    const { rows } = await client.query<Requested>(
      'SELECT * FROM core.iam_cmd_phone_otp_request($1, $2, $3)',
      [token, phone, country],
    );
    return rows[0] as Requested;
  });

const verify = (
  client: pg.ClientBase,
  token: Buffer,
  codeHashes: readonly Buffer[],
  virtualNow: string,
): Promise<{ outcome: string; attempts_left: number | null }> =>
  tx(client, virtualNow, async () => {
    const { rows } = await client.query<{ outcome: string; attempts_left: number | null }>(
      'SELECT * FROM core.iam_cmd_phone_otp_verify($1, $2::bytea[])',
      [token, [...codeHashes]],
    );
    return rows[0] as { outcome: string; attempts_left: number | null };
  });

/** Le travailleur `iam_otp_sender` dépose l'empreinte du code (app_worker, contexte posé). */
const issue = (challengeId: string, codeHash: Buffer, virtualNow: string) =>
  withRole('app_worker', (w) =>
    tx(w, virtualNow, async () => {
      await w.query(
        `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
                pg_catalog.set_config('app.worker_name', 'iam_otp_sender', true)`,
      );
      const { rows } = await w.query<{ outcome: string }>(
        'SELECT * FROM core.iam_worker_otp_issue($1, $2)',
        [challengeId, codeHash],
      );
      return rows[0] as { outcome: string };
    }),
  );

async function phoneOfAccount(client: pg.ClientBase, userId: string) {
  const { rows } = await client.query<{ phone_e164: string | null; phone_verified: boolean }>(
    'SELECT * FROM test_fixture.us104_account_phone($1)',
    [userId],
  );
  return rows[0] as { phone_e164: string | null; phone_verified: boolean };
}

describe.each(byCountry)(
  'RT-L1-A06 — OTP : force brute et contournement du blocage (%s)',
  (country, _c, cc) => {
    it('5 codes faux puis le bon : OTP_LOCKED ; le blocage tient après une nouvelle session, un autre numéro et un autre pays', async () => {
      await withRole('app_api', async (client) => {
        const p = await person(client, country);
        const phone = phoneOf(country);
        const t0 = now();
        const r = await request(client, p.token, phone, country, at(t0, 0));
        expect(r.outcome).toBe('SENT');
        const code = hash();
        expect((await issue(r.challenge_id as string, code, at(t0, 1))).outcome).toBe('ISSUED');
        for (let i = 1; i <= MAX_ATTEMPTS; i += 1) {
          const w = await verify(client, p.token, [hash()], at(t0, 2 + i));
          expect(w.outcome, `essai faux n° ${i}`).toBe(
            i < MAX_ATTEMPTS ? 'OTP_INVALID' : 'OTP_LOCKED',
          );
        }
        // le bon code, après le blocage : refusé
        expect((await verify(client, p.token, [code], at(t0, 10))).outcome).toBe('OTP_LOCKED');
        // évasions : nouvelle session, nouvelle demande vers un autre numéro, vers l'autre pays
        const fresh = await session(client, p.userId);
        expect((await verify(client, fresh, [code], at(t0, 11))).outcome).toBe('OTP_LOCKED');
        for (const [number, where] of [
          [phoneOf(country), country],
          [phoneOf(otherOf(cc).country), otherOf(cc).country],
        ] as const) {
          const again = await request(client, fresh, number, where, at(t0, 12));
          expect(again.outcome, `redemande vers ${where}`).toBe('LOCKED');
        }
        expect((await phoneOfAccount(client, p.userId)).phone_verified).toBe(false);
      });
    });

    it('les essais faux se reportent sur un défi redemandé : aucune remise à zéro par un renvoi (4 faux, nouvelle demande, 1 faux ⇒ blocage)', async () => {
      await withRole('app_api', async (client) => {
        const p = await person(client, country);
        const t0 = now();
        const r1 = await request(client, p.token, phoneOf(country), country, at(t0, 0));
        await issue(r1.challenge_id as string, hash(), at(t0, 1));
        for (let i = 1; i < MAX_ATTEMPTS; i += 1) {
          expect((await verify(client, p.token, [hash()], at(t0, 1 + i))).outcome).toBe(
            'OTP_INVALID',
          );
        }
        // redemande (autre numéro : aucun délai de renvoi) ; le défi neuf ne remet pas les essais à zéro
        const r2 = await request(client, p.token, phoneOf(country), country, at(t0, 20));
        expect(r2.outcome).toBe('SENT');
        await issue(r2.challenge_id as string, hash(), at(t0, 21));
        expect((await verify(client, p.token, [hash()], at(t0, 22))).outcome).toBe('OTP_LOCKED');
      });
    });

    it('plus de deux empreintes par essai, ou une empreinte mal formée : refusé (aucune amplification des devinettes)', async () => {
      await withRole('app_api', async (client) => {
        const p = await person(client, country);
        const t0 = now();
        const r = await request(client, p.token, phoneOf(country), country, at(t0, 0));
        await issue(r.challenge_id as string, hash(), at(t0, 1));
        for (const hashes of [[hash(), hash(), hash()], [Buffer.alloc(31)], []]) {
          await expect(
            verify(client, p.token, hashes, at(t0, 2)),
            `${hashes.length} empreintes`,
          ).rejects.toMatchObject({ code: '22023' });
        }
      });
    });
  },
);

describe.each(byCountry)(
  'RT-L1-A06 — OTP : code d’un défi précédent, énumération (%s)',
  (country) => {
    it('le code du défi A ne valide pas le défi B (numéro d’autrui) : aucun numéro n’est posé', async () => {
      await withRole('app_api', async (client) => {
        const p = await person(client, country);
        const own = phoneOf(country);
        const victim = phoneOf(country);
        const t0 = now();
        const a = await request(client, p.token, own, country, at(t0, 0));
        const codeA = hash();
        await issue(a.challenge_id as string, codeA, at(t0, 1));
        // le défi B vise le numéro d'un tiers : le code de B part par SMS chez le tiers
        const b = await request(client, p.token, victim, country, at(t0, 2));
        expect(b.outcome).toBe('SENT');
        // l'attaquant ne connaît que le code A : il ne doit valider ni A (remplacé) ni B
        const attempt = await verify(client, p.token, [codeA], at(t0, 3));
        expect(attempt.outcome).not.toBe('PHONE_VERIFIED');
        expect(await phoneOfAccount(client, p.userId)).toEqual({
          phone_e164: null,
          phone_verified: false,
        });
      });
    });

    it('numéro déjà vérifié par un autre compte : même réponse qu’un numéro libre à la demande ; le code juste ne le lui donne jamais', async () => {
      await withRole('app_api', async (client) => {
        const owner = await person(client, country);
        const phone = phoneOf(country);
        const t0 = now();
        const ro = await request(client, owner.token, phone, country, at(t0, 0));
        const code = hash();
        await issue(ro.challenge_id as string, code, at(t0, 1));
        expect((await verify(client, owner.token, [code], at(t0, 2))).outcome).toBe(
          'PHONE_VERIFIED',
        );
        // second compte : demande du numéro vérifié ailleurs, puis d'un numéro libre
        const other = await person(client, country);
        const taken = await request(client, other.token, phone, country, at(t0, 3));
        const free = await request(client, other.token, phoneOf(country), country, at(t0, 4));
        expect(taken.outcome).toBe('SENT');
        expect(free.outcome).toBe(taken.outcome);
        // le propriétaire du numéro (code juste) ne prend pas la place du premier compte
        const codeB = hash();
        const again = await request(client, other.token, phone, country, at(t0, 200));
        await issue(again.challenge_id as string, codeB, at(t0, 201));
        expect((await verify(client, other.token, [codeB], at(t0, 202))).outcome).toBe(
          'ACCOUNT_DUPLICATE_PHONE',
        );
        expect((await phoneOfAccount(client, other.userId)).phone_verified).toBe(false);
        expect(await phoneOfAccount(client, owner.userId)).toMatchObject({
          phone_e164: phone,
          phone_verified: true,
        });
      });
    });

    it('code déjà consommé rejoué : jamais un second PHONE_VERIFIED', async () => {
      await withRole('app_api', async (client) => {
        const p = await person(client, country);
        const t0 = now();
        const r = await request(client, p.token, phoneOf(country), country, at(t0, 0));
        const code = hash();
        await issue(r.challenge_id as string, code, at(t0, 1));
        expect((await verify(client, p.token, [code], at(t0, 2))).outcome).toBe('PHONE_VERIFIED');
        expect((await verify(client, p.token, [code], at(t0, 3))).outcome).not.toBe(
          'PHONE_VERIFIED',
        );
      });
    });
  },
);

describe.each(byCountry)('RT-L1-A06 — OTP : pompage de SMS (%s) — LIMITE DOCUMENTÉE', (country) => {
  it('LIMITE DOCUMENTÉE : un compte qui change de numéro à chaque demande n’est pas plafonné PAR LA BASE (le plafond horaire est celui de l’API) ; mesure', async () => {
    await withRole('app_api', async (client) => {
      const p = await person(client, country);
      const t0 = now();
      const sent: string[] = [];
      for (let i = 0; i < 12; i += 1) {
        const r = await request(client, p.token, phoneOf(country), country, at(t0, i));
        sent.push(r.outcome);
      }
      // la base accepte les douze demandes (aucun plafond par compte et par heure en base) ; le
      // plafond de 5 (17 §6.6) est tenu par l'API, prouvé par ses propres tests. Défense en
      // profondeur absente : constat F-L1-OTP-01 (voir le rapport), pas un échec d'API.
      expect(sent.filter((o) => o === 'SENT').length).toBe(12);
      // le renvoi du MÊME numéro reste, lui, borné par la base (60 s, VER-013)
      const phone = phoneOf(country);
      expect((await request(client, p.token, phone, country, at(t0, 100))).outcome).toBe('SENT');
      expect((await request(client, p.token, phone, country, at(t0, 101))).outcome).toBe(
        'RESEND_WAIT',
      );
    });
  });
});
