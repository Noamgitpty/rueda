/**
 * US-706 suite (preuves 2) — frais annexe ABANDONNÉ (migration 0184, ADR-204 ; constat F-L3-FRA-03
 * de la passe de la porte de la red team du lot 3) : une demande rejetée par l'ops, ou annulée par
 * l'hôte après une contestation, ne se redemande plus sous un autre type du même groupe (nettoyage
 * et tabac) ni avec une de ses pièces, quel que soit le type. Rôles de PRODUCTION seulement
 * (`withRole` : assertion L0-05 en tête de chaque test), au Panama (USD) et au Paraguay (PYG sans
 * décimale), transactions ANNULÉES. Année virtuelle 2079 (libre).
 *
 * Attendus (jamais le code testé) : 08 BR-REIMB-02 (la fenêtre du voyageur « ne peut pas être
 * rouverte »), BR-REIMB-03 (la contestation va à l'ops, qui tranche), BR-REIMB-05 (doublons
 * interdits), SM-5 (CANCELLED_BY_HOST et REJECTED finals) ; ADR-204 (groupe « intérieur » =
 * nettoyage + tabac, pièces d'un frais abandonné) ; red team `rt-l3-11-variantes` (RT-L3-S02).
 */
import { describe, expect, it } from 'vitest';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import { staff } from '../support/claims.ts';
import {
  amountsOf,
  at,
  attach,
  CANCEL,
  decide,
  DISPUTE,
  DISPUTE_REASON,
  HOUR,
  invoices,
  now,
  param,
  session,
  submit,
  world,
} from '../support/incidental.ts';
import type { Row, Tx, World } from '../support/incidental.ts';

/** Trip du 7 au 10 mars 2079, rendu à 08:00 ; demande à J0 10:00 (heure de la base). */
const START = '2079-03-07T08:00:00.000Z';
const END = '2079-03-10T08:00:00.000Z';
const J0 = '2079-03-10T10:00:00.000Z';

const one = async (tx: Tx, sql: string, args: unknown[]): Promise<unknown> =>
  (await tx.query<{ r: unknown }>(sql, args)).rows[0]!.r;

const events = async (tx: Tx, invoice: unknown): Promise<number> =>
  (await tx.query('SELECT * FROM test_fixture.us706_events($1)', [invoice])).rows.length;

const shape = async (tx: Tx, trip: string): Promise<unknown[]> =>
  (await invoices(tx, trip)).map((r) => [r['fee_type'], r['status']]);

describe.each(COUNTRIES)('US-706 suite — frais abandonné ($country, $currency)', (c) => {
  const a = amountsOf(c);

  /** Demande `fee` à J0, contestée par le voyageur à J0 + 1 h, annulée par l'hôte à J0 + 2 h. */
  async function abandoned(
    tx: Tx,
    w: World,
    fee: string,
    amount: bigint,
    evidence: readonly string[],
  ): Promise<Row> {
    await now(tx, J0);
    const r = await submit(tx, await session(tx, w.holder), w.trip, fee, amount, evidence);
    expect(r['outcome']).toBe('SUBMITTED');
    await now(tx, at(J0, HOUR));
    expect(
      await one(tx, DISPUTE, [
        await session(tx, w.guest),
        r['invoice_id'],
        DISPUTE_REASON,
        [w.guestInner],
      ]),
    ).toBe('DISPUTED');
    await now(tx, at(J0, 2 * HOUR));
    expect(await one(tx, CANCEL, [await session(tx, w.holder), r['invoice_id']])).toBe('CANCELLED');
    await now(tx, at(J0, 3 * HOUR));
    return r;
  }

  it('F-L3-FRA-03 : nettoyage contesté puis annulé ⇒ le tabac (même pièce, ou autre pièce : même groupe) et tout frais qui reprend sa pièce sont refusés (INCIDENTAL_DUPLICATE), aucune fenêtre neuve, aucun avis ; témoin : le carburant, autre groupe et autres pièces, passe', async () => {
    await withRole('app_api', async (api) => {
      await withTestTransaction(api, { virtualNow: START }, async (tx) => {
        // plafond du carburant « à fixer » (0009) : posé par le test, dans la transaction annulée
        await param(tx, 'fuel_refill_max', c.country, a['fuelCap']!.toString());
        const w = await world(tx, c, { start: START, end: END });
        await now(tx, J0);
        // fichier de l'hôte reçu dans la fenêtre des photos : une pièce distincte de la photo
        const file = await attach(tx, w.holder, w.trip);
        expect(file.r).toBe('ATTACHED');
        const first = await abandoned(tx, w, 'CLEANING', a['cleaning']!, [w.inner]);
        const h = await session(tx, w.holder);
        const attempts: readonly (readonly [string, bigint, readonly string[]])[] = [
          ['SMOKING', a['cleaning']!, [w.inner]],
          ['SMOKING', a['cleaning']!, [file.id]],
          ['SMOKING', a['cleaning']! - 1n, [w.outer, file.id]],
          ['FUEL', a['fuel']!, [w.fuelOut, w.fuelIn, w.inner]],
        ];
        for (const [fee, amount, evidence] of attempts) {
          expect(
            (await submit(tx, h, w.trip, fee, amount, evidence))['outcome'],
            `${fee} avec ${evidence.length} pièce(s)`,
          ).toBe('INCIDENTAL_DUPLICATE');
        }
        expect(await shape(tx, w.trip)).toEqual([['CLEANING', 'CANCELLED_BY_HOST']]);
        expect(await events(tx, first['invoice_id'])).toBe(1);
        // témoin : autre groupe, autres pièces ⇒ demande acceptée, avec sa propre fenêtre
        const fuel = await submit(tx, h, w.trip, 'FUEL', a['fuel']!, [w.fuelOut, w.fuelIn]);
        expect(fuel['outcome']).toBe('SUBMITTED');
        expect(await shape(tx, w.trip)).toEqual([
          ['CLEANING', 'CANCELLED_BY_HOST'],
          ['FUEL', 'AWAITING_GUEST'],
        ]);
      });
    });
  });

  it('F-L3-FRA-03 : nettoyage REJETÉ par l’ops ⇒ le tabac est refusé, même avec une autre pièce ; carburant contesté puis annulé ⇒ un nettoyage qui reprend une jauge est refusé, un nettoyage avec ses propres pièces passe', async () => {
    await withRole('app_api', async (api) => {
      await withTestTransaction(api, { virtualNow: START }, async (tx) => {
        const ops = await staff(tx, 'OPS_AGENT', [c.country]);
        // plafond du carburant « à fixer » (0009) : posé par le test, dans la transaction annulée
        await param(tx, 'fuel_refill_max', c.country, a['fuelCap']!.toString());
        const w = await world(tx, c, { start: START, end: END });
        const f = await world(tx, c, { start: START, end: END });
        await now(tx, J0);
        const file = await attach(tx, w.holder, w.trip);
        expect(file.r).toBe('ATTACHED');
        // carburant abandonné (J0 à J0 + 3 h) : la jauge ne sert plus, l'habitacle reste libre
        await abandoned(tx, f, 'FUEL', a['fuel']!, [f.fuelOut, f.fuelIn]);
        const hf = await session(tx, f.holder);
        expect(
          (await submit(tx, hf, f.trip, 'CLEANING', a['cleaning']!, [f.inner, f.fuelIn]))[
            'outcome'
          ],
        ).toBe('INCIDENTAL_DUPLICATE');
        expect(
          (await submit(tx, hf, f.trip, 'CLEANING', a['cleaning']!, [f.inner]))['outcome'],
        ).toBe('SUBMITTED');
        expect(await shape(tx, f.trip)).toEqual([
          ['FUEL', 'CANCELLED_BY_HOST'],
          ['CLEANING', 'AWAITING_GUEST'],
        ]);
        // nettoyage demandé à J0 + 3 h, contesté, rejeté par l'ops ; tabac redemandé ensuite
        const h = await session(tx, w.holder);
        const r = await submit(tx, h, w.trip, 'CLEANING', a['cleaning']!, [w.inner]);
        expect(r['outcome']).toBe('SUBMITTED');
        await now(tx, at(J0, 4 * HOUR));
        expect(
          await one(tx, DISPUTE, [
            await session(tx, w.guest),
            r['invoice_id'],
            DISPUTE_REASON,
            [w.guestInner],
          ]),
        ).toBe('DISPUTED');
        await now(tx, at(J0, 5 * HOUR));
        expect((await decide(tx, ops, String(r['invoice_id']), 'REJECT'))['outcome']).toBe(
          'DECIDED',
        );
        await now(tx, at(J0, 6 * HOUR));
        const h2 = await session(tx, w.holder);
        expect(
          (await submit(tx, h2, w.trip, 'SMOKING', a['cleaning']!, [file.id]))['outcome'],
        ).toBe('INCIDENTAL_DUPLICATE');
        expect(await shape(tx, w.trip)).toEqual([['CLEANING', 'REJECTED']]);
      });
    });
  });

  it('une pièce ne soutient qu’une demande du trip (revue argent) : nettoyage vivant puis tabac sur la même photo ⇒ INCIDENTAL_DUPLICATE, aucun second avis ; témoins : tabac avec sa propre pièce accepté, pièce libérée par une annulation AVANT contestation', async () => {
    await withRole('app_api', async (api) => {
      await withTestTransaction(api, { virtualNow: START }, async (tx) => {
        const w = await world(tx, c, { start: START, end: END });
        await now(tx, J0);
        const file = await attach(tx, w.holder, w.trip);
        expect(file.r).toBe('ATTACHED');
        const h = await session(tx, w.holder);
        const cleaning = await submit(tx, h, w.trip, 'CLEANING', a['cleaning']!, [w.inner]);
        expect(cleaning['outcome']).toBe('SUBMITTED');
        // le même fait (même pièce) facturé une seconde fois sous l'autre type : refusé
        for (const evidence of [[w.inner], [file.id, w.inner]]) {
          expect(
            (await submit(tx, h, w.trip, 'SMOKING', a['cleaning']!, evidence))['outcome'],
          ).toBe('INCIDENTAL_DUPLICATE');
        }
        expect(await shape(tx, w.trip)).toEqual([['CLEANING', 'AWAITING_GUEST']]);
        expect(await events(tx, cleaning['invoice_id'])).toBe(1);
        // témoin : le tabac avec sa propre pièce coexiste (08 BR-REIMB-01 les liste à part)
        const smoking = await submit(tx, h, w.trip, 'SMOKING', a['cleaning']!, [file.id]);
        expect(smoking['outcome']).toBe('SUBMITTED');
        // témoin : une annulation AVANT contestation libère la pièce, qui sert à nouveau
        await now(tx, at(J0, HOUR));
        expect(await one(tx, CANCEL, [await session(tx, w.holder), cleaning['invoice_id']])).toBe(
          'CANCELLED',
        );
        const again = await submit(
          tx,
          await session(tx, w.holder),
          w.trip,
          'CLEANING',
          a['cleaning']!,
          [w.inner],
        );
        expect(again['outcome']).toBe('SUBMITTED');
        expect(await shape(tx, w.trip)).toEqual([
          ['CLEANING', 'CANCELLED_BY_HOST'],
          ['SMOKING', 'AWAITING_GUEST'],
          ['CLEANING', 'AWAITING_GUEST'],
        ]);
      });
    });
  });

  it('sens inverse et portée : tabac contesté puis annulé ⇒ le nettoyage du même trip est refusé ; un frais abandonné sur un AUTRE trip ne bloque rien', async () => {
    await withRole('app_api', async (api) => {
      await withTestTransaction(api, { virtualNow: START }, async (tx) => {
        const w = await world(tx, c, { start: START, end: END });
        const other = await world(tx, c, { start: START, end: END });
        await now(tx, J0);
        const file = await attach(tx, w.holder, w.trip);
        expect(file.r).toBe('ATTACHED');
        await abandoned(tx, w, 'SMOKING', a['cleaning']!, [w.inner]);
        const h = await session(tx, w.holder);
        expect(
          (await submit(tx, h, w.trip, 'CLEANING', a['cleaning']!, [file.id]))['outcome'],
        ).toBe('INCIDENTAL_DUPLICATE');
        expect(await shape(tx, w.trip)).toEqual([['SMOKING', 'CANCELLED_BY_HOST']]);
        // autre trip (autre hôte, autres pièces) : nettoyage et tabac restent ouverts
        const ho = await session(tx, other.holder);
        expect(
          (await submit(tx, ho, other.trip, 'CLEANING', a['cleaning']!, [other.inner]))['outcome'],
        ).toBe('SUBMITTED');
        expect(await shape(tx, other.trip)).toEqual([['CLEANING', 'AWAITING_GUEST']]);
      });
    });
  });
});
