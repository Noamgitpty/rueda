/**
 * US-049 — correctifs de la red team argent de la porte du lot 0 (migration 0054, ADR-088 ;
 * docs/team/redteam/L0-argent.md, RC-1 à RC-4). Sous les rôles de PRODUCTION (assertion L0-05 en
 * tête de chaque test : withRole), en USD (PA) et en PYG sans décimale (PY).
 *
 * - RC-1 : le vérificateur en base `core.settlement_verify_cxl_beta_1` rejoue chaque vecteur
 *   normatif bêta de l'export des oracles et redonne les montants de l'ORACLE (colonnes de 08 et
 *   détail de `independent_settlement_check.py`) ; chaque version calculée par le moteur est
 *   acceptée par `settlement_cmd_record` (le rejeu égale le moteur) ; une redistribution cohérente
 *   entre jambes et une version n+1 sur un devis recomposé sont refusées.
 * - RC-2 : un remboursement exige un règlement et reste borné, jambe par jambe, par la chaîne de
 *   versions (TJ01 / TJ08a : la capture entière n'est remboursable qu'après la requalification FULL).
 * - RC-3 : le versement d'une jambe est refusé à l'ENREGISTREMENT de l'ordre, condition par
 *   condition, jusqu'à l'interrupteur `payouts_enabled[pays]`, qui vaut false (17 §0.1) ; cas
 *   passant (suite S-04, US-125) : l'interrupteur ouvert par les DEUX personnes de la procédure de
 *   0071, sur la base de test et dans une fenêtre d'horloge virtuelle lointaine refermée à false.
 * - RC-4 : limite connue, caractérisée dans `redteam-argent-psp-legs` (ARG-34a, story US-202).
 *
 * Attendus : export des oracles (`@rueda/money/golden-vectors`) et vecteurs TJ, jamais le code testé.
 */
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  legVector,
  settlementVectors,
  type GoldenSettlementVector,
} from '@rueda/money/golden-vectors';
import {
  BETA_CANCELLATION_REASONS,
  add,
  money,
  subtract,
  type SettlementRecord,
  type SettlementTrip,
} from '@rueda/money';
import { setSessionContext, translateDbError } from '../../src/index.ts';
import {
  connectAs,
  releaseClient,
  withRole,
  withTestTransaction,
} from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import {
  applySignedStatus,
  caught,
  insertAccount,
  insertTrip as insertPayTrip,
  payTx,
  recordOperation,
  uuid,
} from '../support/pay.ts';
import type { Legs } from '../support/pay.ts';
import {
  callRecord,
  eventOfVector,
  golden,
  insertTrip,
  payloadOf,
  recordAsSettlementWorker,
  recordOf,
  recordOfVector,
  tj,
  tripOfVector,
} from '../support/settlement.ts';
import { farInstant, goLive, openSwitchWindow, plusMinutes } from '../support/golive.ts';
import type { StaffActor } from '../support/golive.ts';
import { staff, staffSessionHash } from '../support/rls.ts';

const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
const ZERO: Legs = { HOST: 0n, INSURER: 0n, TAX_THIRD_PARTY: 0n, PLATFORM: 0n };
const sum = (l: Legs): bigint => LEGS.reduce((s, k) => s + l[k], 0n);
const countryOf = (currency: string): CountryCase => {
  const c = COUNTRIES.find((x) => x.currency === currency);
  if (!c) throw new Error(`aucun pays en ${currency}`);
  return c;
};

/** Références par devise : capture (TJ), v1 (no-show exécuté) puis requalification FULL (T08). */
const REF: Readonly<Record<string, { capture: string; v1: string }>> = {
  USD: { capture: 'TJ01', v1: 'T05' },
  PYG: { capture: 'TJ08a', v1: 'T41' },
};
const refOf = (c: CountryCase) => {
  const r = REF[c.currency];
  if (!r) throw new Error(`pas de référence en ${c.currency}`);
  return r;
};

const settlementWorker = <T>(fn: (tx: pg.ClientBase) => Promise<T>): Promise<T> =>
  withRole('app_worker', (client) => withTestTransaction(client, {}, fn));
const asPayments = <T>(fn: (tx: pg.ClientBase) => Promise<T>): Promise<T> =>
  withRole('app_worker', (client) => payTx(client, { worker: 'payment_command' }, fn));

/** Code métier d'une tentative dans un point de sauvegarde ('OK' sinon). */
async function outcome(tx: pg.ClientBase, run: () => Promise<unknown>): Promise<string> {
  const err = await caught(tx, run);
  return err === null ? 'OK' : translateDbError(err).code;
}

const isBeta = (v: GoldenSettlementVector): boolean =>
  (BETA_CANCELLATION_REASONS as readonly string[]).includes(v.event.reason);

// ----------------------------------------------------------------------------------------------
// RC-1 : rejeu des entrées en base
// ----------------------------------------------------------------------------------------------

describe.each(['USD', 'PYG'])(
  'RC-1 — vérificateur en base sur les vecteurs de l’export (%s)',
  (currency) => {
    const vectors = settlementVectors(golden, { currency, normativeOnly: true }).filter(isBeta);

    it('chaque vecteur normatif bêta : rejeu = oracle (08 et oracle indépendant), version acceptée par la base', async () => {
      expect(vectors.length).toBeGreaterThan(0);
      const c = countryOf(currency);
      await settlementWorker(async (tx) => {
        let recorded = 0;
        for (const [i, v] of vectors.entries()) {
          const rec = recordOfVector(v.id);
          const { rows } = await tx.query<{ r: Record<string, unknown> }>(
            'SELECT core.settlement_verify_cxl_beta_1($1::jsonb) AS r',
            [rec.inputs],
          );
          const r = rows[0]?.r ?? {};
          const e = v.expected;
          expect(
            {
              reason: r.reason,
              guestRefund: r.guestRefundMinor,
              taxRefund: r.taxRefundMinor,
              hostEarnings: r.hostEarningsMinor,
              platformNet: r.platformNetMinor,
              hostPenalty: r.hostPenaltyMinor,
              retained: r.retainedMinor,
              retainedTax: r.retainedTaxMinor,
              hostFromGuest: r.hostFromGuestMinor,
              hostCompensation: r.hostCompensationMinor,
            },
            v.id,
          ).toEqual({
            reason: e.qualifiedReason,
            guestRefund: e.guestRefundMinor.toString(),
            taxRefund: e.taxRefundedMinor.toString(),
            hostEarnings: e.hostEarningsMinor.toString(),
            platformNet: e.platformNetMinor.toString(),
            hostPenalty: e.hostPenaltyMinor.toString(),
            retained: e.retainedMinor.toString(),
            retainedTax: e.retainedTaxMinor.toString(),
            hostFromGuest: e.hostFromGuestMinor.toString(),
            hostCompensation: e.hostCompensationMinor.toString(),
          });
          // la version du moteur passe le rejeu de la base (aucun faux refus)
          const trip = await insertTrip(tx, c, 50 + i);
          await recordAsSettlementWorker(tx, { tripId: trip.id, version: 1 }, rec);
          recorded += 1;
        }
        expect(recorded).toBe(vectors.length);
      });
    });
  },
);

describe.each(COUNTRIES)(
  'RC-1 — falsifications cohérentes refusées par le rejeu — $country ($currency)',
  (c) => {
    const vector = c.currency === 'USD' ? 'T03' : 'T27';
    type LegP = Record<string, string>;
    const legP = (p: Record<string, unknown>, name: string): LegP => {
      const l = (p.legs as LegP[]).find((x) => x.leg === name);
      if (!l) throw new Error(name);
      return l;
    };
    const shift = (o: LegP | Record<string, unknown>, key: string, by: bigint): void => {
      (o as Record<string, string>)[key] = (BigInt(String(o[key] ?? '0')) + by).toString();
    };

    it('INSURER + 1 / PLATFORM − 1, état capturé tenu ⇒ INVARIANT_VIOLATION ; charge utile intacte ⇒ acceptée', async () => {
      await settlementWorker(async (tx) => {
        const trip = await insertTrip(tx, c, 70);
        // état capturé tenu, égal à la capture du vecteur (TJ01 / TJ08a)
        const capture = tj(refOf(c).capture).legsMinor;
        for (const [leg, captured] of Object.entries(capture)) {
          await tx.query(
            `SELECT test_fixture.settlement_insert_leg_balance($1, 1, $2, $3::bigint, 0)`,
            [trip.id, leg, captured.toString()],
          );
        }
        const p = payloadOf(recordOfVector(vector));
        shift(legP(p, 'INSURER'), 'keptMinor', 1n);
        shift(legP(p, 'INSURER'), 'variationMinor', 1n);
        shift(legP(p, 'PLATFORM'), 'keptMinor', -1n);
        shift(legP(p, 'PLATFORM'), 'variationMinor', -1n);
        await setSessionContext(tx, { kind: 'WORKER', workerName: 'settlement' });
        expect(await outcome(tx, () => callRecord(tx, { tripId: trip.id, version: 1 }, p))).toBe(
          'INVARIANT_VIOLATION',
        );
        // contrôle : la même version sans falsification passe
        expect(
          await outcome(tx, () =>
            callRecord(tx, { tripId: trip.id, version: 1 }, payloadOf(recordOfVector(vector))),
          ),
        ).toBe('OK');
      });
    });

    it('qualification ou état cible réécrits (montants intacts) ⇒ INVARIANT_VIOLATION', async () => {
      await settlementWorker(async (tx) => {
        for (const [slot, mutate] of [
          [71, (p: Record<string, unknown>) => (p.targetState = 'CANCELLED_BY_HOST')],
          [72, (p: Record<string, unknown>) => (p.reason = 'HOST_CANCELLED')],
          [73, (p: Record<string, unknown>) => (p.hostEligible = false)],
        ] as const) {
          const trip = await insertTrip(tx, c, slot);
          const p = payloadOf(recordOfVector(vector));
          mutate(p);
          await setSessionContext(tx, { kind: 'WORKER', workerName: 'settlement' });
          expect(await outcome(tx, () => callRecord(tx, { tripId: trip.id, version: 1 }, p))).toBe(
            'INVARIANT_VIOLATION',
          );
        }
      });
    });

    it('version n+1 calculée sur un devis recomposé à total égal (1 unité mineure du prix vers le trip fee) ⇒ INVARIANT_VIOLATION', async () => {
      const r = refOf(c);
      await settlementWorker(async (tx) => {
        const trip = await insertTrip(tx, c, 74);
        for (const [leg, captured] of Object.entries(tj(r.capture).legsMinor)) {
          await tx.query(
            `SELECT test_fixture.settlement_insert_leg_balance($1, 1, $2, $3::bigint, 0)`,
            [trip.id, leg, captured.toString()],
          );
        }
        const t = tripOfVector(r.v1);
        const r1 = recordOfVector(r.v1);
        const v1 = await recordAsSettlementWorker(tx, { tripId: trip.id, version: 1 }, r1);
        const price = t.lines.tripPrice;
        const fee = t.lines.tripFee;
        if (!price || !fee) throw new Error('trip sans tripPrice / tripFee');
        const one = money(1n, t.currency);
        const recomposed: SettlementTrip = {
          ...t,
          lines: { ...t.lines, tripPrice: subtract(price, one), tripFee: add(fee, one) },
        };
        // le moteur refuse (ARG-04c) : on forge une « version n » dont les entrées portent le devis
        // recomposé, pour obtenir une v2 cohérente avec elle-même mais sur un autre trip que la v1
        const forgedPrevious: SettlementRecord = {
          ...r1,
          inputs: recordOf(recomposed, eventOfVector(r.v1)).inputs,
        };
        const r2 = recordOf(recomposed, eventOfVector('T08'), forgedPrevious);
        expect(
          await outcome(tx, () =>
            recordAsSettlementWorker(tx, { tripId: trip.id, version: 2, supersedesId: v1 }, r2),
          ),
        ).toBe('INVARIANT_VIOLATION'); // settlement_trip_inputs_changed
        // contrôle : la requalification sur le devis figé passe
        expect(
          await outcome(tx, () =>
            recordAsSettlementWorker(
              tx,
              { tripId: trip.id, version: 2, supersedesId: v1 },
              recordOf(t, eventOfVector('T08'), r1),
            ),
          ),
        ).toBe('OK');
      });
    });
  },
);

// ----------------------------------------------------------------------------------------------
// RC-2 : remboursement rattaché au règlement
// ----------------------------------------------------------------------------------------------

async function succeeded(
  tx: pg.ClientBase,
  tripId: string,
  accountId: string,
  kind: string,
  legs: Legs,
  currency: string,
): Promise<string> {
  const { operation_id: id } = await recordOperation(tx, {
    tripId,
    accountId,
    kind,
    amountMinor: sum(legs),
    currency,
    idemPlain: `trip:${tripId}:${kind}:${uuid()}`,
    legs,
  });
  expect(await applySignedStatus(tx, id, 'SUCCEEDED')).toBe('APPLIED');
  return id;
}

async function applyMovement(tx: pg.ClientBase, operationId: string): Promise<string> {
  const { rows } = await tx.query<{ outcome: string }>(
    'SELECT core.settlement_cmd_apply_leg_movement($1) AS outcome',
    [operationId],
  );
  return rows[0]?.outcome ?? '';
}

async function refundedOf(tx: pg.ClientBase, tripId: string): Promise<Legs> {
  const { rows } = await tx.query<{ leg: string; v: string }>(
    `SELECT leg, refunded_minor::text AS v FROM core.settlement_trip_leg_balance
      WHERE trip_id = $1 AND segment_no = 1`,
    [tripId],
  );
  const out: Record<string, bigint> = { ...ZERO };
  for (const r of rows) out[r.leg] = BigInt(r.v);
  return out as unknown as Legs;
}

describe.each(COUNTRIES)(
  'RC-2 — remboursement borné par la chaîne de versions — $country ($currency)',
  (c) => {
    const r = refOf(c);
    const capture: Legs = { ...legVector(golden, r.capture).legsMinor };

    it('sans règlement ⇒ INVARIANT_VIOLATION (leg_refund_without_settlement), aucun solde modifié', async () => {
      await asPayments(async (tx) => {
        const trip = await insertPayTrip(tx, c);
        const account = await insertAccount(tx, { country: c.country });
        expect(
          await applyMovement(
            tx,
            await succeeded(tx, trip, account, 'CAPTURE', capture, c.currency),
          ),
        ).toBe('APPLIED');
        const op = await succeeded(
          tx,
          trip,
          account,
          'REFUND',
          { ...ZERO, PLATFORM: 1n },
          c.currency,
        );
        const err = await caught(tx, () => applyMovement(tx, op));
        expect(err).toMatchObject({ code: '55000', constraint: 'leg_refund_without_settlement' });
        expect(translateDbError(err).code).toBe('INVARIANT_VIOLATION');
        expect(await refundedOf(tx, trip)).toEqual(ZERO);
      });
    });

    it('capture entière remboursée : refusée après la v1 (no-show), acceptée après la requalification FULL (T08)', async () => {
      await asPayments(async (tx) => {
        const trip = await insertPayTrip(tx, c);
        const account = await insertAccount(tx, { country: c.country });
        expect(
          await applyMovement(
            tx,
            await succeeded(tx, trip, account, 'CAPTURE', capture, c.currency),
          ),
        ).toBe('APPLIED');
        const r1 = recordOfVector(r.v1);
        const v1 = await recordAsSettlementWorker(tx, { tripId: trip, version: 1 }, r1);
        await setSessionContext(tx, { kind: 'WORKER', workerName: 'payment_command' });
        const early = await succeeded(tx, trip, account, 'REFUND', capture, c.currency);
        const err = await caught(tx, () => applyMovement(tx, early));
        expect(err).toMatchObject({ code: '55000', constraint: 'leg_refund_exceeds_settlement' });
        expect(await refundedOf(tx, trip)).toEqual(ZERO);
        // requalification FULL : tout est remboursé (08, T08 ; variation v1 → v2 = TJ18a / TJ18c)
        await recordAsSettlementWorker(
          tx,
          { tripId: trip, version: 2, supersedesId: v1 },
          recordOf(tripOfVector(r.v1), eventOfVector('T08'), r1),
        );
        await setSessionContext(tx, { kind: 'WORKER', workerName: 'payment_command' });
        const full = await succeeded(tx, trip, account, 'REFUND', capture, c.currency);
        expect(await applyMovement(tx, full)).toBe('APPLIED');
        expect(await refundedOf(tx, trip)).toEqual(capture);
      });
    });
  },
);

// RC-2 (revue argent US-049, constat 6) : remboursement fractionné, dans les deux ordres, et course
// de deux remboursements. Attendus : 08 (T08 requalifie en FULL : toute la capture est
// remboursable) ; le plafond jambe par jambe et le plafond global ne dépendent ni de l'ordre des
// fractions ni de l'entrelacement des connexions.
describe.each(COUNTRIES)(
  'RC-2 — remboursement fractionné et concurrent — $country ($currency)',
  (c) => {
    const r = refOf(c);
    const capture: Legs = { ...legVector(golden, r.capture).legsMinor };
    const hostOnly: Legs = { ...ZERO, HOST: capture.HOST };
    /** Refus d'un débit au-delà du remboursable : solde de la jambe ou chaîne de versions. */
    const REFUSED = ['leg_movement_exceeds_balance', 'leg_refund_exceeds_settlement'];
    const rest: Legs = { ...capture, HOST: 0n };

    /** Trip capturé, réglé v1 (no-show) puis requalifié FULL (T08) : capture remboursable. */
    async function settledFull(tx: pg.ClientBase): Promise<{ trip: string; account: string }> {
      const trip = await insertPayTrip(tx, c);
      const account = await insertAccount(tx, { country: c.country });
      expect(
        await applyMovement(tx, await succeeded(tx, trip, account, 'CAPTURE', capture, c.currency)),
      ).toBe('APPLIED');
      const r1 = recordOfVector(r.v1);
      const v1 = await recordAsSettlementWorker(tx, { tripId: trip, version: 1 }, r1);
      await recordAsSettlementWorker(
        tx,
        { tripId: trip, version: 2, supersedesId: v1 },
        recordOf(tripOfVector(r.v1), eventOfVector('T08'), r1),
      );
      await setSessionContext(tx, { kind: 'WORKER', workerName: 'payment_command' });
      return { trip, account };
    }

    it.each([
      ['HOST puis le reste', [hostOnly, rest]],
      ['le reste puis HOST', [rest, hostOnly]],
    ] as const)(
      'fractions %s : chacune acceptée, total = capture ; une unité de plus refusée',
      async (_label, parts) => {
        await asPayments(async (tx) => {
          const { trip, account } = await settledFull(tx);
          for (const part of parts) {
            const op = await succeeded(tx, trip, account, 'REFUND', part, c.currency);
            expect(await applyMovement(tx, op)).toBe('APPLIED');
          }
          expect(await refundedOf(tx, trip)).toEqual(capture);
          const extra = await succeeded(
            tx,
            trip,
            account,
            'REFUND',
            { ...ZERO, PLATFORM: 1n },
            c.currency,
          );
          const err = await caught(tx, () => applyMovement(tx, extra));
          // refus par le solde de la jambe ou par la chaîne de versions : jamais appliqué
          expect(err?.code).toBe('55000');
          expect(REFUSED).toContain(err?.constraint);
          expect(await refundedOf(tx, trip)).toEqual(capture);
        });
      },
    );

    it('course : deux remboursements de la capture entière sur deux connexions ⇒ un seul appliqué, le second refusé', async () => {
      // mise en place validée : capture, règlements v1 et v2, deux ordres de remboursement réussis
      const { trip, ops } = await withRole('app_worker', (client) =>
        payTx(client, { worker: 'payment_command', commit: true }, async (tx) => {
          const s = await settledFull(tx);
          const a = await succeeded(tx, s.trip, s.account, 'REFUND', capture, c.currency);
          const b = await succeeded(tx, s.trip, s.account, 'REFUND', capture, c.currency);
          // aucun compte PSP ACTIVE laissé aux autres fichiers (index psp_account_one_active) :
          // le compte, qui n'a plus à enregistrer d'ordre, est suspendu avant la validation
          await tx.query(`UPDATE core.payment_psp_account SET status = 'SUSPENDED' WHERE id = $1`, [
            s.account,
          ]);
          return { trip: s.trip, ops: [a, b] as const };
        }),
      );
      const first = await connectAs('app_worker');
      const second = await connectAs('app_worker');
      try {
        const begin = async (client: pg.Client): Promise<void> => {
          await client.query('BEGIN');
          await setSessionContext(client, { kind: 'WORKER', workerName: 'payment_command' });
        };
        await begin(first);
        await begin(second);
        expect(await applyMovement(first, ops[0])).toBe('APPLIED');
        // la seconde attend le verrou du trip tenu par la première, puis relit les soldes à jour
        const racing = applyMovement(second, ops[1]).then(
          (o) => ({ ok: o }),
          (e: unknown) => ({ err: e as { code?: string; constraint?: string } }),
        );
        await new Promise((resolve) => setTimeout(resolve, 300));
        await first.query('COMMIT');
        const late = await racing;
        await second.query('ROLLBACK');
        expect('err' in late ? late.err.code : 'APPLIQUÉ').toBe('55000');
        expect(REFUSED).toContain('err' in late ? late.err.constraint : 'APPLIQUÉ');
      } finally {
        await first.query('ROLLBACK').catch(() => undefined);
        await releaseClient(first);
        await releaseClient(second);
      }
      await asPayments(async (tx) => {
        expect(await refundedOf(tx, trip)).toEqual(capture);
      });
    });
  },
);

// ----------------------------------------------------------------------------------------------
// RC-3 : versement d'une jambe gardé en base
// ----------------------------------------------------------------------------------------------

describe.each(COUNTRIES)(
  'RC-3 — versement d’une jambe refusé à l’enregistrement de l’ordre — $country ($currency)',
  (c) => {
    const capture: Legs = { ...legVector(golden, refOf(c).capture).legsMinor };

    it('chaque condition manquante est refusée dans l’ordre, jusqu’à payouts_enabled = false ; aucun ordre écrit', async () => {
      await asPayments(async (tx) => {
        const trip = await insertPayTrip(tx, c);
        const account = await insertAccount(tx, { country: c.country });
        expect(
          await applyMovement(
            tx,
            await succeeded(tx, trip, account, 'CAPTURE', capture, c.currency),
          ),
        ).toBe('APPLIED');
        const host: Legs = { ...ZERO, HOST: capture.HOST };
        const insurer: Legs = { ...ZERO, INSURER: capture.INSURER };
        const release = (legs: Legs) =>
          caught(tx, () =>
            recordOperation(tx, {
              tripId: trip,
              accountId: account,
              kind: 'LEG_RELEASE',
              amountMinor: sum(legs),
              currency: c.currency,
              idemPlain: `trip:${trip}:LEG_RELEASE:${uuid()}`,
              legs,
            }),
          );
        const expectRefused = async (legs: Legs, constraint: string, code: string) => {
          const err = await release(legs);
          expect(err, constraint).toMatchObject({ code: '55000', constraint });
          expect(translateDbError(err).code, constraint).toBe(code);
        };
        // 1. trajet seulement réservé
        await expectRefused(host, 'leg_release_trip_not_completed', 'INVALID_TRANSITION');
        await tx.query(`SELECT test_fixture.us049_set_trip_status($1, 'COMPLETED')`, [trip]);
        // 2. release_at absent (aucun écrivain encore), puis dans le futur
        await expectRefused(host, 'leg_release_not_due', 'INVALID_TRANSITION');
        await tx.query(
          `SELECT test_fixture.us049_set_release_at($1, 'HOST', platform.now() + interval '1 day')`,
          [trip],
        );
        await expectRefused(host, 'leg_release_not_due', 'INVALID_TRANSITION');
        for (const leg of LEGS) {
          await tx.query(
            `SELECT test_fixture.us049_set_release_at($1, $2, platform.now() - interval '1 minute')`,
            [trip, leg],
          );
        }
        // 3. hôte sans sous-marchand ACTIVE sur ce compte
        await expectRefused(
          host,
          'leg_release_submerchant_inactive',
          'HOST_PAYOUT_RAIL_UNAVAILABLE',
        );
        await tx.query('SELECT test_fixture.us049_activate_submerchant($1, $2)', [account, trip]);
        // 4. jambe assureur : insurer_contract_active[pays] = false
        await expectRefused(insurer, 'leg_release_insurer_inactive', 'FORBIDDEN');
        // 5. interrupteur du pays : payouts_enabled[pays] = false (graine 0009, jamais écrit ici)
        const { rows } = await tx.query<{ on: boolean }>(
          `SELECT core.config_go_live('payouts_enabled', $1) AS on`,
          [c.country],
        );
        expect(rows[0]?.on).toBe(false);
        await expectRefused(host, 'leg_release_payouts_disabled', 'FORBIDDEN');
        const ops = await tx.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM core.payment_payment_operation
          WHERE trip_id = $1 AND kind = 'LEG_RELEASE'`,
          [trip],
        );
        expect(ops.rows[0]?.n).toBe(0);
      });
    });

    it('S-04 (US-125) : payouts_enabled ouvert par deux personnes distinctes ⇒ le LEG_RELEASE qui remplit toutes les gardes passe, plafonné à la jambe HOST retenue', async () => {
      // deux personnes : un ADMIN demande, un SUPERADMIN approuve (base de TEST seulement, fenêtre
      // d'horloge virtuelle lointaine [from, to) refermée à false par la même procédure)
      const people = await withRole('app_api', async (api) => {
        const made = await withTestTransaction(api, { commit: true }, async (tx) => {
          const admin = await staff(tx, 'ADMIN', [c.country]);
          const superadmin = await staff(tx, 'SUPERADMIN', [c.country]);
          return [admin, superadmin].map((id) => ({
            userId: id,
            hash: Buffer.from(staffSessionHash(id) ?? '', 'hex'),
            scope: [c.country],
          }));
        });
        const [requester, approver] = made as unknown as [StaffActor, StaffActor];
        const from = farInstant();
        const to = plusMinutes(from, 60);
        await openSwitchWindow(api, requester, approver, 'payouts_enabled', c.country, from, to);
        return { from, to };
      });
      const inside = plusMinutes(people.from, 1);
      await withRole('app_worker', (client) =>
        payTx(client, { worker: 'payment_command', virtualNow: inside }, async (tx) => {
          expect(await goLive(tx, 'payouts_enabled', c.country)).toBe(true);
          const trip = await insertPayTrip(tx, c);
          const account = await insertAccount(tx, { country: c.country });
          expect(
            await applyMovement(
              tx,
              await succeeded(tx, trip, account, 'CAPTURE', capture, c.currency),
            ),
          ).toBe('APPLIED');
          await tx.query(`SELECT test_fixture.us049_set_trip_status($1, 'COMPLETED')`, [trip]);
          for (const leg of LEGS) {
            await tx.query(
              `SELECT test_fixture.us049_set_release_at($1, $2, platform.now() - interval '1 minute')`,
              [trip, leg],
            );
          }
          await tx.query('SELECT test_fixture.us049_activate_submerchant($1, $2)', [account, trip]);
          const release = async (amount: bigint): Promise<string> => {
            const legs: Legs = { ...ZERO, HOST: amount };
            let op = '';
            const recorded = await caught(tx, async () => {
              op = (
                await recordOperation(tx, {
                  tripId: trip,
                  accountId: account,
                  kind: 'LEG_RELEASE',
                  amountMinor: amount,
                  currency: c.currency,
                  idemPlain: `trip:${trip}:LEG_RELEASE:${uuid()}`,
                  legs,
                })
              ).operation_id;
            });
            if (recorded !== null) return `REFUSED:${recorded.constraint ?? recorded.code ?? ''}`;
            expect(await applySignedStatus(tx, op, 'SUCCEEDED')).toBe('APPLIED');
            const applied = await caught(tx, () => applyMovement(tx, op));
            return applied === null ? 'APPLIED' : `REFUSED:${applied.constraint ?? ''}`;
          };
          // au-delà de la jambe HOST retenue : refusé (aucun prorata, aucun dépassement)
          expect(await release(capture.HOST + 1n)).toMatch(
            /^REFUSED:leg_movement_exceeds_balance$/,
          );
          // la jambe HOST exacte : le versement passe (cas passant de RC-3)
          expect(await release(capture.HOST)).toBe('APPLIED');
          const { rows } = await tx.query<{ v: string }>(
            `SELECT released_minor::text AS v FROM core.settlement_trip_leg_balance
              WHERE trip_id = $1 AND segment_no = 1 AND leg = 'HOST'`,
            [trip],
          );
          expect(BigInt(rows[0]?.v ?? '-1')).toBe(capture.HOST);
          // plus rien à verser : un second versement est refusé
          expect(await release(1n)).toMatch(/^REFUSED:leg_already_released$/);
        }),
      );
      // fenêtre refermée : à son terme et maintenant, payouts_enabled vaut false
      await withRole('app_worker', async (client) => {
        for (const when of [people.to, undefined]) {
          await withTestTransaction(
            client,
            when === undefined ? {} : { virtualNow: when },
            async (tx) => {
              expect(await goLive(tx, 'payouts_enabled', c.country), when ?? 'maintenant').toBe(
                false,
              );
            },
          );
        }
      });
    });
  },
);

// RC-4 : la caractérisation « limite connue » est dans redteam-argent-psp-legs.test.ts (ARG-34a,
// ADR-088 décision 5, story du devis US-202).
