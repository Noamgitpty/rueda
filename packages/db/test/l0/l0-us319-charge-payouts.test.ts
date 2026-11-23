/**
 * US-319 (migration 0180, ADR-200 ; fixtures 9905, et 9916, 9921, 9940 réutilisées) — report de la
 * jambe HOST des frais annexes, dommages et amendes débités dans les versements de l'hôte. Rôles de
 * PRODUCTION seulement (assertion L0-05 par `withRole`), au Panama (USD) et au Paraguay (PYG sans
 * décimale).
 *
 * Attendus tirés du BOARD (US-319, critères PROPOSÉS 1 à 4), de 08 et de l'export des oracles
 * (`@rueda/money/golden-vectors`), jamais du code testé :
 * - loyer encaissé : jambes TJ01 (USD) / TJ08a (PYG) de l'export ;
 * - amende refacturée (08 BR-TT-03, BR-REIMB-04 : 100 % à l'hôte ; frais de gestion de 5 %,
 *   BR-PRICE-15 [NOUS], payés par le voyageur, arrondi au plus proche, demi vers le haut) :
 *   12,30 USD ⇒ HOST 1 230, PLATFORM roundHalfUp(61,5) = 62 ; 25 010 PYG ⇒ HOST 25 010, PLATFORM
 *   roundHalfUp(1 250,5) = 1 251 (calcul à la main, mêmes valeurs que la passation d'US-318) ;
 * - part de dommage : jambes explicites TJ02a (USD) / TJ11a (PYG) de l'export ;
 * - versement suivant = Σ des parts HOST (montants explicites, jamais un prorata) ; versement du
 *   trip = jambe HOST du loyer seule.
 *
 * Le chemin passant ouvre `payouts_enabled[pays]` par la procédure à DEUX personnes d'US-125 dans
 * une fenêtre d'horloge virtuelle lointaine (années 6000 et suivantes, un pas de 21 jours par
 * numéro du compteur unique : aucune autre preuve n'y a de fenêtre), refermée à false par la même
 * procédure ; toutes les écritures d'argent sont dans une transaction ANNULÉE. Les preuves
 * hostiles tournent interrupteurs fermés (lot du trip compensé par la fixture 9921).
 */
import { legVector } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { goLive, openSwitchWindow } from '../support/golive.ts';
import type { StaffActor } from '../support/golive.ts';
import {
  applySignedStatus,
  applyStatus,
  caught,
  insertAccount,
  payTx,
  recordOperation,
  uuid,
} from '../support/pay.ts';
import type { Legs } from '../support/pay.ts';
import { staff, staffSessionHash } from '../support/rls.ts';
import { golden } from '../support/settlement.ts';
import { uniqueSerial } from '../support/unique.ts';

type Tx = pg.ClientBase;
type Row = Record<string, unknown>;
const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
const ZERO: Legs = { HOST: 0n, INSURER: 0n, TAX_THIRD_PARTY: 0n, PLATFORM: 0n };
const sum = (l: Legs): bigint => LEGS.reduce((s, k) => s + l[k], 0n);
const legsJson = (l: Legs): string =>
  JSON.stringify(Object.fromEntries(LEGS.map((k) => [k, l[k].toString()])));
const CAPTURE_REF: Readonly<Record<string, string>> = { USD: 'TJ01', PYG: 'TJ08a' };
const DAMAGE_REF: Readonly<Record<string, string>> = { USD: 'TJ02a', PYG: 'TJ11a' };
/** Amende refacturée (08 BR-TT-03, BR-REIMB-04, BR-PRICE-15 5 %), calculée à la main. */
const TRAFFIC: Readonly<Record<string, Legs>> = {
  USD: { ...ZERO, HOST: 1230n, PLATFORM: 62n },
  PYG: { ...ZERO, HOST: 25010n, PLATFORM: 1251n },
};
const DAY = 86_400_000;
const iso = (ms: number): string => new Date(ms).toISOString();

/** Fenêtre de 20 jours propre à ce fichier : années 6000 et suivantes, pas de 21 jours. */
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
  readonly tender: string;
  readonly capture: Legs;
}

/**
 * Trip (9300) du voyageur, loyer encaissé par carte (jambes de l'export) et reporté sur les
 * jambes, carte Visa, consentement MIT et rappel à la remise (9916), SUPPORTS_MIT validée, fériés
 * des années de la fenêtre, compte de versement vérifié et sous-marchand ACTIVE (9921, 9940), trip
 * terminé (fin effective) à l'heure courante.
 */
async function world(tx: Tx, c: CountryCase, years: readonly number[]): Promise<World> {
  const psp = await insertAccount(tx, { country: c.country });
  await tx.query(
    `SELECT test_fixture.us024_set_capability('FAKE', $1, 'CARD', 'SUPPORTS_MIT', 'true'::jsonb,
                                              'VALIDATED_SANDBOX', '2035-01-01T00:00:00Z')`,
    [c.country],
  );
  await tx.query(`SELECT test_fixture.us708_validate_blocking_capabilities('FAKE', $1)`, [
    c.country,
  ]);
  const trip = uuid();
  const guest = uuid();
  await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
    trip,
    guest,
    uuid(),
    uuid(),
    c.country,
    c.currency,
    c.timezone,
    '2035-02-20T10:00:00Z',
    '2035-02-23T10:00:00Z',
  ]);
  const capture: Legs = { ...legVector(golden, CAPTURE_REF[c.currency] ?? '').legsMinor };
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
  const card = await tx.query<{ id: string }>(
    'SELECT test_fixture.us703_card($1, $2, $3, $4) AS id',
    [guest, psp, 'VISA', `tok_us319_${uuid()}`],
  );
  await tx.query('SELECT test_fixture.us703_consent($1, $2, $3::text[], $4)', [
    trip,
    card.rows[0]?.id,
    ['DELAYED_CHARGES', 'NO_SHOW', 'DAMAGE_SEPARATE', 'REAUTHORIZATION'],
    true,
  ]);
  for (const y of new Set(years)) {
    await tx.query('SELECT test_fixture.us708_holiday($1, make_date($2::integer, 1, 1))', [
      c.country,
      y,
    ]);
  }
  await tx.query('SELECT test_fixture.us708_verified_account($1, NULL)', [trip]);
  await tx.query('SELECT test_fixture.us049_activate_submerchant($1, $2)', [psp, trip]);
  await tx.query('SELECT test_fixture.us708_complete_trip($1)', [trip]);
  return { trip, psp, tender, capture };
}

interface Charge {
  readonly id: string;
  readonly op: string;
}

/** Débit post-trip notifié avec accord écrit (débit tout de suite), tentative a1 planifiée. */
async function planned(
  tx: Tx,
  w: World,
  purpose: 'INCIDENTAL' | 'DAMAGE',
  legs: Legs,
): Promise<Charge> {
  const n = await tx.query<{ outcome: string; charge_id: string }>(
    `SELECT * FROM core.payment_cmd_notify_post_trip_charge($1, $2, $3, $4, $5, $6, NULL, $7,
                                                            $8::bigint, $9::jsonb, true)`,
    [
      uuid(),
      w.trip,
      purpose,
      purpose === 'DAMAGE' ? 'DAMAGE_SEPARATE' : 'DELAYED_CHARGES',
      purpose === 'DAMAGE' ? 'CLAIM_DECISION' : 'TRAFFIC_CHARGE',
      uuid(),
      w.tender,
      sum(legs).toString(),
      legsJson(legs),
    ],
  );
  expect(n.rows[0]?.outcome).toBe('NOTIFIED');
  const id = n.rows[0]?.charge_id ?? '';
  const p = await tx.query<{ outcome: string; operation_id: string }>(
    'SELECT outcome, operation_id FROM core.payment_cmd_plan_mit_attempt($1, $2)',
    [id, uuid()],
  );
  expect(p.rows[0]?.outcome).toBe('PLANNED');
  return { id, op: p.rows[0]?.operation_id ?? '' };
}

async function settle(tx: Tx, charge: string): Promise<string> {
  const { rows } = await tx.query<{ outcome: string }>(
    'SELECT outcome FROM core.payment_cmd_settle_mit_attempt($1, false)',
    [charge],
  );
  return rows[0]?.outcome ?? '';
}

/** Débit débité (webhook signé : preuve) puis reporté. */
async function charged(
  tx: Tx,
  w: World,
  purpose: 'INCIDENTAL' | 'DAMAGE',
  legs: Legs,
): Promise<string> {
  const ch = await planned(tx, w, purpose, legs);
  expect(await applySignedStatus(tx, ch.op, 'SUCCEEDED')).toBe('APPLIED');
  expect(await settle(tx, ch.id)).toBe('CHARGED');
  return ch.id;
}

async function leg(tx: Tx, trip: string, l: string): Promise<{ c: bigint; r: bigint; f: boolean }> {
  const { rows } = await tx.query<{
    captured_minor: string;
    released_minor: string;
    frozen: boolean;
  }>('SELECT * FROM test_fixture.us319_leg($1, $2)', [trip, l]);
  const r = rows[0];
  return {
    c: BigInt(r?.captured_minor ?? '-1'),
    r: BigInt(r?.released_minor ?? '-1'),
    f: r?.frozen ?? false,
  };
}

async function reported(tx: Tx, charge: string): Promise<boolean | null> {
  const { rows } = await tx.query<{ leg_reported: boolean }>(
    'SELECT leg_reported FROM test_fixture.us703_charge($1)',
    [charge],
  );
  return rows[0]?.leg_reported ?? null;
}

async function prepareCharge(tx: Tx, charge: string): Promise<Row> {
  const { rows } = await tx.query<Row>(
    `SELECT outcome, batch_id, payout_at::text AS payout_at, status, hold_reasons
       FROM core.payout_cmd_prepare_charge($1)`,
    [charge],
  );
  return rows[0] ?? {};
}

async function queued(tx: Tx, charge: string): Promise<boolean> {
  const { rows } = await tx.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM core.payout_charges_to_prepare(500) WHERE charge_id = $1',
    [charge],
  );
  return (rows[0]?.n ?? 0) > 0;
}

async function share(tx: Tx, charge: string): Promise<Row | null> {
  const { rows } = await tx.query<Row>('SELECT * FROM test_fixture.us319_share($1)', [charge]);
  return rows[0] ?? null;
}

async function items(tx: Tx, trip: string): Promise<Row[]> {
  const { rows } = await tx.query<Row>(
    `SELECT kind, batch_id, amount_minor::text AS amount_minor, release_attempt,
            release_operation_id, batch_status FROM test_fixture.us319_items($1)`,
    [trip],
  );
  return rows;
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

/** Libération de l'unique item du lot READY par la vraie commande, preuve signée, report. */
async function release(
  tx: Tx,
  w: World,
  c: CountryCase,
  batch: string,
  expected: { key: string; attempt: number; amount: bigint },
): Promise<string> {
  const { rows } = await tx.query<{ next_key: string; next_attempt: number; amount_minor: string }>(
    `SELECT next_key, next_attempt, amount_minor::text AS amount_minor
       FROM core.payout_release_items($1)`,
    [batch],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toEqual({
    next_key: expected.key,
    next_attempt: expected.attempt,
    amount_minor: expected.amount.toString(),
  });
  const { operation_id: rel } = await recordOperation(tx, {
    tripId: w.trip,
    accountId: w.psp,
    kind: 'LEG_RELEASE',
    amountMinor: expected.amount,
    currency: c.currency,
    attemptNo: expected.attempt,
    idemPlain: expected.key,
    legs: { ...ZERO, HOST: expected.amount },
  });
  expect(await applySignedStatus(tx, rel, 'SUCCEEDED')).toBe('APPLIED');
  const moved = await tx.query<{ r: string }>(
    'SELECT core.settlement_cmd_apply_leg_movement($1) AS r',
    [rel],
  );
  expect(moved.rows[0]?.r).toBe('APPLIED');
  return rel;
}

/** Émission puis résultat PAYÉ du PSP ; rend le montant émis. */
async function payOut(tx: Tx, batch: string): Promise<bigint> {
  const init = await tx.query<{ outcome: string; idempotency_key: string; amount_minor: string }>(
    `SELECT outcome, idempotency_key, amount_minor::text AS amount_minor
       FROM core.payout_cmd_initiate_batch($1)`,
    [batch],
  );
  expect(init.rows[0]).toMatchObject({
    outcome: 'INITIATED',
    idempotency_key: `payout:${batch}:r1`,
  });
  const paid = await tx.query<{ s: string }>(
    `SELECT core.payout_cmd_record_payout_result($1, 'SUCCEEDED', $2) AS s`,
    [batch, `fk_tx_${uuid().slice(0, 8)}`],
  );
  expect(paid.rows[0]?.s).toBe('PAID');
  return BigInt(init.rows[0]?.amount_minor ?? '-1');
}

describe.each(COUNTRIES)(
  'US-319 — jambe HOST des débits post-trip versée — $country ($currency)',
  (c) => {
    it('critères 1, 2 et 4 : amende et dommage débités ⇒ jambe HOST du trip créditée aux montants explicites (leg_reported après le mouvement) ; versement du trip sans eux, puis lot suivant = Σ des parts HOST ; registre miroir équilibré ; aucun fonds de tiers détenu', async () => {
      const traffic = TRAFFIC[c.currency] ?? ZERO;
      const damage: Legs = { ...legVector(golden, DAMAGE_REF[c.currency] ?? '').legsMinor };
      const window = await withRole('app_api', async (api) => {
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

      await withRole('app_worker', (client) =>
        payTx(
          client,
          { worker: 'payment_command', deploymentEnv: 'test', virtualNow: iso(window.from + DAY) },
          async (tx) => {
            expect(await goLive(tx, 'payouts_enabled', c.country)).toBe(true);
            // critère 4 : aucun fonds de tiers détenu (variante A seulement)
            expect(await goLive(tx, 'funds_holding_enabled', c.country)).toBe(false);
            const years = [
              new Date(window.from).getUTCFullYear(),
              new Date(window.to).getUTCFullYear(),
            ];
            const w = await world(tx, c, years);
            const prep = await tx.query<{ outcome: string; batch_id: string; payout_at: string }>(
              `SELECT outcome, batch_id, payout_at::text AS payout_at
               FROM core.payout_cmd_prepare_trip($1)`,
              [w.trip],
            );
            expect(prep.rows[0]?.outcome).toBe('PREPARED');
            const tripBatch = prep.rows[0]?.batch_id ?? '';
            const tripAt = Date.parse(prep.rows[0]?.payout_at ?? '');

            // critère 1 : amende débitée AVANT la compensation du lot du trip
            await setNow(tx, window.from + DAY + 3_600_000);
            const before = await leg(tx, w.trip, 'HOST');
            expect(before.c).toBe(w.capture.HOST);
            const fine = await charged(tx, w, 'INCIDENTAL', traffic);
            expect(await reported(tx, fine)).toBe(true);
            expect((await leg(tx, w.trip, 'HOST')).c).toBe(w.capture.HOST + traffic.HOST);
            expect((await leg(tx, w.trip, 'PLATFORM')).c).toBe(
              w.capture.PLATFORM + traffic.PLATFORM,
            );
            // l'item du trip n'est pas compensé : la part attend (jamais comptée deux fois)
            expect(await queued(tx, fine)).toBe(false);
            expect(await prepareCharge(tx, fine)).toMatchObject({ outcome: 'TRIP_NOT_NETTED' });
            expect(await share(tx, fine)).toBeNull();

            // versement du trip : jambe HOST du loyer SEULE (la part de l'amende en est exclue)
            await setNow(tx, tripAt + 60_000);
            expect(await net(tx, tripBatch)).toMatchObject({
              outcome: 'READY',
              net: w.capture.HOST,
            });
            await release(tx, w, c, tripBatch, {
              key: `release:${w.trip}:1:HOST:i1`,
              attempt: 1,
              amount: w.capture.HOST,
            });
            expect(await payOut(tx, tripBatch)).toBe(w.capture.HOST);

            // dommage débité après le versement du trip
            const dmg = await charged(tx, w, 'DAMAGE', damage);
            expect(await reported(tx, dmg)).toBe(true);
            for (const l of LEGS) {
              expect((await leg(tx, w.trip, l)).c, l).toBe(w.capture[l] + traffic[l] + damage[l]);
            }

            // critère 2 : les deux parts HOST, explicites, dans le lot suivant de l'hôte
            expect(await queued(tx, fine)).toBe(true);
            expect(await queued(tx, dmg)).toBe(true);
            const a = await prepareCharge(tx, fine);
            expect(a).toMatchObject({ outcome: 'PREPARED', status: 'SCHEDULED' });
            const b = await prepareCharge(tx, dmg);
            expect(b).toMatchObject({ outcome: 'PREPARED', batch_id: a['batch_id'] });
            expect(await prepareCharge(tx, fine)).toMatchObject({
              outcome: 'ALREADY_PREPARED',
              batch_id: a['batch_id'],
            });
            expect(await queued(tx, fine)).toBe(false);
            expect(await share(tx, fine)).toMatchObject({
              amount_minor: traffic.HOST.toString(),
              item_kind: 'POST_TRIP_CHARGE',
            });
            expect(await share(tx, dmg)).toMatchObject({ amount_minor: damage.HOST.toString() });
            const due = traffic.HOST + damage.HOST;
            const chargeBatch = String(a['batch_id']);
            const chargeAt = Date.parse(String(a['payout_at']));
            expect(chargeAt).toBeGreaterThan(tripAt);
            expect(chargeAt).toBeLessThan(window.to - DAY);
            expect(await items(tx, w.trip)).toEqual([
              expect.objectContaining({
                kind: 'TRIP',
                batch_status: 'PAID',
                amount_minor: w.capture.HOST.toString(),
              }),
              expect.objectContaining({
                kind: 'POST_TRIP_CHARGE',
                batch_id: chargeBatch,
                amount_minor: due.toString(),
              }),
            ]);
            // ajout seul : une part ne se modifie ni ne se supprime, même sous migrator
            for (const what of ['UPDATE', 'DELETE']) {
              expect(
                await caught(tx, () =>
                  tx.query('SELECT test_fixture.us319_try_write($1, $2)', [what, fine]),
                ),
                what,
              ).toMatchObject({ constraint: 'payout_item_charge_immutable' });
            }

            // échéance : lot suivant compensé, net = Σ des parts HOST
            await setNow(tx, chargeAt + 60_000);
            expect(await net(tx, chargeBatch)).toMatchObject({ outcome: 'READY', net: due });
            // rang suivant de la jambe HOST du trip (i2) : un autre rang (i3) est refusé
            const stale = await caught(tx, () =>
              recordOperation(tx, {
                tripId: w.trip,
                accountId: w.psp,
                kind: 'LEG_RELEASE',
                amountMinor: due,
                currency: c.currency,
                attemptNo: 3,
                idemPlain: `release:${w.trip}:1:HOST:i3`,
                legs: { ...ZERO, HOST: due },
              }),
            );
            expect(stale).toMatchObject({
              code: '55000',
              constraint: 'payout_release_item_mismatch',
            });
            await release(tx, w, c, chargeBatch, {
              key: `release:${w.trip}:1:HOST:i2`,
              attempt: 2,
              amount: due,
            });
            expect(await payOut(tx, chargeBatch)).toBe(due);

            // registre miroir : la jambe HOST du trip encaissée = libérée = Σ des versements
            const host = await leg(tx, w.trip, 'HOST');
            expect(host.c).toBe(w.capture.HOST + traffic.HOST + damage.HOST);
            expect(host.r).toBe(host.c);
            expect(w.capture.HOST + due).toBe(host.r);
            for (const l of ['INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const) {
              expect((await leg(tx, w.trip, l)).r, l).toBe(0n);
            }
            const batches = await tx.query<{ status: string; variant: string; net_minor: string }>(
              'SELECT status, variant, net_minor::text AS net_minor FROM test_fixture.us708_batches($1)',
              [w.trip],
            );
            expect(batches.rows.map((x) => [x.status, x.variant])).toEqual([
              ['PAID', 'SPLIT_AT_SOURCE'],
              ['PAID', 'SPLIT_AT_SOURCE'],
            ]);
            expect(batches.rows.reduce((s, x) => s + BigInt(x.net_minor), 0n)).toBe(host.r);
          },
        ),
      );

      // aucun interrupteur ne reste ouvert : faux à la fin de la fenêtre et maintenant
      await withRole('app_worker', async (client) => {
        for (const when of [iso(window.to), undefined]) {
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

    it('critère 3 : débit échoué ou sans preuve ⇒ rien de reporté ; chargeback ouvert ⇒ part retenue (CHARGEBACK, HOST gelée) ; chargeback perdu après le débit ⇒ part contre-passée (0)', async () => {
      const traffic = TRAFFIC[c.currency] ?? ZERO;
      await withRole('app_worker', async (client) => {
        const window = await farWindow(client);
        await payTx(
          client,
          { worker: 'payment_command', deploymentEnv: 'test', virtualNow: iso(window.from + DAY) },
          async (tx) => {
            expect(await goLive(tx, 'payouts_enabled', c.country)).toBe(false);
            const years = [
              new Date(window.from).getUTCFullYear(),
              new Date(window.to).getUTCFullYear(),
            ];
            const w = await world(tx, c, years);
            await setNow(tx, window.from + DAY + 3_600_000);

            // échoué (refus reçu) : aucun mouvement, rien à verser
            const failed = await planned(tx, w, 'INCIDENTAL', traffic);
            expect(await applySignedStatus(tx, failed.op, 'FAILED')).toBe('APPLIED');
            expect(await settle(tx, failed.id)).toBe('RETRY_DUE');
            // sans preuve (réponse de l'API seule) : débité, jamais reporté
            const unproven = await planned(tx, w, 'INCIDENTAL', traffic);
            expect(await applyStatus(tx, unproven.op, 'SUCCEEDED', 'API_RESPONSE')).toBe('APPLIED');
            expect(await settle(tx, unproven.id)).toBe('AWAITING_PROOF');
            expect(await reported(tx, unproven.id)).toBe(false);
            expect((await leg(tx, w.trip, 'HOST')).c).toBe(w.capture.HOST);
            // lot du trip compensé (fixture : interrupteurs fermés)
            const prep = await tx.query<{ batch_id: string }>(
              'SELECT batch_id FROM core.payout_cmd_prepare_trip($1)',
              [w.trip],
            );
            await tx.query(`SELECT test_fixture.us708_force_batch($1, 'READY')`, [
              prep.rows[0]?.batch_id,
            ]);
            for (const id of [failed.id, unproven.id]) {
              expect(await queued(tx, id)).toBe(false);
              expect(await prepareCharge(tx, id)).toMatchObject({ outcome: 'NOT_REPORTED' });
              expect(await share(tx, id)).toBeNull();
            }

            // contesté : chargeback ouvert sur le trip après le report ⇒ part retenue
            const fine = await charged(tx, w, 'INCIDENTAL', traffic);
            const p = await prepareCharge(tx, fine);
            expect(p).toMatchObject({ outcome: 'PREPARED' });
            const batch = String(p['batch_id']);
            await setNow(tx, window.from + DAY + 2 * 3_600_000);
            const { operation_id: cb } = await recordOperation(tx, {
              tripId: w.trip,
              accountId: w.psp,
              kind: 'CHARGEBACK',
              amountMinor: sum(traffic),
              currency: c.currency,
              idemPlain: `trip:${w.trip}:CHARGEBACK:${uuid()}`,
              legs: null,
            });
            expect((await leg(tx, w.trip, 'HOST')).f).toBe(true);
            await setNow(tx, Date.parse(String(p['payout_at'])) + 60_000);
            const held = await net(tx, batch);
            expect(held.outcome).toBe('ON_HOLD');
            expect(held.holds).toEqual(expect.arrayContaining(['CHARGEBACK', 'PAYOUTS_DISABLED']));
            expect(await items(tx, w.trip)).toContainEqual(
              expect.objectContaining({
                kind: 'POST_TRIP_CHARGE',
                amount_minor: traffic.HOST.toString(),
              }),
            );

            // perdu après le débit : imputé, dégelé ; à la compensation, la part est contre-passée
            expect(await applySignedStatus(tx, cb, 'SUCCEEDED')).toBe('APPLIED');
            expect((await leg(tx, w.trip, 'HOST')).f).toBe(false);
            await setNow(tx, Date.parse(String(p['payout_at'])) + 120_000);
            const after = await net(tx, batch);
            expect(after.holds).not.toContain('CHARGEBACK');
            expect(await items(tx, w.trip)).toContainEqual(
              expect.objectContaining({ kind: 'POST_TRIP_CHARGE', amount_minor: '0' }),
            );
            // la part reste chez le PSP, sur la jambe HOST du trip (aucune libération)
            expect((await leg(tx, w.trip, 'HOST')).r).toBe(0n);
          },
        );
      });
    });
  },
);
