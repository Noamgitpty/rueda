/**
 * US-313 — red team du lot 3, axe « no-show et refus » (19 US-313 critère 2 ; pré-mortem du lot 3,
 * RT-L3-NS01 ; risque L3-PM-18). Rôles de PRODUCTION seulement (`withRole` : assertion L0-05 en tête
 * de chaque test), USD (PA) et PYG sans décimale (PY). Préparation (trip capturé, remise ouverte)
 * VALIDÉE sur un trip neuf par test ; toutes les déclarations jouées dans des transactions ANNULÉES.
 * Horloge virtuelle 2091 (aucune autre preuve ne l'utilise). TESTS SEULEMENT : aucun correctif.
 * Rapport : docs/team/redteam/L3-remise.md.
 *
 * Attendus (jamais le code testé) :
 * - 19 US-307 critère 1 (« T+50 min, grâce 60 ⇒ NO_SHOW_TOO_EARLY ») et pré-mortem L3-PM-18
 *   (« NO_SHOW_TOO_EARLY jusqu'à T+59 ; T+60 accepté ») ; 08 BR-CXL-13 (no-show de l'hôte à partir de
 *   30 min) ; 08 BR-CXL-08 (fenêtre de 72 h, message de la partie dans [début − 1 h ; déclaration −
 *   15 min]) ; délais en heure SERVEUR depuis le début PRÉVU du trip : l'heure de l'appareil, le
 *   fuseau du téléphone et tout champ de la requête sont sans effet (la commande ne reçoit que le
 *   jeton de session, le trip et l'identifiant de la demande) ;
 * - premier instant qui compte, à la SECONDE : T+59 min 59 s est encore trop tôt, T+60 min pile est
 *   accepté (les preuves L0 d'US-307 jouent des minutes entières).
 *
 * « Extension : je suis en retard » (pré-mortem NS01, demandée deux fois) : aucune commande de ce nom
 * n'existe sur main au 2026-11-22 (0163 à 0173) ; le scénario est SANS OBJET tant que la story qui
 * l'introduirait n'est pas livrée (voir le rapport : EN ATTENTE).
 */
import { legVector, settlementVector } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { setSessionContext } from '../../../src/index.ts';
import { withRole, withTestTransaction } from '../../../src/testing/index.ts';
import { COUNTRIES } from '../../support/avl.ts';
import type { CountryCase } from '../../support/avl.ts';
import { openSession } from '../../support/iam.ts';
import { applySignedStatus, recordOperation, uuid } from '../../support/pay.ts';
import type { Legs } from '../../support/pay.ts';
import { golden } from '../../support/settlement.ts';

type Tx = pg.ClientBase;
type Row = Record<string, unknown>;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
const REPORT = 'SELECT * FROM core.trip_cmd_report_no_show($1, $2::uuid, $3::uuid)';
const START_MS = Date.UTC(2091, 3, 14, 10, 0, 0);
const iso = (ms: number): string => new Date(ms).toISOString();

/** Vecteurs de l'export des oracles par devise : capture et règlement de no-show (T05 / T41). */
const VECTORS: readonly { readonly capture: string; readonly settlement: string }[] = [
  { capture: 'TJ01', settlement: 'T05' },
  { capture: 'TJ08a', settlement: 'T41' },
];
const vectorsOf = (c: CountryCase) => {
  const v = VECTORS.find((x) => legVector(golden, x.capture).currency === c.currency);
  if (v === undefined) throw new Error(`aucun vecteur en ${c.currency}`);
  return v;
};

interface World {
  readonly trip: string;
  readonly guest: string;
  readonly holder: string;
}

/** Trip neuf du vecteur du pays, capturé (webhook signé, report), remise ouverte. VALIDÉ. */
async function world(worker: Tx, c: CountryCase): Promise<World> {
  const ids = vectorsOf(c);
  const v = settlementVector(golden, ids.settlement);
  const bookedAtMs = START_MS + v.trip.bookedAtMinutes * MINUTE;
  const capLegs: Legs = { ...legVector(golden, ids.capture).legsMinor };
  const total = LEGS.reduce((s, k) => s + capLegs[k], 0n);
  const trip = uuid();
  const guest = uuid();
  let holder = '';
  await withTestTransaction(worker, { virtualNow: iso(bookedAtMs), commit: true }, async (tx) => {
    await setSessionContext(tx, { kind: 'WORKER', workerName: 'payment_command' });
    await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
      trip,
      guest,
      uuid(),
      uuid(),
      c.country,
      c.currency,
      c.timezone,
      iso(START_MS),
      iso(START_MS + v.trip.days * 24 * HOUR),
    ]);
    const account = (
      await tx.query<{ id: string }>('SELECT test_fixture.us024_psp_account($1) AS id', [c.country])
    ).rows[0]!.id;
    const op = await recordOperation(tx, {
      tripId: trip,
      accountId: account,
      kind: 'CAPTURE',
      amountMinor: total,
      currency: c.currency,
      idemPlain: `trip:${trip}:capture:${uuid()}`,
      legs: capLegs,
    });
    expect(await applySignedStatus(tx, op.operation_id, 'SUCCEEDED')).toBe('APPLIED');
    await tx.query('SELECT core.settlement_cmd_apply_leg_movement($1)', [op.operation_id]);
    await setSessionContext(tx, { kind: 'WORKER', workerName: 'trip_lifecycle' });
    await tx.query(
      `SELECT core.booking_cmd_trip_transition($1, 'CHECKIN_OPEN', 'CHECKIN_WINDOW_OPENED', NULL)`,
      [trip],
    );
    holder = (await tx.query<{ id: string }>('SELECT test_fixture.us307_holder($1) AS id', [trip]))
      .rows[0]!.id;
  });
  return { trip, guest, holder };
}

/** Déclaration d'une partie à l'instant virtuel `ms`, transaction ANNULÉE. */
async function declare(api: Tx, w: World, who: 'HOST' | 'GUEST', ms: number): Promise<Row> {
  return withTestTransaction(api, { virtualNow: iso(ms) }, async (tx) => {
    const s = await openSession(tx, who === 'HOST' ? w.holder : w.guest);
    return (await tx.query<Row>(REPORT, [s.hash, w.trip, uuid()])).rows[0] ?? {};
  });
}

describe.each(COUNTRIES)('RT-L3 no-show déclaré trop tôt ($country, $currency)', (c) => {
  it('RT-L3-NS01 (L3-PM-18) : l’hôte à T+59 min 59 s ⇒ NO_SHOW_TOO_EARLY, à T+60 min ⇒ DONE ; le voyageur (hôte absent) à T+29 min 59 s ⇒ NO_SHOW_TOO_EARLY, à T+30 min ⇒ la preuve est exigée (aucun message tracé)', async () => {
    await withRole('app_api', async (api) => {
      await withRole('app_worker', async (worker) => {
        const w = await world(worker, c);
        // l'hôte : un instant avant la grâce du pays (60 min), la déclaration est refusée
        expect(await declare(api, w, 'HOST', START_MS + 60 * MINUTE - 1000)).toMatchObject({
          outcome: 'NO_SHOW_TOO_EARLY',
        });
        // une heure avant le début : trop tôt aussi (l'heure du téléphone n'entre pas en jeu)
        expect(await declare(api, w, 'HOST', START_MS - HOUR)).toMatchObject({
          outcome: 'NO_SHOW_TOO_EARLY',
        });
        // témoin : à la seconde où la grâce est atteinte, la même commande est acceptée
        expect(await declare(api, w, 'HOST', START_MS + 60 * MINUTE)).toMatchObject({
          outcome: 'DONE',
        });
        // le voyageur qui signale l'hôte absent : 30 min (BR-CXL-13), puis la preuve (BR-CXL-08)
        expect(await declare(api, w, 'GUEST', START_MS + 30 * MINUTE - 1000)).toMatchObject({
          outcome: 'NO_SHOW_TOO_EARLY',
        });
        expect(await declare(api, w, 'GUEST', START_MS + 30 * MINUTE)).toMatchObject({
          outcome: 'NO_SHOW_EVIDENCE_REQUIRED',
        });
      });
    });
  });
});
