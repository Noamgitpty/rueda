/**
 * US-049 — preuve d'un statut terminal de paiement (RC-5 ; migrations 0055 et 0058 ; ADR-088
 * décisions 4 et 9 ; revues code, argent et sécurité de la PR n° 92). Chaque condition de
 * rattachement de la preuve WEBHOOK est éprouvée SÉPARÉMENT, en PA (USD) et en PY (PYG), sous les
 * rôles de production (assertion L0-05 par withRole) :
 * - refus (`UNPROVEN`, rien ne change) : webhook d'une autre opération, d'un autre statut, d'un
 *   autre compte PSP, en quarantaine d'horodatage (même après réécriture du motif `error` par le
 *   travailleur : quarantaine blanchie), de signature invalide, déjà appliqué à une autre
 *   opération, ou ligne de boîte de réception écrite à la main par `webhook_ingest` ;
 * - acceptation (`APPLIED`) : webhook signé reçu par la commande, rattaché par notre clé ou par la
 *   référence PSP (`providerReference`) ;
 * - `MANUAL_OPS` terminal : `UNPROVEN` (aucune action du staff journalisée au lot 0) ;
 * - `POLL` terminal : ACCEPTÉ sans preuve — CARACTÉRISATION de la limite écrite dans ADR-088
 *   (RC-5 partiellement corrigée pour POLL et API_RESPONSE, story US-223) : si ce test devient
 *   rouge, la limite est fermée, inverser l'attente ;
 * - voie directe (UPDATE du statut par un travailleur) : refusée (42501).
 * Les webhooks sont reçus par la VRAIE commande `core.payment_cmd_receive_webhook` sous `app_api`
 * (voie de production) ; les attendus viennent de 17 §4.4 et d'ADR-059, jamais du code testé.
 */
import { randomBytes } from 'node:crypto';
import { legVector, loadGoldenVectors } from '@rueda/money/golden-vectors';
import type { GoldenLegVector } from '@rueda/money/golden-vectors';
import { describe, expect, it } from 'vitest';
import { withRole } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import {
  applyStatus,
  caught,
  insertAccount,
  insertTrip,
  payTx,
  recordOperation,
  uuid,
} from '../support/pay.ts';
import type { Legs } from '../support/pay.ts';

const set = loadGoldenVectors();
/** Capture d'un trip, par devise (08 E7 : TJ01 en USD, TJ08a en PYG). */
const CAPTURES: Record<string, GoldenLegVector> = {
  [legVector(set, 'TJ01').currency]: legVector(set, 'TJ01'),
  [legVector(set, 'TJ08a').currency]: legVector(set, 'TJ08a'),
};

interface World {
  readonly accountA: string;
  readonly accountB: string;
  readonly op1: string;
  readonly op1Idem: string;
  readonly op1Ref: string;
  readonly op2: string;
  readonly op2Idem: string;
}

interface Event {
  readonly providerReference: string;
  readonly merchantReference: string | null;
  readonly status: string;
}

/** Réception par la commande de production, sous app_api (validée) ; rend la ligne d'inbox. */
async function receive(
  account: string,
  events: readonly Event[],
  opts: { signatureValid?: boolean; signedAt?: string | null } = {},
): Promise<{ outcome: string; inboxId: string | null }> {
  return withRole('app_api', async (client) => {
    const { rows } = await client.query<{ outcome: string; inbox_id: string | null }>(
      `SELECT outcome, inbox_id
         FROM core.payment_cmd_receive_webhook($1, $2, $3, $4, $5::timestamptz, '{}'::jsonb, $6::jsonb)`,
      [
        account,
        `evt-${uuid()}`,
        randomBytes(32),
        opts.signatureValid ?? true,
        opts.signedAt === undefined ? null : opts.signedAt,
        JSON.stringify(
          events.map((e) => ({
            type: 'payment.status',
            providerReference: e.providerReference,
            merchantReference: e.merchantReference,
            status: e.status,
            occurredAt: '2031-07-01T08:00:00Z',
          })),
        ),
      ],
    );
    const r = rows[0];
    if (r === undefined) throw new Error('réception sans résultat');
    return { outcome: r.outcome, inboxId: r.inbox_id };
  });
}

/** Applique un statut sous `webhook_ingest`, dans une transaction annulée ; rend l'issue et l'état. */
async function tryApply(
  op: string,
  status: string,
  source: string,
  rawRef: string | null,
): Promise<{ outcome: string; status: string }> {
  return withRole('app_worker', (client) =>
    payTx(client, { worker: 'webhook_ingest' }, async (tx) => {
      const outcome = await applyStatus(tx, op, status, source, null, rawRef);
      const { rows } = await tx.query<{ status: string }>(
        'SELECT status FROM core.payment_payment_operation WHERE id = $1',
        [op],
      );
      return { outcome, status: rows[0]?.status ?? '' };
    }),
  );
}

describe.each(COUNTRIES)('US-049 RC-5 — preuve d’un statut terminal ($country, $currency)', (c) => {
  const v = CAPTURES[c.currency];
  if (v === undefined) throw new Error(`aucun vecteur en ${c.currency}`);
  const capture = { amountMinor: v.totalMinor, legs: { ...v.legsMinor } as Legs };

  async function world(): Promise<World> {
    return withRole('app_worker', (client) =>
      payTx(client, { worker: 'payment_command', commit: true }, async (tx) => {
        const accountA = await insertAccount(tx, { country: c.country });
        const accountB = await insertAccount(tx, { country: c.country });
        const trip = await insertTrip(tx, c);
        const op1Idem = `${trip}:1:v1:CAPTURE:card:i1:a1`;
        const op2Idem = `${trip}:1:v1:CAPTURE:card:i2:a1`;
        const { operation_id: op1 } = await recordOperation(tx, {
          tripId: trip,
          accountId: accountA,
          currency: c.currency,
          idemPlain: op1Idem,
          ...capture,
        });
        const { operation_id: op2 } = await recordOperation(tx, {
          tripId: trip,
          accountId: accountA,
          currency: c.currency,
          idemPlain: op2Idem,
          attemptNo: 2,
          ...capture,
        });
        const op1Ref = `ref-${uuid()}`;
        expect(await applyStatus(tx, op1, 'SUBMITTED', 'API_RESPONSE', op1Ref)).toBe('APPLIED');
        return { accountA, accountB, op1, op1Idem, op1Ref, op2, op2Idem };
      }),
    );
  }

  it('refus de chaque webhook mal rattaché : autre opération, autre statut, autre compte, signature invalide', async () => {
    const w = await world();
    const cases: [string, Promise<{ inboxId: string | null }>][] = [
      [
        'autre opération',
        receive(w.accountA, [
          { providerReference: `ref-${uuid()}`, merchantReference: w.op2Idem, status: 'SUCCEEDED' },
        ]),
      ],
      [
        'autre statut (FAILED ne prouve pas SUCCEEDED)',
        receive(w.accountA, [
          { providerReference: w.op1Ref, merchantReference: w.op1Idem, status: 'FAILED' },
        ]),
      ],
      [
        'autre compte PSP',
        receive(w.accountB, [
          { providerReference: w.op1Ref, merchantReference: w.op1Idem, status: 'SUCCEEDED' },
        ]),
      ],
      [
        'signature invalide',
        receive(
          w.accountA,
          [{ providerReference: w.op1Ref, merchantReference: w.op1Idem, status: 'SUCCEEDED' }],
          { signatureValid: false },
        ),
      ],
    ];
    for (const [label, received] of cases) {
      const { inboxId } = await received;
      expect(inboxId, label).not.toBeNull();
      expect(await tryApply(w.op1, 'SUCCEEDED', 'WEBHOOK', inboxId), label).toEqual({
        outcome: 'UNPROVEN',
        status: 'SUBMITTED',
      });
    }
  });

  it('quarantaine d’horodatage : refusée, même après réécriture du motif par le travailleur ; l’indicateur est non effaçable', async () => {
    const w = await world();
    const { outcome, inboxId } = await receive(
      w.accountA,
      [{ providerReference: w.op1Ref, merchantReference: w.op1Idem, status: 'SUCCEEDED' }],
      { signedAt: '2001-01-01T00:00:00Z' },
    );
    expect(outcome).toBe('QUARANTINED');
    expect(await tryApply(w.op1, 'SUCCEEDED', 'WEBHOOK', inboxId)).toEqual({
      outcome: 'UNPROVEN',
      status: 'SUBMITTED',
    });
    await withRole('app_worker', (client) =>
      payTx(client, { worker: 'webhook_ingest' }, async (tx) => {
        // blanchiment : le travailleur réécrit le motif comme une relance « opération introuvable »,
        // puis remet la ligne en RECEIVED ; la preuve reste refusée
        await tx.query(
          `UPDATE core.payment_webhook_inbox
              SET error = 'OPERATION_NOT_FOUND', processing_status = 'RECEIVED' WHERE id = $1`,
          [inboxId],
        );
        expect(await applyStatus(tx, w.op1, 'SUCCEEDED', 'WEBHOOK', null, inboxId)).toBe(
          'UNPROVEN',
        );
        // l'indicateur n'est accordé à aucun rôle applicatif en écriture
        const err = await caught(tx, () =>
          tx.query(
            `UPDATE core.payment_webhook_inbox SET signed_at_out_of_tolerance = false WHERE id = $1`,
            [inboxId],
          ),
        );
        expect(err).toMatchObject({ code: '42501' });
      }),
    );
  });

  it('rejeu sur une seconde opération refusé ; rattachement par notre clé ou par la référence PSP accepté', async () => {
    const w = await world();
    const byRef = await receive(w.accountA, [
      { providerReference: w.op1Ref, merchantReference: null, status: 'SUCCEEDED' },
    ]);
    expect(byRef.outcome).toBe('RECEIVED');
    // rattachement par providerReference seul (aucune clé marchande)
    expect(await tryApply(w.op1, 'SUCCEEDED', 'WEBHOOK', byRef.inboxId)).toEqual({
      outcome: 'APPLIED',
      status: 'SUCCEEDED',
    });
    // le même webhook ne prouve rien pour une autre opération
    expect(await tryApply(w.op2, 'SUCCEEDED', 'WEBHOOK', byRef.inboxId)).toEqual({
      outcome: 'UNPROVEN',
      status: 'PENDING',
    });
    // rattachement par notre clé (merchantReference = idem_sent)
    const byKey = await receive(w.accountA, [
      { providerReference: `ref-${uuid()}`, merchantReference: w.op2Idem, status: 'SUCCEEDED' },
    ]);
    expect(await tryApply(w.op2, 'SUCCEEDED', 'WEBHOOK', byKey.inboxId)).toEqual({
      outcome: 'APPLIED',
      status: 'SUCCEEDED',
    });
  });

  it('ligne de boîte de réception écrite à la main par webhook_ingest : jamais une preuve, et jamais « reçue par la commande »', async () => {
    const w = await world();
    await withRole('app_worker', (client) =>
      payTx(client, { worker: 'webhook_ingest' }, async (tx) => {
        const forged = uuid();
        const events = JSON.stringify([
          {
            type: 'payment.status',
            providerReference: w.op1Ref,
            merchantReference: w.op1Idem,
            status: 'SUCCEEDED',
          },
        ]);
        await tx.query(
          `INSERT INTO core.payment_webhook_inbox (id, provider, psp_account_id, provider_event_id,
                                                   dedup_key, signature_valid, processing_status,
                                                   normalized_events)
           VALUES ($1, 'FAKE', $2, $3, $4, true, 'RECEIVED', $5::jsonb)`,
          [forged, w.accountA, `evt-${uuid()}`, randomBytes(32), events],
        );
        expect(await applyStatus(tx, w.op1, 'SUCCEEDED', 'WEBHOOK', null, forged)).toBe('UNPROVEN');
        const err = await caught(tx, () =>
          tx.query(
            `INSERT INTO core.payment_webhook_inbox (id, provider, psp_account_id, provider_event_id,
                                                     dedup_key, signature_valid, processing_status,
                                                     normalized_events, received_by_command)
             VALUES ($1, 'FAKE', $2, $3, $4, true, 'RECEIVED', $5::jsonb, true)`,
            [uuid(), w.accountA, `evt-${uuid()}`, randomBytes(32), events],
          ),
        );
        expect(err).toMatchObject({ code: '42501' });
      }),
    );
  });

  it('MANUAL_OPS terminal refusé ; voie directe refusée ; POLL accepté sans preuve (CARACTÉRISATION, ADR-088)', async () => {
    const w = await world();
    for (const status of ['SUCCEEDED', 'FAILED']) {
      expect(await tryApply(w.op1, status, 'MANUAL_OPS', null), status).toEqual({
        outcome: 'UNPROVEN',
        status: 'SUBMITTED',
      });
    }
    await withRole('app_worker', (client) =>
      payTx(client, { worker: 'webhook_ingest' }, async (tx) => {
        const err = await caught(tx, () =>
          tx.query(
            `UPDATE core.payment_payment_operation
                SET status = 'SUCCEEDED', proof_type = 'WEBHOOK_SIGNED' WHERE id = $1`,
            [w.op1],
          ),
        );
        expect(err).toMatchObject({ code: '42501' });
      }),
    );
    // LIMITE CONNUE (RC-5 partiellement corrigée, POLL et API_RESPONSE : aucune réponse PSP
    // vérifiable au lot 0) : le jour où ce test devient rouge, la limite est fermée
    expect(await tryApply(w.op1, 'SUCCEEDED', 'POLL', null)).toEqual({
      outcome: 'APPLIED',
      status: 'SUCCEEDED',
    });
  });
});
