/**
 * US-213 — parties d'une réservation lues par le travailleur des notifications (migration 0131,
 * ADR-157 ; fixture 9963 d'US-211 réutilisée). Rôles de production seulement (assertion L0-05 par
 * `connectAs`), au Panama (USD) et au Paraguay (PYG). Transactions ANNULÉES.
 *
 * Attendus tirés de 19 US-213 (critère 2 : « la confirmation est envoyée au voyageur et à
 * l'hôte »), de 16 NTF-007 (« hôte : notification […] jamais le numéro de permis ») et de 17 §2.2
 * (NTF ne lit pas les tables d'AVL ni d'IAM : un port fourni par le producteur) et §3.2.1 (l'hôte
 * d'un compte d'hôte est `organization.holder_user_id`), jamais du code testé :
 *   - sous `ntf_dispatcher`, un trip rend son voyageur et le TITULAIRE du compte d'hôte ; un hold
 *     rend en plus son type, son statut, son motif et la présence d'une heure limite de réponse ;
 *     identifiants et codes seulement (aucun nom, aucune coordonnée, aucune pièce, aucun montant) ;
 *   - sujet inconnu ou identifiant absent : NULL ;
 *   - tout autre travailleur, app_worker sans contexte : FORBIDDEN ; app_api et app_anon : aucun
 *     droit d'exécution (42501).
 * La capture refusée d'une demande acceptée (hold REQUEST, RELEASED, PAYMENT_DECLINED) est éprouvée
 * sur le vrai cycle de la demande : l0-us223-request.test.ts.
 */
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { translateDbError } from '../../src/index.ts';
import { connectAs, releaseClient } from '../../src/testing/index.ts';
import { COUNTRIES, inTx, uuid } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { uniquePlate } from '../support/unique.ts';

type Tx = pg.ClientBase;
type Json = Record<string, unknown>;

const PARTIES = 'SELECT core.booking_notification_parties($1, $2::uuid) AS p';

/** Montants de TEST du monde d'US-211 (fixture 9963) ; sans objet ici (aucun montant lu). */
const WORLD: Readonly<Record<string, readonly unknown[]>> = {
  PA: [
    '[{"type":"TRIP_PRICE","amountMinor":"12000"}]',
    35,
    '{"BASICA":"50000","ESTANDAR":"25000","TOTAL":"0"}',
    10000000,
    25000,
  ],
  PY: [
    '[{"type":"TRIP_PRICE","amountMinor":"1000000"}]',
    2500,
    '{"BASICA":"3500000","ESTANDAR":"1750000","TOTAL":"0"}',
    750000000,
    1750000,
  ],
};

interface World {
  readonly guest: string;
  readonly trip: string;
  readonly hold: string;
  readonly holder: string;
}

async function world(tx: Tx, c: CountryCase): Promise<World> {
  const guest = uuid();
  const [lines, extraKm, deductibles, rc, deposit] = WORLD[c.country]!;
  const w = (
    await tx.query<{ trip_id: string; hold_id: string; holder_id: string }>(
      `SELECT * FROM test_fixture.us211_world($1, $2, 'Ana', 'Pérez', 'es', 'María', 'Gómez', $3,
                                              'HOST', $4, $5, $6::jsonb, 'BASICA', 600, $7,
                                              $8::jsonb, $9, $10)`,
      [
        c.country,
        guest,
        await uniquePlate(tx, 'N'),
        '2034-03-10T15:00:00.000Z',
        '2034-03-13T15:00:00.000Z',
        lines,
        extraKm,
        deductibles,
        rc,
        deposit,
      ],
    )
  ).rows[0]!;
  return { guest, trip: w.trip_id, hold: w.hold_id, holder: w.holder_id };
}

async function as(tx: Tx, kind: string | null, name: string | null): Promise<void> {
  await tx.query(
    `SELECT pg_catalog.set_config('app.actor_kind', $1, true),
            pg_catalog.set_config('app.worker_name', $2, true)`,
    [kind ?? '', name ?? ''],
  );
}

/** Appel dans un SAVEPOINT : réponse, ou code métier traduit (et SQLSTATE). */
async function call(
  tx: Tx,
  subject: string,
  id: string,
): Promise<{ ok: true; p: Json | null } | { ok: false; code: string; state: string }> {
  await tx.query('SAVEPOINT us213');
  try {
    const r = await tx.query<{ p: Json | null }>(PARTIES, [subject, id]);
    await tx.query('RELEASE SAVEPOINT us213');
    return { ok: true, p: r.rows[0]?.p ?? null };
  } catch (error) {
    await tx.query('ROLLBACK TO SAVEPOINT us213');
    return {
      ok: false,
      code: translateDbError(error).code,
      state: (error as { code?: string }).code ?? '',
    };
  }
}

describe.each(COUNTRIES)('US-213 — parties d’une réservation ($country, $currency)', (c) => {
  it('ntf_dispatcher : voyageur et titulaire du compte d’hôte d’un trip et d’un hold, codes seulement ; sujet inconnu : NULL', async () => {
    const worker = await connectAs('app_worker');
    try {
      await inTx(worker, { virtualNow: '2034-03-01T12:00:00.000Z' }, async (tx) => {
        const w = await world(tx, c);
        await as(tx, 'WORKER', 'ntf_dispatcher');

        const trip = await call(tx, 'TRIP', w.trip);
        expect(trip).toEqual({ ok: true, p: { guestUserId: w.guest, hostUserId: w.holder } });

        // hold du checkout du monde 9963 : CHECKOUT, ACTIVE, sans motif ni heure limite
        const hold = await call(tx, 'HOLD', w.hold);
        expect(hold).toEqual({
          ok: true,
          p: {
            guestUserId: w.guest,
            hostUserId: w.holder,
            holdKind: 'CHECKOUT',
            holdStatus: 'ACTIVE',
            releaseReason: null,
            requestAuthorized: false,
          },
        });

        // minimisation : aucun nom, aucune coordonnée (le monde nomme Ana Pérez et María Gómez)
        const text = JSON.stringify([trip, hold]);
        for (const word of ['Ana', 'Pérez', 'María', 'Gómez', '@', 'fixture.test']) {
          expect(text).not.toContain(word);
        }

        // sujets inconnus : NULL (NTF : erreur de contrat), jamais une erreur qui révèle l'état
        expect(await call(tx, 'TRIP', uuid())).toEqual({ ok: true, p: null });
        expect(await call(tx, 'HOLD', uuid())).toEqual({ ok: true, p: null });
        expect(await call(tx, 'TRIP', w.hold)).toEqual({ ok: true, p: null });
        expect(await call(tx, 'HOLD', w.trip)).toEqual({ ok: true, p: null });
        expect(await call(tx, 'GUEST', w.trip)).toEqual({ ok: true, p: null });
      });
    } finally {
      await releaseClient(worker);
    }
  });

  it('tout autre travailleur, app_worker sans contexte : FORBIDDEN ; app_api et app_anon : aucun droit d’exécution', async () => {
    const worker = await connectAs('app_worker');
    try {
      await inTx(worker, { virtualNow: '2034-03-01T12:00:00.000Z' }, async (tx) => {
        const w = await world(tx, c);
        for (const [kind, name] of [
          ['WORKER', 'booking_contract'],
          ['WORKER', 'ntf_sender'],
          ['WORKER', null],
          [null, 'ntf_dispatcher'],
          ['GUEST', 'ntf_dispatcher'],
        ] as const) {
          await as(tx, kind, name);
          expect(await call(tx, 'TRIP', w.trip), `${String(kind)} ${String(name)}`).toEqual({
            ok: false,
            code: 'FORBIDDEN',
            state: '42501',
          });
        }
      });
    } finally {
      await releaseClient(worker);
    }
    for (const role of ['app_api', 'app_anon'] as const) {
      const client = await connectAs(role);
      try {
        // transaction simple : app_anon n'a aucun droit sur le schéma platform (horloge virtuelle)
        await client.query('BEGIN');
        try {
          await as(client, 'WORKER', 'ntf_dispatcher');
          const r = await call(client, 'TRIP', uuid());
          expect(r.ok, role).toBe(false);
          if (!r.ok) expect(r.state, role).toBe('42501');
        } finally {
          await client.query('ROLLBACK');
        }
      } finally {
        await releaseClient(client);
      }
    }
  });
});
