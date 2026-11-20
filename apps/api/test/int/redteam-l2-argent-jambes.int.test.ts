/**
 * US-222b — red team argent du lot 2, axe « jambes, preuve, crédits, chargeback » (19 US-222
 * critère 2, scénarios 2 « jambe négative », 3 « somme des jambes falsifiée », 4 « preuve PSP
 * falsifiée ou rejouée », 8 « crédit au-delà de PLATFORM » ; pré-mortem L2 : RT-L2-M03, M05, M08,
 * M18 ; risques L2-PM-02, L2-PM-04, L2-PM-06, L2-PM-28, L2-PM-43). Rapport :
 * docs/team/redteam/L2-argent.md.
 *
 * Joué en CI contre le PSP `FAKE` (adaptateur FAKE du port, PSP simulé de @rueda/fake-adapters,
 * commandes de la base), sous les rôles de PRODUCTION (`connectAs` : L0-05), en USD (PA) et en PYG
 * (PY). Chaque attaque est jouée dans une transaction du travailleur `payment_command` ANNULÉE ;
 * l'invariant par jambe (US-217 : faits du rapprochement, contrôles FIN et oracle C12 sur toute la
 * base) est vérifié dans la MÊME transaction, après l'attaque. Aucun correctif (L2-PM-39) : un
 * défaut est prouvé par un `it.fails` documenté, son observation par un test vert.
 *
 * Attendus : vecteurs TJ01 / TJ08a (capture), TJ21a / TJ21b et cascade de l'oracle
 * (`docs/specs/tools/check_legs.py`, `python -I -X utf8`) pour le crédit, TJ14b et sa variante PYG
 * de l'oracle (`chargeback`) pour le chargeback ; codes de contrainte des migrations 0116, 0123 et
 * 0152 ; jamais le code testé.
 */
import { randomUUID } from 'node:crypto';
// types du contexte fourni par le globalSetup du banc (inject('ruedaBench'))
import type {} from '@rueda/db/testing/global-setup';
import { cascadeTenders, creditCap, money, type Currency } from '@rueda/money';
import { describe, expect, it } from 'vitest';
import { CountryConfigService } from '../../src/modules/cfg/index.js';
import { reconciliationReportJson, runMoneyReconciliation } from '../../src/modules/fin/index.js';
import { QuoteService } from '../../src/modules/prc/index.js';
import {
  CASES,
  DAY,
  LEGS,
  MINUTE,
  asWorker,
  balancesIn,
  capturedTripIn,
  inTx,
  invariantIn,
  iso,
  legsOf,
  open,
  recordOperation,
  refused,
  signedStatus,
  sqlOf,
  sum,
  type Case,
  type Json,
  type Legs,
} from '../support/redteam-l2.js';

/** Jambes `Money` de @rueda/money (total compris) depuis des unités mineures. */
function moneyLegs(l: Legs, currency: Currency) {
  return {
    HOST: money(l.HOST, currency),
    INSURER: money(l.INSURER, currency),
    TAX_THIRD_PARTY: money(l.TAX_THIRD_PARTY, currency),
    PLATFORM: money(l.PLATFORM, currency),
    total: money(sum(l), currency),
  };
}
const minorLegs = (l: Record<string, { amountMinor: bigint }>): Legs =>
  Object.fromEntries(LEGS.map((k) => [k, l[k]!.amountMinor])) as unknown as Legs;
const codeOf = (fn: () => unknown): unknown => {
  try {
    fn();
    return null;
  } catch (error) {
    return (error as { code?: unknown }).code;
  }
};

/** Observation du chargeback perdu (L2-PM-43), lue par l'it.fails, par pays. */
const chargeback = new Map<string, { moved: boolean; hostFrozen: boolean; violations: string }>();

describe.each(CASES)('RT-L2-ARG — jambes, preuve, crédits ($country, $currency)', (c: Case) => {
  const capture = legsOf(c.journey.capture);
  const total = sum(capture);
  // instants propres au pays et au fichier (horloge virtuelle 2053, transactions annulées)
  const T0 = Date.UTC(2053, 1, 3, 10, 0, 0) + c.index * 11 * DAY;
  const at = (m: number): string => iso(T0 + m * MINUTE);
  const currency = (): Currency =>
    new QuoteService(new CountryConfigService()).params({ country: c.country, at: new Date(T0) })
      .currency;
  const unit = (): bigint => (currency().exponent === 0 ? 100n : 1n);

  it('S2 : jambe négative forcée (capture, remboursement, réaffectation), en base (adaptateur FAKE : test:unit) ⇒ refusée avant toute écriture et tout appel au PSP ; invariant par jambe', async () => {
    const worker = await open('app_worker');
    await inTx(worker, { worker: 'payment_command', at: at(0) }, async (tx) => {
      const w = await capturedTripIn(tx, c, T0 + 3 * DAY, 3);
      const x = unit();
      const forged: readonly [string, Json, bigint, string][] = [
        [
          'CAPTURE',
          { ...capture, HOST: -x, PLATFORM: capture.PLATFORM + capture.HOST + x },
          total,
          'payment_operation_leg_negative',
        ],
        [
          'CAPTURE',
          {
            ...capture,
            INSURER: -capture.INSURER,
            PLATFORM: capture.PLATFORM + 2n * capture.INSURER,
          },
          total,
          'payment_operation_leg_negative',
        ],
        [
          'REFUND',
          { HOST: -x, INSURER: 0n, TAX_THIRD_PARTY: 0n, PLATFORM: 2n * x },
          x,
          'payment_operation_leg_negative',
        ],
        [
          'LEG_REALLOCATION',
          { HOST: -x, INSURER: 0n, TAX_THIRD_PARTY: 0n, PLATFORM: 2n * x },
          x,
          'payment_operation_leg_sum',
        ],
      ];
      for (const [kind, legs, amount, constraint] of forged) {
        const e = await refused(tx, () =>
          recordOperation(tx, {
            tripId: w.trip,
            accountId: w.account,
            kind,
            amountMinor: amount,
            currency: c.currency,
            legs,
          }),
        );
        expect(
          e,
          `${kind} ${JSON.stringify(legs, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))}`,
        ).toEqual({
          code: '23000',
          constraint,
        });
      }
      // adaptateur FAKE du port (avant tout appel) : l2-argent-adaptateur.test.ts (test:unit)
      expect((await balancesIn(tx, w.trip)).captured).toEqual(capture);
      await invariantIn(tx, c.country, [{ trip: w.trip, captured: total }]);
    });
  });

  it('S3 : somme des jambes falsifiée (Σ ≠ montant, jambe manquante, jambe en trop, montant non entier, nombre JSON) ⇒ refusée en base (adaptateur FAKE : test:unit) ; invariant par jambe', async () => {
    const worker = await open('app_worker');
    await inTx(worker, { worker: 'payment_command', at: at(0) }, async (tx) => {
      const w = await capturedTripIn(tx, c, T0 + 4 * DAY, 3);
      const x = unit();
      const text = (l: Legs): Json => Object.fromEntries(LEGS.map((k) => [k, l[k].toString()]));
      const forged: readonly [string, Json, { code: string; constraint?: string }][] = [
        [
          'Σ jambes = montant + 1 (HOST gonflée)',
          text({ ...capture, HOST: capture.HOST + x }),
          { code: '23000', constraint: 'payment_operation_leg_sum' },
        ],
        [
          'Σ jambes = montant − 1 (PLATFORM réduite)',
          text({ ...capture, PLATFORM: capture.PLATFORM - x }),
          { code: '23000', constraint: 'payment_operation_leg_sum' },
        ],
        [
          'trois jambes (TAX_THIRD_PARTY omise)',
          {
            HOST: capture.HOST.toString(),
            INSURER: capture.INSURER.toString(),
            PLATFORM: (capture.PLATFORM + capture.TAX_THIRD_PARTY).toString(),
          },
          { code: '22023' },
        ],
        ['cinquième jambe GUEST', { ...text(capture), GUEST: '0' }, { code: '22023' }],
        [
          'montant décimal',
          { ...text(capture), HOST: `${capture.HOST.toString()}.5` },
          { code: '22023' },
        ],
        [
          'nombre JSON au lieu d’un entier en texte',
          { ...text(capture), HOST: Number(capture.HOST) },
          { code: '22023' },
        ],
      ];
      for (const [label, legs, want] of forged) {
        const e = await refused(tx, () =>
          recordOperation(tx, {
            tripId: w.trip,
            accountId: w.account,
            kind: 'CAPTURE',
            amountMinor: total,
            currency: c.currency,
            legs,
          }),
        );
        expect(e, label).toEqual(want);
      }
      // adaptateur FAKE (Σ jambes ≠ montant) : l2-argent-adaptateur.test.ts (test:unit)
      expect((await balancesIn(tx, w.trip)).captured).toEqual(capture);
      await invariantIn(tx, c.country, [{ trip: w.trip, captured: total }]);
    });
  });

  it('S4 : preuve PSP falsifiée (référence inventée, signature invalide, horodatage hors tolérance, autre statut, autre opération, montant ou devise reçus différents, montant absent, action du staff) ⇒ UNPROVEN ou MISMATCH, rien appliqué ; réponse d’API sans preuve ⇒ aucun mouvement de jambe ; preuve rejouée ou désordonnée ⇒ DUPLICATE / CONFLICT / STALE, une seule capture portée ; invariant par jambe', async () => {
    const worker = await open('app_worker');
    await inTx(worker, { worker: 'payment_command', at: at(0) }, async (tx) => {
      // trip sans capture, puis capture PENDING (aucune preuve)
      const trip = randomUUID();
      await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, 'UTC', $7, $8)`, [
        trip,
        randomUUID(),
        randomUUID(),
        randomUUID(),
        c.country,
        c.currency,
        iso(T0 + 5 * DAY),
        iso(T0 + 8 * DAY),
      ]);
      const account = (
        await tx.query<{ id: string }>('SELECT test_fixture.us024_psp_account($1) AS id', [
          c.country,
        ])
      ).rows[0]!.id;
      const idemA = `trip:${trip}:CAPTURE:${randomUUID()}`;
      const idemB = `trip:${trip}:CAPTURE:${randomUUID()}`;
      const a = await recordOperation(tx, {
        tripId: trip,
        accountId: account,
        amountMinor: total,
        currency: c.currency,
        idemPlain: idemA,
        legs: capture,
      });
      const b = await recordOperation(tx, {
        tripId: trip,
        accountId: account,
        amountMinor: total,
        currency: c.currency,
        idemPlain: idemB,
        legs: capture,
      });
      const occurredAt = at(0).replace(/\.\d{3}Z$/, 'Z');
      const event = (o: Json): Json => ({
        type: 'payment.status',
        providerReference: `ref-${randomUUID()}`,
        merchantReference: idemA,
        status: 'SUCCEEDED',
        amountMinor: total.toString(),
        currency: c.currency,
        occurredAt,
        ...o,
      });
      const inbox = async (events: Json[], valid = true, skewMinutes = 0): Promise<string> => {
        const { rows } = await tx.query<{ inbox_id: string | null }>(
          `SELECT inbox_id FROM test_fixture.us049_receive_custom($1, $2::jsonb, $3,
                    platform.now() - make_interval(mins => $4))`,
          [account, JSON.stringify(events), valid, skewMinutes],
        );
        const id = rows[0]?.inbox_id;
        if (id === null || id === undefined) throw new Error('webhook non reçu');
        return id;
      };
      const apply = async (raw: string | null, status = 'SUCCEEDED', source = 'WEBHOOK') =>
        (
          await tx.query<{ o: string }>(
            `SELECT core.payment_cmd_apply_operation_status($1, $2, $3, $4::uuid, NULL) AS o`,
            [a.operation_id, status, source, raw],
          )
        ).rows[0]?.o;
      const status = async (): Promise<{ status: string; proof: string | null }> =>
        (
          await tx.query<{ status: string; proof: string | null }>(
            `SELECT status, proof_type AS proof FROM core.payment_payment_operation WHERE id = $1`,
            [a.operation_id],
          )
        ).rows[0]!;
      // autre devise configurée (jamais une constante de pays)
      const other = CASES.find((x) => x.currency !== c.currency)?.currency ?? 'XXX';
      const forged: readonly [string, () => Promise<string | null>, string][] = [
        [
          'référence de boîte de réception inventée',
          () => Promise.resolve(randomUUID()),
          'UNPROVEN',
        ],
        ['signature invalide', () => inbox([event({})], false), 'UNPROVEN'],
        [
          'horodatage signé à −10 min (hors tolérance)',
          () => inbox([event({})], true, 10),
          'UNPROVEN',
        ],
        [
          'événement signé d’un autre statut (FAILED)',
          () => inbox([event({ status: 'FAILED' })]),
          'UNPROVEN',
        ],
        [
          'événement signé d’une autre opération',
          () => inbox([event({ merchantReference: idemB })]),
          'UNPROVEN',
        ],
        [
          'montant reçu inférieur d’une unité',
          () => inbox([event({ amountMinor: (total - unit()).toString() })]),
          'MISMATCH',
        ],
        [
          'montant reçu supérieur d’une unité',
          () => inbox([event({ amountMinor: (total + unit()).toString() })]),
          'MISMATCH',
        ],
        ['devise reçue différente', () => inbox([event({ currency: other })]), 'MISMATCH'],
        [
          'montant et devise absents d’un loyer',
          () => inbox([event({ amountMinor: undefined, currency: undefined })]),
          'UNPROVEN',
        ],
      ];
      for (const [label, raw, want] of forged) {
        expect(await apply(await raw()), label).toBe(want);
        expect(await status(), label).toEqual({ status: 'PENDING', proof: null });
      }
      expect(await apply(null, 'SUCCEEDED', 'MANUAL_OPS')).toBe('UNPROVEN');
      expect(await status()).toEqual({ status: 'PENDING', proof: null });

      // réponse d'API (non signée) : statut sans preuve ⇒ aucun mouvement de jambe
      expect(await apply(null, 'SUCCEEDED', 'API_RESPONSE')).toBe('APPLIED');
      expect(await status()).toEqual({ status: 'SUCCEEDED', proof: null });
      const unproven = await refused(tx, () =>
        tx.query('SELECT core.settlement_cmd_apply_leg_movement($1)', [a.operation_id]),
      );
      expect(unproven).toEqual({ code: '55000', constraint: 'leg_movement_unproven' });
      // webhook signé du même statut : la preuve est posée (DUPLICATE), puis UN seul mouvement
      expect(await signedStatus(tx, a.operation_id, 'SUCCEEDED')).toBe('DUPLICATE');
      expect(await status()).toEqual({ status: 'SUCCEEDED', proof: 'WEBHOOK_SIGNED' });
      const move = async () =>
        (
          await tx.query<{ r: string }>('SELECT core.settlement_cmd_apply_leg_movement($1) AS r', [
            a.operation_id,
          ])
        ).rows[0]?.r;
      expect(await move()).toBe('APPLIED');
      // rejeux et désordre
      expect(await signedStatus(tx, a.operation_id, 'SUCCEEDED')).toBe('DUPLICATE');
      expect(await move()).toBe('DUPLICATE');
      expect(await signedStatus(tx, a.operation_id, 'FAILED')).toBe('CONFLICT');
      expect(await apply(null, 'SUBMITTED', 'WEBHOOK')).toBe('STALE');
      expect(await status()).toEqual({ status: 'SUCCEEDED', proof: 'WEBHOOK_SIGNED' });
      // la preuve de A ne prouve pas B (même montant, même compte)
      const replayed = await tx.query<{ o: string }>(
        `SELECT core.payment_cmd_apply_operation_status($1, 'SUCCEEDED', 'WEBHOOK', $2::uuid, NULL)
           AS o`,
        [b.operation_id, await inbox([event({})])],
      );
      expect(replayed.rows[0]?.o).toBe('UNPROVEN');
      expect((await balancesIn(tx, trip)).captured).toEqual(capture);
      await invariantIn(tx, c.country, [{ trip, captured: total }]);
    });
  });

  it('S8 : crédit au-delà de PLATFORM (TJ21) : plafond = jambe PLATFORM de la capture, cascade de la règle 10 refusée si un crédit touche HOST ou INSURER ; en base, tout encaissement par crédit est refusé (aucun crédit en bêta : refus global, le plafond PLATFORM n’est jugé ici que par le moteur) ; invariant par jambe', async () => {
    const cur = currency();
    const cap = moneyLegs(capture, cur);
    const asked = money(c.journey.creditAsked, cur);
    // oracle (cascade de check_legs.py) : plafond = PLATFORM de la capture (TJ21 : 99,91 sur
    // 120,00 demandés ; PYG : 545 550 sur 600 000), le reste payé par carte
    expect(creditCap(cap, asked).amountMinor).toBe(c.journey.creditCap);
    expect(
      codeOf(() =>
        cascadeTenders(cap, [
          { kind: 'NATIVE', amount: money(total - c.journey.creditAsked, cur) },
          { kind: 'CASH_CREDIT', amount: asked },
        ]),
      ),
    ).toBe('SETTLEMENT_INPUT_INVALID');
    expect(
      codeOf(() =>
        cascadeTenders(cap, [
          { kind: 'NATIVE', amount: money(total - c.journey.creditAsked, cur) },
          { kind: 'PROMO_CREDIT', amount: asked },
        ]),
      ),
    ).toBe('SETTLEMENT_INPUT_INVALID');
    const rows = cascadeTenders(cap, [
      { kind: 'CASH_CREDIT', amount: money(c.journey.creditCap, cur) },
      { kind: 'NATIVE', amount: money(total - c.journey.creditCap, cur) },
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['NATIVE', 'CASH_CREDIT']);
    expect(minorLegs(rows[0]!.legs)).toEqual(c.journey.cardLegs);
    expect(minorLegs(rows[1]!.legs)).toEqual({
      HOST: 0n,
      INSURER: 0n,
      TAX_THIRD_PARTY: 0n,
      PLATFORM: c.journey.creditCap,
    });

    const worker = await open('app_worker');
    await inTx(worker, { worker: 'payment_command', at: at(0) }, async (tx) => {
      const w = await capturedTripIn(tx, c, T0 + 6 * DAY, 3);
      const credit: Legs = {
        HOST: 0n,
        INSURER: 0n,
        TAX_THIRD_PARTY: 0n,
        PLATFORM: c.journey.creditCap,
      };
      for (const [kind, method] of [
        ['CAPTURE', 'CREDIT_CASH'],
        ['CAPTURE', 'CREDIT_PROMO'],
        ['CREDIT_REDEMPTION', 'CREDIT_CASH'],
      ] as const) {
        const e = await refused(tx, () =>
          recordOperation(tx, {
            tripId: w.trip,
            accountId: w.account,
            kind,
            method,
            amountMinor: c.journey.creditCap,
            currency: c.currency,
            legs: credit,
          }),
        );
        expect(e, `${kind} ${method}`).toEqual({
          code: '55000',
          constraint: 'payment_operation_credit_unavailable',
        });
      }
      expect((await balancesIn(tx, w.trip)).captured).toEqual(capture);
      await invariantIn(tx, c.country, [{ trip: w.trip, captured: total }]);
    });
  });

  it('L2-PM-43 (observation) : chargeback perdu sur une capture portée (TJ14b ; en devise sans décimale, montant dérivé par la méthode de TJ14b) : l’ordre CHARGEBACK est enregistré et prouvé, aucun mouvement de jambe (leg_movement_unsupported), aucune imputation, rapprochement relu', async () => {
    const worker = await open('app_worker');
    await inTx(worker, { worker: 'payment_command', at: at(0) }, async (tx) => {
      const w = await capturedTripIn(tx, c, T0 + 7 * DAY, 3);
      const cb = await recordOperation(tx, {
        tripId: w.trip,
        accountId: w.account,
        kind: 'CHARGEBACK',
        amountMinor: total,
        currency: c.currency,
        legs: null,
      });
      expect(await signedStatus(tx, cb.operation_id, 'SUCCEEDED')).toBe('APPLIED');
      // aujourd'hui : leg_movement_unsupported (noté, non affirmé : un correctif peut imputer)
      const moved = await refused(tx, () =>
        tx.query('SELECT core.settlement_cmd_apply_leg_movement($1)', [cb.operation_id]),
      );
      const imputed = await tx.query<{ n: number }>(
        `SELECT pg_catalog.count(*)::int AS n FROM core.settlement_leg_movement
          WHERE operation_id = $1`,
        [cb.operation_id],
      );
      // US-709 (0167) : l'imputation de TJ14a / TJ14b est écrite par la base au statut SUCCEEDED
      // (table d'imputation, lue par le contrôle FIN) ; comptée comme une imputation
      await tx.query('SAVEPOINT rt_l2_cb');
      await asWorker(tx, 'reconciliation');
      const facts = await tx.query<{ n: number }>(
        `SELECT pg_catalog.count(*)::int AS n FROM core.finance_chargeback_facts()
          WHERE country_code = $1 AND imputed`,
        [c.country],
      );
      await tx.query('ROLLBACK TO SAVEPOINT rt_l2_cb');
      const frozen = await tx.query<{ frozen: boolean }>(
        `SELECT frozen FROM core.settlement_trip_leg_balance
          WHERE trip_id = $1 AND segment_no = 1 AND leg = 'HOST'`,
        [w.trip],
      );
      await asWorker(tx, 'reconciliation');
      const report = reconciliationReportJson(await runMoneyReconciliation(sqlOf(tx)));
      chargeback.set(c.country, {
        moved: moved === null || (imputed.rows[0]?.n ?? 0) > 0 || (facts.rows[0]?.n ?? 0) > 0,
        hostFrozen: frozen.rows[0]?.frozen === true,
        violations: report.violations,
      });
      expect(chargeback.get(c.country)?.violations).toMatch(/^[0-9]+$/);
    });
  });

  // F-L2-ARG-04 (constat, gravité PROPOSÉE moyenne, suite attendue d'US-709 au lot 3) : un
  // chargeback perdu (TJ14b : trip réalisé, rien versé ; PLATFORM −256,66 en USD ; en PYG, −1 438 050
  // dérivé par la méthode de TJ14b (fonction `chargeback` de l'oracle appliquée à TJ08a), pas un
  // vecteur de l'export) n'est imputé nulle part et le rapprochement FIN rend 0 écart : la
  // perte est absorbée sans écriture et la jambe HOST reste due à l'hôte (L2-PM-43). Aucune voie
  // d'entrée d'un chargeback n'existe au lot 2 (ni webhook, ni commande ; RECORD_CHARGEBACK de la
  // console est un enregistrement seul). Attendu : imputation de 08 (TJ14a / TJ14b) ou, à défaut,
  // gel de la jambe HOST, ou écart signalé par le rapprochement.
  // US-222d : corrigé (0155 : gel de la jambe HOST au chargeback, contrôle FIN CHARGEBACK_UNIMPUTED)
  // — `it.fails` inversé en `it`, attaque et jugement inchangés
  it('F-L2-ARG-04 : un chargeback perdu est imputé, gèle la jambe HOST ou est signalé par le rapprochement FIN', async () => {
    await open('app_worker'); // L0-05
    const o = chargeback.get(c.country);
    // US-222d : en `it`, une observation absente (attaque non jouée) doit rougir : affirmée
    if (o === undefined) throw new Error('observation L2-PM-43 absente');
    // signal attendu : imputation (mouvement de jambe), OU jambe HOST gelée avant tout
    // versement, OU écart signalé par le rapprochement ; jamais l'issue brute de la commande
    expect(o.moved || o.hostFrozen || o.violations !== '0').toBe(true);
  });

  // US-222d (preuve du correctif, 0155) : sans chargeback, la jambe HOST n'est pas gelée et aucun
  // écart CHARGEBACK_UNIMPUTED ; un chargeback enregistré gèle la jambe HOST (frozen_reason
  // CHARGEBACK) avant toute preuve. US-709 (0167) : prouvé (SUCCEEDED), il est IMPUTÉ par la base
  // (trip réalisé : aucune reprise, TJ14b), donc décidé : dégel et aucun écart FIN ; la part INSURER
  // est gelée avec HOST pendant le litige (08 E7 règle 7, N-415)
  it('US-222d / US-709 : chargeback ⇒ jambes HOST et INSURER gelées (CHARGEBACK) dès l’enregistrement ; prouvé ⇒ imputé, dégelé, aucun écart FIN ; trip sans chargeback ⇒ ni gel ni écart', async () => {
    const worker = await open('app_worker');
    await inTx(worker, { worker: 'payment_command', at: at(0) }, async (tx) => {
      const w = await capturedTripIn(tx, c, T0 + 8 * DAY, 3);
      const host = async (): Promise<{ frozen: boolean; frozen_reason: string | null }> =>
        (
          await tx.query<{ frozen: boolean; frozen_reason: string | null }>(
            `SELECT frozen, frozen_reason FROM core.settlement_trip_leg_balance
              WHERE trip_id = $1 AND segment_no = 1 AND leg = 'HOST'`,
            [w.trip],
          )
        ).rows[0]!;
      const unimputed = async (): Promise<string> => {
        await tx.query('SAVEPOINT rt_l2_fin');
        await asWorker(tx, 'reconciliation');
        const r = reconciliationReportJson(await runMoneyReconciliation(sqlOf(tx)));
        await tx.query('ROLLBACK TO SAVEPOINT rt_l2_fin');
        return r.checks['CHARGEBACK_UNIMPUTED']?.byCountry[c.country] ?? '0';
      };
      expect(await host()).toEqual({ frozen: false, frozen_reason: null });
      expect(await unimputed()).toBe('0');
      const cb = await recordOperation(tx, {
        tripId: w.trip,
        accountId: w.account,
        kind: 'CHARGEBACK',
        amountMinor: total,
        currency: c.currency,
        legs: null,
      });
      expect(await host()).toEqual({ frozen: true, frozen_reason: 'CHARGEBACK' });
      expect(await unimputed()).toBe('0');
      // 08 E7 règle 7 : la part INSURER est gelée avec HOST, TAX_THIRD_PARTY et PLATFORM jamais
      const others = await tx.query<{ n: number }>(
        `SELECT pg_catalog.count(*)::int AS n FROM core.settlement_trip_leg_balance
          WHERE trip_id = $1 AND leg NOT IN ('HOST', 'INSURER') AND frozen`,
        [w.trip],
      );
      expect(others.rows[0]?.n).toBe(0);
      expect(await signedStatus(tx, cb.operation_id, 'SUCCEEDED')).toBe('APPLIED');
      // US-709 : imputé par la base (TJ14b), donc décidé : dégel et aucun écart FIN
      expect(await host()).toEqual({ frozen: false, frozen_reason: null });
      expect(await unimputed()).toBe('0');
    });
  });
});
