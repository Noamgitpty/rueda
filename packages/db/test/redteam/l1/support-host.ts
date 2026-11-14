/**
 * Aides de la red team du lot 1 (suite de support.ts) : hôte « prêt » (identité approuvée, dossier
 * soumis), actions de console et files de revue. Mêmes règles : rôles de production seulement,
 * vraies commandes, aucune constante de pays.
 */
import { randomBytes } from 'node:crypto';
import { setSessionContext } from '../../../src/index.ts';
import { person } from '../../support/kyc.ts';
import { ALL, uuid } from './support.ts';
import type { Tx } from './support.ts';
import type pg from 'pg';

const PROVIDER = 'FAKE';
const LISTS = { UN: '2026-11-01', OFAC: '2026-11-10', NATIONAL: 'v42' };

/** Date ISO (AAAA-MM-JJ) de naissance d'une personne de `years` ans. */
export function bornYearsAgo(years: number, extraDays = 0): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() - extraDays);
  return d.toISOString().slice(0, 10);
}

export const first = async <T extends pg.QueryResultRow>(
  c: Tx,
  sql: string,
  params: readonly unknown[],
): Promise<T> => {
  const { rows } = await c.query<T>(sql, [...params]);
  return rows[0] as T;
};

/**
 * Identité APPROUVÉE par les vraies commandes de 0072 (consentement, ouverture, session) et le
 * rappel signé appliqué avec les faits vérifiés (0075), comme l0-us123.
 */
export async function kycApprovedWithFacts(
  c: Tx,
  p: { userId: string; token: Buffer },
  country: string,
  facts: { dateOfBirth: string; residenceCountry: string },
): Promise<void> {
  const consent = await first<{ outcome: string }>(
    c,
    'SELECT * FROM core.kyc_cmd_biometric_consent($1, $2, $3, $4)',
    [p.token, country, 1, true],
  );
  if (consent.outcome !== 'RECORDED') throw new Error(`consentement : ${consent.outcome}`);
  const o = await first<{ outcome: string; verification_id: string; attempt: number }>(
    c,
    'SELECT * FROM core.kyc_cmd_open_verification($1, $2, $3)',
    [p.token, country, PROVIDER],
  );
  if (o.outcome !== 'READY') throw new Error(`ouverture : ${o.outcome}`);
  const sessionRef = `fk_idv_${randomBytes(6).toString('hex')}`;
  const rec = await first<{ outcome: string }>(
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
  if (rec.outcome !== 'RECORDED') throw new Error(`session : ${rec.outcome}`);
  const expires = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);
  const r = await first<{ outcome: string; status: string | null }>(
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
        expiresOn: expires,
        licenseClass: 'B',
        isPermanent: true,
        providerDocumentRef: `doc_${randomBytes(4).toString('hex')}`,
        holderGivenNames: 'Ana María',
        holderSurnames: 'Pérez Gómez',
      }),
      JSON.stringify(facts),
    ],
  );
  if (r.outcome !== 'APPLIED' || r.status !== 'APPROVED') throw new Error(`KYC : ${r.outcome}`);
}

export interface Ready {
  readonly userId: string;
  readonly token: Buffer;
  readonly org: string;
  readonly verificationId: string;
  readonly screeningKey: string | null;
}

/**
 * Hôte complet : identité approuvée (30 ans, résidence du pays), compte d'hôte, CGU acceptées,
 * dossier soumis, puis filtrage `screening` (`NONE` : aucun). Le numéro fiscal n'est pas exigé
 * par défaut (DEC-FONDATEUR-22, ADR-115).
 */
export async function readyHost(
  c: Tx,
  country: string,
  screening: 'CLEAR' | 'POTENTIAL_MATCH' | 'NONE' = 'NONE',
): Promise<Ready> {
  const p = await person(c, country);
  await kycApprovedWithFacts(c, p, country, {
    dateOfBirth: bornYearsAgo(30),
    residenceCountry: country,
  });
  const acc = await first<{ outcome: string; org_id: string | null }>(
    c,
    'SELECT * FROM core.iam_cmd_open_host_account($1, $2, $3)',
    [p.token, country, 'INDIVIDUAL'],
  );
  if (acc.outcome !== 'DONE' || !acc.org_id) throw new Error(`compte : ${acc.outcome}`);
  const terms = await first<{ outcome: string }>(
    c,
    'SELECT * FROM core.ctr_cmd_accept_host_terms($1, $2, 1, $3)',
    [p.token, acc.org_id, 'es'],
  );
  if (terms.outcome !== 'DONE') throw new Error(`CGU : ${terms.outcome}`);
  const s = await first<{
    outcome: string;
    verification_id: string | null;
    screening_key: string | null;
  }>(c, 'SELECT * FROM core.kyc_cmd_host_submit($1, $2)', [p.token, acc.org_id]);
  if (s.outcome !== 'SUBMITTED' || !s.verification_id) throw new Error(`soumission : ${s.outcome}`);
  if (screening !== 'NONE') {
    const r = await first<{ outcome: string }>(
      c,
      'SELECT * FROM core.kyc_cmd_host_record_screening($1, $2, $3, $4, $5, $6::jsonb, $7)',
      [
        p.token,
        acc.org_id,
        'FAKE',
        s.screening_key,
        screening,
        JSON.stringify(LISTS),
        screening === 'POTENTIAL_MATCH' ? `case_${randomBytes(5).toString('hex')}` : null,
      ],
    );
    if (r.outcome !== 'RECORDED') throw new Error(`filtrage : ${r.outcome}`);
  }
  return {
    userId: p.userId,
    token: p.token,
    org: acc.org_id,
    verificationId: s.verification_id,
    screeningKey: s.screening_key,
  };
}

/** État du dossier de l'hôte lu par l'hôte (aucun identifiant propre à l'appel). */
export const hostState = (c: Tx, h: { token: Buffer; org: string }) =>
  first<Record<string, unknown>>(c, 'SELECT * FROM core.kyc_host_state($1, $2)', [h.token, h.org]);

export interface ActOutcome {
  readonly outcome: string;
  readonly action_id: string | null;
  readonly domain_ref: string | null;
  readonly detail: string | null;
}

/**
 * Action de console (cadre d'US-101) dans la transaction courante, sous le contexte STAFF que
 * pose l'API ; l'erreur éventuelle est rendue sous la forme `ERR:<code>` (point de sauvegarde).
 */
export async function act(
  tx: Tx,
  who: { readonly userId: string; readonly hash: Buffer },
  action: string,
  subject: string,
  options: {
    readonly input?: Record<string, unknown>;
    readonly reason?: string;
    readonly scope?: readonly string[];
    readonly requestId?: string;
    /** Identité forgée dans le contexte (la commande doit se fier à la session, jamais au contexte). */
    readonly forgedActor?: string;
  } = {},
): Promise<ActOutcome> {
  await tx.query('SAVEPOINT act');
  try {
    await setSessionContext(tx, {
      kind: 'STAFF',
      actorId: options.forgedActor ?? who.userId,
      countryScope: options.scope ?? ALL,
      sessionTokenHash: who.hash.toString('hex'),
    });
    const { rows } = await tx.query<ActOutcome>(
      'SELECT * FROM core.iam_staff_cmd_manual_action($1, $2, $3, $4, $5, $6::jsonb, $7::uuid[])',
      [
        who.hash,
        options.requestId ?? uuid(),
        action,
        subject,
        options.reason ?? 'Dossier relu par l’ops, motif de test suffisamment long',
        options.input ?? {},
        [],
      ],
    );
    await tx.query('RELEASE SAVEPOINT act');
    return rows[0] ?? { outcome: 'NO_ROW', action_id: null, domain_ref: null, detail: null };
  } catch (error) {
    await tx.query('ROLLBACK TO SAVEPOINT act');
    return {
      outcome: `ERR:${(error as { code?: string }).code ?? '?'}`,
      action_id: null,
      domain_ref: null,
      detail: null,
    };
  }
}

/** Éléments de la file dont le sujet est `subject` (fixture 9982). */
export const itemsOf = async (c: Tx, subject: string) =>
  (
    await c.query<{
      id: string;
      queue: string;
      subject_type: string;
      status: string;
      decision: string | null;
    }>('SELECT * FROM test_fixture.us124_vehicle_items($1)', [subject])
  ).rows;

export const claimItem = async (c: Tx, s: { hash: Buffer }, item: string): Promise<string> =>
  (
    await c.query<{ outcome: string }>('SELECT * FROM core.support_staff_claim_item($1, $2, $3)', [
      s.hash,
      uuid(),
      item,
    ])
  ).rows[0]?.outcome ?? '';

/** Statut de l'annonce (fixture de l0-us118). */
export const listingStatus = async (c: Tx, id: string): Promise<string | undefined> =>
  (await c.query<{ status: string }>('SELECT * FROM test_fixture.us118_listing($1)', [id])).rows[0]
    ?.status;

/** Lignes du journal d'accès aux données personnelles de `actor` (fixture d'US-004). */
export const accessRows = async (c: Tx, actor: string) =>
  (
    await c.query<{
      id: string;
      actor_role: string;
      subject_type: string;
      subject_id: string;
      field_or_file: string;
      purpose: string;
      access_kind: string;
      case_ref: string | null;
      request_id: string | null;
    }>('SELECT * FROM test_fixture.us004_data_access_rows($1)', [actor])
  ).rows;

/** `outcome` de la première ligne (ou `ROWS:n`), l'erreur éventuelle rendue sous `ERR:<code>`. */
export async function outcomeOf(tx: Tx, sql: string, params: readonly unknown[]): Promise<string> {
  await tx.query('SAVEPOINT oc');
  try {
    const r = await tx.query<Record<string, unknown>>(sql, [...params]);
    await tx.query('RELEASE SAVEPOINT oc');
    const row = r.rows[0];
    if (row === undefined) return 'ROWS:0';
    return typeof row['outcome'] === 'string' ? row['outcome'] : `ROWS:${r.rows.length}`;
  } catch (error) {
    await tx.query('ROLLBACK TO SAVEPOINT oc');
    return `ERR:${(error as { code?: string }).code ?? '?'}`;
  }
}
