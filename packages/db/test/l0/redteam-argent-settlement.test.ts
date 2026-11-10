/**
 * US-049 — red team ARGENT, commandes `settlement` en base (`core.settlement_cmd_record`, tables
 * de règlement et soldes par jambe ; 08 E1, E4, E7 ; 17 §2.9, §3.2.8 ; ADR-057). Sous les rôles de
 * PRODUCTION (L0-05 : `withRole` / `connectAs`), en USD (PA) et en PYG sans décimale (PY).
 *
 * Chaque test affirme que l'attaque est BLOQUÉE : un test rouge est une faille, décrite dans
 * `docs/team/redteam/L0-argent.md`. Les montants attendus viennent de l'export des oracles
 * (`@rueda/money/golden-vectors`), jamais du code testé.
 */
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { setSessionContext, translateDbError } from '../../src/index.ts';
import {
  connectAs,
  releaseClient,
  withRole,
  withTestTransaction,
} from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import {
  byLeg,
  callRecord,
  captureLegs,
  at,
  eventOfVector,
  insertTrip,
  legsOf,
  payloadOf,
  recordAsSettlementWorker,
  recordOf,
  recordOfVector,
  tj,
  tripOfVector,
  uuid,
} from '../support/settlement.ts';

type Country = (typeof COUNTRIES)[number];

/** Vecteurs de référence par devise (v1 puis requalification v2, état capturé). */
const SCENARIO: Readonly<
  Record<string, { v1: string; other: string; capture: string; ref: string }>
> = {
  USD: { v1: 'T05', other: 'T03', capture: 'TJ01', ref: 'T03' },
  PYG: { v1: 'T41', other: 'T27', capture: 'TJ08a', ref: 'T27' },
};
const scenario = (c: Country) => {
  const s = SCENARIO[c.currency];
  if (!s) throw new Error(`pas de scénario pour ${c.currency}`);
  return s;
};

const worker = <T>(fn: (tx: pg.ClientBase) => Promise<T>): Promise<T> =>
  withRole('app_worker', (client) => withTestTransaction(client, {}, fn));

/** Exécute `run` dans un point de sauvegarde : 'OK' ou le code métier (la transaction reste utilisable). */
async function attempt(tx: pg.ClientBase, run: () => Promise<unknown>): Promise<string> {
  await tx.query('SAVEPOINT redteam_attempt');
  try {
    await run();
  } catch (error) {
    await tx.query('ROLLBACK TO SAVEPOINT redteam_attempt');
    return translateDbError(error).code;
  }
  await tx.query('RELEASE SAVEPOINT redteam_attempt');
  return 'OK';
}

/** SQLSTATE brut d'une tentative qui doit être refusée par les droits (42501). */
async function sqlstateOf(tx: pg.ClientBase, run: () => Promise<unknown>): Promise<string> {
  await tx.query('SAVEPOINT redteam_state');
  try {
    await run();
  } catch (error) {
    await tx.query('ROLLBACK TO SAVEPOINT redteam_state');
    return String((error as { code?: unknown }).code ?? 'SANS_CODE');
  }
  await tx.query('RELEASE SAVEPOINT redteam_state');
  return 'AUCUNE_ERREUR';
}

const settlementCount = async (tx: pg.ClientBase, tripId: string): Promise<number> => {
  const r = await tx.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM core.settlement_settlement WHERE trip_id = $1',
    [tripId],
  );
  return r.rows[0]?.n ?? -1;
};

type Leg = { leg: string } & Record<string, string>;
const legOf = (p: Record<string, unknown>, name: string): Leg => {
  const l = (p.legs as Leg[]).find((x) => x.leg === name);
  if (!l) throw new Error(`jambe ${name} absente`);
  return l;
};
const bump = (obj: Record<string, unknown>, key: string, by: bigint): void => {
  obj[key] = (BigInt(String(obj[key])) + by).toString();
};

describe.each(COUNTRIES)('ARG-20 — règlement rejoué — $country ($currency)', (c) => {
  it('même charge utile rejouée (même identifiant, puis nouvel identifiant) ⇒ SETTLEMENT_EXISTS, une seule ligne', async () => {
    const s = scenario(c);
    await worker(async (tx) => {
      const trip = await insertTrip(tx, c, 30);
      const rec = recordOfVector(s.ref);
      const id = uuid();
      await recordAsSettlementWorker(tx, { tripId: trip.id, version: 1, id }, rec);
      expect(
        await attempt(tx, () =>
          recordAsSettlementWorker(tx, { tripId: trip.id, version: 1, id }, rec),
        ),
      ).toBe('SETTLEMENT_EXISTS');
      expect(
        await attempt(tx, () => recordAsSettlementWorker(tx, { tripId: trip.id, version: 1 }, rec)),
      ).toBe('SETTLEMENT_EXISTS');
      expect(await settlementCount(tx, trip.id)).toBe(1);
    });
  });
});

describe.each(COUNTRIES)(
  'ARG-21 — règlements concurrents du même trajet (EC-54) — $country ($currency)',
  (c) => {
    const N = 6;

    async function race(
      clients: pg.Client[],
      tripId: string,
      args: (i: number) => { version: number; supersedesId?: string },
      records: ReturnType<typeof recordOfVector>[],
    ): Promise<string[]> {
      return Promise.all(
        clients.map(async (client, i) => {
          await client.query('BEGIN');
          try {
            const rec = records[i % records.length];
            if (!rec) throw new Error('aucun règlement à poser');
            await recordAsSettlementWorker(client, { tripId, ...args(i) }, rec);
            await client.query('COMMIT');
            return 'OK';
          } catch (error) {
            await client.query('ROLLBACK');
            return translateDbError(error).code;
          } finally {
            await client.query('RESET ALL');
          }
        }),
      );
    }

    it(`${N} travailleurs posent la version 1 puis la version 2 en même temps : exactement un gagnant par version`, async () => {
      const s = scenario(c);
      const clients: pg.Client[] = [];
      for (let i = 0; i < N; i++) clients.push(await connectAs('app_worker'));
      try {
        const first = clients[0] as pg.Client;
        const trip = await withTestTransaction(first, { commit: true }, async (tx) => {
          const t = await insertTrip(tx, c, 31);
          await captureLegs(tx, t.id, tj(s.capture).legsMinor);
          return t;
        });
        const r1 = recordOfVector(s.v1);
        const t = tripOfVector(s.v1);
        const rivals = [
          r1,
          recordOf(t, eventOfVector('T08')),
          recordOf(t, { reason: 'GUEST_CANCELLED', requestedAtMs: at(-600) }),
          r1,
        ];
        const outcomes1 = await race(clients, trip.id, () => ({ version: 1 }), rivals);
        expect(outcomes1.filter((o) => o === 'OK')).toHaveLength(1);
        expect(outcomes1.filter((o) => o === 'SETTLEMENT_EXISTS')).toHaveLength(N - 1);

        // version 2 : tous visent v1 ; le gagnant de la course 1 est lu en base (aucun ordre supposé)
        const head = await withTestTransaction(first, {}, async (tx) => {
          await setSessionContext(tx, { kind: 'WORKER', workerName: 'settlement' });
          const r = await tx.query<{ id: string; inputs_hash: string }>(
            `SELECT id, encode(inputs_hash, 'hex') AS inputs_hash
             FROM core.settlement_settlement WHERE trip_id = $1 AND version = 1`,
            [trip.id],
          );
          return r.rows[0];
        });
        if (!head) throw new Error('version 1 absente');
        const winner = rivals.find((r) => r.inputsHash === head.inputs_hash) ?? r1;
        const v2 = recordOf(tripOfVector(s.v1), eventOfVector('T08'), winner);
        const outcomes2 = await race(
          clients,
          trip.id,
          () => ({ version: 2, supersedesId: head.id }),
          [v2],
        );
        expect(outcomes2.filter((o) => o === 'OK')).toHaveLength(1);
        expect(outcomes2.filter((o) => o === 'SETTLEMENT_EXISTS')).toHaveLength(N - 1);

        const versions = await withTestTransaction(first, {}, async (tx) => {
          await setSessionContext(tx, { kind: 'WORKER', workerName: 'settlement' });
          return tx.query<{ version: number }>(
            'SELECT version FROM core.settlement_settlement WHERE trip_id = $1 ORDER BY version',
            [trip.id],
          );
        });
        expect(versions.rows.map((r) => r.version)).toEqual([1, 2]);
      } finally {
        for (const client of clients) await releaseClient(client);
      }
    });
  },
);

describe.each(COUNTRIES)(
  'ARG-22 — supersession qui double un remboursement — $country ($currency)',
  (c) => {
    it('chaîne v1 → v2 → v3 : Σ variations = − remboursement ; v2 rejouée, saut de version, base v1 sous v3 ⇒ refus', async () => {
      const s = scenario(c);
      await worker(async (tx) => {
        const trip = await insertTrip(tx, c, 32);
        await captureLegs(tx, trip.id, tj(s.capture).legsMinor);
        const r1 = recordOfVector(s.v1);
        const r2 = recordOf(tripOfVector(s.v1), eventOfVector('T08'), r1);
        const r3 = recordOf(tripOfVector(s.v1), eventOfVector('T08'), r2); // même événement : variation nulle
        const v1 = await recordAsSettlementWorker(tx, { tripId: trip.id, version: 1 }, r1);
        const v2 = await recordAsSettlementWorker(
          tx,
          { tripId: trip.id, version: 2, supersedesId: v1 },
          r2,
        );
        // v2 appliquée une seconde fois comme « v3 » (même charge utile, base = capture) ⇒ base fausse
        expect(
          await attempt(tx, () =>
            recordAsSettlementWorker(tx, { tripId: trip.id, version: 3, supersedesId: v2 }, r2),
          ),
        ).not.toBe('OK');
        // v3 qui remplace v1 (saut) et v2 rejouée telle quelle ⇒ refus
        expect(
          await attempt(tx, () =>
            recordAsSettlementWorker(tx, { tripId: trip.id, version: 3, supersedesId: v1 }, r3),
          ),
        ).toBe('INVARIANT_VIOLATION');
        expect(
          await attempt(tx, () =>
            recordAsSettlementWorker(tx, { tripId: trip.id, version: 2, supersedesId: v1 }, r2),
          ),
        ).toBe('SETTLEMENT_EXISTS');
        // la v3 légitime (variation nulle) passe, et ne double rien
        const v3 = await recordAsSettlementWorker(
          tx,
          { tripId: trip.id, version: 3, supersedesId: v2 },
          r3,
        );
        const total = (field: 'variation' | 'basis' | 'kept' | 'advance', id: string) =>
          legsOf(tx, id).then((rows) => rows.reduce((a, l) => a + l[field], 0n));
        expect(await total('variation', v3)).toBe(0n);
        const refund = async (id: string): Promise<bigint> => {
          const h = await tx.query<{ r: string }>(
            'SELECT guest_refund_minor::text AS r FROM core.settlement_settlement WHERE id = $1',
            [id],
          );
          return BigInt(h.rows[0]?.r ?? 'NaN');
        };
        expect(await refund(v3)).toBe(await refund(v2));
        // capture + Σ variations de la chaîne = jambes signées de la dernière version, jambe par jambe
        const capture = tj(s.capture).legsMinor;
        const chain = [await legsOf(tx, v1), await legsOf(tx, v2), await legsOf(tx, v3)];
        const last = byLeg(chain[2] ?? [], 'kept');
        const lastAdv = byLeg(chain[2] ?? [], 'advance');
        for (const leg of Object.keys(capture)) {
          const sumVar = chain.reduce((a, rows) => a + (byLeg(rows, 'variation')[leg] ?? 0n), 0n);
          expect(((capture as Record<string, bigint>)[leg] ?? 0n) + sumVar, leg).toBe(
            (last[leg] ?? 0n) - (lastAdv[leg] ?? 0n),
          );
        }
        expect(await settlementCount(tx, trip.id)).toBe(3);
      });
    });
  },
);

describe.each(COUNTRIES)(
  'ARG-23 — jambes falsifiées dans la charge utile — $country ($currency)',
  (c) => {
    const X = 100n;

    it('contrôle : HOST + X seul (en-tête inchangé) ⇒ SETTLEMENT_UNBALANCED', async () => {
      const s = scenario(c);
      await worker(async (tx) => {
        const trip = await insertTrip(tx, c, 33);
        await captureLegs(tx, trip.id, tj(s.capture).legsMinor);
        const p = payloadOf(recordOfVector(s.ref));
        const host = legOf(p, 'HOST');
        bump(host, 'keptMinor', X);
        bump(host, 'variationMinor', X);
        await setSessionContext(tx, { kind: 'WORKER', workerName: 'settlement' });
        expect(await attempt(tx, () => callRecord(tx, { tripId: trip.id, version: 1 }, p))).toBe(
          'SETTLEMENT_UNBALANCED',
        );
      });
    });

    it('jambe HOST ≠ hostFromGuest recalculé : X déplacés de PLATFORM vers HOST, en-tête et jambes cohérents entre eux ⇒ refus', async () => {
      const s = scenario(c);
      await worker(async (tx) => {
        const trip = await insertTrip(tx, c, 34);
        await captureLegs(tx, trip.id, tj(s.capture).legsMinor); // base ancrée sur l'état capturé
        const p = payloadOf(recordOfVector(s.ref));
        const host = legOf(p, 'HOST');
        const platform = legOf(p, 'PLATFORM');
        bump(host, 'keptMinor', X);
        bump(host, 'variationMinor', X);
        bump(platform, 'keptMinor', -X);
        bump(platform, 'variationMinor', -X);
        bump(p, 'hostFromGuestMinor', X);
        bump(p, 'hostEarningsMinor', X);
        bump(p, 'platformNetMinor', -X);
        await setSessionContext(tx, { kind: 'WORKER', workerName: 'settlement' });
        const outcome = await attempt(tx, () => callRecord(tx, { tripId: trip.id, version: 1 }, p));
        // 08 E7 règle 2 : HOST = hostFromGuest calculé par le moteur sur les entrées figées, pas déclaré
        expect(outcome).not.toBe('OK');
      });
    });

    it('montants du règlement A associés aux entrées (et au hachage) du règlement B ⇒ refus (08 E4 : calcul unique)', async () => {
      const s = scenario(c);
      await worker(async (tx) => {
        const trip = await insertTrip(tx, c, 35);
        await captureLegs(tx, trip.id, tj(s.capture).legsMinor);
        const a = payloadOf(recordOfVector(s.ref));
        const b = payloadOf(recordOfVector(s.v1));
        // même état capturé, même version de moteur ; seuls les entrées et leur empreinte viennent de B
        expect(a.inputsHash).not.toBe(b.inputsHash);
        a.inputs = b.inputs;
        a.inputsHash = b.inputsHash;
        a.paramSnapshotHash = b.paramSnapshotHash;
        await setSessionContext(tx, { kind: 'WORKER', workerName: 'settlement' });
        expect(
          await attempt(tx, () => callRecord(tx, { tripId: trip.id, version: 1 }, a)),
        ).not.toBe('OK');
      });
    });

    it('contrôle : total payé ×10 avec un état capturé tenu ⇒ INVARIANT_VIOLATION (base ≠ capture)', async () => {
      const s = scenario(c);
      await worker(async (tx) => {
        const trip = await insertTrip(tx, c, 36);
        await captureLegs(tx, trip.id, tj(s.capture).legsMinor);
        await setSessionContext(tx, { kind: 'WORKER', workerName: 'settlement' });
        expect(
          await attempt(tx, () =>
            callRecord(
              tx,
              { tripId: trip.id, version: 1 },
              scalePayload(payloadOf(recordOfVector(s.ref)), 10n),
            ),
          ),
        ).toBe('INVARIANT_VIOLATION');
      });
    });

    it('montant payé gonflé ×10 sans état capturé tenu (règlement v1 d’un trip dont aucun fonds n’est enregistré) ⇒ refus', async () => {
      const s = scenario(c);
      await worker(async (tx) => {
        const trip = await insertTrip(tx, c, 37);
        await setSessionContext(tx, { kind: 'WORKER', workerName: 'settlement' });
        const outcome = await attempt(tx, () =>
          callRecord(
            tx,
            { tripId: trip.id, version: 1 },
            scalePayload(payloadOf(recordOfVector(s.ref)), 10n),
          ),
        );
        // 17 §2.9 : seuls les fonds capturés par jambe peuvent être remboursés ou retenus
        expect(outcome).not.toBe('OK');
      });
    });
  },
);

/** Multiplie tous les montants d'une charge utile (cohérente en elle-même) ; les entrées restent intactes. */
function scalePayload(p: Record<string, unknown>, k: bigint): Record<string, unknown> {
  const scale = (o: Record<string, unknown>, keys: string[]): void => {
    for (const key of keys) o[key] = (BigInt(String(o[key])) * k).toString();
  };
  scale(p, [
    'totalPaidMinor',
    'guestRefundMinor',
    'taxRefundMinor',
    'retainedMinor',
    'retainedTaxMinor',
    'hostFromGuestMinor',
    'hostCompensationMinor',
    'hostEarningsMinor',
    'platformNetMinor',
  ]);
  for (const l of p.lines as Record<string, unknown>[])
    scale(l, ['amountMinor', 'refundMinor', 'retainedMinor']);
  for (const g of p.taxGroups as Record<string, unknown>[]) {
    scale(g, ['taxPaidMinor', 'taxRefundMinor', 'retainedTaxMinor']);
  }
  for (const l of p.legs as Record<string, unknown>[]) {
    scale(l, ['keptMinor', 'advanceMinor', 'basisMinor', 'variationMinor']);
  }
  return p;
}

describe('ARG-24 — valeurs hostiles dans la charge utile (débordement bigint, formes numériques, structure)', () => {
  const c = COUNTRIES[0];
  const cases: [string, (p: Record<string, unknown>) => void][] = [
    ['total payé = 2^63', (p) => (p.totalPaidMinor = '9223372036854775808')],
    ['remboursement = −1', (p) => (p.guestRefundMinor = '-1')],
    ['retenu en notation scientifique', (p) => (p.retainedMinor = '1e3')],
    ['gains hôte décimaux', (p) => (p.hostEarningsMinor = '10.5')],
    ['jambe non numérique', (p) => (legOf(p, 'HOST').keptMinor = 'abc')],
    ['jambe en hexadécimal', (p) => (legOf(p, 'HOST').keptMinor = '0x10')],
    [
      'jambe à 2^63 − 1 (somme qui déborde)',
      (p) => (legOf(p, 'PLATFORM').keptMinor = '9223372036854775807'),
    ],
    ['jambe HOST dupliquée', (p) => (p.legs as unknown[]).push({ ...legOf(p, 'HOST') })],
    ['jambe inconnue', (p) => (((p.legs as Leg[])[0] as Leg).leg = 'FOUNDER')],
    ['trois jambes seulement', (p) => (p.legs as unknown[]).pop()],
    [
      'ligne dupliquée',
      (p) => (p.lines as unknown[]).push({ ...((p.lines as unknown[])[0] as object) }),
    ],
    [
      'groupe fiscal sans thirdParty',
      (p) =>
        delete ((p.taxGroups as Record<string, unknown>[])[0] as Record<string, unknown>)
          .thirdParty,
    ],
    ['format 2', (p) => (p.format = 2)],
    ['nature inconnue', (p) => (p.kind = 'PAYOUT')],
    [
      'version du moteur différente de celle des entrées',
      (p) => (p.engineVersion = 'cxl-beta/999'),
    ],
    ['empreinte des entrées altérée', (p) => (p.inputsHash = '0'.repeat(64))],
    ['empreinte non hexadécimale', (p) => (p.inputsHash = 'zz'.repeat(32))],
    ['devise en minuscules', (p) => (p.currency = 'usd')],
    ['devise inconnue', (p) => (p.currency = 'EUR')],
    ['segment/lignes absents', (p) => delete p.lines],
    [
      'charge utile vide',
      (p) => {
        for (const k of Object.keys(p)) delete p[k];
      },
    ],
  ];

  it.each(cases)('%s ⇒ refus, aucune ligne écrite', async (label, mutate) => {
    const s = scenario(c);
    await worker(async (tx) => {
      const trip = await insertTrip(tx, c, 38);
      await captureLegs(tx, trip.id, tj(s.capture).legsMinor);
      const p = payloadOf(recordOfVector(s.ref));
      mutate(p);
      await setSessionContext(tx, { kind: 'WORKER', workerName: 'settlement' });
      expect(
        await attempt(tx, () => callRecord(tx, { tripId: trip.id, version: 1 }, p)),
        label,
      ).not.toBe('OK');
      expect(await settlementCount(tx, trip.id)).toBe(0);
    });
  });
});

describe('ARG-25 — devise croisée à l’enregistrement', () => {
  it('règlement PYG sur un trip PA et règlement USD sur un trip PY ⇒ INVARIANT_VIOLATION', async () => {
    const [pa, py] = COUNTRIES;
    await worker(async (tx) => {
      const tripPa = await insertTrip(tx, pa, 39);
      expect(
        await attempt(tx, () =>
          recordAsSettlementWorker(tx, { tripId: tripPa.id, version: 1 }, recordOfVector('T27')),
        ),
      ).toBe('INVARIANT_VIOLATION');
      const tripPy = await insertTrip(tx, py, 40);
      expect(
        await attempt(tx, () =>
          recordAsSettlementWorker(tx, { tripId: tripPy.id, version: 1 }, recordOfVector('T03')),
        ),
      ).toBe('INVARIANT_VIOLATION');
      expect(await settlementCount(tx, tripPa.id)).toBe(0);
      expect(await settlementCount(tx, tripPy.id)).toBe(0);
    });
  });
});

describe('ARG-26 — appelants et écritures directes interdits', () => {
  const c = COUNTRIES[0];

  it('app_api, app_anon, travailleurs autres que settlement, sans contexte ⇒ 42501', async () => {
    const rec = recordOfVector('T03');
    for (const role of ['app_api', 'app_anon'] as const) {
      // app_anon n'a pas accès à platform.now() : transaction manuelle, sans horloge de test
      await withRole(role, async (client) => {
        await client.query('BEGIN');
        try {
          expect(
            await sqlstateOf(client, () =>
              callRecord(client, { tripId: uuid(), version: 1 }, payloadOf(rec)),
            ),
            role,
          ).toBe('42501');
        } finally {
          await client.query('ROLLBACK');
        }
      });
    }
    await worker(async (tx) => {
      for (const name of ['payment_command', 'webhook_ingest', 'booking_conversion']) {
        await setSessionContext(tx, { kind: 'WORKER', workerName: name });
        expect(
          await sqlstateOf(tx, () =>
            callRecord(tx, { tripId: uuid(), version: 1 }, payloadOf(rec)),
          ),
          name,
        ).toBe('42501');
      }
      await tx.query(
        `SELECT set_config('app.actor_kind', '', true), set_config('app.worker_name', '', true)`,
      );
      expect(
        await sqlstateOf(tx, () => callRecord(tx, { tripId: uuid(), version: 1 }, payloadOf(rec))),
      ).toBe('42501');
    });
  });

  it('écriture, modification, suppression directes des règlements et des soldes par jambe ⇒ 42501', async () => {
    await worker(async (tx) => {
      const trip = await insertTrip(tx, c, 42);
      await captureLegs(tx, trip.id, tj('TJ01').legsMinor);
      const sid = await recordAsSettlementWorker(
        tx,
        { tripId: trip.id, version: 1 },
        recordOfVector('T03'),
      );
      for (const name of ['settlement', 'payment_command']) {
        await setSessionContext(tx, { kind: 'WORKER', workerName: name });
        const statements: [string, unknown[]][] = [
          ['UPDATE core.settlement_settlement SET guest_refund_minor = 0 WHERE id = $1', [sid]],
          ['DELETE FROM core.settlement_settlement WHERE id = $1', [sid]],
          [
            'UPDATE core.settlement_settlement_leg SET kept_minor = kept_minor + 1 WHERE settlement_id = $1',
            [sid],
          ],
          ['DELETE FROM core.settlement_settlement_leg WHERE settlement_id = $1', [sid]],
          [
            'UPDATE core.settlement_trip_leg_balance SET captured_minor = captured_minor + 1000000 WHERE trip_id = $1',
            [trip.id],
          ],
          [
            'UPDATE core.settlement_trip_leg_balance SET released_minor = 0, frozen = false WHERE trip_id = $1',
            [trip.id],
          ],
          ['DELETE FROM core.settlement_trip_leg_balance WHERE trip_id = $1', [trip.id]],
          ['TRUNCATE core.settlement_settlement CASCADE', []],
          [
            "INSERT INTO core.settlement_leg_movement (operation_id, trip_id, segment_no, country_code, kind) VALUES (gen_random_uuid(), $1, 1, 'PA', 'CAPTURE')",
            [trip.id],
          ],
        ];
        for (const [sql, args] of statements) {
          expect(await sqlstateOf(tx, () => tx.query(sql, args)), `${name} : ${sql}`).toBe('42501');
        }
      }
      // l'état n'a pas bougé
      await setSessionContext(tx, { kind: 'WORKER', workerName: 'settlement' });
      expect(await settlementCount(tx, trip.id)).toBe(1);
    });
  });
});
