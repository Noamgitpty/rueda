/**
 * US-222c — red team du lot 2, ex-porte LB (19 US-222 critère 3) RT-L2-LB05 : écriture ENTRE
 * DEVISES (jambe USD sur un trip PYG et l'inverse ; remboursement dans une autre devise ; version de
 * règlement d'une autre devise), sous le rôle de PRODUCTION app_worker (`withRole` : assertion L0-05)
 * et les vraies commandes (`payment_cmd_record_operation` du travailleur `payment_command`,
 * `settlement_cmd_record` du travailleur `settlement`), en PA et en PY, transactions ANNULÉES. TESTS
 * SEULEMENT (L2-PM-39).
 *
 * Attendus (jamais le code testé) : 17 §3.1.5 (l'opération est dans la devise du trip), 08 E7 (les
 * jambes d'un trip sont dans sa devise ; T55 « PYG débité en USD » relève du lot C, hors bêta) ;
 * pré-mortem du lot 2, RT-L2-LB05 (« refus »), L2-PM-14. Montants : vecteurs TJ01 / TJ08a et T03 /
 * T27 de l'export des oracles (`@rueda/money/golden-vectors`), choisis par la devise du vecteur.
 * Chaque refus a son témoin : la même commande, dans la devise du trip, passe.
 */
import { legVector } from '@rueda/money/golden-vectors';
import { describe, expect, it } from 'vitest';
import { setSessionContext } from '../../../src/index.ts';
import { withRole } from '../../../src/testing/index.ts';
import { COUNTRIES } from '../../support/avl.ts';
import type { CountryCase } from '../../support/avl.ts';
import { applySignedStatus, caught, payTx, recordOperation, uuid } from '../../support/pay.ts';
import type { Legs } from '../../support/pay.ts';
import { golden, recordAsSettlementWorker, recordOfVector } from '../../support/settlement.ts';
import type { Tx } from './support-l2.ts';

const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
/** Vecteurs de capture et d'annulation du voyageur, rangés par la devise de l'export. */
const BY_CURRENCY = new Map(
  [
    { capture: 'TJ01', settlement: 'T03' },
    { capture: 'TJ08a', settlement: 'T27' },
  ].map((v) => [legVector(golden, v.capture).currency, v]),
);
const vectorsOf = (cc: CountryCase) => {
  const v = BY_CURRENCY.get(cc.currency);
  if (v === undefined) throw new Error(`aucun vecteur en ${cc.currency}`);
  return { ...v, legs: { ...legVector(golden, v.capture).legsMinor } as Legs };
};
const sum = (l: Legs): bigint => LEGS.reduce((s, k) => s + l[k], 0n);

async function tripOf(tx: Tx, cc: CountryCase): Promise<{ trip: string; account: string }> {
  const trip = uuid();
  await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
    trip,
    uuid(),
    uuid(),
    uuid(),
    cc.country,
    cc.currency,
    cc.timezone,
    '2034-03-10T15:00:00.000Z',
    '2034-03-13T15:00:00.000Z',
  ]);
  const account = (
    await tx.query<{ id: string }>('SELECT test_fixture.us024_psp_account($1) AS id', [cc.country])
  ).rows[0]!.id;
  return { trip, account };
}

describe.each(COUNTRIES)('RT-L2-LB05 — écriture entre devises ($country, $currency)', (cc) => {
  const other = COUNTRIES.find((x) => x.country !== cc.country)!;
  const own = vectorsOf(cc);
  const foreign = vectorsOf(other);

  it('capture d’une autre devise sur le trip (montant et jambes du vecteur étranger, puis montant du trip étiqueté dans l’autre devise) ⇒ payment_operation_subject_mismatch, rien d’écrit ; témoin : la même capture dans la devise du trip est enregistrée', async () => {
    await withRole('app_worker', (client) =>
      payTx(client, { worker: 'payment_command' }, async (tx) => {
        const t = await tripOf(tx, cc);
        for (const [currency, legs] of [
          [other.currency, foreign.legs],
          [other.currency, own.legs],
        ] as const) {
          const e = await caught(tx, () =>
            recordOperation(tx, {
              tripId: t.trip,
              accountId: t.account,
              kind: 'CAPTURE',
              amountMinor: sum(legs),
              currency,
              idemPlain: `trip:${t.trip}:CAPTURE:${uuid()}`,
              legs,
            }),
          );
          expect(e, currency).toMatchObject({
            code: '23000',
            constraint: 'payment_operation_subject_mismatch',
          });
        }
        const ok = await recordOperation(tx, {
          tripId: t.trip,
          accountId: t.account,
          kind: 'CAPTURE',
          amountMinor: sum(own.legs),
          currency: cc.currency,
          idemPlain: `trip:${t.trip}:CAPTURE:${uuid()}`,
          legs: own.legs,
        });
        expect(ok.replayed).toBe(false);
      }),
    );
  });

  it('remboursement dans une autre devise que le trip (avec ou sans règlement) ⇒ payment_operation_subject_mismatch, avant toute autre garde', async () => {
    await withRole('app_worker', (client) =>
      payTx(client, { worker: 'payment_command' }, async (tx) => {
        const t = await tripOf(tx, cc);
        const refund = (currency: string) =>
          caught(tx, () =>
            recordOperation(tx, {
              tripId: t.trip,
              accountId: t.account,
              kind: 'REFUND',
              amountMinor: own.legs.HOST,
              currency,
              idemPlain: `trip:${t.trip}:REFUND:${uuid()}`,
              legs: { HOST: own.legs.HOST, INSURER: 0n, TAX_THIRD_PARTY: 0n, PLATFORM: 0n },
              settlement: { id: uuid(), version: 1 },
            }),
          );
        expect(await refund(other.currency)).toMatchObject({
          constraint: 'payment_operation_subject_mismatch',
        });
        // témoin : dans la devise du trip, la garde de devise passe (refus par une AUTRE garde :
        // règlement inconnu), preuve que le refus précédent tient à la devise
        const e = await refund(cc.currency);
        expect(e).not.toBeNull();
        expect(e?.constraint).not.toBe('payment_operation_subject_mismatch');
      }),
    );
  });

  it('version de règlement d’une autre devise (vecteur d’annulation de l’autre pays) ⇒ settlement_trip_mismatch ; témoin : le vecteur de la devise du trip est enregistré', async () => {
    await withRole('app_worker', (client) =>
      payTx(client, { worker: 'payment_command' }, async (tx) => {
        const t = await tripOf(tx, cc);
        const { operation_id: op } = await recordOperation(tx, {
          tripId: t.trip,
          accountId: t.account,
          kind: 'CAPTURE',
          amountMinor: sum(own.legs),
          currency: cc.currency,
          idemPlain: `trip:${t.trip}:CAPTURE:${uuid()}`,
          legs: own.legs,
        });
        expect(await applySignedStatus(tx, op, 'SUCCEEDED')).toBe('APPLIED');
        const moved = await tx.query<{ r: string }>(
          'SELECT core.settlement_cmd_apply_leg_movement($1) AS r',
          [op],
        );
        expect(moved.rows[0]?.r).toBe('APPLIED');
        const e = await caught(tx, () =>
          recordAsSettlementWorker(
            tx,
            { tripId: t.trip, version: 1 },
            recordOfVector(foreign.settlement),
          ),
        );
        expect(e).toMatchObject({ code: '23000', constraint: 'settlement_trip_mismatch' });
        const id = await recordAsSettlementWorker(
          tx,
          { tripId: t.trip, version: 1 },
          recordOfVector(own.settlement),
        );
        expect(id).not.toBe('');
        await setSessionContext(tx, { kind: 'WORKER', workerName: 'payment_command' });
      }),
    );
  });
});
