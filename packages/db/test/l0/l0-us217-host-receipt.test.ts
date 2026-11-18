/**
 * US-217 (partie 217a, migration 0137, ADR-161) — reçu des gains de l'hôte, reçu du trip fee du
 * voyageur, relevé mensuel des gains et faits de l'invariant par jambe, en USD (PA) et en PYG sans
 * décimale (PY).
 *
 * Sous les rôles de PRODUCTION (`withRole` : assertion L0-05 en tête) : app_worker prépare et VALIDE
 * un compte d'hôte et trois trips par pays par les vraies commandes (capture signée et portée sur
 * les soldes, règlement v1 enregistré par le travailleur `settlement`) ; le devis figé du premier
 * trip et l'écriture du host_ledger du troisième sont posés par fixture (9942, 9949) ; app_api lit
 * dans des transactions ANNULÉES (sessions ouvertes par la vraie commande). Fichier isolé
 * (`vitest.l0.config.ts`) : compte PSP FAKE ACTIVE du pays partagé (fixture 9800).
 *
 * Attendus : vecteurs de l'export des oracles (`@rueda/money/golden-vectors`), jamais le code testé :
 * capture TJ01 (A, USD) / TJ08a (D, PYG) ; annulation du voyageur T03 / T27 (jambe HOST retenue :
 * `hostFromGuestMinor`, = TJ02a en USD) ; annulation de l'hôte T14 / T48 (jambe HOST 0, pénalité
 * `hostPenaltyMinor` en ligne séparée, 08 E7 règle 7) ; lignes, taux et taxe payée des trips A et D
 * (08 BR-PRICE-12 : taxe par ligne, `roundHalfUp` unique). 19 US-217 critères 1 à 3.
 * N-342 (migration 0147, ADR-171) : un co-hôte ou un titulaire dont l'adhésion P2P_HOST n'est plus
 * ACTIVE lit le reçu comme un tiers (NOT_FOUND), comme pour le relevé.
 */
import { ratio, roundHalfUp } from '@rueda/money';
import { legVector, settlementVector } from '@rueda/money/golden-vectors';
import type { GoldenLegVector, LineName } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { newToken, SESSION_TTL_S } from '../support/iam.ts';
import { applySignedStatus, legsJson, payTx, recordOperation, uuid } from '../support/pay.ts';
import type { Legs } from '../support/pay.ts';
import { golden, recordAsSettlementWorker, recordOfVector } from '../support/settlement.ts';

type Tx = pg.ClientBase;
type Json = Record<string, unknown>;
const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
const tj = (id: string): GoldenLegVector => legVector(golden, id);
const legsOf = (v: GoldenLegVector): Legs => ({ ...v.legsMinor });
const sum = (l: Legs): bigint => LEGS.reduce((s, k) => s + l[k], 0n);

/** Vecteurs par devise (jamais par pays). */
const REF: Readonly<
  Record<string, { capture: string; cancelled: string; penalty: string; kept?: string }>
> = {
  USD: { capture: 'TJ01', cancelled: 'T03', penalty: 'T14', kept: 'TJ02a' },
  PYG: { capture: 'TJ08a', cancelled: 'T27', penalty: 'T48' },
};
const refOf = (c: CountryCase) => {
  const r = REF[c.currency];
  if (r === undefined) throw new Error(`aucun vecteur en ${c.currency}`);
  expect(tj(r.capture).currency).toBe(c.currency);
  return r;
};

/** Lignes du devis (17 §3.2.5) depuis les lignes du trip du vecteur (08 `LINES`). */
const QUOTE_LINE: Readonly<Record<LineName, string>> = {
  tripPrice: 'TRIP_PRICE',
  promoPlatform: 'PROMO_PLATFORM',
  promoHost: 'PROMO_HOST',
  tripFee: 'TRIP_FEE',
  protection: 'PROTECTION',
  extras: 'EXTRAS',
  enhancedRoadside: 'ENHANCED_ROADSIDE',
  additionalDriver: 'ADDITIONAL_DRIVER_FEE',
  delivery: 'DELIVERY_FEE',
};
/** Base partageable de l'hôte (08 E7 : loyer, promo de l'hôte, livraison, Extras). */
const SHARE_BASE: readonly LineName[] = ['tripPrice', 'promoHost', 'delivery', 'extras'];

/** Instants de la préparation (période d'horloge virtuelle propre, 2034) : milieu de mois. */
const MONTH = '2034-05';
const NEXT_MONTH = '2034-06';
const SETTLED_AT = '2034-05-10T15:00:00.000Z';
const TRIP_START = '2034-05-17T15:00:00.000Z';
const TRIP_END = '2034-05-20T15:00:00.000Z';

const READ = 'SELECT * FROM core.booking_trip_receipt($1, $2::uuid)';
const EARNINGS = 'SELECT * FROM core.booking_host_earnings($1, $2::uuid, $3)';

interface QuoteLine {
  readonly type: string;
  readonly amount: bigint;
  readonly taxGroup: string | null;
  readonly rateBps: number | null;
  readonly tax: bigint;
}

/** Lignes non nulles du trip du vecteur, taxe ARRONDIE PAR LIGNE (BR-PRICE-12, T43). */
function quoteLinesOf(vector: string): QuoteLine[] {
  const trip = settlementVector(golden, vector).trip;
  const out: QuoteLine[] = [];
  for (const [name, amount] of Object.entries(trip.linesMinor) as [LineName, bigint][]) {
    if (amount === 0n) continue;
    const g = trip.taxGroups.find((x) => x.lines.includes(name));
    const rate = g === undefined ? null : ratio(g.rate.numerator, g.rate.denominator);
    out.push({
      type: QUOTE_LINE[name],
      amount,
      taxGroup: g?.id ?? null,
      rateBps: g === undefined ? null : Number((g.rate.numerator * 10_000n) / g.rate.denominator),
      tax: rate === null ? 0n : roundHalfUp(ratio(amount * rate.num, rate.den)),
    });
  }
  return out;
}

async function asWorker(tx: Tx, workerName: string): Promise<void> {
  await tx.query(
    `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
            pg_catalog.set_config('app.worker_name', $1, true)`,
    [workerName],
  );
}

/** Trip capturé (jambes du vecteur), par la vraie commande, preuve signée et report. */
async function capturedTrip(
  tx: Tx,
  c: CountryCase,
  org: string,
  capture: Legs,
): Promise<{ trip: string; guest: string }> {
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
    TRIP_START,
    TRIP_END,
  ]);
  const account = (
    await tx.query<{ id: string }>('SELECT test_fixture.us024_psp_account($1) AS id', [c.country])
  ).rows[0]!.id;
  const { operation_id: op } = await recordOperation(tx, {
    tripId: trip,
    accountId: account,
    kind: 'CAPTURE',
    amountMinor: sum(capture),
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
  return { trip, guest };
}

interface World {
  readonly org: string;
  /** Capturé seulement, devis figé du trip (critère 1). */
  readonly booked: string;
  readonly bookedGuest: string;
  /** Annulé par le voyageur, règlement v1 (critère 2). */
  readonly cancelled: string;
  readonly cancelledGuest: string;
  /** Annulé par l'hôte, règlement v1 FULL et pénalité au host_ledger (critère 2). */
  readonly penalised: string;
}

/** Compte d'hôte et trois trips du pays, VALIDÉS. */
async function world(worker: Tx, c: CountryCase): Promise<World> {
  const r = refOf(c);
  const capture = legsOf(tj(r.capture));
  const org = uuid();
  const lines = quoteLinesOf(r.cancelled);
  const v = settlementVector(golden, r.cancelled);
  return payTx(worker, { virtualNow: SETTLED_AT, commit: true }, async (tx) => {
    const booked = await capturedTrip(tx, c, org, capture);
    await tx.query(`SELECT test_fixture.us217_trip_quote($1, $2::jsonb, $3::jsonb, $4, $5)`, [
      booked.trip,
      JSON.stringify(
        lines.map((l) => ({
          type: l.type,
          amount: l.amount.toString(),
          taxGroup: l.taxGroup,
          rateBps: l.rateBps,
          tax: l.tax.toString(),
        })),
      ),
      legsJson(capture),
      'ESTÁNDAR',
      `${v.trip.hostSharePct.numerator}/${v.trip.hostSharePct.denominator}`,
    ]);

    const cancelled = await capturedTrip(tx, c, org, capture);
    await recordAsSettlementWorker(
      tx,
      { tripId: cancelled.trip, version: 1 },
      recordOfVector(r.cancelled),
    );

    const penalised = await capturedTrip(tx, c, org, capture);
    await recordAsSettlementWorker(
      tx,
      { tripId: penalised.trip, version: 1 },
      recordOfVector(r.penalty),
    );
    await tx.query('SELECT test_fixture.us709_insert_entry($1, $2, $3::bigint)', [
      uuid(),
      penalised.trip,
      settlementVector(golden, r.penalty).expected.hostPenaltyMinor.toString(),
    ]);
    return {
      org,
      booked: booked.trip,
      bookedGuest: booked.guest,
      cancelled: cancelled.trip,
      cancelledGuest: cancelled.guest,
      penalised: penalised.trip,
    };
  });
}

/** Session ouverte par la vraie commande (app_api), dans la transaction de lecture (annulée). */
async function session(tx: Tx, userId: string): Promise<Buffer> {
  const t = newToken();
  await tx.query(`SELECT core.iam_cmd_open_session($1, $2, $3, $4, 'NONE', NULL, 'vitest')`, [
    uuid(),
    userId,
    t.hash,
    SESSION_TTL_S,
  ]);
  return t.hash;
}

async function holderOf(tx: Tx, trip: string): Promise<string> {
  return (await tx.query<{ h: string }>('SELECT test_fixture.us211_holder($1) AS h', [trip]))
    .rows[0]!.h;
}

async function receipt(tx: Tx, hash: Buffer, trip: string): Promise<Json> {
  const { rows } = await tx.query<Json>(READ, [hash, trip]);
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

describe.each(COUNTRIES)('US-217a — reçu des gains et du trip fee — $country ($currency)', (c) => {
  const r = refOf(c);
  const capture = legsOf(tj(r.capture));
  const cancelled = settlementVector(golden, r.cancelled);
  const penalty = settlementVector(golden, r.penalty);
  const lines = quoteLinesOf(r.cancelled);
  const shareBase = SHARE_BASE.reduce((s, n) => s + cancelled.trip.linesMinor[n], 0n);
  const share = `${cancelled.trip.hostSharePct.numerator}/${cancelled.trip.hostSharePct.denominator}`;

  it('oracle : les lignes du trip et leurs taxes de ligne retrouvent la taxe payée et le total capturé', async () => {
    await withRole('app_api', () => Promise.resolve());
    const taxPaid = cancelled.trip.taxGroups.reduce((s, g) => s + g.taxPaidMinor, 0n);
    expect(lines.reduce((s, l) => s + l.tax, 0n)).toBe(taxPaid);
    expect(lines.reduce((s, l) => s + l.amount + l.tax, 0n)).toBe(cancelled.trip.totalPaidMinor);
    expect(sum(capture)).toBe(cancelled.trip.totalPaidMinor);
    expect(penalty.trip.totalPaidMinor).toBe(cancelled.trip.totalPaidMinor);
  });

  it('critères 1 et 2 : reçu de l’hôte (jambe HOST, plan et part figés, frais retenus par Kmino, pénalité en ligne séparée), reçu du voyageur (trip fee et sa taxe de ligne) ; aucune donnée de l’autre partie ; toute autre personne ⇒ NOT_FOUND', async () => {
    await withRole('app_worker', async (worker) => {
      const w = await world(worker, c);
      await withRole('app_api', async (api) => {
        await withTestTransaction(api, {}, async (tx) => {
          const hostHash = await session(tx, await holderOf(tx, w.booked));
          const guestHash = await session(tx, w.bookedGuest);
          const otherGuestHash = await session(tx, w.cancelledGuest);

          // critère 1 (TJ01 / TJ08a) : jambe HOST capturée, frais retenus par Kmino selon le plan
          const host = await receipt(tx, hostHash, w.booked);
          expect(host).toMatchObject({
            outcome: 'OK',
            viewer_role: 'HOST',
            currency: c.currency,
            timezone: c.timezone,
          });
          expect(host['receipt']).toEqual({
            kind: 'EARNING',
            source: 'CAPTURE',
            settlementVersion: null,
            periodMonth: MONTH,
            eventAt: TRIP_END,
            hostPlanCode: 'ESTÁNDAR',
            hostSharePct: share,
            shareBaseMinor: shareBase.toString(),
            kminoFeeMinor: (shareBase - capture.HOST).toString(),
            hostLegMinor: capture.HOST.toString(),
            adjustments: [],
            adjustmentsMinor: '0',
            netMinor: capture.HOST.toString(),
          });
          if (c.currency === 'USD') {
            // 08 TJ01 : « part plateforme de P, D, Extras 43,75 »
            expect(shareBase - capture.HOST).toBe(4375n);
          }

          // critère 1 : la facture du voyageur porte le trip fee et sa taxe (taxe de ligne figée)
          const fee = lines.find((l) => l.type === 'TRIP_FEE')!;
          const guest = await receipt(tx, guestHash, w.booked);
          expect(guest).toMatchObject({ outcome: 'OK', viewer_role: 'GUEST' });
          expect(guest['receipt']).toEqual({
            source: 'CAPTURE',
            settlementVersion: null,
            totalPaidMinor: cancelled.trip.totalPaidMinor.toString(),
            refundMinor: '0',
            tripFee: {
              chargedMinor: cancelled.trip.linesMinor.tripFee.toString(),
              taxMinor: fee.tax.toString(),
              taxRateBps: fee.rateBps,
              refundedMinor: '0',
              retainedMinor: cancelled.trip.linesMinor.tripFee.toString(),
            },
            fiscalDocument: 'OFF_PLATFORM',
          });

          // critère 2 (T03 / T27) : jambe HOST retenue de la version 1, reçu d'annulation
          const kept = cancelled.expected.hostFromGuestMinor;
          if (r.kept !== undefined) expect(tj(r.kept).legsMinor.HOST).toBe(kept);
          const cxl = (await receipt(tx, hostHash, w.cancelled))['receipt'] as Json;
          expect(cxl).toMatchObject({
            kind: 'CXL_EARNING',
            source: 'SETTLEMENT',
            settlementVersion: 1,
            periodMonth: MONTH,
            eventAt: SETTLED_AT,
            hostLegMinor: kept.toString(),
            adjustments: [],
            netMinor: kept.toString(),
          });
          // frais retenus = base retenue − jambe HOST (deux montants stockés)
          expect(BigInt(String(cxl['shareBaseMinor'])) - BigInt(String(cxl['kminoFeeMinor']))).toBe(
            kept,
          );
          if (c.currency === 'USD') {
            // 08 TJ02a : « retenu P 40,00 + F 6,00 + D 20,00 » ; hôte 30,00 + 15,00
            expect(cxl['shareBaseMinor']).toBe('6000');
          }
          const cxlGuest = (await receipt(tx, otherGuestHash, w.cancelled))['receipt'] as Json;
          expect(cxlGuest).toMatchObject({
            source: 'SETTLEMENT',
            settlementVersion: 1,
            totalPaidMinor: cancelled.trip.totalPaidMinor.toString(),
            refundMinor: cancelled.expected.guestRefundMinor.toString(),
          });
          const cxlFee = cxlGuest['tripFee'] as Json;
          expect(cxlFee['chargedMinor']).toBe(cancelled.trip.linesMinor.tripFee.toString());
          // aucun devis figé sur ce trip : la taxe de ligne n'est jamais recalculée
          expect(cxlFee['taxMinor']).toBeNull();
          expect(
            BigInt(String(cxlFee['refundedMinor'])) + BigInt(String(cxlFee['retainedMinor'])),
          ).toBe(cancelled.trip.linesMinor.tripFee);
          if (c.currency === 'USD') expect(cxlFee['retainedMinor']).toBe('600');

          // critère 2 (T14 / T48) : jambe HOST 0, pénalité de l'hôte en ligne séparée
          const pen = (await receipt(tx, hostHash, w.penalised))['receipt'] as Json;
          const debit = -penalty.expected.hostPenaltyMinor;
          expect(penalty.expected.hostFromGuestMinor).toBe(0n);
          expect(pen).toMatchObject({
            kind: 'CXL_EARNING',
            hostLegMinor: '0',
            adjustments: [
              {
                reason: 'HOST_CANCELLATION_PENALTY',
                amountMinor: debit.toString(),
                periodMonth: MONTH,
                at: SETTLED_AT,
              },
            ],
            adjustmentsMinor: debit.toString(),
            netMinor: debit.toString(),
          });

          // minimisation : le voyageur ne voit ni jambe, ni plan, ni pénalité ; l'hôte rien du
          // voyageur (clés exactes ci-dessus) ; toute autre personne ⇒ la même réponse
          const notFound = {
            outcome: 'NOT_FOUND',
            viewer_role: null,
            trip_status: null,
            currency: null,
            timezone: null,
            receipt: null,
          };
          for (const [hash, trip] of [
            [otherGuestHash, w.booked],
            [guestHash, w.penalised],
            [hostHash, uuid()],
            [newToken().hash, w.booked],
          ] as const) {
            expect((await tx.query<Json>(READ, [hash, trip])).rows).toEqual([notFound]);
          }

          // N-342 (migration 0147, ADR-171) : l'hôte du reçu est jugé comme celui du relevé
          // (titulaire au rôle P2P_HOST ACTIVE) : un co-hôte ACTIVE du compte, puis le titulaire
          // dont l'adhésion est retirée (fixture 9935, transaction annulée) ⇒ la réponse d'un tiers
          const cohost = (
            await tx.query<{ id: string }>('SELECT test_fixture.hard_add_cohost($1) AS id', [w.org])
          ).rows[0]!.id;
          const cohostHash = await session(tx, cohost);
          expect((await tx.query<Json>(READ, [cohostHash, w.booked])).rows).toEqual([notFound]);
          await tx.query('SELECT test_fixture.hard_membership_status($1, $2)', [w.org, 'REMOVED']);
          expect((await tx.query<Json>(READ, [hostHash, w.booked])).rows).toEqual([notFound]);
          // le voyageur n'est pas touché
          expect((await receipt(tx, guestHash, w.booked))['viewer_role']).toBe('GUEST');
        });

        // les vues internes ne sont jamais appelables par app_api
        for (const internal of [
          `SELECT core.finance_trip_receipt_view($1::uuid, 'HOST')`,
          `SELECT * FROM core.finance_earning_lines($1::uuid)`,
          `SELECT core.finance_host_statement($1::uuid, '2034-05')`,
          `SELECT * FROM core.finance_trip_leg_facts() WHERE trip_id = $1::uuid`,
        ]) {
          await withTestTransaction(api, {}, async (tx) => {
            await expect(tx.query(internal, [w.booked])).rejects.toMatchObject({ code: '42501' });
          });
        }
      });
      // les lectures de la partie sont fermées aux travailleurs
      for (const q of [READ, EARNINGS]) {
        await withTestTransaction(worker, {}, async (tx) => {
          const params = q === READ ? [newToken().hash, w.booked] : [newToken().hash, w.org, MONTH];
          await expect(tx.query(q, params)).rejects.toMatchObject({ code: '42501' });
        });
      }
    });
  });

  it('critères 2 et 3 : relevé du mois (Σ jambes HOST, pénalité en ligne séparée, net) ; Σ HOST du relevé = Σ des jambes HOST des versions en tête et des captures ; titulaire seulement, mois mal formé refusé', async () => {
    await withRole('app_worker', async (worker) => {
      const w = await world(worker, c);
      const kept = cancelled.expected.hostFromGuestMinor;
      const debit = -penalty.expected.hostPenaltyMinor;
      const hostSum = capture.HOST + kept + 0n;
      await withRole('app_api', async (api) => {
        await withTestTransaction(api, {}, async (tx) => {
          const hostHash = await session(tx, await holderOf(tx, w.booked));
          const guestHash = await session(tx, w.bookedGuest);

          const { rows } = await tx.query<Json>(EARNINGS, [hostHash, w.org, MONTH]);
          expect(rows).toHaveLength(1);
          expect(rows[0]).toMatchObject({ outcome: 'OK', country_code: c.country });
          const statements = rows[0]!['statements'] as Json[];
          expect(statements).toHaveLength(1);
          const s = statements[0]!;
          expect(s).toMatchObject({
            currency: c.currency,
            tripsCount: 3,
            hostLegMinor: hostSum.toString(),
            adjustmentsMinor: debit.toString(),
            netMinor: (hostSum + debit).toString(),
          });
          const items = s['lines'] as Json[];
          const byTrip = (trip: string, kind: string) =>
            items.filter((l) => l['tripId'] === trip && l['kind'] === kind);
          expect(byTrip(w.booked, 'EARNING')).toHaveLength(1);
          expect(byTrip(w.booked, 'EARNING')[0]!['amountMinor']).toBe(capture.HOST.toString());
          expect(byTrip(w.cancelled, 'CXL_EARNING')[0]!['amountMinor']).toBe(kept.toString());
          expect(byTrip(w.penalised, 'CXL_EARNING')[0]!['amountMinor']).toBe('0');
          const adj = byTrip(w.penalised, 'ADJUSTMENT');
          expect(adj).toHaveLength(1);
          expect(adj[0]).toMatchObject({
            reason: 'HOST_CANCELLATION_PENALTY',
            amountMinor: debit.toString(),
            source: 'HOST_LEDGER',
          });
          expect(items).toHaveLength(4);

          // autre mois : rien ; mois mal formé ; personne qui n'est pas titulaire du compte
          const next = await tx.query<Json>(EARNINGS, [hostHash, w.org, NEXT_MONTH]);
          expect(next.rows[0]).toMatchObject({ outcome: 'OK', statements: [] });
          for (const bad of ['2034-13', '2034-5', '05-2034', '']) {
            expect((await tx.query<Json>(EARNINGS, [hostHash, w.org, bad])).rows).toEqual([
              { outcome: 'REQUEST_INVALID', country_code: null, statements: null },
            ]);
          }
          for (const [hash, org] of [
            [guestHash, w.org],
            [hostHash, uuid()],
            [newToken().hash, w.org],
          ] as const) {
            expect((await tx.query<Json>(EARNINGS, [hash, org, MONTH])).rows).toEqual([
              { outcome: 'FORBIDDEN', country_code: null, statements: null },
            ]);
          }
        });
      });

      // critère 3 : faits de l'invariant par jambe (travailleur reconciliation seulement)
      await withTestTransaction(worker, {}, async (tx) => {
        await asWorker(tx, 'reconciliation');
        const { rows } = await tx.query<Json>(
          `SELECT trip_id, country_code, currency, captured_minor::text, collected_minor::text,
                  collected_legs_minor::text, head_total_paid_minor::text,
                  expected_host_minor::text, statement_host_minor::text
             FROM core.finance_trip_leg_facts()
            WHERE trip_id = ANY ($1::uuid[])
            ORDER BY trip_id`,
          [[w.booked, w.cancelled, w.penalised]],
        );
        const total = sum(capture).toString();
        const expected = new Map<string, Json>([
          [w.booked, { head_total_paid_minor: null, host: capture.HOST.toString() }],
          [w.cancelled, { head_total_paid_minor: total, host: kept.toString() }],
          [w.penalised, { head_total_paid_minor: total, host: '0' }],
        ]);
        expect(rows).toHaveLength(3);
        let statementSum = 0n;
        for (const row of rows) {
          const e = expected.get(String(row['trip_id']))!;
          expect(row).toEqual({
            trip_id: row['trip_id'],
            country_code: c.country,
            currency: c.currency,
            // Σ jambes de chaque trip = montant capturé (à l'unité mineure près)
            captured_minor: total,
            collected_minor: total,
            collected_legs_minor: total,
            head_total_paid_minor: e['head_total_paid_minor'],
            expected_host_minor: e['host'],
            statement_host_minor: e['host'],
          });
          statementSum += BigInt(String(row['statement_host_minor']));
        }
        // Σ jambes HOST du relevé = Σ des jambes HOST (versions en tête, captures sans règlement)
        expect(statementSum).toBe(hostSum);
      });
      for (const other of ['settlement', 'payment_command']) {
        await withTestTransaction(worker, {}, async (tx) => {
          await asWorker(tx, other);
          await expect(
            tx.query('SELECT * FROM core.finance_trip_leg_facts()'),
          ).rejects.toMatchObject({ code: '42501' });
        });
      }
    });
  });

  // US-217 partie 217b (migration 0145, ADR-167) : suites des revues de #231 (N-337, N-339, N-340)
  it('217b : taxe du trip fee non rendue dès qu’une part du trip fee est remboursée (N-337) ; trip sans règlement ni capture ⇒ aucun reçu des deux côtés, jamais un total lu du devis (N-340) ; relevé : acquis et à venir séparés (N-339)', async () => {
    await withRole('app_worker', async (worker) => {
      const w = await world(worker, c);
      const fee = lines.find((l) => l.type === 'TRIP_FEE')!;
      const quote = JSON.stringify(
        lines.map((l) => ({
          type: l.type,
          amount: l.amount.toString(),
          taxGroup: l.taxGroup,
          rateBps: l.rateBps,
          tax: l.tax.toString(),
        })),
      );
      // trip X : devis figé, capture, puis annulation du voyageur (T03 / T27, version 1) ; trip Y :
      // devis figé seulement (ni capture ni règlement), même compte d'hôte
      const extra = await payTx(worker, { virtualNow: SETTLED_AT, commit: true }, async (tx) => {
        const x = await capturedTrip(tx, c, w.org, capture);
        await tx.query(`SELECT test_fixture.us217_trip_quote($1, $2::jsonb, $3::jsonb, $4, $5)`, [
          x.trip,
          quote,
          legsJson(capture),
          'ESTÁNDAR',
          share,
        ]);
        await recordAsSettlementWorker(
          tx,
          { tripId: x.trip, version: 1 },
          recordOfVector(r.cancelled),
        );
        const y = uuid();
        const yGuest = uuid();
        await asWorker(tx, 'payment_command');
        await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
          y,
          yGuest,
          w.org,
          uuid(),
          c.country,
          c.currency,
          c.timezone,
          TRIP_START,
          TRIP_END,
        ]);
        await tx.query(`SELECT test_fixture.us217_trip_quote($1, $2::jsonb, $3::jsonb, $4, $5)`, [
          y,
          quote,
          legsJson(capture),
          'ESTÁNDAR',
          share,
        ]);
        return { x: x.trip, xGuest: x.guest, y, yGuest };
      });
      const kept = cancelled.expected.hostFromGuestMinor;
      const debit = -penalty.expected.hostPenaltyMinor;
      await withRole('app_api', async (api) => {
        await withTestTransaction(api, {}, async (tx) => {
          const hostHash = await session(tx, await holderOf(tx, w.booked));
          const xHash = await session(tx, extra.xGuest);
          const yHash = await session(tx, extra.yGuest);
          const bookedHash = await session(tx, w.bookedGuest);

          // N-337 : devis figé ET part du trip fee remboursée ⇒ taxe de ligne non rendue
          const xr = await receipt(tx, xHash, extra.x);
          expect(xr).toMatchObject({ outcome: 'OK', viewer_role: 'GUEST' });
          const xReceipt = xr['receipt'] as Json;
          expect(xReceipt).toMatchObject({
            source: 'SETTLEMENT',
            settlementVersion: 1,
            totalPaidMinor: cancelled.trip.totalPaidMinor.toString(),
            refundMinor: cancelled.expected.guestRefundMinor.toString(),
            fiscalDocument: 'OFF_PLATFORM',
          });
          const xFee = xReceipt['tripFee'] as Json;
          expect(xFee['chargedMinor']).toBe(cancelled.trip.linesMinor.tripFee.toString());
          expect(BigInt(String(xFee['refundedMinor']))).toBeGreaterThan(0n);
          expect(
            BigInt(String(xFee['refundedMinor'])) + BigInt(String(xFee['retainedMinor'])),
          ).toBe(cancelled.trip.linesMinor.tripFee);
          // 08 T03 : trip fee 18,00, conservé 6,00 ; la taxe de ligne (1,26) n'est pas rendue
          if (c.currency === 'USD') {
            expect(xFee['retainedMinor']).toBe('600');
            expect(fee.tax).toBe(126n);
          }
          expect(xFee['taxMinor']).toBeNull();
          expect(xFee['taxRateBps']).toBeNull();
          // rien du trip fee remboursé (capture seule) : la taxe de ligne du devis reste rendue
          const booked = (await receipt(tx, bookedHash, w.booked))['receipt'] as Json;
          expect(booked['tripFee']).toMatchObject({
            taxMinor: fee.tax.toString(),
            taxRateBps: fee.rateBps,
            refundedMinor: '0',
          });

          // N-340 : devis seul ⇒ NO_RECEIPT pour le voyageur comme pour l'hôte (409 à l'API)
          for (const [hash, role] of [
            [yHash, 'GUEST'],
            [hostHash, 'HOST'],
          ] as const) {
            const no = await receipt(tx, hash, extra.y);
            expect(no).toMatchObject({
              outcome: 'NO_RECEIPT',
              viewer_role: role,
              currency: c.currency,
              timezone: c.timezone,
              receipt: null,
            });
          }

          // N-339 : acquis = jambes HOST des règlements (w.cancelled, w.penalised, X) + host_ledger ;
          // à venir = jambe HOST capturée sans règlement (w.booked) ; Y n'a aucune ligne
          const { rows } = await tx.query<Json>(EARNINGS, [hostHash, w.org, MONTH]);
          const s = (rows[0]!['statements'] as Json[])[0]!;
          const settled = kept + 0n + kept;
          expect(s).toMatchObject({
            currency: c.currency,
            tripsCount: 4,
            hostLegMinor: (capture.HOST + settled).toString(),
            adjustmentsMinor: debit.toString(),
            netMinor: (capture.HOST + settled + debit).toString(),
            earnedMinor: (settled + debit).toString(),
            pendingMinor: capture.HOST.toString(),
          });
          expect((s['lines'] as Json[]).some((l) => l['tripId'] === extra.y)).toBe(false);
        });
      });
    });
  });
});
