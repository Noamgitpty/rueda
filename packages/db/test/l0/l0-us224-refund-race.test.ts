/**
 * US-224 (migration 0120, ADR-145) — ordres de règlement sur DEUX connexions (L2-PM-05, modèle
 * `rt-conc-*`, S-03) : la garde d'enregistrement prend le verrou du trip, compte les ordres en vol
 * validés par l'autre session et relit la version en tête après l'attente. Fichier ISOLÉ
 * (`vitest.l0.config.ts`, projet `l0-concurrence`) : la mise en place est validée (COMMIT) sur le
 * compte FAKE ACTIVE du pays partagé par les fichiers isolés (fixture 9800, index
 * `psp_account_one_active`). Aucun interrupteur n'est ouvert.
 *
 * Sous app_worker (rôle de PRODUCTION, assertion L0-05 : withRole / connectAs), en USD (PA) et en
 * PYG (PY). Attendus : export des oracles (TJ01 / TJ02b / T03, TJ08a / TJ08b / T27, T08), codes de
 * 16 PAY-021 et d'ADR-145 ; jamais le code testé.
 */
import { legVector } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { setSessionContext } from '../../src/index.ts';
import { connectAs, releaseClient, withRole } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { applySignedStatus, insertTrip, payTx, recordOperation, uuid } from '../support/pay.ts';
import type { Legs, SettlementRef } from '../support/pay.ts';
import {
  eventOfVector,
  golden,
  recordAsSettlementWorker,
  recordOf,
  recordOfVector,
  tripOfVector,
} from '../support/settlement.ts';
import { settlementRecordPayload } from '@rueda/money';

const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
const sum = (l: Legs): bigint => LEGS.reduce((s, k) => s + l[k], 0n);
const negate = (l: Legs): Legs =>
  Object.fromEntries(LEGS.map((k) => [k, -l[k]])) as unknown as Legs;

const REF: Readonly<Record<string, { capture: string; settlement: string; variation: string }>> = {
  USD: { capture: 'TJ01', settlement: 'T03', variation: 'TJ02b' },
  PYG: { capture: 'TJ08a', settlement: 'T27', variation: 'TJ08b' },
};

interface Setup {
  readonly trip: string;
  readonly account: string;
  readonly v1: SettlementRef;
}

/** Mise en place VALIDÉE : trip capturé (jambes du vecteur), règlement v1 ; compte ACTIVE. */
async function setup(c: CountryCase): Promise<Setup> {
  const r = REF[c.currency];
  if (r === undefined) throw new Error(`aucun vecteur en ${c.currency}`);
  const capture: Legs = { ...legVector(golden, r.capture).legsMinor };
  return withRole('app_worker', (client) =>
    payTx(client, { worker: 'payment_command', commit: true }, async (tx) => {
      const trip = await insertTrip(tx, c);
      // compte FAKE ACTIVE du pays partagé par les fichiers isolés (fixture 9800 : réutilisé s'il
      // existe, un seul compte ACTIVE par pays)
      const a = await tx.query<{ id: string }>('SELECT test_fixture.us024_psp_account($1) AS id', [
        c.country,
      ]);
      const account = a.rows[0]?.id ?? '';
      const { operation_id: cap } = await recordOperation(tx, {
        tripId: trip,
        accountId: account,
        kind: 'CAPTURE',
        amountMinor: sum(capture),
        currency: c.currency,
        idemPlain: `trip:${trip}:CAPTURE:${uuid()}`,
        legs: capture,
      });
      expect(await applySignedStatus(tx, cap, 'SUCCEEDED')).toBe('APPLIED');
      await tx.query('SELECT core.settlement_cmd_apply_leg_movement($1)', [cap]);
      const id = await recordAsSettlementWorker(
        tx,
        { tripId: trip, version: 1 },
        recordOfVector(r.settlement),
      );
      return { trip, account, v1: { id, version: 1 } };
    }),
  );
}

const recordRefund = (
  client: pg.ClientBase,
  s: Setup,
  c: CountryCase,
  legs: Legs,
  settlement: SettlementRef,
): Promise<unknown> =>
  recordOperation(client, {
    tripId: s.trip,
    accountId: s.account,
    kind: 'REFUND',
    amountMinor: sum(legs),
    currency: c.currency,
    idemPlain: `trip:${s.trip}:REFUND:${uuid()}`,
    legs,
    settlement,
  });

type Settled = { ok: true } | { ok: false; err: { code?: string; constraint?: string } };
const settled = (p: Promise<unknown>): Promise<Settled> =>
  p.then(
    () => ({ ok: true as const }),
    (e: unknown) => ({ ok: false as const, err: e as { code?: string; constraint?: string } }),
  );

async function begin(client: pg.Client, worker: string): Promise<void> {
  await client.query('BEGIN');
  await setSessionContext(client, { kind: 'WORKER', workerName: worker });
}

async function refunds(trip: string): Promise<number> {
  return withRole('app_worker', (client) =>
    payTx(client, { worker: 'payment_command' }, async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM core.payment_payment_operation
          WHERE trip_id = $1 AND kind = 'REFUND'`,
        [trip],
      );
      return rows[0]?.n ?? -1;
    }),
  );
}

describe.each(COUNTRIES)('US-224 — ordres de règlement concurrents — $country ($currency)', (c) => {
  const r = REF[c.currency];
  if (r === undefined) throw new Error(`aucun vecteur en ${c.currency}`);
  const refund = negate({ ...legVector(golden, r.variation).legsMinor });

  it('double annulation : deux remboursements du règlement sur deux connexions ⇒ un seul enregistré, le second REFUND_EXCEEDS_COLLECTED', async () => {
    const s = await setup(c);
    const first = await connectAs('app_worker');
    const second = await connectAs('app_worker');
    try {
      await begin(first, 'payment_command');
      await begin(second, 'payment_command');
      await recordRefund(first, s, c, refund, s.v1); // tient le verrou du trip
      const racing = settled(recordRefund(second, s, c, refund, s.v1));
      await new Promise((resolve) => setTimeout(resolve, 300));
      await first.query('COMMIT');
      const late = await racing;
      await second.query('ROLLBACK');
      expect(late).toEqual({
        ok: false,
        err: expect.objectContaining({ code: '55000', constraint: 'refund_exceeds_collected' }),
      });
    } finally {
      await first.query('ROLLBACK').catch(() => undefined);
      await second.query('ROLLBACK').catch(() => undefined);
      await releaseClient(first);
      await releaseClient(second);
    }
    expect(await refunds(s.trip)).toBe(1);
  });

  it('S-02 : nouvelle version du règlement validée pendant l’attente ⇒ l’ordre de la version remplacée est refusé (SETTLEMENT_SUPERSEDED)', async () => {
    const s = await setup(c);
    const stl = await connectAs('app_worker');
    const pay = await connectAs('app_worker');
    try {
      await begin(stl, 'settlement');
      await begin(pay, 'payment_command');
      // v2 (FULL, T08) enregistrée par le travailleur settlement : verrou du trip tenu
      const r1 = recordOfVector(r.settlement);
      await stl.query(`SELECT core.settlement_cmd_record($1, $2, 1, 2, $3, 0, $4::jsonb)`, [
        uuid(),
        s.trip,
        s.v1.id,
        JSON.stringify(
          settlementRecordPayload(recordOf(tripOfVector(r.settlement), eventOfVector('T08'), r1)),
        ),
      ]);
      const racing = settled(recordRefund(pay, s, c, refund, s.v1));
      await new Promise((resolve) => setTimeout(resolve, 300));
      await stl.query('COMMIT');
      const late = await racing;
      await pay.query('ROLLBACK');
      expect(late).toEqual({
        ok: false,
        err: expect.objectContaining({
          code: '55000',
          constraint: 'operation_settlement_superseded',
        }),
      });
    } finally {
      await stl.query('ROLLBACK').catch(() => undefined);
      await pay.query('ROLLBACK').catch(() => undefined);
      await releaseClient(stl);
      await releaseClient(pay);
    }
    expect(await refunds(s.trip)).toBe(0);
  });
});
