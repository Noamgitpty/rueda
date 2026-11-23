/**
 * US-313 — red team du lot 3, passe de la porte : VARIANTES d'attaque contre les correctifs
 * fusionnés ou en cours (RT-L3-S02, RT-L3-S04 ; risques L3-PM-26, L3-PM-29). Rôles de PRODUCTION
 * seulement (`withRole` : assertion L0-05 en tête de chaque test), USD (PA) et PYG sans décimale
 * (PY). TESTS SEULEMENT : aucun correctif, aucune migration, aucune fixture nouvelle. Rapport :
 * docs/team/redteam/L3-porte.md. Horloges virtuelles 2077 (amendes) et 2078 (frais annexes) :
 * aucune autre preuve ne les utilise. Tout est écrit dans une transaction ANNULÉE (la déclaration
 * est une commande de l'API ; aucune exécution du travailleur n'est nécessaire à ces preuves).
 *
 * Règles de jeu (comme `rt-l3-05` et `rt-l3-06`) : un test vert prouve que l'attaque est BLOQUÉE.
 * Un défaut est prouvé par un `it.fails` nommé par son constat, doublé d'un test vert
 * « observation » qui affirme que l'attaque a bien eu lieu (une observation absente fait rougir
 * l'`it.fails`). Chaque `it.fails` juge le SIGNAL ATTENDU après correction (un refus ou une
 * escalade, jamais une façon de corriger).
 *
 * Variantes jouées :
 * - correctif #300 (0181, référence unique par trip : clé = majuscules, lettres et chiffres) : le
 *   même procès-verbal écrit avec des zéros de tête en moins, ou la lettre O pour le zéro, a une
 *   AUTRE clé ; un préfixe ajouté ou retiré aussi (limite assumée, observation seule) ; le plafond
 *   par pays est par refacturation, jamais cumulé par trip ; la clé est par trip, jamais par hôte :
 *   le même numéro est refacturé à deux voyageurs ;
 * - correctif #299 (0182, en revue au moment de cette passe : annulation après contestation = frais
 *   abandonné pour CE type) : l'hôte redemande le même fait sous un AUTRE type (nettoyage puis tabac,
 *   mêmes pièces) et obtient une fenêtre de réponse neuve.
 *
 * Attendus (jamais le code testé) : 08 BR-REIMB-05 (« interdites : doublons, montant non
 * justifié »), BR-REIMB-02 (la fenêtre du voyageur ne se rouvre jamais), BR-TT-02 à 04 ; 19 US-318
 * critère 3 ; pré-mortem L3-PM-26 et L3-PM-29.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SubjectKeyStore } from '../../../src/audit/index.ts';
import { FakeKeyWrapper, withRole, withTestTransaction } from '../../../src/testing/index.ts';
import { setActor } from '../../support/audit.ts';
import { COUNTRIES } from '../../support/avl.ts';
import type { CountryCase } from '../../support/avl.ts';
import { openSession } from '../../support/iam.ts';
import {
  amountsOf as incidentalAmounts,
  CANCEL,
  DISPUTE,
  DISPUTE_REASON,
  invoices,
  photo,
  session,
  submit,
} from '../../support/incidental.ts';
import type { Row } from '../../support/incidental.ts';
import { plus, sha, uuid } from './support-l3.ts';
import type { Tx } from './support-l3.ts';

// -- amendes, péages et fourrières ------------------------------------------------------------
const START = '2077-04-07T10:00:00.000Z';
const END = '2077-04-10T10:00:00.000Z';
const DECLARED_AT = plus(END, 3600);

const CAPTURE = 'SELECT * FROM core.trip_cmd_open_photo_capture($1, $2::uuid, $3, $4)';
const ADD = `SELECT * FROM core.trip_cmd_add_inspection_photo($1, $2::uuid, $3, $4::uuid, $5, $6::uuid,
                                                              $7, $8::bigint, $9, $10::timestamptz)`;
const DECLARE = `SELECT outcome, charge_id::text AS charge_id, body
  FROM core.claim_cmd_declare_traffic_charge($1, $2::uuid, $3::uuid, $4, $5::timestamptz, $6::bigint,
                                             $7::uuid, $8, $9)`;

const setNow = (tx: Tx, iso: string): Promise<unknown> =>
  tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [iso]);

const keys = new SubjectKeyStore(new FakeKeyWrapper());
async function subjectKey(tx: Tx, userId: string): Promise<void> {
  await setActor(tx, { kind: 'GUEST', actorId: userId });
  const k = await keys.dekFor(tx, { type: 'USER', id: userId }, 'create');
  if (k.status !== 'OK') throw new Error(`clé du sujet : ${k.status}`);
}

/** Photo par la chaîne d'US-303 (jeton puis envoi) ; octets tirés au hasard (empreinte unique). */
async function shoot(tx: Tx, who: Buffer, trip: string, slot: string): Promise<string> {
  const cap = (await tx.query<Row>(CAPTURE, [who, trip, 'TRAFFIC', slot])).rows[0]!;
  if (cap['outcome'] !== 'DONE') throw new Error(`jeton : ${String(cap['outcome'])}`);
  const body = randomBytes(64);
  const fileId = uuid();
  const r = (
    await tx.query<Row>(ADD, [
      who,
      trip,
      'TRAFFIC',
      cap['capture_id'],
      slot,
      fileId,
      'image/jpeg',
      body.length,
      sha(body),
      null,
    ])
  ).rows[0]!;
  if (r['outcome'] !== 'DONE') throw new Error(`photo : ${String(r['outcome'])}`);
  return fileId;
}

interface TrafficWorld {
  readonly trip: string;
  readonly holder: string;
  readonly h: Buffer;
  next: number;
}

/** Trip du pays rendu à END, loyer par carte, séance du titulaire ; `org` : compte d'hôte partagé. */
async function trafficWorld(tx: Tx, c: CountryCase, org: string): Promise<TrafficWorld> {
  const trip = uuid();
  await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
    trip,
    uuid(),
    org,
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
    c.priceStepMinor === 1 ? '30000' : '2000000',
  ]);
  await setNow(tx, DECLARED_AT);
  const holder = (
    await tx.query<{ h: string }>('SELECT test_fixture.us309_holder($1)::text AS h', [trip])
  ).rows[0]!.h;
  const h = (await openSession(tx, holder)).hash;
  await subjectKey(tx, holder);
  return { trip, holder, h, next: 1 };
}

/** Déclare un fait avec une pièce NEUVE (un angle de plus de la série TRAFFIC) ; rend la ligne. */
async function declareOn(
  tx: Tx,
  w: TrafficWorld,
  kind: string,
  amount: bigint,
  reference: string,
  preview = false,
): Promise<Row> {
  const slot = `DAMAGE_${String(w.next).padStart(2, '0')}`;
  w.next += 1;
  const file = await shoot(tx, w.h, w.trip, slot);
  return (
    await tx.query<Row>(DECLARE, [
      w.h,
      uuid(),
      w.trip,
      kind,
      plus(START, 3600 + w.next),
      amount.toString(),
      file,
      preview,
      reference,
    ])
  ).rows[0]!;
}

const chargesOn = async (tx: Tx, trip: string): Promise<Row[]> =>
  (await tx.query<Row>('SELECT * FROM test_fixture.us318s_charges($1)', [trip])).rows;

/** Transaction ANNULÉE sous app_api à l'instant de la déclaration. */
const asApi = (body: (tx: Tx) => Promise<void>): Promise<void> =>
  withRole('app_api', (api) => withTestTransaction(api, { virtualNow: DECLARED_AT }, body));

describe.each(COUNTRIES)('RT-L3 variantes contre #300 ($country, $currency)', (c) => {
  const FINE = c.priceStepMinor === 1 ? 1230n : 25010n;

  // -----------------------------------------------------------------------------------------
  // zéros de tête et lettre O pour le zéro : le même procès-verbal, une autre clé
  async function twoSpellings(
    tx: Tx,
    base: string,
    variant: string,
  ): Promise<{ first: Row; second: Row; trip: string }> {
    const w = await trafficWorld(tx, c, uuid());
    const first = await declareOn(tx, w, 'FINE', FINE, base);
    expect(first['outcome']).toBe('DECLARED');
    const second = await declareOn(tx, w, 'FINE', FINE, variant);
    return { first, second, trip: w.trip };
  }

  it('RT-L3-S04 — observation F-L3-SIN-03 : le même procès-verbal écrit « PV 000123 » puis « PV 123 » (zéros de tête), ou « PV 100200 » puis « PV 1OO2OO » (lettre O), est refacturé deux fois ; deux refacturations existent', async () => {
    await asApi(async (tx) => {
      const zeros = await twoSpellings(tx, 'PV 000123', 'PV 123');
      expect(zeros.second['outcome']).toBe('DECLARED');
      expect((await chargesOn(tx, zeros.trip)).map((r) => r['reference_key'])).toEqual([
        'PV000123',
        'PV123',
      ]);
      const letter = await twoSpellings(tx, 'PV 100200', 'PV 1OO2OO');
      expect(letter.second['outcome']).toBe('DECLARED');
      expect((await chargesOn(tx, letter.trip)).map((r) => r['reference_key'])).toEqual([
        'PV100200',
        'PV1OO2OO',
      ]);
    });
  });

  // CONSTAT F-L3-SIN-03 : la clé de référence (majuscules, lettres et chiffres) ne reconnaît pas
  // un numéro écrit avec ou sans zéros de tête ; correction attendue : une clé canonique qui les
  // ignore (le signal exact est TRAFFIC_DUPLICATE, comme pour les autres écritures du même PV)
  it.fails(
    'RT-L3-S04 — CONSTAT F-L3-SIN-03 (zéros de tête) : « PV 000123 » puis « PV 123 » sur le même trip est refusé TRAFFIC_DUPLICATE',
    async () => {
      await asApi(async (tx) => {
        const r = await twoSpellings(tx, 'PV 000123', 'PV 123');
        expect(r.second['outcome']).toBe('TRAFFIC_DUPLICATE');
      });
    },
  );

  it.fails(
    'RT-L3-S04 — CONSTAT F-L3-SIN-03 (lettre O pour le zéro) : « PV 100200 » puis « PV 1OO2OO » sur le même trip est refusé TRAFFIC_DUPLICATE',
    async () => {
      await asApi(async (tx) => {
        const r = await twoSpellings(tx, 'PV 100200', 'PV 1OO2OO');
        expect(r.second['outcome']).toBe('TRAFFIC_DUPLICATE');
      });
    },
  );

  it('RT-L3-S04 — limite assumée (observation seule) : un préfixe ajouté ou retiré (« A-77-4410 » puis « 77-4410 ») a une autre clé ; aucune équivalence de texte libre n’est prétendue, le plafond cumulé du trip est la parade (voir ci-dessous)', async () => {
    await asApi(async (tx) => {
      const r = await twoSpellings(tx, 'A-77-4410', '77-4410');
      expect(r.second['outcome']).toBe('DECLARED');
      expect((await chargesOn(tx, r.trip)).map((x) => x['reference_key'])).toEqual([
        '774410',
        'A774410',
      ]);
    });
  });

  // -----------------------------------------------------------------------------------------
  // plafond : par refacturation, jamais cumulé par trip
  async function threeUnderTheCap(tx: Tx): Promise<{ trip: string; cap: bigint; total: bigint }> {
    const w = await trafficWorld(tx, c, uuid());
    // le plafond du pays est rendu par le récapitulatif (aucune constante de pays ici)
    const probe = await declareOn(tx, w, 'FINE', FINE, `RT-${uuid().slice(0, 8)}`, true);
    expect(probe['outcome']).toBe('PREVIEW');
    const cap = BigInt(String((probe['body'] as Row)['capMinor']));
    const each = (cap * 6n) / 10n;
    expect(each > 0n && each < cap).toBe(true);
    for (const kind of ['FINE', 'TOLL', 'IMPOUND']) {
      const r = await declareOn(tx, w, kind, each, `RT-${uuid().slice(0, 8)}`);
      expect(r['outcome'], kind).toBe('DECLARED');
    }
    return { trip: w.trip, cap, total: each * 3n };
  }

  it('RT-L3-S04 — observation F-L3-SIN-04 : trois refacturations de 60 % du plafond du pays, trois références inventées, sur le même trip, sont toutes acceptées : 180 % du plafond, chacune seule sous le plafond', async () => {
    await asApi(async (tx) => {
      const r = await threeUnderTheCap(tx);
      const rows = await chargesOn(tx, r.trip);
      expect(rows).toHaveLength(3);
      const total = rows.reduce((s, x) => s + BigInt(String(x['amount_minor'])), 0n);
      expect(total).toBe(r.total);
      expect(total > r.cap).toBe(true);
    });
  });

  // CONSTAT F-L3-SIN-04 : le plafond de 0181 borne UNE refacturation ; rien ne borne la somme des
  // refacturations d'un trip (chaque référence inventée de 3 caractères suffit) ; correction
  // attendue : un plafond cumulé par trip (refus de la déclaration qui le dépasse, ou escalade à
  // l'ops), quel que soit le signal
  it.fails(
    'RT-L3-S04 — CONSTAT F-L3-SIN-04 : la somme des refacturations enregistrées sur un trip ne dépasse jamais le plafond du pays',
    async () => {
      await asApi(async (tx) => {
        const r = await threeUnderTheCap(tx);
        const rows = await chargesOn(tx, r.trip);
        expect(rows.length).toBeGreaterThan(0);
        const total = rows.reduce((s, x) => s + BigInt(String(x['amount_minor'])), 0n);
        expect(total <= r.cap).toBe(true);
      });
    },
  );

  // -----------------------------------------------------------------------------------------
  // la clé est par trip : le même numéro sur deux trips du même hôte = deux voyageurs débités
  async function sameNumberTwoGuests(
    tx: Tx,
  ): Promise<{ a: Row; b: Row; tripA: string; tripB: string }> {
    const org = uuid();
    const wa = await trafficWorld(tx, c, org);
    const wb = await trafficWorld(tx, c, org);
    const ref = `PV-${uuid().slice(0, 8)}`;
    const a = await declareOn(tx, wa, 'FINE', FINE, ref);
    expect(a['outcome']).toBe('DECLARED');
    const b = await declareOn(tx, wb, 'FINE', FINE, ref);
    return { a, b, tripA: wa.trip, tripB: wb.trip };
  }

  it('RT-L3-S04 — observation F-L3-SIN-05 : le même numéro de procès-verbal déclaré sur deux trips du MÊME hôte est refacturé à deux voyageurs différents', async () => {
    await asApi(async (tx) => {
      const r = await sameNumberTwoGuests(tx);
      expect(r.b['outcome']).toBe('DECLARED');
      expect(await chargesOn(tx, r.tripA)).toHaveLength(1);
      expect(await chargesOn(tx, r.tripB)).toHaveLength(1);
    });
  });

  // CONSTAT F-L3-SIN-05 : l'unicité de 0181 est par trip ; correction attendue : un même numéro de
  // procès-verbal ne se refacture qu'à un seul voyageur d'un même hôte (refus ou escalade à l'ops)
  it.fails(
    'RT-L3-S04 — CONSTAT F-L3-SIN-05 : un même numéro de procès-verbal déclaré par un même hôte n’est refacturé qu’à un seul voyageur',
    async () => {
      await asApi(async (tx) => {
        const r = await sameNumberTwoGuests(tx);
        expect(r.a['outcome']).toBe('DECLARED');
        expect(r.b['outcome']).not.toBe('DECLARED');
      });
    },
  );
});

// -- frais annexes : changer de type après une contestation et un abandon --------------------
const I_START = '2078-03-07T08:00:00.000Z';
const I_END = '2078-03-10T08:00:00.000Z';
const J0 = '2078-03-10T10:00:00.000Z';
const HOUR_S = 3600;

describe.each(COUNTRIES)('RT-L3 variante contre #299 ($country, $currency)', (c) => {
  const a = incidentalAmounts(c);

  /** Trip rendu à I_END, photos des deux séries, validations, loyer par carte (mêmes fixtures que `rt-l3-05`). */
  async function world(tx: Tx): Promise<{
    trip: string;
    guest: string;
    holder: string;
    inner: string;
    guestInner: string;
  }> {
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
      I_START,
      I_END,
    ]);
    await setNow(tx, I_START);
    await photo(tx, trip, 'CHECKIN', 'FUEL');
    for (const role of ['HOST', 'GUEST']) {
      await tx.query('SELECT test_fixture.us706_validation($1, $2, $3, $4::smallint)', [
        trip,
        'CHECKIN',
        role,
        8,
      ]);
    }
    await setNow(tx, I_END);
    await photo(tx, trip, 'CHECKOUT', 'FUEL');
    const inner = await photo(tx, trip, 'CHECKOUT', 'INT_01');
    const guestInner = await photo(tx, trip, 'CHECKOUT', 'INT_02', 'GUEST');
    await photo(tx, trip, 'CHECKOUT', 'EXT_01');
    for (const role of ['HOST', 'GUEST']) {
      await tx.query('SELECT test_fixture.us706_validation($1, $2, $3, $4::smallint)', [
        trip,
        'CHECKOUT',
        role,
        5,
      ]);
    }
    await tx.query('SELECT test_fixture.us309_returned($1)', [trip]);
    await tx.query('SELECT test_fixture.us309_card_rent($1, $2)', [trip, a['rent']!.toString()]);
    const holder = (
      await tx.query<{ h: string }>('SELECT test_fixture.us309_holder($1)::text AS h', [trip])
    ).rows[0]!.h;
    return { trip, guest, holder, inner, guestInner };
  }

  const outcomeOf = async (tx: Tx, sql: string, args: readonly unknown[]): Promise<unknown> => {
    const r = (await tx.query<Row>(sql, args as unknown[])).rows[0]!;
    return r['r'] ?? r['outcome'];
  };

  /** Nettoyage contesté puis annulé, puis le même fait redemandé sous le type « tabac », mêmes pièces. */
  async function retypeAttack(tx: Tx) {
    const w = await world(tx);
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
    await setNow(tx, plus(J0, 2 * HOUR_S));
    expect(
      await outcomeOf(tx, DISPUTE, [
        await session(tx, w.guest),
        first['invoice_id'],
        DISPUTE_REASON,
        [w.guestInner],
      ]),
    ).toBe('DISPUTED');
    await setNow(tx, plus(J0, 3 * HOUR_S));
    expect(await outcomeOf(tx, CANCEL, [await session(tx, w.holder), first['invoice_id']])).toBe(
      'CANCELLED',
    );
    await setNow(tx, plus(J0, 4 * HOUR_S));
    const again = await submit(tx, await session(tx, w.holder), w.trip, 'SMOKING', a['cleaning']!, [
      w.inner,
    ]);
    return { w, first, again };
  }

  const asApiIncidental = (body: (tx: Tx) => Promise<void>): Promise<void> =>
    withRole('app_api', (api) => withTestTransaction(api, { virtualNow: I_START }, body));

  it('RT-L3-S02 — observation F-L3-FRA-03 : un nettoyage contesté puis annulé est redemandé sous le type « tabac » avec la MÊME pièce ; la demande est acceptée et sa fenêtre de réponse est neuve (72 h), sans décision de l’ops', async () => {
    await asApiIncidental(async (tx) => {
      const { w, again } = await retypeAttack(tx);
      expect(again['outcome']).toBe('SUBMITTED');
      const rows = await invoices(tx, w.trip);
      expect(rows.map((r) => [r['fee_type'], r['status']])).toEqual([
        ['CLEANING', 'CANCELLED_BY_HOST'],
        ['SMOKING', 'AWAITING_GUEST'],
      ]);
      expect((rows[1]!['response_due_at'] as Date).toISOString()).toBe(plus(J0, (4 + 72) * HOUR_S));
      expect(rows[0]!['decided_role']).toBeNull();
    });
  });

  // CONSTAT F-L3-FRA-03 : #299 bloque la redemande du MÊME type après contestation ; le même fait
  // (même pièce) redemandé sous un autre type du nettoyage rouvre la fenêtre. Correction attendue :
  // l'abandon d'un frais contesté vaut pour la pièce (ou le fait), quel que soit le type — refus ou
  // escalade à l'ops, les deux passent
  it.fails(
    'RT-L3-S02 — CONSTAT F-L3-FRA-03 : après une contestation puis une annulation, le même fait (même pièce) redemandé sous un autre type ne rouvre aucune fenêtre de réponse du voyageur',
    async () => {
      await asApiIncidental(async (tx) => {
        const { w, first } = await retypeAttack(tx);
        expect(first['outcome']).toBe('SUBMITTED');
        const rows = await invoices(tx, w.trip);
        // témoin de population : la première demande existe bien, annulée
        expect(rows.map((r) => r['status'])).toContain('CANCELLED_BY_HOST');
        expect(rows.filter((r) => r['status'] === 'AWAITING_GUEST')).toEqual([]);
      });
    },
  );
});
