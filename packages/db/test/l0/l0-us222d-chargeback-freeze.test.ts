/**
 * US-222d — gel de la jambe HOST au chargeback et garde des soldes (migration 0155 ; constat
 * F-L2-ARG-04 de la red team argent du lot 2 ; 08 E7 règle 7, BR-PAY-11 ; ADR-176 ; revue qa de la
 * PR #257, point 1), sous les rôles de PRODUCTION (assertion L0-05 en tête : withRole), en USD (PA)
 * et en PYG sans décimale (PY), transactions ANNULÉES.
 *
 * - Un CHARGEBACK enregistré par la vraie commande gèle la jambe HOST de son trip (raison
 *   CHARGEBACK) ; US-709 (0167, N-415 ; 08 E7 règle 7) : la part INSURER est gelée avec elle,
 *   TAX_THIRD_PARTY et PLATFORM jamais ; un statut FAILED (chargeback gagné) DÉGÈLE les deux, quand
 *   aucun autre chargeback du trip n'est ouvert (voie de dégel d'US-709, éprouvée en détail par
 *   l0-us709-chargebacks) ; un trip sans solde HOST : rien d'écrit, aucune erreur.
 * - Garde `core.settlement_trip_leg_balance_guard` : sous migrator (fixture 9931, aucun rôle
 *   applicatif n'a le droit d'écrire `frozen`), un dégel (`frozen = false`) ou une requalification
 *   (`frozen_reason` = un autre motif) TANT QUE le chargeback est ouvert ⇒ 23000
 *   `trip_leg_balance_freeze_forbidden` ; le gel d'une autre jambe (part INSURER, 08 E7 règle 7 ;
 *   fixture 9850) reste permis, puis ne se lève pas non plus.
 * Montants : capture de TJ01 / TJ08a (export des oracles), jamais calculés ici.
 */
import { legVector, loadGoldenVectors } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { translateDbError } from '../../src/index.ts';
import { withRole } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import {
  applySignedStatus,
  caught,
  insertAccount,
  insertTrip,
  payTx,
  recordOperation,
  uuid,
} from '../support/pay.ts';
import type { Legs } from '../support/pay.ts';

const golden = loadGoldenVectors();
const CAPTURE: Record<string, Legs> = Object.fromEntries(
  ['TJ01', 'TJ08a'].map((id) => {
    const v = legVector(golden, id);
    return [v.currency, { ...v.legsMinor }];
  }),
);
const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
const sum = (l: Legs): bigint => LEGS.reduce((s, k) => s + l[k], 0n);

interface Freeze {
  readonly frozen: boolean;
  readonly frozen_reason: string | null;
}

async function freezeOf(tx: pg.ClientBase, trip: string, leg: string): Promise<Freeze | null> {
  const { rows } = await tx.query<Freeze>('SELECT * FROM test_fixture.us222d_leg_freeze($1, $2)', [
    trip,
    leg,
  ]);
  return rows[0] ?? null;
}

async function setFreeze(
  tx: pg.ClientBase,
  trip: string,
  leg: string,
  frozen: boolean,
  reason: string | null,
): Promise<number> {
  const { rows } = await tx.query<{ n: number }>(
    'SELECT test_fixture.us222d_set_leg_freeze($1, $2, $3, $4) AS n',
    [trip, leg, frozen, reason],
  );
  return rows[0]?.n ?? 0;
}

async function chargeback(
  tx: pg.ClientBase,
  trip: string,
  account: string,
  amount: bigint,
  currency: string,
): Promise<string> {
  const { operation_id: id } = await recordOperation(tx, {
    tripId: trip,
    accountId: account,
    kind: 'CHARGEBACK',
    amountMinor: amount,
    currency,
    idemPlain: `trip:${trip}:CHARGEBACK:${uuid()}`,
    legs: null,
  });
  return id;
}

describe.each(COUNTRIES)('US-222d — gel au chargeback — $country ($currency)', (c) => {
  const capture = CAPTURE[c.currency];
  if (capture === undefined) throw new Error(`aucun vecteur de capture en ${c.currency}`);

  /** Trip capturé (TJ01 / TJ08a) par les vraies commandes, sous payment_command. */
  async function capturedTrip(tx: pg.ClientBase): Promise<{ trip: string; account: string }> {
    const trip = await insertTrip(tx, c);
    const account = await insertAccount(tx, { country: c.country });
    const { operation_id: op } = await recordOperation(tx, {
      tripId: trip,
      accountId: account,
      kind: 'CAPTURE',
      amountMinor: sum(capture!),
      currency: c.currency,
      idemPlain: `trip:${trip}:CAPTURE:${uuid()}`,
      legs: capture!,
    });
    expect(await applySignedStatus(tx, op, 'SUCCEEDED')).toBe('APPLIED');
    await tx.query('SELECT core.settlement_cmd_apply_leg_movement($1)', [op]);
    return { trip, account };
  }

  it('chargeback enregistré ⇒ jambes HOST et INSURER gelées (CHARGEBACK), TAX et PLATFORM jamais ; FAILED ensuite dégèle (US-709)', async () => {
    await withRole('app_worker', async (client) => {
      await payTx(client, { worker: 'payment_command' }, async (tx) => {
        const { trip, account } = await capturedTrip(tx);
        expect(await freezeOf(tx, trip, 'HOST')).toEqual({ frozen: false, frozen_reason: null });
        const cb = await chargeback(tx, trip, account, sum(capture), c.currency);
        expect(await freezeOf(tx, trip, 'HOST')).toEqual({
          frozen: true,
          frozen_reason: 'CHARGEBACK',
        });
        // US-709 (N-415, 08 E7 règle 7) : la part INSURER est gelée avec HOST pendant le litige
        expect(await freezeOf(tx, trip, 'INSURER')).toEqual({
          frozen: true,
          frozen_reason: 'CHARGEBACK',
        });
        for (const leg of ['TAX_THIRD_PARTY', 'PLATFORM']) {
          expect(await freezeOf(tx, trip, leg), leg).toEqual({
            frozen: false,
            frozen_reason: null,
          });
        }
        // US-709 : chargeback gagné ou rejeté (FAILED), aucun autre ouvert ⇒ dégel de HOST et INSURER
        expect(await applySignedStatus(tx, cb, 'FAILED')).toBe('APPLIED');
        for (const leg of ['HOST', 'INSURER']) {
          expect(await freezeOf(tx, trip, leg), leg).toEqual({
            frozen: false,
            frozen_reason: null,
          });
        }
      });
    });
  });

  it('garde (revue qa n° 1) : dégel ou requalification d’un gel ⇒ 23000 trip_leg_balance_freeze_forbidden, même sous migrator ; le gel d’une autre jambe (INSURER, règle 7) reste permis et ne se lève pas non plus', async () => {
    await withRole('app_worker', async (client) => {
      await payTx(client, { worker: 'payment_command' }, async (tx) => {
        const { trip, account } = await capturedTrip(tx);
        await chargeback(tx, trip, account, sum(capture), c.currency);
        for (const [frozen, reason] of [
          [false, null],
          [true, 'DISPUTE'],
          [true, 'CLAIM'],
        ] as const) {
          const err = await caught(tx, () => setFreeze(tx, trip, 'HOST', frozen, reason));
          expect(err, `${frozen} ${reason}`).toMatchObject({
            code: '23000',
            constraint: 'trip_leg_balance_freeze_forbidden',
          });
          expect(translateDbError(err).code).toBe('INVARIANT_VIOLATION');
          expect(await freezeOf(tx, trip, 'HOST')).toEqual({
            frozen: true,
            frozen_reason: 'CHARGEBACK',
          });
        }
        // part INSURER gelée à l'ouverture (08 E7 règle 7) par la fixture 9850 : permis
        await tx.query(`SELECT test_fixture.marketplace_freeze_leg($1, 'INSURER')`, [trip]);
        expect(await freezeOf(tx, trip, 'INSURER')).toEqual({
          frozen: true,
          frozen_reason: 'CHARGEBACK',
        });
        const lift = await caught(tx, () => setFreeze(tx, trip, 'INSURER', false, null));
        expect(lift).toMatchObject({
          code: '23000',
          constraint: 'trip_leg_balance_freeze_forbidden',
        });
        // une jambe non gelée se gèle sous migrator (ancre de la borne : la garde ne vise que le dégel)
        expect(await setFreeze(tx, trip, 'PLATFORM', true, 'DISPUTE')).toBe(1);
        expect(await freezeOf(tx, trip, 'PLATFORM')).toEqual({
          frozen: true,
          frozen_reason: 'DISPUTE',
        });
      });
    });
  });

  it('trip sans solde HOST : chargeback enregistré, rien d’écrit, aucune erreur', async () => {
    await withRole('app_worker', async (client) => {
      await payTx(client, { worker: 'payment_command' }, async (tx) => {
        const trip = await insertTrip(tx, c);
        const account = await insertAccount(tx, { country: c.country });
        const err = await caught(tx, () => chargeback(tx, trip, account, sum(capture), c.currency));
        expect(err).toBeNull();
        expect(await freezeOf(tx, trip, 'HOST')).toBeNull();
      });
    });
  });
});
