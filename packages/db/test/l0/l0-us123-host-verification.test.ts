/**
 * Preuves de l'inscription et de la vérification individuelle de l'hôte (US-123, migration 0075 ;
 * fixtures 9986) sous le rôle de production app_api (assertion L0-05 en tête de chaque connexion,
 * withRole), au Panama (USD) et au Paraguay (PYG). Chaque test crée ses propres personnes, comptes
 * d'hôte, dossiers d'identité et membres du staff par les VRAIES commandes (inscription avec
 * consentements, vérification d'e-mail, session, consentement biométrique, parcours d'identité,
 * compte d'hôte, CGU de l'hôte, élévation TOTP) ; le téléphone vérifié est posé par la fixture
 * 9996 et le sous-marchand du PSP par la fixture 9986. AUCUN interrupteur n'est écrit.
 *
 * Attendus tirés de 19 US-123 (critères 1 à 6), de 16 HST-049 / FIN-008 / VER-028 / A.8, de 17
 * §0.1, §2.4, §4.5, de 08 BR-ACC-06, de 22 OQ-P2P-01 / OQ-P2P-07 et des données CFG
 * (`params.json` : `host_min_age_years`, `p2p_host_requires_tax_id` ; `countries.json` :
 * `hostTaxIdKinds`), jamais du code testé :
 * - critère 1 : 20 ans, `host_min_age_years` = 21 ⇒ refus HOST_UNDER_AGE (rien n'est écrit) ;
 * - critère 2 : personne morale ⇒ HOST_ENTITY_NOT_ALLOWED ;
 * - critère 3 : sans numéro fiscal (RUC au Paraguay) ⇒ dossier incomplet, non approuvable, hôte
 *   non activable ; numéro chiffré (C2), jamais en clair ;
 * - critère 4 : KYC approuvé, sous-marchand non ACTIVE ⇒ activation refusée
 *   (HOST_PAYOUT_RAIL_UNAVAILABLE) ;
 * - critère 5 : correspondance de sanctions ⇒ dossier bloqué, motif journalisé, aucune donnée de
 *   la liste hors du dossier ;
 * - critère 6 : interrupteurs à false ⇒ PENDING_ACTIVATION ; aucun hôte ACTIVE tant que
 *   `insurer_contract_active[pays]` vaut false (17 §0.1) ;
 * - N-28 (résidence vérifiée prioritaire), N-38 (âge revérifié à l'activation), N-66 (CGU).
 */
import { randomBytes, randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { columnAad, open as openEnvelope, seal } from '../../src/audit/index.ts';
import { setSessionContext } from '../../src/index.ts';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES, uuid } from '../support/avl.ts';
import { newToken, phcArgon2id, SESSION_TTL_S } from '../support/iam.ts';
import {
  farInstant,
  openSwitchWindow,
  ensureClosed,
  newHash,
  plusMinutes,
} from '../support/golive.ts';
import type { StaffActor } from '../support/golive.ts';
import { staff as rlsStaff, staffSessionHash } from '../support/rls.ts';
import { auditOf, elevatedStaff, installTestProofKey } from '../support/staff.ts';

const DOCS = '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]';
const PROVIDER = 'FAKE';
const SCREENER = 'FAKE';
const REASON = 'Dossier de l’hôte relu par l’ops';

const cfg = (file: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(`../../../../apps/api/src/modules/cfg/data/${file}`, import.meta.url),
      'utf8',
    ),
  );

interface CountryData {
  code: string;
  hostTaxIdKinds: string[];
  phone: { callingCode: string; nationalLength: number; mobilePrefixes: string[] };
}
const COUNTRY_DATA = new Map(
  (cfg('countries.json') as { countries: CountryData[] }).countries.map((c) => [c.code, c]),
);
const paramValues = (key: string): Record<string, unknown> =>
  (
    cfg('params.json') as { params: { key: string; values?: Record<string, unknown> }[] }
  ).params.find((p) => p.key === key)?.values ?? {};
/** 17 §7.2 `host_min_age_years` (OQ-P2P-01 : 21 ans), par pays (données CFG). */
const MIN_AGE = paramValues('host_min_age_years');
/** 17 §7.2 `p2p_host_requires_tax_id` (OQ-P2P-07 : true), par pays (données CFG). */
const TAX_REQUIRED = paramValues('p2p_host_requires_tax_id');

function data(country: string): CountryData {
  const d = COUNTRY_DATA.get(country);
  if (d === undefined) throw new Error(`pays absent des données CFG : ${country}`);
  return d;
}

function phoneOf(country: string): string {
  const p = data(country).phone;
  const prefix = p.mobilePrefixes[0] ?? '';
  let rest = '';
  while (rest.length < p.nationalLength - prefix.length) rest += String(randomInt(10));
  return `+${p.callingCode}${prefix}${rest}`;
}

/** Date ISO (AAAA-MM-JJ) de naissance d'une personne de `years` ans (et `extraDays` de plus). */
function bornYearsAgo(years: number, extraDays = 0): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() - extraDays);
  return d.toISOString().slice(0, 10);
}

const isoDay = (days: number): string =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const one = async <T extends pg.QueryResultRow>(
  client: pg.ClientBase,
  sql: string,
  params: unknown[],
): Promise<T> => {
  const { rows } = await client.query<T>(sql, params);
  return rows[0] as T;
};

const fixture = <T extends pg.QueryResultRow>(c: pg.ClientBase, fn: string, arg: unknown) =>
  c.query<T>(`SELECT * FROM test_fixture.${fn}($1)`, [arg]).then((r) => r.rows);

/**
 * Membre du staff élevé par TOTP : la clé de preuve de TEST est (ré)installée d'abord, pour ne pas
 * dépendre de l'ordre des fichiers (une autre preuve peut la retirer puis la reposer).
 */
async function elevated(c: pg.ClientBase, role: string, scope: readonly string[]) {
  await installTestProofKey(c);
  return elevatedStaff(c, role, scope);
}

interface Person {
  readonly userId: string;
  readonly token: Buffer;
}

/** Personne inscrite, e-mail vérifié, session ouverte, téléphone vérifié (fixture 9996). */
async function person(client: pg.ClientBase, country: string): Promise<Person> {
  const userId = uuid();
  const verification = newToken();
  const r = await one<{ ok: boolean }>(
    client,
    `SELECT core.iam_cmd_register_with_consents($1, $2, $3, 'Ana María', 'Pérez Gómez', 'es', $4,
                                                $5, 86400, NULL, $6, $7::jsonb, false) AS ok`,
    [
      userId,
      `host-${userId}@example.test`,
      phcArgon2id(),
      uuid(),
      verification.hash,
      country,
      DOCS,
    ],
  );
  if (r.ok !== true) throw new Error('inscription de test refusée');
  const v = await one<{ ok: boolean }>(client, 'SELECT core.iam_cmd_verify_email($1) AS ok', [
    verification.hash,
  ]);
  if (v.ok !== true) throw new Error('vérification d’e-mail refusée');
  const t = newToken();
  const s = await one<{ expires_at: Date | null }>(
    client,
    `SELECT core.iam_cmd_open_session($1, $2, $3, $4, 'NONE', NULL, 'vitest') AS expires_at`,
    [uuid(), userId, t.hash, SESSION_TTL_S],
  );
  if (!s.expires_at) throw new Error('session refusée');
  await client.query('SELECT test_fixture.us105_verify_phone($1, $2)', [userId, phoneOf(country)]);
  return { userId, token: t.hash };
}

interface Facts {
  readonly dateOfBirth?: string | null;
  readonly residenceCountry?: string | null;
}

/**
 * Vérification d'identité APPROUVÉE par les vraies commandes de 0072 (consentement, ouverture,
 * session) et le rappel signé appliqué avec les faits vérifiés (0075). Rend l'issue du rappel.
 */
async function kycApproved(
  c: pg.ClientBase,
  p: Person,
  country: string,
  facts: Facts,
  eventId = `fk_idv_evt_${randomBytes(6).toString('hex')}`,
): Promise<{ outcome: string; status: string | null; sessionRef: string; verificationId: string }> {
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
  const subject: Record<string, unknown> = {};
  if (facts.dateOfBirth !== undefined) subject['dateOfBirth'] = facts.dateOfBirth;
  if (facts.residenceCountry !== undefined) subject['residenceCountry'] = facts.residenceCountry;
  const r = await applyFacts(c, eventId, sessionRef, o.verification_id, country, subject);
  return { ...r, sessionRef, verificationId: o.verification_id };
}

const applyFacts = (
  c: pg.ClientBase,
  eventId: string,
  sessionRef: string,
  subjectRef: string,
  country: string,
  subject: Record<string, unknown> | null,
) =>
  one<{ outcome: string; status: string | null }>(
    c,
    'SELECT * FROM core.kyc_cmd_decide_with_facts($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)',
    [
      PROVIDER,
      eventId,
      sessionRef,
      subjectRef,
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
      }),
      subject === null ? null : JSON.stringify(subject),
    ],
  );

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

async function acceptTerms(c: pg.ClientBase, p: Person, org: string): Promise<void> {
  const t = await one<{ outcome: string; version: number }>(
    c,
    'SELECT * FROM core.ctr_host_terms($1, $2, $3)',
    [p.token, org, 'es'],
  );
  expect(t.outcome).toBe('OK');
  const a = await one<{ outcome: string }>(
    c,
    'SELECT * FROM core.ctr_cmd_accept_host_terms($1, $2, $3, $4)',
    [p.token, org, t.version, 'es'],
  );
  expect(a.outcome).toBe('DONE');
}

/** Numéro fiscal de test (chiffres, jamais un vrai numéro) et son enveloppe par la clé du sujet. */
function sealedTaxId(org: string): { plain: string; dek: Buffer; enc: Buffer } {
  const plain = `${String(randomInt(1_000_000, 9_999_999))}-${String(randomInt(10))}`;
  const dek = randomBytes(32);
  const enc = seal(
    dek,
    Buffer.from(plain, 'utf8'),
    columnAad('core.kyc_host_tax_profile', 'tax_id_enc', { type: 'ORG', id: org }),
  );
  return { plain, dek, enc };
}

const saveTax = (
  c: pg.ClientBase,
  p: Person,
  org: string,
  kind: string,
  enc: Buffer,
  taxpayer = 'INDIVIDUAL',
  regime: string | null = null,
) =>
  one<{ outcome: string }>(
    c,
    'SELECT * FROM core.kyc_cmd_host_save_tax_profile($1, $2, $3, $4, $5, $6)',
    [p.token, org, kind, enc, regime, taxpayer],
  );

interface Submitted {
  readonly outcome: string;
  readonly verification_id: string | null;
  readonly status: string | null;
  readonly missing: string[] | null;
  readonly screening_key: string | null;
  readonly identity_provider: string | null;
  readonly identity_session_ref: string | null;
}
const submit = (c: pg.ClientBase, p: Person, org: string) =>
  one<Submitted>(c, 'SELECT * FROM core.kyc_cmd_host_submit($1, $2)', [p.token, org]);

const LISTS = { UN: '2026-11-01', OFAC: '2026-11-10', NATIONAL: 'v42' };
const screen = (
  c: pg.ClientBase,
  p: Person,
  org: string,
  key: string | null,
  result: string,
  matchRef: string | null = null,
) =>
  one<{ outcome: string; status: string | null; missing: string[] | null }>(
    c,
    'SELECT * FROM core.kyc_cmd_host_record_screening($1, $2, $3, $4, $5, $6::jsonb, $7)',
    [p.token, org, SCREENER, key, result, JSON.stringify(LISTS), matchRef],
  );

interface HostState {
  readonly outcome: string;
  readonly country_code: string | null;
  readonly org_status: string | null;
  readonly verification_status: string | null;
  readonly missing: string[] | null;
  readonly kyc_approved: boolean | null;
  readonly age_status: string | null;
  readonly residence_status: string | null;
  readonly tax_required: boolean | null;
  readonly tax_saved: boolean | null;
  readonly tax_kind: string | null;
  readonly tax_kinds: string[] | null;
  readonly terms_ok: boolean | null;
  readonly screening_done: boolean | null;
  readonly blockers: string[] | null;
}
const state = (c: pg.ClientBase, p: Person, org: string) =>
  one<HostState>(c, 'SELECT * FROM core.kyc_host_state($1, $2)', [p.token, org]);

/** État lu à un instant virtuel (fenêtre d'interrupteurs ouverts : base de test seulement). */
const stateAt = (c: pg.ClientBase, p: Person, org: string, at: string) =>
  withTestTransaction(c, { virtualNow: at }, async (tx) => {
    // la session de l'hôte est ouverte à l'instant virtuel (celle d'aujourd'hui y a expiré)
    const t = newToken();
    await tx.query(
      `SELECT core.iam_cmd_open_session($1, $2, $3, $4, 'NONE', NULL, 'vitest') AS expires_at`,
      [uuid(), p.userId, t.hash, SESSION_TTL_S],
    );
    return state(tx, { userId: p.userId, token: t.hash }, org);
  });

interface ActOutcome {
  readonly outcome: string;
  readonly action_id: string | null;
  readonly domain_ref: string | null;
  readonly detail: string | null;
}
/**
 * Action de console (cadre d'US-101), transaction validée ; `at` : instant virtuel (une session
 * élevée neuve est alors ouverte à cet instant pour le même membre du staff).
 */
function act(
  client: pg.ClientBase,
  staff: { readonly userId: string; readonly hash: Buffer },
  action: 'HOST_VERIFICATION_DECISION' | 'HOST_SCREENING_REVIEW',
  org: string,
  decision: string,
  scope: readonly string[],
  at?: string,
): Promise<ActOutcome> {
  return withTestTransaction(
    client,
    { commit: true, ...(at === undefined ? {} : { virtualNow: at }) },
    async (tx) => {
      let hash = staff.hash;
      if (at !== undefined) {
        hash = newHash();
        await tx.query('SELECT test_fixture.iam_open_elevated_session($1, $2)', [
          staff.userId,
          hash,
        ]);
      }
      await setSessionContext(tx, {
        kind: 'STAFF',
        actorId: staff.userId,
        countryScope: scope,
        sessionTokenHash: hash.toString('hex'),
      });
      const { rows } = await tx.query<ActOutcome>(
        'SELECT * FROM core.iam_staff_cmd_manual_action($1, $2, $3, $4, $5, $6::jsonb, $7::uuid[])',
        [hash, uuid(), action, org, REASON, { decision }, []],
      );
      return rows[0] ?? { outcome: '', action_id: null, domain_ref: null, detail: null };
    },
  );
}

/** Décision HOST_VERIFICATION_DECISION par la console. */
const decide = (
  client: pg.ClientBase,
  staff: { readonly userId: string; readonly hash: Buffer },
  org: string,
  decision: 'APPROVED' | 'REJECTED',
  scope: readonly string[],
  at?: string,
): Promise<ActOutcome> =>
  act(client, staff, 'HOST_VERIFICATION_DECISION', org, decision, scope, at);

interface Ready {
  readonly p: Person;
  readonly org: string;
  readonly submitted: Submitted;
}

/**
 * Hôte complet : identité approuvée (faits vérifiés : 30 ans, résidence du pays), compte d'hôte,
 * CGU de l'hôte acceptées, profil fiscal du premier type admis dans le pays, dossier soumis et
 * filtrage CLEAR consigné. Les options retirent une pièce.
 */
async function readyHost(
  c: pg.ClientBase,
  country: string,
  options: { readonly tax?: boolean; readonly terms?: boolean; readonly screening?: string } = {},
): Promise<Ready> {
  const p = await person(c, country);
  expect(
    await kycApproved(c, p, country, {
      dateOfBirth: bornYearsAgo(30),
      residenceCountry: country,
    }),
  ).toMatchObject({ outcome: 'APPLIED', status: 'APPROVED' });
  const org = await hostAccount(c, p, country);
  if (options.terms !== false) await acceptTerms(c, p, org);
  if (options.tax !== false) {
    const kind = data(country).hostTaxIdKinds[0] ?? '';
    expect(await saveTax(c, p, org, kind, sealedTaxId(org).enc)).toEqual({ outcome: 'SAVED' });
  }
  const s = await submit(c, p, org);
  expect(s.outcome).toBe('SUBMITTED');
  if (options.screening !== 'NONE') {
    const r = await screen(c, p, org, s.screening_key, options.screening ?? 'CLEAR', null);
    expect(r.outcome).toBe('RECORDED');
  }
  return { p, org, submitted: s };
}

describe.each(COUNTRIES)('US-123 — inscription et KYC de l’hôte, $country ($currency)', (cc) => {
  const country = cc.country;
  const minAge = Number(MIN_AGE[country]);

  it('données de test : âge minimal et numéro fiscal exigé tirés de la configuration (17 §7.2)', async () => {
    await withRole('app_api', async () => undefined); // L0-05
    // OQ-P2P-01 (21 ans) et OQ-P2P-07 (numéro fiscal exigé) : défauts PROPOSÉS des données CFG
    expect(minAge).toBe(21);
    expect(TAX_REQUIRED[country]).toBe(true);
    expect(data(country).hostTaxIdKinds.length).toBeGreaterThan(0);
  });

  it('critère 1 : 20 ans au compte vérifié ⇒ HOST_UNDER_AGE, aucun dossier ; 21 ans ⇒ soumis', async () => {
    await withRole('app_api', async (c) => {
      const young = await person(c, country);
      expect(
        await kycApproved(c, young, country, {
          dateOfBirth: bornYearsAgo(minAge - 1),
          residenceCountry: country,
        }),
      ).toMatchObject({ outcome: 'APPLIED', status: 'APPROVED' });
      // fait vérifié consigné (C2), une ligne pour la tentative décidée
      expect(await fixture(c, 'us123_subject', young.userId)).toHaveLength(1);
      const org = await hostAccount(c, young, country);
      expect((await submit(c, young, org)).outcome).toBe('HOST_UNDER_AGE');
      expect(await fixture(c, 'us123_dossier', org)).toEqual([]);
      expect(await fixture(c, 'us123_audit', org).then((a) => a.map((r) => r.action_code))).toEqual(
        ['HOST_ACCOUNT_OPENED'],
      );
      expect((await state(c, young, org)).age_status).toBe('UNDER_AGE');

      // exactement l'âge minimal (né il y a 21 ans et un jour) : soumission acceptée
      const adult = await person(c, country);
      await kycApproved(c, adult, country, {
        dateOfBirth: bornYearsAgo(minAge, 1),
        residenceCountry: country,
      });
      const org2 = await hostAccount(c, adult, country);
      const s = await submit(c, adult, org2);
      expect(s.outcome).toBe('SUBMITTED');
      expect((await fixture(c, 'us123_dossier', org2))[0]).toMatchObject({
        age_ok: true,
        residence_verified: true,
        country_code: country,
      });
    });
  });

  it('date de naissance inconnue ⇒ HOST_AGE_UNVERIFIED ; KYC non approuvé ⇒ HOST_KYC_REQUIRED', async () => {
    await withRole('app_api', async (c) => {
      const p = await person(c, country);
      const org = await hostAccount(c, p, country);
      expect((await submit(c, p, org)).outcome).toBe('HOST_KYC_REQUIRED');
      await kycApproved(c, p, country, { residenceCountry: country });
      expect((await submit(c, p, org)).outcome).toBe('HOST_AGE_UNVERIFIED');
      expect(await fixture(c, 'us123_dossier', org)).toEqual([]);
    });
  });

  it('critère 2 : personne morale ⇒ HOST_ENTITY_NOT_ALLOWED (compte et profil fiscal)', async () => {
    await withRole('app_api', async (c) => {
      const p = await person(c, country);
      const company = await one<{ outcome: string }>(
        c,
        'SELECT * FROM core.iam_cmd_open_host_account($1, $2, $3)',
        [p.token, country, 'LEGAL_ENTITY'],
      );
      expect(company.outcome).toBe('HOST_ENTITY_NOT_ALLOWED');
      const org = await hostAccount(c, p, country);
      const kind = data(country).hostTaxIdKinds[0] ?? '';
      expect(await saveTax(c, p, org, kind, sealedTaxId(org).enc, 'LEGAL_ENTITY')).toEqual({
        outcome: 'HOST_ENTITY_NOT_ALLOWED',
      });
      expect(await fixture(c, 'us123_tax_profile', org)).toEqual([]);
    });
  });

  it('critère 3 : sans numéro fiscal ⇒ dossier incomplet, non approuvable, compte non activable', async () => {
    await withRole('app_api', async (c) => {
      const ops = await elevated(c, 'OPS_AGENT', [country]);
      const { p, org } = await readyHost(c, country, { tax: false });
      const d = (await fixture<{ status: string; missing: string[] }>(c, 'us123_dossier', org))[0];
      expect(d).toMatchObject({ status: 'DOCS_PENDING', missing: ['HOST_TAX_ID_REQUIRED'] });
      const st = await state(c, p, org);
      expect(st).toMatchObject({ tax_required: true, tax_saved: false, tax_kind: null });
      expect(st.tax_kinds).toEqual(data(country).hostTaxIdKinds);
      expect(st.blockers).toContain('HOST_TAX_ID_REQUIRED');
      const r = await decide(c, ops, org, 'APPROVED', [country]);
      expect(r).toMatchObject({ outcome: 'REFUSED', detail: 'HOST_TAX_ID_REQUIRED' });
      expect(await fixture(c, 'us123_org_status', org)).toEqual([
        { us123_org_status: 'ONBOARDING' },
      ]);
      expect((await fixture(c, 'us123_dossier', org))[0]).toMatchObject({ status: 'DOCS_PENDING' });
    });
  });

  it('critère 3 : type de numéro admis par le pays seulement ; numéro chiffré par la clé du sujet (C2)', async () => {
    await withRole('app_api', async (c) => {
      const p = await person(c, country);
      const org = await hostAccount(c, p, country);
      const kinds = data(country).hostTaxIdKinds;
      // un type d'un AUTRE pays, absent de la liste de celui-ci : refusé
      const foreign = [...COUNTRY_DATA.values()]
        .flatMap((d) => d.hostTaxIdKinds)
        .find((k) => !kinds.includes(k));
      if (foreign !== undefined) {
        expect(await saveTax(c, p, org, foreign, sealedTaxId(org).enc)).toEqual({
          outcome: 'HOST_TAX_ID_KIND_INVALID',
        });
      }
      // enveloppe absente ou en clair : refusée
      expect(
        await saveTax(c, p, org, kinds[0] ?? '', Buffer.from('12345678-9-plain-text-value-xx')),
      ).toEqual({ outcome: 'REQUEST_INVALID' });
      const t = sealedTaxId(org);
      expect(await saveTax(c, p, org, kinds[0] ?? '', t.enc, 'INDIVIDUAL', 'GENERAL')).toEqual({
        outcome: 'SAVED',
      });
      const [row] = await fixture<{
        tax_id_kind: string;
        tax_id_enc: Buffer;
        tax_id_key_subject_type: string;
        tax_id_key_subject_id: string;
        regime: string | null;
        taxpayer_kind: string;
      }>(c, 'us123_tax_profile', org);
      expect(row).toMatchObject({
        tax_id_kind: kinds[0],
        tax_id_key_subject_type: 'ORG',
        tax_id_key_subject_id: org,
        regime: 'GENERAL',
        taxpayer_kind: 'INDIVIDUAL',
      });
      if (row === undefined) throw new Error('profil absent');
      // jamais en clair ; lisible avec la clé du sujet et l'AAD de la colonne seulement
      expect(row.tax_id_enc.includes(Buffer.from(t.plain, 'utf8'))).toBe(false);
      expect(
        openEnvelope(
          t.dek,
          row.tax_id_enc,
          columnAad('core.kyc_host_tax_profile', 'tax_id_enc', { type: 'ORG', id: org }),
        ).toString('utf8'),
      ).toBe(t.plain);
      expect(() =>
        openEnvelope(
          t.dek,
          row.tax_id_enc,
          columnAad('core.kyc_host_tax_profile', 'tax_id_enc', { type: 'ORG', id: uuid() }),
        ),
      ).toThrow();
      // l'audit ne porte que le type, jamais le numéro
      const audit = (
        await fixture<{ action_code: string; after: unknown }>(c, 'us123_audit', org)
      ).filter((a) => a.action_code === 'HOST_TAX_PROFILE_SAVED');
      expect(audit).toHaveLength(1);
      expect(JSON.stringify(audit)).not.toContain(t.plain);
    });
  });

  it('critère 4 : KYC approuvé mais sous-marchand du PSP non ACTIVE ⇒ activation refusée', async () => {
    await withRole('app_api', async (c) => {
      const ops = await elevated(c, 'OPS_AGENT', [country]);
      const { p, org } = await readyHost(c, country);
      expect((await fixture(c, 'us123_dossier', org))[0]).toMatchObject({
        status: 'IN_REVIEW',
        missing: [],
      });
      // première décision : dossier approuvé, compte en attente d'activation
      expect((await decide(c, ops, org, 'APPROVED', [country])).outcome).toBe('DONE');
      expect((await fixture(c, 'us123_dossier', org))[0]).toMatchObject({
        status: 'APPROVED',
        decided_by: ops.userId,
        activated_at: null,
      });
      expect((await state(c, p, org)).blockers).toContain('SUBMERCHANT_NOT_ACTIVE');
      // tentative d'activation : refusée, sous-marchand absent puis PENDING chez le PSP
      expect(await decide(c, ops, org, 'APPROVED', [country])).toMatchObject({
        outcome: 'REFUSED',
        detail: 'HOST_PAYOUT_RAIL_UNAVAILABLE',
      });
      await c.query('SELECT test_fixture.us123_set_submerchant($1, $2)', [org, 'PENDING']);
      expect(await decide(c, ops, org, 'APPROVED', [country])).toMatchObject({
        outcome: 'REFUSED',
        detail: 'HOST_PAYOUT_RAIL_UNAVAILABLE',
      });
      expect((await state(c, p, org)).blockers).toContain('SUBMERCHANT_NOT_ACTIVE');
      expect(await fixture(c, 'us123_org_status', org)).toEqual([
        { us123_org_status: 'PENDING_ACTIVATION' },
      ]);
      // les deux vérifications : avec le sous-marchand ACTIVE, ce blocage disparaît (les
      // interrupteurs du pays restent fermés)
      const other = await readyHost(c, country);
      await c.query('SELECT test_fixture.us123_set_submerchant($1, $2)', [other.org, 'ACTIVE']);
      expect((await decide(c, ops, other.org, 'APPROVED', [country])).outcome).toBe('DONE');
      expect((await state(c, other.p, other.org)).blockers).not.toContain('SUBMERCHANT_NOT_ACTIVE');
    });
  });

  it('critère 5 : correspondance de sanctions ⇒ dossier bloqué, motif journalisé, aucune donnée de la liste copiée', async () => {
    await withRole('app_api', async (c) => {
      const ops = await elevated(c, 'OPS_AGENT', [country]);
      const { p, org } = await readyHost(c, country, { screening: 'NONE' });
      const s = await submit(c, p, org);
      expect(s).toMatchObject({ outcome: 'SUBMITTED', identity_provider: PROVIDER });
      expect(s.missing).toEqual(['HOST_SCREENING_MISSING']);
      expect(s.screening_key).toBe(`screening:${s.verification_id ?? ''}:a1`);
      expect(s.identity_session_ref).toMatch(/^fk_idv_/);
      const matchRef = `case_${randomBytes(5).toString('hex')}`;
      expect(await screen(c, p, org, s.screening_key, 'POTENTIAL_MATCH', matchRef)).toMatchObject({
        outcome: 'RECORDED',
        status: 'BLOCKED',
      });
      expect((await fixture(c, 'us123_dossier', org))[0]).toMatchObject({
        status: 'BLOCKED',
        reason_code: 'HOST_SANCTIONS_HIT',
      });
      // dossier : version des listes, résultat, référence opaque (source, date : VER-028)
      expect(await fixture(c, 'us123_screenings', org)).toEqual([
        {
          subject_type: 'PERSON',
          provider: SCREENER,
          request_key: s.screening_key,
          lists_version: LISTS,
          result: 'POTENTIAL_MATCH',
          match_ref: matchRef,
          reviewer: null,
        },
      ]);
      // motif journalisé (code), rien de la liste ailleurs que dans le dossier
      const audit = await fixture<{ action_code: string; after: Record<string, unknown> }>(
        c,
        'us123_audit',
        org,
      );
      const screened = audit.filter((a) => a.action_code === 'HOST_SANCTIONS_SCREENED');
      expect(screened).toHaveLength(1);
      expect(screened[0]?.after).toMatchObject({
        result: 'POTENTIAL_MATCH',
        reasonCode: 'HOST_SANCTIONS_HIT',
      });
      const events = await fixture(c, 'us123_events', org);
      for (const leak of [matchRef, ...Object.values(LISTS)]) {
        expect(JSON.stringify(audit)).not.toContain(leak);
        expect(JSON.stringify(events)).not.toContain(leak);
      }
      // escalade (VER-028) : file de revue de l'ops et événement interne, codes seulement
      expect(await fixture(c, 'us123_queue_items', org)).toEqual([
        { queue: 'HOST_VERIFICATION', status: 'OPEN', decision: null },
      ]);
      const flagged = (
        await fixture<{ type: string; payload: Record<string, unknown> }>(c, 'us123_events', org)
      ).filter((e) => e.type === 'kyc.host_screening.flagged');
      expect(flagged.map((e) => e.payload)).toEqual([
        { org_id: org, verification_id: s.verification_id, reason_code: 'HOST_SANCTIONS_HIT' },
      ]);
      // l'hôte ne peut rien en déduire : rendu comme une revue ordinaire, sans pièce manquante
      const st = await state(c, p, org);
      expect(st).toMatchObject({
        verification_status: 'IN_REVIEW',
        missing: [],
        screening_done: true,
      });
      expect(JSON.stringify(st)).not.toMatch(/SANCTIONS|BLOCKED|MATCH/);
      expect((await submit(c, p, org)).outcome).toBe('DECIDED');
      expect((await screen(c, p, org, s.screening_key, 'CLEAR')).outcome).toBe('DUPLICATE');
      expect(await decide(c, ops, org, 'APPROVED', [country])).toMatchObject({
        outcome: 'REFUSED',
        detail: 'HOST_SANCTIONS_HIT',
      });
      expect(await fixture(c, 'us123_org_status', org)).toEqual([
        { us123_org_status: 'ONBOARDING' },
      ]);
      expect(
        (await auditOf(c, ops.userId)).some((a) => a.action_code === 'MANUAL_ACTION_REFUSED'),
      ).toBe(true);
    });
  });

  it('critère 6 : interrupteurs du pays à false ⇒ PENDING_ACTIVATION, jamais ACTIVE (17 §0.1)', async () => {
    await withRole('app_api', async (c) => {
      const ops = await elevated(c, 'OPS_AGENT', [country]);
      const { p, org } = await readyHost(c, country);
      await c.query('SELECT test_fixture.us123_set_submerchant($1, $2)', [org, 'ACTIVE']);
      // la file de revue de l'ops reçoit le dossier complet
      expect(await fixture(c, 'us123_queue_items', org)).toEqual([
        { queue: 'HOST_VERIFICATION', status: 'OPEN', decision: null },
      ]);
      const r = await decide(c, ops, org, 'APPROVED', [country]);
      expect(r).toMatchObject({ outcome: 'DONE' });
      expect(await fixture(c, 'us123_queue_items', org)).toEqual([
        { queue: 'HOST_VERIFICATION', status: 'DONE', decision: 'APPROVED' },
      ]);
      expect(await fixture(c, 'us123_org_status', org)).toEqual([
        { us123_org_status: 'PENDING_ACTIVATION' },
      ]);
      // interrupteurs fermés (graine : false ; absent = false) : les deux blocages sont visibles
      const st = await state(c, p, org);
      expect(st).toMatchObject({
        org_status: 'PENDING_ACTIVATION',
        verification_status: 'APPROVED',
        country_code: country,
      });
      expect(st.blockers).toEqual(
        expect.arrayContaining(['P2P_HOSTS_DISABLED', 'INSURER_CONTRACT_INACTIVE']),
      );
      expect(st.blockers).not.toContain('SUBMERCHANT_NOT_ACTIVE');
      // aucune activation possible tant que insurer_contract_active vaut false
      expect(await decide(c, ops, org, 'APPROVED', [country])).toMatchObject({
        outcome: 'REFUSED',
        detail: 'HOST_PAYOUT_RAIL_UNAVAILABLE',
      });
      expect(await fixture(c, 'us123_org_status', org)).toEqual([
        { us123_org_status: 'PENDING_ACTIVATION' },
      ]);
      // événements (17 §4.5) : décision, passage en attente ; jamais iam.organization.created
      const events = await fixture<{ type: string; payload: Record<string, unknown> }>(
        c,
        'us123_events',
        org,
      );
      // même milliseconde possible : l'ordre d'insertion n'est pas comparé
      expect(events.map((e) => e.type).sort()).toEqual([
        'iam.organization.status_changed',
        'kyc.host_verification.decided',
      ]);
      const byType = (t: string) => events.find((e) => e.type === t)?.payload;
      expect(byType('kyc.host_verification.decided')).toMatchObject({
        org_id: org,
        decision: 'APPROVED',
      });
      expect(byType('iam.organization.status_changed')).toEqual({
        org_id: org,
        from: 'ONBOARDING',
        to: 'PENDING_ACTIVATION',
      });
    });
  });

  it('revue d’une correspondance (VER-028) : faux positif levé avec motif ⇒ dossier rendu à la revue ; confirmée ⇒ REJECTED', async () => {
    await withRole('app_api', async (c) => {
      const ops = await elevated(c, 'OPS_AGENT', [country]);
      const finance = await elevated(c, 'FINANCE', [country]);
      const hit = async (): Promise<Ready> => {
        const r = await readyHost(c, country, { screening: 'POTENTIAL_MATCH' });
        expect((await fixture(c, 'us123_dossier', r.org))[0]).toMatchObject({ status: 'BLOCKED' });
        return r;
      };
      const a = await hit();
      // sans la permission kyc.decide : FORBIDDEN, rien ne change
      expect(
        (await act(c, finance, 'HOST_SCREENING_REVIEW', a.org, 'CLEARED', [country])).outcome,
      ).toBe('FORBIDDEN');
      expect(
        (await act(c, ops, 'HOST_SCREENING_REVIEW', a.org, 'CLEARED', [country])).outcome,
      ).toBe('DONE');
      expect((await fixture(c, 'us123_dossier', a.org))[0]).toMatchObject({
        status: 'IN_REVIEW',
        reason_code: null,
      });
      expect(await fixture(c, 'us123_screenings', a.org)).toEqual([
        expect.objectContaining({ result: 'POTENTIAL_MATCH', reviewer: null }),
        expect.objectContaining({ provider: 'MANUAL', result: 'CLEAR', reviewer: ops.userId }),
      ]);
      expect(await fixture(c, 'us123_queue_items', a.org)).toEqual([
        { queue: 'HOST_VERIFICATION', status: 'DONE', decision: 'CLEARED' },
        { queue: 'HOST_VERIFICATION', status: 'OPEN', decision: null },
      ]);
      // le faux positif levé, le dossier s'approuve normalement
      expect((await decide(c, ops, a.org, 'APPROVED', [country])).outcome).toBe('DONE');
      // un dossier non bloqué ne se « revoit » pas
      expect(await act(c, ops, 'HOST_SCREENING_REVIEW', a.org, 'CLEARED', [country])).toMatchObject(
        { outcome: 'REFUSED', detail: 'HOST_SCREENING_NOT_BLOCKED' },
      );
      const b = await hit();
      expect(
        (await act(c, ops, 'HOST_SCREENING_REVIEW', b.org, 'CONFIRMED', [country])).outcome,
      ).toBe('DONE');
      expect((await fixture(c, 'us123_dossier', b.org))[0]).toMatchObject({
        status: 'REJECTED',
        reason_code: 'HOST_SANCTIONS_HIT',
        decided_by: ops.userId,
      });
      const audit = await fixture<{ action_code: string; after: Record<string, unknown> }>(
        c,
        'us123_audit',
        b.org,
      );
      expect(audit.find((r) => r.action_code === 'HOST_SCREENING_REVIEWED')?.after).toMatchObject({
        decision: 'CONFIRMED',
      });
    });
  });

  it('HOST_VERIFICATION_DECISION sans la permission ops.review_listing_host ⇒ FORBIDDEN journalisé, rien ne change', async () => {
    await withRole('app_api', async (c) => {
      const finance = await elevated(c, 'FINANCE', [country]);
      const { org } = await readyHost(c, country);
      expect((await decide(c, finance, org, 'APPROVED', [country])).outcome).toBe('FORBIDDEN');
      expect((await auditOf(c, finance.userId)).at(-1)?.action_code).toBe('STAFF_FORBIDDEN');
      expect((await fixture(c, 'us123_dossier', org))[0]).toMatchObject({ status: 'IN_REVIEW' });
    });
  });

  it('chemin ACTIVE (base de test, fenêtre d’horloge lointaine) : capacité bloquante inconnue ⇒ refus ; capacités validées et interrupteurs ouverts par deux personnes ⇒ ACTIVE, iam.organization.created une seule fois', async () => {
    await withRole('app_api', async (c) => {
      const ops = await elevated(c, 'OPS_AGENT', [country]);
      const { p, org } = await readyHost(c, country);
      await c.query('SELECT test_fixture.us123_set_submerchant($1, $2)', [org, 'ACTIVE']);
      expect((await decide(c, ops, org, 'APPROVED', [country])).outcome).toBe('DONE');
      expect(await fixture(c, 'us123_org_status', org)).toEqual([
        { us123_org_status: 'PENDING_ACTIVATION' },
      ]);
      // fenêtre [from, to) : capacités bloquantes du FAKE INCONNUES de from à caps, VALIDÉES de
      // caps à to, inconnues après ; interrupteurs ouverts de from à to par la procédure à deux
      // personnes d'US-125, refermés quoi qu'il arrive
      const from = farInstant();
      const caps = plusMinutes(from, 60);
      const to = plusMinutes(from, 120);
      for (const [status, at] of [
        ['UNKNOWN', from],
        ['VALIDATED_SANDBOX', caps],
        ['UNKNOWN', to],
      ] as const) {
        await c.query('SELECT test_fixture.us123_set_capabilities($1, $2, $3)', [
          country,
          status,
          at,
        ]);
      }
      const people = await withTestTransaction(c, { commit: true }, async (tx) => {
        const admin = await rlsStaff(tx, 'ADMIN', [country]);
        const superadmin = await rlsStaff(tx, 'SUPERADMIN', [country]);
        return [admin, superadmin].map((id): StaffActor => ({
          userId: id,
          hash: Buffer.from(staffSessionHash(id) ?? '', 'hex'),
          scope: [country],
        }));
      });
      const [requester, approver] = people as [StaffActor, StaffActor];
      try {
        for (const key of ['p2p_private_hosts_enabled', 'insurer_contract_active'] as const) {
          await openSwitchWindow(c, requester, approver, key, country, from, to);
        }
        // pays ouvert, capacités inconnues : refus, seul blocage restant la capacité du PSP
        const early = plusMinutes(from, 10);
        expect((await stateAt(c, p, org, early)).blockers).toEqual(['PSP_CAPABILITY_MISSING']);
        expect(await decide(c, ops, org, 'APPROVED', [country], early)).toMatchObject({
          outcome: 'REFUSED',
          detail: 'HOST_PAYOUT_RAIL_UNAVAILABLE',
        });
        expect(await fixture(c, 'us123_org_status', org)).toEqual([
          { us123_org_status: 'PENDING_ACTIVATION' },
        ]);
        // tout est rempli : ACTIVE (garde en base comprise)
        const late = plusMinutes(from, 70);
        expect((await stateAt(c, p, org, late)).blockers).toEqual([]);
        expect((await decide(c, ops, org, 'APPROVED', [country], late)).outcome).toBe('DONE');
        expect(await fixture(c, 'us123_org_status', org)).toEqual([{ us123_org_status: 'ACTIVE' }]);
        expect((await fixture(c, 'us123_dossier', org))[0]?.activated_at).not.toBeNull();
        // nouvelle tentative : déjà active, aucun second événement
        expect(
          await decide(c, ops, org, 'APPROVED', [country], plusMinutes(from, 80)),
        ).toMatchObject({ outcome: 'REFUSED', detail: 'HOST_ALREADY_ACTIVE' });
        const events = await fixture<{ type: string; payload: Record<string, unknown> }>(
          c,
          'us123_events',
          org,
        );
        expect(events.filter((e) => e.type === 'iam.organization.created')).toHaveLength(1);
        expect(
          events
            .filter((e) => e.type === 'iam.organization.status_changed')
            .map((e) => e.payload['to'])
            .sort(),
        ).toEqual(['ACTIVE', 'PENDING_ACTIVATION']);
      } finally {
        for (const key of ['p2p_private_hosts_enabled', 'insurer_contract_active'] as const) {
          await ensureClosed(c, requester, approver, key, country, to);
        }
      }
    });
  });

  it('garde en base : aucun rôle applicatif n’écrit le compte d’hôte ni les tables du dossier', async () => {
    await withRole('app_api', async (c) => {
      const { org } = await readyHost(c, country);
      for (const sql of [
        `UPDATE core.iam_organization SET status = 'ACTIVE' WHERE id = '${org}'`,
        `UPDATE core.kyc_host_verification SET status = 'APPROVED' WHERE org_id = '${org}'`,
        'SELECT * FROM core.kyc_host_tax_profile',
        'SELECT * FROM core.kyc_sanctions_screening',
        'SELECT * FROM core.kyc_identity_subject',
      ]) {
        await expect(
          withTestTransaction(c, {}, (tx) => tx.query(sql)),
          sql,
        ).rejects.toMatchObject({ code: '42501' });
      }
      // primitives : EXECUTE au seul propriétaire
      for (const fn of [
        `core.kyc_host_try_activate('${org}', NULL, 'SYSTEM')`,
        `core.kyc_host_activation_allowed('${org}', '${country}')`,
        `core.kyc_host_blockers('${org}')`,
      ]) {
        await expect(
          withTestTransaction(c, {}, (tx) => tx.query(`SELECT ${fn}`)),
          fn,
        ).rejects.toMatchObject({ code: '42501' });
      }
    });
  });

  it('N-38 : âge revérifié à l’activation (date déclarée en repli, devenue trop récente)', async () => {
    await withRole('app_api', async (c) => {
      const ops = await elevated(c, 'OPS_AGENT', [country]);
      const p = await person(c, country);
      // le fournisseur ne rend pas la date : la date DÉCLARÉE du compte sert de repli
      await kycApproved(c, p, country, { residenceCountry: country });
      await c.query('SELECT test_fixture.us107_set_birth_date($1, $2)', [
        p.userId,
        bornYearsAgo(40),
      ]);
      const org = await hostAccount(c, p, country);
      await acceptTerms(c, p, org);
      const kind = data(country).hostTaxIdKinds[0] ?? '';
      await saveTax(c, p, org, kind, sealedTaxId(org).enc);
      const s = await submit(c, p, org);
      await screen(c, p, org, s.screening_key, 'CLEAR');
      await c.query('SELECT test_fixture.us123_set_submerchant($1, $2)', [org, 'ACTIVE']);
      expect((await decide(c, ops, org, 'APPROVED', [country])).outcome).toBe('DONE');
      // la date déclarée change : l'activation la revérifie
      await c.query('SELECT test_fixture.us107_set_birth_date($1, $2)', [
        p.userId,
        bornYearsAgo(minAge - 1),
      ]);
      expect((await state(c, p, org)).blockers?.[0]).toBe('HOST_UNDER_AGE');
      expect(await decide(c, ops, org, 'APPROVED', [country])).toMatchObject({
        outcome: 'REFUSED',
        detail: 'HOST_UNDER_AGE',
      });
    });
  });

  it('N-28 : la résidence vérifiée par le KYC prime ; autre pays que le compte d’hôte ⇒ refus', async () => {
    await withRole('app_api', async (c) => {
      const other = COUNTRIES.find((o) => o.country !== country)?.country;
      if (other === undefined) throw new Error('second pays absent');
      const p = await person(c, country);
      await kycApproved(c, p, country, {
        dateOfBirth: bornYearsAgo(30),
        residenceCountry: other,
      });
      const org = await hostAccount(c, p, country);
      expect((await submit(c, p, org)).outcome).toBe('HOST_RESIDENCE_MISMATCH');
      expect((await state(c, p, org)).residence_status).toBe('MISMATCH');
      // sans résidence vérifiée : pays déclaré du compte d'hôte, marqué non vérifié
      const q = await person(c, country);
      await kycApproved(c, q, country, { dateOfBirth: bornYearsAgo(30) });
      const org2 = await hostAccount(c, q, country);
      expect((await submit(c, q, org2)).outcome).toBe('SUBMITTED');
      expect((await fixture(c, 'us123_dossier', org2))[0]).toMatchObject({
        residence_verified: false,
      });
    });
  });

  it('N-66 : CGU de l’hôte non acceptées ⇒ pièce manquante et décision refusée', async () => {
    await withRole('app_api', async (c) => {
      const ops = await elevated(c, 'OPS_AGENT', [country]);
      const { org } = await readyHost(c, country, { terms: false });
      expect((await fixture(c, 'us123_dossier', org))[0]).toMatchObject({
        status: 'DOCS_PENDING',
        missing: ['TERMS_REACCEPT_REQUIRED'],
      });
      expect(await decide(c, ops, org, 'APPROVED', [country])).toMatchObject({
        outcome: 'REFUSED',
        detail: 'TERMS_REACCEPT_REQUIRED',
      });
    });
  });

  it('filtrage : clé de la soumission exigée, rejeu idempotent, second filtrage refusé ; versions sans entrée de liste', async () => {
    await withRole('app_api', async (c) => {
      const { p, org } = await readyHost(c, country, { screening: 'NONE' });
      const s = await submit(c, p, org);
      expect((await screen(c, p, org, `screening:${uuid()}:a1`, 'CLEAR')).outcome).toBe(
        'REQUEST_INVALID',
      );
      // une « version » qui porterait un nom de la liste est refusée (format court seulement)
      const bad = await one<{ outcome: string }>(
        c,
        'SELECT * FROM core.kyc_cmd_host_record_screening($1, $2, $3, $4, $5, $6::jsonb, $7)',
        [p.token, org, SCREENER, s.screening_key, 'CLEAR', '{"UN":"Ana María Pérez Gómez"}', null],
      );
      expect(bad.outcome).toBe('REQUEST_INVALID');
      expect((await screen(c, p, org, s.screening_key, 'CLEAR')).outcome).toBe('RECORDED');
      expect((await screen(c, p, org, s.screening_key, 'CLEAR')).outcome).toBe('DUPLICATE');
      expect(await fixture(c, 'us123_screenings', org)).toHaveLength(1);
      expect((await fixture(c, 'us123_dossier', org))[0]).toMatchObject({ status: 'IN_REVIEW' });
    });
  });

  it('refus de l’ops : dossier REJECTED, plus aucune décision ; un rappel d’identité rejoué n’écrit aucun second fait', async () => {
    await withRole('app_api', async (c) => {
      const ops = await elevated(c, 'OPS_AGENT', [country]);
      const { org } = await readyHost(c, country);
      expect((await decide(c, ops, org, 'REJECTED', [country])).outcome).toBe('DONE');
      expect((await fixture(c, 'us123_dossier', org))[0]).toMatchObject({ status: 'REJECTED' });
      expect(await decide(c, ops, org, 'APPROVED', [country])).toMatchObject({
        outcome: 'REFUSED',
        detail: 'HOST_VERIFICATION_DECIDED',
      });
      const events = await fixture<{ type: string; payload: Record<string, unknown> }>(
        c,
        'us123_events',
        org,
      );
      expect(events.map((e) => [e.type, e.payload['decision']])).toEqual([
        ['kyc.host_verification.decided', 'REJECTED'],
      ]);
      // rappel rejoué (même événement) : DUPLICATE, un seul fait consigné
      const p = await person(c, country);
      const eventId = `fk_idv_evt_${randomBytes(6).toString('hex')}`;
      const k = await kycApproved(c, p, country, { dateOfBirth: bornYearsAgo(30) }, eventId);
      expect(k).toMatchObject({ outcome: 'APPLIED', status: 'APPROVED' });
      const replay = await applyFacts(c, eventId, k.sessionRef, k.verificationId, country, {
        dateOfBirth: bornYearsAgo(50),
      });
      expect(replay.outcome).toBe('DUPLICATE');
      expect(await fixture(c, 'us123_subject', p.userId)).toEqual([
        { date_of_birth: expect.anything() as unknown, residence_country: null, attempt: 1 },
      ]);
    });
  });

  it('IDOR : un autre hôte ne lit ni n’écrit le dossier d’un compte qui n’est pas le sien', async () => {
    await withRole('app_api', async (c) => {
      const a = await readyHost(c, country, { screening: 'NONE' });
      const b = await person(c, country);
      await hostAccount(c, b, country);
      expect((await state(c, b, a.org)).outcome).toBe('FORBIDDEN');
      expect((await submit(c, b, a.org)).outcome).toBe('FORBIDDEN');
      expect((await screen(c, b, a.org, a.submitted.screening_key, 'CLEAR')).outcome).toBe(
        'FORBIDDEN',
      );
      const kind = data(country).hostTaxIdKinds[0] ?? '';
      expect(await saveTax(c, b, a.org, kind, sealedTaxId(a.org).enc)).toEqual({
        outcome: 'FORBIDDEN',
      });
      expect((await state(c, { userId: '', token: randomBytes(32) }, a.org)).outcome).toBe(
        'AUTH_REQUIRED',
      );
    });
  });
});
