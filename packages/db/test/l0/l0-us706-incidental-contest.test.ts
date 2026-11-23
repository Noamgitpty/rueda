/**
 * US-706 suite — frais annexes après la red team du lot 3 (migration 0182, ADR-202 ; fixture 9903) :
 * F-L3-FRA-01 (une demande contestée puis annulée par l'hôte ne se redemande plus) et F-L3-FRA-02
 * (chaque pièce retenue est décrite au voyageur et à l'ops ; nettoyage : photo de l'intérieur au
 * retour, ou fichier de l'hôte reçu dans la fenêtre des photos). Rôles de PRODUCTION seulement
 * (`withRole` : assertion L0-05 en tête de chaque test), au Panama (USD) et au Paraguay (PYG sans
 * décimale), transactions ANNULÉES. Année virtuelle 2063 (libre).
 *
 * Attendus (jamais le code testé) : 08 BR-REIMB-02 (la fenêtre du voyageur « ne peut pas être
 * rouverte »), BR-REIMB-03 (la contestation va à l'ops, qui tranche), BR-REIMB-05 (doublons
 * interdits), SM-5 (CANCELLED_BY_HOST est final) ; 08 BR-REIMB-01 (nettoyage / tabac : « photos dans
 * les fenêtres de 24 h ») ; 16 CLM-021 (le voyageur voit les preuves avant de payer) ; red team
 * `rt-l3-05-frais-annexes` (RT-L3-S01, RT-L3-S02).
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import { elevated, staff, uuid } from '../support/claims.ts';
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
  MINUTE,
  now,
  session,
  STAFF_VIEW,
  submit,
  VIEW,
  world,
} from '../support/incidental.ts';
import type { Row, Tx } from '../support/incidental.ts';

/** Trip du 7 au 10 mars 2063, rendu à 08:00 ; demande à J0 10:00 (heure de la base). */
const START = '2063-03-07T08:00:00.000Z';
const END = '2063-03-10T08:00:00.000Z';
const J0 = '2063-03-10T10:00:00.000Z';
/** Fenêtre des photos d'un nettoyage PROPOSÉE (08 BR-REIMB-01 : 24 h après la fin). */
const PHOTO_WINDOW_MS = 24 * HOUR;

const one = async (tx: Tx, sql: string, args: unknown[]): Promise<unknown> =>
  (await tx.query<{ r: unknown }>(sql, args)).rows[0]!.r;

const viewOf = async (tx: Tx, user: string, trip: string): Promise<Row> =>
  (await tx.query<{ v: Row }>(VIEW, [await session(tx, user), trip])).rows[0]!.v;

describe.each(COUNTRIES)('US-706 suite — contestation et pièces ($country, $currency)', (c) => {
  const a = amountsOf(c);

  it('F-L3-FRA-01 : demande contestée puis annulée par l’hôte ⇒ le même frais ne se redemande plus pour ce trip (INCIDENTAL_DUPLICATE, même autre montant ou autres pièces), aucune fenêtre neuve du voyageur, aucun second avis, l’ops ne décide plus ; témoins : une demande annulée AVANT toute contestation se redemande, le rejeu rend la même demande', async () => {
    await withRole('app_api', async (api) => {
      await withTestTransaction(api, { virtualNow: START }, async (tx) => {
        const ops = await staff(tx, 'OPS_AGENT', [c.country]);
        const w = await world(tx, c, { start: START, end: END });
        await now(tx, J0);
        const h = await session(tx, w.holder);
        const firstReq = uuid();
        const first = await submit(tx, h, w.trip, 'CLEANING', a['cleaning']!, [w.inner], firstReq);
        const smoke = await submit(tx, h, w.trip, 'SMOKING', a['cleaning']!, [w.inner]);
        expect([first['outcome'], smoke['outcome']]).toEqual(['SUBMITTED', 'SUBMITTED']);
        // le voyageur conteste le nettoyage avec sa photo (BR-REIMB-03)
        await now(tx, at(J0, 2 * HOUR));
        expect(
          await one(tx, DISPUTE, [
            await session(tx, w.guest),
            first['invoice_id'],
            DISPUTE_REASON,
            [w.guestInner],
          ]),
        ).toBe('DISPUTED');
        // l'hôte annule la demande contestée, et le tabac (jamais contesté)
        await now(tx, at(J0, 3 * HOUR));
        const hc = await session(tx, w.holder);
        expect(await one(tx, CANCEL, [hc, first['invoice_id']])).toBe('CANCELLED');
        expect(await one(tx, CANCEL, [hc, smoke['invoice_id']])).toBe('CANCELLED');
        // puis redemande, avant la fin de sa propre fenêtre : refus, rien n'est écrit
        await now(tx, at(J0, 4 * HOUR));
        const h2 = await session(tx, w.holder);
        for (const [amount, evidence] of [
          [a['cleaning']!, [w.inner]],
          [a['cleaning']! - 1n, [w.inner, w.outer]],
        ] as const) {
          expect((await submit(tx, h2, w.trip, 'CLEANING', amount, evidence))['outcome']).toBe(
            'INCIDENTAL_DUPLICATE',
          );
        }
        // rejeu de la requête d'origine : la même demande (annulée), jamais une nouvelle
        expect(
          await submit(tx, h2, w.trip, 'CLEANING', a['cleaning']!, [w.inner], firstReq),
        ).toMatchObject({ outcome: 'ALREADY_SUBMITTED', invoice_id: first['invoice_id'] });
        // le tabac, annulé avant toute contestation, est du groupe du nettoyage ABANDONNÉ et reprend
        // sa pièce : refusé depuis 0184 (F-L3-FRA-03, ADR-204), aucune fenêtre neuve
        expect(
          (await submit(tx, h2, w.trip, 'SMOKING', a['cleaning']!, [w.inner]))['outcome'],
        ).toBe('INCIDENTAL_DUPLICATE');
        const rows = await invoices(tx, w.trip);
        expect(rows.filter((r) => r['fee_type'] === 'CLEANING').map((r) => r['status'])).toEqual([
          'CANCELLED_BY_HOST',
        ]);
        expect(rows.filter((r) => r['status'] === 'AWAITING_GUEST')).toEqual([]);
        // témoin : sur un trip sans frais abandonné, le tabac annulé avant toute contestation se
        // redemande (même pièce)
        const ws = await world(tx, c, { start: START, end: END });
        const hs = await session(tx, ws.holder);
        const s1 = await submit(tx, hs, ws.trip, 'SMOKING', a['cleaning']!, [ws.inner]);
        expect(s1['outcome']).toBe('SUBMITTED');
        expect(await one(tx, CANCEL, [await session(tx, ws.holder), s1['invoice_id']])).toBe(
          'CANCELLED',
        );
        expect(
          (
            await submit(tx, await session(tx, ws.holder), ws.trip, 'SMOKING', a['cleaning']!, [
              ws.inner,
            ])
          )['outcome'],
        ).toBe('SUBMITTED');
        // un seul avis au voyageur pour le nettoyage (celui de la demande d'origine)
        expect(
          (await tx.query('SELECT * FROM test_fixture.us706_events($1)', [first['invoice_id']]))
            .rows,
        ).toHaveLength(1);
        // le voyageur : aucun nettoyage à payer ni à contester ; sa contestation reste visible
        const g = await viewOf(tx, w.guest, w.trip);
        const cleaning = (g['invoices'] as Row[]).filter((i) => i['feeType'] === 'CLEANING');
        expect(cleaning).toEqual([
          expect.objectContaining({
            status: 'CANCELLED_BY_HOST',
            windowOpen: false,
            disputeReason: DISPUTE_REASON,
          }),
        ]);
        // l'ops ne tranche plus une demande annulée (rien n'est écrit)
        expect((await decide(tx, ops, String(first['invoice_id']), 'REJECT'))['outcome']).toBe(
          'INCIDENTAL_NOT_DISPUTED',
        );
        expect(
          (await invoices(tx, w.trip)).find((r) => r['id'] === first['invoice_id']),
        ).toMatchObject({ status: 'CANCELLED_BY_HOST', decided_role: null });
        // garantie en base : l'index unique couvre une annulation après contestation
        const idx = await tx.query<{ d: string }>(
          `SELECT indexdef AS d FROM pg_catalog.pg_indexes
            WHERE schemaname = 'core' AND indexname = 'claim_incidental_live_unique'`,
        );
        expect(idx.rows[0]!.d).toContain('disputed_at IS NOT NULL');
        // et l'index refuse lui-même une écriture directe (fixture sous migrator, sans la commande)
        await tx.query('SAVEPOINT direct');
        const err = await tx.query('SELECT test_fixture.us706_insert_invoice($1)', [w.trip]).then(
          () => null,
          (e: unknown) => e as { code?: string; constraint?: string },
        );
        await tx.query('ROLLBACK TO SAVEPOINT direct');
        expect(err).toMatchObject({ code: '23505', constraint: 'claim_incidental_live_unique' });
        // témoin : sur un trip sans demande de nettoyage, la même écriture passe
        const w2 = await world(tx, c, { start: START, end: END });
        await tx.query('SELECT test_fixture.us706_insert_invoice($1)', [w2.trip]);
        expect((await invoices(tx, w2.trip)).map((r) => r['status'])).toEqual(['AWAITING_GUEST']);
      });
    });
  });

  it('F-L3-FRA-02 : chaque pièce retenue est décrite — au voyageur et à l’hôte (photo : côté, emplacement, auteur, heure serveur ; fichier de l’hôte : type et heure serveur de dépôt, jamais son identifiant), à l’ops (en plus : identifiant, taille, empreinte, nombre de pièces)', async () => {
    await withRole('app_api', async (api) => {
      await withTestTransaction(api, { virtualNow: START }, async (tx) => {
        const ops = await staff(tx, 'OPS_AGENT', [c.country]);
        const w = await world(tx, c, { start: START, end: END });
        await now(tx, at(START, HOUR));
        const during = await attach(tx, w.holder, w.trip);
        await now(tx, J0);
        const sha = randomBytes(32);
        const mine = await attach(tx, w.holder, w.trip, { sha, mime: 'image/webp' });
        expect([during.r, mine.r]).toEqual(['ATTACHED', 'ATTACHED']);
        const h = await session(tx, w.holder);
        const r = await submit(tx, h, w.trip, 'CLEANING', a['cleaning']!, [mine.id]);
        expect(r['outcome']).toBe('SUBMITTED');
        const s = await submit(tx, h, w.trip, 'SMOKING', a['cleaning']!, [during.id, w.inner]);
        expect(s['outcome']).toBe('SUBMITTED');
        const file = { kind: 'HOST_FILE', takenBy: 'HOST', mime: 'image/webp', receivedAt: J0 };
        const photo = {
          kind: 'CHECKOUT',
          slotCode: 'INT_01',
          slotGroup: 'INTERIOR',
          takenBy: 'HOST',
          receivedAt: END,
        };
        const early = {
          kind: 'HOST_FILE',
          takenBy: 'HOST',
          mime: 'image/jpeg',
          receivedAt: at(START, HOUR),
        };
        for (const who of [w.guest, w.holder]) {
          const v = await viewOf(tx, who, w.trip);
          const by = (fee: string) => (v['invoices'] as Row[]).find((i) => i['feeType'] === fee);
          expect(by('CLEANING')).toMatchObject({ evidenceCount: 1, evidence: [file] });
          // photo des séries d'abord, puis le fichier de l'hôte ; autant de pièces que le compte
          expect(by('SMOKING')).toMatchObject({ evidenceCount: 2, evidence: [photo, early] });
          // jamais l'identifiant d'un fichier de l'hôte
          expect(JSON.stringify(v)).not.toContain(mine.id);
          expect(JSON.stringify(v)).not.toContain(during.id);
        }
        const hash = await elevated(tx, ops);
        const read = (await tx.query<Row>(STAFF_VIEW, [hash, uuid(), r['invoice_id']])).rows[0]!;
        expect(read['outcome']).toBe('OK');
        expect(read['body']).toMatchObject({
          evidenceCount: 1,
          evidence: [
            {
              kind: 'HOST_FILE',
              takenBy: 'HOST',
              fileId: mine.id,
              mime: 'image/webp',
              bytes: '2048',
              sha256: sha.toString('hex'),
              deleted: false,
              receivedAt: J0,
            },
          ],
        });
        const read2 = (await tx.query<Row>(STAFF_VIEW, [hash, uuid(), s['invoice_id']])).rows[0]!;
        expect(read2['body']).toMatchObject({
          evidenceCount: 2,
          evidence: [photo, { ...early, fileId: during.id, deleted: false }],
        });
      });
    });
  });

  it('08 BR-REIMB-01 (photos dans les fenêtres de 24 h, F-L3-FRA-02) : sans photo de l’intérieur au retour, un nettoyage exige un fichier de l’hôte reçu entre la fin effective et la fin + 24 h (bornes : 24 h admis, 24 h + 1 ms refusé ; fichier du trip en cours refusé) ; la photo de l’intérieur suffit toujours ; fenêtre illisible ⇒ PARAM_MISSING (fail-closed)', async () => {
    await withRole('app_api', async (api) => {
      await withTestTransaction(api, { virtualNow: START }, async (tx) => {
        const edge = await world(tx, c, { start: START, end: END });
        const late = await world(tx, c, { start: START, end: END });
        const strict = await world(tx, c, { start: START, end: END });
        await now(tx, at(END, -MINUTE));
        const before = await attach(tx, edge.holder, edge.trip);
        await now(tx, at(END, PHOTO_WINDOW_MS));
        const inWindow = await attach(tx, edge.holder, edge.trip);
        await now(tx, at(END, PHOTO_WINDOW_MS + 1));
        const outside = await attach(tx, late.holder, late.trip);
        expect([before.r, inWindow.r, outside.r]).toEqual(['ATTACHED', 'ATTACHED', 'ATTACHED']);
        await now(tx, at(END, PHOTO_WINDOW_MS + MINUTE));
        const he = await session(tx, edge.holder);
        const hl = await session(tx, late.holder);
        // fichier envoyé avant la fin effective (trip en cours) : ne montre pas l'état au retour
        expect(
          (await submit(tx, he, edge.trip, 'CLEANING', a['cleaning']!, [before.id]))['outcome'],
        ).toBe('INCIDENTAL_NOT_BILLABLE');
        // reçu 1 ms après la fenêtre : refusé ; une photo extérieure n'y change rien
        for (const evidence of [[outside.id], [outside.id, late.outer]]) {
          expect(
            (await submit(tx, hl, late.trip, 'CLEANING', a['cleaning']!, evidence))['outcome'],
          ).toBe('INCIDENTAL_NOT_BILLABLE');
        }
        // la photo de l'intérieur au retour suffit, fichier tardif joint ou non
        expect(
          (await submit(tx, hl, late.trip, 'CLEANING', a['cleaning']!, [outside.id, late.inner]))[
            'outcome'
          ],
        ).toBe('SUBMITTED');
        // reçu à la borne exacte (fin + 24 h) : admis
        expect(
          (await submit(tx, he, edge.trip, 'CLEANING', a['cleaning']!, [inWindow.id, before.id]))[
            'outcome'
          ],
        ).toBe('SUBMITTED');
        // mêmes bornes pour le tabac (08 BR-REIMB-01 : nettoyage / tabac)
        expect(
          (await submit(tx, hl, late.trip, 'SMOKING', a['cleaning']!, [outside.id]))['outcome'],
        ).toBe('INCIDENTAL_NOT_BILLABLE');
        expect(
          (await submit(tx, he, edge.trip, 'SMOKING', a['cleaning']!, [before.id]))['outcome'],
        ).toBe('INCIDENTAL_NOT_BILLABLE');
        expect(
          (await submit(tx, he, edge.trip, 'SMOKING', a['cleaning']!, [inWindow.id]))['outcome'],
        ).toBe('SUBMITTED');
        // fenêtre illisible (hors bornes) : aucune demande, même avec la photo de l'intérieur
        await tx.query('SELECT test_fixture.us706s_param_version($1, $2, $3::jsonb)', [
          'incidental_cleaning_photo_window_h',
          c.country,
          '0',
        ]);
        await now(tx, at(END, PHOTO_WINDOW_MS + 2 * MINUTE));
        const hs = await session(tx, strict.holder);
        expect(
          (await submit(tx, hs, strict.trip, 'CLEANING', a['cleaning']!, [strict.inner]))[
            'outcome'
          ],
        ).toBe('PARAM_MISSING');
        expect(await invoices(tx, strict.trip)).toEqual([]);
      });
    });
  });
});
