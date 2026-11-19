/**
 * US-224, durcissement argent n° 2 (migration 0150, BOARD N-367, ADR-166 n° 9) — aucun
 * encaissement par crédit tant que les crédits n'existent pas. Sous app_worker (rôle de
 * PRODUCTION, assertion L0-05 en tête : withRole), travailleur `payment_command`, en USD (PA) et en
 * PYG sans décimale (PY), transactions annulées.
 *
 * Attendus (jamais lus du code testé) : 08 E2 et le grand livre de 08 (un crédit cash ou promo est
 * un passif `credit_*_liability` de Kmino ; son utilisation au paiement est `CREDIT_REDEMPTION`) ;
 * aucun crédit n'est émis en bêta (ni module, ni passif) : refus fail-closed
 * `payment_operation_credit_unavailable` (55000, code API `PAYMENT_METHOD_UNAVAILABLE`), rien
 * d'écrit, même au rejeu d'une clé ; jambes de l'encaissement : TJ01 (USD) et TJ08a (PYG) de
 * l'export des oracles. Un encaissement par carte reste admis (témoin).
 */
import { legVector } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { withRole } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import { caught, insertAccount, insertTrip, payTx, recordOperation, uuid } from '../support/pay.ts';
import type { Legs } from '../support/pay.ts';
import { golden } from '../support/settlement.ts';

type Tx = pg.ClientBase;
const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
const sum = (l: Legs): bigint => LEGS.reduce((s, k) => s + l[k], 0n);
/** Encaissement du trip de référence, par devise (jamais par pays). */
const CAPTURE: Readonly<Record<string, string>> = { USD: 'TJ01', PYG: 'TJ08a' };

const asPayments = (fn: (tx: Tx) => Promise<void>): Promise<void> =>
  withRole('app_worker', (client) => payTx(client, { worker: 'payment_command' }, fn));

async function operations(tx: Tx, trip: string): Promise<string> {
  const { rows } = await tx.query<{ n: string }>(
    'SELECT pg_catalog.count(*)::text AS n FROM core.payment_payment_operation WHERE trip_id = $1',
    [trip],
  );
  return rows[0]?.n ?? '';
}

describe.each(COUNTRIES)(
  'US-224 (N-367) — encaissement par crédit refusé tant que les crédits n’existent pas — $country ($currency)',
  (c) => {
    const id = CAPTURE[c.currency];
    if (id === undefined) throw new Error(`aucun vecteur en ${c.currency}`);
    const legs: Legs = { ...legVector(golden, id).legsMinor };

    it('CAPTURE, AUTH, MIT_CHARGE, DEBT_COLLECTION d’un moyen CREDIT_CASH / CREDIT_PROMO (casse ignorée) et CREDIT_REDEMPTION ⇒ payment_operation_credit_unavailable, rien d’écrit ; la carte reste admise', async () => {
      expect(legVector(golden, id).currency).toBe(c.currency);
      await asPayments(async (tx) => {
        const trip = await insertTrip(tx, c);
        const account = await insertAccount(tx, { country: c.country });
        const attempt = (kind: string, method: string, purpose = 'RENT') =>
          caught(tx, () =>
            recordOperation(tx, {
              tripId: trip,
              accountId: account,
              kind,
              purpose,
              amountMinor: sum(legs),
              currency: c.currency,
              idemPlain: `trip:${trip}:${kind}:${uuid()}`,
              legs,
              method,
            }),
          );
        const refused = [
          ['CAPTURE', 'CREDIT_CASH'],
          ['CAPTURE', 'CREDIT_PROMO'],
          ['CAPTURE', 'credit_cash'],
          ['AUTH', 'CREDIT_PROMO'],
          ['MIT_CHARGE', 'CREDIT_CASH'],
          ['DEBT_COLLECTION', 'CREDIT_PROMO'],
          ['CREDIT_REDEMPTION', 'CARD'],
          ['CREDIT_REDEMPTION', 'CREDIT_CASH'],
        ] as const;
        for (const [kind, method] of refused) {
          expect(await attempt(kind, method)).toMatchObject({
            code: '55000',
            constraint: 'payment_operation_credit_unavailable',
          });
        }
        expect(await operations(tx, trip)).toBe('0');
        // témoin : la même capture par carte est enregistrée (PENDING)
        expect(await attempt('CAPTURE', 'CARD')).toBeNull();
        expect(await operations(tx, trip)).toBe('1');
      });
    });

    it('rejeu d’une clé : un encaissement déjà posé sur un crédit (fixture 9933) n’est jamais rendu comme rejeu ; la même clé par carte reste un conflit d’idempotence', async () => {
      await asPayments(async (tx) => {
        const trip = await insertTrip(tx, c);
        const account = await insertAccount(tx, { country: c.country });
        const key = `trip:${trip}:CAPTURE:${uuid()}`;
        const input = (method: string) => ({
          tripId: trip,
          accountId: account,
          kind: 'CAPTURE',
          amountMinor: sum(legs),
          currency: c.currency,
          idemPlain: key,
          legs,
          method,
        });
        const { operation_id: op } = await recordOperation(tx, input('CARD'));
        await tx.query('SELECT test_fixture.hard2_credit_tender($1, $2)', [op, 'CREDIT_CASH']);
        expect(await caught(tx, () => recordOperation(tx, input('CREDIT_CASH')))).toMatchObject({
          code: '55000',
          constraint: 'payment_operation_credit_unavailable',
        });
        expect(await caught(tx, () => recordOperation(tx, input('CARD')))).toMatchObject({
          code: '23000',
          constraint: 'payment_operation_idempotency_conflict',
        });
        expect(await operations(tx, trip)).toBe('1');
      });
    });
  },
);
