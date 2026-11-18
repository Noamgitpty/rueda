/**
 * US-227 (migration 0139, ADR-165) — jambe de l'assureur : registre `insurer_ledger` alimenté dans la
 * transaction de sa source (encaissement porté, version de règlement), bordereau mensuel rédigé par
 * le travailleur `bordereau` et émis par DEUX personnes FINANCE distinctes, gardes d'émission (ligne
 * gelée, prime changée), refus d'une variation sur une jambe déjà portée par un bordereau émis, RLS
 * (RLS-21 à RLS-24), en USD (PA) et en PYG sans décimale (PY).
 *
 * Sous les rôles de PRODUCTION (`withRole` : assertion L0-05 en tête) : app_worker prépare et VALIDE
 * les trips par les vraies commandes (capture signée et portée sur les soldes, règlement v1 du
 * travailleur `settlement`) dans une période d'horloge virtuelle passée et propre à l'exécution
 * (année tirée entre 1950 et 1999, contrat de l'assureur de test sur cette année seulement : aucun
 * recouvrement avec les contrats « en vigueur depuis la veille » des autres fixtures) ; app_api porte
 * les décisions FINANCE (sessions élevées, fixture 9650). Fichier isolé (`vitest.l0.config.ts`) :
 * compte PSP FAKE ACTIVE du pays partagé (fixture 9800).
 *
 * Attendus : vecteurs de l'export des oracles (`@rueda/money/golden-vectors`), jamais le code testé :
 * capture TJ01 (INSURER 25,50 USD) / TJ08a (INSURER 105 000 PYG) ; règlement T03 / T27, variations
 * TJ02b / TJ08b (INSURER −25,50 / −105 000) ; 19 US-227 critères 1 à 3 ; 08 E7 règles 3, 3 bis, 6, 7.
 */
import { legVector } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { setSessionContext } from '../../src/index.ts';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { applySignedStatus, caught, payTx, recordOperation, uuid } from '../support/pay.ts';
import type { Legs } from '../support/pay.ts';
import { staff, staffSessionHash } from '../support/rls.ts';
import { golden, recordAsSettlementWorker, recordOfVector } from '../support/settlement.ts';

type Tx = pg.ClientBase;
const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
const REASON = 'Bordereau mensuel de l’assureur, contrôle de test';
const REQUEST = 'SELECT * FROM core.settlement_cmd_request_finance_action($1, $2, $3, $4, $5)';
const APPROVE = 'SELECT * FROM core.settlement_cmd_approve_finance_action($1, $2)';
const DRAFT = `SELECT outcome, country, bordereau, lines, total::text AS total
                 FROM core.settlement_cmd_draft_insurer_bordereaux($1)`;

/** Vecteurs par devise (jamais par pays). */
const REF: Readonly<Record<string, { capture: string; cancelled: string; variation: string }>> = {
  USD: { capture: 'TJ01', cancelled: 'T03', variation: 'TJ02b' },
  PYG: { capture: 'TJ08a', cancelled: 'T27', variation: 'TJ08b' },
};

/** Année de l'exécution : période passée, propre à ce fichier (contrat de test sur l'année). */
const YEAR = 1950 + Math.floor(Math.random() * 50);
const at = (month: number, day: number): string =>
  `${YEAR}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T15:00:00.000Z`;
const monthOf = (month: number): string => `${YEAR}-${String(month).padStart(2, '0')}`;

interface Entry {
  readonly id: string;
  readonly reason: string;
  readonly amount_minor: string;
  readonly currency: string;
  readonly country_code: string;
  readonly insurer_id: string | null;
  readonly insurer_contract_id: string | null;
  readonly operation_id: string | null;
  readonly settlement_id: string | null;
  readonly settlement_version: number | null;
  readonly created_at: Date;
}

interface Captured {
  readonly trip: string;
  readonly guest: string;
  readonly operation: string;
}

async function asWorker(tx: Tx, workerName: string): Promise<void> {
  await setSessionContext(tx, { kind: 'WORKER', workerName });
}

/** Trip capturé (jambes du vecteur) par la vraie commande, preuve signée et report sur les soldes. */
async function capturedTrip(
  tx: Tx,
  c: CountryCase,
  org: string,
  capture: Legs,
  month: number,
): Promise<Captured> {
  const trip = uuid();
  const guest = uuid();
  await asWorker(tx, 'payment_command');
  await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
    trip,
    guest,
    org,
    uuid(),
    c.country,
    c.currency,
    c.timezone,
    at(month, 10),
    at(month, 13),
  ]);
  const account = (
    await tx.query<{ id: string }>('SELECT test_fixture.us024_psp_account($1) AS id', [c.country])
  ).rows[0]!.id;
  const { operation_id: op } = await recordOperation(tx, {
    tripId: trip,
    accountId: account,
    kind: 'CAPTURE',
    amountMinor: LEGS.reduce((s, k) => s + capture[k], 0n),
    currency: c.currency,
    idemPlain: `trip:${trip}:CAPTURE:${uuid()}`,
    legs: capture,
  });
  expect(await applySignedStatus(tx, op, 'SUCCEEDED')).toBe('APPLIED');
  const moved = await tx.query<{ r: string }>(
    'SELECT core.settlement_cmd_apply_leg_movement($1) AS r',
    [op],
  );
  expect(moved.rows[0]?.r).toBe('APPLIED');
  return { trip, guest, operation: op };
}

async function entriesOf(tx: Tx, trip: string): Promise<Entry[]> {
  const { rows } = await tx.query<Entry>('SELECT * FROM test_fixture.us227_entries($1)', [trip]);
  return rows;
}

interface DraftRow {
  readonly outcome: string;
  readonly country: string;
  readonly bordereau: string | null;
  readonly lines: number;
  readonly total: string;
}

/** Une passe du travailleur `bordereau` sur un mois clos (VALIDÉE). */
async function draft(worker: Tx, month: string): Promise<DraftRow[]> {
  return withTestTransaction(worker, { commit: true }, async (tx) => {
    await asWorker(tx, 'bordereau');
    return (await tx.query<DraftRow>(DRAFT, [month])).rows;
  });
}

interface Outcome {
  readonly outcome: string;
  readonly approval_id: string | null;
}

/** Commande FINANCE sous le contexte STAFF de l'API (session élevée), VALIDÉE. */
async function finance(
  api: Tx,
  actor: string,
  token: Buffer,
  country: string,
  sql: string,
  params: readonly unknown[],
): Promise<Outcome> {
  return withTestTransaction(api, { commit: true }, async (tx) => {
    await setSessionContext(tx, {
      kind: 'STAFF',
      actorId: actor,
      countryScope: [country],
      sessionTokenHash: token.toString('hex'),
    });
    const { rows } = await tx.query<Outcome>(sql, [token, ...params]);
    return rows[0] ?? { outcome: '', approval_id: null };
  });
}

const hashOf = (actor: string): Buffer => Buffer.from(staffSessionHash(actor) ?? '', 'hex');

describe.each(COUNTRIES)('US-227 — registre et bordereau de l’assureur — $country ($currency)', (c) => {
  const r = REF[c.currency];
  if (r === undefined) throw new Error(`aucun vecteur en ${c.currency}`);
  const capture = { ...legVector(golden, r.capture).legsMinor } as Legs;
  const premium = capture.INSURER;
  const variation = legVector(golden, r.variation).legsMinor.INSURER;
  const other = COUNTRIES.find((x) => x.country !== c.country)!;

  // monde du pays, construit par les premiers essais puis relu par les suivants (ordre du fichier)
  const w = {
    insurer: '',
    contract: '',
    org: uuid(),
    /** annulé par le voyageur (T03 / T27) : prime due 0 */
    cancelled: null as Captured | null,
    /** terminé : une ligne du bordereau de mars */
    completed: null as Captured | null,
    /** terminé, jambe INSURER gelée (chargeback ouvert) : exclu */
    frozen: null as Captured | null,
    /** encore BOOKED : exclu */
    booked: null as Captured | null,
    march: '',
    financeA: '',
    financeB: '',
    financeOther: '',
    ops: '',
    financeASecond: Buffer.alloc(0),
  };

  it('oracle : la capture porte la prime du vecteur, le règlement la rend en entier', async () => {
    await withRole('app_worker', () => Promise.resolve());
    expect(legVector(golden, r.capture).currency).toBe(c.currency);
    expect(premium > 0n).toBe(true);
    expect(variation).toBe(-premium);
  });

  it('critère 1 : capture postée ⇒ +prime au registre ; règlement ⇒ variation INSURER stockée (−prime) ; même transaction que la source, contrat en vigueur à la réservation, rejeu sans double écriture', async () => {
    await withRole('app_worker', async (worker) => {
      await withTestTransaction(worker, { commit: true }, async (tx) => {
        const k = await tx.query<{ insurer_id: string; contract_id: string }>(
          'SELECT * FROM test_fixture.us227_contract($1, $2, $3)',
          [c.country, `${YEAR}-01-01T00:00:00Z`, `${YEAR + 1}-01-01T00:00:00Z`],
        );
        w.insurer = k.rows[0]!.insurer_id;
        w.contract = k.rows[0]!.contract_id;
      });

      // transaction ANNULÉE : l'écriture naît et meurt avec la capture qui la porte
      let ghost = '';
      await payTx(worker, { virtualNow: at(3, 5) }, async (tx) => {
        const g = await capturedTrip(tx, c, w.org, capture, 3);
        ghost = g.trip;
        const e = await entriesOf(tx, g.trip);
        expect(e.map((x) => [x.reason, BigInt(x.amount_minor)])).toEqual([
          ['COLLECTION', premium],
        ]);
      });
      await withTestTransaction(worker, {}, async (tx) => {
        expect(await entriesOf(tx, ghost)).toEqual([]);
      });

      await payTx(worker, { virtualNow: at(3, 5), commit: true }, async (tx) => {
        w.cancelled = await capturedTrip(tx, c, w.org, capture, 3);
        const settlement = await recordAsSettlementWorker(
          tx,
          { tripId: w.cancelled.trip, version: 1 },
          recordOfVector(r.cancelled),
        );
        w.completed = await capturedTrip(tx, c, w.org, capture, 3);
        w.frozen = await capturedTrip(tx, c, w.org, capture, 3);
        w.booked = await capturedTrip(tx, c, w.org, capture, 3);
        for (const t of [w.completed, w.frozen]) {
          await tx.query(`SELECT test_fixture.us049_set_trip_status($1, 'COMPLETED')`, [t.trip]);
        }
        await tx.query(`SELECT test_fixture.marketplace_freeze_leg($1, 'INSURER')`, [
          w.frozen.trip,
        ]);

        const e = await entriesOf(tx, w.cancelled.trip);
        expect(e).toHaveLength(2);
        const [col, set] = [
          e.find((x) => x.reason === 'COLLECTION'),
          e.find((x) => x.reason === 'SETTLEMENT_VARIATION'),
        ];
        expect(col).toMatchObject({
          currency: c.currency,
          country_code: c.country,
          insurer_id: w.insurer,
          insurer_contract_id: w.contract,
          operation_id: w.cancelled.operation,
          settlement_id: null,
        });
        expect(BigInt(col!.amount_minor)).toBe(premium);
        // jambe INSURER STOCKÉE de la version 1 (jamais recalculée) : TJ02b / TJ08b
        expect(set).toMatchObject({
          settlement_id: settlement,
          settlement_version: 1,
          operation_id: null,
          insurer_contract_id: w.contract,
        });
        expect(BigInt(set!.amount_minor)).toBe(variation);
        // horodatage = horloge de la base (platform.now(), virtuelle ici)
        expect(col!.created_at.toISOString()).toBe(at(3, 5));
        expect(e.reduce((s, x) => s + BigInt(x.amount_minor), 0n)).toBe(0n);

        // rejeu du report de la capture : aucune seconde écriture
        await asWorker(tx, 'payment_command');
        const again = await tx.query<{ r: string }>(
          'SELECT core.settlement_cmd_apply_leg_movement($1) AS r',
          [w.completed.operation],
        );
        expect(again.rows[0]?.r).not.toBe('APPLIED');
        expect(await entriesOf(tx, w.completed.trip)).toHaveLength(1);
      });
    });
  });

  it('critère 1 (TJ14) : aucun motif ne réduit la prime due hors règlement ; écritures immuables ; aucun rôle applicatif n’écrit le registre ni le bordereau (RLS-21)', async () => {
    await withRole('app_worker', async (worker) => {
      await withTestTransaction(worker, {}, async (tx) => {
        const [e] = await entriesOf(tx, w.completed!.trip);
        const upd = await caught(tx, () =>
          tx.query('SELECT test_fixture.us227_try_update($1)', [e!.id]),
        );
        expect(upd?.constraint).toBe('settlement_immutable');
        const del = await caught(tx, () =>
          tx.query('SELECT test_fixture.us227_try_delete($1)', [e!.id]),
        );
        expect(del?.constraint).toBe('settlement_immutable');
        for (const worker_name of ['settlement', 'bordereau', 'reconciliation']) {
          await asWorker(tx, worker_name);
          const ins = await caught(tx, () =>
            tx.query(
              `INSERT INTO core.settlement_insurer_ledger_entry
                 (id, trip_id, segment_no, org_id, country_code, currency, reason, operation_id,
                  amount_minor)
               VALUES ($1, $2, 1, $3, $4, $5, 'COLLECTION', $6, 1)`,
              [uuid(), w.completed!.trip, w.org, c.country, c.currency, w.completed!.operation],
            ),
          );
          expect(ins?.code, worker_name).toBe('42501');
        }
      });
    });
    await withRole('app_api', async (api) => {
      await withTestTransaction(api, {}, async (tx) => {
        for (const sql of [
          `INSERT INTO core.settlement_insurer_ledger_entry (id, trip_id, segment_no, org_id,
             country_code, currency, reason, operation_id, amount_minor)
           VALUES ('${uuid()}', '${w.completed!.trip}', 1, '${w.org}', '${c.country}',
                   '${c.currency}', 'COLLECTION', '${w.completed!.operation}', 1)`,
          `UPDATE core.settlement_insurer_bordereau SET status = 'ISSUED'`,
          `DELETE FROM core.settlement_insurer_ledger_entry`,
          `UPDATE core.settlement_insurer_ledger_state SET payable_minor = 0`,
        ]) {
          const err = await caught(tx, () => tx.query(sql));
          expect(err?.code, sql).toBe('42501');
        }
      });
    });
  });

  it('bordereau du mois clos : une ligne par trip terminé dont la prime est due, non gelée ; total = Σ lignes ; rédaction idempotente ; position de l’assureur projetée', async () => {
    await withRole('app_worker', async (worker) => {
      const rows = await draft(worker, monthOf(3));
      const mine = rows.filter((x) => x.country === c.country && x.outcome === 'DRAFTED');
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ lines: 1, total: premium.toString() });
      w.march = mine[0]!.bordereau!;

      await withTestTransaction(worker, {}, async (tx) => {
        await asWorker(tx, 'bordereau');
        const b = await tx.query<{
          status: string;
          insurer_id: string;
          insurer_contract_id: string;
          currency: string;
          period_month: string;
          total: string;
          lower_ok: boolean;
          upper_ok: boolean;
        }>(
          `SELECT status, insurer_id, insurer_contract_id, currency, period_month,
                  total_minor::text AS total,
                  lower(period) = ($2::date)::timestamp AT TIME ZONE $4 AS lower_ok,
                  upper(period) = ($3::date)::timestamp AT TIME ZONE $4 AS upper_ok
             FROM core.settlement_insurer_bordereau WHERE id = $1`,
          [w.march, `${monthOf(3)}-01`, `${monthOf(4)}-01`, c.timezone],
        );
        expect(b.rows[0]).toEqual({
          status: 'DRAFT',
          insurer_id: w.insurer,
          insurer_contract_id: w.contract,
          currency: c.currency,
          period_month: monthOf(3),
          total: premium.toString(),
          lower_ok: true,
          upper_ok: true,
        });
        const lines = await tx.query<{ trip_id: string; amount: string; country_code: string }>(
          `SELECT trip_id, amount_minor::text AS amount, country_code
             FROM core.settlement_insurer_bordereau_line WHERE bordereau_id = $1`,
          [w.march],
        );
        expect(lines.rows).toEqual([
          { trip_id: w.completed!.trip, amount: premium.toString(), country_code: c.country },
        ]);
        // position : à payer = trip terminé (ligne DRAFT, pas encore émise) + trip BOOKED ;
        // gelé = trip au chargeback ouvert ; aucune créance
        const s = await tx.query<{ payable: string; frozen: string; receivable: string }>(
          `SELECT payable_minor::text AS payable, frozen_minor::text AS frozen,
                  receivable_minor::text AS receivable
             FROM core.settlement_insurer_ledger_state
            WHERE insurer_id = $1 AND country_code = $2 AND currency = $3`,
          [w.insurer, c.country, c.currency],
        );
        expect(s.rows[0]).toEqual({
          payable: (2n * premium).toString(),
          frozen: premium.toString(),
          receivable: '0',
        });
      });

      // seconde passe : le même bordereau, aucune ligne de plus
      const again = await draft(worker, monthOf(3));
      expect(
        again.filter((x) => x.country === c.country && x.bordereau === w.march),
      ).toEqual([
        { outcome: 'EXISTS', country: c.country, bordereau: w.march, lines: 1, total: premium.toString() },
      ]);
      // mois non clos : rien
      await withTestTransaction(worker, { virtualNow: at(3, 20) }, async (tx) => {
        await asWorker(tx, 'bordereau');
        const open = await tx.query<DraftRow>(DRAFT, [monthOf(3)]);
        expect(open.rows.filter((x) => x.country === c.country)).toEqual([
          { outcome: 'PERIOD_OPEN', country: c.country, bordereau: null, lines: 0, total: '0' },
        ]);
      });
      // autre travailleur : refus
      await withTestTransaction(worker, {}, async (tx) => {
        await asWorker(tx, 'settlement');
        const err = await caught(tx, () => tx.query(DRAFT, [monthOf(3)]));
        expect(err?.constraint).toBe('insurer_ledger_command_forbidden');
      });
    });
  });

  it('critère 2 (RLS-24) : FINANCE A demande ISSUE_BORDEREAU puis l’approuve elle-même, même dans une seconde session ⇒ refus ; FINANCE B approuve ⇒ ISSUED, chaque ligne rattachée à un trip', async () => {
    await withRole('app_api', async (api) => {
      await withTestTransaction(api, { commit: true }, async (tx) => {
        w.financeA = await staff(tx, 'FINANCE', [c.country]);
        w.financeB = await staff(tx, 'FINANCE', [c.country]);
        w.financeOther = await staff(tx, 'FINANCE', [other.country]);
        w.ops = await staff(tx, 'OPS_AGENT', [c.country]);
        w.financeASecond = Buffer.from(uuid().replace(/-/g, '').repeat(2), 'hex');
        await tx.query('SELECT test_fixture.iam_open_elevated_session($1, $2)', [
          w.financeA,
          w.financeASecond,
        ]);
      });
      const req = await finance(api, w.financeA, hashOf(w.financeA), c.country, REQUEST, [
        uuid(),
        'ISSUE_BORDEREAU',
        w.march,
        REASON,
      ]);
      expect(req.outcome).toBe('REQUESTED');
      const self = await finance(api, w.financeA, w.financeASecond, c.country, APPROVE, [
        req.approval_id,
      ]);
      expect(self.outcome).toBe('SELF_APPROVAL');
      const ok = await finance(api, w.financeB, hashOf(w.financeB), c.country, APPROVE, [
        req.approval_id,
      ]);
      expect(ok.outcome).toBe('APPROVED');

      await withTestTransaction(api, {}, async (tx) => {
        const row = await tx.query<{ status: string; issued_by: string; second_validated_by: string }>(
          'SELECT status, issued_by, second_validated_by FROM test_fixture.us062_bordereau_row($1)',
          [w.march],
        );
        expect(row.rows[0]).toEqual({
          status: 'ISSUED',
          issued_by: w.financeA,
          second_validated_by: w.financeB,
        });
        await setSessionContext(tx, {
          kind: 'STAFF',
          actorId: w.financeB,
          countryScope: [c.country],
          sessionTokenHash: hashOf(w.financeB).toString('hex'),
        });
        const lines = await tx.query<{ trip_id: string }>(
          'SELECT trip_id FROM core.settlement_insurer_bordereau_line WHERE bordereau_id = $1',
          [w.march],
        );
        expect(lines.rows).toEqual([{ trip_id: w.completed!.trip }]);
        const entries = await tx.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM core.settlement_insurer_ledger_entry
            WHERE trip_id = ANY ($1::uuid[])`,
          [[w.cancelled!.trip, w.completed!.trip]],
        );
        expect(entries.rows[0]?.n).toBe(3);
      });
    });

    // position projetée par la passe suivante : la ligne émise n'est plus à payer
    await withRole('app_worker', async (worker) => {
      await draft(worker, monthOf(3));
      await withTestTransaction(worker, {}, async (tx) => {
        await asWorker(tx, 'bordereau');
        const s = await tx.query<{ payable: string; frozen: string; receivable: string }>(
          `SELECT payable_minor::text AS payable, frozen_minor::text AS frozen,
                  receivable_minor::text AS receivable
             FROM core.settlement_insurer_ledger_state
            WHERE insurer_id = $1 AND country_code = $2 AND currency = $3`,
          [w.insurer, c.country, c.currency],
        );
        expect(s.rows[0]).toEqual({
          payable: premium.toString(),
          frozen: premium.toString(),
          receivable: '0',
        });
      });
    });
  });

  it('critère 1 (règle 3 bis) : une variation INSURER sur un trip déjà porté par un bordereau émis est refusée ; rien n’est écrit', async () => {
    await withRole('app_worker', async (worker) => {
      await withTestTransaction(worker, {}, async (tx) => {
        const err = await caught(tx, () =>
          recordAsSettlementWorker(
            tx,
            { tripId: w.completed!.trip, version: 1 },
            recordOfVector(r.cancelled),
          ),
        );
        expect(err?.constraint).toBe('insurer_leg_on_bordereau');
        expect(await entriesOf(tx, w.completed!.trip)).toHaveLength(1);
      });
    });
  });

  it('critère 3 (RLS-22, RLS-23, RLS-24) : voyageur, hôte, OPS_AGENT sans dossier et FINANCE d’un autre pays ne lisent rien ; FINANCE du pays lit registre, bordereau et position', async () => {
    await withRole('app_api', async (api) => {
      await withTestTransaction(api, {}, async (tx) => {
        const read = async (): Promise<number[]> => {
          const out: number[] = [];
          for (const t of [
            'settlement_insurer_ledger_entry',
            'settlement_insurer_bordereau',
            'settlement_insurer_bordereau_line',
            'settlement_insurer_ledger_state',
          ]) {
            const { rows } = await tx.query<{ n: number }>(
              `SELECT count(*)::int AS n FROM core.${t} WHERE country_code = $1`,
              [c.country],
            );
            out.push(rows[0]?.n ?? -1);
          }
          return out;
        };
        await setSessionContext(tx, { kind: 'GUEST', actorId: w.completed!.guest });
        expect(await read()).toEqual([0, 0, 0, 0]);
        await setSessionContext(tx, { kind: 'HOST', actorId: uuid(), orgId: w.org });
        expect(await read()).toEqual([0, 0, 0, 0]);
        for (const [actor, scope] of [
          [w.ops, c.country],
          [w.financeOther, other.country],
        ] as const) {
          await setSessionContext(tx, {
            kind: 'STAFF',
            actorId: actor,
            countryScope: [scope, c.country],
            sessionTokenHash: hashOf(actor).toString('hex'),
          });
          expect(await read()).toEqual([0, 0, 0, 0]);
        }
        await setSessionContext(tx, {
          kind: 'STAFF',
          actorId: w.financeA,
          countryScope: [c.country],
          sessionTokenHash: hashOf(w.financeA).toString('hex'),
        });
        const seen = await read();
        expect(seen.every((n) => n > 0)).toBe(true);
      });
    });
  });

  it('gardes d’émission : une ligne dont la jambe INSURER est gelée après la rédaction (chargeback ouvert, règle 7) bloque l’émission ; une prime changée depuis la rédaction aussi', async () => {
    let may = '';
    let july = '';
    let mayTrip = '';
    await withRole('app_worker', async (worker) => {
      await payTx(worker, { virtualNow: at(5, 2), commit: true }, async (tx) => {
        const t = await capturedTrip(tx, c, w.org, capture, 5);
        await tx.query(`SELECT test_fixture.us049_set_trip_status($1, 'COMPLETED')`, [t.trip]);
        mayTrip = t.trip;
      });
      may = (await draft(worker, monthOf(5))).find(
        (x) => x.country === c.country && x.outcome === 'DRAFTED',
      )!.bordereau!;
      await payTx(worker, { commit: true }, async (tx) => {
        await asWorker(tx, 'payment_command');
        await tx.query(`SELECT test_fixture.marketplace_freeze_leg($1, 'INSURER')`, [mayTrip]);
      });

      let julyTrip = '';
      await payTx(worker, { virtualNow: at(7, 2), commit: true }, async (tx) => {
        const t = await capturedTrip(tx, c, w.org, capture, 7);
        await tx.query(`SELECT test_fixture.us049_set_trip_status($1, 'COMPLETED')`, [t.trip]);
        julyTrip = t.trip;
      });
      const rows = await draft(worker, monthOf(7));
      const j = rows.find((x) => x.country === c.country && x.outcome === 'DRAFTED')!;
      expect(j).toMatchObject({ lines: 1, total: premium.toString() });
      july = j.bordereau!;
      // règlement APRÈS la rédaction (bordereau encore DRAFT : la variation est admise)
      await payTx(worker, { commit: true }, async (tx) => {
        await recordAsSettlementWorker(
          tx,
          { tripId: julyTrip, version: 1 },
          recordOfVector(r.cancelled),
        );
      });
    });

    await withRole('app_api', async (api) => {
      for (const [subject, constraint] of [
        [may, 'insurer_bordereau_line_frozen'],
        [july, 'insurer_bordereau_stale'],
      ] as const) {
        const req = await finance(api, w.financeA, hashOf(w.financeA), c.country, REQUEST, [
          uuid(),
          'ISSUE_BORDEREAU',
          subject,
          REASON,
        ]);
        expect(req.outcome).toBe('REQUESTED');
        await withTestTransaction(api, {}, async (tx) => {
          await setSessionContext(tx, {
            kind: 'STAFF',
            actorId: w.financeB,
            countryScope: [c.country],
            sessionTokenHash: hashOf(w.financeB).toString('hex'),
          });
          const err = await caught(tx, () =>
            tx.query(APPROVE, [hashOf(w.financeB), req.approval_id]),
          );
          expect(err?.constraint, subject).toBe(constraint);
          const row = await tx.query<{ status: string }>(
            'SELECT status FROM test_fixture.us062_bordereau_row($1)',
            [subject],
          );
          expect(row.rows[0]?.status).toBe('DRAFT');
        });
      }
    });
  });
});
