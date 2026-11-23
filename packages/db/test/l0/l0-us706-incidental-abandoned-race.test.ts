/**
 * US-706 suite (preuves 2) — courses à deux connexions sur un frais ABANDONNÉ (migration 0184,
 * ADR-204, F-L3-FRA-03). Rôles de PRODUCTION seulement (`withRole`, assertion L0-05), au Panama
 * (USD) et au Paraguay (PYG sans décimale).
 *
 * Chaque course : le pid de la seconde session est lu AVANT son appel ; `lock_timeout` et
 * `statement_timeout` bornés ; l'attente est observée par une troisième session (`pg_locks`, puis
 * `pg_blocking_pids` : la seconde attend bien la première) ; `finally` annule toute transaction restée
 * ouverte. Attendus tirés de 08 BR-REIMB-02 (la fenêtre du voyageur ne se rouvre jamais),
 * BR-REIMB-03 (l'ops tranche une contestation), BR-REIMB-05 (doublons) et SM-5, jamais du code
 * testé : la règle du frais abandonné porte sur plusieurs lignes (groupe nettoyage + tabac, pièces),
 * elle tient par le verrou du trip que prend toute commande qui écrit une demande ; la seconde
 * session relit donc l'état validé par la première.
 *
 * Année virtuelle 2080 (libre). Données du monde VALIDÉES (trips, fichiers de l'hôte, demandes
 * contestées, sessions) ; aucun compte PSP ACTIVE ; aucun paramètre ni interrupteur écrit.
 */
import { describe, expect, it } from 'vitest';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { elevated, staff, uuid } from '../support/claims.ts';
import type { Staff } from '../support/claims.ts';
import { backendPid, waitUntilBlocked } from '../support/concurrency.ts';
import {
  amountsOf,
  at,
  attach,
  CANCEL,
  DECIDE,
  DESCRIPTION,
  DISPUTE,
  DISPUTE_REASON,
  HOUR,
  invoices,
  now,
  RATIONALE,
  session,
  SUBMIT,
  submit,
  world,
} from '../support/incidental.ts';
import type { Row, Tx, World } from '../support/incidental.ts';

/** Trip du 7 au 10 mars 2080, rendu à 08:00 ; demande à J0 10:00, contestée à J0 + 1 h. */
const START = '2080-03-07T08:00:00.000Z';
const END = '2080-03-10T08:00:00.000Z';
const J0 = '2080-03-10T10:00:00.000Z';
const RACE_AT = at(J0, 2 * HOUR);

async function begin(client: Tx, iso: string): Promise<void> {
  await client.query('BEGIN');
  await now(client, iso);
  await client.query(`SET LOCAL lock_timeout = '15s'`);
  await client.query(`SET LOCAL statement_timeout = '30s'`);
}

/** La session `pid` attend un verrou, et c'est celui que tient `holder`. */
async function blockedBy(observer: Tx, pid: number, holder: number): Promise<void> {
  await waitUntilBlocked(observer, pid, 'transactionid');
  const r = await observer.query<{ b: boolean }>(
    'SELECT $1::integer = ANY (pg_catalog.pg_blocking_pids($2::integer)) AS b',
    [holder, pid],
  );
  expect(r.rows[0]!.b).toBe(true);
}

async function rollback(...clients: Tx[]): Promise<void> {
  for (const client of clients) await client.query('ROLLBACK').catch(() => undefined);
}

interface Contested {
  readonly id: string;
  readonly w: World;
  /** Fichier de l'hôte reçu dans la fenêtre des photos : une pièce que la demande n'a pas citée. */
  readonly file: string;
}

interface Setup {
  readonly ops: Staff;
  /** Nettoyages contestés : annulé pendant un tabac, rejeté pendant un tabac. */
  readonly cancelled: Contested;
  readonly rejected: Contested;
}

async function setup(c: CountryCase): Promise<Setup> {
  const a = amountsOf(c);
  return withRole('app_api', (api) =>
    withTestTransaction(api, { virtualNow: START, commit: true }, async (tx) => {
      const ops = await staff(tx, 'OPS_AGENT', [c.country]);
      const out: Contested[] = [];
      for (let n = 0; n < 2; n += 1) {
        const w = await world(tx, c, { start: START, end: END });
        await now(tx, J0);
        const file = await attach(tx, w.holder, w.trip);
        expect(file.r).toBe('ATTACHED');
        const r = await submit(
          tx,
          await session(tx, w.holder),
          w.trip,
          'CLEANING',
          a['cleaning']!,
          [w.inner],
        );
        expect(r['outcome']).toBe('SUBMITTED');
        out.push({ id: String(r['invoice_id']), w, file: file.id });
      }
      await now(tx, at(J0, HOUR));
      for (const x of out) {
        expect(
          (
            await tx.query<{ r: string }>(DISPUTE, [
              await session(tx, x.w.guest),
              x.id,
              DISPUTE_REASON,
              [x.w.guestInner],
            ])
          ).rows[0]!.r,
        ).toBe('DISPUTED');
      }
      const [cancelled, rejected] = out as [Contested, Contested];
      return { ops, cancelled, rejected };
    }),
  );
}

describe.each(COUNTRIES)(
  'US-706 suite — courses sur un frais abandonné ($country, $currency)',
  (c) => {
    it('F-L3-FRA-03 : l’hôte annule un nettoyage contesté (ou l’ops le rejette) pendant qu’il demande un tabac avec une autre pièce (deux sessions) ⇒ le tabac attend puis est refusé (INCIDENTAL_DUPLICATE), aucune fenêtre neuve', async () => {
      const s = await setup(c);
      const a = amountsOf(c);
      const smoking = async (client: Tx, x: Contested) =>
        client.query<Row>(SUBMIT, [
          await session(client, x.w.holder),
          x.w.trip,
          uuid(),
          'SMOKING',
          a['cleaning']!.toString(),
          DESCRIPTION,
          [x.file],
        ]);
      await withRole('app_worker', (observer) =>
        withRole('app_api', (first) =>
          withRole('app_api', async (second) => {
            // (1) annulation de la demande contestée (verrou du trip) contre tabac de l'hôte
            try {
              await begin(first, RACE_AT);
              const h = await session(first, s.cancelled.w.holder);
              expect(
                (await first.query<{ r: string }>(CANCEL, [h, s.cancelled.id])).rows[0]!.r,
              ).toBe('CANCELLED');
              const holder = await backendPid(first);
              const pid = await backendPid(second);
              await begin(second, RACE_AT);
              const pending = smoking(second, s.cancelled);
              // attente en échec : la promesse est toujours traitée (aucun rejet orphelin)
              void pending.catch(() => undefined);
              await blockedBy(observer, pid, holder);
              await first.query('COMMIT');
              expect((await pending).rows[0]!['outcome']).toBe('INCIDENTAL_DUPLICATE');
              await second.query('COMMIT');
            } finally {
              await rollback(first, second);
            }
            // (2) rejet de l'ops (verrou du trip) contre tabac de l'hôte
            try {
              await begin(first, RACE_AT);
              const e = await elevated(first, s.ops);
              expect(
                (await first.query<Row>(DECIDE, [e, uuid(), s.rejected.id, 'REJECT', RATIONALE]))
                  .rows[0]!['outcome'],
              ).toBe('DECIDED');
              const holder = await backendPid(first);
              const pid = await backendPid(second);
              await begin(second, RACE_AT);
              const pending = smoking(second, s.rejected);
              void pending.catch(() => undefined);
              await blockedBy(observer, pid, holder);
              await first.query('COMMIT');
              expect((await pending).rows[0]!['outcome']).toBe('INCIDENTAL_DUPLICATE');
              await second.query('COMMIT');
            } finally {
              await rollback(first, second);
            }
            // état final relu : une seule demande par trip, aucune en attente du voyageur
            const rows = async (x: Contested) =>
              (await invoices(observer, x.w.trip)).map((r) => [r['fee_type'], r['status']]);
            expect(await rows(s.cancelled)).toEqual([['CLEANING', 'CANCELLED_BY_HOST']]);
            expect(await rows(s.rejected)).toEqual([['CLEANING', 'REJECTED']]);
          }),
        ),
      );
    }, 120_000);
  },
);
