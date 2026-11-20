/**
 * Aides des preuves d'US-309 (migration 0175, fixture 9909) partagées par `l0-us309-claims` et
 * `l0-us309-claims-race` : monde de test (trip terminé, photos, contrat signé, loyer par carte,
 * caution facultative), membres du staff et sessions élevées, portes de la console, saisies de
 * l'ops par devise (montants saisis, jamais recalculés par le code testé).
 */
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { setActor } from './audit.ts';
import { COUNTRIES } from './avl.ts';
import type { CountryCase } from './avl.ts';
import { newHash } from './golive.ts';
import { createStaff } from './staff.ts';

export type Tx = pg.ClientBase;
export type Row = Record<string, unknown>;
export const uuid = (): string => randomUUID();
export const HOUR = 3_600_000;
export const DAY_MS = 86_400_000;
export const plusMs = (iso: string, ms: number): string =>
  new Date(Date.parse(iso) + ms).toISOString();

/** Fin prévue du trip à 10:00 (heure de la base, 19 US-309 critère 1). */
export const START = '2035-06-07T10:00:00.000Z';
export const END = '2035-06-10T10:00:00.000Z';
export const BEFORE_END = plusMs(END, -HOUR);

/**
 * Saisies de l'ops par devise (unités mineures) : franchise acceptée au contrat, coût de réparation
 * constaté, réparation imputée (HOST), frais de traitement (PLATFORM) et sa taxe, franchise de
 * l'hôte, parking de récupération. PYG sans décimale.
 */
export const AMOUNTS: readonly Readonly<Record<string, bigint>>[] = [
  // devise à deux décimales (premier pays de COUNTRIES)
  {
    cap: 50000n,
    repair: 120000n,
    host: 40000n,
    fee: 5000n,
    feeTax: 350n,
    deductible: 25000n,
    parking: 1500n,
    rent: 30000n,
  },
  // devise sans décimale (second pays de COUNTRIES)
  {
    cap: 3500000n,
    repair: 8000000n,
    host: 3000000n,
    fee: 300000n,
    feeTax: 30000n,
    deductible: 1750000n,
    parking: 100000n,
    rent: 2000000n,
  },
];
export const amountsOf = (c: CountryCase): Readonly<Record<string, bigint>> =>
  AMOUNTS[COUNTRIES.indexOf(c)] ?? {};

export const RECORD = `SELECT outcome, claim_id::text AS claim_id, body
  FROM core.support_staff_record_claim($1, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7)`;
export const VIEW = 'SELECT outcome, body FROM core.support_staff_claim($1, $2::uuid, $3::uuid)';
export const DECIDE = `SELECT outcome, decision_id::text AS decision_id, body
  FROM core.support_staff_issue_decision($1, $2::uuid, $3::uuid, $4::jsonb, $5)`;
export const EXECUTE =
  'SELECT outcome, code FROM core.claim_cmd_execute_decision($1::uuid, $2::uuid)';
export const DUE = 'SELECT decision_id::text AS id FROM core.claim_decisions_due($1)';
export const INSURER_DUE =
  'SELECT declaration_id::text AS id FROM core.claim_insurer_declarations_due($1)';
export const INSURER_SENT = 'SELECT core.claim_cmd_record_insurer_declaration($1::uuid, $2) AS r';
export const DESCRIPTION = 'Rayure profonde sur la portière avant gauche constatée au retour';
export const FACTS =
  'Photos de départ sans dommage, photos de retour avec rayure ; devis du garage joint au dossier.';

export interface Staff {
  readonly id: string;
}

export interface World {
  readonly trip: string;
  readonly guest: string;
  readonly holder: string;
  /** Opération de carte du loyer (moyen du débit séparé) ; `null` sans loyer. */
  readonly rent: string | null;
  /** Autorisation de caution (DEPOSIT_AUTH) ; `null` sans caution. */
  readonly deposit: string | null;
}

export interface WorldOptions {
  /** Fin effective (transition RETURNED) ; `null` : trip encore en cours. */
  readonly returnedAt?: string | null;
  readonly checkin?: boolean;
  readonly checkout?: boolean;
  /** Franchise du voyageur au contrat signé (texte d'un entier) ; `null` : aucun contrat. */
  readonly cap?: string | null;
  readonly rent?: boolean;
  /** Voyageur imposé (séparation des tâches : un membre du staff voyageur du trip). */
  readonly guest?: string;
  /** Caution autorisée sur le trip (revue qa n° 1). */
  readonly deposit?: boolean;
}

/** Trip (9300) terminé, séries de photos, contrat signé, loyer encaissé par carte. */
export async function world(tx: Tx, c: CountryCase, o: WorldOptions = {}): Promise<World> {
  const trip = uuid();
  const guest = o.guest ?? uuid();
  await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
    trip,
    guest,
    uuid(),
    uuid(),
    c.country,
    c.currency,
    c.timezone,
    START,
    END,
  ]);
  const returnedAt = o.returnedAt === undefined ? END : o.returnedAt;
  if (returnedAt === null) {
    await tx.query('SELECT test_fixture.us309_set_status($1, $2)', [trip, 'IN_PROGRESS']);
  } else {
    await tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [returnedAt]);
    await tx.query('SELECT test_fixture.us309_returned($1)', [trip]);
  }
  if (o.checkin !== false)
    await tx.query('SELECT test_fixture.us309_inspection($1, $2)', [trip, 'CHECKIN']);
  if (o.checkout !== false)
    await tx.query('SELECT test_fixture.us309_inspection($1, $2)', [trip, 'CHECKOUT']);
  const cap = o.cap === undefined ? amountsOf(c)['cap']!.toString() : o.cap;
  if (cap !== null) await tx.query('SELECT test_fixture.us309_contract($1, $2, true)', [trip, cap]);
  let rent: string | null = null;
  if (o.rent !== false) {
    rent =
      (
        await tx.query<{ id: string }>('SELECT test_fixture.us309_card_rent($1, $2)::text AS id', [
          trip,
          amountsOf(c)['rent']!.toString(),
        ])
      ).rows[0]?.id ?? null;
  }
  let deposit: string | null = null;
  if (o.deposit === true) {
    deposit =
      (
        await tx.query<{ id: string }>(
          'SELECT test_fixture.us309_deposit_auth($1, $2)::text AS id',
          [trip, amountsOf(c)['cap']!.toString()],
        )
      ).rows[0]?.id ?? null;
  }
  const holder = (
    await tx.query<{ h: string }>('SELECT test_fixture.us309_holder($1)::text AS h', [trip])
  ).rows[0]!.h;
  return { trip, guest, holder, rent, deposit };
}

export async function staff(tx: Tx, role: string, countries: readonly string[]): Promise<Staff> {
  return { id: (await createStaff(tx, role, countries, { withFactor: false })).userId };
}

/** Session élevée (9650) à l'heure de la transaction ; contexte STAFF de la personne. */
export async function elevated(tx: Tx, who: Staff): Promise<Buffer> {
  const hash = newHash();
  await tx.query('SELECT test_fixture.iam_open_elevated_session($1, $2)', [who.id, hash]);
  await setActor(tx, { kind: 'STAFF', actorId: who.id });
  return hash;
}

export async function claimCase(
  tx: Tx,
  c: CountryCase,
  trip: string,
  assignee: string | null,
  category = 'CLAIM',
  status = 'OPEN',
): Promise<string> {
  const id = uuid();
  await tx.query('SELECT test_fixture.rls_insert_support_case($1, $2, $3, $4, $5, $6, NULL)', [
    id,
    c.country,
    trip,
    assignee,
    status,
    category,
  ]);
  return id;
}

export async function record(
  tx: Tx,
  hash: Buffer,
  trip: string,
  caseId: string,
  declaredBy = 'HOST',
  kind = 'DAMAGE',
  requestId = uuid(),
): Promise<Row> {
  return (
    await tx.query<Row>(RECORD, [hash, requestId, trip, caseId, declaredBy, kind, DESCRIPTION])
  ).rows[0]!;
}

export async function decide(
  tx: Tx,
  hash: Buffer,
  claim: string,
  input: Row,
  preview = false,
  requestId = uuid(),
): Promise<Row> {
  return (await tx.query<Row>(DECIDE, [hash, requestId, claim, JSON.stringify(input), preview]))
    .rows[0]!;
}

export async function audits(tx: Tx, actor: string): Promise<Row[]> {
  return (
    await tx.query<Row>(
      `SELECT action_code, after ->> 'reason' AS reason, after ->> 'code' AS code,
              after ->> 'guard' AS guard
         FROM test_fixture.audit_rows_of_actor($1)`,
      [actor],
    )
  ).rows;
}

/** Dommage couvert : franchise du voyageur (réparation + frais + taxe), franchise de l'hôte. */
export function coveredDamage(c: CountryCase, extra: Row = {}): Row {
  const a = amountsOf(c);
  const total = a['host']! + a['fee']! + a['feeTax']!;
  return {
    outcome: 'GUEST_LIABLE',
    covered: true,
    repairCostMinor: a['repair']!.toString(),
    amountMinor: total.toString(),
    lines: [
      { category: 'REPAIR', amountMinor: a['host']!.toString() },
      { category: 'PROCESSING_FEE', amountMinor: a['fee']!.toString() },
      { category: 'PROCESSING_FEE_TAX', amountMinor: a['feeTax']!.toString() },
    ],
    hostDeductibleMinor: a['deductible']!.toString(),
    facts: FACTS,
    ...extra,
  };
}
