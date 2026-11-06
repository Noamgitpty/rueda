/**
 * US-018 — règlements persistés, versions, supersession et jambes (08 E4, E7 ; 17 §2.3, §2.9,
 * §3.2.8 ; ADR-057). Sous les rôles de PRODUCTION (assertion L0-05 : withRole / connectAs), en USD
 * (PA) et en PYG sans décimale (PY). Les montants attendus viennent de l'export des oracles
 * (`@rueda/money/golden-vectors`, US-016) : TJ01, TJ02a/b, TJ08a/b, TJ13b/d, TJ18a, TJ18c,
 * contrôle T36 ; les règles d'accès de 17 §2.3 (RLS-2, RLS-21, RLS-25, RLS-28). Jamais du code testé.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { checksFor } from '@rueda/money/golden-vectors';
import { setSessionContext, translateDbError } from '../../src/index.ts';
import {
  connectAs,
  releaseClient,
  withRole,
  withTestTransaction,
} from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import { asActor, buildWorld, withRawContext } from '../support/rls.ts';
import type { CountryWorld, World } from '../support/rls.ts';
import {
  J3,
  NP_MAX,
  N_MAX,
  at,
  byLeg,
  callRecord,
  captureLegs,
  eventOfVector,
  golden,
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

/** Vecteurs de référence par devise : PA (T03, TJ01, TJ02a/b) et PY (T27, TJ08a/b). */
const REF: Readonly<
  Record<string, { readonly vector: string; readonly capture: string; readonly variation: string }>
> = {
  USD: { vector: 'T03', capture: 'TJ01', variation: 'TJ02b' },
  PYG: { vector: 'T27', capture: 'TJ08a', variation: 'TJ08b' },
};
const ref = (c: Country) => {
  const r = REF[c.currency];
  if (!r) throw new Error(`pas de vecteur de référence pour ${c.currency}`);
  return r;
};

const worker = <T>(fn: (tx: pg.ClientBase) => Promise<T>): Promise<T> =>
  withRole('app_worker', (client) => withTestTransaction(client, {}, fn));

/** Code métier d'un appel qui doit échouer (aucun détail technique, translateDbError). */
async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (error) {
    return translateDbError(error).code;
  }
  return 'AUCUNE_ERREUR';
}

const headerOf = async (tx: pg.ClientBase, id: string): Promise<Record<string, unknown>> => {
  const { rows } = await tx.query<Record<string, unknown>>(
    `SELECT id, version, supersedes_id, guest_refund_minor::text, tax_refund_minor::text,
            host_earnings_minor::text, platform_net_minor::text, host_penalty_minor::text,
            negative_leg, encode(inputs_hash, 'hex') AS inputs_hash, created_at
       FROM core.settlement_settlement WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new Error(`règlement ${id} invisible`);
  return row;
};

describe('US-018 — version 1 : jambes retenues et variation signée persistées, jambe par jambe', () => {
  it.each(COUNTRIES)(
    '$country ($currency) : règlement de référence ⇒ base = capture, variation = TJ, invariants en base',
    async (c) => {
      const r = ref(c);
      await worker(async (tx) => {
        const trip = await insertTrip(tx, c, 0);
        const rec = recordOfVector(r.vector);
        const sid = await recordAsSettlementWorker(tx, { tripId: trip.id, version: 1 }, rec);
        const legs = await legsOf(tx, sid);
        expect(byLeg(legs, 'basis')).toEqual(tj(r.capture).legsMinor);
        expect(byLeg(legs, 'variation')).toEqual(tj(r.variation).legsMinor);
        if (c.currency === 'USD') expect(byLeg(legs, 'kept')).toEqual(tj('TJ02a').legsMinor);
        const h = await headerOf(tx, sid);
        expect(BigInt(String(h.guest_refund_minor))).toBe(-tj(r.variation).totalMinor);
        expect(h.negative_leg).toBe(false);
        expect(h.inputs_hash).toBe(rec.inputsHash);
        // portée relue du trip, jamais de la charge utile
        const scope = await tx.query<{ org_id: string; country_code: string; currency: string }>(
          `SELECT org_id, country_code, currency FROM core.settlement_settlement WHERE id = $1`,
          [sid],
        );
        expect(scope.rows[0]).toEqual({
          org_id: trip.org,
          country_code: c.country,
          currency: c.currency,
        });
      });
    },
  );

  it.each(COUNTRIES)(
    '$country : état capturé tenu (trip_leg_balance) ⇒ la base doit lui être égale',
    async (c) => {
      const r = ref(c);
      await worker(async (tx) => {
        const trip = await insertTrip(tx, c, 1);
        await captureLegs(tx, trip.id, tj(r.capture).legsMinor);
        await recordAsSettlementWorker(
          tx,
          { tripId: trip.id, version: 1 },
          recordOfVector(r.vector),
        );
      });
      await worker(async (tx) => {
        const trip = await insertTrip(tx, c, 2);
        const off = { ...tj(r.capture).legsMinor, HOST: tj(r.capture).legsMinor.HOST + 1n };
        await captureLegs(tx, trip.id, off);
        expect(
          await codeOf(
            recordAsSettlementWorker(tx, { tripId: trip.id, version: 1 }, recordOfVector(r.vector)),
          ),
        ).toBe('INVARIANT_VIOLATION'); // settlement_basis_mismatch
      });
    },
  );
});

describe('US-018 — supersession : version n+1 par contre-passation, sans perte d’historique', () => {
  it('T36 (USD, PA) : v1 = T08, v2 = T07 ⇒ delta −118,44 / −6,44 / +75,00 / +37,00 / −50 ; v1 inchangée', async () => {
    const pa = COUNTRIES[0];
    const check = checksFor(golden, 'T36').find((x) => x.label === 'T36');
    const [refund, tax, host, platform, penaltyMajor] = check?.expected as readonly bigint[];
    const exponent = BigInt(golden.currencies.get('USD')?.exponent ?? Number.NaN);
    await worker(async (tx) => {
      const trip = await insertTrip(tx, pa, 3);
      await captureLegs(tx, trip.id, tj('TJ01').legsMinor);
      const r1 = recordOfVector('T08');
      const v1 = await recordAsSettlementWorker(tx, { tripId: trip.id, version: 1 }, r1);
      const before = await headerOf(tx, v1);
      const legsBefore = await legsOf(tx, v1);
      const v2 = await recordAsSettlementWorker(
        tx,
        { tripId: trip.id, version: 2, supersedesId: v1 },
        recordOfVector('T07', r1),
      );
      // historique : v1 intacte, v2 la remplace
      expect(await headerOf(tx, v1)).toEqual(before);
      expect(await legsOf(tx, v1)).toEqual(legsBefore);
      const h2 = await headerOf(tx, v2);
      expect(h2.supersedes_id).toBe(v1);
      expect(h2.version).toBe(2);
      const d = (k: string): bigint => BigInt(String(h2[k])) - BigInt(String(before[k]));
      expect(d('guest_refund_minor')).toBe(refund);
      expect(d('tax_refund_minor')).toBe(tax);
      expect(d('host_earnings_minor')).toBe(host);
      expect(d('platform_net_minor')).toBe(platform);
      expect(d('host_penalty_minor')).toBe((penaltyMajor ?? 0n) * 10n ** exponent);
      // variation de v2 depuis v1 = inverse de TJ18a (« inverse du delta de T36 »)
      const inverse = Object.fromEntries(
        Object.entries(tj('TJ18a').legsMinor).map(([k, v]) => [k, -v]),
      );
      expect(byLeg(await legsOf(tx, v2), 'variation')).toEqual(inverse);
      const versions = await tx.query<{ version: number }>(
        `SELECT version FROM core.settlement_settlement WHERE trip_id = $1 ORDER BY version`,
        [trip.id],
      );
      expect(versions.rows.map((x) => x.version)).toEqual([1, 2]);
    });
  });

  it('TJ18a (USD) et TJ18c (PYG) : requalification FULL après un no-show exécuté', async () => {
    for (const [c, v1Vector, tripVector, expected, capture] of [
      [COUNTRIES[0], 'T05', 'T05', 'TJ18a', 'TJ01'],
      [COUNTRIES[1], 'T41', 'T41', 'TJ18c', 'TJ08a'],
    ] as const) {
      await worker(async (tx) => {
        const trip = await insertTrip(tx, c, 4);
        await captureLegs(tx, trip.id, tj(capture).legsMinor);
        const r1 = recordOfVector(v1Vector);
        const v1 = await recordAsSettlementWorker(tx, { tripId: trip.id, version: 1 }, r1);
        const r2 = recordOf(tripOfVector(tripVector), eventOfVector('T08'), r1);
        const v2 = await recordAsSettlementWorker(
          tx,
          { tripId: trip.id, version: 2, supersedesId: v1 },
          r2,
        );
        expect(byLeg(await legsOf(tx, v2), 'variation'), expected).toEqual(tj(expected).legsMinor);
      });
    }
  });

  it('chaîne de versions : v n+1 remplace exactement la dernière version ; jamais deux fois la même', async () => {
    const pa = COUNTRIES[0];
    const r1 = recordOfVector('T08');
    const r2 = recordOfVector('T07', r1);
    const setup = async (tx: pg.ClientBase) => {
      const trip = await insertTrip(tx, pa, 5);
      await captureLegs(tx, trip.id, tj('TJ01').legsMinor);
      const v1 = await recordAsSettlementWorker(tx, { tripId: trip.id, version: 1 }, r1);
      return { trip: trip.id, v1 };
    };
    const cases: [
      string,
      (tx: pg.ClientBase, s: { trip: string; v1: string }) => Promise<unknown>,
      string,
    ][] = [
      [
        'v1 une seconde fois',
        (tx, s) => recordAsSettlementWorker(tx, { tripId: s.trip, version: 1 }, r1),
        'SETTLEMENT_EXISTS',
      ],
      [
        'v2 sans supersedes',
        (tx, s) => recordAsSettlementWorker(tx, { tripId: s.trip, version: 2 }, r2),
        'INVARIANT_VIOLATION',
      ],
      [
        'v3 en sautant v2',
        (tx, s) =>
          recordAsSettlementWorker(tx, { tripId: s.trip, version: 3, supersedesId: s.v1 }, r2),
        'INVARIANT_VIOLATION',
      ],
      [
        'v2 dont la base est falsifiée (Σ conservée : HOST + 1, PLATFORM − 1)',
        (tx, s) => {
          const p = payloadOf(r2);
          const legs = p.legs as Record<string, string>[];
          for (const [name, by] of [
            ['HOST', 1n],
            ['PLATFORM', -1n],
          ] as const) {
            const l = legs.find((x) => x.leg === name);
            if (!l) throw new Error(name);
            l.basisMinor = (BigInt(l.basisMinor ?? '0') + by).toString();
            l.variationMinor = (BigInt(l.variationMinor ?? '0') - by).toString();
          }
          return callRecord(tx, { tripId: s.trip, version: 2, supersedesId: s.v1 }, p);
        },
        'INVARIANT_VIOLATION',
      ],
      [
        'v2 qui remplace une version d’un autre trip',
        (tx, s) =>
          recordAsSettlementWorker(tx, { tripId: s.trip, version: 2, supersedesId: uuid() }, r2),
        'INVARIANT_VIOLATION',
      ],
    ];
    for (const [label, run, code] of cases) {
      await worker(async (tx) => {
        const s = await setup(tx);
        expect(await codeOf(run(tx, s)), label).toBe(code);
      });
    }
    // v2 enregistrée, puis une seconde v2 (autre événement) ⇒ SETTLEMENT_EXISTS
    await worker(async (tx) => {
      const s = await setup(tx);
      await recordAsSettlementWorker(tx, { tripId: s.trip, version: 2, supersedesId: s.v1 }, r2);
      expect(
        await codeOf(
          recordAsSettlementWorker(tx, { tripId: s.trip, version: 2, supersedesId: s.v1 }, r2),
        ),
      ).toBe('SETTLEMENT_EXISTS');
    });
  });

  it('version n+1 sans état capturé tenu (trip_leg_balance) ⇒ refus', async () => {
    await worker(async (tx) => {
      const trip = await insertTrip(tx, COUNTRIES[0], 12);
      const r1 = recordOfVector('T08');
      const v1 = await recordAsSettlementWorker(tx, { tripId: trip.id, version: 1 }, r1);
      expect(
        await codeOf(
          recordAsSettlementWorker(
            tx,
            { tripId: trip.id, version: 2, supersedesId: v1 },
            recordOfVector('T07', r1),
          ),
        ),
      ).toBe('INVARIANT_VIOLATION'); // settlement_capture_missing
    });
  });

  it('v n+1 sur une v n à avance (N_MAX tardive puis FULL) : base PLATFORM = − avance de v n', async () => {
    await worker(async (tx) => {
      const trip = await insertTrip(tx, COUNTRIES[0], 13);
      await captureLegs(tx, trip.id, tj('TJ13b').legsMinor);
      const r1 = recordOf(N_MAX, { reason: 'GUEST_CANCELLED', requestedAtMs: at(-600) });
      const v1 = await recordAsSettlementWorker(tx, { tripId: trip.id, version: 1 }, r1);
      const v2 = await recordAsSettlementWorker(
        tx,
        { tripId: trip.id, version: 2, supersedesId: v1 },
        recordOf(N_MAX, eventOfVector('T08'), r1),
      );
      const before = (await legsOf(tx, v1)).find((l) => l.leg === 'PLATFORM');
      const after = (await legsOf(tx, v2)).find((l) => l.leg === 'PLATFORM');
      expect(before?.advance).toBeGreaterThan(0n);
      expect(after?.basis).toBe(-(before?.advance ?? 0n));
    });
  });

  it('segment autre que 1 (bêta) ⇒ refus : aucune seconde chaîne de versions', async () => {
    await worker(async (tx) => {
      const trip = await insertTrip(tx, COUNTRIES[0], 14);
      await recordAsSettlementWorker(tx, { tripId: trip.id, version: 1 }, recordOfVector('T03'));
      expect(
        await codeOf(
          recordAsSettlementWorker(
            tx,
            { tripId: trip.id, version: 1, segmentNo: 2 },
            recordOfVector('T05'),
          ),
        ),
      ).toBe('INVARIANT_VIOLATION'); // settlement_segment_unsupported
    });
  });

  it('08 E4 : trip modifié depuis le calcul (row_version) ⇒ SETTLEMENT_STALE', async () => {
    await worker(async (tx) => {
      const trip = await insertTrip(tx, COUNTRIES[0], 6);
      expect(
        await codeOf(
          recordAsSettlementWorker(
            tx,
            { tripId: trip.id, version: 1, tripRowVersion: 1 },
            recordOfVector('T03'),
          ),
        ),
      ).toBe('SETTLEMENT_STALE');
    });
  });
});

describe('US-018 — EC-54 : deux événements d’annulation simultanés ⇒ un seul règlement par version', () => {
  it.each(COUNTRIES)(
    '$country : le second reçoit 409 SETTLEMENT_EXISTS après le verrou du trip',
    async (c) => {
      const first = recordOfVector(ref(c).vector);
      const second = recordOfVector(c.currency === 'USD' ? 'T05' : 'T41');
      const a = await connectAs('app_worker');
      const b = await connectAs('app_worker');
      try {
        const trip = await withTestTransaction(a, { commit: true }, (tx) => insertTrip(tx, c, 7));
        await a.query('BEGIN');
        await recordAsSettlementWorker(a, { tripId: trip.id, version: 1 }, first);
        const bPid = (await b.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]
          ?.pid;
        await b.query('BEGIN');
        const pending = recordAsSettlementWorker(b, { tripId: trip.id, version: 1 }, second).then(
          () => null,
          (e: unknown) => e,
        );
        // b attend le verrou FOR UPDATE du trip tenu par a
        let blocked = false;
        for (let i = 0; i < 100 && !blocked; i++) {
          const r = await a.query<{ n: number }>('SELECT cardinality(pg_blocking_pids($1)) AS n', [
            bPid,
          ]);
          blocked = (r.rows[0]?.n ?? 0) > 0;
          if (!blocked) await new Promise((res) => setTimeout(res, 20));
        }
        expect(blocked).toBe(true);
        await a.query('COMMIT');
        const error = await pending;
        await b.query('ROLLBACK');
        expect(translateDbError(error)).toEqual({ code: 'SETTLEMENT_EXISTS', retryable: false });
        // une seule version 1, celle du premier événement
        const n = await withTestTransaction(a, {}, async (tx) => {
          await setSessionContext(tx, { kind: 'WORKER', workerName: 'settlement' });
          return tx.query<{ n: number; h: string }>(
            `SELECT count(*)::int AS n, max(encode(inputs_hash, 'hex')) AS h
             FROM core.settlement_settlement WHERE trip_id = $1`,
            [trip.id],
          );
        });
        expect(n.rows[0]).toEqual({ n: 1, h: first.inputsHash });
      } finally {
        await releaseClient(a);
        await releaseClient(b);
      }
    },
  );
});

describe('US-018 — jambe TAX_THIRD_PARTY persistée (J3, PYG, TJ11a / TJ11b)', () => {
  const late = { reason: 'GUEST_CANCELLED', requestedAtMs: at(-600) } as const;
  it('base = TJ11a, variation = TJ11b ; ligne de taxe du tiers marquée third_party', async () => {
    await worker(async (tx) => {
      const trip = await insertTrip(tx, COUNTRIES[1], 15);
      await captureLegs(tx, trip.id, tj('TJ11a').legsMinor);
      const sid = await recordAsSettlementWorker(
        tx,
        { tripId: trip.id, version: 1 },
        recordOf(J3, late),
      );
      const legs = await legsOf(tx, sid);
      expect(byLeg(legs, 'basis')).toEqual(tj('TJ11a').legsMinor);
      expect(byLeg(legs, 'variation')).toEqual(tj('TJ11b').legsMinor);
      const tax = await tx.query<{ tax_group: string; third_party: boolean }>(
        `SELECT tax_group, third_party FROM core.settlement_settlement_tax_line
          WHERE settlement_id = $1 ORDER BY tax_group`,
        [sid],
      );
      expect(tax.rows.filter((r) => r.third_party).map((r) => r.tax_group)).toEqual(['tiers']);
    });
  });

  it.each([
    [
      'groupe tiers forcé à third_party = false',
      (p: Record<string, unknown>) => {
        for (const g of p.taxGroups as Record<string, unknown>[]) g.thirdParty = false;
      },
    ],
    [
      'jambe TAX_THIRD_PARTY + 1 / PLATFORM − 1',
      (p: Record<string, unknown>) => {
        const legs = p.legs as Record<string, string>[];
        for (const [name, by] of [
          ['TAX_THIRD_PARTY', 1n],
          ['PLATFORM', -1n],
        ] as const) {
          const l = legs.find((x) => x.leg === name);
          if (!l) throw new Error(name);
          l.keptMinor = (BigInt(l.keptMinor ?? '0') + by).toString();
          l.variationMinor = (BigInt(l.variationMinor ?? '0') + by).toString();
        }
      },
    ],
  ])('%s ⇒ SETTLEMENT_UNBALANCED', async (_, mutate) => {
    await worker(async (tx) => {
      const trip = await insertTrip(tx, COUNTRIES[1], 16);
      const p = payloadOf(recordOf(J3, late));
      mutate(p);
      await setSessionContext(tx, { kind: 'WORKER', workerName: 'settlement' });
      expect(await codeOf(callRecord(tx, { tripId: trip.id, version: 1 }, p))).toBe(
        'SETTLEMENT_UNBALANCED',
      );
    });
  });
});

describe('US-018 — cmd_money_owner : UPDATE (row_version) du trip réservé au verrou ; soldes gardés', () => {
  it('un UPDATE réel de booking_trip.row_version sous cmd_money_owner est refusé (WITH CHECK false)', async () => {
    await worker(async (tx) => {
      const trip = await insertTrip(tx, COUNTRIES[0], 17);
      await expect(
        tx.query('SELECT test_fixture.settlement_try_trip_update($1)', [trip.id]),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('trip_leg_balance : cumul décroissant, suppression, solde négatif ⇒ refus', async () => {
    const cases: [string, string, unknown[], string][] = [
      [
        'captured décroît',
        'SELECT test_fixture.settlement_update_leg_balance($1, $2, 0, 0)',
        ['HOST'],
        'INVARIANT_VIOLATION',
      ],
      [
        'suppression',
        'SELECT test_fixture.settlement_delete_leg_balance($1, $2)',
        ['HOST'],
        'IMMUTABLE_RECORD',
      ],
      [
        'libéré > capturé',
        'SELECT test_fixture.settlement_update_leg_balance($1, $2, 13125, 13126)',
        ['HOST'],
        'LEG_AMOUNT_NEGATIVE',
      ],
    ];
    for (const [label, sql, args, code] of cases) {
      await worker(async (tx) => {
        const trip = await insertTrip(tx, COUNTRIES[0], 18);
        await captureLegs(tx, trip.id, tj('TJ01').legsMinor);
        expect(await codeOf(tx.query(sql, [trip.id, ...args])), label).toBe(code);
      });
    }
  });
});

describe('US-018 — drapeau negativeLeg (08 E7 règles 3 bis et 5) : PLATFORM jamais négative, avance et revue FIN', () => {
  it.each([
    { c: COUNTRIES[0], trip: N_MAX, capture: 'TJ13b' },
    { c: COUNTRIES[1], trip: NP_MAX, capture: 'TJ13d' },
  ])(
    '$capture : promo maximale, annulation tardive ⇒ kept 0, advance > 0, negative_leg',
    async ({ c, trip, capture }) => {
      const rec = recordOf(trip, { reason: 'GUEST_CANCELLED', requestedAtMs: at(-600) });
      await worker(async (tx) => {
        const t = await insertTrip(tx, c, 8);
        const sid = await recordAsSettlementWorker(tx, { tripId: t.id, version: 1 }, rec);
        const legs = await legsOf(tx, sid);
        expect(byLeg(legs, 'basis')).toEqual(tj(capture).legsMinor);
        const platform = legs.find((l) => l.leg === 'PLATFORM');
        expect(platform?.kept).toBe(0n);
        expect(platform?.advance).toBeGreaterThan(0n);
        expect(legs.filter((l) => l.leg !== 'PLATFORM').every((l) => l.advance === 0n)).toBe(true);
        const h = await headerOf(tx, sid);
        expect(h.negative_leg).toBe(true);
        // le remboursement n'est jamais réduit de l'avance
        expect(BigInt(String(h.guest_refund_minor))).toBe(rec.guestRefundMinor);
        expect(legs.reduce((s, l) => s + l.variation, 0n)).toBe(-rec.guestRefundMinor);
      });
    },
  );
});

describe('US-018 — falsification de la charge utile : refus en base (fail-closed)', () => {
  const tamper = (mutate: (p: Record<string, unknown>) => void): Record<string, unknown> => {
    const p = payloadOf(recordOfVector('T03'));
    mutate(p);
    return p;
  };
  type LegP = Record<string, string>;
  const leg = (p: Record<string, unknown>, name: string): LegP => {
    const l = (p.legs as LegP[]).find((x) => x.leg === name);
    if (!l) throw new Error(name);
    return l;
  };
  const shift = (l: LegP, field: string, by: bigint) => {
    l[field] = (BigInt(l[field] ?? '0') + by).toString();
  };
  const cases: [string, Record<string, unknown>, string][] = [
    [
      'HOST ≠ hostFromGuest (Σ conservée)',
      tamper((p) => {
        shift(leg(p, 'HOST'), 'keptMinor', 1n);
        shift(leg(p, 'HOST'), 'variationMinor', 1n);
        shift(leg(p, 'PLATFORM'), 'keptMinor', -1n);
        shift(leg(p, 'PLATFORM'), 'variationMinor', -1n);
      }),
      'SETTLEMENT_UNBALANCED',
    ],
    [
      'jambe retenue négative',
      tamper((p) => {
        const h = leg(p, 'HOST');
        h.keptMinor = '-1';
        h.variationMinor = (-1n - BigInt(h.basisMinor ?? '0')).toString();
      }),
      'LEG_AMOUNT_NEGATIVE',
    ],
    [
      'avance sur une jambe autre que PLATFORM',
      tamper((p) => {
        const h = leg(p, 'INSURER');
        h.advanceMinor = '1';
        h.variationMinor = (-1n - BigInt(h.basisMinor ?? '0')).toString();
      }),
      'LEG_AMOUNT_NEGATIVE',
    ],
    [
      'drapeau negativeLeg sans avance',
      tamper((p) => (p.negativeLeg = true)),
      'INVARIANT_VIOLATION',
    ],
    [
      'remboursement + 1',
      tamper((p) => (p.guestRefundMinor = (BigInt(String(p.guestRefundMinor)) + 1n).toString())),
      'SETTLEMENT_UNBALANCED',
    ],
    [
      'ligne déplacée du retenu au remboursé',
      tamper((p) => {
        const l = (p.lines as LegP[]).find((x) => x.line === 'tripPrice');
        if (!l) throw new Error('tripPrice');
        shift(l, 'refundMinor', 1n);
        shift(l, 'retainedMinor', -1n);
      }),
      'SETTLEMENT_UNBALANCED',
    ],
    [
      'base de la variation décalée (Σ variations ≠ − remboursement)',
      tamper((p) => {
        shift(leg(p, 'HOST'), 'basisMinor', 1n);
        shift(leg(p, 'HOST'), 'variationMinor', -1n);
      }),
      'SETTLEMENT_UNBALANCED',
    ],
    [
      'devise d’un autre pays que le trip',
      tamper((p) => (p.currency = COUNTRIES[1].currency)),
      'INVARIANT_VIOLATION',
    ],
    [
      'trois jambes seulement',
      tamper((p) => (p.legs = (p.legs as LegP[]).slice(0, 3))),
      'SETTLEMENT_UNBALANCED',
    ],
    [
      'base négative en v1 (Σ conservée)',
      tamper((p) => {
        const h = leg(p, 'HOST');
        const by = BigInt(h.basisMinor ?? '0') + 1n; // HOST passe à −1
        shift(h, 'basisMinor', -by);
        shift(h, 'variationMinor', by);
        shift(leg(p, 'PLATFORM'), 'basisMinor', by);
        shift(leg(p, 'PLATFORM'), 'variationMinor', -by);
      }),
      'INVARIANT_VIOLATION',
    ],
    [
      'taxe remboursée ≠ en-tête (ligne de taxe cohérente)',
      tamper((p) => {
        const g = (p.taxGroups as LegP[])[0];
        if (!g) throw new Error('taxe');
        shift(g, 'taxPaidMinor', 1n);
        shift(g, 'taxRefundMinor', 1n);
      }),
      'SETTLEMENT_UNBALANCED',
    ],
    [
      'entrées canoniques modifiées (empreinte différente de inputs_hash)',
      tamper((p) => (p.inputs = String(p.inputs).replace('"GUEST_CANCELLED"', '"HOST_CANCELLED"'))),
      'INVARIANT_VIOLATION',
    ],
  ];

  it('drapeau negative_leg = false alors qu’une avance existe (N_MAX tardive) ⇒ INVARIANT_VIOLATION', async () => {
    const p = payloadOf(recordOf(N_MAX, { reason: 'GUEST_CANCELLED', requestedAtMs: at(-600) }));
    expect(p.negativeLeg).toBe(true);
    p.negativeLeg = false;
    await worker(async (tx) => {
      const trip = await insertTrip(tx, COUNTRIES[0], 19);
      await setSessionContext(tx, { kind: 'WORKER', workerName: 'settlement' });
      expect(await codeOf(callRecord(tx, { tripId: trip.id, version: 1 }, p))).toBe(
        'INVARIANT_VIOLATION',
      );
    });
  });

  it('charge utile mal formée (format 2) ⇒ 22023, sans écriture', async () => {
    await worker(async (tx) => {
      const trip = await insertTrip(tx, COUNTRIES[0], 20);
      await setSessionContext(tx, { kind: 'WORKER', workerName: 'settlement' });
      await expect(
        callRecord(
          tx,
          { tripId: trip.id, version: 1 },
          tamper((p) => (p.format = 2)),
        ),
      ).rejects.toMatchObject({ code: '22023' });
    });
  });

  // ANCIENNES LIMITES CONNUES (ADR-057, revue argent n° 4), INVERSÉES par US-049 (RC-1, 0054,
  // ADR-088) : une redistribution entre jambes cohérente avec elle-même est refusée par le rejeu
  // des entrées en base (settlement_replay_mismatch), avec ou sans état capturé tenu.
  it.each([
    [
      'jambe retenue INSURER + 1 / PLATFORM − 1',
      tamper((p) => {
        shift(leg(p, 'INSURER'), 'keptMinor', 1n);
        shift(leg(p, 'INSURER'), 'variationMinor', 1n);
        shift(leg(p, 'PLATFORM'), 'keptMinor', -1n);
        shift(leg(p, 'PLATFORM'), 'variationMinor', -1n);
      }),
      'INVARIANT_VIOLATION', // settlement_replay_mismatch : retenue ≠ rejeu des entrées
    ],
    [
      'base décalée entre jambes (HOST + 1 / PLATFORM − 1)',
      tamper((p) => {
        shift(leg(p, 'HOST'), 'basisMinor', 1n);
        shift(leg(p, 'HOST'), 'variationMinor', -1n);
        shift(leg(p, 'PLATFORM'), 'basisMinor', -1n);
        shift(leg(p, 'PLATFORM'), 'variationMinor', 1n);
      }),
      'INVARIANT_VIOLATION', // base ≠ trip_leg_balance.captured_minor
    ],
  ] as const)(
    'ancienne limite connue (inversée par US-049) : %s ⇒ refusé, avec ou sans état capturé',
    async (_, payload, withCapture) => {
      await worker(async (tx) => {
        const trip = await insertTrip(tx, COUNTRIES[0], 21);
        await setSessionContext(tx, { kind: 'WORKER', workerName: 'settlement' });
        // sans état capturé : base ou retenue ≠ rejeu des entrées (settlement_replay_mismatch)
        expect(await codeOf(callRecord(tx, { tripId: trip.id, version: 1 }, payload))).toBe(
          'INVARIANT_VIOLATION',
        );
      });
      // avec l'état capturé tenu : base contrôlée jambe par jambe, retenue par le rejeu
      await worker(async (tx) => {
        const trip = await insertTrip(tx, COUNTRIES[0], 22);
        await captureLegs(tx, trip.id, tj('TJ01').legsMinor);
        await setSessionContext(tx, { kind: 'WORKER', workerName: 'settlement' });
        expect(await codeOf(callRecord(tx, { tripId: trip.id, version: 1 }, payload))).toBe(
          withCapture,
        );
      });
    },
  );

  it.each(cases)('%s', async (_, payload, code) => {
    await worker(async (tx) => {
      const trip = await insertTrip(tx, COUNTRIES[0], 9);
      await setSessionContext(tx, { kind: 'WORKER', workerName: 'settlement' });
      expect(await codeOf(callRecord(tx, { tripId: trip.id, version: 1 }, payload))).toBe(code);
    });
  });
});

describe('US-018 — RLS-21 / RLS-25 : seule la commande écrit, seul le travailleur settlement l’appelle', () => {
  it('travailleur hors liste (payout) ou contexte absent : commande refusée (42501)', async () => {
    for (const name of ['payout', 'hold_expiry']) {
      await worker(async (tx) => {
        const trip = await insertTrip(tx, COUNTRIES[0], 10);
        await setSessionContext(tx, { kind: 'WORKER', workerName: name });
        await expect(
          callRecord(tx, { tripId: trip.id, version: 1 }, payloadOf(recordOfVector('T03'))),
        ).rejects.toMatchObject({ code: '42501' });
      });
    }
    await worker(async (tx) => {
      const trip = await insertTrip(tx, COUNTRIES[0], 11);
      await expect(
        callRecord(tx, { tripId: trip.id, version: 1 }, payloadOf(recordOfVector('T03'))),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('app_api ne peut pas exécuter la commande ; app_api et app_worker n’écrivent aucune table d’argent', async () => {
    await withRole('app_api', async (client) => {
      await expect(
        withTestTransaction(client, {}, (tx) =>
          callRecord(tx, { tripId: uuid(), version: 1 }, payloadOf(recordOfVector('T03'))),
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
    const sqls = [
      `INSERT INTO core.settlement_settlement (id) VALUES (gen_random_uuid())`,
      `INSERT INTO core.settlement_settlement_leg (settlement_id) VALUES (gen_random_uuid())`,
      `INSERT INTO core.settlement_trip_leg_balance (trip_id) VALUES (gen_random_uuid())`,
      `UPDATE core.settlement_settlement SET guest_refund_minor = 0`,
      `UPDATE core.settlement_settlement_leg SET kept_minor = 0`,
      `UPDATE core.settlement_trip_leg_balance SET released_minor = 0`,
      `DELETE FROM core.settlement_settlement`,
      `DELETE FROM core.settlement_settlement_line`,
      `DELETE FROM core.settlement_settlement_tax_line`,
      `DELETE FROM core.settlement_trip_leg_balance`,
    ];
    for (const role of ['app_api', 'app_worker'] as const) {
      await withRole(role, async (client) => {
        for (const sql of sqls) {
          await expect(
            withTestTransaction(client, {}, async (tx) => {
              if (role === 'app_worker') {
                await setSessionContext(tx, { kind: 'WORKER', workerName: 'settlement' });
              }
              return tx.query(sql);
            }),
            `${role} ${sql}`,
          ).rejects.toMatchObject({ code: '42501' });
        }
      });
    }
  });
});

describe('US-018 — lectures : hôte titulaire = jambe HOST de ses trips seulement ; aucune fuite entre hôtes ni entre pays', () => {
  let world: World;
  /** settlement par (pays, trip) : a1, a2 (compte A), b1 (compte B). */
  const sid = new Map<string, string>();
  const key = (i: number, t: 'a1' | 'a2' | 'b1') => `${i}:${t}`;
  const w = (i: number): CountryWorld => {
    const x = world.countries[i];
    if (!x) throw new Error(`pays ${i}`);
    return x;
  };

  beforeAll(async () => {
    const api = await connectAs('app_api');
    try {
      world = await buildWorld(api, COUNTRIES);
    } finally {
      await releaseClient(api);
    }
    await withRole('app_worker', async (client) => {
      await withTestTransaction(client, { commit: true }, async (tx) => {
        for (const [i, x] of world.countries.entries()) {
          const rec = recordOfVector(ref(x.c as Country).vector);
          for (const t of ['a1', 'a2', 'b1'] as const) {
            sid.set(
              key(i, t),
              await recordAsSettlementWorker(tx, { tripId: x.trips[t].id, version: 1 }, rec),
            );
          }
        }
      });
    });
  });

  const legsVisible = async (tx: pg.ClientBase): Promise<{ s: string; leg: string }[]> => {
    const { rows } = await tx.query<{ s: string; leg: string }>(
      `SELECT settlement_id::text AS s, leg FROM core.settlement_settlement_leg ORDER BY 1, 2`,
    );
    return rows;
  };
  const visible = async (tx: pg.ClientBase, table: string, col = 'id'): Promise<string[]> => {
    const { rows } = await tx.query<{ v: string }>(
      `SELECT DISTINCT ${col}::text AS v FROM core.${table} ORDER BY 1`,
    );
    return rows.map((r) => r.v);
  };
  const ours = (pairs: [number, 'a1' | 'a2' | 'b1'][]): string[] =>
    pairs.map(([i, t]) => sid.get(key(i, t)) ?? '').sort();
  /** Restreint une lecture aux règlements de ce monde (d'autres fichiers en ont commité). */
  const mine = (ids: string[]): string[] => ids.filter((x) => [...sid.values()].includes(x)).sort();

  it('RLS-2 : titulaire de A dans chaque pays ⇒ jambe HOST de a1 et a2 de CE pays ; ni en-tête, ni lignes', async () => {
    await withRole('app_api', async (client) => {
      for (const i of [0, 1]) {
        await asActor(
          client,
          { kind: 'HOST', actorId: world.holderA, orgId: w(i).orgA },
          async (tx) => {
            const legs = await legsVisible(tx);
            expect(legs.every((l) => l.leg === 'HOST')).toBe(true);
            expect(legs.map((l) => l.s).sort()).toEqual(
              ours([
                [i, 'a1'],
                [i, 'a2'],
              ]),
            );
            expect(await visible(tx, 'settlement_settlement')).toEqual([]);
            expect(await visible(tx, 'settlement_settlement_line', 'settlement_id')).toEqual([]);
            expect(await visible(tx, 'settlement_settlement_tax_line', 'settlement_id')).toEqual(
              [],
            );
            // montant de la jambe HOST = TJ02a (PA) / TJ08a + TJ08b (PY), jamais celui de l'autre pays
            const kept = await tx.query<{ k: string }>(
              `SELECT DISTINCT kept_minor::text AS k FROM core.settlement_settlement_leg`,
            );
            const r = ref(w(i).c as Country);
            const expected = tj(r.capture).legsMinor.HOST + tj(r.variation).legsMinor.HOST;
            expect(kept.rows.map((x) => BigInt(x.k))).toEqual([expected]);
          },
        );
      }
    });
  });

  it('RLS-2 : titulaire de B ⇒ b1 seulement ; titulaire de B avec l’org_id de A forgé ⇒ 0 ligne', async () => {
    await withRole('app_api', async (client) => {
      for (const i of [0, 1]) {
        const x = w(i);
        await asActor(client, { kind: 'HOST', actorId: x.holderB, orgId: x.orgB }, async (tx) => {
          expect((await legsVisible(tx)).map((l) => l.s)).toEqual(ours([[i, 'b1']]));
        });
        await asActor(client, { kind: 'HOST', actorId: x.holderB, orgId: x.orgA }, async (tx) => {
          expect(await legsVisible(tx)).toEqual([]);
        });
      }
    });
  });

  it('RLS-28 : co-hôte (même actif) ⇒ 0 ligne de jambe ; titulaire avec une portée véhicule ⇒ 0', async () => {
    await withRole('app_api', async (client) => {
      const x = w(0);
      await asActor(client, { kind: 'HOST', actorId: world.cohost, orgId: x.orgA }, async (tx) => {
        expect(await legsVisible(tx)).toEqual([]);
        expect(await visible(tx, 'settlement_trip_leg_balance', 'trip_id')).toEqual([]);
      });
      await asActor(
        client,
        { kind: 'HOST', actorId: world.holderA, orgId: x.orgA, vehicleScope: [x.v1] },
        async (tx) => {
          expect(await legsVisible(tx)).toEqual([]);
        },
      );
    });
  });

  it('voyageur : 0 ligne sur toutes les tables d’argent ; contexte absent : 0 ligne', async () => {
    await withRole('app_api', async (client) => {
      for (const run of [
        (fn: (tx: pg.ClientBase) => Promise<void>) =>
          asActor(client, { kind: 'GUEST', actorId: world.guest1 }, fn),
        (fn: (tx: pg.ClientBase) => Promise<void>) => withRawContext(client, {}, fn),
      ]) {
        await run(async (tx) => {
          expect(await visible(tx, 'settlement_settlement')).toEqual([]);
          expect(await legsVisible(tx)).toEqual([]);
          expect(await visible(tx, 'settlement_settlement_line', 'settlement_id')).toEqual([]);
          expect(await visible(tx, 'settlement_trip_leg_balance', 'trip_id')).toEqual([]);
        });
      }
    });
  });

  it('staff : FINANCE {premier pays} ⇒ ce pays seulement ; OPS ⇒ jambes du dossier seulement (RLS-23) ; ADMIN ⇒ les deux pays', async () => {
    const all = COUNTRIES.map((c) => c.country);
    await withRole('app_api', async (client) => {
      await asActor(
        client,
        { kind: 'STAFF', actorId: world.staff.financeFirst, countryScope: all },
        async (tx) => {
          expect(mine(await visible(tx, 'settlement_settlement'))).toEqual(
            ours([
              [0, 'a1'],
              [0, 'a2'],
              [0, 'b1'],
            ]),
          );
          expect(mine(await visible(tx, 'settlement_settlement_line', 'settlement_id'))).toEqual(
            ours([
              [0, 'a1'],
              [0, 'a2'],
              [0, 'b1'],
            ]),
          );
          const legs = (await legsVisible(tx)).filter((l) => [...sid.values()].includes(l.s));
          expect(legs).toHaveLength(12); // 3 règlements × 4 jambes
        },
      );
      await asActor(
        client,
        { kind: 'STAFF', actorId: world.staff.opsFirst, countryScope: all },
        async (tx) => {
          // RLS-23 : jambes du trip du dossier seulement ; ni en-tête, ni lignes, ni taxes
          expect(mine(await visible(tx, 'settlement_settlement'))).toEqual([]);
          expect(mine(await visible(tx, 'settlement_settlement_line', 'settlement_id'))).toEqual(
            [],
          );
          expect(
            mine(await visible(tx, 'settlement_settlement_tax_line', 'settlement_id')),
          ).toEqual([]);
          expect(mine((await legsVisible(tx)).map((l) => l.s))).toEqual(
            Array(4).fill(sid.get(key(0, 'a1'))),
          );
        },
      );
      await asActor(
        client,
        { kind: 'STAFF', actorId: world.staff.supportAll, countryScope: all },
        async (tx) => {
          expect(mine(await visible(tx, 'settlement_settlement'))).toEqual([]);
        },
      );
      await asActor(
        client,
        { kind: 'STAFF', actorId: world.staff.adminAll, countryScope: all },
        async (tx) => {
          expect(mine(await visible(tx, 'settlement_settlement'))).toEqual(
            [...sid.values()].sort(),
          );
        },
      );
      await asActor(
        client,
        { kind: 'STAFF', actorId: world.staff.adminAll, countryScope: [all[1] ?? ''] },
        async (tx) => {
          expect(mine(await visible(tx, 'settlement_settlement'))).toEqual(
            ours([
              [1, 'a1'],
              [1, 'a2'],
              [1, 'b1'],
            ]),
          );
        },
      );
    });
  });

  it('travailleurs : liste blanche (payout) ⇒ lecture ; hors liste (hold_expiry) ⇒ 0 ligne', async () => {
    await withRole('app_worker', async (client) => {
      await withTestTransaction(client, {}, async (tx) => {
        await setSessionContext(tx, { kind: 'WORKER', workerName: 'payout' });
        expect(mine(await visible(tx, 'settlement_settlement'))).toEqual([...sid.values()].sort());
      });
      await withTestTransaction(client, {}, async (tx) => {
        await setSessionContext(tx, { kind: 'WORKER', workerName: 'hold_expiry' });
        expect(await visible(tx, 'settlement_settlement')).toEqual([]);
        expect(await legsVisible(tx)).toEqual([]);
      });
    });
  });
});
