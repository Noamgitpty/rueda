/**
 * US-019 (correctifs, migrations 0029 et 0129) — détecteur `core.payment_text_has_pan` et contrainte
 * `webhook_inbox_no_pan`, sous les rôles de PRODUCTION (assertion L0-05 par withRole / connectAs) :
 * - table partagée avec l'API (`test/support/pan-vectors.json`) : 41 PAN de test publics (Visa,
 *   Mastercard, Amex, Diners, Discover, JCB, UnionPay, Mir ; tout groupage, zéros de tête ; bords
 *   des empreintes de 0129) refusés, 20 non-PAN (UUID, `evt-<uuid>`, empreintes hex(sha256), Luhn
 *   invalide, 12 ou 20 chiffres, préfixes 1 et 9, limite d'ADR-155) acceptés ;
 * - 0129 / ADR-155 : 20 000 clés d'idempotence réduites (hex(sha256), 08 E4) acceptées, le mutant
 *   0029 en refuse ; webhook de preuve PA (USD) et PY (PYG) qui porte l'empreinte en
 *   `merchantReference` accepté, un PAN voisin refusé (23514) ;
 * - 10 000 `evt-<uuid>` générés à graine fixe : acceptés ;
 * - complexité linéaire : 64 ko de groupes d'un chiffre sous `statement_timeout` (la version
 *   cubique de la première 0029 n'aboutit pas) ;
 * - mutation : la définition de 0028 refuse la reproduction fixe et une partie du corpus ;
 * - contrainte : un `evt-<uuid>` hier refusé est accepté, un PAN reste refusé (23514).
 */
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { connectAs, releaseClient, withRole } from '../../src/testing/index.ts';
import { inTx } from '../support/avl.ts';
import { caught } from '../support/pay.ts';
import {
  EVT_FALSE_POSITIVE,
  HEX_FALSE_POSITIVE,
  NOT_PANS,
  PANS,
  VISA_TEST,
  containsPan0028,
  evtCorpus,
  reducedKeyCorpus,
} from '../support/pan.ts';

async function hasPan(tx: pg.ClientBase, texts: readonly string[]): Promise<Map<string, boolean>> {
  const { rows } = await tx.query<{ t: string; pan: boolean }>(
    `SELECT t, core.payment_text_has_pan(t) AS pan FROM unnest($1::text[]) AS t`,
    [texts],
  );
  return new Map(rows.map((r) => [r.t, r.pan]));
}

describe('US-019 / 0029 — détecteur de PAN sans faux positif sur les UUID', () => {
  it('vecteurs : PAN de test refusés, identifiants et non-PAN acceptés', async () => {
    await withRole('app_worker', async (client) => {
      const got = await hasPan(
        client,
        [...PANS, ...NOT_PANS].map((v) => v.text),
      );
      for (const v of PANS) expect(got.get(v.text), v.note).toBe(true);
      for (const v of NOT_PANS) expect(got.get(v.text), v.note).toBe(false);
    });
  });

  it('complexité linéaire : 64 ko de groupes d’un chiffre aboutissent sous statement_timeout', async () => {
    await withRole('app_worker', async (client) => {
      await client.query('BEGIN');
      try {
        await client.query(`SET LOCAL statement_timeout = '30s'`);
        for (const digit of ['1', '0']) {
          const t0 = performance.now();
          const { rows } = await client.query<{ pan: boolean }>(
            'SELECT core.payment_text_has_pan(repeat($1, 32768)) AS pan',
            [`${digit} `],
          );
          console.log(
            `[US-019 PAN] base, 64 ko de « ${digit} » : ${(performance.now() - t0).toFixed(0)} ms (informatif)`,
          );
          expect(rows[0]?.pan).toBe(false); // aucune fenêtre ne passe : parcours complet
        }
      } finally {
        await client.query('ROLLBACK');
      }
    });
  });

  it('10 000 evt-<uuid> à graine fixe : aucun PAN ; le mutant 0028 en refuse', async () => {
    const corpus = evtCorpus(10_000);
    expect(new Set(corpus).size).toBe(10_000);
    // mutation : la définition de 0028 est tuée par la reproduction fixe et par le corpus
    expect(containsPan0028(EVT_FALSE_POSITIVE)).toBe(true);
    const killed = corpus.filter((t) => containsPan0028(t)).length;
    expect(killed).toBeGreaterThan(0);
    await withRole('app_worker', async (client) => {
      const got = await hasPan(client, corpus);
      expect([...got].filter(([, pan]) => pan).map(([t]) => t)).toEqual([]);
      console.log(
        `[US-019 PAN] 10 000 evt-<uuid> : 0 refus (la définition 0028 en refusait ${killed})`,
      );
    });
  });

  it('contrainte webhook_inbox_no_pan : evt-<uuid> reproduit accepté, PAN refusé', async () => {
    const worker = await connectAs('app_worker');
    try {
      await inTx(worker, { worker: 'webhook_ingest' }, async (tx) => {
        const insert = (eventId: string): Promise<unknown> =>
          tx.query(
            `INSERT INTO core.payment_webhook_inbox (id, provider, psp_account_id, provider_event_id,
                                                     dedup_key, signature_valid, processing_status)
             VALUES ($1, 'FAKE', NULL, $2, convert_to($2, 'UTF8'), true, 'PROCESSED')`,
            [randomUUID(), eventId],
          );
        expect(await caught(tx, () => insert(EVT_FALSE_POSITIVE))).toBeNull();
        expect(await caught(tx, () => insert(`evt-${VISA_TEST}`))).toMatchObject({
          code: '23514',
          constraint: 'webhook_inbox_no_pan',
        });
        expect(await caught(tx, () => insert('evt-4111-1111-1111-1111'))).toMatchObject({
          code: '23514',
          constraint: 'webhook_inbox_no_pan',
        });
      });
    } finally {
      await releaseClient(worker);
    }
  });

  it('0129 / ADR-155 : 20 000 clés réduites hex(sha256) acceptées ; le mutant 0029 en refuse', async () => {
    const corpus = reducedKeyCorpus(20_000);
    expect(new Set(corpus).size).toBe(20_000);
    expect(corpus.every((k) => /^[0-9a-f]{64}$/.test(k))).toBe(true);
    await withRole('app_worker', async (client) => {
      const got = await hasPan(client, corpus);
      expect([...got].filter(([, pan]) => pan).map(([t]) => t)).toEqual([]);
      // mutant « définition de 0029 » : une lettre collée (sans chiffre) retire l'exclusion
      const glued = await hasPan(
        client,
        corpus.map((k) => `g${k}`),
      );
      const killed = [...glued].filter(([, pan]) => pan).length;
      expect(killed).toBeGreaterThan(20); // environ 0,32 % attendu
      expect(glued.get(`g${HEX_FALSE_POSITIVE}`)).toBe(true);
      console.log(`[US-019 PAN] base, 20 000 clés réduites : 0 refus (0029 en refusait ${killed})`);
    });
  });

  it.each([
    { country: 'PA', currency: 'USD', amountMinor: '12550' },
    { country: 'PY', currency: 'PYG', amountMinor: '1250000' },
  ])(
    '0129 / ADR-155, $country : preuve avec l’empreinte en merchantReference acceptée, PAN voisin refusé',
    async ({ currency, amountMinor }) => {
      const worker = await connectAs('app_worker');
      try {
        await inTx(worker, { worker: 'webhook_ingest' }, async (tx) => {
          const insert = (eventId: string, events: unknown[]): Promise<unknown> =>
            tx.query(
              `INSERT INTO core.payment_webhook_inbox (id, provider, psp_account_id, provider_event_id,
                                                       dedup_key, signature_valid, processing_status,
                                                       normalized_events)
               VALUES ($1, 'FAKE', NULL, $2, convert_to($2, 'UTF8'), true, 'PROCESSED', $3::jsonb)`,
              [randomUUID(), eventId, JSON.stringify(events)],
            );
          const event = {
            type: 'REFUND',
            status: 'SUCCEEDED',
            merchantReference: HEX_FALSE_POSITIVE,
            currency,
            amountMinor,
          };
          // refusé par 0029 (23514), accepté par 0129 ; identifiant d'événement = empreinte aussi
          expect(await caught(tx, () => insert(`evt-${randomUUID()}`, [event]))).toBeNull();
          expect(await caught(tx, () => insert(HEX_FALSE_POSITIVE, [event]))).toBeNull();
          for (const leak of [
            { ...event, card: VISA_TEST },
            { ...event, merchantReference: `${HEX_FALSE_POSITIVE} 4111 1111 1111 1111` },
            { ...event, merchantReference: `g${HEX_FALSE_POSITIVE}` },
            { ...event, merchantReference: HEX_FALSE_POSITIVE.toUpperCase() },
          ]) {
            expect(await caught(tx, () => insert(`evt-${randomUUID()}`, [leak]))).toMatchObject({
              code: '23514',
              constraint: 'webhook_inbox_no_pan',
            });
          }
        });
      } finally {
        await releaseClient(worker);
      }
    },
  );
});
