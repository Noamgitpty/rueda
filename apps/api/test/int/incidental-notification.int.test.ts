/**
 * US-706 — avis au voyageur d'un frais annexe PRODUIT, pas seulement routé en mémoire (revue argent
 * n° 2 ; modèle : US-312 variante 6a). Sur PostgreSQL réel, sous les rôles de PRODUCTION
 * (`connectAs` : assertion L0-05), dans chaque pays configuré (USD, PYG sans décimale).
 *
 * La demande passe par la VRAIE commande (`core.claim_cmd_submit_incidental`, 0177) sous app_api ;
 * la ligne d'outbox qu'elle écrit passe par le vrai répartiteur de NTF (`dispatchEvent`, parties
 * lues en base par l'adaptateur d'AVL) sous `ntf_dispatcher` ; les envois planifiés de CET
 * événement sont relus sous `ntf_sender`. Attendus tirés de 19 US-706 (« notifié à J0 »), de 16
 * CLM-021 (`EVT_INVOICE_TO_GUEST`, au voyageur) et de 17 §4.5 (`invoice.status_changed`), jamais du
 * code testé. Trip et demande VALIDÉS (année virtuelle 2096, libre) ; envois relus dans une
 * transaction ANNULÉE ; aucun paramètre ni interrupteur écrit.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { DomainEvent, JsonObject } from '../../src/modules/bus/index.js';
import { postgresNotificationParties } from '../../src/modules/avl/index.js';
import { dispatchEvent, RULES } from '../../src/modules/ntf/index.js';
import { countryCases } from '../support/countries.js';
import { asWorker, inTx, open, openSession, sqlOf } from '../support/redteam-l2.js';

const START = '2096-05-04T08:00:00.000Z';
const END = '2096-05-07T08:00:00.000Z';
/** Demande notifiée deux heures après le retour ; échéance = + `invoice_guest_response_h` (72 h). */
const J0 = '2096-05-07T10:00:00.000Z';
const DUE = '2096-05-10T10:00:00.000Z';

describe.each(countryCases())('US-706 — avis au voyageur produit ($country, $currency)', (c) => {
  it('demande de l’hôte (nettoyage, photo de l’intérieur au retour) ⇒ une ligne invoice.status_changed AWAITING_GUEST ⇒ envois planifiés au seul voyageur du trip, gabarit EVT_INVOICE_TO_GUEST ; jamais à l’hôte', async () => {
    const api = await open('app_api');
    const s = await inTx(api, { at: START, commit: true }, async (tx) => {
      const trip = randomUUID();
      const guest = randomUUID();
      await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, 'UTC', $7, $8)`, [
        trip,
        guest,
        randomUUID(),
        randomUUID(),
        c.country,
        c.currency,
        START,
        END,
      ]);
      await tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [END]);
      const inner = (
        await tx.query<{ id: string }>(
          `SELECT test_fixture.us706_photo($1, 'CHECKOUT', 'INT_01', 'HOST')::text AS id`,
          [trip],
        )
      ).rows[0]!.id;
      await tx.query('SELECT test_fixture.us309_returned($1)', [trip]);
      const holder = (
        await tx.query<{ h: string }>('SELECT test_fixture.us309_holder($1)::text AS h', [trip])
      ).rows[0]!.h;
      await tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [J0]);
      const hash = await openSession(tx, holder);
      const r = (
        await tx.query<{ outcome: string; invoice_id: string; response_due_at: Date }>(
          `SELECT outcome, invoice_id::text AS invoice_id, response_due_at
             FROM core.claim_cmd_submit_incidental($1, $2::uuid, $3::uuid, 'CLEANING', $4::bigint,
                                                   $5, $6::uuid[])`,
          [hash, trip, randomUUID(), c.amountMinor, 'Banquette arrière couverte de sable', [inner]],
        )
      ).rows[0]!;
      expect(r.outcome).toBe('SUBMITTED');
      expect(r.response_due_at.toISOString()).toBe(DUE);
      return { trip, guest, holder, invoice: r.invoice_id };
    });

    const worker = await open('app_worker');
    const sent = await inTx(worker, { at: J0, worker: 'outbox_relay' }, async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        type: string;
        schema_version: number;
        aggregate_type: string;
        aggregate_id: string;
        aggregate_version: string;
        country_code: string | null;
        actor_user_id: string | null;
        actor_role: string;
        correlation_id: string;
        causation_id: string | null;
        payload: JsonObject;
        partition_key: string | null;
        occurred_at: Date;
      }>(
        `SELECT id::text, type, schema_version, aggregate_type, aggregate_id::text,
                aggregate_version::text, country_code, actor_user_id::text, actor_role,
                correlation_id::text, causation_id::text, payload, partition_key, occurred_at
           FROM core.outbox_outbox_event
          WHERE aggregate_id = $1::uuid AND type = 'invoice.status_changed'`,
        [s.invoice],
      );
      expect(rows).toHaveLength(1);
      const r = rows[0]!;
      expect(r).toMatchObject({
        aggregate_type: 'incidental_invoice',
        country_code: c.country,
        actor_user_id: s.holder,
        actor_role: 'HOST',
        partition_key: s.trip,
      });
      expect(r.payload).toEqual({
        invoice_id: s.invoice,
        trip_id: s.trip,
        status: 'AWAITING_GUEST',
        fee_type: 'CLEANING',
        amount_minor: c.amountMinor,
        currency: c.currency,
        response_due_at: DUE,
      });
      const event: DomainEvent = {
        eventId: r.id,
        type: r.type,
        schemaVersion: r.schema_version,
        aggregateType: r.aggregate_type,
        aggregateId: r.aggregate_id,
        aggregateVersion: BigInt(r.aggregate_version),
        countryCode: r.country_code,
        actor:
          r.actor_user_id === null ? 'SYSTEM' : { userId: r.actor_user_id, role: r.actor_role },
        correlationId: r.correlation_id,
        causationId: r.causation_id,
        payload: r.payload,
        partitionKey: r.partition_key,
        occurredAt: r.occurred_at.toISOString(),
      };
      await asWorker(tx, 'ntf_dispatcher');
      await dispatchEvent(event, sqlOf(tx), RULES, postgresNotificationParties);
      await asWorker(tx, 'ntf_sender');
      return (
        await tx.query<{ role: string; uid: string; template: string }>(
          `SELECT DISTINCT recipient_role AS role, recipient_user_id::text AS uid,
                  template_key AS template
             FROM core.ntf_notification_dispatch WHERE event_id = $1::uuid
            ORDER BY 1, 2, 3`,
          [r.id],
        )
      ).rows;
    });
    expect(sent).toEqual([{ role: 'GUEST', uid: s.guest, template: 'EVT_INVOICE_TO_GUEST' }]);
  });
});
