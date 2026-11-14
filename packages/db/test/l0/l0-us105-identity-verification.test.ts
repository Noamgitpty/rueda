/**
 * Preuves de la vérification d'identité par parcours hébergé et du consentement biométrique
 * (US-105, migration 0072 ; fixtures 9996) sous les rôles de production app_api et app_worker
 * (assertion L0-05 en tête de chaque connexion, withRole), au Panama (USD) et au Paraguay (PYG).
 * Chaque test crée ses propres personnes par les VRAIES commandes (inscription avec consentements,
 * vérification d’e-mail, session) ; le téléphone vérifié est posé par la fixture 9996.
 *
 * Attendus tirés de 19 US-105, de 16 VER-001 / VER-002 / VER-004 et de 17, jamais du code testé :
 * - critère 1 : `DOCS_SUBMITTED`, rappel signé « approved » reçu deux fois ⇒ une seule transition
 *   `APPROVED` (17 §4.5 : un événement `kyc.verification.status_changed` vers APPROVED) ;
 *   signature invalide ⇒ rejet journalisé ;
 * - critère 2 : aucun consentement biométrique ⇒ KYC_BIOMETRIC_CONSENT_MISSING et aucune
 *   session (aucune ligne de vérification) ; VER-004 : une nouvelle version du texte exige une
 *   nouvelle acceptation ;
 * - critère 3 : permis expirant avant la fin du trip ⇒ KYC_LICENSE_EXPIRED ;
 * - critère 4 : aucune image copiée chez nous : scores et référence seulement (17 §1.5 point 3,
 *   §3.2.2) ;
 * - 17 §7.2 : rétention des scores = décision + `biometric_appeal_retention_days` du pays
 *   (valeur des données CFG ; pays sans valeur : la plus courte, 0 jour, OQ-BR-25).
 */
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES, uuid } from '../support/avl.ts';
import { newToken, phcArgon2id, SESSION_TTL_S } from '../support/iam.ts';

const DOCS = '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]';
const PROVIDER = 'FAKE';
const DAY_MS = 86_400_000;

const cfg = (file: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(`../../../../apps/api/src/modules/cfg/data/${file}`, import.meta.url),
      'utf8',
    ),
  );

/** Plan de numérotation des pays : données de configuration (jamais une constante du code). */
const NUMBERING = new Map(
  (
    cfg('countries.json') as {
      countries: {
        code: string;
        phone: { callingCode: string; nationalLength: number; mobilePrefixes: string[] };
      }[];
    }
  ).countries.map((c) => [c.code, c.phone] as const),
);

/**
 * Décalage UTC courant de chaque pays, en minutes : dernier contrôle tzdata des données CFG
 * (`timeZoneChecks`, 17 §1.3, ADR-019 ; Panama UTC−5, Paraguay UTC−3 permanent, Ley 7354/2024).
 * Oracle des bornes du permis, indépendant de l'expression SQL testée.
 */
const UTC_OFFSET_MIN = new Map(
  (
    cfg('countries.json') as {
      countries: { code: string; timeZoneChecks: { offsetMinutes: number }[] }[];
    }
  ).countries.map((c) => [c.code, c.timeZoneChecks.at(-1)?.offsetMinutes ?? 0] as const),
);

/** 17 §7.2 `biometric_appeal_retention_days` par pays (données CFG). */
const RETENTION_DAYS = new Map(
  Object.entries(
    (
      cfg('params.json') as { params: { key: string; values?: Record<string, number> }[] }
    ).params.find((p) => p.key === 'biometric_appeal_retention_days')?.values ?? {},
  ),
);

function phoneOf(country: string): string {
  const p = NUMBERING.get(country);
  if (p === undefined) throw new Error(`pays sans plan de numérotation : ${country}`);
  const prefix = p.mobilePrefixes[0] ?? '';
  let rest = '';
  while (rest.length < p.nationalLength - prefix.length) rest += String(randomInt(10));
  return `+${p.callingCode}${prefix}${rest}`;
}

interface Person {
  readonly userId: string;
  readonly token: Buffer;
}

const commit = <T>(client: pg.ClientBase, fn: () => Promise<T>, virtualNow?: string): Promise<T> =>
  withTestTransaction(client, { commit: true, ...(virtualNow ? { virtualNow } : {}) }, fn);

/** Personne inscrite, e-mail vérifié, session ouverte ; téléphone vérifié par l'OTP (sauf refus). */
async function person(
  client: pg.ClientBase,
  country: string,
  options: { readonly phone?: boolean } = {},
): Promise<Person> {
  const userId = uuid();
  const verification = newToken();
  const r = await client.query<{ ok: boolean }>(
    `SELECT core.iam_cmd_register_with_consents($1, $2, $3, 'Ana', 'Pérez', 'es', $4, $5, 86400,
                                                NULL, $6, $7::jsonb, false) AS ok`,
    [userId, `kyc-${userId}@example.test`, phcArgon2id(), uuid(), verification.hash, country, DOCS],
  );
  if (r.rows[0]?.ok !== true) throw new Error('inscription de test refusée');
  const v = await client.query<{ ok: boolean }>('SELECT core.iam_cmd_verify_email($1) AS ok', [
    verification.hash,
  ]);
  if (v.rows[0]?.ok !== true) throw new Error('vérification d’e-mail refusée');
  const t = newToken();
  const s = await client.query<{ expires_at: Date | null }>(
    `SELECT core.iam_cmd_open_session($1, $2, $3, $4, 'NONE', NULL, 'vitest') AS expires_at`,
    [uuid(), userId, t.hash, SESSION_TTL_S],
  );
  if (!s.rows[0]?.expires_at) throw new Error('session refusée');
  const p = { userId, token: t.hash };
  if (options.phone !== false) await verifyPhone(client, p, country);
  return p;
}

/**
 * Téléphone vérifié (SM-3 `PHONE_VERIFIED`) posé par la fixture 9996, numéro fictif unique : la
 * vérification par OTP est prouvée par l0-us104, dont la purge à +31 jours (horloge virtuelle)
 * efface aussi les défis d'un fichier parallèle (échec aléatoire observé en CI, corrigé ainsi).
 */
async function verifyPhone(client: pg.ClientBase, p: Person, country: string): Promise<void> {
  await client.query('SELECT test_fixture.us105_verify_phone($1, $2)', [
    p.userId,
    phoneOf(country),
  ]);
}

const one = async <T extends pg.QueryResultRow>(
  client: pg.ClientBase,
  sql: string,
  params: unknown[],
): Promise<T> => {
  const { rows } = await client.query<T>(sql, params);
  return rows[0] as T;
};

const consent = (
  c: pg.ClientBase,
  p: Person,
  country: string,
  version: number | null,
  accepted = true,
) =>
  one<{ outcome: string; version: number | null }>(
    c,
    'SELECT * FROM core.kyc_cmd_biometric_consent($1, $2, $3, $4)',
    [p.token, country, version, accepted],
  );

interface Opened {
  readonly outcome: string;
  readonly verification_id: string | null;
  readonly attempt: number | null;
  readonly hosted_url: string | null;
}
const open = (c: pg.ClientBase, p: Person, country: string) =>
  one<Opened>(c, 'SELECT * FROM core.kyc_cmd_open_verification($1, $2, $3)', [
    p.token,
    country,
    PROVIDER,
  ]);

const recordSession = (c: pg.ClientBase, p: Person, o: Opened, sessionRef: string) =>
  one<{ outcome: string }>(
    c,
    'SELECT * FROM core.kyc_cmd_record_session($1, $2, $3, $4, $5, $6, $7)',
    [
      p.token,
      o.verification_id,
      o.attempt,
      PROVIDER,
      sessionRef,
      `https://identity.fake.invalid/session/${sessionRef}`,
      new Date(Date.now() + 30 * 60_000).toISOString(),
    ],
  );

/** Date ISO (AAAA-MM-JJ) à `days` jours d'aujourd'hui (UTC). */
const isoDay = (days: number): string =>
  new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);

interface Decision {
  readonly decision?: string;
  readonly liveness?: number | null;
  readonly faceMatch?: number | null;
  readonly document?: Record<string, unknown> | null;
}
const licence = (country: string, expiresOn: string, extra: Record<string, unknown> = {}) => ({
  kind: 'DRIVER_LICENSE',
  country,
  expiresOn,
  licenseClass: 'B',
  isPermanent: true,
  providerDocumentRef: `doc_${randomBytes(4).toString('hex')}`,
  // nom lu sur le permis (US-103, ADR-117) : concorde avec le compte « Ana Pérez »
  holderGivenNames: 'Ana María',
  holderSurnames: 'Pérez Gómez',
  ...extra,
});

const apply = (
  c: pg.ClientBase,
  eventId: string,
  sessionRef: string,
  subjectRef: string,
  d: Decision,
) =>
  one<{ outcome: string; status: string | null }>(
    c,
    'SELECT * FROM core.kyc_cmd_apply_decision($1, $2, $3, $4, $5, $6, $7, $8::jsonb)',
    [
      PROVIDER,
      eventId,
      sessionRef,
      subjectRef,
      d.decision ?? 'APPROVED',
      d.liveness === undefined ? 0.9871 : d.liveness,
      d.faceMatch === undefined ? 0.9612 : d.faceMatch,
      d.document === null ? null : JSON.stringify(d.document),
    ],
  );

const fixture = <T extends pg.QueryResultRow>(c: pg.ClientBase, fn: string, arg: unknown) =>
  c.query<T>(`SELECT * FROM test_fixture.${fn}($1)`, [arg]).then((r) => r.rows);

/** Personne consentante, dossier ouvert et session posée (DOCS_SUBMITTED). */
async function submitted(
  c: pg.ClientBase,
  country: string,
): Promise<{ p: Person; o: Opened; sessionRef: string }> {
  const p = await person(c, country);
  expect(await consent(c, p, country, 1)).toEqual({ outcome: 'RECORDED', version: 1 });
  const o = await open(c, p, country);
  expect(o).toMatchObject({ outcome: 'READY', attempt: 1 });
  const sessionRef = `fk_idv_${randomBytes(6).toString('hex')}`;
  expect(await recordSession(c, p, o, sessionRef)).toEqual({ outcome: 'RECORDED' });
  return { p, o, sessionRef };
}

const byCountry = COUNTRIES.map((c) => [c.country, c.currency, c.timezone] as const);

describe('US-105 — consentement biométrique (critère 2, VER-004)', () => {
  it.each(byCountry)(
    '%s (%s) : sans consentement, KYC_BIOMETRIC_CONSENT_MISSING et aucune vérification créée',
    async (country) => {
      await withRole('app_api', async (c) => {
        const p = await person(c, country);
        expect((await open(c, p, country)).outcome).toBe('CONSENT_MISSING');
        expect(await fixture(c, 'us105_verification', p.userId)).toEqual([]);
        const state = await one<Record<string, unknown>>(
          c,
          'SELECT * FROM core.kyc_identity_state($1, $2)',
          [p.token, country],
        );
        expect(state).toMatchObject({
          outcome: 'OK',
          status: 'NOT_STARTED',
          consent_version: 1,
          consent_accepted_version: null,
          consent_locale: 'es',
          phone_verified: true,
        });
        expect(String(state['consent_body'])).not.toBe('');
        // un retrait après acceptation referme l'accès
        expect(await consent(c, p, country, 1)).toEqual({ outcome: 'RECORDED', version: 1 });
        expect(await consent(c, p, country, null, false)).toEqual({
          outcome: 'RECORDED',
          version: 1,
        });
        expect((await open(c, p, country)).outcome).toBe('CONSENT_MISSING');
        expect(await fixture(c, 'us105_consents', p.userId)).toEqual([
          {
            doc_kind: 'BIOMETRIC_CONSENT',
            doc_version: 1,
            accepted: true,
            context: 'KYC',
            country_code: country,
            c2_withheld: true,
          },
          {
            doc_kind: 'BIOMETRIC_CONSENT',
            doc_version: 1,
            accepted: false,
            context: 'KYC',
            country_code: country,
            c2_withheld: true,
          },
        ]);
      });
    },
  );

  it('une nouvelle version du texte exige une nouvelle acceptation (transaction annulée)', async () => {
    await withRole('app_api', async (c) => {
      const country = COUNTRIES[0].country;
      const p = await person(c, country);
      expect(await consent(c, p, country, 1)).toEqual({ outcome: 'RECORDED', version: 1 });
      await withTestTransaction(c, {}, async () => {
        const { rows } = await c.query<{ v: number }>(
          'SELECT test_fixture.us105_publish_biometric_next() AS v',
        );
        const next = rows[0]?.v as number;
        expect(next).toBe(2);
        expect((await open(c, p, country)).outcome).toBe('CONSENT_MISSING');
        expect(await consent(c, p, country, 1)).toEqual({
          outcome: 'VERSION_CHANGED',
          version: next,
        });
        expect(await consent(c, p, country, next)).toEqual({ outcome: 'RECORDED', version: next });
        expect((await open(c, p, country)).outcome).toBe('READY');
      });
    });
  });

  it('pré-requis : session, téléphone vérifié, pays connu', async () => {
    await withRole('app_api', async (c) => {
      const country = COUNTRIES[0].country;
      const anon = { userId: uuid(), token: newToken().hash };
      expect((await open(c, anon, country)).outcome).toBe('AUTH_REQUIRED');
      expect((await consent(c, anon, country, 1)).outcome).toBe('AUTH_REQUIRED');
      const p = await person(c, country, { phone: false });
      expect(await consent(c, p, country, 1)).toEqual({ outcome: 'RECORDED', version: 1 });
      expect((await open(c, p, country)).outcome).toBe('PHONE_NOT_VERIFIED');
      expect((await open(c, p, 'XX')).outcome).toBe('COUNTRY_UNKNOWN');
      expect(await fixture(c, 'us105_verification', p.userId)).toEqual([]);
    });
  });
});

describe('US-105 — décision par rappel signé (critère 1)', () => {
  it.each(byCountry)(
    '%s (%s) : « approved » reçu deux fois ⇒ une seule transition APPROVED ; un autre événement est périmé',
    async (country) => {
      await withRole('app_api', async (c) => {
        const { p, o, sessionRef } = await submitted(c, country);
        const vid = o.verification_id as string;
        expect((await fixture(c, 'us105_verification', p.userId))[0]).toMatchObject({
          status: 'DOCS_SUBMITTED',
          country_code: country,
          provider: PROVIDER,
          provider_session_ref: sessionRef,
        });
        const expiresOn = isoDay(400);
        const d = { document: licence(country, expiresOn) };
        const evt1 = uuid();
        expect(await apply(c, evt1, sessionRef, vid, d)).toEqual({
          outcome: 'APPLIED',
          status: 'APPROVED',
        });
        expect(await apply(c, evt1, sessionRef, vid, d)).toEqual({
          outcome: 'DUPLICATE',
          status: null,
        });
        expect(await apply(c, uuid(), sessionRef, vid, d)).toEqual({
          outcome: 'STALE',
          status: 'APPROVED',
        });

        const [v] = await fixture<{
          status: string;
          approved_at: Date | null;
          expires_at: Date | null;
        }>(c, 'us105_verification', p.userId);
        expect(v?.status).toBe('APPROVED');
        expect(v?.approved_at).not.toBeNull();
        const events = await fixture<{
          payload: { from: string; to: string; user_id: string };
          actor_role: string;
          country_code: string;
        }>(c, 'us105_events', vid);
        expect(events.map((e) => [e.payload.from, e.payload.to])).toEqual([
          ['PHONE_VERIFIED', 'DOCS_SUBMITTED'],
          ['DOCS_SUBMITTED', 'AUTO_CHECKS'],
          ['AUTO_CHECKS', 'APPROVED'],
        ]);
        expect(
          events.every((e) => e.payload.user_id === p.userId && e.country_code === country),
        ).toBe(true);
        expect((await open(c, p, country)).outcome).toBe('ALREADY_APPROVED');
      });
    },
  );

  it('deux rappels distincts concurrents pour la même session : une seule transition APPROVED', async () => {
    const country = COUNTRIES[1].country;
    const s = await withRole('app_api', (c) => submitted(c, country));
    const vid = s.o.verification_id as string;
    const d = { document: licence(country, isoDay(400)) };
    const run = (eventId: string) =>
      withRole('app_api', (c) => commit(c, () => apply(c, eventId, s.sessionRef, vid, d)));
    const results = await Promise.all([run(uuid()), run(uuid())]);
    expect(results.map((r) => r.outcome).sort()).toEqual(['APPLIED', 'STALE']);
    await withRole('app_api', async (c) => {
      const events = await fixture<{ payload: { to: string } }>(c, 'us105_events', vid);
      expect(events.filter((e) => e.payload.to === 'APPROVED')).toHaveLength(1);
    });
  });

  it.each(byCountry)(
    '%s (%s) : revue manuelle (fournisseur en revue, refusé, permis provisoire, expiré, absent)',
    async (country) => {
      await withRole('app_api', async (c) => {
        const cases: [Decision, string][] = [
          [{ decision: 'REVIEW', document: licence(country, isoDay(400)) }, 'PROVIDER_REVIEW'],
          [{ decision: 'DECLINED', document: licence(country, isoDay(400)) }, 'PROVIDER_DECLINED'],
          [
            { document: licence(country, isoDay(400), { isPermanent: false }) },
            'LICENSE_PROVISIONAL',
          ],
          [{ document: licence(country, isoDay(-2)) }, 'LICENSE_EXPIRED'],
          [{ document: null }, 'DOCUMENT_MISSING'],
          [
            { document: licence(country, isoDay(400), { kind: 'PASSPORT' }) },
            'DOCUMENT_NOT_LICENSE',
          ],
        ];
        for (const [d, reason] of cases) {
          const s = await submitted(c, country);
          expect(await apply(c, uuid(), s.sessionRef, s.o.verification_id as string, d)).toEqual({
            outcome: 'APPLIED',
            status: 'MANUAL_REVIEW',
          });
          expect((await fixture(c, 'us105_verification', s.p.userId))[0]).toMatchObject({
            status: 'MANUAL_REVIEW',
            decision_reason_code: reason,
            approved_at: null,
          });
          expect((await open(c, s.p, country)).outcome).toBe('IN_REVIEW');
        }
      });
    },
  );

  it('rappel d’une session inconnue ou d’un autre sujet : ignoré, rien n’est décidé', async () => {
    await withRole('app_api', async (c) => {
      const country = COUNTRIES[0].country;
      const s = await submitted(c, country);
      const d = { document: licence(country, isoDay(400)) };
      expect(
        (await apply(c, uuid(), 'fk_idv_unknown', s.o.verification_id as string, d)).outcome,
      ).toBe('UNKNOWN_SESSION');
      expect((await apply(c, uuid(), s.sessionRef, uuid(), d)).outcome).toBe('UNKNOWN_SESSION');
      expect((await fixture(c, 'us105_verification', s.p.userId))[0]).toMatchObject({
        status: 'DOCS_SUBMITTED',
      });
    });
  });

  it('signature invalide : rejet journalisé (empreinte du corps, jamais le corps)', async () => {
    await withRole('app_api', async (c) => {
      const body = Buffer.from(JSON.stringify({ eventId: uuid(), decision: 'APPROVED' }));
      const sha = createHash('sha256').update(body).digest();
      await c.query('SELECT core.kyc_cmd_record_webhook_rejection($1, $2, $3, $4)', [
        PROVIDER,
        'BAD_SIGNATURE',
        sha,
        body.length,
      ]);
      expect(await fixture(c, 'us105_rejections', sha)).toEqual([
        { provider: PROVIDER, reason: 'BAD_SIGNATURE', body_length: body.length },
      ]);
    });
  });
});

describe('US-105 — aucune image copiée chez nous (critère 4)', () => {
  it.each(byCountry)(
    '%s (%s) : seuls les scores, la référence et les champs minimaux du permis sont gardés',
    async (country) => {
      await withRole('app_api', async (c) => {
        const { p, o, sessionRef } = await submitted(c, country);
        const expiresOn = isoDay(500);
        const doc = licence(country, expiresOn, {
          frontImage: `data:image/jpeg;base64,${randomBytes(48).toString('base64')}`,
          selfieUrl: 'https://identity.fake.invalid/selfie.jpg',
          number: 'A1234567',
        });
        await apply(c, uuid(), sessionRef, o.verification_id as string, {
          document: doc,
          liveness: 0.9871,
          faceMatch: 0.9612,
        });
        expect(await fixture(c, 'us105_documents', p.userId)).toEqual([
          {
            doc_type: 'DRIVER_LICENSE',
            issuing_country: country,
            expiry_date: expect.any(Date) as Date,
            license_class: 'B',
            is_permanent: true,
            provider_document_ref: doc.providerDocumentRef,
            status: 'ACCEPTED',
            attempt: 1,
          },
        ]);
        const [l] = await fixture<{
          liveness_score: string;
          face_match_score: string;
          result: string;
          provider_session_ref: string;
          retention_days: string;
        }>(c, 'us105_liveness', p.userId);
        expect(l).toMatchObject({
          liveness_score: '0.9871',
          face_match_score: '0.9612',
          result: 'APPROVED',
          provider_session_ref: sessionRef,
        });
        expect(Number(l?.retention_days)).toBe(RETENTION_DAYS.get(country) ?? 0);

        // le schéma n'a AUCUNE colonne d'image, de fichier ni de numéro de pièce
        const { rows } = await c.query<{ rel: string; col: string; typ: string }>(
          `SELECT c.relname AS rel, a.attname AS col, pg_catalog.format_type(a.atttypid, a.atttypmod) AS typ
             FROM pg_catalog.pg_attribute AS a
             JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
             JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
            WHERE n.nspname = 'core' AND c.relname LIKE 'kyc\\_%' AND c.relkind = 'r'
              AND a.attnum > 0 AND NOT a.attisdropped`,
        );
        expect(rows.length).toBeGreaterThan(0);
        expect(
          rows.filter((r) => /image|file|selfie|photo|front|back|number|blob/.test(r.col)),
        ).toEqual([]);
        // US-123 (0075) : seul autre bytea, le numéro fiscal CHIFFRÉ de l'hôte (enveloppe v1)
        expect(
          rows
            .filter((r) => r.typ === 'bytea')
            .map((r) => `${r.rel}.${r.col}`)
            .sort(),
        ).toEqual(['kyc_host_tax_profile.tax_id_enc', 'kyc_webhook_rejection.body_sha256']);
      });
    },
  );

  it('tables KYC : RLS ENABLE + FORCE, propriétaire migrator, politique migrator_all', async () => {
    await withRole('app_api', async (c) => {
      const { rows } = await c.query<{ t: string; ok: boolean }>(
        `SELECT c.relname AS t,
                c.relrowsecurity AND c.relforcerowsecurity
                AND pg_catalog.pg_get_userbyid(c.relowner) = 'migrator'
                AND EXISTS (SELECT 1 FROM pg_catalog.pg_policy p
                             WHERE p.polrelid = c.oid AND p.polname = 'migrator_all') AS ok
           FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'core' AND c.relkind = 'r' AND c.relname LIKE 'kyc%'
          ORDER BY 1`,
      );
      expect(rows).toEqual(
        [
          'kyc_erasure_request',
          'kyc_host_tax_profile',
          'kyc_host_verification',
          'kyc_identity_document',
          'kyc_identity_subject',
          'kyc_identity_verification',
          'kyc_liveness_check',
          'kyc_provider_event',
          'kyc_sanctions_screening',
          'kyc_webhook_rejection',
        ].map((t) => ({ t, ok: true })),
      );
    });
  });

  it('app_api ne lit ni n’écrit aucune table KYC directement (commandes seulement)', async () => {
    await withRole('app_api', async (c) => {
      for (const t of [
        'kyc_identity_verification',
        'kyc_identity_document',
        'kyc_liveness_check',
        'kyc_provider_event',
        'kyc_webhook_rejection',
        'kyc_erasure_request',
        // US-123 (0075)
        'kyc_identity_subject',
        'kyc_host_verification',
        'kyc_sanctions_screening',
        'kyc_host_tax_profile',
      ]) {
        await expect(c.query(`SELECT 1 FROM core.${t} LIMIT 1`)).rejects.toMatchObject({
          code: '42501',
        });
      }
    });
  });
});

describe('US-105 — permis expirant avant la fin du trip (critère 3)', () => {
  it.each(byCountry)(
    '%s (%s) : valable jusqu’à la fin du jour d’échéance dans le fuseau du pays du trip',
    async (country) => {
      await withRole('app_api', async (c) => {
        const { p, o, sessionRef } = await submitted(c, country);
        const eligibility = (end: string) =>
          one<{ outcome: string }>(c, 'SELECT * FROM core.kyc_driver_eligibility($1, $2, $3)', [
            p.token,
            end,
            country,
          ]).then((r) => r.outcome);
        // avant toute décision : non approuvé
        expect(await eligibility(new Date(Date.now() + DAY_MS).toISOString())).toBe(
          'KYC_NOT_APPROVED',
        );
        const expiresOn = isoDay(30);
        await apply(c, uuid(), sessionRef, o.verification_id as string, {
          document: licence(country, expiresOn),
        });
        // minuit local qui suit le jour d'échéance = minuit UTC du lendemain moins le décalage du
        // pays (calcul indépendant du SQL testé), et la seconde qui le précède
        const offset = UTC_OFFSET_MIN.get(country) ?? 0;
        const next = new Date(Date.parse(`${expiresOn}T00:00:00Z`) + DAY_MS - offset * 60_000);
        const bounds = { last: new Date(next.getTime() - 1000), next };
        expect(await eligibility(bounds.last.toISOString())).toBe('ELIGIBLE');
        expect(await eligibility(bounds.next.toISOString())).toBe('KYC_LICENSE_EXPIRED');
        expect(await eligibility(new Date(bounds.next.getTime() + 40 * DAY_MS).toISOString())).toBe(
          'KYC_LICENSE_EXPIRED',
        );
        expect(
          (
            await one<{ outcome: string }>(
              c,
              'SELECT * FROM core.kyc_driver_eligibility($1, $2, $3)',
              [p.token, bounds.last.toISOString(), 'XX'],
            )
          ).outcome,
        ).toBe('COUNTRY_UNKNOWN');
      });
    },
  );
});

describe('US-105 — retrait du consentement biométrique (VER-004, RISKS L1-PM-39)', () => {
  const pending = (c: pg.ClientBase, p: Person) =>
    c
      .query<{ request_id: string; provider: string; session_ref: string }>(
        'SELECT * FROM core.kyc_pending_erasures($1)',
        [p.token],
      )
      .then((r) => r.rows);

  it.each(byCountry)(
    '%s (%s) : après ouverture de session, RECHECK, effacement daté, rappel tardif sans effet',
    async (country) => {
      await withRole('app_api', async (c) => {
        const { p, o, sessionRef } = await submitted(c, country);
        const vid = o.verification_id as string;
        expect(await consent(c, p, country, null, false)).toEqual({
          outcome: 'RECORDED',
          version: 1,
        });
        expect((await fixture(c, 'us105_verification', p.userId))[0]).toMatchObject({
          status: 'RECHECK',
          decision_reason_code: 'CONSENT_WITHDRAWN',
          provider_session_ref: null,
          attempt: 2,
        });
        expect(await fixture(c, 'us105_erasures', p.userId)).toEqual([
          {
            provider: PROVIDER,
            provider_session_ref: sessionRef,
            status: 'PENDING',
            attestation_ref: null,
            dated: true,
          },
        ]);
        const [req] = await pending(c, p);
        expect(req).toMatchObject({ provider: PROVIDER, session_ref: sessionRef });
        // rappel signé tardif de la session effacée : inconnu, aucun score, aucune transition
        expect(
          await apply(c, uuid(), sessionRef, vid, { document: licence(country, isoDay(400)) }),
        ).toEqual({ outcome: 'UNKNOWN_SESSION', status: null });
        expect(await fixture(c, 'us105_liveness', p.userId)).toEqual([]);
        const events = await fixture<{
          payload: { from: string; to: string; reason_code: string | null };
        }>(c, 'us105_events', vid);
        expect(events.at(-1)?.payload).toMatchObject({
          from: 'DOCS_SUBMITTED',
          to: 'RECHECK',
          reason_code: 'CONSENT_WITHDRAWN',
        });
        expect(await fixture(c, 'us105_user_events', p.userId)).toMatchObject([
          { type: 'kyc.consent.withdrawn', payload: { user_id: p.userId, erasure_requests: 1 } },
        ]);
        expect(
          (await fixture<{ action_code: string }>(c, 'us105_audit', p.userId)).map(
            (a) => a.action_code,
          ),
        ).toEqual(['KYC_CONSENT_WITHDRAWN']);
        // attestation du fournisseur : demande close, référence effacée, journalisée
        expect(
          await one<{ outcome: string }>(
            c,
            'SELECT * FROM core.kyc_cmd_record_erasure($1, $2, $3, $4)',
            [p.token, req?.request_id, 'DONE', 'attestation-1'],
          ),
        ).toEqual({ outcome: 'RECORDED' });
        expect(await fixture(c, 'us105_erasures', p.userId)).toEqual([
          {
            provider: PROVIDER,
            provider_session_ref: null,
            status: 'DONE',
            attestation_ref: 'attestation-1',
            dated: true,
          },
        ]);
        expect(await pending(c, p)).toEqual([]);
        // une nouvelle vérification exige un nouveau consentement, puis une nouvelle tentative
        expect((await open(c, p, country)).outcome).toBe('CONSENT_MISSING');
        expect(await consent(c, p, country, 1)).toEqual({ outcome: 'RECORDED', version: 1 });
        expect(await open(c, p, country)).toMatchObject({ outcome: 'READY', attempt: 2 });
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : après approbation, scores et références effacés, paiement refusé',
    async (country) => {
      await withRole('app_api', async (c) => {
        const { p, o, sessionRef } = await submitted(c, country);
        await apply(c, uuid(), sessionRef, o.verification_id as string, {
          document: licence(country, isoDay(400)),
        });
        const end = new Date(Date.now() + DAY_MS).toISOString();
        const eligibility = () =>
          one<{ outcome: string }>(c, 'SELECT * FROM core.kyc_driver_eligibility($1, $2, $3)', [
            p.token,
            end,
            country,
          ]).then((r) => r.outcome);
        expect(await eligibility()).toBe('ELIGIBLE');
        expect(await consent(c, p, country, null, false)).toEqual({
          outcome: 'RECORDED',
          version: 1,
        });
        expect((await fixture(c, 'us105_verification', p.userId))[0]).toMatchObject({
          status: 'RECHECK',
          approved_at: null,
          expires_at: null,
        });
        expect(await fixture(c, 'us105_liveness', p.userId)).toMatchObject([
          {
            liveness_score: null,
            face_match_score: null,
            provider_session_ref: null,
            erased: true,
          },
        ]);
        expect(await fixture(c, 'us105_documents', p.userId)).toMatchObject([
          { provider_document_ref: null },
        ]);
        expect(await fixture(c, 'us105_erasures', p.userId)).toMatchObject([
          { provider_session_ref: sessionRef, status: 'PENDING' },
        ]);
        expect(await eligibility()).toBe('KYC_NOT_APPROVED');
        expect((await open(c, p, country)).outcome).toBe('CONSENT_MISSING');
      });
    },
  );

  it('consentement retiré pendant la session (nouvelle version non acceptée) : rappel ignoré, aucun score', async () => {
    await withRole('app_api', async (c) => {
      const country = COUNTRIES[0].country;
      const { p, o, sessionRef } = await submitted(c, country);
      await withTestTransaction(c, {}, async () => {
        await c.query('SELECT test_fixture.us105_publish_biometric_next()');
        expect(
          await apply(c, uuid(), sessionRef, o.verification_id as string, {
            document: licence(country, isoDay(400)),
          }),
        ).toEqual({ outcome: 'CONSENT_WITHDRAWN', status: 'DOCS_SUBMITTED' });
        expect(await fixture(c, 'us105_liveness', p.userId)).toEqual([]);
        expect((await fixture(c, 'us105_verification', p.userId))[0]).toMatchObject({
          status: 'DOCS_SUBMITTED',
        });
      });
    });
  });
});

describe('US-105 — garde de production, reprise, rappel inconnu, purge', () => {
  it.each(['production', '__null__'])(
    'base « %s » : ouverture et décision refusées en base (OQ-MK-09, L1-PM-05), rien n’est écrit',
    async (env) => {
      await withRole('app_api', async (c) => {
        const country = COUNTRIES[0].country;
        const p = await person(c, country);
        expect(await consent(c, p, country, 1)).toEqual({ outcome: 'RECORDED', version: 1 });
        await withTestTransaction(c, {}, async () => {
          await c.query(`SELECT pg_catalog.set_config('app.test_deployment_env', $1, true)`, [env]);
          expect((await open(c, p, country)).outcome).toBe('PRODUCTION_BLOCKED');
          expect(await apply(c, uuid(), 'fk_idv_x', uuid(), { document: null })).toEqual({
            outcome: 'PRODUCTION_BLOCKED',
            status: null,
          });
          expect(await fixture(c, 'us105_verification', p.userId)).toEqual([]);
        });
      });
    },
  );

  it('session expirée : un double clic rejoue la même tentative (une seule clé chez le fournisseur)', async () => {
    await withRole('app_api', async (c) => {
      const country = COUNTRIES[1].country;
      const { p } = await submitted(c, country);
      await c.query('SELECT test_fixture.us105_expire_session($1)', [p.userId]);
      const first = await open(c, p, country);
      const second = await open(c, p, country);
      expect(first).toMatchObject({ outcome: 'READY', attempt: 2 });
      expect(second).toMatchObject({
        outcome: 'READY',
        attempt: 2,
        verification_id: first.verification_id,
      });
    });
  });

  it('rappel d’une session inconnue : l’identifiant d’événement n’est pas consommé', async () => {
    await withRole('app_api', async (c) => {
      const country = COUNTRIES[0].country;
      const s = await submitted(c, country);
      const evt = uuid();
      const d = { document: licence(country, isoDay(400)) };
      expect(
        (await apply(c, evt, 'fk_idv_unknown', s.o.verification_id as string, d)).outcome,
      ).toBe('UNKNOWN_SESSION');
      expect(await apply(c, evt, s.sessionRef, s.o.verification_id as string, d)).toEqual({
        outcome: 'APPLIED',
        status: 'APPROVED',
      });
    });
  });

  it('travailleur kyc_score_pruner : scores à échéance effacés, les autres gardés', async () => {
    const country = COUNTRIES[0].country;
    const people = await withRole('app_api', async (c) => {
      const due = await submitted(c, country);
      const kept = await submitted(c, country);
      for (const s of [due, kept]) {
        await apply(c, uuid(), s.sessionRef, s.o.verification_id as string, {
          document: licence(country, isoDay(400)),
        });
      }
      await c.query('SELECT test_fixture.us105_age_scores($1)', [due.p.userId]);
      return { due: due.p.userId, kept: kept.p.userId };
    });
    const n = await withRole('app_worker', (w) =>
      commit(w, async () => {
        await w.query(
          `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
                  pg_catalog.set_config('app.worker_name', 'kyc_score_pruner', true)`,
        );
        const { rows } = await w.query<{ n: number }>('SELECT core.kyc_worker_prune(10000) AS n');
        return rows[0]?.n ?? -1;
      }),
    );
    expect(n).toBeGreaterThanOrEqual(1);
    await withRole('app_api', async (c) => {
      expect(await fixture(c, 'us105_liveness', people.due)).toMatchObject([
        { liveness_score: null, erased: true },
      ]);
      expect(await fixture(c, 'us105_liveness', people.kept)).toMatchObject([
        { liveness_score: '0.9871', erased: false },
      ]);
    });
    // réservé au travailleur kyc_score_pruner
    await withRole('app_worker', async (w) => {
      await expect(w.query('SELECT core.kyc_worker_prune(10)')).rejects.toMatchObject({
        code: '42501',
      });
    });
  });
});
