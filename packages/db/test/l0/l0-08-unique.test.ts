/**
 * L0-08 — 17 §11 point 8 : `UNIQUE NULLS NOT DISTINCT` et index partiels (US-006).
 *
 * Attendu (17 §11, tableau L0) : `23505` dans chaque cas, traduit en code métier sans `DETAIL` :
 * - doublon de `webhook_inbox` à clé partiellement nulle (`psp_account_id` nul, 17 §4.4 point 3 ;
 *   corrigé VERIF_14-F23) → `WEBHOOK_DUPLICATE` (réponse 200 sans traitement) ;
 * - deux holds vivants même guest / véhicule (`one_live_hold_per_guest_vehicle`) → `HOLD_ALREADY_LIVE` ;
 * - deux dispositions `CONVERSION` sur un hold (`one_conversion_per_hold`, N2) → `DUPLICATE_PAYMENT` ;
 *   et une seconde disposition pour la même opération (clé primaire, XOR) → `DISPOSITION_EXISTS`.
 * Rôles (17 §11) : `app_worker` (webhooks) ; `app_api` pour la pose (fixture qui tient lieu de
 * cmd_place_hold, US-023). Le 4ᵉ cas de 17 (deux `payment_operation_leg` de même jambe) arrive
 * avec la table des jambes (US-019 / US-023).
 */
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { translateDbError } from '../../src/index.ts';
import { connectAs, releaseClient, withRole } from '../../src/testing/index.ts';
import {
  at,
  bookTrip,
  COUNTRIES,
  expireDueHolds,
  inTx,
  insertRentOperation,
  newSlot,
  placeHold,
  receiveProof,
  uuid,
} from '../support/avl.ts';

const T0 = '2031-07-01T08:00:00.000Z';
const START = '2031-07-05T08:00:00.000Z';
const END = '2031-07-06T08:00:00.000Z';

/** Capture l'erreur d'une promesse (ou undefined). */
const failure = (p: Promise<unknown>): Promise<unknown> =>
  p.then(
    () => undefined,
    (e: unknown) => e,
  );

/** 23505 sur `constraint`, DETAIL présent dans l'erreur brute, absent de la traduction. */
function expectTranslatedUnique(error: unknown, constraint: string, code: string): void {
  expect(error).toMatchObject({ code: '23505', constraint });
  expect((error as { detail?: string }).detail).toEqual(expect.any(String));
  const translated = translateDbError(error);
  expect(translated).toEqual({ code, retryable: false });
  const serialized = JSON.stringify(translated);
  expect(serialized).not.toContain((error as { detail: string }).detail);
  expect(serialized).not.toMatch(/Key|\(|=/);
}

const inbox = (tx: pg.ClientBase, provider: string, account: string | null, dedup: string) =>
  tx.query(
    `INSERT INTO core.payment_webhook_inbox (id, provider, psp_account_id, dedup_key, signature_valid)
     VALUES ($1, $2, $3, convert_to($4, 'UTF8'), true)`,
    [uuid(), provider, account, dedup],
  );

describe('L0-08 — webhook_inbox : UNIQUE NULLS NOT DISTINCT', () => {
  it('index webhook_inbox_dedup déclaré NULLS NOT DISTINCT sur (provider, psp_account_id, dedup_key)', async () => {
    await withRole('app_worker', async (client) => {
      const { rows } = await client.query<{ nnd: boolean; cols: string }>(
        `SELECT i.indnullsnotdistinct AS nnd,
                pg_catalog.pg_get_indexdef(i.indexrelid) AS cols
           FROM pg_catalog.pg_index i
          WHERE i.indexrelid = 'core.webhook_inbox_dedup'::regclass`,
      );
      expect(rows[0]?.nnd).toBe(true);
      expect(rows[0]?.cols).toMatch(/\(provider, psp_account_id, dedup_key\) NULLS NOT DISTINCT/);
    });
  });

  it('doublon à psp_account_id nul : 23505 → WEBHOOK_DUPLICATE, sans DETAIL', async () => {
    await withRole('app_worker', async (client) => {
      const dedup = `evt-${uuid()}`;
      await inTx(client, { worker: 'webhook_ingest', commit: true }, (tx) =>
        inbox(tx, 'FAKE', null, dedup),
      );
      const error = await failure(
        inTx(client, { worker: 'webhook_ingest', commit: true }, (tx) =>
          inbox(tx, 'FAKE', null, dedup),
        ),
      );
      expectTranslatedUnique(error, 'webhook_inbox_dedup', 'WEBHOOK_DUPLICATE');
    });
  });

  it('doublon à psp_account_id renseigné : 23505 ; clé, compte ou fournisseur différents : acceptés', async () => {
    await withRole('app_worker', async (client) => {
      const dedup = `evt-${uuid()}`;
      const account = uuid();
      await inTx(client, { worker: 'webhook_ingest', commit: true }, async (tx) => {
        await inbox(tx, 'FAKE', account, dedup);
        await inbox(tx, 'FAKE', null, dedup); // compte nul ≠ compte renseigné
        await inbox(tx, 'FAKE', uuid(), dedup); // autre compte
        await inbox(tx, 'FAKE_TWO', account, dedup); // autre fournisseur
        await inbox(tx, 'FAKE', account, `${dedup}-2`); // autre clé
      });
      const error = await failure(
        inTx(client, { worker: 'webhook_ingest', commit: true }, (tx) =>
          inbox(tx, 'FAKE', account, dedup),
        ),
      );
      expectTranslatedUnique(error, 'webhook_inbox_dedup', 'WEBHOOK_DUPLICATE');
    });
  });
});

describe.each(COUNTRIES)('L0-08 — index partiels AVL ($country, $currency)', (c) => {
  it('deux holds vivants même guest / véhicule : 23505 → HOLD_ALREADY_LIVE ; accepté après expiration', async () => {
    const api = await connectAs('app_api');
    try {
      const slot = newSlot(START, END);
      const guest = uuid();
      const first = await inTx(api, { virtualNow: T0, commit: true }, (tx) =>
        placeHold(tx, slot, c, guest),
      );
      // période disjointe : seule l'unicité partielle peut refuser (pas l'exclusion GiST)
      const otherPeriod = `[${at(END, 24 * 60)},${at(END, 48 * 60)})`;
      const error = await failure(
        inTx(api, { virtualNow: at(T0, 1), commit: true }, (tx) =>
          placeHold(tx, slot, c, guest, otherPeriod),
        ),
      );
      expectTranslatedUnique(error, 'one_live_hold_per_guest_vehicle', 'HOLD_ALREADY_LIVE');

      // un autre guest, ou le même guest après l'expiration du premier hold : accepté
      await inTx(api, { virtualNow: at(T0, 1), commit: true }, (tx) =>
        placeHold(tx, slot, c, uuid(), otherPeriod),
      );
      await withRole('app_worker', (worker) =>
        inTx(worker, { worker: 'hold_expiry', virtualNow: at(T0, 11), commit: true }, (tx) =>
          expireDueHolds(tx, slot.vehicleId, first.guestId),
        ),
      );
      const thirdPeriod = `[${at(END, 72 * 60)},${at(END, 96 * 60)})`;
      await inTx(api, { virtualNow: at(T0, 12), commit: true }, (tx) =>
        placeHold(tx, slot, c, guest, thirdPeriod),
      );
    } finally {
      await releaseClient(api);
    }
  });

  it('deux dispositions CONVERSION sur un hold : 23505 → DUPLICATE_PAYMENT ; opération convertie puis compensée : DISPOSITION_EXISTS', async () => {
    const api = await connectAs('app_api');
    const worker = await connectAs('app_worker');
    try {
      const { hold, operationId, tripId } = await bookTrip(api, worker, newSlot(START, END), c, T0);
      // une seconde opération de loyer réussie sur le même hold
      const op2 = await inTx(api, { virtualNow: at(T0, 5), commit: true }, (tx) =>
        insertRentOperation(tx, hold),
      );
      await inTx(worker, { worker: 'webhook_ingest', commit: true }, (tx) => receiveProof(tx, op2));

      const second = await failure(
        inTx(worker, { worker: 'booking_conversion', commit: true }, (tx) =>
          tx.query(
            `INSERT INTO core.booking_payment_disposition (operation_id, hold_id, disposition, trip_id)
             VALUES ($1, $2, 'CONVERSION', $3)`,
            [op2, hold.holdId, tripId],
          ),
        ),
      );
      expectTranslatedUnique(second, 'one_conversion_per_hold', 'DUPLICATE_PAYMENT');

      // XOR : l'opération déjà convertie ne peut pas aussi être compensée (clé primaire)
      const sameOp = await failure(
        inTx(worker, { worker: 'booking_conversion', commit: true }, async (tx) => {
          const compensationId = uuid();
          await tx.query(
            `INSERT INTO core.booking_hold_compensation (id, hold_id, operation_id, reason, action, status)
             VALUES ($1, $2, $3, 'DUPLICATE_PAYMENT', 'REFUND_API', 'OPEN')`,
            [compensationId, hold.holdId, operationId],
          );
          await tx.query(
            `INSERT INTO core.booking_payment_disposition (operation_id, hold_id, disposition, hold_compensation_id)
             VALUES ($1, $2, 'COMPENSATION', $3)`,
            [operationId, hold.holdId, compensationId],
          );
        }),
      );
      expectTranslatedUnique(sameOp, 'payment_disposition_pkey', 'DISPOSITION_EXISTS');
    } finally {
      await releaseClient(worker);
      await releaseClient(api);
    }
  });
});
