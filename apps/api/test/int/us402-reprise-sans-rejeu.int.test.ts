/**
 * US-402 — RT-L4-E01 / L4-PM-19 (critique) : une restauration ne rejoue AUCUN débit ni versement
 * (ADR-206 PROPOSÉ ; 17 §2.8, §6.4 ; 08 E4). Joué sous le rôle de PRODUCTION `app_worker`
 * (`connectAs` : L0-05), en USD (PA) et en PYG sans décimale (PY), avec les VRAIES commandes de la
 * base (`core.payment_cmd_record_operation`, `core.payment_cmd_apply_operation_status`, garde de
 * reprise 0185, `core.outbox_claim_jobs`) et le VRAI `MoneyCommandSender`.
 *
 * Restauration ÉMULÉE (la vraie, avec changement de ligne de temps, est jouée par l'exercice de la
 * CI, packages/db/test/drill) : toute la scène tient dans UNE transaction annulée à la fin ; un
 * point de sauvegarde marque l'instant T ; « restaurer à T » = `ROLLBACK TO SAVEPOINT` : la base
 * revient exactement à T, alors que le PSP (objet en mémoire, hors base) garde ce qu'il a exécuté
 * après T. La garde que la ligne de temps lèverait d'elle-même est posée explicitement
 * (`platform.recovery_place_hold`), comme le runbook le fait pour une restauration logique.
 *
 * Scène : A = débit enregistré avant T, ENVOYÉ après T ; B = débit enregistré ET exécuté après T,
 * donc ABSENT de la base restaurée. Attendus (ADR-206) :
 *   1. après la restauration, garde active : la tâche due n'est pas réclamée ⇒ rien n'est émis ;
 *   2. rapprochement (lecture d'abord, PSP sans en-tête d'idempotence validé) : A est retrouvé au
 *      PSP par notre clé, AUCUN second débit ;
 *   3. B recréé par son processus avec sa clé DÉTERMINISTE : lecture d'abord ⇒ retrouvé, aucun
 *      second débit ; avec en-tête d'idempotence et dans la fenêtre W du PSP (H-IDEM) ⇒ même clé,
 *      même effet ; AU-DELÀ de W, le PSP créerait un second effet : c'est pourquoi la levée est
 *      refusée hors fenêtre sans relevé complet du PSP (packages/db/src/restore/recovery.test.ts).
 * Dates du trip : année 2087 (registre des années, packages/db/test/redteam/l3/support-l3.ts).
 */
import { randomUUID } from 'node:crypto';
// types du contexte fourni par le globalSetup du banc (inject('ruedaBench'))
import type {} from '@rueda/db/testing/global-setup';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import {
  MoneyCommandSender,
  type MoneyCommand,
  type OperationResult,
  type OperationStatusStore,
  type PaymentProvider,
  type ProviderOperation,
} from '../../src/modules/pay/index.js';
import {
  CASES,
  DAY,
  iso,
  legsOf,
  open,
  inTx,
  recordOperation,
  sum,
  type Case,
  type Legs,
} from '../support/redteam-l2.js';

const START_MS = Date.UTC(2087, 2, 1, 12, 0, 0);
const WINDOW_MS = 24 * 3_600_000; // H-IDEM : W = 24 h (hypothèse PROPOSÉE)

interface Effect {
  readonly key: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly legs: Legs;
}

/**
 * PSP EXTERNE : il survit à la restauration (hors base). Il compte les appels d'exécution et les
 * lectures ; il déduplique une même clé pendant `WINDOW_MS` après son premier usage (H-IDEM), au-delà
 * il crée un nouvel effet, comme un PSP dont la mémoire des clés a expiré.
 */
class ExternalPsp {
  readonly effects: Effect[] = [];
  readonly captureCalls: string[] = [];
  lookups = 0;
  nowMs = START_MS;
  readonly #firstSeen = new Map<string, number>();
  constructor(readonly withIdempotencyHeader: boolean) {}
  capabilities() {
    return {
      bool: (name: string) =>
        name === 'SUPPORTS_LOOKUP_BY_MERCHANT_REF' ||
        name === 'SUPPORTS_PER_LEG_AMOUNTS' ||
        (name === 'SUPPORTS_IDEMPOTENCY_HEADER' && this.withIdempotencyHeader),
    };
  }
  capture(req: {
    idempotencyKey: string;
    amountMinor: bigint;
    currency: string;
    legs: unknown;
  }): Promise<OperationResult> {
    this.captureCalls.push(req.idempotencyKey);
    const first = this.#firstSeen.get(req.idempotencyKey);
    if (first === undefined || this.nowMs - first >= WINDOW_MS) {
      this.#firstSeen.set(req.idempotencyKey, this.nowMs);
      this.effects.push({
        key: req.idempotencyKey,
        amountMinor: req.amountMinor,
        currency: req.currency,
        legs: { ...(req.legs as Legs) },
      });
    }
    return Promise.resolve({
      providerReference: `psp-${req.idempotencyKey.slice(-12)}`,
      status: 'PENDING',
    });
  }
  getOperation(q: { merchantReference?: string }): Promise<ProviderOperation | null> {
    this.lookups += 1;
    const e = [...this.effects].reverse().find((x) => x.key === q.merchantReference);
    return Promise.resolve(
      e === undefined
        ? null
        : {
            providerReference: `psp-${e.key.slice(-12)}`,
            merchantReference: e.key,
            status: 'PENDING',
            amountMinor: e.amountMinor,
            currency: e.currency,
            legs: e.legs,
          },
    );
  }
}

/** Statut appliqué par la VRAIE commande de la base, dans la transaction de la scène. */
const storeOf = (tx: pg.ClientBase): OperationStatusStore => ({
  apply: async (i) => {
    const { rows } = await tx.query<{ outcome: string }>(
      `SELECT core.payment_cmd_apply_operation_status($1, $2, $3, $4, $5) AS outcome`,
      [i.operationId, i.status, i.source, i.rawRef, i.providerReference],
    );
    return rows[0]?.outcome as never;
  },
});

/** Commande d'argent telle que la base la stocke (clé, statut, jambes ; jamais recalculée). */
async function commandOf(
  tx: pg.ClientBase,
  operationId: string,
  c: Case,
  legs: Legs,
): Promise<MoneyCommand> {
  const { rows } = await tx.query<{ status: string; idem_sent: string; amount_minor: string }>(
    `SELECT status, idem_sent, amount_minor::text AS amount_minor
       FROM core.payment_payment_operation WHERE id = $1`,
    [operationId],
  );
  const r = rows[0];
  if (r === undefined) throw new Error('opération absente');
  return {
    operationId,
    kind: 'CAPTURE',
    status: r.status as MoneyCommand['status'],
    idemSent: r.idem_sent,
    amountMinor: BigInt(r.amount_minor),
    currency: c.currency,
    legs,
    targetReference: `auth-${operationId.slice(0, 8)}`,
    providerReference: null,
  };
}

async function newTrip(tx: pg.ClientBase, c: Case, offsetDays: number): Promise<string> {
  const trip = randomUUID();
  await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, 'UTC', $7, $8)`, [
    trip,
    randomUUID(),
    randomUUID(),
    randomUUID(),
    c.country,
    c.currency,
    iso(START_MS + offsetDays * DAY),
    iso(START_MS + (offsetDays + 3) * DAY),
  ]);
  return trip;
}

const statusOf = async (tx: pg.ClientBase, id: string): Promise<string | undefined> =>
  (
    await tx.query<{ status: string }>(
      'SELECT status FROM core.payment_payment_operation WHERE id = $1',
      [id],
    )
  ).rows[0]?.status;

describe.each(CASES)('US-402 — reprise sans rejeu ($country, $currency)', (c: Case) => {
  const legs = legsOf(c.journey.capture);
  const amount = sum(legs);

  for (const withHeader of [false, true]) {
    it(`RT-L4-E01 : restauration à T ⇒ garde, rien n'est émis ; A (envoyé après T) et B (exécuté après T, absent de la base) ne sont jamais débités deux fois (en-tête d'idempotence : ${withHeader ? 'validé' : 'non validé'})`, async () => {
      const worker = await open('app_worker');
      await inTx(worker, { worker: 'payment_command' }, async (tx) => {
        const psp = new ExternalPsp(withHeader);
        const account = (
          await tx.query<{ id: string }>('SELECT test_fixture.us024_psp_account($1) AS id', [
            c.country,
          ])
        ).rows[0]?.id;
        if (account === undefined) throw new Error('compte FAKE du pays introuvable');
        const tripA = await newTrip(tx, c, 0);
        const tripB = await newTrip(tx, c, 10);
        // clés déterministes (08 E4) : trip, segment, version, type, moyen, rang d'instance, tentative
        const keyOf = (trip: string): string => `${trip}:seg1:v1:CAPTURE:card1:i1:a1`;
        const record = (trip: string) =>
          recordOperation(tx, {
            tripId: trip,
            accountId: account,
            amountMinor: amount,
            currency: c.currency,
            legs,
            idemPlain: keyOf(trip),
          });

        // avant T : A enregistrée (PENDING, clé stockée), pas encore envoyée
        const a = await record(tripA);
        const sender = new MoneyCommandSender(psp as unknown as PaymentProvider, storeOf(tx));
        await tx.query('SAVEPOINT instant_t');

        // après T : A envoyée ; B enregistrée et exécutée
        expect((await sender.send(await commandOf(tx, a.operation_id, c, legs))).outcome).toBe(
          'SUBMITTED',
        );
        const b = await record(tripB);
        expect((await sender.send(await commandOf(tx, b.operation_id, c, legs))).outcome).toBe(
          'SUBMITTED',
        );
        expect(psp.effects.map((e) => e.key)).toEqual([keyOf(tripA), keyOf(tripB)]);
        const callsBefore = psp.captureCalls.length;

        // restauration à T : la base revient à T ; le PSP garde A et B
        await tx.query('ROLLBACK TO SAVEPOINT instant_t');
        expect(await statusOf(tx, a.operation_id)).toBe('PENDING');
        expect(await statusOf(tx, b.operation_id)).toBeUndefined();
        await tx.query(`SELECT platform.recovery_place_hold('US-402 : restauration émulée')`);

        // 1. garde active : la tâche due (commande de A) n'est pas réclamée ⇒ rien n'est émis
        const queue = `us402_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
        await tx.query(`SELECT pg_catalog.set_config('app.worker_name', $1, true)`, [queue]);
        await tx.query(
          `SELECT core.outbox_enqueue($1::text, $2::jsonb, $3::text, NULL::uuid, NULL::timestamptz,
                                      interval '0 seconds', 5)`,
          [queue, JSON.stringify({ operation_id: a.operation_id }), `us402:${a.operation_id}`],
        );
        expect(
          (await tx.query(`SELECT id FROM core.outbox_claim_jobs(10, interval '30 seconds')`)).rows,
        ).toEqual([]);
        await tx.query(`SELECT pg_catalog.set_config('app.worker_name', 'payment_command', true)`);
        expect(psp.captureCalls.length).toBe(callsBefore);

        // 2. rapprochement : lecture d'abord (sans en-tête validé : toujours ; avec : PENDING relu
        //    par le rapprochement, jamais renvoyé sans lecture) ⇒ A retrouvé, aucun second débit
        const reconcile = new MoneyCommandSender(
          new ExternalPspReader(psp) as unknown as PaymentProvider,
          storeOf(tx),
        );
        expect((await reconcile.send(await commandOf(tx, a.operation_id, c, legs))).outcome).toBe(
          'SUBMITTED',
        );
        expect(await statusOf(tx, a.operation_id)).toBe('SUBMITTED');
        expect(psp.captureCalls.length).toBe(callsBefore);

        // 3. après la levée, B recréé par son processus : même clé (déterministe), nouvel identifiant
        psp.nowMs = START_MS + WINDOW_MS - 2 * 3_600_000; // levée dans la fenêtre (H-IDEM)
        const b2 = await record(tripB);
        expect(b2.operation_id).not.toBe(b.operation_id);
        const cmdB2 = await commandOf(tx, b2.operation_id, c, legs);
        expect(cmdB2.idemSent).toBe(keyOf(tripB));
        expect((await sender.send(cmdB2)).outcome).toBe('SUBMITTED');
        expect(psp.effects).toHaveLength(2); // aucun second débit, ni pour A ni pour B
        expect(psp.captureCalls.length).toBe(withHeader ? callsBefore + 1 : callsBefore);
        for (const e of psp.effects) {
          expect(e.amountMinor).toBe(amount);
          expect(e.legs).toEqual(legs);
        }

        // H-IDEM, borne : au-delà de W, un PSP qui a oublié la clé créerait un second effet ; la
        // levée y est donc refusée sans relevé complet du PSP (releaseDecision, recovery.test.ts)
        if (withHeader) {
          const late = new ExternalPsp(true);
          const req = {
            idempotencyKey: keyOf(tripB),
            amountMinor: amount,
            currency: c.currency,
            legs,
          };
          await late.capture(req);
          late.nowMs = START_MS + WINDOW_MS;
          await late.capture(req);
          expect(late.effects).toHaveLength(2);
        }
      });
    });
  }
});

/** Le même PSP vu par le rapprochement : lecture seule d'abord, jamais d'envoi sans lecture. */
class ExternalPspReader {
  constructor(private readonly psp: ExternalPsp) {}
  capabilities() {
    return {
      bool: (name: string) =>
        name === 'SUPPORTS_LOOKUP_BY_MERCHANT_REF' || name === 'SUPPORTS_PER_LEG_AMOUNTS',
    };
  }
  capture(req: {
    idempotencyKey: string;
    amountMinor: bigint;
    currency: string;
    legs: unknown;
  }): Promise<OperationResult> {
    return this.psp.capture(req);
  }
  getOperation(q: { merchantReference?: string }): Promise<ProviderOperation | null> {
    return this.psp.getOperation(q);
  }
}
