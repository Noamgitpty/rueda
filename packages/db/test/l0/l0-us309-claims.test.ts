/**
 * US-309 — déclarations de dommage et d'incident, décisions motivées par gabarit, exécution par
 * Kmino et gel du versement de l'hôte (migration 0175, ADR-195 ; fixture 9909, et 9300, 9650,
 * 9001, 9921 réutilisées). Rôles de PRODUCTION seulement (assertion L0-05 par `withRole`), au
 * Panama (USD) et au Paraguay (PYG sans décimale).
 *
 * Attendus tirés de 19 US-309 (critères 1 à 4 : fin à 10:00, délai de 24 h, déclaration le
 * lendemain à 10:01 ⇒ `CLAIM_DEADLINE_PASSED` ; dossier sans photos de départ et de retour ⇒
 * `CLAIM_DECISION_WITHOUT_EVIDENCE` ; décision sans motif ⇒ `DECISION_RATIONALE_REQUIRED` ;
 * dommage couvert ⇒ débit séparé aux jambes explicites, franchise de l'hôte au host_ledger,
 * déclaration à l'assureur journalisée, caution jamais utilisée ; parking de récupération
 * (BR-TT-05) et frais non imputable (BR-FUEL-03) exclus par le gabarit), de 16 CLM-001
 * (`claim_deadline` = max(fin prévue, check-out) + 24 h ; lot de l'hôte ON_HOLD), CLM-006
 * (`LEG_SUM_MISMATCH`), ADM-008, LEG-024, de 08 BR-DAMAGE-01 / 06, BR-PAY-09 bis et E7 règle 7,
 * de 22 OQ-BR-24 (aucune décision « définitive ») et du pré-mortem du lot 3 (L3-PM-27, 28, 34 ;
 * RT-L3-S03, H09, V04, M04), jamais du code testé. Les montants sont des SAISIES de l'ops
 * (16 CLM-006 bêta : « montants par jambe saisis par l'ops et contrôlés ») : le test vérifie qu'ils
 * sont portés tels quels, jambe par jambe, sans prorata.
 *
 * Aucun interrupteur de mise en service n'est écrit (`insurer_contract_active` reste faux : la
 * déclaration à l'assureur est journalisée, jamais envoyée). Aucun compte PSP ACTIVE n'est validé :
 * le moyen débité est l'opération de carte du loyer sur le compte FAKE de fixture du pays.
 */
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { setActor } from '../support/audit.ts';
import { COUNTRIES } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { goLive, newHash } from '../support/golive.ts';
import { openSession } from '../support/iam.ts';
import {
  applySignedStatus,
  insertAccount,
  insertTrip,
  payTx,
  recordOperation,
} from '../support/pay.ts';
import type { Legs } from '../support/pay.ts';
import { golden } from '../support/settlement.ts';
import { createStaff } from '../support/staff.ts';
import { legVector } from '@rueda/money/golden-vectors';

type Tx = pg.ClientBase;
type Row = Record<string, unknown>;
const uuid = (): string => randomUUID();
const HOUR = 3_600_000;
const plusMs = (iso: string, ms: number): string => new Date(Date.parse(iso) + ms).toISOString();

/** Fin prévue du trip à 10:00 (heure de la base, 19 US-309 critère 1). */
const START = '2035-06-07T10:00:00.000Z';
const END = '2035-06-10T10:00:00.000Z';
const BEFORE_END = plusMs(END, -HOUR);

/**
 * Saisies de l'ops par devise (unités mineures) : franchise acceptée au contrat, coût de réparation
 * constaté, réparation imputée (HOST), frais de traitement (PLATFORM) et sa taxe, franchise de
 * l'hôte, parking de récupération. PYG sans décimale.
 */
const AMOUNTS: Readonly<Record<string, Readonly<Record<string, bigint>>>> = {
  USD: {
    cap: 50000n,
    repair: 120000n,
    host: 40000n,
    fee: 5000n,
    feeTax: 350n,
    deductible: 25000n,
    parking: 1500n,
    rent: 30000n,
  },
  PYG: {
    cap: 3500000n,
    repair: 8000000n,
    host: 3000000n,
    fee: 300000n,
    feeTax: 30000n,
    deductible: 1750000n,
    parking: 100000n,
    rent: 2000000n,
  },
};
const amountsOf = (c: CountryCase): Readonly<Record<string, bigint>> => AMOUNTS[c.currency] ?? {};

const RECORD = `SELECT outcome, claim_id::text AS claim_id, body
  FROM core.support_staff_record_claim($1, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7)`;
const VIEW = 'SELECT outcome, body FROM core.support_staff_claim($1, $2::uuid, $3::uuid)';
const DECIDE = `SELECT outcome, decision_id::text AS decision_id, body
  FROM core.support_staff_issue_decision($1, $2::uuid, $3::uuid, $4::jsonb, $5)`;
const EXECUTE = 'SELECT outcome, code FROM core.claim_cmd_execute_decision($1::uuid, $2::uuid)';
const DUE = 'SELECT decision_id::text AS id FROM core.claim_decisions_due($1)';
const INSURER_DUE =
  'SELECT declaration_id::text AS id FROM core.claim_insurer_declarations_due($1)';
const INSURER_SENT = 'SELECT core.claim_cmd_record_insurer_declaration($1::uuid, $2) AS r';
const DESCRIPTION = 'Rayure profonde sur la portière avant gauche constatée au retour';
const FACTS =
  'Photos de départ sans dommage, photos de retour avec rayure ; devis du garage joint au dossier.';

interface Staff {
  readonly id: string;
}

interface World {
  readonly trip: string;
  readonly guest: string;
  readonly holder: string;
}

interface WorldOptions {
  /** Fin effective (transition RETURNED) ; `null` : trip encore en cours. */
  readonly returnedAt?: string | null;
  readonly checkin?: boolean;
  readonly checkout?: boolean;
  /** Franchise du voyageur au contrat signé (texte d'un entier) ; `null` : aucun contrat. */
  readonly cap?: string | null;
  readonly rent?: boolean;
  /** Voyageur imposé (séparation des tâches : un membre du staff voyageur du trip). */
  readonly guest?: string;
}

/** Trip (9300) terminé, séries de photos, contrat signé, loyer encaissé par carte. */
async function world(tx: Tx, c: CountryCase, o: WorldOptions = {}): Promise<World> {
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
  if (o.rent !== false) {
    await tx.query('SELECT test_fixture.us309_card_rent($1, $2)', [
      trip,
      amountsOf(c)['rent']!.toString(),
    ]);
  }
  const holder = (
    await tx.query<{ h: string }>('SELECT test_fixture.us309_holder($1)::text AS h', [trip])
  ).rows[0]!.h;
  return { trip, guest, holder };
}

async function staff(tx: Tx, role: string, countries: readonly string[]): Promise<Staff> {
  return { id: (await createStaff(tx, role, countries, { withFactor: false })).userId };
}

/** Session élevée (9650) à l'heure de la transaction ; contexte STAFF de la personne. */
async function elevated(tx: Tx, who: Staff): Promise<Buffer> {
  const hash = newHash();
  await tx.query('SELECT test_fixture.iam_open_elevated_session($1, $2)', [who.id, hash]);
  await setActor(tx, { kind: 'STAFF', actorId: who.id });
  return hash;
}

async function claimCase(
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

async function record(
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

async function decide(
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

async function audits(tx: Tx, actor: string): Promise<Row[]> {
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
function coveredDamage(c: CountryCase, extra: Row = {}): Row {
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

describe.each(COUNTRIES)(
  'US-309 — dommages et décisions ($country, $currency)',
  (c: CountryCase) => {
    it('critère 1 : fin à 10:00, délai de 24 h — déclaration le lendemain à 10:00 acceptée, à 10:01 CLAIM_DEADLINE_PASSED (heure de la base, journalisé) ; retour effectif plus tard ⇒ délai depuis le retour ; trip non commencé refusé', async () => {
      await withRole('app_api', async (api) => {
        await withTestTransaction(api, { virtualNow: BEFORE_END }, async (tx) => {
          const ops = await staff(tx, 'OPS_AGENT', [c.country]);
          const w = await world(tx, c);
          const late = await world(tx, c, { returnedAt: plusMs(END, 2 * HOUR) });
          const booked = await world(tx, c, { returnedAt: null });
          await tx.query('SELECT test_fixture.us309_set_status($1, $2)', [booked.trip, 'BOOKED']);
          const k = await claimCase(tx, c, w.trip, ops.id);
          const kLate = await claimCase(tx, c, late.trip, ops.id);
          const kBooked = await claimCase(tx, c, booked.trip, ops.id);

          // le lendemain à 10:01 (fin + 24 h + 1 min) : refus, rien n'est écrit, refus journalisé
          await tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [
            plusMs(END, 24 * HOUR + 60_000),
          ]);
          let hash = await elevated(tx, ops);
          const refused = await record(tx, hash, w.trip, k);
          expect(refused['outcome']).toBe('CLAIM_DEADLINE_PASSED');
          expect(refused['claim_id']).toBeNull();
          expect((refused['body'] as Row)['deadlineAt']).toBe('2035-06-11T10:00:00.000Z');
          expect(
            (await tx.query('SELECT * FROM test_fixture.us309_claims($1)', [w.trip])).rows,
          ).toEqual([]);
          expect(await audits(tx, ops.id)).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                action_code: 'CLAIM_REFUSED',
                code: 'CLAIM_DEADLINE_PASSED',
              }),
            ]),
          );
          // retour effectif à 12:00 : délai le lendemain à 12:00 (max(fin prévue, retour) + 24 h)
          const okLate = await record(tx, hash, late.trip, kLate);
          expect(okLate['outcome']).toBe('RECORDED');
          expect((okLate['body'] as Row)['deadlineAt']).toBe('2035-06-11T12:00:00.000Z');
          // trip non commencé : aucune déclaration
          expect((await record(tx, hash, booked.trip, kBooked))['outcome']).toBe(
            'CLAIM_TRIP_NOT_ELIGIBLE',
          );

          // le lendemain à 10:00 exactement : dans le délai ; déclarant relu en base (titulaire)
          await tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [
            plusMs(END, 24 * HOUR),
          ]);
          hash = await elevated(tx, ops);
          const requestId = uuid();
          const ok = await record(tx, hash, w.trip, k, 'HOST', 'DAMAGE', requestId);
          expect(ok['outcome']).toBe('RECORDED');
          const claims = (
            await tx.query<Row>('SELECT * FROM test_fixture.us309_claims($1)', [w.trip])
          ).rows;
          expect(claims).toHaveLength(1);
          expect(claims[0]).toMatchObject({
            declared_by: 'HOST',
            kind: 'DAMAGE',
            declarant_user_id: w.holder,
            recorded_by: ops.id,
            status: 'REPORTED',
          });
          // rejeu de la même requête : même déclaration ; seconde déclaration vivante : refusée
          const again = await record(tx, hash, w.trip, k, 'HOST', 'DAMAGE', requestId);
          expect(again).toMatchObject({ outcome: 'ALREADY_RECORDED', claim_id: ok['claim_id'] });
          expect((await record(tx, hash, w.trip, k))['outcome']).toBe('CLAIM_ALREADY_OPEN');
          // incident du voyageur sur le même trip : autre déclarant, déclarant = voyageur
          const guestIncident = await record(tx, hash, w.trip, k, 'GUEST', 'INCIDENT');
          expect(guestIncident['outcome']).toBe('RECORDED');
          const both = (
            await tx.query<Row>('SELECT * FROM test_fixture.us309_claims($1)', [w.trip])
          ).rows;
          expect(both.find((r) => r['declared_by'] === 'GUEST')?.['declarant_user_id']).toBe(
            w.guest,
          );
        });
      });
    });

    it('accès : session non élevée, autre pays, dossier non CLAIM ou d’un autre agent, agent voyageur du trip (ADR-122) ⇒ refus journalisés, rien n’est écrit', async () => {
      await withRole('app_api', async (api) => {
        await withTestTransaction(api, { virtualNow: BEFORE_END }, async (tx) => {
          const other = COUNTRIES.find((x) => x.country !== c.country)!;
          const ops = await staff(tx, 'OPS_AGENT', [c.country]);
          const colleague = await staff(tx, 'OPS_AGENT', [c.country]);
          const abroad = await staff(tx, 'OPS_AGENT', [other.country]);
          const party = await staff(tx, 'ADMIN', [c.country]);
          const w = await world(tx, c);
          const own = await world(tx, c, { guest: party.id });
          const k = await claimCase(tx, c, w.trip, ops.id);
          const kTrip = await claimCase(tx, c, w.trip, ops.id, 'TRIP');
          const kOwn = await claimCase(tx, c, own.trip, party.id);
          await tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [
            plusMs(END, HOUR),
          ]);
          const plain = await openSession(tx, ops.id);
          await setActor(tx, { kind: 'STAFF', actorId: ops.id });
          expect((await record(tx, plain.hash, w.trip, k))['outcome']).toBe('MFA_REQUIRED');
          expect((await record(tx, await elevated(tx, abroad), w.trip, k))['outcome']).toBe(
            'FORBIDDEN',
          );
          expect((await record(tx, await elevated(tx, colleague), w.trip, k))['outcome']).toBe(
            'CASE_REQUIRED',
          );
          expect((await record(tx, await elevated(tx, ops), w.trip, kTrip))['outcome']).toBe(
            'CASE_REQUIRED',
          );
          // ADMIN voyageur du trip : séparation des tâches, même pour ADMIN
          expect((await record(tx, await elevated(tx, party), own.trip, kOwn))['outcome']).toBe(
            'SELF_FORBIDDEN',
          );
          expect(await audits(tx, party.id)).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                action_code: 'STAFF_FORBIDDEN',
                reason: 'SELF',
                guard: 'SEPARATION_OF_DUTIES',
              }),
            ]),
          );
          expect(
            (await tx.query('SELECT * FROM test_fixture.us309_claims($1)', [w.trip])).rows,
          ).toEqual([]);
          expect(
            (await tx.query('SELECT * FROM test_fixture.us309_claims($1)', [own.trip])).rows,
          ).toEqual([]);
        });
      });
    });

    it('critères 2 et 4 : gabarit — retenue sans photos de départ et de retour ⇒ CLAIM_DECISION_WITHOUT_EVIDENCE ; sans motif ⇒ DECISION_RATIONALE_REQUIRED ; « definitiva » refusée ; parking de récupération et frais non imputable exclus ; Σ jambes ≠ montant ⇒ LEG_SUM_MISMATCH ; plafond du contrat ; ADMIN pour tout débit ; décideur partie au trip refusé', async () => {
      await withRole('app_api', async (api) => {
        await withTestTransaction(api, { virtualNow: BEFORE_END }, async (tx) => {
          const a = amountsOf(c);
          const ops = await staff(tx, 'OPS_AGENT', [c.country]);
          const admin = await staff(tx, 'ADMIN', [c.country]);
          const w = await world(tx, c);
          const noPhotos = await world(tx, c, { checkout: false });
          const noContract = await world(tx, c, { cap: null });
          const k = await claimCase(tx, c, w.trip, ops.id);
          const kNo = await claimCase(tx, c, noPhotos.trip, ops.id);
          const kNc = await claimCase(tx, c, noContract.trip, ops.id);
          await tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [
            plusMs(END, HOUR),
          ]);
          let hash = await elevated(tx, ops);
          const claim = String((await record(tx, hash, w.trip, k))['claim_id']);
          const claimNo = String((await record(tx, hash, noPhotos.trip, kNo))['claim_id']);
          const claimNc = String((await record(tx, hash, noContract.trip, kNc))['claim_id']);
          hash = await elevated(tx, admin);

          // retenue sans séries de départ ET de retour (LEG-024) : refusée, journalisée
          expect((await decide(tx, hash, claimNo, coveredDamage(c)))['outcome']).toBe(
            'CLAIM_DECISION_WITHOUT_EVIDENCE',
          );
          // motif absent ou trop court
          expect(
            (await decide(tx, hash, claim, coveredDamage(c, { facts: undefined })))['outcome'],
          ).toBe('DECISION_RATIONALE_REQUIRED');
          expect(
            (await decide(tx, hash, claim, coveredDamage(c, { facts: 'trop court' })))['outcome'],
          ).toBe('DECISION_RATIONALE_REQUIRED');
          // jamais « définitive » (OQ-BR-24)
          expect(
            (
              await decide(
                tx,
                hash,
                claim,
                coveredDamage(c, { facts: `${FACTS} Decisión definitiva.` }),
              )
            )['outcome'],
          ).toBe('DECISION_FINALITY_FORBIDDEN');
          // parking payé par l'hôte pour récupérer son véhicule (BR-TT-05) et frais non imputable
          // (BR-FUEL-03) : exclus par le gabarit, jamais dans le montant
          const withExcluded = coveredDamage(c, {
            lines: [
              { category: 'REPAIR', amountMinor: a['host']!.toString() },
              { category: 'PROCESSING_FEE', amountMinor: a['fee']!.toString() },
              { category: 'PROCESSING_FEE_TAX', amountMinor: a['feeTax']!.toString() },
              { category: 'RECOVERY_PARKING', amountMinor: a['parking']!.toString() },
              { category: 'NOT_ATTRIBUTABLE', amountMinor: a['parking']!.toString() },
            ],
          });
          const preview = await decide(tx, hash, claim, withExcluded, true);
          expect(preview['outcome']).toBe('PREVIEW');
          const body = preview['body'] as Row;
          expect(body['excluded']).toEqual([
            {
              category: 'RECOVERY_PARKING',
              amountMinor: a['parking']!.toString(),
              code: 'NOT_RECHARGEABLE',
              rule: 'BR-TT-05',
            },
            {
              category: 'NOT_ATTRIBUTABLE',
              amountMinor: a['parking']!.toString(),
              code: 'NOT_RECHARGEABLE',
              rule: 'BR-FUEL-03',
            },
          ]);
          expect(body['legs']).toEqual({
            HOST: a['host']!.toString(),
            INSURER: '0',
            TAX_THIRD_PARTY: a['feeTax']!.toString(),
            PLATFORM: a['fee']!.toString(),
          });
          // l'ops qui ajoute le parking au montant : Σ jambes ≠ montant
          const mismatch = await decide(
            tx,
            hash,
            claim,
            {
              ...withExcluded,
              amountMinor: (a['host']! + a['fee']! + a['feeTax']! + a['parking']!).toString(),
            },
            true,
          );
          expect(mismatch['outcome']).toBe('LEG_SUM_MISMATCH');
          // plafond : au-delà de la franchise acceptée au contrat ; contrat absent ⇒ inconnu
          const above = a['cap']! + 1n;
          expect(
            (
              await decide(tx, hash, claim, {
                ...coveredDamage(c),
                amountMinor: above.toString(),
                lines: [{ category: 'REPAIR', amountMinor: above.toString() }],
              })
            )['outcome'],
          ).toBe('DAMAGE_ABOVE_ACCEPTED_AMOUNT');
          expect((await decide(tx, hash, claimNc, coveredDamage(c)))['outcome']).toBe(
            'CLAIM_CAP_UNKNOWN',
          );
          // franchise de l'hôte au-delà du coût constaté
          expect(
            (
              await decide(
                tx,
                hash,
                claim,
                coveredDamage(c, { hostDeductibleMinor: (a['repair']! + 1n).toString() }),
              )
            )['outcome'],
          ).toBe('DAMAGE_ABOVE_REPAIR_COST');
          // une déclaration inéligible ne déclare rien à l'assureur
          expect(
            (
              await decide(tx, hash, claim, {
                ...coveredDamage(c),
                outcome: 'INELIGIBLE',
                amountMinor: '0',
                lines: [],
              })
            )['outcome'],
          ).toBe('DECISION_OUTCOME_MISMATCH');
          // OPS_AGENT : tout débit est réservé à ADMIN (seuil non fixé, PROPOSÉ)
          hash = await elevated(tx, ops);
          expect((await decide(tx, hash, claim, coveredDamage(c)))['outcome']).toBe(
            'DECISION_ADMIN_REQUIRED',
          );
          expect(await audits(tx, ops.id)).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                action_code: 'CLAIM_DECISION_REFUSED',
                code: 'DECISION_ADMIN_REQUIRED',
              }),
            ]),
          );
          // l'OPS décide seul une décision sans débit (rien dû par le voyageur, non couvert)
          const none = await decide(tx, hash, claimNo, {
            outcome: 'NO_GUEST_CHARGE',
            covered: false,
            repairCostMinor: '0',
            amountMinor: '0',
            lines: [],
            hostDeductibleMinor: '0',
            facts: FACTS,
          });
          expect(none['outcome']).toBe('DECIDED');
          expect(((none['body'] as Row)['decision'] as Row)['execution']).toBe('DONE');
          // aucune seconde décision ; la vue la rend
          expect((await decide(tx, hash, claimNo, coveredDamage(c)))['outcome']).toBe(
            'CLAIM_ALREADY_DECIDED',
          );
          const view = (await tx.query<Row>(VIEW, [hash, uuid(), claimNo])).rows[0]!;
          expect(view['outcome']).toBe('OK');
          expect(((view['body'] as Row)['decision'] as Row)['outcome']).toBe('NO_GUEST_CHARGE');
        });
      });
    });

    it('critère 3 : dommage couvert — débit SÉPARÉ du voyageur (DAMAGE / DAMAGE_SEPARATE, montant explicite de chaque jambe), franchise de l’hôte au host_ledger (débit), déclaration à l’assureur journalisée sans envoi (interrupteur faux) ; caution intacte ; exécution idempotente ; sans moyen de carte ⇒ BLOCKED', async () => {
      const a = amountsOf(c);
      const ids = await withRole('app_api', async (api) =>
        withTestTransaction(api, { virtualNow: BEFORE_END, commit: true }, async (tx) => {
          const ops = await staff(tx, 'OPS_AGENT', [c.country]);
          const admin = await staff(tx, 'ADMIN', [c.country]);
          const w = await world(tx, c);
          const noCard = await world(tx, c, { rent: false });
          const k = await claimCase(tx, c, w.trip, ops.id);
          const kNoCard = await claimCase(tx, c, noCard.trip, ops.id);
          await tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [
            plusMs(END, HOUR),
          ]);
          let hash = await elevated(tx, ops);
          const claim = String((await record(tx, hash, w.trip, k))['claim_id']);
          const claimNoCard = String((await record(tx, hash, noCard.trip, kNoCard))['claim_id']);
          hash = await elevated(tx, admin);
          const requestId = uuid();
          const decided = await decide(tx, hash, claim, coveredDamage(c), false, requestId);
          expect(decided['outcome']).toBe('DECIDED');
          const replay = await decide(tx, hash, claim, coveredDamage(c), false, requestId);
          expect(replay).toMatchObject({
            outcome: 'ALREADY_DECIDED',
            decision_id: decided['decision_id'],
          });
          const blocked = await decide(tx, hash, claimNoCard, coveredDamage(c));
          expect(blocked['outcome']).toBe('DECIDED');
          return {
            trip: w.trip,
            decision: String(decided['decision_id']),
            blocked: String(blocked['decision_id']),
          };
        }),
      );

      await withRole('app_worker', async (worker) => {
        await payTx(
          worker,
          { worker: 'payment_command', virtualNow: plusMs(END, 2 * HOUR) },
          async (tx) => {
            expect(await goLive(tx, 'insurer_contract_active', c.country)).toBe(false);
            const due = (await tx.query<{ id: string }>(DUE, [100])).rows.map((r) => r.id);
            expect(due).toEqual(expect.arrayContaining([ids.decision, ids.blocked]));
            const chargeId = uuid();
            expect((await tx.query<Row>(EXECUTE, [ids.decision, chargeId])).rows[0]).toEqual({
              outcome: 'DONE',
              code: null,
            });
            // rejeu : même issue, aucun second débit
            expect((await tx.query<Row>(EXECUTE, [ids.decision, uuid()])).rows[0]!['outcome']).toBe(
              'DONE',
            );
            const charges = (
              await tx.query<Row>('SELECT * FROM test_fixture.us309_charges($1)', [ids.decision])
            ).rows;
            expect(charges).toHaveLength(1);
            expect(charges[0]).toMatchObject({
              id: chargeId,
              purpose: 'DAMAGE',
              reason: 'DAMAGE_SEPARATE',
              amount_minor: (a['host']! + a['fee']! + a['feeTax']!).toString(),
              leg_host_minor: a['host']!.toString(),
              leg_insurer_minor: '0',
              leg_tax_third_party_minor: a['feeTax']!.toString(),
              leg_platform_minor: a['fee']!.toString(),
              guest_agreed: false,
              status: 'NOTIFIED',
            });
            // la caution n'est jamais utilisée pour un dommage (REQ-PAY-DMG-02, RT-L3-M04)
            expect(
              (
                await tx.query<{ n: number }>(
                  'SELECT test_fixture.us309_deposit_operations($1) AS n',
                  [ids.trip],
                )
              ).rows[0]!.n,
            ).toBe(0);
            // franchise de l'hôte : débit du host_ledger, jamais une jambe ni un débit du voyageur
            expect(
              (await tx.query<Row>('SELECT * FROM test_fixture.us309_ledger($1)', [ids.decision]))
                .rows,
            ).toEqual([
              expect.objectContaining({
                reason: 'CLAIM_HOST_DEDUCTIBLE',
                amount_minor: (-a['deductible']!).toString(),
                currency: c.currency,
                trip_id: null,
                settlement_id: null,
              }),
            ]);
            // déclaration à l'assureur : journalisée ; interrupteur faux ⇒ jamais envoyée
            const decl = (
              await tx.query<Row>('SELECT * FROM test_fixture.us309_declaration($1)', [
                ids.decision,
              ])
            ).rows;
            expect(decl).toEqual([
              expect.objectContaining({ status: 'PENDING', provider_ref: null }),
            ]);
            const declarationId = String(decl[0]!['id']);
            expect(
              (await tx.query<{ id: string }>(INSURER_DUE, [100])).rows.map((r) => r.id),
            ).not.toContain(declarationId);
            expect(
              (await tx.query<{ r: string }>(INSURER_SENT, [declarationId, 'fake:claim:1']))
                .rows[0]!.r,
            ).toBe('INSURER_CONTRACT_INACTIVE');
            // sans opération de carte du loyer : BLOCKED, aucun débit, aucune franchise écrite
            expect((await tx.query<Row>(EXECUTE, [ids.blocked, uuid()])).rows[0]).toEqual({
              outcome: 'BLOCKED',
              code: 'NO_CARD_TENDER',
            });
            expect(
              (await tx.query('SELECT * FROM test_fixture.us309_charges($1)', [ids.blocked])).rows,
            ).toEqual([]);
            expect(
              (await tx.query('SELECT * FROM test_fixture.us309_ledger($1)', [ids.blocked])).rows,
            ).toEqual([]);
            // registres immuables
            for (const [what, id] of [
              ['DECISION_AMOUNT', ids.decision],
              ['DECISION_REOPEN', ids.decision],
            ] as const) {
              await tx.query('SAVEPOINT w');
              await expect(
                tx.query('SELECT test_fixture.us309_try_write($1, $2)', [what, id]),
              ).rejects.toMatchObject({
                code: '23000',
                constraint: 'claim_record_immutable',
              });
              await tx.query('ROLLBACK TO SAVEPOINT w');
            }
          },
        );
      });
    });

    it('gel (US-314, L3-PM-34) : réclamation sans décision exécutée ⇒ lot de l’hôte ON_HOLD CLAIM, avant ou après la préparation, quel que soit le déclarant ; levé par la seule décision exécutée', async () => {
      const capture: Legs = {
        ...legVector(golden, c.currency === 'USD' ? 'TJ01' : 'TJ08a').legsMinor,
      };
      const total = (['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const).reduce(
        (s, k) => s + capture[k],
        0n,
      );
      await withRole('app_worker', (client) =>
        payTx(client, { worker: 'payment_command', deploymentEnv: 'test' }, async (tx) => {
          expect(await goLive(tx, 'payouts_enabled', c.country)).toBe(false);
          const psp = await insertAccount(tx, { country: c.country });
          // calendrier des jours ouvrés du pays (un férié suffit à le rendre présent, fixture 9921)
          await tx.query('SELECT test_fixture.us708_holiday($1, $2::date)', [
            c.country,
            '2032-01-01',
          ]);
          const ready = async (): Promise<string> => {
            const trip = await insertTrip(tx, c);
            const { operation_id: op } = await recordOperation(tx, {
              tripId: trip,
              accountId: psp,
              kind: 'CAPTURE',
              amountMinor: total,
              currency: c.currency,
              idemPlain: `trip:${trip}:CAPTURE:${uuid()}`,
              legs: capture,
            });
            expect(await applySignedStatus(tx, op, 'SUCCEEDED')).toBe('APPLIED');
            await tx.query('SELECT core.settlement_cmd_apply_leg_movement($1)', [op]);
            await tx.query('SELECT test_fixture.us708_verified_account($1, NULL)', [trip]);
            await tx.query(
              `SELECT pg_catalog.set_config('app.virtual_now', '2032-01-16T20:00:00Z', true)`,
            );
            await tx.query('SELECT test_fixture.us708_complete_trip($1)', [trip]);
            return trip;
          };
          const prepare = async (trip: string): Promise<Row> =>
            (
              await tx.query<Row>(
                'SELECT outcome, batch_id::text AS batch_id, hold_reasons FROM core.payout_cmd_prepare_trip($1)',
                [trip],
              )
            ).rows[0]!;
          const net = async (batch: string): Promise<string[]> =>
            (
              await tx.query<{ hold_reasons: string[] }>(
                'SELECT hold_reasons FROM core.payout_cmd_net_batch($1)',
                [batch],
              )
            ).rows[0]?.hold_reasons ?? [];

          // réclamation AVANT la préparation (dossier de support d'une autre catégorie : seule la
          // déclaration de dommage retient ici)
          const before = await ready();
          const caseBefore = await claimCase(tx, c, before, null, 'TRIP');
          const claimBefore = (
            await tx.query<{ id: string }>(
              'SELECT test_fixture.us309_insert_claim($1, $2)::text AS id',
              [before, caseBefore],
            )
          ).rows[0]!.id;
          const p1 = await prepare(before);
          expect(p1['hold_reasons']).toEqual(expect.arrayContaining(['CLAIM', 'PAYOUTS_DISABLED']));
          // décision non exécutée : toujours retenu ; exécutée : levé, les autres motifs restent
          await tx.query(
            `SELECT pg_catalog.set_config('app.virtual_now', '2032-02-10T17:00:00Z', true)`,
          );
          const pending = await tx.query('SELECT test_fixture.us309_insert_decision($1, $2)', [
            claimBefore,
            'PENDING',
          ]);
          expect(pending.rows).toHaveLength(1);
          expect(await net(String(p1['batch_id']))).toContain('CLAIM');

          // réclamation APRÈS la préparation : relue à la compensation
          await tx.query(
            `SELECT pg_catalog.set_config('app.virtual_now', '2032-01-16T20:00:00Z', true)`,
          );
          const after = await ready();
          const p2 = await prepare(after);
          expect(p2['hold_reasons']).not.toContain('CLAIM');
          const caseAfter = await claimCase(tx, c, after, null, 'TRIP');
          const claimAfter = (
            await tx.query<{ id: string }>(
              'SELECT test_fixture.us309_insert_claim($1, $2)::text AS id',
              [after, caseAfter],
            )
          ).rows[0]!.id;
          await tx.query(
            `SELECT pg_catalog.set_config('app.virtual_now', '2032-02-10T17:00:00Z', true)`,
          );
          expect(await net(String(p2['batch_id']))).toEqual(
            expect.arrayContaining(['CLAIM', 'PAYOUTS_DISABLED']),
          );
          await tx.query('SELECT test_fixture.us309_insert_decision($1, $2)', [claimAfter, 'DONE']);
          const lifted = await net(String(p2['batch_id']));
          expect(lifted).not.toContain('CLAIM');
          expect(lifted).toContain('PAYOUTS_DISABLED');
        }),
      );
    });

    it('RLS : aucun rôle applicatif ne lit ni n’écrit les tables ; commandes du travailleur réservées à payment_command ; portes du staff fermées aux travailleurs ; commandes internes sans EXECUTE', async () => {
      await withRole('app_api', async (client) => {
        const { rows } = await client.query<Row>(
          `SELECT c.relname AS t, c.relrowsecurity AS rls, c.relforcerowsecurity AS force
           FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'core' AND c.relname IN ('claim_damage_claim', 'claim_decision',
                                                     'claim_insurer_declaration')
          ORDER BY 1`,
        );
        expect(rows).toEqual([
          { t: 'claim_damage_claim', rls: true, force: true },
          { t: 'claim_decision', rls: true, force: true },
          { t: 'claim_insurer_declaration', rls: true, force: true },
        ]);
      });
      for (const role of ['app_api', 'app_worker', 'app_anon'] as const) {
        await withRole(role, async (client) => {
          for (const t of ['claim_damage_claim', 'claim_decision', 'claim_insurer_declaration']) {
            for (const sql of [`SELECT 1 FROM core.${t} LIMIT 1`, `DELETE FROM core.${t}`]) {
              await expect(client.query(sql), `${role} ${sql}`).rejects.toMatchObject({
                code: '42501',
              });
            }
          }
          for (const internal of [
            `SELECT * FROM core.claim_trip_facts('${uuid()}'::uuid)`,
            `SELECT core.claim_claim_view('${uuid()}'::uuid)`,
            `SELECT * FROM core.claim_cmd_record_claim('${uuid()}'::uuid, '${uuid()}'::uuid,
             '${uuid()}'::uuid, 'HOST', 'DAMAGE', 'texte de dix', '${uuid()}'::uuid, 'ADMIN',
             '${uuid()}'::uuid)`,
            `SELECT * FROM core.claim_cmd_issue_decision('${uuid()}'::uuid, '${uuid()}'::uuid,
             '${uuid()}'::uuid, 'ADMIN', '${uuid()}'::uuid, '{}'::jsonb, true)`,
          ]) {
            await expect(client.query(internal), role).rejects.toMatchObject({ code: '42501' });
          }
          if (role !== 'app_worker') {
            await expect(client.query(DUE, [1]), role).rejects.toMatchObject({ code: '42501' });
            await expect(client.query(EXECUTE, [uuid(), uuid()]), role).rejects.toMatchObject({
              code: '42501',
            });
          }
          if (role !== 'app_api') {
            await expect(
              client.query(RECORD, [
                newHash(),
                uuid(),
                uuid(),
                uuid(),
                'HOST',
                'DAMAGE',
                DESCRIPTION,
              ]),
              role,
            ).rejects.toMatchObject({ code: '42501' });
            await expect(
              client.query(DECIDE, [newHash(), uuid(), uuid(), '{}', true]),
              role,
            ).rejects.toMatchObject({ code: '42501' });
          }
        });
      }
      await withRole('app_worker', async (worker) => {
        for (const name of ['booking_contract', 'payout_scheduler']) {
          await withTestTransaction(worker, {}, async (tx) => {
            await setActor(tx, { kind: 'WORKER', worker: name });
            await expect(tx.query(DUE, [1])).rejects.toMatchObject({ code: '42501' });
          });
        }
        await withTestTransaction(worker, {}, async (tx) => {
          await setActor(tx, { kind: 'WORKER', worker: 'payment_command' });
          expect((await tx.query<Row>(EXECUTE, [uuid(), uuid()])).rows[0]!['outcome']).toBe(
            'NOT_FOUND',
          );
        });
      });
      await withRole('app_api', async (api) => {
        await withTestTransaction(api, {}, async (tx) => {
          // aucune session : rien n'est écrit, aucune issue d'accès révélée
          expect((await tx.query<Row>(VIEW, [newHash(), uuid(), uuid()])).rows[0]!['outcome']).toBe(
            'AUTH_REQUIRED',
          );
        });
      });
    });
  },
);
