/**
 * Preuves de la vérification de l'hôte par l'ops PAR EXCEPTION (US-108, migrations 0081 et 0082 ;
 * fixtures 9976, 9986) sous les rôles de production app_api et app_worker (assertion L0-05 en tête
 * de chaque connexion, withRole), au Panama (USD) et au Paraguay (PYG). Chaque test crée ses
 * propres personnes, comptes d'hôte, dossiers et membres du staff par les VRAIES commandes. AUCUN
 * interrupteur n'est écrit hors d'une transaction annulée ou d'une fenêtre virtuelle lointaine
 * refermée par la procédure à deux personnes d'US-125.
 *
 * Attendus tirés de 19 US-108 (critères 1 à 4), de 16 VER-028 / ADM-004 / HST-019 / A.8, de 17
 * §0.1, §2.4, de 22 OQ-P2P-03, des données CFG (`params.json` : `host_manual_review_required`,
 * `listing_min_photos`) et de la consigne du fondateur du 2026-11-12 (« jamais plus lourd que
 * Turo » : revue par exception), jamais du code testé :
 * - critère 1 : sans filtrage, activation refusée (HOST_SCREENING_MISSING) ; source et date du
 *   filtrage au dossier (filtrage manuel de l'ops) ;
 * - critère 2 : `insurer_contract_active` à false ⇒ INSURER_CONTRACT_INACTIVE, compte en attente ;
 * - critère 3 : véhicule hors des critères du contrat ⇒ VEHICLE_NOT_COVERED ; sans contrat, jamais
 *   couvert (fail-closed) ;
 * - critère 4 : capacité bloquante du PSP non validée ⇒ HOST_PAYOUT_RAIL_UNAVAILABLE ;
 * - revue par exception : dossier propre approuvé sans l'ops ; retenue de sanctions ou pays qui
 *   impose la revue ⇒ laissé à l'ops ; l'hôte ne voit jamais la retenue.
 */
import { randomBytes, randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { columnAad, seal } from '../../src/audit/index.ts';
import { setSessionContext } from '../../src/index.ts';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES, uuid } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { newToken, phcArgon2id, SESSION_TTL_S } from '../support/iam.ts';
import {
  approveSwitch,
  ensureClosed,
  farInstant,
  freshSession,
  newHash,
  openSwitchWindow,
  plusMinutes,
  requestSwitch,
} from '../support/golive.ts';
import type { StaffActor } from '../support/golive.ts';
import { staff as rlsStaff, staffSessionHash } from '../support/rls.ts';
import { auditOf, elevatedStaff, installTestProofKey } from '../support/staff.ts';

const DOCS = '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]';
const PROVIDER = 'FAKE';
const SCREENER = 'FAKE';
const REASON = 'Dossier de l’hôte relu par l’ops';
const PURPOSE = 'Instruction du dossier de l’hôte signalé';
const LISTS = { UN: '2026-11-01', OFAC: '2026-11-10', NATIONAL: 'v42' };

const cfg = (file: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(`../../../../apps/api/src/modules/cfg/data/${file}`, import.meta.url),
      'utf8',
    ),
  );
interface CountryData {
  code: string;
  timeZone: string;
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
/** Consigne du fondateur du 2026-11-12 : revue de l'ops par exception (défaut false). */
const REVIEW_REQUIRED = paramValues('host_manual_review_required');
/** 17 §7.2 `listing_min_photos` (BR-LIST-05). */
const MIN_PHOTOS = paramValues('listing_min_photos');

function data(country: string): CountryData {
  const d = COUNTRY_DATA.get(country);
  if (d === undefined) throw new Error(`pays absent des données CFG : ${country}`);
  return d;
}

/** Jour civil (AAAA-MM-JJ) d'aujourd'hui au fuseau du pays. */
const today = (country: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: data(country).timeZone }).format(new Date());

function phoneOf(country: string): string {
  const p = data(country).phone;
  const prefix = p.mobilePrefixes[0] ?? '';
  let rest = '';
  while (rest.length < p.nationalLength - prefix.length) rest += String(randomInt(10));
  return `+${p.callingCode}${prefix}${rest}`;
}

function bornYearsAgo(years: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
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

async function elevated(c: pg.ClientBase, role: string, scope: readonly string[]) {
  await installTestProofKey(c);
  return elevatedStaff(c, role, scope);
}

interface Person {
  readonly userId: string;
  readonly token: Buffer;
}

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

/** Vérification d'identité APPROUVÉE (vraies commandes de 0072) avec les faits vérifiés (0075). */
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
  const d = await one<{ outcome: string; status: string | null }>(
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
      }),
      JSON.stringify({ dateOfBirth: bornYearsAgo(30), residenceCountry: country }),
    ],
  );
  expect(d).toMatchObject({ outcome: 'APPLIED', status: 'APPROVED' });
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

async function acceptTerms(c: pg.ClientBase, token: Buffer, org: string): Promise<void> {
  const t = await one<{ outcome: string; version: number }>(
    c,
    'SELECT * FROM core.ctr_host_terms($1, $2, $3)',
    [token, org, 'es'],
  );
  expect(t.outcome).toBe('OK');
  const a = await one<{ outcome: string }>(
    c,
    'SELECT * FROM core.ctr_cmd_accept_host_terms($1, $2, $3, $4)',
    [token, org, t.version, 'es'],
  );
  expect(a.outcome).toBe('DONE');
}

function sealedTaxId(org: string): Buffer {
  const plain = `${String(randomInt(1_000_000, 9_999_999))}-${String(randomInt(10))}`;
  return seal(
    randomBytes(32),
    Buffer.from(plain, 'utf8'),
    columnAad('core.kyc_host_tax_profile', 'tax_id_enc', { type: 'ORG', id: org }),
  );
}

interface Submitted {
  readonly outcome: string;
  readonly verification_id: string | null;
  readonly status: string | null;
  readonly missing: string[] | null;
  readonly screening_key: string | null;
}
const submit = (c: pg.ClientBase, p: Person, org: string) =>
  one<Submitted>(c, 'SELECT * FROM core.kyc_cmd_host_submit($1, $2)', [p.token, org]);

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
  readonly verification_status: string | null;
  readonly org_status: string | null;
  readonly missing: string[] | null;
  readonly blockers: string[] | null;
}
const state = (c: pg.ClientBase, p: Person, org: string) =>
  one<HostState>(c, 'SELECT * FROM core.kyc_host_state($1, $2)', [p.token, org]);

interface Ready {
  readonly p: Person;
  readonly org: string;
  readonly submitted: Submitted;
}

/** Hôte complet (identité, compte, CGU, profil fiscal), dossier soumis ; filtrage au choix. */
async function readyHost(
  c: pg.ClientBase,
  country: string,
  screening: 'CLEAR' | 'POTENTIAL_MATCH' | 'NONE' = 'CLEAR',
): Promise<Ready> {
  const p = await person(c, country);
  await kycApproved(c, p, country);
  const org = await hostAccount(c, p, country);
  await acceptTerms(c, p.token, org);
  const kind = data(country).hostTaxIdKinds[0] ?? '';
  expect(
    await one<{ outcome: string }>(
      c,
      'SELECT * FROM core.kyc_cmd_host_save_tax_profile($1, $2, $3, $4, $5, $6)',
      [p.token, org, kind, sealedTaxId(org), null, 'INDIVIDUAL'],
    ),
  ).toEqual({ outcome: 'SAVED' });
  const s = await submit(c, p, org);
  expect(s.outcome).toBe('SUBMITTED');
  if (screening !== 'NONE') {
    const matchRef = screening === 'CLEAR' ? null : `case_${randomBytes(5).toString('hex')}`;
    expect((await screen(c, p, org, s.screening_key, screening, matchRef)).outcome).toBe(
      'RECORDED',
    );
  }
  return { p, org, submitted: s };
}

interface ActOutcome {
  readonly outcome: string;
  readonly action_id: string | null;
  readonly domain_ref: string | null;
  readonly detail: string | null;
}

/** Action de console (cadre d'US-101), transaction validée ; `at` : instant virtuel. */
function act(
  client: pg.ClientBase,
  s: { readonly userId: string; readonly hash: Buffer },
  action: string,
  org: string,
  input: Record<string, string>,
  scope: readonly string[],
  options: { readonly at?: string; readonly requestId?: string } = {},
): Promise<ActOutcome> {
  return withTestTransaction(
    client,
    { commit: true, ...(options.at === undefined ? {} : { virtualNow: options.at }) },
    async (tx) => {
      let hash = s.hash;
      if (options.at !== undefined) {
        hash = newHash();
        await tx.query('SELECT test_fixture.iam_open_elevated_session($1, $2)', [s.userId, hash]);
      }
      await setSessionContext(tx, {
        kind: 'STAFF',
        actorId: s.userId,
        countryScope: scope,
        sessionTokenHash: hash.toString('hex'),
      });
      const { rows } = await tx.query<ActOutcome>(
        'SELECT * FROM core.iam_staff_cmd_manual_action($1, $2, $3, $4, $5, $6::jsonb, $7::uuid[])',
        [hash, options.requestId ?? uuid(), action, org, REASON, input, []],
      );
      return rows[0] ?? { outcome: '', action_id: null, domain_ref: null, detail: null };
    },
  );
}

const ALL_CLEAR = { unList: 'CLEAR', ofacList: 'CLEAR', nationalList: 'CLEAR' };

/** Passe ciblée du travailleur review_sla_watch (partie hôtes), sous app_worker. */
async function autoReview(
  org: string,
  inTx?: (w: pg.ClientBase) => Promise<void>,
): Promise<{ approved: number; kept: number; skipped: number }> {
  return withRole('app_worker', (w) =>
    withTestTransaction(w, { commit: inTx === undefined }, async (tx) => {
      await tx.query(
        `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
                pg_catalog.set_config('app.worker_name', 'review_sla_watch', true)`,
      );
      if (inTx !== undefined) await inTx(tx);
      return one<{ approved: number; kept: number; skipped: number }>(
        tx,
        'SELECT * FROM core.kyc_worker_auto_review_hosts($1, $2)',
        [10, org],
      );
    }),
  );
}

const hostDossier = (c: pg.ClientBase, s: { readonly hash: Buffer }, itemId: string) =>
  one<{ outcome: string; body: Record<string, unknown> | null }>(
    c,
    'SELECT * FROM core.support_staff_host_dossier($1, $2, $3, $4)',
    [s.hash, uuid(), itemId, PURPOSE],
  );

const claim = (c: pg.ClientBase, s: { readonly hash: Buffer }, itemId: string) =>
  one<{ outcome: string }>(c, 'SELECT * FROM core.support_staff_claim_item($1, $2, $3)', [
    s.hash,
    uuid(),
    itemId,
  ]);

const orgStatus = async (c: pg.ClientBase, org: string): Promise<string | undefined> =>
  (await fixture<{ us123_org_status: string }>(c, 'us123_org_status', org))[0]?.us123_org_status;

describe.each(COUNTRIES)(
  'US-108 — vérification de l’hôte par exception, $country ($currency)',
  (cc) => {
    const country = cc.country;

    it('données de test : revue de l’ops par exception, paramètre à false par défaut (consigne du fondateur)', async () => {
      await withRole('app_api', async () => undefined); // L0-05
      expect(REVIEW_REQUIRED[country]).toBe(false);
      expect(Number(MIN_PHOTOS[country])).toBeGreaterThan(0);
    });

    it('critère 1 : sans filtrage ⇒ HOST_SCREENING_MISSING ; filtrage manuel de l’ops ⇒ source, date et relecteur au dossier', async () => {
      await withRole('app_api', async (c) => {
        const ops = await elevated(c, 'OPS_AGENT', [country]);
        const { p, org, submitted } = await readyHost(c, country, 'NONE');
        expect(submitted.missing).toEqual(['HOST_SCREENING_MISSING']);
        expect((await fixture(c, 'us123_dossier', org))[0]).toMatchObject({
          status: 'DOCS_PENDING',
        });
        // l'ops tente de l'activer : refus motivé « filtrage manquant », rien n'est écrit
        expect(
          await act(c, ops, 'HOST_VERIFICATION_DECISION', org, { decision: 'APPROVED' }, [country]),
        ).toMatchObject({ outcome: 'REFUSED', detail: 'HOST_SCREENING_MISSING' });
        expect(await orgStatus(c, org)).toBe('ONBOARDING');
        // saisie incomplète : refus du cadre (22023), rien n'est écrit
        await expect(
          act(c, ops, 'HOST_SANCTIONS_SCREENING', org, { unList: 'CLEAR' }, [country]),
        ).rejects.toMatchObject({ code: '22023' });
        // filtrage manuel (VER-028 : recherche, résultat, consigné avec source, date, auteur)
        const done = await act(c, ops, 'HOST_SANCTIONS_SCREENING', org, ALL_CLEAR, [country]);
        expect(done).toMatchObject({ outcome: 'DONE', domain_ref: submitted.verification_id });
        const [scr] = await fixture<{
          provider: string;
          request_key: string;
          lists_version: Record<string, string>;
          result: string;
          reviewer: string;
          manual_action_id: string;
          screened_at: Date;
        }>(c, 'us108_screening', org);
        expect(scr).toMatchObject({
          provider: 'OPS_MANUAL',
          request_key: `screening:${submitted.verification_id ?? ''}:a1`,
          result: 'CLEAR',
          reviewer: ops.userId,
          manual_action_id: done.action_id,
          lists_version: { UN: today(country), OFAC: today(country), NATIONAL: today(country) },
        });
        expect(scr?.screened_at).toBeInstanceOf(Date);
        // action de console : motif, saisie, auteur (cadre d'US-101)
        expect((await fixture(c, 'us108_manual_action', done.action_id))[0]).toMatchObject({
          action_code: 'HOST_SANCTIONS_SCREENING',
          subject_id: org,
          actor_user_id: ops.userId,
          input: ALL_CLEAR,
          reason: REASON,
          outcome: 'DONE',
        });
        // dossier complet : en revue ; journal : source et résultat, codes seulement
        expect((await fixture(c, 'us123_dossier', org))[0]).toMatchObject({
          status: 'IN_REVIEW',
          missing: [],
          screening_hold: false,
        });
        const audit = await fixture<{ action_code: string; after: Record<string, unknown> }>(
          c,
          'us123_audit',
          org,
        );
        expect(audit.find((a) => a.action_code === 'HOST_SANCTIONS_SCREENED')?.after).toMatchObject(
          {
            result: 'CLEAR',
            source: 'OPS_MANUAL',
          },
        );
        expect((await state(c, p, org)).missing).toEqual([]);
        // un second filtrage du même dossier est refusé
        expect(
          await act(c, ops, 'HOST_SANCTIONS_SCREENING', org, ALL_CLEAR, [country]),
        ).toMatchObject({ outcome: 'REFUSED', detail: 'HOST_ALREADY_SCREENED' });
      });
    });

    it('filtrage manuel avec une correspondance ⇒ retenue, escalade, jamais approuvé sans l’ops ; l’hôte n’en voit rien', async () => {
      await withRole('app_api', async (c) => {
        const ops = await elevated(c, 'OPS_AGENT', [country]);
        const clean = await readyHost(c, country, 'NONE');
        const held = await readyHost(c, country, 'NONE');
        expect(
          (await act(c, ops, 'HOST_SANCTIONS_SCREENING', clean.org, ALL_CLEAR, [country])).outcome,
        ).toBe('DONE');
        const r = await act(
          c,
          ops,
          'HOST_SANCTIONS_SCREENING',
          held.org,
          { ...ALL_CLEAR, nationalList: 'MATCH' },
          [country],
        );
        expect(r.outcome).toBe('DONE');
        expect((await fixture(c, 'us123_dossier', held.org))[0]).toMatchObject({
          status: 'IN_REVIEW',
          screening_hold: true,
          reason_code: 'HOST_SANCTIONS_HIT',
        });
        expect((await fixture(c, 'us108_screening', held.org))[0]).toMatchObject({
          provider: 'OPS_MANUAL',
          result: 'POTENTIAL_MATCH',
        });
        const flagged = (
          await fixture<{ type: string; payload: Record<string, unknown> }>(
            c,
            'us123_events',
            held.org,
          )
        ).filter((e) => e.type === 'kyc.host_screening.flagged');
        expect(flagged.map((e) => e.payload)).toEqual([
          {
            org_id: held.org,
            verification_id: held.submitted.verification_id,
            reason_code: 'HOST_SANCTIONS_HIT',
          },
        ]);
        // indiscernable par l'hôte : même état qu'un dossier propre
        const shape = (s: HostState) => ({
          verification_status: s.verification_status,
          org_status: s.org_status,
          missing: s.missing,
          blockers: [...(s.blockers ?? [])].sort(),
        });
        const sHeld = await state(c, held.p, held.org);
        expect(shape(sHeld)).toEqual(shape(await state(c, clean.p, clean.org)));
        expect(JSON.stringify(sHeld)).not.toMatch(/SANCTION|HOLD|MATCH|OPS_MANUAL/i);
        // le travailleur ne touche jamais un dossier retenu
        expect(await autoReview(held.org)).toEqual({ approved: 0, kept: 0, skipped: 0 });
        expect((await fixture(c, 'us123_dossier', held.org))[0]).toMatchObject({
          status: 'IN_REVIEW',
        });
      });
    });

    it('revue par exception : un dossier complet et propre est approuvé par le travailleur, sans l’ops ; le compte reste en attente (interrupteurs à false)', async () => {
      await withRole('app_api', async (c) => {
        const { p, org } = await readyHost(c, country);
        expect(await fixture(c, 'us123_queue_items', org)).toEqual([
          { queue: 'HOST_VERIFICATION', status: 'OPEN', decision: null },
        ]);
        expect(await autoReview(org)).toEqual({ approved: 1, kept: 0, skipped: 0 });
        expect((await fixture(c, 'us123_dossier', org))[0]).toMatchObject({
          status: 'APPROVED',
          decided_by: null,
          missing: [],
          activated_at: null,
        });
        // élément de file clôturé sans action de l'ops
        expect(await fixture(c, 'us123_queue_items', org)).toEqual([
          { queue: 'HOST_VERIFICATION', status: 'DONE', decision: 'AUTO_APPROVED' },
        ]);
        expect(await orgStatus(c, org)).toBe('PENDING_ACTIVATION');
        const events = await fixture<{
          type: string;
          actor_role: string;
          payload: Record<string, unknown>;
        }>(c, 'us123_events', org);
        expect(events.map((e) => `${e.type}:${e.actor_role}`).sort()).toEqual([
          'iam.organization.status_changed:SYSTEM',
          'kyc.host_verification.decided:SYSTEM',
        ]);
        const audit = await fixture<{
          action_code: string;
          actor_role: string;
          after: Record<string, unknown>;
        }>(c, 'us123_audit', org);
        expect(audit.find((a) => a.action_code === 'HOST_VERIFICATION_DECIDED')).toMatchObject({
          actor_role: 'SYSTEM',
          after: { decision: 'APPROVED', mode: 'AUTOMATIC' },
        });
        // aucun hôte actif tant que l'assureur n'a pas de contrat actif (17 §0.1)
        expect((await state(c, p, org)).blockers).toEqual(
          expect.arrayContaining(['INSURER_CONTRACT_INACTIVE']),
        );
        // passe suivante : rien à faire
        expect(await autoReview(org)).toEqual({ approved: 0, kept: 0, skipped: 0 });
      });
    });

    it('revue par exception : pays dont le paramètre impose la revue ⇒ dossier laissé à l’ops ; hors du contexte du travailleur ⇒ refus', async () => {
      await withRole('app_api', async (c) => {
        const { org } = await readyHost(c, country);
        // transaction annulée : le pays impose la revue de l'ops
        expect(
          await autoReview(org, async (w) => {
            await w.query('SELECT test_fixture.us108_set_review_required($1, $2)', [country, true]);
          }),
        ).toEqual({ approved: 0, kept: 1, skipped: 0 });
        expect((await fixture(c, 'us123_dossier', org))[0]).toMatchObject({ status: 'IN_REVIEW' });
        await withRole('app_worker', async (w) => {
          await expect(
            w.query('SELECT * FROM core.kyc_worker_auto_review_hosts($1, $2)', [10, org]),
          ).rejects.toMatchObject({ code: '42501' });
        });
        // aucun droit d'app_api
        await expect(
          withTestTransaction(c, {}, (tx) =>
            tx.query('SELECT * FROM core.kyc_worker_auto_review_hosts($1, $2)', [10, org]),
          ),
        ).rejects.toMatchObject({ code: '42501' });
        // paramètre graine (false) : approuvé
        expect((await autoReview(org)).approved).toBe(1);
      });
    });

    it('critères 2 et 4 (fenêtre virtuelle lointaine) : capacité bloquante non validée ⇒ HOST_PAYOUT_RAIL_UNAVAILABLE ; insurer_contract_active à false ⇒ INSURER_CONTRACT_INACTIVE, compte en attente', async () => {
      await withRole('app_api', async (c) => {
        const ops = await elevated(c, 'OPS_AGENT', [country]);
        const { org } = await readyHost(c, country);
        await c.query('SELECT test_fixture.us123_set_submerchant($1, $2)', [org, 'ACTIVE']);
        expect((await autoReview(org)).approved).toBe(1);
        expect(await orgStatus(c, org)).toBe('PENDING_ACTIVATION');
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
          // SEUL le pays est ouvert aux hôtes : insurer_contract_active reste à false
          await openSwitchWindow(
            c,
            requester,
            approver,
            'p2p_private_hosts_enabled',
            country,
            from,
            to,
          );
          const decide = (at: string) =>
            act(c, ops, 'HOST_VERIFICATION_DECISION', org, { decision: 'APPROVED' }, [country], {
              at,
            });
          // critère 4 : capacité bloquante inconnue
          expect(await decide(plusMinutes(from, 10))).toMatchObject({
            outcome: 'REFUSED',
            detail: 'HOST_PAYOUT_RAIL_UNAVAILABLE',
          });
          // critère 2 : capacités validées, contrat d'assureur inactif
          expect(await decide(plusMinutes(from, 70))).toMatchObject({
            outcome: 'REFUSED',
            detail: 'INSURER_CONTRACT_INACTIVE',
          });
          expect(await orgStatus(c, org)).toBe('PENDING_ACTIVATION');
          expect((await fixture(c, 'us123_dossier', org))[0]).toMatchObject({
            status: 'APPROVED',
            activated_at: null,
          });
        } finally {
          await ensureClosed(c, requester, approver, 'p2p_private_hosts_enabled', country, to);
        }
      });
    });

    it('dossier de la console : retenue visible du staff seulement, liste de contrôle fermée, lecture journalisée et limitée à l’élément pris en charge', async () => {
      await withRole('app_api', async (c) => {
        const ops = await elevated(c, 'OPS_AGENT', [country]);
        const support = await elevated(c, 'SUPPORT', [country]);
        const { org } = await readyHost(c, country, 'POTENTIAL_MATCH');
        const [item] = await fixture<{ id: string; status: string }>(c, 'us108_queue_item', org);
        if (item === undefined) throw new Error('aucun élément de file');
        // élément non pris en charge : refus journalisé ; sans la permission : FORBIDDEN
        expect((await hostDossier(c, ops, item.id)).outcome).toBe('CASE_REQUIRED');
        expect((await hostDossier(c, support, item.id)).outcome).toBe('FORBIDDEN');
        expect(
          (await auditOf(c, ops.userId)).some((a) => a.action_code === 'STAFF_FORBIDDEN'),
        ).toBe(true);
        expect(await fixture(c, 'us108_access_log', ops.userId)).toEqual([]);
        expect((await claim(c, ops, item.id)).outcome).toBe('CLAIMED');
        const r = await hostDossier(c, ops, item.id);
        expect(r.outcome).toBe('GRANTED');
        const body = r.body ?? {};
        expect(body).toMatchObject({
          orgId: org,
          country,
          status: 'IN_REVIEW',
          screeningHold: true,
          reasonCode: 'HOST_SANCTIONS_HIT',
          reviewReasons: ['SCREENING_HOLD'],
          screening: { source: SCREENER, result: 'POTENTIAL_MATCH', manualActionId: null },
          evidenceFileIds: [],
        });
        // liste de contrôle FERMÉE : dix éléments, dans cet ordre
        const checklist = body['checklist'] as { item: string; state: string }[];
        expect(checklist.map((x) => x.item)).toEqual([
          'IDENTITY',
          'AGE',
          'RESIDENCE',
          'SANCTIONS',
          'TAX_PROFILE',
          'HOST_TERMS',
          'PAYOUT_ACCOUNT',
          'PSP_CAPABILITIES',
          'COUNTRY_OPEN',
          'INSURER_CONTRACT',
        ]);
        const stateOf = (i: string) => checklist.find((x) => x.item === i)?.state;
        expect(stateOf('SANCTIONS')).toBe('HELD');
        expect(stateOf('IDENTITY')).toBe('OK');
        expect(stateOf('INSURER_CONTRACT')).toBe('BLOCKED');
        // ni référence chez le prestataire ni version de liste dans la réponse
        for (const leak of Object.values(LISTS)) expect(JSON.stringify(body)).not.toContain(leak);
        expect(JSON.stringify(body)).not.toMatch(/case_/);
        // journal d'accès AVANT la donnée
        expect(await fixture(c, 'us108_access_log', ops.userId)).toEqual([
          {
            subject_type: 'ORGANIZATION',
            subject_id: org,
            field_or_file: 'host_dossier',
            access_kind: 'READ_C2_SUPPORT',
            case_ref: `item:${item.id}`,
          },
        ]);
      });
    });

    it('IDOR et rôles : l’action de filtrage manuel exige ops.review_listing_host dans le pays du compte', async () => {
      await withRole('app_api', async (c) => {
        const other = COUNTRIES.find((x) => x.country !== country)?.country ?? '';
        const support = await elevated(c, 'SUPPORT', [country]);
        const foreignOps = await elevated(c, 'OPS_AGENT', [other]);
        const { org } = await readyHost(c, country, 'NONE');
        expect(
          (await act(c, support, 'HOST_SANCTIONS_SCREENING', org, ALL_CLEAR, [country])).outcome,
        ).toBe('FORBIDDEN');
        expect(
          (await act(c, foreignOps, 'HOST_SANCTIONS_SCREENING', org, ALL_CLEAR, [other])).outcome,
        ).toBe('FORBIDDEN');
        expect(await fixture(c, 'us108_screening', org)).toEqual([]);
        // aucun droit direct des rôles applicatifs sur le contrat d'assureur
        await expect(
          withTestTransaction(c, {}, (tx) =>
            tx.query('SELECT * FROM core.settlement_insurer_contract'),
          ),
        ).rejects.toMatchObject({ code: '42501' });
      });
    });
  },
);

// ---------------------------------------------------------------------------------------------
// Critère 3 : couverture du véhicule par le contrat d'assureur à la soumission de l'annonce.
// Chaque cas tourne dans une transaction ANNULÉE (contrat de test, interrupteurs, statut du compte).

const NAME = 'Casa de Ana';
const ADDRESS = 'Calle 50, edificio Sol, apto 12';
const plate = (): string => `Q${randomBytes(4).toString('hex').toUpperCase()}`;

interface Draft {
  readonly hash: Buffer;
  readonly org: string;
  readonly vehicle: string;
  readonly listing: string;
}

/** Hôte (ONBOARDING, CGU acceptées), lieu, véhicule du catalogue, annonce DRAFT avec ses photos. */
async function draft(tx: pg.ClientBase, c: CountryCase): Promise<Draft> {
  const userId = uuid();
  const reg = await one<{ ok: boolean }>(
    tx,
    `SELECT core.iam_cmd_register_with_consents($1, $2, $3, 'Ana', 'Pérez', 'es', $4, $5, 86400, NULL,
                                                $6, $7::jsonb, false) AS ok`,
    [
      userId,
      `host-${userId}@example.test`,
      phcArgon2id(),
      uuid(),
      randomBytes(32),
      c.country,
      DOCS,
    ],
  );
  if (reg.ok !== true) throw new Error('inscription de test refusée');
  await tx.query('SELECT test_fixture.iam_set_account_status($1, $2)', [userId, 'ACTIVE']);
  const t = newToken();
  await tx.query(
    `SELECT core.iam_cmd_open_session($1, $2, $3, $4, 'NONE', NULL, 'vitest') AS expires_at`,
    [uuid(), userId, t.hash, SESSION_TTL_S],
  );
  const acc = await one<{ outcome: string; org_id: string }>(
    tx,
    'SELECT * FROM core.iam_cmd_open_host_account($1, $2, $3)',
    [t.hash, c.country, 'INDIVIDUAL'],
  );
  expect(acc.outcome).toBe('DONE');
  await acceptTerms(tx, t.hash, acc.org_id);
  const loc = await one<{ outcome: string; location_id: string }>(
    tx,
    'SELECT * FROM core.catalog_cmd_create_location($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [t.hash, acc.org_id, 'HOME', NAME, ADDRESS, 'Ciudad Uno', 'Barrio Norte', 8.983712, -79.519843],
  );
  expect(loc.outcome).toBe('DONE');
  const variant = await one<{ id: string; year_from: number }>(
    tx,
    `SELECT v.id, v.year_from
       FROM core.catalog_vehicle_variant v
       JOIN core.catalog_vehicle_model o ON o.id = v.model_id AND o.status = 'ACTIVE'
       JOIN core.catalog_vehicle_make m ON m.id = o.make_id AND m.status = 'ACTIVE'
      WHERE v.status = 'ACTIVE' AND v.market IS NULL
      ORDER BY v.id LIMIT 1`,
    [],
  );
  const veh = await one<{ outcome: string; vehicle_id: string }>(
    tx,
    `SELECT * FROM core.catalog_cmd_create_vehicle($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL,
                                                   'AUTOMATIC', 5::smallint, 'GASOLINE', 42000,
                                                   false, false)`,
    [t.hash, acc.org_id, loc.location_id, plate(), null, variant.id, null, null, variant.year_from],
  );
  expect(veh.outcome).toBe('DONE');
  const lst = await one<{ outcome: string; listing_id: string }>(
    tx,
    'SELECT * FROM core.catalog_cmd_create_listing($1, $2, $3, $4, $5, $6, $7, $8)',
    [
      t.hash,
      acc.org_id,
      veh.vehicle_id,
      50 * c.priceStepMinor * 100,
      'UNLIMITED',
      null,
      null,
      null,
    ],
  );
  expect(lst.outcome).toBe('DONE');
  for (let i = 0; i < Number(MIN_PHOTOS[c.country]); i += 1) {
    const ph = await one<{ outcome: string }>(
      tx,
      'SELECT * FROM core.catalog_cmd_add_listing_photo($1, $2, $3, $4, $5, $6, $7, $8)',
      [t.hash, acc.org_id, lst.listing_id, uuid(), uuid(), 'image/jpeg', 123_456, randomBytes(32)],
    );
    expect(ph.outcome).toBe('DONE');
  }
  return { hash: t.hash, org: acc.org_id, vehicle: veh.vehicle_id, listing: lst.listing_id };
}

const submitListing = async (tx: pg.ClientBase, d: Draft): Promise<string> =>
  (
    await one<{ outcome: string }>(
      tx,
      'SELECT * FROM core.catalog_cmd_submit_listing($1, $2, $3)',
      [d.hash, d.org, d.listing],
    )
  ).outcome;

const listingStatus = async (tx: pg.ClientBase, id: string): Promise<string | undefined> =>
  (await fixture<{ status: string }>(tx, 'us115_listing_row', id))[0]?.status;

/** Âge civil du véhicule au fuseau du pays (17 §2.4 « âge »). */
const ageOf = (year: number, country: string): number => Number(today(country).slice(0, 4)) - year;

/** Ouvre un interrupteur dans la transaction ANNULÉE courante, par deux personnes (US-125). */
async function openInTx(tx: pg.ClientBase, key: string, country: string): Promise<void> {
  const actorOf = async (role: string): Promise<StaffActor> =>
    freshSession(tx, {
      userId: await rlsStaff(tx, role, [country]),
      hash: newHash(),
      scope: [country],
    });
  const req = await actorOf('ADMIN');
  const app = await actorOf('SUPERADMIN');
  const r = await requestSwitch(tx, req, key, country, true);
  expect(r.outcome).toBe('REQUESTED');
  expect((await approveSwitch(tx, app, r.request_id ?? '')).outcome).toBe('APPLIED');
}

describe.each(COUNTRIES)(
  'US-108 — critère 3, couverture de l’assureur, $country ($currency)',
  (cc) => {
    const country = cc.country;

    it('sans contrat en vigueur : la soumission n’est jamais couverte (compte non activé d’abord, puis INSURER_CONTRACT_INACTIVE)', async () => {
      await withRole('app_api', (c) =>
        withTestTransaction(c, {}, async (tx) => {
          const d = await draft(tx, cc);
          expect(await submitListing(tx, d)).toBe('HOST_NOT_ACTIVATED');
          // compte ACTIVE et deux interrupteurs ouverts (transaction annulée) : aucun contrat ⇒ refus
          await tx.query('SELECT test_fixture.us115_set_org_status($1, $2)', [d.org, 'ACTIVE']);
          await openInTx(tx, 'p2p_private_hosts_enabled', country);
          await openInTx(tx, 'insurer_contract_active', country);
          expect(await submitListing(tx, d)).toBe('INSURER_CONTRACT_INACTIVE');
          expect(await listingStatus(tx, d.listing)).toBe('DRAFT');
        }),
      );
    });

    it('véhicule hors des critères du contrat (âge, classe de valeur) ⇒ VEHICLE_NOT_COVERED, l’annonce reste DRAFT', async () => {
      await withRole('app_api', async (c) => {
        // âge : plafond du contrat inférieur à l'âge du véhicule
        await withTestTransaction(c, {}, async (tx) => {
          const d = await draft(tx, cc);
          const [v] = await fixture<{ year: number; value_class: string | null }>(
            tx,
            'us108_vehicle',
            d.vehicle,
          );
          const age = ageOf(v?.year ?? 0, country);
          // la variante de la graine a au moins un an (sinon la preuve doit changer de véhicule)
          expect(age).toBeGreaterThanOrEqual(1);
          await tx.query('SELECT test_fixture.us108_insurer_contract($1, $2, $3)', [
            country,
            age - 1,
            ['STANDARD', 'PREMIUM', 'LUXE'],
          ]);
          expect(await submitListing(tx, d)).toBe('VEHICLE_NOT_COVERED');
          expect(await listingStatus(tx, d.listing)).toBe('DRAFT');
        });
        // classe de valeur exclue par le contrat (ou inconnue : jamais couverte)
        await withTestTransaction(c, {}, async (tx) => {
          const d = await draft(tx, cc);
          const [v] = await fixture<{ year: number; value_class: string | null }>(
            tx,
            'us108_vehicle',
            d.vehicle,
          );
          const others = ['STANDARD', 'PREMIUM', 'LUXE'].filter((x) => x !== v?.value_class);
          await tx.query('SELECT test_fixture.us108_insurer_contract($1, $2, $3)', [
            country,
            50,
            others.slice(0, 2),
          ]);
          expect(await submitListing(tx, d)).toBe('VEHICLE_NOT_COVERED');
          expect(await listingStatus(tx, d.listing)).toBe('DRAFT');
        });
      });
    });

    it('véhicule couvert : la garde de couverture laisse passer (compte non activé, puis interrupteurs ouverts ⇒ soumis)', async () => {
      await withRole('app_api', (c) =>
        withTestTransaction(c, {}, async (tx) => {
          const d = await draft(tx, cc);
          const [v] = await fixture<{ year: number; value_class: string | null }>(
            tx,
            'us108_vehicle',
            d.vehicle,
          );
          const vc = v?.value_class;
          if (v === undefined || vc === null || vc === undefined) {
            throw new Error('véhicule de la graine sans classe de valeur');
          }
          await tx.query('SELECT test_fixture.us108_insurer_contract($1, $2, $3)', [
            country,
            Math.max(ageOf(v.year, country), 0),
            [vc],
          ]);
          expect(await submitListing(tx, d)).toBe('HOST_NOT_ACTIVATED');
          await tx.query('SELECT test_fixture.us115_set_org_status($1, $2)', [d.org, 'ACTIVE']);
          await openInTx(tx, 'p2p_private_hosts_enabled', country);
          // contrat en vigueur mais interrupteur de l'assureur fermé : refus (17 §0.1)
          expect(await submitListing(tx, d)).toBe('INSURER_CONTRACT_INACTIVE');
          await openInTx(tx, 'insurer_contract_active', country);
          expect(await submitListing(tx, d)).toBe('DONE');
          expect(await listingStatus(tx, d.listing)).toBe('PENDING_REVIEW');
        }),
      );
    });
  },
);
