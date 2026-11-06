/**
 * US-049 — red team ARGENT, commandes de paiement et soldes par jambe (`core.payment_cmd_*`,
 * `core.settlement_cmd_apply_leg_movement` ; 08 E1, E4, E7 ; 17 §2.8, §2.9, §4.3 ; ADR-059, ADR-066).
 * Sous les rôles de PRODUCTION (L0-05 : `withRole`), en USD (PA) et en PYG sans décimale (PY).
 *
 * Chaque test affirme que l'attaque est BLOQUÉE : un test rouge est une faille, décrite dans
 * `docs/team/redteam/L0-argent.md`. Les montants attendus viennent de l'export des oracles
 * (TJ01, TJ02a/b, TJ08a/b, TJ10a/b/c), jamais du code testé.
 */
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { legVector, loadGoldenVectors, settlementVector } from '@rueda/money/golden-vectors';
import { J, toEvent, toTrip } from '@rueda/money/testing';
import { setSessionContext, translateDbError } from '../../src/index.ts';
import { withRole } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import {
  applyStatus,
  caught,
  insertAccount,
  insertTrip,
  payTx,
  publicWebhookId,
  recordOperation,
  uuid,
} from '../support/pay.ts';
import type { Legs } from '../support/pay.ts';
import { at, recordAsSettlementWorker, recordOf } from '../support/settlement.ts';

const golden = loadGoldenVectors();
const LEG_NAMES = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
const legsOf = (id: string): Legs => ({ ...legVector(golden, id).legsMinor });
const negate = (l: Legs): Legs => ({
  HOST: -l.HOST,
  INSURER: -l.INSURER,
  TAX_THIRD_PARTY: -l.TAX_THIRD_PARTY,
  PLATFORM: -l.PLATFORM,
});
const plus = (a: Legs, b: Legs): Legs => ({
  HOST: a.HOST + b.HOST,
  INSURER: a.INSURER + b.INSURER,
  TAX_THIRD_PARTY: a.TAX_THIRD_PARTY + b.TAX_THIRD_PARTY,
  PLATFORM: a.PLATFORM + b.PLATFORM,
});
const sum = (l: Legs): bigint => LEG_NAMES.reduce((s, k) => s + l[k], 0n);
const ZERO: Legs = { HOST: 0n, INSURER: 0n, TAX_THIRD_PARTY: 0n, PLATFORM: 0n };

/** Références par pays : capture, règlement (variation) et jambes retenues (capture + variation). */
const REF: Readonly<Record<string, { capture: string; variation: string }>> = {
  USD: { capture: 'TJ01', variation: 'TJ02b' },
  PYG: { capture: 'TJ08a', variation: 'TJ08b' },
};
const refOf = (c: CountryCase) => {
  const r = REF[c.currency];
  if (!r) throw new Error(`pas de référence pour ${c.currency}`);
  return r;
};

/** Contexte `payment_command` dans une transaction annulée, sous le rôle de production app_worker. */
const asPayments = <T>(fn: (tx: pg.ClientBase) => Promise<T>): Promise<T> =>
  withRole('app_worker', (client) => payTx(client, { worker: 'payment_command' }, fn));

/** Exécute `run` dans un point de sauvegarde : 'OK' ou le code métier. */
async function attempt(tx: pg.ClientBase, run: () => Promise<unknown>): Promise<string> {
  await tx.query('SAVEPOINT redteam_attempt');
  try {
    await run();
  } catch (error) {
    await tx.query('ROLLBACK TO SAVEPOINT redteam_attempt');
    return translateDbError(error).code;
  }
  await tx.query('RELEASE SAVEPOINT redteam_attempt');
  return 'OK';
}

async function sqlstateOf(tx: pg.ClientBase, run: () => Promise<unknown>): Promise<string> {
  const err = await caught(tx, run);
  return err === null ? 'AUCUNE_ERREUR' : String(err.code ?? 'SANS_CODE');
}

/** Appel brut de la commande, jambes passées telles quelles (forme JSON hostile possible). */
async function rawRecord(
  tx: pg.ClientBase,
  a: {
    tripId: string;
    accountId: string;
    kind?: string;
    purpose?: string;
    amount: string;
    currency: string;
    idem: string;
    idemSent?: string;
    attempt?: number;
    legs: unknown;
  },
): Promise<{ operation_id: string; replayed: boolean }> {
  const { rows } = await tx.query<{ operation_id: string; replayed: boolean }>(
    `SELECT operation_id, replayed
       FROM core.payment_cmd_record_operation($1, NULL, $2, $3, 'CARD', $4, $5, $6::bigint, $7, $8, $9, $10,
                                              $11::jsonb)`,
    [
      uuid(),
      a.tripId,
      a.accountId,
      a.kind ?? 'CAPTURE',
      a.purpose ?? 'RENT',
      a.amount,
      a.currency,
      a.attempt ?? 1,
      a.idem,
      a.idemSent ?? a.idem,
      a.legs === null ? null : JSON.stringify(a.legs),
    ],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('record_operation sans résultat');
  return row;
}

/** Opération enregistrée par la vraie commande, rendue SUCCEEDED. */
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
  expect(await applyStatus(tx, id, 'SUCCEEDED')).toBe('APPLIED');
  return id;
}

async function applyMovement(tx: pg.ClientBase, operationId: string): Promise<string> {
  const { rows } = await tx.query<{ outcome: string }>(
    'SELECT core.settlement_cmd_apply_leg_movement($1) AS outcome',
    [operationId],
  );
  return rows[0]?.outcome ?? '';
}

async function column(
  tx: pg.ClientBase,
  tripId: string,
  field: 'captured_minor' | 'refunded_minor' | 'released_minor',
): Promise<Legs> {
  const { rows } = await tx.query<{ leg: string; v: string }>(
    `SELECT leg, ${field}::text AS v FROM core.settlement_trip_leg_balance
      WHERE trip_id = $1 AND segment_no = 1`,
    [tripId],
  );
  const out = { ...ZERO };
  for (const r of rows) out[r.leg as (typeof LEG_NAMES)[number]] = BigInt(r.v);
  return out;
}

const operationCount = async (tx: pg.ClientBase, tripId: string): Promise<number> => {
  const r = await tx.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM core.payment_payment_operation WHERE trip_id = $1',
    [tripId],
  );
  return r.rows[0]?.n ?? -1;
};

// ----------------------------------------------------------------------------------------------

describe.each(COUNTRIES)(
  'ARG-30 — somme des jambes falsifiée / jambe négative — $country ($currency)',
  (c) => {
    const A = '1000';
    const ok = { HOST: '500', INSURER: '200', TAX_THIRD_PARTY: '100', PLATFORM: '200' };
    const cases: [string, unknown, string | 'any'][] = [
      ['Σ jambes = montant + 1', { ...ok, PLATFORM: '201' }, 'LEG_SUM_MISMATCH'],
      ['Σ jambes = montant − 1', { ...ok, PLATFORM: '199' }, 'LEG_SUM_MISMATCH'],
      [
        'jambe négative compensée (Σ exacte)',
        { ...ok, HOST: '1200', INSURER: '-200', TAX_THIRD_PARTY: '0', PLATFORM: '0' },
        'LEG_AMOUNT_NEGATIVE',
      ],
      [
        'HOST négatif, PLATFORM absorbe',
        { HOST: '-100', INSURER: '0', TAX_THIRD_PARTY: '0', PLATFORM: '1100' },
        'LEG_AMOUNT_NEGATIVE',
      ],
      ['jambe décimale', { ...ok, HOST: '500.5', PLATFORM: '199.5' }, 'any'],
      ['jambe en notation scientifique', { ...ok, HOST: '5e2' }, 'any'],
      ['jambe avec signe +', { ...ok, HOST: '+500' }, 'any'],
      ['jambe avec espace', { ...ok, HOST: ' 500' }, 'any'],
      ['jambe hexadécimale', { ...ok, HOST: '0x1f4' }, 'any'],
      ['jambe vide', { ...ok, HOST: '' }, 'any'],
      ['jambe à 19 chiffres', { ...ok, HOST: '1000000000000000000' }, 'any'],
      [
        'jambes en nombres JSON',
        { HOST: 500, INSURER: 200, TAX_THIRD_PARTY: 100, PLATFORM: 200 },
        'any',
      ],
      ['jambe nulle (null JSON)', { ...ok, HOST: null }, 'any'],
      ['jambe manquante', { HOST: '500', INSURER: '200', PLATFORM: '300' }, 'any'],
      ['jambe en trop', { ...ok, FOUNDER: '0' }, 'any'],
      [
        'noms de jambes en minuscules',
        { host: '500', insurer: '200', tax_third_party: '100', platform: '200' },
        'any',
      ],
      ['jambes absentes (null)', null, 'any'],
      ['jambes en tableau', ['500', '200', '100', '200'], 'any'],
      ['jambes en chaîne', '500,200,100,200', 'any'],
    ];

    it.each(cases)('%s ⇒ refus, aucune opération écrite', async (label, legs, expected) => {
      await asPayments(async (tx) => {
        const trip = await insertTrip(tx, c);
        const account = await insertAccount(tx, { country: c.country });
        const outcome = await attempt(tx, () =>
          rawRecord(tx, {
            tripId: trip,
            accountId: account,
            amount: A,
            currency: c.currency,
            idem: `k:${uuid()}`,
            legs,
          }),
        );
        expect(outcome, label).not.toBe('OK');
        if (expected !== 'any') expect(outcome, label).toBe(expected);
        expect(await operationCount(tx, trip)).toBe(0);
      });
    });

    it('montant nul, négatif ou hors bigint ⇒ refus ; contrôle : jambes exactes ⇒ acceptées', async () => {
      await asPayments(async (tx) => {
        const trip = await insertTrip(tx, c);
        const account = await insertAccount(tx, { country: c.country });
        for (const amount of ['0', '-1000', '9223372036854775808', '99999999999999999999']) {
          const outcome = await attempt(tx, () =>
            rawRecord(tx, {
              tripId: trip,
              accountId: account,
              amount,
              currency: c.currency,
              idem: `k:${uuid()}`,
              legs: ok,
            }),
          );
          expect(outcome, amount).not.toBe('OK');
        }
        expect(await operationCount(tx, trip)).toBe(0);
        const fine = await rawRecord(tx, {
          tripId: trip,
          accountId: account,
          amount: A,
          currency: c.currency,
          idem: `k:${uuid()}`,
          legs: ok,
        });
        expect(fine.replayed).toBe(false);
      });
    });

    it('écriture directe des jambes ou du montant d’une opération (contournement de la commande) ⇒ 42501', async () => {
      await asPayments(async (tx) => {
        const trip = await insertTrip(tx, c);
        const account = await insertAccount(tx, { country: c.country });
        const op = await rawRecord(tx, {
          tripId: trip,
          accountId: account,
          amount: A,
          currency: c.currency,
          idem: `k:${uuid()}`,
          legs: ok,
        });
        const statements: [string, unknown[]][] = [
          [
            `INSERT INTO core.payment_payment_operation_leg (operation_id, leg, org_id, trip_id, country_code, amount_minor) VALUES ($1, 'HOST', NULL, $2, $3, 1)`,
            [op.operation_id, trip, c.country],
          ],
          [
            'UPDATE core.payment_payment_operation_leg SET amount_minor = 999999 WHERE operation_id = $1',
            [op.operation_id],
          ],
          [
            'UPDATE core.payment_payment_operation SET amount_minor = 999999 WHERE id = $1',
            [op.operation_id],
          ],
          [
            "UPDATE core.payment_payment_operation SET kind = 'REFUND' WHERE id = $1",
            [op.operation_id],
          ],
          [
            'DELETE FROM core.payment_payment_operation_leg WHERE operation_id = $1',
            [op.operation_id],
          ],
        ];
        for (const [sql, args] of statements) {
          expect(await sqlstateOf(tx, () => tx.query(sql, args)), sql).toBe('42501');
        }
      });
    });
  },
);

describe.each(COUNTRIES)(
  'ARG-31 — clé d’idempotence réutilisée avec un montant ou une cible différents — $country ($currency)',
  (c) => {
    const legs = { HOST: '500', INSURER: '200', TAX_THIRD_PARTY: '100', PLATFORM: '200' };

    it('même clé : rejeu identique ⇒ même opération ; tout contenu différent ⇒ IDEMPOTENCY_CONFLICT', async () => {
      await asPayments(async (tx) => {
        const trip = await insertTrip(tx, c);
        const otherTrip = await insertTrip(tx, c);
        const account = await insertAccount(tx, { country: c.country });
        const key = `trip:${trip}:CAPTURE:${uuid()}`;
        const base = {
          tripId: trip,
          accountId: account,
          amount: '1000',
          currency: c.currency,
          idem: key,
          legs,
        };
        const first = await rawRecord(tx, base);
        expect(first.replayed).toBe(false);
        const again = await rawRecord(tx, base);
        expect(again).toEqual({ operation_id: first.operation_id, replayed: true });

        const variants: [string, Parameters<typeof rawRecord>[1]][] = [
          [
            'montant + 1 (jambes ajustées)',
            { ...base, amount: '1001', legs: { ...legs, PLATFORM: '201' } },
          ],
          [
            'même total, répartition différente',
            { ...base, legs: { ...legs, HOST: '501', PLATFORM: '199' } },
          ],
          ['autre trip (cible différente)', { ...base, tripId: otherTrip }],
          ['autre nature (REFUND)', { ...base, kind: 'REFUND' }],
          ['autre objet (RENT_SHORTFALL)', { ...base, purpose: 'RENT_SHORTFALL' }],
          ['autre numéro de tentative', { ...base, attempt: 2 }],
        ];
        for (const [label, args] of variants) {
          const outcome = await attempt(tx, () => rawRecord(tx, args));
          expect(outcome, label).toBe('IDEMPOTENCY_CONFLICT');
        }
        // une valeur PSP qui n'est ni la clé ni son SHA-256 est refusée avant tout rejeu
        expect(
          await attempt(tx, () => rawRecord(tx, { ...base, idemSent: '0'.repeat(64) })),
        ).not.toBe('OK');
        expect(await operationCount(tx, trip)).toBe(1);
        expect(await operationCount(tx, otherTrip)).toBe(0);
      });
    });

    it('clé du pays voisin réutilisée sur ce pays ⇒ conflit, jamais l’opération de l’autre pays', async () => {
      const other = COUNTRIES.find((x) => x.country !== c.country);
      if (!other) throw new Error('second pays absent');
      await asPayments(async (tx) => {
        const tripA = await insertTrip(tx, c);
        const tripB = await insertTrip(tx, other);
        const accA = await insertAccount(tx, { country: c.country });
        const accB = await insertAccount(tx, {
          country: other.country,
          publicWebhookId: publicWebhookId(),
        });
        const key = `shared:${uuid()}`;
        await rawRecord(tx, {
          tripId: tripA,
          accountId: accA,
          amount: '1000',
          currency: c.currency,
          idem: key,
          legs,
        });
        const outcome = await attempt(tx, () =>
          rawRecord(tx, {
            tripId: tripB,
            accountId: accB,
            amount: '1000',
            currency: other.currency,
            idem: key,
            legs,
          }),
        );
        expect(outcome).toBe('IDEMPOTENCY_CONFLICT');
      });
    });
  },
);

describe('ARG-32 — devise et pays croisés sur une opération', () => {
  it('USD sur un trip PY, PYG sur un trip PA, compte d’un autre pays ⇒ PAYMENT_SUBJECT_MISMATCH', async () => {
    const [pa, py] = COUNTRIES;
    const legs = { HOST: '500', INSURER: '200', TAX_THIRD_PARTY: '100', PLATFORM: '200' };
    await asPayments(async (tx) => {
      const tripPa = await insertTrip(tx, pa);
      const tripPy = await insertTrip(tx, py);
      const accPa = await insertAccount(tx, { country: pa.country });
      const accPy = await insertAccount(tx, { country: py.country });
      const cases: [string, string, string, string][] = [
        ['USD sur le trip PY', tripPy, accPy, pa.currency],
        ['PYG sur le trip PA', tripPa, accPa, py.currency],
        ['compte PA sur le trip PY', tripPy, accPa, py.currency],
        ['compte PY sur le trip PA', tripPa, accPy, pa.currency],
      ];
      for (const [label, trip, account, currency] of cases) {
        const outcome = await attempt(tx, () =>
          rawRecord(tx, {
            tripId: trip,
            accountId: account,
            amount: '1000',
            currency,
            idem: `k:${uuid()}`,
            legs,
          }),
        );
        expect(outcome, label).toBe('PAYMENT_SUBJECT_MISMATCH');
      }
    });
  });
});

describe.each(COUNTRIES)(
  'ARG-33 — remboursement hors du règlement : prorata et cumul — $country ($currency)',
  (c) => {
    const r = refOf(c);
    const capture = legsOf(r.capture);
    const refund = negate(legsOf(r.variation)); // jambes remboursées par le règlement (explicites)
    const kept = plus(capture, legsOf(r.variation)); // jambes retenues (TJ02a / capture + variation)

    /** Capture portée sur les soldes, puis règlement v1 enregistré par le travailleur `settlement`. */
    async function settleOnCapturedTrip(tx: pg.ClientBase, vector: 'T03' | 'T27') {
      const trip = await insertTrip(tx, c);
      const account = await insertAccount(tx, { country: c.country });
      const cap = await succeeded(tx, trip, account, 'CAPTURE', capture, c.currency);
      expect(await applyMovement(tx, cap)).toBe('APPLIED');
      const v = settlementVector(golden, vector);
      await setSessionContext(tx, { kind: 'WORKER', workerName: 'settlement' });
      await recordAsSettlementWorker(
        tx,
        { tripId: trip, version: 1 },
        recordOf(toTrip(v.trip), toEvent(v.event)),
      );
      await setSessionContext(tx, { kind: 'WORKER', workerName: 'payment_command' });
      return { trip, account };
    }

    it('ordres PSP alignés sur le règlement v1 : remboursement exact accepté (contrôle)', async () => {
      await asPayments(async (tx) => {
        const { trip, account } = await settleOnCapturedTrip(
          tx,
          c.currency === 'USD' ? 'T03' : 'T27',
        );
        const op = await succeeded(tx, trip, account, 'REFUND', refund, c.currency);
        expect(await applyMovement(tx, op)).toBe('APPLIED');
        expect(await column(tx, trip, 'refunded_minor')).toEqual(refund);
      });
    });

    it('second remboursement (autre clé) qui rembourse en plus tout le retenu : Σ remboursée > remboursement du règlement ⇒ refus', async () => {
      await asPayments(async (tx) => {
        const { trip, account } = await settleOnCapturedTrip(
          tx,
          c.currency === 'USD' ? 'T03' : 'T27',
        );
        const first = await succeeded(tx, trip, account, 'REFUND', refund, c.currency);
        expect(await applyMovement(tx, first)).toBe('APPLIED');
        // « v2 appliquée deux fois » côté ordres : le solde disponible (= retenu) suffit, le règlement non
        const outcome = await attempt(tx, async () => {
          const second = await succeeded(tx, trip, account, 'REFUND', kept, c.currency);
          await applyMovement(tx, second);
        });
        expect(outcome).not.toBe('OK');
        // le guest ne doit jamais avoir été remboursé au-delà de Σ des jambes du règlement
        const refunded = await column(tx, trip, 'refunded_minor');
        expect(sum(refunded)).toBeLessThanOrEqual(sum(refund));
      });
    });

    it.runIf(c.currency === 'PYG')(
      'contre-exemple TJ10c : remboursement ventilé au prorata au lieu des jambes explicites du règlement ⇒ refus',
      async () => {
        await asPayments(async (tx) => {
          const trip = await insertTrip(tx, c);
          const account = await insertAccount(tx, { country: c.country });
          const cap = await succeeded(tx, trip, account, 'CAPTURE', legsOf('TJ10a'), c.currency);
          expect(await applyMovement(tx, cap)).toBe('APPLIED');
          await setSessionContext(tx, { kind: 'WORKER', workerName: 'settlement' });
          await recordAsSettlementWorker(
            tx,
            { tripId: trip, version: 1 },
            recordOf(J, { reason: 'GUEST_CANCELLED', requestedAtMs: at(-600) }),
          );
          await setSessionContext(tx, { kind: 'WORKER', workerName: 'payment_command' });
          const prorata = negate(legsOf('TJ10c')); // même total que TJ10b, jambes différentes (interdit, 08 E7 règle 1)
          expect(sum(prorata)).toBe(sum(negate(legsOf('TJ10b'))));
          const outcome = await attempt(tx, async () => {
            const op = await succeeded(tx, trip, account, 'REFUND', prorata, c.currency);
            await applyMovement(tx, op);
          });
          expect(outcome).not.toBe('OK');
          expect(await column(tx, trip, 'refunded_minor')).not.toEqual(prorata);
        });
      },
    );
  },
);

describe.each(COUNTRIES)(
  'ARG-34 — capture sans rapport avec le devis, versement avant la fin du trajet — $country ($currency)',
  (c) => {
    const capture = legsOf(refOf(c).capture);

    it('capture démesurée (4 × 10^15 unités mineures) portée sur les soldes d’un trip réservé ⇒ refus', async () => {
      await asPayments(async (tx) => {
        const trip = await insertTrip(tx, c);
        const account = await insertAccount(tx, { country: c.country });
        const huge: Legs = {
          HOST: 10n ** 15n,
          INSURER: 10n ** 15n,
          TAX_THIRD_PARTY: 10n ** 15n,
          PLATFORM: 10n ** 15n,
        };
        const outcome = await attempt(tx, async () => {
          const op = await succeeded(tx, trip, account, 'CAPTURE', huge, c.currency);
          await applyMovement(tx, op);
        });
        // 08 E1 : le montant encaissé est le total du devis accepté (figé) ; rien ne le borne en base
        expect(outcome).not.toBe('OK');
      });
    });

    it('versement de la jambe HOST (LEG_RELEASE) alors que le trajet est seulement réservé et payouts_enabled = false ⇒ refus', async () => {
      await asPayments(async (tx) => {
        const trip = await insertTrip(tx, c); // statut BOOKED, fin planifiée dans le futur
        const account = await insertAccount(tx, { country: c.country });
        const cap = await succeeded(tx, trip, account, 'CAPTURE', capture, c.currency);
        expect(await applyMovement(tx, cap)).toBe('APPLIED');
        const release = { ...ZERO, HOST: capture.HOST };
        const outcome = await attempt(tx, async () => {
          const op = await succeeded(tx, trip, account, 'LEG_RELEASE', release, c.currency);
          await applyMovement(tx, op);
        });
        // 08 E7 / BR-PAYOUT : la jambe HOST reste chez le PSP jusqu'à payout_at ; aucun versement si
        // payouts_enabled[pays] = false (graine 0009 : false pour PA et PY)
        expect(outcome).not.toBe('OK');
        expect(await column(tx, trip, 'released_minor')).toEqual(ZERO);
      });
    });
  },
);

describe('ARG-35 — détention de fonds et FAKE : variante B fermée, FAKE jamais actif en production', () => {
  const [pa] = COUNTRIES;

  it('compte PLATFORM_MOR (funds_holding_enabled = false), FAKE en LIVE, mise à jour vers PLATFORM_MOR ⇒ refus', async () => {
    await asPayments(async (tx) => {
      const insert = (mode: string, env: string, provider = 'FAKE') =>
        tx.query(
          `INSERT INTO core.payment_psp_account
                  (id, provider, country_code, environment, collection_mode, status, public_webhook_id,
                   webhook_secret_ref, credentials_ref)
           VALUES ($1, $2, $3, $4, $5, 'PENDING_VALIDATION', $6, 'vault:psp/test/webhook', 'vault:psp/test/api')`,
          [uuid(), provider, pa.country, env, mode, publicWebhookId()],
        );
      expect(await attempt(tx, () => insert('PLATFORM_MOR', 'SANDBOX'))).not.toBe('OK');
      expect(await attempt(tx, () => insert('SPLIT_AT_SOURCE', 'LIVE'))).not.toBe('OK');
      expect(await attempt(tx, () => insert('PLATFORM_MOR', 'LIVE', 'TILOPAY'))).not.toBe('OK');
      const account = await insertAccount(tx, {
        country: pa.country,
        status: 'PENDING_VALIDATION',
      });
      expect(
        await attempt(tx, () =>
          tx.query(
            `UPDATE core.payment_psp_account SET collection_mode = 'PLATFORM_MOR' WHERE id = $1`,
            [account],
          ),
        ),
      ).not.toBe('OK');
      // compte réel ACTIVE sans décision de porte PAY-041
      expect(
        await attempt(tx, () =>
          tx.query(
            `INSERT INTO core.payment_psp_account (id, provider, country_code, environment, status, public_webhook_id,
                                                   webhook_secret_ref, credentials_ref)
             VALUES ($1, 'TILOPAY', $2, 'LIVE', 'ACTIVE', $3, 'vault:psp/test/webhook', 'vault:psp/test/api')`,
            [uuid(), pa.country, publicWebhookId()],
          ),
        ),
      ).not.toBe('OK');
    });
  });

  it('FAKE présent en production (C19) : écriture du compte et opération refusées ; webhook sans effet', async () => {
    await asPayments(async (tx) => {
      const trip = await insertTrip(tx, pa);
      const account = await insertAccount(tx, { country: pa.country });
      await tx.query(`SELECT pg_catalog.set_config('app.test_deployment_env', 'production', true)`);
      expect(
        await attempt(tx, () =>
          recordOperation(tx, {
            tripId: trip,
            accountId: account,
            amountMinor: 1000n,
            currency: pa.currency,
            idemPlain: `k:${uuid()}`,
            legs: { HOST: 500n, INSURER: 200n, TAX_THIRD_PARTY: 100n, PLATFORM: 200n },
          }),
        ),
      ).toBe('FAKE_FORBIDDEN_IN_PRODUCTION');
      expect(
        await attempt(tx, () =>
          insertAccount(tx, { country: pa.country, status: 'PENDING_VALIDATION' }),
        ),
      ).toBe('FAKE_FORBIDDEN_IN_PRODUCTION');
    });
  });
});

describe.each(COUNTRIES)('ARG-36 — statut SUCCEEDED sans preuve — $country ($currency)', (c) => {
  it('un travailleur marque SUCCEEDED « WEBHOOK » sans aucun webhook reçu (raw_ref nul) ⇒ refus', async () => {
    await asPayments(async (tx) => {
      const trip = await insertTrip(tx, c);
      const account = await insertAccount(tx, { country: c.country });
      const { operation_id: id } = await recordOperation(tx, {
        tripId: trip,
        accountId: account,
        amountMinor: 1000n,
        currency: c.currency,
        idemPlain: `k:${uuid()}`,
        legs: { HOST: 500n, INSURER: 200n, TAX_THIRD_PARTY: 100n, PLATFORM: 200n },
      });
      // 17 §4.4 : la preuve « signée » est un événement reçu, de signature valide, rattaché à l'opération
      const outcome = await applyStatus(tx, id, 'SUCCEEDED', 'WEBHOOK', null);
      const proof = await tx.query<{ proof_type: string | null; status: string }>(
        'SELECT proof_type, status FROM core.payment_payment_operation WHERE id = $1',
        [id],
      );
      expect({ outcome, status: proof.rows[0]?.status, proof: proof.rows[0]?.proof_type }).toEqual({
        outcome: expect.not.stringMatching(/^APPLIED$/),
        status: 'PENDING',
        proof: null,
      });
    });
  });
});
