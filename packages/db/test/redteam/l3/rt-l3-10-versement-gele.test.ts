/**
 * US-313 — red team du lot 3, passe de la porte : le versement de l'hôte face à un gel, AVEC
 * `payouts_enabled` ouvert (RT-L3-NS02, RT-L3-V04 ; risques L3-PM-19, L3-PM-30, L3-PM-34). Rôles de
 * PRODUCTION seulement (`withRole` : assertion L0-05 en tête de chaque test), travailleur
 * `payment_command`, USD (PA) et PYG sans décimale (PY). TESTS SEULEMENT : aucun correctif, aucune
 * migration, aucune fixture nouvelle. Rapport : docs/team/redteam/L3-porte.md.
 *
 * Pourquoi cette passe : toutes les preuves hostiles de gel du versement tournent interrupteurs
 * FERMÉS (`PAYOUTS_DISABLED` seul suffirait à retenir le lot : un gel qui ne retient rien passerait
 * inaperçu). Ici l'interrupteur `payouts_enabled[pays]` est OUVERT par la VRAIE procédure à deux
 * personnes d'US-125 (`openSwitchWindow`, comme `l0-us319-charge-payouts`) dans une fenêtre
 * d'horloge virtuelle des années 6000 et suivantes (un pas de 21 jours par numéro du compteur
 * unique), refermée à false par la même procédure avant la lecture du test ; le trip, le lot et
 * toutes les écritures d'argent sont dans une transaction ANNULÉE du travailleur. Aucun interrupteur
 * n'est mis à vrai hors de cette procédure ; `funds_holding_enabled` reste faux (variante A).
 *
 * Attendus (jamais le code testé) : 08 BR-PAYOUT-02 (réclamation ouverte : pas de versement) ; 17
 * §2.8 (capacité inconnue = « non », capacité bloquante inconnue ⇒ hôte non versé) ; 19 US-314
 * (gel jusqu'à décision) et US-318 (vol présumé : lot gelé jusqu'au retour) ; pré-mortem L3-PM-30
 * (« relu à l'envoi : interrupteur, gel, compte, capacités ») et L3-PM-34 (« versement pendant un
 * litige »). La clôture du dossier de vol lève le gel (témoin de chaque scénario).
 */
import { legVector } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { withRole, withTestTransaction } from '../../../src/testing/index.ts';
import { COUNTRIES } from '../../support/avl.ts';
import type { CountryCase } from '../../support/avl.ts';
import { goLive, openSwitchWindow } from '../../support/golive.ts';
import type { StaffActor } from '../../support/golive.ts';
import {
  applySignedStatus,
  insertAccount,
  payTx,
  recordOperation,
  uuid,
} from '../../support/pay.ts';
import type { Legs } from '../../support/pay.ts';
import { staff, staffSessionHash } from '../../support/rls.ts';
import { golden } from '../../support/settlement.ts';
import { uniqueSerial } from '../../support/unique.ts';

type Tx = pg.ClientBase;
type Row = Record<string, unknown>;
const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
const ZERO: Legs = { HOST: 0n, INSURER: 0n, TAX_THIRD_PARTY: 0n, PLATFORM: 0n };
const sum = (l: Legs): bigint => LEGS.reduce((s, k) => s + l[k], 0n);
/** Loyer encaissé par carte : jambes TJ01 (USD) et TJ08a (PYG) de l'export des oracles. */
const CAPTURE_REF: readonly string[] = ['TJ01', 'TJ08a'];
const DAY = 86_400_000;
const iso = (ms: number): string => new Date(ms).toISOString();

/** Fenêtre de 20 jours : années 6000 et suivantes, pas de 21 jours par numéro du compteur unique. */
async function farWindow(client: Tx): Promise<{ from: number; to: number }> {
  const n = await uniqueSerial(client);
  const from = Date.UTC(6000, 0, 1) + Number(n) * 21 * DAY;
  return { from, to: from + 20 * DAY };
}

async function setNow(tx: Tx, at: number): Promise<void> {
  await tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [iso(at)]);
}

interface World {
  readonly trip: string;
  readonly psp: string;
  readonly capture: Legs;
}

/**
 * Trip du pays (9300) rendu, loyer encaissé par carte et reporté sur les jambes, compte de
 * versement vérifié et sous-marchand ACTIVE (9921, 9940), toutes les capacités bloquantes VALIDÉES,
 * fériés des années de la fenêtre. Mêmes appels que `l0-us319-charge-payouts`.
 */
async function world(tx: Tx, c: CountryCase, years: readonly number[]): Promise<World> {
  const psp = await insertAccount(tx, { country: c.country });
  await tx.query(`SELECT test_fixture.us708_validate_blocking_capabilities('FAKE', $1)`, [
    c.country,
  ]);
  const trip = uuid();
  await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
    trip,
    uuid(),
    uuid(),
    uuid(),
    c.country,
    c.currency,
    c.timezone,
    '2035-02-20T10:00:00Z',
    '2035-02-23T10:00:00Z',
  ]);
  const capture: Legs = { ...legVector(golden, CAPTURE_REF[COUNTRIES.indexOf(c)] ?? '').legsMinor };
  const { operation_id: tender } = await recordOperation(tx, {
    tripId: trip,
    accountId: psp,
    kind: 'CAPTURE',
    amountMinor: sum(capture),
    currency: c.currency,
    idemPlain: `trip:${trip}:CAPTURE:${uuid()}`,
    legs: capture,
  });
  expect(await applySignedStatus(tx, tender, 'SUCCEEDED')).toBe('APPLIED');
  await tx.query('SELECT core.settlement_cmd_apply_leg_movement($1)', [tender]);
  for (const y of new Set(years)) {
    await tx.query('SELECT test_fixture.us708_holiday($1, make_date($2::integer, 1, 1))', [
      c.country,
      y,
    ]);
  }
  await tx.query('SELECT test_fixture.us708_verified_account($1, NULL)', [trip]);
  await tx.query('SELECT test_fixture.us049_activate_submerchant($1, $2)', [psp, trip]);
  await tx.query('SELECT test_fixture.us708_complete_trip($1)', [trip]);
  return { trip, psp, capture };
}

/** Ouvre `payouts_enabled[pays]` dans une fenêtre lointaine (deux personnes) et la rend. */
async function openPayouts(c: CountryCase): Promise<{ from: number; to: number }> {
  return withRole('app_api', async (api) => {
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
    const w = await farWindow(api);
    await openSwitchWindow(
      api,
      requester,
      approver,
      'payouts_enabled',
      c.country,
      iso(w.from),
      iso(w.to),
    );
    return w;
  });
}

const inWindow = <T>(
  window: { from: number; to: number },
  fn: (tx: Tx) => Promise<T>,
): Promise<T> =>
  withRole('app_worker', (client) =>
    payTx(
      client,
      { worker: 'payment_command', deploymentEnv: 'test', virtualNow: iso(window.from + DAY) },
      fn,
    ),
  );

const yearsOf = (w: { from: number; to: number }): number[] => [
  new Date(w.from).getUTCFullYear(),
  new Date(w.to).getUTCFullYear(),
];

async function prepareTrip(tx: Tx, trip: string): Promise<{ batch: string; at: number }> {
  const prep = await tx.query<{ outcome: string; batch_id: string; payout_at: string }>(
    `SELECT outcome, batch_id, payout_at::text AS payout_at FROM core.payout_cmd_prepare_trip($1)`,
    [trip],
  );
  expect(prep.rows[0]?.outcome).toBe('PREPARED');
  return { batch: prep.rows[0]?.batch_id ?? '', at: Date.parse(prep.rows[0]?.payout_at ?? '') };
}

async function net(
  tx: Tx,
  batch: string,
): Promise<{ outcome: string; net: bigint; holds: string[] }> {
  const { rows } = await tx.query<{ outcome: string; net_minor: string; hold_reasons: string[] }>(
    `SELECT outcome, net_minor::text AS net_minor, hold_reasons FROM core.payout_cmd_net_batch($1)`,
    [batch],
  );
  const r = rows[0];
  return {
    outcome: r?.outcome ?? '',
    net: BigInt(r?.net_minor ?? '-1'),
    holds: r?.hold_reasons ?? [],
  };
}

async function recheck(tx: Tx, batch: string): Promise<{ outcome: string; holds: string[] }> {
  const { rows } = await tx.query<{ outcome: string; hold_reasons: string[] }>(
    'SELECT outcome, hold_reasons FROM core.payout_cmd_recheck_batch($1)',
    [batch],
  );
  return { outcome: rows[0]?.outcome ?? '', holds: rows[0]?.hold_reasons ?? [] };
}

async function releasable(tx: Tx, batch: string): Promise<Row[]> {
  const { rows } = await tx.query<Row>(
    `SELECT next_key, next_attempt, amount_minor::text AS amount_minor
       FROM core.payout_release_items($1)`,
    [batch],
  );
  return rows;
}

/** Libération de l'unique item du lot READY (ordre LEG_RELEASE prouvé et reporté sur les jambes). */
async function release(tx: Tx, w: World, c: CountryCase, batch: string): Promise<void> {
  const rows = await releasable(tx, batch);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toEqual({
    next_key: `release:${w.trip}:1:HOST:i1`,
    next_attempt: 1,
    amount_minor: w.capture.HOST.toString(),
  });
  const { operation_id: rel } = await recordOperation(tx, {
    tripId: w.trip,
    accountId: w.psp,
    kind: 'LEG_RELEASE',
    amountMinor: w.capture.HOST,
    currency: c.currency,
    attemptNo: 1,
    idemPlain: `release:${w.trip}:1:HOST:i1`,
    legs: { ...ZERO, HOST: w.capture.HOST },
  });
  expect(await applySignedStatus(tx, rel, 'SUCCEEDED')).toBe('APPLIED');
  const moved = await tx.query<{ r: string }>(
    'SELECT core.settlement_cmd_apply_leg_movement($1) AS r',
    [rel],
  );
  expect(moved.rows[0]?.r).toBe('APPLIED');
}

interface Initiated {
  readonly outcome: string;
  readonly idempotency_key: string | null;
  readonly amount_minor: string | null;
  readonly hold_reasons: string[] | null;
}
const initiate = async (tx: Tx, batch: string): Promise<Initiated> =>
  (
    await tx.query<Initiated>(
      `SELECT outcome, idempotency_key, amount_minor::text AS amount_minor, hold_reasons
         FROM core.payout_cmd_initiate_batch($1)`,
      [batch],
    )
  ).rows[0] as Initiated;

const batchStatus = async (tx: Tx, trip: string): Promise<unknown> =>
  (await tx.query<Row>('SELECT batch_status FROM test_fixture.us319_items($1)', [trip])).rows[0]?.[
    'batch_status'
  ];

async function capability(tx: Tx, c: CountryCase, status: string, at: number): Promise<void> {
  await tx.query(
    `SELECT test_fixture.us024_set_capability('FAKE', $1, '*', 'SUPPORTS_PAYOUT_ADJUSTMENT',
                                              'true'::jsonb, $2, $3::timestamptz)`,
    [c.country, status, iso(at)],
  );
}

describe.each(COUNTRIES)(
  'RT-L3 versement de l’hôte, payouts_enabled OUVERT — $country ($currency)',
  (c) => {
    it('RT-L3-NS02 (L3-PM-19) : capacité bloquante SUPPORTS_PAYOUT_ADJUSTMENT inconnue ⇒ lot ON_HOLD (HOST_PAYOUT_RAIL_UNAVAILABLE), aucun item libérable, aucune émission ; capacité validée ensuite ⇒ READY (interrupteur ouvert tout du long : le motif seul retient)', async () => {
      const window = await openPayouts(c);
      await inWindow(window, async (tx) => {
        expect(await goLive(tx, 'payouts_enabled', c.country)).toBe(true);
        expect(await goLive(tx, 'funds_holding_enabled', c.country)).toBe(false);
        const w = await world(tx, c, yearsOf(window));
        const prep = await prepareTrip(tx, w.trip);
        // la capacité devient inconnue (nouvelle version, postérieure à la validation)
        await capability(tx, c, 'UNKNOWN', window.from + DAY + 1000);
        await setNow(tx, prep.at + 60_000);
        const held = await net(tx, prep.batch);
        expect(held.outcome).toBe('ON_HOLD');
        expect(held.holds).toEqual(['HOST_PAYOUT_RAIL_UNAVAILABLE']);
        expect(await releasable(tx, prep.batch)).toEqual([]);
        const sent = await initiate(tx, prep.batch);
        expect(sent.outcome).toBe('ON_HOLD');
        expect(sent.idempotency_key).toBeNull();
        expect(await batchStatus(tx, w.trip)).toBe('ON_HOLD');
        // témoin : la capacité validée, le même lot est compensé et prêt (rien d'autre ne retenait)
        await capability(tx, c, 'VALIDATED_SANDBOX', prep.at + 61_000);
        await setNow(tx, prep.at + 62_000);
        expect(await net(tx, prep.batch)).toMatchObject({
          outcome: 'READY',
          net: w.capture.HOST,
          holds: [],
        });
        expect(await releasable(tx, prep.batch)).toHaveLength(1);
      });
    });

    it('RT-L3-V04 (L3-PM-34) : dossier de vol ouvert APRÈS la compensation ⇒ le lot READY repasse ON_HOLD (CLAIM) avant la libération, aucun item libérable, aucune émission ; dossier clos ⇒ READY (interrupteur ouvert tout du long)', async () => {
      const window = await openPayouts(c);
      await inWindow(window, async (tx) => {
        expect(await goLive(tx, 'payouts_enabled', c.country)).toBe(true);
        const w = await world(tx, c, yearsOf(window));
        const prep = await prepareTrip(tx, w.trip);
        await setNow(tx, prep.at + 60_000);
        expect(await net(tx, prep.batch)).toMatchObject({ outcome: 'READY', holds: [] });
        // vol présumé (dossier posé directement ; l'ouverture est prouvée par `l0-us318-p2p-claims`)
        await tx.query('SELECT test_fixture.us318_insert_theft_case($1)', [w.trip]);
        expect(await recheck(tx, prep.batch)).toEqual({ outcome: 'ON_HOLD', holds: ['CLAIM'] });
        expect(await releasable(tx, prep.batch)).toEqual([]);
        const sent = await initiate(tx, prep.batch);
        expect(sent.outcome).toBe('ON_HOLD');
        expect(sent.idempotency_key).toBeNull();
        expect(await batchStatus(tx, w.trip)).toBe('ON_HOLD');
        // un passage de la file de compensation ne lève pas le gel non plus
        const again = await net(tx, prep.batch);
        expect(again.holds).toEqual(['CLAIM']);
        // retour du véhicule : le travailleur clôt le dossier, le gel est levé, le lot repart
        expect(
          (
            await tx.query<{ r: string }>('SELECT core.claim_cmd_close_theft_case($1) AS r', [
              w.trip,
            ])
          ).rows[0]!.r,
        ).toBe('CLOSED');
        expect(await recheck(tx, prep.batch)).toEqual({ outcome: 'READY', holds: [] });
        expect(await releasable(tx, prep.batch)).toHaveLength(1);
      });
    });

    it('RT-L3-V04 (L3-PM-30, L3-PM-34) : dossier de vol ouvert ENTRE la libération des jambes et l’émission ⇒ l’émission relit les motifs et refuse (ON_HOLD, CLAIM, aucune clé de versement) ; dossier clos ⇒ l’émission part, clé payout:{lot}:r1', async () => {
      const window = await openPayouts(c);
      await inWindow(window, async (tx) => {
        expect(await goLive(tx, 'payouts_enabled', c.country)).toBe(true);
        const w = await world(tx, c, yearsOf(window));
        const prep = await prepareTrip(tx, w.trip);
        await setNow(tx, prep.at + 60_000);
        expect(await net(tx, prep.batch)).toMatchObject({ outcome: 'READY', holds: [] });
        await release(tx, w, c, prep.batch);
        // aucun passage de relecture : le gel arrive juste avant l'émission
        await tx.query('SELECT test_fixture.us318_insert_theft_case($1)', [w.trip]);
        const blocked = await initiate(tx, prep.batch);
        expect(blocked.outcome).toBe('ON_HOLD');
        expect(blocked.idempotency_key).toBeNull();
        expect(blocked.amount_minor).toBeNull();
        expect(blocked.hold_reasons).toEqual(['CLAIM']);
        expect(await batchStatus(tx, w.trip)).toBe('ON_HOLD');
        // clôture, relecture, émission
        expect(
          (
            await tx.query<{ r: string }>('SELECT core.claim_cmd_close_theft_case($1) AS r', [
              w.trip,
            ])
          ).rows[0]!.r,
        ).toBe('CLOSED');
        expect(await recheck(tx, prep.batch)).toEqual({ outcome: 'READY', holds: [] });
        const sent = await initiate(tx, prep.batch);
        expect(sent.outcome).toBe('INITIATED');
        expect(sent.idempotency_key).toBe(`payout:${prep.batch}:r1`);
        expect(sent.amount_minor).toBe(w.capture.HOST.toString());
      });
    });
  },
);
