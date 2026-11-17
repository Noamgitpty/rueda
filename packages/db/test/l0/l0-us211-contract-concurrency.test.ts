/**
 * US-211 partie 211b — concurrence du contrat de location (migration 0122, ADR-143 n° 4 et 7 ;
 * suite 4 de la passation de 211a, revue qa de #195 n° 8). Deux sessions PostgreSQL réelles, sous
 * les rôles de production (`connectAs` : assertion L0-05 en tête), au Panama (USD) et au Paraguay
 * (PYG sans décimale) ; données validées (chaque session voit l'écriture de l'autre).
 *
 * 1. Deux signatures simultanées du même document : la seconde attend le verrou du contrat du
 *    trip (`contract:<trip>`), puis rend la signature d'origine (`ALREADY_SIGNED`) ; une seule
 *    ligne de signature, un seul événement `contract.document.signed`.
 * 2. Signature pendant une régénération : la génération d'une version tient le MÊME verrou du
 *    trip que `core.booking_cmd_record_contract` (0122, « une génération à la fois par trip ») ;
 *    la signature de l'ancienne version attend, puis est refusée (`CONTRACT_SUPERSEDED`) : jamais
 *    une signature sur une version remplacée. La version est écrite par la fixture 9963 sous ce
 *    verrou (la commande réelle exige les faits relus d'un devis figé : partie A d'
 *    `l0-us211-rental-contract.test.ts`).
 * Attendus : ADR-143 n° 7 (dernière version seulement, rejeu = signature d'origine), 16 BKG-019 ;
 * jamais le code testé. Aucun interrupteur de mise en service n'est ouvert.
 */
import { createHash } from 'node:crypto';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { connectAs, releaseClient } from '../../src/testing/index.ts';
import { at, bookTrip, COUNTRIES, inTx, newSlot } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { checkoutPerson } from '../support/checkout.ts';
import { backendPid, waitUntilBlocked } from '../support/concurrency.ts';

type Json = Record<string, unknown>;

const SIGN = 'SELECT * FROM core.booking_cmd_sign_contract($1, $2::uuid, $3::uuid, $4::bytea)';
const DOCUMENT = 'SELECT * FROM test_fixture.us211_document($1, $2, $3)';
/** Verrou du contrat d'un trip, le même que 0122 (génération et signature). */
const CONTRACT_LOCK =
  "SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('contract:' || $1, 0))";

const sha = (s: string): Buffer => createHash('sha256').update(s, 'utf8').digest();

async function begin(client: pg.ClientBase, virtualNow: string): Promise<void> {
  await client.query('BEGIN');
  await client.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [virtualNow]);
}

describe.each(COUNTRIES)(
  'US-211 partie 211b — concurrence du contrat ($country)',
  (c: CountryCase) => {
    it('deux signatures simultanées ⇒ une seule signature ; signature pendant une régénération ⇒ CONTRACT_SUPERSEDED', async () => {
      const a = await connectAs('app_api');
      const b = await connectAs('app_api');
      const worker = await connectAs('app_worker');
      try {
        const T1 = c.country === 'PA' ? '2053-03-01T12:00:00.000Z' : '2053-04-01T12:00:00.000Z';
        const T2 = at(T1, 60);
        const slot = newSlot(at(T1, 7 * 1440), at(T1, 10 * 1440));
        const guest = await inTx(a, { virtualNow: T1, commit: true }, (tx) =>
          checkoutPerson(tx, c.country, 'Ana', 'Pérez'),
        );
        const { tripId: trip } = await bookTrip(a, worker, slot, c, T1, guest.id);
        const doc1 = sha(`211b-doc1-${trip}`);
        const v1 = await inTx(
          a,
          { virtualNow: T1, commit: true },
          async (tx) =>
            (await tx.query<{ document_id: string }>(DOCUMENT, [trip, doc1, 'fixture:1'])).rows[0]!
              .document_id,
        );
        const signatures = () =>
          inTx(
            a,
            {},
            async (tx) =>
              (await tx.query<Json>('SELECT * FROM test_fixture.us211_signatures($1)', [trip]))
                .rows,
          );
        const signedEvents = () =>
          inTx(a, {}, async (tx) =>
            (
              await tx.query<Json>('SELECT * FROM test_fixture.us211_events($1)', [trip])
            ).rows.filter((e) => e['type'] === 'contract.document.signed'),
          );

        // 1. deux signatures simultanées du même document par le voyageur
        const bPid = await backendPid(b);
        await begin(a, T2);
        const first = (await a.query<Json>(SIGN, [guest.hash, trip, v1, doc1])).rows[0]!;
        expect(first).toMatchObject({ outcome: 'SIGNED' });
        await begin(b, T2);
        const second = b.query<Json>(SIGN, [guest.hash, trip, v1, doc1]);
        await waitUntilBlocked(worker, bPid, 'advisory');
        await a.query('COMMIT');
        const replay = (await second).rows[0]!;
        await b.query('COMMIT');
        expect(replay).toMatchObject({
          outcome: 'ALREADY_SIGNED',
          signature_id: first['signature_id'],
          seal_sha256: first['seal_sha256'],
        });
        expect((await signatures()).map((s) => s['id'])).toEqual([first['signature_id']]);
        expect(await signedEvents()).toHaveLength(1);

        // 2. une version 2 s'écrit sous le verrou du contrat ; la signature de la v2 en attente
        //    (lue avant la v3) est refusée après la régénération
        const doc2 = sha(`211b-doc2-${trip}`);
        const v2 = await inTx(
          a,
          { virtualNow: T2, commit: true },
          async (tx) =>
            (await tx.query<{ document_id: string }>(DOCUMENT, [trip, doc2, 'fixture:2'])).rows[0]!
              .document_id,
        );
        await begin(a, T2);
        await a.query(CONTRACT_LOCK, [trip]);
        const doc3 = sha(`211b-doc3-${trip}`);
        const v3 = (await a.query<{ document_id: string }>(DOCUMENT, [trip, doc3, 'fixture:3']))
          .rows[0]!.document_id;
        await begin(b, T2);
        const late = b.query<Json>(SIGN, [guest.hash, trip, v2, doc2]);
        await waitUntilBlocked(worker, bPid, 'advisory');
        await a.query('COMMIT');
        const refused = (await late).rows[0]!;
        await b.query('COMMIT');
        expect(refused).toMatchObject({ outcome: 'CONTRACT_SUPERSEDED', signature_id: null });
        // seule la v1 est signée ; la v3 reste à signer
        expect((await signatures()).map((s) => s['document_id'])).toEqual([v1]);
        const signedV3 = await inTx(
          a,
          { virtualNow: T2, commit: true },
          async (tx) => (await tx.query<Json>(SIGN, [guest.hash, trip, v3, doc3])).rows[0]!,
        );
        expect(signedV3).toMatchObject({ outcome: 'SIGNED' });
      } finally {
        await a.query('ROLLBACK').catch(() => undefined);
        await b.query('ROLLBACK').catch(() => undefined);
        await releaseClient(worker);
        await releaseClient(b);
        await releaseClient(a);
      }
    });
  },
);
