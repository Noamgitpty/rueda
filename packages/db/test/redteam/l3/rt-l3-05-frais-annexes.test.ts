/**
 * US-313 — red team du lot 3, suite : frais annexes (US-706, migration 0177 ; 19 US-313 critère 2
 * « frais saisi sans preuve » ; pré-mortem du lot 3, RT-L3-S01, S02, H09 ; risques L3-PM-25, L3-PM-26,
 * L3-PM-28). Rôles de PRODUCTION seulement (`withRole` : assertion L0-05 en tête de chaque test), USD
 * (PA) et PYG sans décimale (PY), transactions ANNULÉES. TESTS SEULEMENT : aucun correctif, aucune
 * migration, aucune fixture. Rapport : docs/team/redteam/L3-donnees-sinistres.md. Horloge virtuelle
 * 2072 (aucune autre preuve ne l'utilise). L0 `l0-us706-incidental-fees` joue déjà les bornes
 * (J+3 09:58, 09:59, 10:00), les refus de preuve et le contournement « deux voitures » par le
 * rattachement des fichiers au trip : cette passe joue ce qu'elle ne joue PAS.
 *
 * Règles de jeu : un test vert prouve que l'attaque est BLOQUÉE. Un défaut est prouvé par un
 * `it.fails` nommé par son constat (`F-L3-FRA-nn`), doublé d'un test vert « observation » qui affirme
 * que l'attaque a bien eu lieu. Chaque `it.fails` juge le SIGNAL ATTENDU après correction.
 *
 * Attendus (jamais le code testé) :
 * - 19 US-706 (critère 1 : notifié à J0 10:00, `invoice_guest_response_h` = 72, aucun débit avant
 *   J+3 10:00 ; contestation avec preuves ⇒ décision de l'ops ; critère 2 : liste fermée de BR-REIMB) ;
 * - 08 BR-REIMB-02 (« la fenêtre ne peut pas être rouverte »), BR-REIMB-03 (la contestation va à
 *   l'ops, qui tranche), BR-REIMB-05 (factures interdites : doublons, montant non justifié) ;
 * - 16 CLM-021 (demande sans preuve refusée avant notification ; le voyageur voit les preuves avant de
 *   payer) ; 19 US-706 note « revue ux n° 1 : le voyageur voit les preuves avant de payer » ;
 * - 17 §2.3 (RLS : tables d'argent écrites par commandes seulement ; EXECUTE accordé au seul rôle
 *   prévu).
 */
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { withRole, withTestTransaction } from '../../../src/testing/index.ts';
import { COUNTRIES } from '../../support/avl.ts';
import type { CountryCase } from '../../support/avl.ts';
import { elevated, staff } from '../../support/claims.ts';
import { payTx } from '../../support/pay.ts';
import {
  ACCEPT,
  amountsOf,
  attach,
  CANCEL,
  DESCRIPTION,
  DISPUTE,
  DISPUTE_REASON,
  invoices,
  param,
  photo,
  session,
  STAFF_VIEW,
  submit,
  VIEW,
} from '../../support/incidental.ts';
import type { Row } from '../../support/incidental.ts';
import { failure, plus, uuid } from './support-l3.ts';
import type { Tx } from './support-l3.ts';

/** Trip du 7 au 10 mars 2072, rendu à 08:00 ; demande notifiée à J0 10:00 (heure de la base). */
const START = '2072-03-07T08:00:00.000Z';
const END = '2072-03-10T08:00:00.000Z';
const J0 = '2072-03-10T10:00:00.000Z';
/** J0 + `invoice_guest_response_h` (72 h, 08 BR-REIMB-02) : J+3 10:00. */
const DUE = '2072-03-13T10:00:00.000Z';
const HOUR_S = 3600;

const setNow = (tx: Tx, iso: string): Promise<unknown> =>
  tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [iso]);

interface World {
  readonly trip: string;
  readonly guest: string;
  readonly holder: string;
  readonly org: string;
  readonly fuelOut: string;
  readonly fuelIn: string;
  readonly inner: string;
  readonly guestInner: string;
  readonly outer: string;
}

/**
 * Trip rendu à END (heure de la base), photos des deux séries, validations des deux parties, loyer
 * par carte (mêmes fixtures que `l0-us706-incidental-fees`, horloge 2072) ; `fuel` : niveaux en
 * huitièmes (départ, retour).
 */
async function world(
  tx: Tx,
  c: CountryCase,
  o: { readonly org?: string; readonly fuel?: readonly [number, number] } = {},
): Promise<World> {
  const trip = uuid();
  const guest = uuid();
  await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
    trip,
    guest,
    o.org ?? uuid(),
    uuid(),
    c.country,
    c.currency,
    c.timezone,
    START,
    END,
  ]);
  await setNow(tx, START);
  const fuelOut = await photo(tx, trip, 'CHECKIN', 'FUEL');
  const [out, back] = o.fuel ?? [8, 5];
  for (const role of ['HOST', 'GUEST']) {
    await tx.query('SELECT test_fixture.us706_validation($1, $2, $3, $4::smallint)', [
      trip,
      'CHECKIN',
      role,
      out,
    ]);
  }
  await setNow(tx, END);
  const fuelIn = await photo(tx, trip, 'CHECKOUT', 'FUEL');
  const inner = await photo(tx, trip, 'CHECKOUT', 'INT_01');
  const guestInner = await photo(tx, trip, 'CHECKOUT', 'INT_02', 'GUEST');
  const outer = await photo(tx, trip, 'CHECKOUT', 'EXT_01');
  for (const role of ['HOST', 'GUEST']) {
    await tx.query('SELECT test_fixture.us706_validation($1, $2, $3, $4::smallint)', [
      trip,
      'CHECKOUT',
      role,
      back,
    ]);
  }
  await tx.query('SELECT test_fixture.us309_returned($1)', [trip]);
  await tx.query('SELECT test_fixture.us309_card_rent($1, $2)', [
    trip,
    amountsOf(c)['rent']!.toString(),
  ]);
  const holder = (
    await tx.query<{ h: string }>('SELECT test_fixture.us309_holder($1)::text AS h', [trip])
  ).rows[0]!.h;
  const org = (
    await tx.query<{ o: string }>('SELECT test_fixture.us309_trip_org($1)::text AS o', [trip])
  ).rows[0]!.o;
  return { trip, guest, holder, org, fuelOut, fuelIn, inner, guestInner, outer };
}

/** Transaction ANNULÉE sous app_api à l'instant virtuel de départ. */
const asApi = (body: (tx: Tx) => Promise<void>): Promise<void> =>
  withRole('app_api', (api) => withTestTransaction(api, { virtualNow: START }, body));

const outcomeOf = async (tx: Tx, sql: string, args: readonly unknown[]): Promise<unknown> => {
  const r = (await tx.query<Row>(sql, args as unknown[])).rows[0]!;
  return r['r'] ?? r['outcome'];
};

describe.each(COUNTRIES)('RT-L3 frais annexes ($country, $currency)', (c) => {
  const a = amountsOf(c);

  // -----------------------------------------------------------------------------------------
  // RT-L3-S02 — fenêtre « jamais rouverte » (BR-REIMB-02) : contestation puis annulation puis re-demande
  async function reopenAttack(tx: Tx) {
    const w = await world(tx, c);
    await setNow(tx, J0);
    const first = await submit(
      tx,
      await session(tx, w.holder),
      w.trip,
      'CLEANING',
      a['cleaning']!,
      [w.inner],
    );
    expect(first['outcome']).toBe('SUBMITTED');
    // le voyageur CONTESTE avec preuve (le frais passe à l'ops)
    await setNow(tx, plus(J0, 2 * HOUR_S));
    expect(
      await outcomeOf(tx, DISPUTE, [
        await session(tx, w.guest),
        first['invoice_id'],
        DISPUTE_REASON,
        [w.guestInner],
      ]),
    ).toBe('DISPUTED');
    // l'hôte ANNULE la demande contestée (permis : « tant qu'aucune décision ni aucun débit »)
    await setNow(tx, plus(J0, 3 * HOUR_S));
    expect(await outcomeOf(tx, CANCEL, [await session(tx, w.holder), first['invoice_id']])).toBe(
      'CANCELLED',
    );
    // puis la REDEMANDE, même type, même montant, mêmes pièces, avant la fin de sa propre fenêtre
    await setNow(tx, plus(J0, 4 * HOUR_S));
    const again = await submit(
      tx,
      await session(tx, w.holder),
      w.trip,
      'CLEANING',
      a['cleaning']!,
      [w.inner],
    );
    return { w, first, again };
  }

  it('RT-L3-S02 (L3-PM-26) — observation F-L3-FRA-01 : une demande contestée annulée puis redemandée (même type, même montant) est acceptée ; sa fenêtre de réponse est NEUVE (72 h), aucune décision de l’ops n’a eu lieu', async () => {
    await asApi(async (tx) => {
      const { w, first, again } = await reopenAttack(tx);
      expect(again['outcome']).toBe('SUBMITTED');
      const rows = await invoices(tx, w.trip);
      expect(rows.map((r) => r['status'])).toEqual(['CANCELLED_BY_HOST', 'AWAITING_GUEST']);
      // fenêtre rouverte : nouvelle échéance = nouvelle notification + 72 h, postérieure à l'ancienne
      expect((rows[1]!['response_due_at'] as Date).toISOString()).toBe(plus(J0, (4 + 72) * HOUR_S));
      expect((rows[0]!['response_due_at'] as Date).toISOString()).toBe(DUE);
      // aucune décision d'un agent n'existe sur la première demande
      expect(rows[0]!['decided_role']).toBeNull();
      expect(first['invoice_id']).not.toBe(again['invoice_id']);
      // le voyageur est de nouveau en « fenêtre ouverte » (silence = débit à l'échéance neuve)
      const g = (await tx.query<{ v: Row }>(VIEW, [await session(tx, w.guest), w.trip])).rows[0]!.v;
      const live = (g['invoices'] as Row[]).find((i) => i['status'] === 'AWAITING_GUEST');
      expect(live).toMatchObject({ windowOpen: true, disputeReason: null });
    });
  });

  // CONSTAT F-L3-FRA-01 → suite (US-706) : la contestation du voyageur passe à l'ops ; l'hôte ne
  // peut ni annuler pour redemander à neuf (« fenêtre jamais rouverte », « un rejet n'est jamais
  // redemandé » contournés) : redemander le même type après une contestation est refusé
  it.fails(
    'RT-L3-S02 — CONSTAT F-L3-FRA-01 : après une contestation puis une annulation, aucune demande du même frais ne rouvre une fenêtre de réponse du voyageur (refus ou escalade à l’ops : les deux corrections passent)',
    async () => {
      await asApi(async (tx) => {
        const { w, first } = await reopenAttack(tx);
        expect(first['outcome']).toBe('SUBMITTED');
        const rows = await invoices(tx, w.trip);
        // témoin de population : la première demande existe bien, annulée
        expect(rows.map((r) => r['status'])).toContain('CANCELLED_BY_HOST');
        expect(rows.filter((r) => r['status'] === 'AWAITING_GUEST')).toEqual([]);
      });
    },
  );

  // -----------------------------------------------------------------------------------------
  // RT-L3-S01 — « frais sans preuve » : la preuve de l'hôte n'est vue ni du voyageur ni de l'ops
  async function hostFileOnly(tx: Tx) {
    const w = await world(tx, c);
    await setNow(tx, J0);
    const mine = await attach(tx, w.holder, w.trip);
    expect(mine.r).toBe('ATTACHED');
    // nettoyage SANS photo de l'intérieur au retour ni aucune photo de série : le seul fichier de
    // l'hôte (octets quelconques) tient lieu de preuve (défaut PROPOSÉ comme Turo, DEC-FONDATEUR-22)
    const r = await submit(tx, await session(tx, w.holder), w.trip, 'CLEANING', a['cleaning']!, [
      mine.id,
    ]);
    return { w, mine, r };
  }

  it('RT-L3-S01 (L3-PM-25) — observation F-L3-FRA-02 : un nettoyage est demandé avec UN fichier quelconque de l’hôte (aucune photo de l’intérieur) ; le voyageur voit « 1 pièce » sans pouvoir l’ouvrir, la console de l’ops ne la liste pas', async () => {
    await asApi(async (tx) => {
      const { w, mine, r } = await hostFileOnly(tx);
      expect(mine.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(r['outcome']).toBe('SUBMITTED');
      expect(mine.r).toBe('ATTACHED');
      // voyageur : un compte de pièces, aucune pièce décrite
      const g = (await tx.query<{ v: Row }>(VIEW, [await session(tx, w.guest), w.trip])).rows[0]!.v;
      const seen = (g['invoices'] as Row[])[0]!;
      expect(seen['evidenceCount']).toBe(1);
      expect(seen['evidence']).toEqual([]);
      // ops : la vue de la console (session élevée, dispute.decide) ne décrit aucune pièce
      const ops = await staff(tx, 'OPS_AGENT', [c.country]);
      const read = (
        await tx.query<Row>(STAFF_VIEW, [await elevated(tx, ops), uuid(), r['invoice_id']])
      ).rows[0]!;
      expect(read['outcome']).toBe('OK');
      expect((read['body'] as Row)['evidence']).toEqual([]);
    });
  });

  // CONSTAT F-L3-FRA-02 → suite (US-706) : toute pièce retenue à la demande est visible de ceux qui
  // la jugent (voyageur avant de payer, ops avant de décider) — ou n'est pas admise
  it.fails(
    'RT-L3-S01 — CONSTAT F-L3-FRA-02 : chaque pièce retenue d’une demande est décrite au voyageur (vue) comme à l’ops (console)',
    async () => {
      await asApi(async (tx) => {
        const { w, r } = await hostFileOnly(tx);
        expect(r['outcome']).toBe('SUBMITTED');
        // pièces retenues : le compte vu du voyageur (cardinalité de la demande)
        const guestView = (await tx.query<{ v: Row }>(VIEW, [await session(tx, w.guest), w.trip]))
          .rows[0]!.v;
        const kept = (guestView['invoices'] as Row[])[0]!['evidenceCount'] as number;
        expect(kept).toBe(1);
        expect(((guestView['invoices'] as Row[])[0]!['evidence'] as unknown[]).length).toBe(kept);
        const ops = await staff(tx, 'OPS_AGENT', [c.country]);
        const read = (
          await tx.query<Row>(STAFF_VIEW, [await elevated(tx, ops), uuid(), r['invoice_id']])
        ).rows[0]!;
        expect(read['outcome']).toBe('OK');
        expect(((read['body'] as Row)['evidence'] as unknown[]).length).toBe(kept);
      });
    },
  );

  it('RT-L3-S01 (L3-PM-25) — observation (faible, comme Turo) : le montant du carburant n’est pas lié à l’écart des jauges — un huitième manquant est demandé au plafond du pays', async () => {
    await asApi(async (tx) => {
      const w = await world(tx, c, { fuel: [8, 7] });
      await param(tx, 'fuel_refill_max', c.country, a['fuelCap']!.toString());
      await setNow(tx, J0);
      const r = await submit(tx, await session(tx, w.holder), w.trip, 'FUEL', a['fuelCap']!, [
        w.fuelOut,
        w.fuelIn,
      ]);
      expect(r['outcome']).toBe('SUBMITTED');
      expect((await invoices(tx, w.trip))[0]).toMatchObject({
        fee_type: 'FUEL',
        amount_minor: a['fuelCap']!.toString(),
      });
      // une unité au-dessus du plafond : refusée (la seule garde de montant)
      const w2 = await world(tx, c, { fuel: [8, 7] });
      await setNow(tx, J0);
      const over = await submit(
        tx,
        await session(tx, w2.holder),
        w2.trip,
        'FUEL',
        a['fuelCap']! + 1n,
        [w2.fuelOut, w2.fuelIn],
      );
      expect(over['outcome']).toBe('INCIDENTAL_AMOUNT_ABOVE_CAP');
    });
  });

  // -----------------------------------------------------------------------------------------
  it('RT-L3-S01 / H09 : aucune autre personne n’agit sur un frais — le voyageur ne demande pas, l’hôte ne paie ni ne conteste, un tiers et un jeton inconnu ne voient ni n’agissent ; la demande reste inchangée', async () => {
    await asApi(async (tx) => {
      const w = await world(tx, c);
      const third = await world(tx, c);
      await setNow(tx, J0);
      const h = await session(tx, w.holder);
      const g = await session(tx, w.guest);
      const t = await session(tx, third.holder);
      const tg = await session(tx, third.guest);
      const unknown = Buffer.alloc(32, 7);
      const r = await submit(tx, h, w.trip, 'CLEANING', a['cleaning']!, [w.inner]);
      expect(r['outcome']).toBe('SUBMITTED');
      const invoice = r['invoice_id'];
      const before = await invoices(tx, w.trip);
      // demander : le voyageur, un tiers (hôte d'un autre trip, voyageur d'un autre trip), jeton inconnu
      for (const [label, who] of [
        ['voyageur', g],
        ['hôte d’un autre trip', t],
        ['voyageur d’un autre trip', tg],
        ['jeton inconnu', unknown],
      ] as const) {
        const out = await submit(tx, who, w.trip, 'SMOKING', a['cleaning']!, [w.inner]);
        expect(out['outcome'], `demande par ${label}`).toBe('NOT_FOUND');
      }
      // payer ou contester : l'hôte, un tiers, jeton inconnu ; annuler : le voyageur, un tiers
      for (const [label, who] of [
        ['hôte', h],
        ['hôte d’un autre trip', t],
        ['voyageur d’un autre trip', tg],
        ['jeton inconnu', unknown],
      ] as const) {
        expect(await outcomeOf(tx, ACCEPT, [who, invoice]), `payer par ${label}`).toBe('NOT_FOUND');
        expect(
          await outcomeOf(tx, DISPUTE, [who, invoice, DISPUTE_REASON, [w.guestInner]]),
          `contester par ${label}`,
        ).toBe('NOT_FOUND');
      }
      for (const [label, who] of [
        ['voyageur', g],
        ['hôte d’un autre trip', t],
        ['jeton inconnu', unknown],
      ] as const) {
        expect(await outcomeOf(tx, CANCEL, [who, invoice]), `annuler par ${label}`).toBe(
          'NOT_FOUND',
        );
      }
      // lire : un tiers et un jeton inconnu n'obtiennent qu'un NOT_FOUND sans donnée
      for (const who of [t, tg, unknown]) {
        const v = (await tx.query<{ v: Row }>(VIEW, [who, w.trip])).rows[0]!.v;
        expect(v).toEqual({ outcome: 'NOT_FOUND' });
      }
      // la demande n'a pas bougé (aucune écriture) ; témoin : le voyageur du trip paie bien
      expect(await invoices(tx, w.trip)).toEqual(before);
      expect(await outcomeOf(tx, ACCEPT, [g, invoice])).toBe('ACCEPTED');
    });
  });

  // -----------------------------------------------------------------------------------------
  it('RT-L3-S02 (L3-PM-26) : l’échéance est figée à la demande — un paramètre abaissé ensuite (invoice_guest_response_h = 1) ne ferme pas la fenêtre du voyageur ; contestation acceptée à J0 + 2 h, puis à J+3 09:59:59.999', async () => {
    await asApi(async (tx) => {
      const w = await world(tx, c);
      const w2 = await world(tx, c);
      await setNow(tx, J0);
      const r1 = await submit(tx, await session(tx, w.holder), w.trip, 'CLEANING', a['cleaning']!, [
        w.inner,
      ]);
      const r2 = await submit(
        tx,
        await session(tx, w2.holder),
        w2.trip,
        'CLEANING',
        a['cleaning']!,
        [w2.inner],
      );
      expect([r1['outcome'], r2['outcome']]).toEqual(['SUBMITTED', 'SUBMITTED']);
      // paramètre du pays abaissé APRÈS la demande (version annulée avec la transaction)
      await setNow(tx, plus(J0, 60));
      await param(tx, 'invoice_guest_response_h', c.country, 1);
      await setNow(tx, plus(J0, 2 * HOUR_S));
      const view = (await tx.query<{ v: Row }>(VIEW, [await session(tx, w.guest), w.trip])).rows[0]!
        .v;
      expect((view['invoices'] as Row[])[0]).toMatchObject({
        windowOpen: true,
        responseDueAt: DUE,
      });
      expect(
        await outcomeOf(tx, DISPUTE, [
          await session(tx, w.guest),
          r1['invoice_id'],
          DISPUTE_REASON,
          [w.guestInner],
        ]),
      ).toBe('DISPUTED');
      // et à 1 ms de l'échéance d'origine : toujours ouverte
      await setNow(tx, plus(DUE, -0.001));
      expect(
        await outcomeOf(tx, DISPUTE, [
          await session(tx, w2.guest),
          r2['invoice_id'],
          DISPUTE_REASON,
          [w2.guestInner],
        ]),
      ).toBe('DISPUTED');
    });
  });

  // -----------------------------------------------------------------------------------------
  it('RT-L3-S01 (L3-PM-25) : un fichier rattaché à un trip ne se rattache pas à l’autre voiture — même identifiant sous un autre trip (octets identiques ou non), même hôte ; la demande de l’autre trip refuse ce fichier ; témoin : le rattachement au trip d’origine est idempotent', async () => {
    await asApi(async (tx) => {
      const first = await world(tx, c);
      const twin = await world(tx, c, { org: first.org });
      expect(twin.holder).toBe(first.holder);
      await setNow(tx, J0);
      const onFirst = await attach(tx, first.holder, first.trip);
      expect(onFirst.r).toBe('ATTACHED');
      // même identifiant, autre trip du même titulaire : jamais rattaché une seconde fois
      for (const bytes of [undefined, 4096]) {
        const o = bytes === undefined ? { id: onFirst.id } : { id: onFirst.id, bytes };
        expect((await attach(tx, first.holder, twin.trip, o)).r, `octets ${String(bytes)}`).toBe(
          'REQUEST_INVALID',
        );
      }
      // l'autre voiture demande un nettoyage avec CE fichier : refus, rien d'écrit
      const out = await submit(
        tx,
        await session(tx, twin.holder),
        twin.trip,
        'CLEANING',
        a['cleaning']!,
        [onFirst.id],
      );
      expect(out['outcome']).toBe('CLAIM_EVIDENCE_MISSING');
      expect(await invoices(tx, twin.trip)).toEqual([]);
      // témoin : le trip d'origine l'accepte
      const ok = await submit(
        tx,
        await session(tx, first.holder),
        first.trip,
        'CLEANING',
        a['cleaning']!,
        [onFirst.id],
      );
      expect(ok['outcome']).toBe('SUBMITTED');
    });
  });

  // -----------------------------------------------------------------------------------------
  const LOCKED: readonly string[] = [
    `SELECT * FROM core.claim_cmd_charge_incidental('${uuid()}', '${uuid()}')`,
    `SELECT * FROM core.claim_incidental_invoices_due(10, NULL)`,
    `SELECT core.claim_cmd_defer_incidental('${uuid()}', 'EXECUTION_FAILED')`,
    `SELECT core.claim_cmd_decide_incidental('${uuid()}', '${uuid()}', 'ADMIN', '${uuid()}', 'CHARGE', 'Motif de décision de plus de vingt caractères')`,
    `SELECT core.claim_incidental_staff_view('${uuid()}')`,
    `SELECT core.claim_incidental_review_list(ARRAY['${uuid()}']::uuid[])`,
  ];

  it('RT-L3-S02 / H09 : les commandes de débit et de décision sont fermées à l’API, même avec un contexte WORKER ou STAFF falsifié par set_config, et à un autre travailleur ; aucune écriture directe de la table (42501) sous les trois rôles', async () => {
    // sous l'API : aucun EXECUTE, quels que soient les réglages de contexte
    await withRole('app_api', (api) =>
      withTestTransaction(api, {}, async (tx) => {
        for (const [kind, worker] of [
          ['WORKER', 'payment_command'],
          ['STAFF', ''],
        ] as const) {
          await tx.query(
            `SELECT pg_catalog.set_config('app.actor_kind', $1, true),
                    pg_catalog.set_config('app.worker_name', $2, true)`,
            [kind, worker],
          );
          for (const sql of LOCKED) {
            expect(await failure(tx, sql), `${kind} : ${sql.slice(0, 60)}`).toMatchObject({
              code: '42501',
            });
          }
        }
      }),
    );
    // sous un autre travailleur : la commande se refuse (contrainte nommée) ; débit ou file seulement
    await withRole('app_worker', (client) =>
      payTx(client, { worker: 'trip_overdue', virtualNow: DUE }, async (tx) => {
        for (const sql of LOCKED.slice(0, 3)) {
          expect(await failure(tx, sql), sql).toMatchObject({
            code: '42501',
            constraint: 'claim_incidental_forbidden',
          });
        }
      }),
    );
    // écritures directes : aucun rôle applicatif n'écrit les demandes ni les fichiers de l'hôte
    const attacks: readonly string[] = [
      `UPDATE core.claim_incidental_invoice SET status = 'CHARGED'`,
      `UPDATE core.claim_incidental_invoice SET amount_minor = amount_minor * 10, leg_host_minor = leg_host_minor * 10`,
      `UPDATE core.claim_incidental_invoice SET response_due_at = '2072-01-01T00:00:00Z'::timestamptz`,
      'DELETE FROM core.claim_incidental_invoice',
      'TRUNCATE core.claim_incidental_invoice',
      `INSERT INTO core.claim_incidental_invoice (id) VALUES (gen_random_uuid())`,
      `UPDATE core.claim_incidental_host_file SET trip_id = gen_random_uuid()`,
      'DELETE FROM core.claim_incidental_host_file',
      `INSERT INTO core.claim_incidental_host_file (file_id) VALUES (gen_random_uuid())`,
    ];
    for (const role of ['app_api', 'app_worker', 'app_anon'] as const) {
      await withRole(role, async (client) => {
        await client.query('BEGIN');
        try {
          for (const sql of attacks) {
            const refused = await failure(client, sql);
            expect(refused?.code, `${role} : ${sql.slice(0, 70)}`).toBe('42501');
          }
        } finally {
          await client.query('ROLLBACK');
        }
      });
    }
    // app_anon : aucune des commandes des parties (EXECUTE app_api seulement)
    await withRole('app_anon', async (client: pg.Client) => {
      await expect(
        client.query('SELECT core.claim_cmd_accept_incidental($1, $2::uuid)', [
          Buffer.alloc(32, 1),
          uuid(),
        ]),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        client.query('SELECT core.claim_incidental_view($1, $2::uuid)', [
          Buffer.alloc(32, 1),
          uuid(),
        ]),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('RT-L3-S01 : les en-têtes de la demande — description trop courte, montant nul ou négatif, type absent, plus de dix pièces — sont refusés sans écriture ; types hors liste (EXTRA, PARKING) refusés', async () => {
    await asApi(async (tx) => {
      const w = await world(tx, c);
      await setNow(tx, J0);
      const h = await session(tx, w.holder);
      const call = async (type: string | null, amount: bigint, evidence: readonly string[]) =>
        (
          await tx.query<Row>(
            `SELECT outcome FROM core.claim_cmd_submit_incidental($1, $2::uuid, $3::uuid, $4, $5::bigint,
                                                                   $6, $7::uuid[])`,
            [h, w.trip, uuid(), type, amount.toString(), DESCRIPTION, evidence],
          )
        ).rows[0]!['outcome'];
      expect(await call('CLEANING', 0n, [w.inner])).toBe('REQUEST_INVALID');
      expect(await call('CLEANING', -1n, [w.inner])).toBe('REQUEST_INVALID');
      expect(await call(null, a['cleaning']!, [w.inner])).toBe('INCIDENTAL_TYPE_NOT_ALLOWED');
      for (const type of ['PARKING', 'EXTRA', 'TICKET_FEE', 'cleaning']) {
        expect(await call(type, a['cleaning']!, [w.inner]), type).toBe(
          'INCIDENTAL_TYPE_NOT_ALLOWED',
        );
      }
      // onze pièces distinctes : refus (au plus dix) ; une liste de NULL : aucune pièce
      expect(
        await call(
          'CLEANING',
          a['cleaning']!,
          Array.from({ length: 11 }, () => uuid()),
        ),
      ).toBe('CLAIM_EVIDENCE_MISSING');
      expect(await call('CLEANING', a['cleaning']!, [])).toBe('CLAIM_EVIDENCE_MISSING');
      expect(await invoices(tx, w.trip)).toEqual([]);
      // témoin : la même demande, valable, passe
      expect(await call('CLEANING', a['cleaning']!, [w.inner])).toBe('SUBMITTED');
    });
  });
});
