/**
 * Preuves du compte de versement de l'hôte (US-707, migration 0159, graine 0160 ; fixtures 9927,
 * 9986 et 9996) sous les rôles de production app_api et app_worker (assertion L0-05 en tête de
 * chaque connexion, withRole), au Panama (USD) et au Paraguay (PYG). Chaque test crée ses
 * personnes, comptes d'hôte, vérifications d'identité et profils fiscaux par les VRAIES commandes
 * (inscription, e-mail, session, consentement biométrique, parcours d'identité, compte d'hôte,
 * profil fiscal chiffré). AUCUN interrupteur n'est lu ni écrit ; aucun montant.
 *
 * Attendus tirés de 19 US-707 (critères), de 16 PYO-001 (fiche, erreurs), de 17 §2.3
 * (`payout.manage_account` : P2P_HOST seulement), §3.2.9 (`payout_account`), §7.2
 * (`payout_account_change_hold_h` = 48 h), de 08 BR-PAYOUT-01, de 22 OQ-P2P-07 / OQ-PAY-09 et des
 * données CFG (`params.json` : `payout_account_change_hold_h`, `payout_account_rails` ;
 * `countries.json` : `hostTaxIdKinds`), jamais du code testé :
 * - critère 1 : titulaire (nom) discordant avec l'hôte ⇒ refus, rien n'est écrit ; sans profil
 *   fiscal ⇒ HOST_TAX_ID_REQUIRED (au PY, seul le RUC est admis : un hôte sans RUC n'a pas de
 *   compte, et reste non activable) ; le PSP refuse le titulaire ou la pièce ⇒ REJECTED ;
 * - critère 2 : changement de compte ⇒ versement prévu dans les 48 h ON_HOLD
 *   (PAYOUT_ACCOUNT_CHANGE_HOLD), au-delà ⇒ libre ; paramètre absent ⇒ retenue sans fin ;
 * - critère 3 : co-hôte ⇒ refus (même réponse qu'un compte inconnu) ; permission du titulaire
 *   seulement ;
 * - données C2 / C3 : numéro chiffré par la clé du sujet, 4 derniers caractères seulement en
 *   clair, aucun numéro (compte, 4 derniers, cédula / RUC) dans l'audit.
 */
import { randomBytes, randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { columnAad, open as openEnvelope, seal } from '../../src/audit/index.ts';
import { signedOpenParams, withRole } from '../../src/testing/index.ts';
import { COUNTRIES, uuid } from '../support/avl.ts';
import { newToken, phcArgon2id, SESSION_TTL_S } from '../support/iam.ts';
import { uniquePhone } from '../support/unique.ts';

const DOCS = '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]';
const PROVIDER = 'FAKE';
const GIVEN = 'Ana María';
const SURNAMES = 'Pérez Gómez';

const cfg = (file: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(`../../../../apps/api/src/modules/cfg/data/${file}`, import.meta.url),
      'utf8',
    ),
  );
const paramValues = (key: string): Record<string, unknown> =>
  (
    cfg('params.json') as { params: { key: string; values?: Record<string, unknown> }[] }
  ).params.find((p) => p.key === key)?.values ?? {};
/** 17 §7.2 `payout_account_change_hold_h` (48 h, décidé), par pays. */
const HOLD_H = paramValues('payout_account_change_hold_h');
/** Rails du compte de versement par pays (ADR-180, PROPOSÉ). */
type Rail = { accountPattern: string; institutions?: string[]; institutionPattern?: string };
const RAILS = paramValues('payout_account_rails') as Record<string, Record<string, Rail>>;
const TAX_KINDS = new Map(
  (
    cfg('countries.json') as { countries: { code: string; hostTaxIdKinds: string[] }[] }
  ).countries.map((c) => [c.code, c.hostTaxIdKinds]),
);

const isoDay = (days: number): string =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
let births = 0;
/** Date de naissance propre à chaque personne de ce fichier (plage 6 000 jours et plus). */
function distinctBirth(): string {
  births += 1;
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - 30);
  d.setUTCDate(d.getUTCDate() - 6_000 - births);
  return d.toISOString().slice(0, 10);
}

const one = async <T extends pg.QueryResultRow>(
  client: pg.ClientBase,
  sql: string,
  params: unknown[],
): Promise<T> => {
  const { rows } = await client.query<T>(sql, params);
  return rows[0] as T;
};

interface Person {
  readonly userId: string;
  readonly token: Buffer;
}

async function session(c: pg.ClientBase, userId: string): Promise<Buffer> {
  const t = newToken();
  const s = await one<{ expires_at: Date | null }>(
    c,
    `SELECT core.iam_cmd_open_session($1, $2, $3, $4, 'NONE', NULL, 'vitest', $5, $6) AS expires_at`,
    await signedOpenParams(c, [uuid(), userId, t.hash, SESSION_TTL_S]),
  );
  if (!s.expires_at) throw new Error('session refusée');
  return t.hash;
}

/** Personne inscrite (nom légal GIVEN SURNAMES), e-mail vérifié, session, téléphone vérifié. */
async function person(c: pg.ClientBase, country: string): Promise<Person> {
  const userId = uuid();
  const verification = newToken();
  const r = await one<{ ok: boolean }>(
    c,
    `SELECT core.iam_cmd_register_with_consents($1, $2, $3, $4, $5, 'es', $6,
                                                $7, 86400, NULL, $8, $9::jsonb, false) AS ok`,
    [
      userId,
      `payout-${userId}@example.test`,
      phcArgon2id(),
      GIVEN,
      SURNAMES,
      uuid(),
      verification.hash,
      country,
      DOCS,
    ],
  );
  if (r.ok !== true) throw new Error('inscription de test refusée');
  const v = await one<{ ok: boolean }>(c, 'SELECT core.iam_cmd_verify_email($1) AS ok', [
    verification.hash,
  ]);
  if (v.ok !== true) throw new Error('vérification d’e-mail refusée');
  const token = await session(c, userId);
  await c.query('SELECT test_fixture.us105_verify_phone($1, $2)', [
    userId,
    await uniquePhone(c, country),
  ]);
  return { userId, token };
}

/** Vérification d'identité APPROUVÉE par les vraies commandes (0072, 0075 ; nom lu = nom légal). */
async function kycApproved(c: pg.ClientBase, p: Person, country: string): Promise<void> {
  const consent = await one<{ outcome: string }>(
    c,
    'SELECT * FROM core.kyc_cmd_biometric_consent($1, $2, $3, $4)',
    [p.token, country, 1, true],
  );
  expect(consent.outcome).toBe('RECORDED');
  const o = await one<{ outcome: string; verification_id: string; attempt: number }>(
    c,
    'SELECT * FROM core.kyc_cmd_open_verification($1, $2, $3)',
    [p.token, country, PROVIDER],
  );
  expect(o.outcome).toBe('READY');
  const sessionRef = `fk_idv_${randomBytes(6).toString('hex')}`;
  const rec = await one<{ outcome: string }>(
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
  expect(rec.outcome).toBe('RECORDED');
  const r = await one<{ outcome: string; status: string | null }>(
    c,
    'SELECT * FROM core.kyc_cmd_decide_with_facts($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)',
    [
      PROVIDER,
      `fk_idv_evt_${randomBytes(6).toString('hex')}`,
      sessionRef,
      o.verification_id,
      'APPROVED',
      0.9871,
      0.9612,
      JSON.stringify({
        kind: 'DRIVER_LICENSE',
        country,
        expiresOn: isoDay(400),
        licenseClass: 'B',
        isPermanent: true,
        providerDocumentRef: `doc_${randomBytes(4).toString('hex')}`,
        holderGivenNames: GIVEN,
        holderSurnames: SURNAMES,
      }),
      JSON.stringify({ dateOfBirth: distinctBirth(), residenceCountry: country }),
    ],
  );
  expect(r).toMatchObject({ outcome: 'APPLIED', status: 'APPROVED' });
}

async function hostAccount(c: pg.ClientBase, p: Person, country: string): Promise<string> {
  const r = await one<{ outcome: string; org_id: string | null }>(
    c,
    'SELECT * FROM core.iam_cmd_open_host_account($1, $2, $3)',
    [p.token, country, 'INDIVIDUAL'],
  );
  expect(r.outcome).toBe('DONE');
  if (r.org_id === null) throw new Error('compte d’hôte non ouvert');
  return r.org_id;
}

/** Numéro fiscal de test (jamais un vrai numéro), chiffré par la clé du sujet, enregistré. */
async function savedTaxId(c: pg.ClientBase, p: Person, org: string, kind: string) {
  const plain = `${String(randomInt(1_000_000, 9_999_999))}-${String(randomInt(10))}`;
  const dek = randomBytes(32);
  const aad = columnAad('core.kyc_host_tax_profile', 'tax_id_enc', { type: 'ORG', id: org });
  const enc = seal(dek, Buffer.from(plain, 'utf8'), aad);
  const r = await one<{ outcome: string }>(
    c,
    'SELECT * FROM core.kyc_cmd_host_save_tax_profile($1, $2, $3, $4, $5, $6)',
    [p.token, org, kind, enc, null, 'INDIVIDUAL'],
  );
  expect(r.outcome).toBe('SAVED');
  return { plain, dek, aad };
}

interface Host {
  readonly p: Person;
  readonly org: string;
  readonly tax: { plain: string; dek: Buffer; aad: string } | null;
}
async function readyHost(
  c: pg.ClientBase,
  country: string,
  options: { kyc?: boolean; tax?: boolean } = {},
): Promise<Host> {
  const p = await person(c, country);
  if (options.kyc !== false) await kycApproved(c, p, country);
  const org = await hostAccount(c, p, country);
  const kind = TAX_KINDS.get(country)?.[0] ?? '';
  const tax = options.tax === false ? null : await savedTaxId(c, p, org, kind);
  return { p, org, tax };
}

/** Numéro de compte de test conforme au motif du rail (chiffres seulement). */
function accountNumber(country: string, kind: string): string {
  const pattern = RAILS[country]?.[kind]?.accountPattern ?? '';
  if (pattern.startsWith('^09')) return `09${String(randomInt(10_000_000, 99_999_999))}`;
  return String(randomInt(100_000_000, 999_999_999)) + String(randomInt(100, 999));
}
function institution(country: string, kind: string): string {
  const rail = RAILS[country]?.[kind];
  return rail?.institutions?.[0] ?? '0123';
}

const sealAccount = (org: string, plain: string) => {
  const dek = randomBytes(32);
  const aad = columnAad('core.payout_payout_account', 'account_number_enc', {
    type: 'ORG',
    id: org,
  });
  return { enc: seal(dek, Buffer.from(plain, 'utf8'), aad), dek, aad };
};

interface Context {
  readonly outcome: string;
  readonly country_code: string | null;
  readonly currency: string | null;
  readonly rails: Record<string, Rail> | null;
  readonly tax_kind: string | null;
  readonly tax_id_enc: Buffer | null;
}
const context = (c: pg.ClientBase, token: Buffer, org: string, given = GIVEN, sur = SURNAMES) =>
  one<Context>(c, 'SELECT * FROM core.payout_payout_account_context($1, $2, $3, $4)', [
    token,
    org,
    given,
    sur,
  ]);

interface Registered {
  readonly outcome: string;
  readonly account_id: string | null;
  readonly change_hold_until: Date | null;
}
const register = (
  c: pg.ClientBase,
  token: Buffer,
  org: string,
  a: { kind: string; institution: string; enc: Buffer; last4: string },
  given = GIVEN,
  sur = SURNAMES,
) =>
  one<Registered>(
    c,
    'SELECT * FROM core.payout_cmd_register_payout_account($1, $2, $3, $4, $5, $6, $7, $8)',
    [token, org, a.kind, a.institution, a.enc, a.last4, given, sur],
  );

const record = (
  c: pg.ClientBase,
  token: Buffer,
  org: string,
  account: string | null,
  status: string,
  reason: string | null,
  ref: string | null,
) =>
  one<{ outcome: string }>(
    c,
    'SELECT * FROM core.payout_cmd_record_payout_account_verification($1, $2, $3, $4, $5, $6)',
    [token, org, account, status, reason, ref],
  );

interface State {
  readonly outcome: string;
  readonly country_code: string | null;
  readonly currency: string | null;
  readonly rails: Record<string, Rail> | null;
  readonly tax_kind: string | null;
  readonly account_id: string | null;
  readonly status: string | null;
  readonly rail_kind: string | null;
  readonly institution_code: string | null;
  readonly account_last4: string | null;
  readonly change_hold_until: Date | null;
  readonly reject_reason: string | null;
}
const state = (c: pg.ClientBase, token: Buffer, org: string) =>
  one<State>(c, 'SELECT * FROM core.payout_payout_account_state($1, $2)', [token, org]);

interface AccountRow {
  readonly id: string;
  readonly status: string;
  readonly currency: string;
  readonly account_number_enc: Buffer;
  readonly account_last4: string;
  readonly holder_name: string;
  readonly holder_tax_id_kind: string;
  readonly reject_reason: string | null;
  readonly change_hold_until: Date | null;
}
const accounts = (c: pg.ClientBase, org: string) =>
  c.query<AccountRow>('SELECT * FROM test_fixture.us707_accounts($1)', [org]).then((r) => r.rows);
const audit = (c: pg.ClientBase, org: string) =>
  c
    .query<{ action_code: string; actor_role: string; before: unknown; after: unknown }>(
      'SELECT * FROM test_fixture.us707_audit($1)',
      [org],
    )
    .then((r) => r.rows);

/** Motifs de retenue d'un versement prévu à `at` (garde des lots d'US-708), sous app_worker. */
const holdOf = (org: string, currency: string, at: Date | null) =>
  withRole('app_worker', async (w) =>
    one<{ reasons: string[] }>(w, 'SELECT core.payout_payout_account_hold($1, $2, $3) AS reasons', [
      org,
      currency,
      at,
    ]).then((r) => r.reasons),
  );

/** Paramètre du compte de versement modifié dans une transaction ANNULÉE (fail-closed). */
async function withParam<T>(
  c: pg.ClientBase,
  key: 'payout_account_change_hold_h' | 'payout_account_rails',
  country: string,
  value: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  await c.query('BEGIN');
  try {
    await c.query('SELECT test_fixture.us707_param_version($1, $2, $3::jsonb)', [
      key,
      country,
      value,
    ]);
    return await fn();
  } finally {
    await c.query('ROLLBACK');
  }
}

/** Compte conforme au premier rail du pays (enveloppe et 4 derniers caractères). */
function newAccount(country: string, org: string, kind = Object.keys(RAILS[country] ?? {})[0]) {
  const k = kind ?? 'BANK_ACCOUNT';
  const plain = accountNumber(country, k);
  const sealed = sealAccount(org, plain);
  return {
    plain,
    sealed,
    input: {
      kind: k,
      institution: institution(country, k),
      enc: sealed.enc,
      last4: plain.slice(-4),
    },
  };
}

const HOUR = 3_600_000;

describe.each(COUNTRIES)('US-707 — compte de versement de l’hôte, $country ($currency)', (cc) => {
  const country = cc.country;
  const holdH = Number(HOLD_H[country]);

  it('données : retenue de 48 h (17 §7.2), rails du pays configurés, permission du seul P2P_HOST (17 §2.3)', async () => {
    await withRole('app_api', async (c) => {
      expect(holdH).toBe(48);
      expect(Object.keys(RAILS[country] ?? {}).length).toBeGreaterThan(0);
      const roles = await c.query<{ role: string }>(
        'SELECT * FROM test_fixture.us707_permission_roles($1)',
        ['payout.manage_account'],
      );
      expect(roles.rows.map((r) => r.role)).toEqual(['P2P_HOST']);
    });
  });

  it('socle : RLS ENABLE + FORCE, migrator_all, propriétaire migrator ; aucun droit applicatif ; écriture directe refusée (42501)', async () => {
    await withRole('app_api', async (c) => {
      const t = await one<{ rls: boolean; force: boolean; owner: string; pols: string[] }>(
        c,
        `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
                pg_catalog.pg_get_userbyid(c.relowner) AS owner,
                ARRAY(SELECT p.polname || ':' || pg_catalog.array_to_string(ARRAY(
                        SELECT pg_catalog.pg_get_userbyid(r) FROM pg_catalog.unnest(p.polroles) AS r), ',')
                        FROM pg_catalog.pg_policy p WHERE p.polrelid = c.oid ORDER BY 1) AS pols
           FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'core' AND c.relname = 'payout_payout_account'`,
        [],
      );
      expect(t).toMatchObject({ rls: true, force: true, owner: 'migrator' });
      expect(t.pols).toEqual([
        'cmd_money_ins:cmd_money_owner',
        'cmd_money_sel:cmd_money_owner',
        'cmd_money_upd:cmd_money_owner',
        'migrator_all:migrator',
      ]);
      const privs = await c.query<{ role: string; priv: string; has: boolean }>(
        `SELECT r.role, p.priv,
                pg_catalog.has_table_privilege(r.role, 'core.payout_payout_account', p.priv) AS has
           FROM unnest(ARRAY['app_api', 'app_worker', 'app_anon']) AS r(role),
                unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS p(priv)`,
      );
      expect(privs.rows.filter((r) => r.has)).toEqual([]);
      await expect(
        c.query('SELECT count(*) FROM core.payout_payout_account'),
      ).rejects.toMatchObject({
        code: '42501',
      });
    });
  });

  it('critère 1 : compte au nom de l’hôte ⇒ enregistré PENDING, numéro chiffré, 4 derniers seuls en clair ; vérifié par le PSP ⇒ VERIFIED ; audit sans aucun numéro', async () => {
    await withRole('app_api', async (c) => {
      const h = await readyHost(c, country);
      const ctx = await context(c, h.p.token, h.org);
      expect(ctx).toMatchObject({ outcome: 'OK', country_code: country, currency: cc.currency });
      expect(ctx.tax_kind).toBe(TAX_KINDS.get(country)?.[0]);
      // l'enveloppe rendue au titulaire est celle de son profil fiscal (comparaison par l'API)
      expect(openEnvelope(h.tax!.dek, ctx.tax_id_enc as Buffer, h.tax!.aad).toString('utf8')).toBe(
        h.tax!.plain,
      );

      const a = newAccount(country, h.org);
      const r = await register(c, h.p.token, h.org, a.input);
      expect(r.outcome).toBe('REGISTERED');
      // premier compte : aucune retenue de changement
      expect(r.change_hold_until).toBeNull();
      const rows = await accounts(c, h.org);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        status: 'PENDING',
        currency: cc.currency,
        account_last4: a.plain.slice(-4),
        holder_name: `${GIVEN} ${SURNAMES}`,
        holder_tax_id_kind: TAX_KINDS.get(country)?.[0],
      });
      const enc = rows[0]!.account_number_enc;
      expect(enc.toString('latin1')).not.toContain(a.plain);
      expect(openEnvelope(a.sealed.dek, enc, a.sealed.aad).toString('utf8')).toBe(a.plain);
      // non vérifié : versement retenu
      expect(await holdOf(h.org, cc.currency, new Date())).toEqual(['PAYOUT_ACCOUNT_UNVERIFIED']);

      const ref = `fk_pa_${randomBytes(6).toString('hex')}`;
      expect(await record(c, h.p.token, h.org, r.account_id, 'VERIFIED', null, ref)).toEqual({
        outcome: 'APPLIED',
      });
      expect(await record(c, h.p.token, h.org, r.account_id, 'VERIFIED', null, ref)).toEqual({
        outcome: 'DUPLICATE',
      });
      expect(
        await record(c, h.p.token, h.org, r.account_id, 'REJECTED', 'HOLDER_MISMATCH', null),
      ).toEqual({ outcome: 'CONFLICT' });
      expect(await holdOf(h.org, cc.currency, new Date())).toEqual([]);
      // autre devise que celle du pays : aucun compte pour ce versement (fail-closed)
      expect(await holdOf(h.org, cc.currency === 'USD' ? 'PYG' : 'USD', new Date())).toEqual([
        'PAYOUT_ACCOUNT_MISSING',
      ]);
      expect(await state(c, h.p.token, h.org)).toMatchObject({
        outcome: 'OK',
        status: 'VERIFIED',
        account_last4: a.plain.slice(-4),
        change_hold_until: null,
        reject_reason: null,
      });

      const log = await audit(c, h.org);
      expect(log.map((l) => l.action_code)).toEqual([
        'PAYOUT_ACCOUNT_REGISTERED',
        'PAYOUT_ACCOUNT_VERIFICATION_RECORDED',
      ]);
      const text = JSON.stringify(log);
      for (const secret of [a.plain, a.plain.slice(-4), h.tax!.plain]) {
        expect(text).not.toContain(secret);
      }
    });
  });

  it('critère 1 : titulaire discordant ⇒ PAYOUT_HOLDER_MISMATCH, rien n’est écrit ; PSP qui refuse le titulaire ou la pièce ⇒ REJECTED, motif rendu, aucun versement', async () => {
    await withRole('app_api', async (c) => {
      const h = await readyHost(c, country);
      expect((await context(c, h.p.token, h.org, 'Otro', 'Titular')).outcome).toBe(
        'PAYOUT_HOLDER_MISMATCH',
      );
      const a = newAccount(country, h.org);
      expect((await register(c, h.p.token, h.org, a.input, 'Otro', 'Titular')).outcome).toBe(
        'PAYOUT_HOLDER_MISMATCH',
      );
      expect(await accounts(c, h.org)).toEqual([]);
      expect(await audit(c, h.org)).toEqual([]);
      expect(await holdOf(h.org, cc.currency, new Date())).toEqual(['PAYOUT_ACCOUNT_MISSING']);

      // nom concordant (règle tolérante : casse, accents) mais pièce refusée par le PSP
      const r = await register(c, h.p.token, h.org, a.input, 'ana maria', 'perez gomez');
      expect(r.outcome).toBe('REGISTERED');
      expect(
        await record(c, h.p.token, h.org, r.account_id, 'REJECTED', 'TAX_ID_MISMATCH', null),
      ).toEqual({ outcome: 'APPLIED' });
      expect(await state(c, h.p.token, h.org)).toMatchObject({
        status: 'REJECTED',
        reject_reason: 'TAX_ID_MISMATCH',
      });
      expect(await holdOf(h.org, cc.currency, new Date())).toEqual(['PAYOUT_ACCOUNT_MISSING']);
      // motif hors liste fermée ⇒ refus
      const b = newAccount(country, h.org);
      const r2 = await register(c, h.p.token, h.org, b.input);
      expect(await record(c, h.p.token, h.org, r2.account_id, 'REJECTED', 'OTHER', null)).toEqual({
        outcome: 'REQUEST_INVALID',
      });
    });
  });

  it('OQ-P2P-07 / OQ-PAY-09 : sans numéro fiscal ⇒ HOST_TAX_ID_REQUIRED ; KYC non approuvé ⇒ HOST_KYC_REQUIRED ; sous-marchand ACTIVE sans numéro ⇒ hôte non activable', async () => {
    await withRole('app_api', async (c) => {
      const h = await readyHost(c, country, { tax: false });
      expect((await context(c, h.p.token, h.org)).outcome).toBe('HOST_TAX_ID_REQUIRED');
      expect((await register(c, h.p.token, h.org, newAccount(country, h.org).input)).outcome).toBe(
        'HOST_TAX_ID_REQUIRED',
      );
      expect(await accounts(c, h.org)).toEqual([]);
      // capacité SUPPORTS_PAYOUT_WITHOUT_HOST_TAX_ID inconnue (= « non ») : activation bloquée
      await c.query('SELECT test_fixture.us123_set_submerchant($1, $2)', [h.org, 'ACTIVE']);
      const k = await one<{ blockers: string[] }>(
        c,
        'SELECT blockers FROM core.kyc_host_state($1, $2)',
        [h.p.token, h.org],
      );
      expect(k.blockers).toContain('HOST_TAX_ID_REQUIRED');
      // types admis du pays (données CFG) : au Paraguay, le seul est le RUC ; sans lui, aucun compte
      expect(TAX_KINDS.get(country)?.length).toBeGreaterThan(0);

      const noKyc = await readyHost(c, country, { kyc: false });
      expect((await context(c, noKyc.p.token, noKyc.org)).outcome).toBe('HOST_KYC_REQUIRED');
      expect(
        (await register(c, noKyc.p.token, noKyc.org, newAccount(country, noKyc.org).input)).outcome,
      ).toBe('HOST_KYC_REQUIRED');
    });
  });

  it('critère 3 : co-hôte ⇒ refus partout (même réponse qu’un compte inconnu) ; autre hôte ⇒ refus ; sans session ⇒ AUTH_REQUIRED', async () => {
    await withRole('app_api', async (c) => {
      const h = await readyHost(c, country);
      const a = newAccount(country, h.org);
      const r = await register(c, h.p.token, h.org, a.input);
      expect(r.outcome).toBe('REGISTERED');
      const cohost = await one<{ id: string }>(c, 'SELECT test_fixture.hard_add_cohost($1) AS id', [
        h.org,
      ]);
      const co = await session(c, cohost.id);
      const other = await readyHost(c, country);
      for (const token of [co, other.p.token]) {
        expect((await state(c, token, h.org)).outcome).toBe('FORBIDDEN');
        expect((await context(c, token, h.org)).outcome).toBe('FORBIDDEN');
        expect((await register(c, token, h.org, newAccount(country, h.org).input)).outcome).toBe(
          'FORBIDDEN',
        );
        expect(
          await record(c, token, h.org, r.account_id, 'VERIFIED', null, 'fk_pa_forged'),
        ).toEqual({ outcome: 'FORBIDDEN' });
      }
      // le compte d'un autre hôte ne se décide pas depuis le sien
      expect(
        await record(c, other.p.token, other.org, r.account_id, 'VERIFIED', null, 'fk_pa_x'),
      ).toEqual({ outcome: 'FORBIDDEN' });
      const none = newToken().hash;
      expect((await state(c, none, h.org)).outcome).toBe('AUTH_REQUIRED');
      expect((await register(c, none, h.org, a.input)).outcome).toBe('AUTH_REQUIRED');
      // rien n'a changé
      const rows = await accounts(c, h.org);
      expect(rows.map((x) => x.status)).toEqual(['PENDING']);
    });
  });

  it('critère 2 : changement de compte ⇒ versement prévu dans les 48 h ON_HOLD (PAYOUT_ACCOUNT_CHANGE_HOLD), au-delà libre ; ancien compte REPLACED', async () => {
    await withRole('app_api', async (c) => {
      const h = await readyHost(c, country);
      const first = await register(c, h.p.token, h.org, newAccount(country, h.org).input);
      expect(
        await record(c, h.p.token, h.org, first.account_id, 'VERIFIED', null, 'fk_pa_first'),
      ).toEqual({ outcome: 'APPLIED' });

      const before = Date.now();
      const second = await register(c, h.p.token, h.org, newAccount(country, h.org).input);
      expect(second.outcome).toBe('REGISTERED');
      const until = second.change_hold_until!.getTime();
      expect(until).toBeGreaterThanOrEqual(before + holdH * HOUR - 60_000);
      expect(until).toBeLessThanOrEqual(Date.now() + holdH * HOUR + 60_000);
      const rows = await accounts(c, h.org);
      expect(rows.map((x) => x.status)).toEqual(['REPLACED', 'PENDING']);

      // nouveau compte non encore vérifié : retenu, et dans la fenêtre de changement
      expect(await holdOf(h.org, cc.currency, new Date(Date.now() + 24 * HOUR))).toEqual([
        'PAYOUT_ACCOUNT_UNVERIFIED',
        'PAYOUT_ACCOUNT_CHANGE_HOLD',
      ]);
      expect(
        await record(c, h.p.token, h.org, second.account_id, 'VERIFIED', null, 'fk_pa_second'),
      ).toEqual({ outcome: 'APPLIED' });
      // vérifié : un versement prévu dans les 48 h reste ON_HOLD, après la fenêtre il part
      expect(await holdOf(h.org, cc.currency, new Date(Date.now() + 24 * HOUR))).toEqual([
        'PAYOUT_ACCOUNT_CHANGE_HOLD',
      ]);
      expect(await holdOf(h.org, cc.currency, new Date(until + 60_000))).toEqual([]);
      expect((await state(c, h.p.token, h.org)).change_hold_until?.getTime()).toBe(until);
      // l'ancien compte, remplacé, ne se décide plus
      expect(
        await record(c, h.p.token, h.org, first.account_id, 'REJECTED', 'ACCOUNT_INVALID', null),
      ).toEqual({ outcome: 'CONFLICT' });
      const log = await audit(c, h.org);
      expect(log.filter((l) => l.action_code === 'PAYOUT_ACCOUNT_REGISTERED')).toHaveLength(2);
    });
  });

  it('critère 2, fail-closed : retenue absente ⇒ retenue sans fin ; rails absents ⇒ HOST_PAYOUT_RAIL_UNAVAILABLE ; rail ou établissement hors configuration ⇒ refus', async () => {
    await withRole('app_api', async (c) => {
      const h = await readyHost(c, country);
      const first = await register(c, h.p.token, h.org, newAccount(country, h.org).input);
      await record(c, h.p.token, h.org, first.account_id, 'VERIFIED', null, 'fk_pa_one');
      await withParam(c, 'payout_account_change_hold_h', country, null, async () => {
        const r = await register(c, h.p.token, h.org, newAccount(country, h.org).input);
        expect(r.outcome).toBe('REGISTERED');
        // 'infinity' (timestamptz) : rendu Infinity par le pilote pg
        expect(String(r.change_hold_until)).toMatch(/^infinity$/i);
      });
      await withParam(c, 'payout_account_rails', country, null, async () => {
        expect((await context(c, h.p.token, h.org)).outcome).toBe('HOST_PAYOUT_RAIL_UNAVAILABLE');
        expect((await state(c, h.p.token, h.org)).rails).toBeNull();
      });
      // rail non configuré dans le pays
      const kinds = Object.keys(RAILS[country] ?? {});
      const missing = ['BANK_ACCOUNT', 'WALLET'].find((k) => !kinds.includes(k));
      if (missing !== undefined) {
        const a = newAccount(country, h.org);
        expect((await register(c, h.p.token, h.org, { ...a.input, kind: missing })).outcome).toBe(
          'PAYOUT_RAIL_UNSUPPORTED',
        );
      }
      for (const kind of kinds) {
        const rail = RAILS[country]![kind]!;
        const a = newAccount(country, h.org, kind);
        const bad = rail.institutions !== undefined ? 'NOT_LISTED' : 'AB';
        expect(
          (await register(c, h.p.token, h.org, { ...a.input, institution: bad })).outcome,
        ).toBe(
          rail.institutions !== undefined ? 'PAYOUT_RAIL_UNSUPPORTED' : 'PAYOUT_ACCOUNT_INVALID',
        );
      }
      // forme : enveloppe ou 4 derniers caractères invalides ⇒ REQUEST_INVALID
      const a = newAccount(country, h.org);
      expect(
        (await register(c, h.p.token, h.org, { ...a.input, enc: Buffer.from('clair') })).outcome,
      ).toBe('REQUEST_INVALID');
      expect((await register(c, h.p.token, h.org, { ...a.input, last4: '12' })).outcome).toBe(
        'REQUEST_INVALID',
      );
      expect((await accounts(c, h.org)).map((x) => x.status)).toEqual(['VERIFIED']);
    });
  });
});
