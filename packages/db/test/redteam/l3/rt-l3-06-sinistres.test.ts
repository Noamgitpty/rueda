/**
 * US-313 — red team du lot 3, suite : sinistres entre particuliers (US-318, migration 0178) — amendes,
 * péages et fourrière refacturés au voyageur, vol présumé (19 US-313 critère 2 ; pré-mortem du lot 3,
 * RT-L3-S04, S05, V04 ; risques L3-PM-17, L3-PM-29, L3-PM-34). Rôles de PRODUCTION seulement (`withRole` :
 * assertion L0-05 en tête de chaque test), USD (PA) et PYG sans décimale (PY). TESTS SEULEMENT : aucun
 * correctif, aucune migration (la passe de correctifs est une autre PR). Rapport :
 * docs/team/redteam/L3-donnees-sinistres.md. Horloge virtuelle 2073 (aucune autre preuve ne l'utilise).
 *
 * Règles de jeu : un test vert prouve que l'attaque est BLOQUÉE. Un défaut est prouvé par un `it.fails`
 * nommé par son constat (`F-L3-SIN-nn`), doublé d'un test vert « observation » qui affirme que
 * l'attaque a bien eu lieu (une observation absente fait rougir l'`it.fails`). Chaque `it.fails` juge
 * le SIGNAL ATTENDU après correction, jamais l'issue brute.
 *
 * Données : un lot committé par pays (comme `l0-us318-p2p-claims`, mêmes fixtures 9300, 9906, 9909 :
 * la déclaration est une commande de l'API et l'exécution une commande du travailleur, deux
 * connexions) ; toute exécution du travailleur, toute écriture directe et toute lecture se font dans
 * des transactions ANNULÉES. Aucun interrupteur n'est écrit. Octets de photo tirés au hasard (index
 * d'empreinte unique, 0176).
 *
 * Attendus (jamais le code testé) :
 * - 19 US-318 critère 3 (« déclare avec la pièce dans le délai ; refacturé au voyageur par débit séparé
 *   avec ses frais de gestion ; hors délai, refus ») ; 08 BR-REIMB-05 (« interdites : […] doublons,
 *   montant non justifié »), BR-REIMB-02 / BR-TT-02 (le voyageur a un délai pour payer ou contester
 *   chaque facture ; « sans réponse, Kmino tranche ») et BR-REIMB-03 (contestation, décision de l'ops) ;
 *   BR-TT-03 (« photo du PV + reçu payé ») ; 17 §0.1 (les interrupteurs restent faux) ;
 * - frais de gestion de 5 % (08 BR-PRICE-15 [NOUS], graine 0178) : les montants de la déclaration sont
 *   ceux de l'oracle `packages/money/test/oracle/traffic_fee_oracle.py` (`rhu`, voir
 *   `l0-us318-p2p-claims`) pour 1 230 USD et 25 010 PYG, et le produit exact montant × 5 % pour les
 *   montants ronds de la passe (aucun arrondi en jeu).
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SubjectKeyStore } from '../../../src/audit/index.ts';
import { FakeKeyWrapper, withRole, withTestTransaction } from '../../../src/testing/index.ts';
import { setActor } from '../../support/audit.ts';
import { COUNTRIES } from '../../support/avl.ts';
import type { CountryCase } from '../../support/avl.ts';
import { openSession } from '../../support/iam.ts';
import { caught, payTx } from '../../support/pay.ts';
import { failure, plus, sha, uuid } from './support-l3.ts';
import type { Row, Tx } from './support-l3.ts';

const START = '2073-04-07T10:00:00.000Z';
const END = '2073-04-10T10:00:00.000Z';
/** Instant de toutes les déclarations (une heure après le retour). */
const DECLARED_AT = plus(END, 3600);

/**
 * Par pays (ordre de `COUNTRIES`) : montant de l'amende et frais de gestion de l'oracle, loyer par
 * carte, montant « absurde » (un million de fois un péage) et son total avec 5 % (produit exact).
 */
const AMOUNTS: readonly Readonly<Record<string, bigint>>[] = [
  { fine: 1230n, fee: 62n, rent: 30000n, absurd: 5_000_000n, absurdTotal: 5_250_000n },
  { fine: 25010n, fee: 1251n, rent: 2000000n, absurd: 500_000_000n, absurdTotal: 525_000_000n },
];
const amountsOf = (c: CountryCase): Readonly<Record<string, bigint>> =>
  AMOUNTS[COUNTRIES.indexOf(c)]!;

const CAPTURE = 'SELECT * FROM core.trip_cmd_open_photo_capture($1, $2::uuid, $3, $4)';
const ADD = `SELECT * FROM core.trip_cmd_add_inspection_photo($1, $2::uuid, $3, $4::uuid, $5, $6::uuid,
                                                              $7, $8::bigint, $9, $10::timestamptz)`;
const DECLARE = `SELECT outcome, charge_id::text AS charge_id, body
  FROM core.claim_cmd_declare_traffic_charge($1, $2::uuid, $3::uuid, $4, $5::timestamptz, $6::bigint,
                                             $7::uuid, $8)`;
const EXECUTE = 'SELECT outcome, code FROM core.claim_cmd_execute_traffic_charge($1, $2)';
const NOTIFY = `SELECT outcome, charge_id::text AS charge_id
  FROM core.payment_cmd_notify_post_trip_charge($1::uuid, $2::uuid, 'INCIDENTAL', 'DELAYED_CHARGES',
                                                'TRAFFIC_CHARGE', $3::uuid, NULL, $4::uuid,
                                                $5::bigint, $6::jsonb, false)`;

const setNow = (tx: Tx, iso: string): Promise<unknown> =>
  tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [iso]);

const keys = new SubjectKeyStore(new FakeKeyWrapper());
/** Clé USER de la personne (une photo est chiffrée par la clé de son sujet). */
async function subjectKey(tx: Tx, userId: string): Promise<void> {
  await setActor(tx, { kind: 'GUEST', actorId: userId });
  const k = await keys.dekFor(tx, { type: 'USER', id: userId }, 'create');
  if (k.status !== 'OK') throw new Error(`clé du sujet : ${k.status}`);
}

interface Shot {
  readonly outcome: unknown;
  readonly fileId: string | null;
}
/** Photo par la chaîne d'US-303 (jeton puis envoi) ; octets tirés au hasard sauf `body`. */
async function shoot(
  tx: Tx,
  who: Buffer,
  trip: string,
  kind: string,
  slot: string,
  body: Buffer = randomBytes(64),
): Promise<Shot> {
  const cap = (await tx.query<Row>(CAPTURE, [who, trip, kind, slot])).rows[0]!;
  if (cap['outcome'] !== 'DONE') return { outcome: cap['outcome'], fileId: null };
  const fileId = uuid();
  const r = (
    await tx.query<Row>(ADD, [
      who,
      trip,
      kind,
      cap['capture_id'],
      slot,
      fileId,
      'image/jpeg',
      body.length,
      sha(body),
      null,
    ])
  ).rows[0]!;
  return { outcome: r['outcome'], fileId: r['outcome'] === 'DONE' ? fileId : null };
}

interface World {
  readonly trip: string;
  readonly guest: string;
  readonly holder: string;
}
/** Trip du pays (9300) de START à END, rendu à END, loyer encaissé par carte (9909). */
async function returnedWorld(tx: Tx, c: CountryCase): Promise<World> {
  const trip = uuid();
  const guest = uuid();
  await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
    trip,
    guest,
    uuid(),
    uuid(),
    c.country,
    c.currency,
    c.timezone,
    START,
    END,
  ]);
  await tx.query('SELECT test_fixture.us309_set_status($1, $2)', [trip, 'IN_PROGRESS']);
  await setNow(tx, END);
  await tx.query('SELECT test_fixture.us309_returned($1)', [trip]);
  await tx.query('SELECT test_fixture.us309_card_rent($1, $2)', [
    trip,
    amountsOf(c)['rent']!.toString(),
  ]);
  await setNow(tx, DECLARED_AT);
  const holder = (
    await tx.query<{ h: string }>('SELECT test_fixture.us309_holder($1)::text AS h', [trip])
  ).rows[0]!.h;
  return { trip, guest, holder };
}

async function declare(
  tx: Tx,
  who: Buffer,
  trip: string,
  kind: string,
  occurredAt: string,
  amount: bigint,
  file: string,
  preview = false,
  req: string = uuid(),
): Promise<Row> {
  return (
    await tx.query<Row>(DECLARE, [
      who,
      req,
      trip,
      kind,
      occurredAt,
      amount.toString(),
      file,
      preview,
    ])
  ).rows[0]!;
}

/** Lot committé d'un pays : l'amende déclarée deux fois, un montant absurde, un péage témoin. */
interface Batch {
  readonly trip: string;
  readonly holder: string;
  readonly guest: string;
  readonly first: string;
  readonly again: string | null;
  readonly againOutcome: unknown;
  readonly absurd: string | null;
  readonly absurdOutcome: unknown;
  readonly otherTrip: string;
  readonly otherHolder: string;
  readonly files: readonly string[];
}
const batches = new Map<string, Promise<Batch>>();
function batchOf(c: CountryCase): Promise<Batch> {
  const known = batches.get(c.country);
  if (known !== undefined) return known;
  const a = amountsOf(c);
  const made = withRole('app_api', (api) =>
    withTestTransaction(api, { virtualNow: DECLARED_AT, commit: true }, async (tx) => {
      const w = await returnedWorld(tx, c);
      const o = await returnedWorld(tx, c);
      const h = (await openSession(tx, w.holder)).hash;
      const ho = (await openSession(tx, o.holder)).hash;
      await subjectKey(tx, w.holder);
      await subjectKey(tx, o.holder);
      // trois photos du MÊME procès-verbal (octets distincts : trois prises de vue) et une pièce
      // d'un autre trip
      const p1 = await shoot(tx, h, w.trip, 'TRAFFIC', 'DAMAGE_01');
      const p2 = await shoot(tx, h, w.trip, 'TRAFFIC', 'DAMAGE_02');
      const p3 = await shoot(tx, h, w.trip, 'TRAFFIC', 'DAMAGE_03');
      const po = await shoot(tx, ho, o.trip, 'TRAFFIC', 'DAMAGE_01');
      for (const p of [p1, p2, p3, po]) {
        if (p.outcome !== 'DONE' || p.fileId === null) throw new Error(`photo : ${p.outcome}`);
      }
      const occurred = plus(START, 3600);
      const first = await declare(tx, h, w.trip, 'FINE', occurred, a['fine']!, p1.fileId!);
      // ATTAQUE : le même procès-verbal (même nature, même fait, même montant), une autre photo
      const again = await declare(tx, h, w.trip, 'FINE', occurred, a['fine']!, p2.fileId!);
      // ATTAQUE : montant sans rapport avec la pièce (une photo quelconque)
      const absurd = await declare(
        tx,
        h,
        w.trip,
        'TOLL',
        plus(occurred, 60),
        a['absurd']!,
        p3.fileId!,
      );
      if (first['outcome'] !== 'DECLARED') throw new Error(`témoin : ${String(first['outcome'])}`);
      const out: Batch = {
        trip: w.trip,
        holder: w.holder,
        guest: w.guest,
        first: String(first['charge_id']),
        again: again['outcome'] === 'DECLARED' ? String(again['charge_id']) : null,
        againOutcome: again['outcome'],
        absurd: absurd['outcome'] === 'DECLARED' ? String(absurd['charge_id']) : null,
        absurdOutcome: absurd['outcome'],
        otherTrip: o.trip,
        otherHolder: o.holder,
        files: [p1.fileId!, p2.fileId!, p3.fileId!, po.fileId!],
      };
      return out;
    }),
  );
  batches.set(c.country, made);
  return made;
}

/** Transaction ANNULÉE du travailleur payment_command à l'instant donné. */
const asWorker = <T>(virtualNow: string, fn: (tx: Tx) => Promise<T>): Promise<T> =>
  withRole('app_worker', (client) => payTx(client, { worker: 'payment_command', virtualNow }, fn));

interface Debit {
  readonly id: string;
  readonly amount_minor: string;
  readonly leg_host_minor: string;
  readonly leg_platform_minor: string;
  readonly guest_agreed: boolean;
  readonly status: string;
  readonly tender_operation_id: string;
}
async function debitsOf(tx: Tx, charge: string): Promise<Debit[]> {
  return (await tx.query<Debit>('SELECT * FROM test_fixture.us318_post_trip_charges($1)', [charge]))
    .rows;
}

describe.each(COUNTRIES)('RT-L3 sinistres entre particuliers ($country, $currency)', (c) => {
  const a = amountsOf(c);
  const total = a['fine']! + a['fee']!;

  // -----------------------------------------------------------------------------------------
  // RT-L3-S04 — double débit : la même amende refacturée deux fois
  it('RT-L3-S04 (L3-PM-29) — observation F-L3-SIN-01 : la même amende déclarée deux fois (deux photos du même procès-verbal) est acceptée et DEUX débits séparés sont notifiés au voyageur', async () => {
    const b = await batchOf(c);
    expect(b.againOutcome).toBe('DECLARED'); // la seconde déclaration n'est pas refusée
    expect(b.again).not.toBeNull();
    await asWorker(DECLARED_AT, async (tx) => {
      const ids = [b.first, b.again!];
      for (const id of ids) {
        expect(
          (await tx.query<Row>(EXECUTE, [id, uuid()])).rows[0],
          'exécution du travailleur',
        ).toEqual({ outcome: 'DONE', code: null });
      }
      const debits = (await Promise.all(ids.map((id) => debitsOf(tx, id)))).flat();
      // deux débits distincts, de même montant, pour un seul fait générateur
      expect(debits).toHaveLength(2);
      for (const d of debits) {
        expect(d).toMatchObject({
          amount_minor: total.toString(),
          leg_host_minor: a['fine']!.toString(),
          leg_platform_minor: a['fee']!.toString(),
          guest_agreed: false,
          status: 'NOTIFIED',
        });
      }
      // le voyageur est débité de DEUX fois le total de l'amende
      expect(debits.reduce((s, d) => s + BigInt(d.amount_minor), 0n)).toBe(2n * total);
    });
  });

  // CONSTAT F-L3-SIN-01 → suite (US-318) : une même amende (trip, nature, fait, montant) ne se
  // refacture qu'une fois, quelle que soit la photo ; la seconde déclaration est refusée
  it.fails(
    'RT-L3-S04 — CONSTAT F-L3-SIN-01 : la seconde déclaration du même fait et du même montant sur le même trip est refusée',
    async () => {
      const b = await batchOf(c);
      expect(b.first).toMatch(/^[0-9a-f-]{36}$/);
      expect(b.againOutcome).not.toBe('DECLARED');
    },
  );

  // -----------------------------------------------------------------------------------------
  // RT-L3-S04 — « pièce » et montant : aucun lien entre l'une et l'autre
  it('RT-L3-S04 (L3-PM-29) — observation F-L3-SIN-02 : une photo quelconque justifie un montant absurde, exécuté à la seconde de la déclaration, sans réponse ni contestation possible du voyageur', async () => {
    const b = await batchOf(c);
    expect(b.absurdOutcome).toBe('DECLARED');
    expect(b.absurd).not.toBeNull();
    // à l'instant même de la déclaration, le travailleur l'exécute (aucune fenêtre de réponse)
    await asWorker(DECLARED_AT, async (tx) => {
      const state = await tx.query<Row>('SELECT * FROM test_fixture.us318_traffic_charge($1)', [
        b.absurd,
      ]);
      expect(state.rows[0]).toMatchObject({ execution_status: 'PENDING', due: true });
      expect((await tx.query<Row>(EXECUTE, [b.absurd, uuid()])).rows[0]).toEqual({
        outcome: 'DONE',
        code: null,
      });
      const [d] = await debitsOf(tx, b.absurd!);
      expect(d).toMatchObject({
        amount_minor: a['absurdTotal']!.toString(),
        leg_host_minor: a['absurd']!.toString(),
        guest_agreed: false,
        status: 'NOTIFIED',
      });
    });
  });

  // CONSTAT F-L3-SIN-02 → suite (US-318) : comme les frais annexes d'US-706 (BR-REIMB-02 / 03,
  // BR-TT-02), le voyageur a un délai pour payer ou contester avant tout débit ; une refacturation
  // n'est pas exécutée à l'instant de sa déclaration
  it.fails(
    'RT-L3-S04 — CONSTAT F-L3-SIN-02 : une refacturation n’est pas exécutée à l’instant de sa déclaration (délai de réponse et contestation du voyageur)',
    async () => {
      const b = await batchOf(c);
      expect(b.absurd).not.toBeNull();
      await asWorker(DECLARED_AT, async (tx) => {
        const r = (await tx.query<Row>(EXECUTE, [b.absurd, uuid()])).rows[0]!;
        expect(r['outcome']).not.toBe('DONE');
        expect(await debitsOf(tx, b.absurd!)).toEqual([]);
      });
    },
  );

  // -----------------------------------------------------------------------------------------
  // pièces : reçu réutilisé, octets réutilisés, prévisualisation par un tiers
  it('RT-L3-S04 (L3-PM-29) : un reçu ne sert qu’une fois — même fichier, fichier d’un autre trip, fichier inconnu, mêmes octets sur un autre trip ; le récapitulatif et la déclaration refusent un tiers (voyageur, hôte d’un autre trip, jeton inconnu) sans rien écrire ; témoin : la pièce propre à ce trip est acceptée', async () => {
    const b = await batchOf(c);
    await withRole('app_api', (api) =>
      withTestTransaction(api, { virtualNow: DECLARED_AT }, async (tx) => {
        const h = (await openSession(tx, b.holder)).hash;
        const g = (await openSession(tx, b.guest)).hash;
        const ho = (await openSession(tx, b.otherHolder)).hash;
        await subjectKey(tx, b.holder);
        await subjectKey(tx, b.otherHolder);
        const occurred = plus(START, 7200);
        const count = async (): Promise<string> =>
          (
            await tx.query<{ n: string }>(
              'SELECT pg_catalog.count(*)::text AS n FROM test_fixture.us318_traffic_charges($1)',
              [b.trip],
            )
          ).rows[0]!.n;
        const before = await count();
        // pièce neuve du titulaire (témoin) : le récapitulatif est rendu, rien n'est écrit
        const fresh = await shoot(tx, h, b.trip, 'TRAFFIC', 'DAMAGE_06');
        expect(fresh.outcome).toBe('DONE');
        const preview = await declare(
          tx,
          h,
          b.trip,
          'TOLL',
          occurred,
          a['fine']!,
          fresh.fileId!,
          true,
        );
        expect(preview['outcome']).toBe('PREVIEW');
        expect(await count()).toBe(before);
        // tiers : même réponse qu'un trip inconnu, aucun corps, aucune écriture
        for (const [label, who] of [
          ['voyageur', g],
          ['hôte d’un autre trip', ho],
          ['jeton inconnu', randomBytes(32)],
        ] as const) {
          for (const mode of [true, false]) {
            const r = await declare(
              tx,
              who,
              b.trip,
              'TOLL',
              occurred,
              a['fine']!,
              fresh.fileId!,
              mode,
            );
            expect(r['outcome'], `${label} ${mode ? 'récapitulatif' : 'déclaration'}`).toBe(
              'NOT_FOUND',
            );
            expect(r['body'], label).toBeNull();
          }
        }
        expect(await count()).toBe(before);
        // reçu réutilisé : fichier déjà utilisé, fichier d'un autre trip, fichier inconnu
        for (const [label, file] of [
          ['fichier déjà utilisé', b.files[0]!],
          ['fichier d’un autre trip', b.files[3]!],
          ['fichier inconnu', uuid()],
        ] as const) {
          const r = await declare(tx, h, b.trip, 'TOLL', occurred, a['fine']!, file);
          expect(r['outcome'], label).toBe('TRAFFIC_EVIDENCE_REQUIRED');
        }
        expect(await count()).toBe(before);
        // mêmes OCTETS qu'une pièce d'un autre trip : la chaîne de photos refuse l'empreinte déjà
        // vue (0176) ; témoin : l'envoi d'octets neufs sur l'autre trip est accepté
        const bytes = randomBytes(64);
        const onOther = await shoot(tx, ho, b.otherTrip, 'TRAFFIC', 'DAMAGE_02', bytes);
        expect(onOther.outcome).toBe('DONE');
        const reused = await shoot(tx, h, b.trip, 'TRAFFIC', 'DAMAGE_05', bytes);
        expect(reused.outcome).toBe('PHOTO_DUPLICATE');
        expect(reused.fileId).toBeNull();
      }),
    );
    // app_anon : aucun EXECUTE sur le récapitulatif ni sur la vue de l'hôte
    await withRole('app_anon', async (client) => {
      await expect(
        client.query(DECLARE, [
          randomBytes(32),
          uuid(),
          uuid(),
          'TOLL',
          START,
          '100',
          uuid(),
          true,
        ]),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        client.query('SELECT core.claim_host_trip_claims($1, $2::uuid)', [randomBytes(32), uuid()]),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  // -----------------------------------------------------------------------------------------
  // montant et jambes falsifiés
  it('RT-L3-S04 (L3-PM-29) : montant et jambes ne se falsifient pas — écritures directes refusées (42501) sous les trois rôles ; un débit déjà notifié ne se réécrit pas (conflit), des jambes qui ne somment pas au montant sont refusées ; témoin : le rejeu identique rend REPLAYED', async () => {
    const b = await batchOf(c);
    const attacks: readonly string[] = [
      `UPDATE core.claim_traffic_charge SET amount_minor = amount_minor * 10, leg_host_minor = leg_host_minor * 10, total_minor = total_minor * 10`,
      `UPDATE core.claim_traffic_charge SET execution_status = 'DONE'`,
      `UPDATE core.claim_traffic_charge SET fee_bps = 0, admin_fee_minor = 0`,
      'DELETE FROM core.claim_traffic_charge',
      'TRUNCATE core.claim_traffic_charge',
      `INSERT INTO core.claim_traffic_charge (id) VALUES (gen_random_uuid())`,
      `UPDATE core.claim_theft_case SET status = 'RETURNED', closed_at = '2073-01-01T00:00:00Z'::timestamptz`,
      'DELETE FROM core.claim_theft_case',
      `INSERT INTO core.claim_theft_case (id) VALUES (gen_random_uuid())`,
      'UPDATE core.claim_incident_report SET third_party = NOT third_party',
      'DELETE FROM core.claim_incident_report',
      `UPDATE core.payment_post_trip_charge SET amount_minor = 1`,
      'DELETE FROM core.payment_post_trip_charge',
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
    await asWorker(DECLARED_AT, async (tx) => {
      expect((await tx.query<Row>(EXECUTE, [b.first, uuid()])).rows[0]).toEqual({
        outcome: 'DONE',
        code: null,
      });
      const [d] = await debitsOf(tx, b.first);
      const charge = d!.id;
      const legs = (host: bigint, platform: bigint): string =>
        JSON.stringify({
          HOST: host.toString(),
          INSURER: '0',
          TAX_THIRD_PARTY: '0',
          PLATFORM: platform.toString(),
        });
      const call = (amount: bigint, json: string) =>
        tx.query<Row>(NOTIFY, [
          uuid(),
          b.trip,
          b.first,
          d!.tender_operation_id,
          amount.toString(),
          json,
        ]);
      // témoin : même contenu ⇒ REPLAYED, même débit (aucun second débit)
      expect((await call(total, legs(a['fine']!, a['fee']!))).rows[0]).toEqual({
        outcome: 'REPLAYED',
        charge_id: charge,
      });
      // montant gonflé, jambes cohérentes : conflit de contenu (même origine, autre contenu)
      expect(
        await caught(tx, () => call(total + 1n, legs(a['fine']! + 1n, a['fee']!))),
      ).toMatchObject({
        code: '23000',
        constraint: 'mit_charge_conflict',
      });
      // jambe de la plateforme gonflée sans changer le montant : somme ≠ montant
      expect(await caught(tx, () => call(total, legs(a['fine']!, a['fee']! + 1n)))).toMatchObject({
        code: '23000',
        constraint: 'mit_charge_legs_sum',
      });
      // jambe négative : refusée (entiers non négatifs)
      expect(
        await caught(tx, () =>
          call(
            total,
            `{"HOST":"${total + 1n}","INSURER":"-1","TAX_THIRD_PARTY":"0","PLATFORM":"0"}`,
          ),
        ),
      ).toMatchObject({ code: '23000', constraint: 'payment_operation_leg_negative' });
      // l'exécution n'a pas été dédoublée par ces tentatives
      expect(await debitsOf(tx, b.first)).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------------------------
  // commandes du travailleur : jamais sous l'API, même avec un contexte falsifié
  it('RT-L3-S05 / V04 : les commandes de vol et de refacturation du travailleur sont fermées à l’API (contexte WORKER falsifié par set_config) et à un autre travailleur ; la référence d’assureur ne porte aucune donnée personnelle', async () => {
    const calls: readonly string[] = [
      `SELECT core.claim_cmd_open_theft_case('${uuid()}')`,
      `SELECT core.claim_cmd_close_theft_case('${uuid()}')`,
      `SELECT core.claim_cmd_lock_theft_declaration('${uuid()}')`,
      `SELECT core.claim_cmd_record_theft_declaration('${uuid()}', 'ref-1')`,
      `SELECT * FROM core.claim_theft_cases_due(10)`,
      `SELECT * FROM core.claim_theft_declarations_due(10)`,
      `SELECT * FROM core.claim_traffic_charges_due(10)`,
      `SELECT * FROM core.claim_cmd_execute_traffic_charge('${uuid()}', '${uuid()}')`,
      `SELECT core.claim_cmd_defer_traffic_charge('${uuid()}', 'EXECUTION_FAILED')`,
    ];
    // sous l'API : aucun EXECUTE, même avec un contexte de travailleur posé à la main
    await withRole('app_api', (api) =>
      withTestTransaction(api, {}, async (tx) => {
        await tx.query(
          `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
                  pg_catalog.set_config('app.worker_name', 'payment_command', true)`,
        );
        for (const sql of calls) {
          expect(await failure(tx, sql), sql).toMatchObject({ code: '42501' });
        }
      }),
    );
    // sous un autre travailleur : refus de la commande (contrainte nommée)
    await withRole('app_worker', (client) =>
      payTx(client, { worker: 'trip_overdue', virtualNow: DECLARED_AT }, async (tx) => {
        for (const sql of calls) {
          expect(await failure(tx, sql), sql).toMatchObject({
            code: '42501',
            constraint: 'claim_p2p_command_forbidden',
          });
        }
      }),
    );
    // référence d'assureur : le format est jugé avant toute lecture
    await asWorker(DECLARED_AT, async (tx) => {
      for (const ref of ['ana@correo.com', 'Ana Pérez +507 6123 4567', 'ref avec espaces', '']) {
        expect(
          await failure(tx, 'SELECT core.claim_cmd_record_theft_declaration($1, $2)', [
            uuid(),
            ref,
          ]),
          ref,
        ).toMatchObject({ code: '22023' });
      }
      // témoin : une référence bien formée passe le contrôle de format (dossier inconnu)
      const ok = await tx.query<{ r: string }>(
        'SELECT core.claim_cmd_record_theft_declaration($1, $2) AS r',
        [uuid(), 'FAKE-INS:2073.ref_1'],
      );
      expect(ok.rows[0]?.r).toBe('NOT_FOUND');
    });
  });

  it('RT-L3-S05 (L3-PM-17) : une déclaration de vol ne s’envoie pas tant que insurer_contract_active est faux (lu en base) — aucun dossier ne sort de la file des déclarations ; le versement du trip reste retenu', async () => {
    await asWorker(plus(END, 25 * 3600), async (tx) => {
      const sw = await tx.query<{ on: boolean }>(
        `SELECT core.config_go_live('insurer_contract_active', $1) AS on`,
        [c.country],
      );
      expect(sw.rows[0]?.on).toBe(false);
      const pw = await tx.query<{ on: boolean }>(
        `SELECT core.config_go_live('payouts_enabled', $1) AS on`,
        [c.country],
      );
      expect(pw.rows[0]?.on).toBe(false);
      // un trip en vol présumé, dossier ouvert par la vraie commande
      const trip = uuid();
      await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
        trip,
        uuid(),
        uuid(),
        uuid(),
        c.country,
        c.currency,
        c.timezone,
        START,
        END,
      ]);
      await tx.query('SELECT test_fixture.us309_set_status($1, $2)', [trip, 'IN_PROGRESS']);
      await tx.query('SELECT test_fixture.us318_overdue_t24h($1)', [trip]);
      expect(
        (await tx.query<{ r: string }>('SELECT core.claim_cmd_open_theft_case($1) AS r', [trip]))
          .rows[0]?.r,
      ).toBe('OPENED');
      const [theft] = (
        await tx.query<Row>('SELECT * FROM test_fixture.us318_theft_case($1)', [trip])
      ).rows;
      // la déclaration n'est jamais « due » (aucun dossier du pays, aucun envoi) ; l'envoi forcé est refusé
      const due = (
        await tx.query<{ id: string }>(
          'SELECT theft_case_id::text AS id FROM core.claim_theft_declarations_due(100)',
        )
      ).rows.filter((r) => r.id === theft!['id']);
      expect(due).toEqual([]);
      for (const sql of [
        'SELECT core.claim_cmd_lock_theft_declaration($1) AS r',
        `SELECT core.claim_cmd_record_theft_declaration($1, 'FORGED-REF-1') AS r`,
      ]) {
        const r = await tx.query<{ r: string }>(sql, [theft!['id']]);
        expect(r.rows[0]?.r, sql).toBe('INSURER_CONTRACT_INACTIVE');
      }
      expect(
        (await tx.query<Row>('SELECT * FROM test_fixture.us318_theft_case($1)', [trip])).rows[0],
      ).toMatchObject({
        status: 'THEFT_INVESTIGATION',
        insurer_status: 'PENDING',
        insurer_ref: null,
      });
    });
  });
});
