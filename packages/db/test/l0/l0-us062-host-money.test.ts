/**
 * US-062 — rôle P2P_HOST, politiques RLS de l'hôte, tables d'argent et minimisation (0035, 0036 ;
 * 17 §2.3 RLS-2, RLS-21 à RLS-26, RLS-28 ; réserves de la revue sécurité US-056 ; ADR-064).
 *
 * Sous les rôles de PRODUCTION (assertion L0-05 : withRole / connectAs), contexte posé par
 * `setSessionContext` (asActor), sur des DONNÉES RÉELLES dans les deux pays (USD et PYG sans
 * décimale) :
 * - règlements v1 enregistrés par la vraie commande (`settlement_cmd_record`, travailleur
 *   `settlement`) à partir des vecteurs de l'export (T03 / T27) ; état capturé et jambes de
 *   paiement aux montants des vecteurs TJ01 / TJ08a ; avances, bordereaux et position de
 *   l'assureur posés par la fixture 9700 (leurs écrivains métier arrivent avec US-224, US-227) ;
 * - monde d'US-011 (`support/rls.ts`) : le MÊME particulier titulaire du compte A dans les deux
 *   pays, un co-hôte de portée {v1}, l'hôte B, deux voyageurs, le staff.
 * Les attendus viennent de 17 §2.3 (qui voit quoi) et des vecteurs de l'export, jamais du code testé.
 */
import { legVector, loadGoldenVectors } from '@rueda/money/golden-vectors';
import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { setSessionContext } from '../../src/index.ts';
import {
  connectAs,
  releaseClient,
  withRole,
  withTestTransaction,
} from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import {
  asActor,
  buildWorld,
  sorted,
  staff,
  staffSessionHash,
  uuid,
  withRawContext,
  type CountryWorld,
  type TestContext,
  type World,
} from '../support/rls.ts';
import {
  callRecord,
  captureLegs,
  insertTrip,
  payloadOf,
  recordAsSettlementWorker,
  recordOfVector,
} from '../support/settlement.ts';

const golden = loadGoldenVectors();
/** Vecteurs de référence par devise (comme l0-stl-settlement) : règlement et capture. */
const REF: Readonly<Record<string, { readonly vector: string; readonly capture: string }>> = {
  USD: { vector: 'T03', capture: 'TJ01' },
  PYG: { vector: 'T27', capture: 'TJ08a' },
};
const refOf = (currency: string): { vector: string; capture: string } => {
  const r = REF[currency];
  if (!r) throw new Error(`aucun vecteur de référence en ${currency}`);
  return r;
};
const captureOf = (currency: string) => legVector(golden, refOf(currency).capture);

const REASON = 'Décision FINANCE motivée pour le test';
const TRIPS = ['a1', 'a2', 'b1'] as const;
type TripKey = (typeof TRIPS)[number];

interface CountryMoney {
  /** règlement v1 par trip */
  readonly settlement: Record<TripKey, string>;
  /** opération de capture par trip (a1, b1) */
  readonly op: { readonly a1: string; readonly b1: string };
  /** avances : créance de A sur a1, crédit au-delà de PLATFORM sur a2, créance de B sur b1 */
  readonly adv: { readonly a1: string; readonly a2Credit: string; readonly b1: string };
  /** avances réservées aux preuves FINANCE (RLS-24), créances de A sur a2 */
  readonly finance: { readonly decide: string; readonly writeOff: string };
  readonly bordereau: string;
  readonly insurer: string;
}

let world: World;
const money: CountryMoney[] = [];
/** FINANCE A et B de portée {premier pays}, OPS sans dossier ; empreintes des sessions. */
const people = {
  financeA: '',
  financeB: '',
  opsNoCase: '',
  financeASecond: Buffer.alloc(0),
};
const GUEST_BIRTH = '1990-06-15';

const w = (i: number): CountryWorld => {
  const x = world.countries[i];
  if (!x) throw new Error(`pays ${i}`);
  return x;
};
const m = (i: number): CountryMoney => {
  const x = money[i];
  if (!x) throw new Error(`argent du pays ${i}`);
  return x;
};
const first = (): string => w(0).c.country;
const bothCountries = (): string[] => COUNTRIES.map((c) => c.country);
const hashOf = (actor: string): Buffer => Buffer.from(staffSessionHash(actor) ?? '', 'hex');

beforeAll(async () => {
  const api = await connectAs('app_api');
  try {
    world = await buildWorld(api, COUNTRIES);
    await withTestTransaction(api, { commit: true }, async (tx) => {
      people.financeA = await staff(tx, 'FINANCE', [first()]);
      people.financeB = await staff(tx, 'FINANCE', [first()]);
      people.opsNoCase = await staff(tx, 'OPS_AGENT', [first()]);
      // seconde session élevée de FINANCE A : la MÊME personne, un autre jeton
      people.financeASecond = createHash('sha256').update(randomBytes(32)).digest();
      await tx.query('SELECT test_fixture.iam_open_elevated_session($1, $2)', [
        people.financeA,
        people.financeASecond,
      ]);
      await tx.query('SELECT test_fixture.us062_set_birth_date($1, $2::date)', [
        world.guest1,
        GUEST_BIRTH,
      ]);
      for (const x of world.countries) {
        // le titulaire donne PAR ERREUR la permission des relevés de gains à son co-hôte (RLS-28)
        await tx.query('SELECT test_fixture.us062_set_permission_overrides($1, $2, $3::text[])', [
          world.cohost,
          x.orgA,
          ['finance.read_org_statements'],
        ]);
        const v = captureOf(x.c.currency);
        const host = (v.legsMinor['HOST'] ?? 0n).toString();
        const insurerLeg = (v.legsMinor['INSURER'] ?? 0n).toString();
        const legs = JSON.stringify(
          Object.fromEntries(Object.entries(v.legsMinor).map(([k, a]) => [k, a.toString()])),
        );
        const op = { a1: uuid(), b1: uuid() };
        for (const [id, trip] of [
          [op.a1, x.trips.a1.id],
          [op.b1, x.trips.b1.id],
        ] as const) {
          await tx.query(
            `SELECT test_fixture.pay_insert_operation_raw($1, $2, 'CAPTURE', $3::bigint, $4::jsonb, true)`,
            [id, trip, v.totalMinor.toString(), legs],
          );
        }
        const adv = { a1: uuid(), a2Credit: uuid(), b1: uuid() };
        const finance = { decide: uuid(), writeOff: uuid() };
        for (const [id, trip, cause] of [
          [adv.a1, x.trips.a1.id, 'RELEASED_LEG'],
          [adv.a2Credit, x.trips.a2.id, 'CREDIT_BEYOND_PLATFORM'],
          [adv.b1, x.trips.b1.id, 'RELEASED_LEG'],
          [finance.decide, x.trips.a2.id, 'RELEASED_LEG'],
          [finance.writeOff, x.trips.a2.id, 'RELEASED_LEG'],
        ] as const) {
          await tx.query('SELECT test_fixture.us062_insert_advance($1, $2, $3, $4::bigint)', [
            id,
            trip,
            cause,
            host,
          ]);
        }
        const bordereau = uuid();
        const insurer = uuid();
        await tx.query('SELECT test_fixture.us062_insert_bordereau($1, $2, $3, $4::bigint)', [
          bordereau,
          x.c.country,
          x.c.currency,
          insurerLeg,
        ]);
        await tx.query('SELECT test_fixture.us062_insert_bordereau_line($1, $2, $3::bigint)', [
          bordereau,
          x.trips.a1.id,
          insurerLeg,
        ]);
        await tx.query('SELECT test_fixture.us062_insert_insurer_ledger($1, $2, $3, $4::bigint)', [
          insurer,
          x.c.country,
          x.c.currency,
          insurerLeg,
        ]);
        money.push({
          settlement: { a1: '', a2: '', b1: '' },
          op,
          adv,
          finance,
          bordereau,
          insurer,
        });
      }
    });
  } finally {
    await releaseClient(api);
  }
  // règlements v1 par la vraie commande, puis état capturé (fixture 9400, égal à la base v1)
  await withRole('app_worker', async (client) => {
    await withTestTransaction(client, { commit: true }, async (tx) => {
      for (const [i, x] of world.countries.entries()) {
        const rec = recordOfVector(refOf(x.c.currency).vector);
        for (const t of TRIPS) {
          m(i).settlement[t] = await recordAsSettlementWorker(
            tx,
            { tripId: x.trips[t].id, version: 1 },
            rec,
          );
        }
      }
    });
    await withTestTransaction(client, { commit: true }, async (tx) => {
      for (const x of world.countries) {
        const v = captureOf(x.c.currency);
        for (const t of TRIPS) await captureLegs(tx, x.trips[t].id, v.legsMinor);
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------------------------------

const api = <T>(fn: (client: pg.Client) => Promise<T>): Promise<T> => withRole('app_api', fn);

const ourTrips = (): string[] => world.countries.flatMap((x) => TRIPS.map((t) => x.trips[t].id));
const ourSettlements = (): string[] => money.flatMap((x) => TRIPS.map((t) => x.settlement[t]));
const ourOps = (): string[] => money.flatMap((x) => [x.op.a1, x.op.b1]);
const ourAdvances = (): string[] =>
  money.flatMap((x) => [x.adv.a1, x.adv.a2Credit, x.adv.b1, x.finance.decide, x.finance.writeOff]);
const ourBordereaux = (): string[] => money.map((x) => x.bordereau);
const ourInsurers = (): string[] => money.map((x) => x.insurer);

/** Lignes visibles des trois tables de jambes, limitées à ce monde : `table:clé/jambe`. */
async function legs(tx: pg.ClientBase): Promise<string[]> {
  const out: string[] = [];
  const balance = await tx.query<{ k: string }>(
    `SELECT trip_id::text || '/' || leg AS k FROM core.settlement_trip_leg_balance
      WHERE trip_id = ANY ($1::uuid[])`,
    [ourTrips()],
  );
  out.push(...balance.rows.map((r) => `balance:${r.k}`));
  const stl = await tx.query<{ k: string }>(
    `SELECT trip_id::text || '/' || leg AS k FROM core.settlement_settlement_leg
      WHERE settlement_id = ANY ($1::uuid[])`,
    [ourSettlements()],
  );
  out.push(...stl.rows.map((r) => `settlement:${r.k}`));
  const op = await tx.query<{ k: string }>(
    `SELECT trip_id::text || '/' || leg AS k FROM core.payment_payment_operation_leg
      WHERE operation_id = ANY ($1::uuid[])`,
    [ourOps()],
  );
  out.push(...op.rows.map((r) => `operation:${r.k}`));
  return out.sort();
}

/** Jambes attendues : `tables` × trips × jambes. */
function expected(
  trips: readonly string[],
  legNames: readonly string[],
  withOps: readonly string[] = trips,
): string[] {
  const out: string[] = [];
  for (const t of trips) {
    for (const l of legNames) {
      out.push(`balance:${t}/${l}`, `settlement:${t}/${l}`);
      if (withOps.includes(t)) out.push(`operation:${t}/${l}`);
    }
  }
  return out.sort();
}
const ALL_LEGS = ['HOST', 'INSURER', 'PLATFORM', 'TAX_THIRD_PARTY'];

async function idsOf(tx: pg.ClientBase, table: string, col: string, ours: string[]) {
  if (!/^[a-z_]+$/.test(table) || !/^[a-z_]+$/.test(col)) throw new Error('identifiant');
  const { rows } = await tx.query<{ v: string }>(
    `SELECT DISTINCT ${col}::text AS v FROM core.${table} WHERE ${col} = ANY ($1::uuid[]) ORDER BY 1`,
    [ours],
  );
  return rows.map((r) => r.v);
}
/** Lignes visibles des tables d'argent d'US-062 et des vues, limitées à ce monde. */
interface MoneyRows {
  readonly advance: string[];
  readonly hostAdvance: string[];
  readonly bordereau: string[];
  readonly line: string[];
  readonly ledger: string[];
  readonly approval: string[];
}
async function moneyTables(tx: pg.ClientBase): Promise<MoneyRows> {
  return {
    advance: await idsOf(tx, 'settlement_platform_advance', 'id', ourAdvances()),
    hostAdvance: await idsOf(tx, 'settlement_host_advance_v', 'id', ourAdvances()),
    bordereau: await idsOf(tx, 'settlement_insurer_bordereau', 'id', ourBordereaux()),
    line: await idsOf(tx, 'settlement_insurer_bordereau_line', 'bordereau_id', ourBordereaux()),
    ledger: await idsOf(tx, 'settlement_insurer_ledger_state', 'insurer_id', ourInsurers()),
    approval: await idsOf(tx, 'settlement_finance_approval', 'subject_id', [
      ...ourAdvances(),
      ...ourBordereaux(),
    ]),
  };
}
const NOTHING = {
  advance: [],
  hostAdvance: [],
  bordereau: [],
  line: [],
  ledger: [],
  approval: [],
};

describe('RLS-2 — jambes : titulaire = jambe HOST de SES trips ; co-hôte, autre hôte, autre pays : rien', () => {
  it.each([0, 1])('pays n° %i', async (i) => {
    const x = w(i);
    await api(async (client) => {
      await asActor(client, { kind: 'HOST', actorId: world.holderA, orgId: x.orgA }, async (tx) => {
        expect(await legs(tx)).toEqual(
          expected([x.trips.a1.id, x.trips.a2.id], ['HOST'], [x.trips.a1.id]),
        );
      });
      await asActor(client, { kind: 'HOST', actorId: x.holderB, orgId: x.orgB }, async (tx) => {
        expect(await legs(tx)).toEqual(expected([x.trips.b1.id], ['HOST']));
      });
      // l'hôte B qui pose le compte A, le co-hôte actif, l'ancien co-hôte : rien
      for (const ctx of [
        { kind: 'HOST', actorId: x.holderB, orgId: x.orgA },
        { kind: 'HOST', actorId: world.cohost, orgId: x.orgA },
        { kind: 'HOST', actorId: world.exCohost, orgId: x.orgA },
        // le titulaire qui réduit sa portée à un véhicule n'est plus « tout le compte »
        { kind: 'HOST', actorId: world.holderA, orgId: x.orgA, vehicleScope: [x.v1] },
      ] as const) {
        await asActor(client, ctx, async (tx) => {
          expect(await legs(tx), JSON.stringify(ctx)).toEqual([]);
        });
      }
    });
  });

  it('pays contre pays : le même titulaire, compte du premier pays, ne voit aucune jambe du second', async () => {
    await api((client) =>
      asActor(client, { kind: 'HOST', actorId: world.holderA, orgId: w(0).orgA }, async (tx) => {
        const seen = await legs(tx);
        for (const t of TRIPS) {
          expect(seen.some((k) => k.includes(w(1).trips[t].id))).toBe(false);
        }
      }),
    );
  });
});

describe('RLS-28 — co-hôte muni PAR ERREUR de finance.read_org_statements : 0 ligne', () => {
  it.each([0, 1])('pays n° %i : la permission est bien là, is_org_holder() est faux', async (i) => {
    const x = w(i);
    await api(async (client) => {
      await asActor(client, { kind: 'HOST', actorId: world.cohost, orgId: x.orgA }, async (tx) => {
        const { rows } = await tx.query<{ perm: boolean; holder: boolean }>(
          `SELECT app.has_permission('finance.read_org_statements') AS perm,
                  app.is_org_holder() AS holder`,
        );
        expect(rows[0]).toEqual({ perm: true, holder: false });
        expect(await legs(tx)).toEqual([]);
        expect(await moneyTables(tx)).toEqual(NOTHING);
      });
      // le titulaire tient la permission de la matrice (P2P_HOST) ; un ancien co-hôte, rien
      await asActor(client, { kind: 'HOST', actorId: world.holderA, orgId: x.orgA }, async (tx) => {
        const { rows } = await tx.query<{ perm: boolean }>(
          `SELECT app.has_permission('finance.read_org_statements') AS perm`,
        );
        expect(rows[0]?.perm).toBe(true);
      });
      await asActor(
        client,
        { kind: 'HOST', actorId: world.exCohost, orgId: x.orgA },
        async (tx) => {
          const { rows } = await tx.query<{ perm: boolean }>(
            `SELECT app.has_permission('finance.read_org_statements') AS perm`,
          );
          expect(rows[0]?.perm).toBe(false);
        },
      );
    });
  });

  it('has_permission est faux pour tout acteur non HOST (voyageur, staff, travailleur, sans contexte)', async () => {
    await api(async (client) => {
      for (const ctx of [
        { kind: 'GUEST', actorId: world.guest1 },
        { kind: 'STAFF', actorId: world.staff.adminAll, countryScope: bothCountries() },
      ] as const) {
        await asActor(client, ctx, async (tx) => {
          const { rows } = await tx.query<{ perm: boolean }>(
            `SELECT app.has_permission('finance.read_org_statements') AS perm`,
          );
          expect(rows[0]?.perm, ctx.kind).toBe(false);
        });
      }
      const { rows } = await client.query<{ perm: boolean }>(
        `SELECT app.has_permission('finance.read_org_statements') AS perm`,
      );
      expect(rows[0]?.perm).toBe(false);
    });
  });
});

describe('RLS-21 / RLS-22 — aucune écriture directe ; app_anon et le voyageur ne lisent rien', () => {
  const TABLES = [
    'settlement_trip_leg_balance',
    'settlement_settlement_leg',
    'payment_payment_operation_leg',
    'settlement_insurer_ledger_state',
    'settlement_insurer_bordereau',
    'settlement_platform_advance',
    // et les autres tables d'argent d'US-062
    'settlement_insurer_bordereau_line',
    'settlement_finance_approval',
  ] as const;
  const writes = (t: string): string[] => [
    `INSERT INTO core.${t} DEFAULT VALUES`,
    `UPDATE core.${t} SET country_code = country_code`,
    `DELETE FROM core.${t}`,
    `TRUNCATE core.${t}`,
  ];

  const apiActors = (): TestContext[] => [
    { kind: 'GUEST', actorId: world.guest1 },
    { kind: 'HOST', actorId: world.holderA, orgId: w(0).orgA },
    { kind: 'STAFF', actorId: world.staff.opsFirst, countryScope: [first()] },
    { kind: 'STAFF', actorId: world.staff.adminAll, countryScope: bothCountries() },
  ];

  it('app_api (voyageur, hôte, OPS, ADMIN) : INSERT / UPDATE / DELETE / TRUNCATE directs refusés (42501)', async () => {
    await api(async (client) => {
      for (const ctx of apiActors()) {
        for (const t of TABLES) {
          for (const sql of writes(t)) {
            await expect(
              asActor(client, ctx, (tx) => tx.query(sql)),
              `${ctx.kind} ${sql}`,
            ).rejects.toMatchObject({ code: '42501' });
          }
        }
      }
    });
  });

  it('app_worker (travailleurs de la liste blanche) : écritures directes refusées (42501), commandes FINANCE non exécutables', async () => {
    await withRole('app_worker', async (client) => {
      for (const name of ['settlement', 'payment_command', 'payout', 'bordereau']) {
        for (const t of TABLES) {
          for (const sql of writes(t)) {
            await expect(
              withTestTransaction(client, {}, async (tx) => {
                await setSessionContext(tx, { kind: 'WORKER', workerName: name });
                return tx.query(sql);
              }),
              `${name} ${sql}`,
            ).rejects.toMatchObject({ code: '42501' });
          }
        }
        for (const sql of [
          `SELECT * FROM core.settlement_cmd_request_finance_action($1, gen_random_uuid(), 'DECIDE_ADVANCE', gen_random_uuid(), 'motif de dix caractères')`,
          `SELECT * FROM core.settlement_cmd_approve_finance_action($1, gen_random_uuid())`,
          `SELECT * FROM core.settlement_advance_approvers($1, gen_random_uuid())`,
        ]) {
          await expect(
            withTestTransaction(client, {}, async (tx) => {
              await setSessionContext(tx, { kind: 'WORKER', workerName: name });
              return tx.query(sql, [randomBytes(32)]);
            }),
            sql,
          ).rejects.toMatchObject({ code: '42501' });
        }
      }
    });
  });

  it('aucun changement : après toutes les tentatives, les lignes et montants sont intacts (ADMIN)', async () => {
    await api((client) =>
      asActor(
        client,
        { kind: 'STAFF', actorId: world.staff.adminAll, countryScope: bothCountries() },
        async (tx) => {
          expect(await legs(tx)).toEqual(
            expected(
              ourTrips(),
              ALL_LEGS,
              world.countries.flatMap((x) => [x.trips.a1.id, x.trips.b1.id]),
            ),
          );
          const t = await moneyTables(tx);
          expect(t.advance).toEqual(sorted(ourAdvances()));
          expect(t.bordereau).toEqual(sorted(ourBordereaux()));
          expect(t.ledger).toEqual(sorted(ourInsurers()));
        },
      ),
    );
  });

  it('app_anon : aucun droit de lecture sur les tables d’argent ni sur les vues (42501, a fortiori 0 ligne)', async () => {
    await withRole('app_anon', async (client) => {
      for (const t of [...TABLES, 'settlement_host_advance_v', 'booking_host_guest_v']) {
        await expect(client.query(`SELECT 1 FROM core.${t}`), t).rejects.toMatchObject({
          code: '42501',
        });
      }
    });
  });

  it('voyageur (et session sans contexte) : 0 ligne sur toutes les tables d’argent, jambes et vues', async () => {
    await api(async (client) => {
      await asActor(client, { kind: 'GUEST', actorId: world.guest1 }, async (tx) => {
        expect(await legs(tx)).toEqual([]);
        expect(await moneyTables(tx)).toEqual(NOTHING);
        const { rows } = await tx.query('SELECT trip_id FROM core.booking_host_guest_v');
        expect(rows).toEqual([]);
      });
      expect(await legs(client)).toEqual([]);
      expect(await moneyTables(client)).toEqual(NOTHING);
    });
  });
});

describe('RLS-23 / RLS-25 — OPS, SUPPORT et travailleurs hors liste', () => {
  it('OPS sans dossier : 0 ligne ; OPS avec un dossier de trip : jambes de CE trip seulement, rien sur insurer_*, avances, demandes', async () => {
    const x = w(0);
    await api(async (client) => {
      await asActor(
        client,
        { kind: 'STAFF', actorId: people.opsNoCase, countryScope: [first()] },
        async (tx) => {
          expect(await legs(tx)).toEqual([]);
          expect(await moneyTables(tx)).toEqual(NOTHING);
        },
      );
      await asActor(
        client,
        { kind: 'STAFF', actorId: world.staff.opsFirst, countryScope: [first()] },
        async (tx) => {
          expect(await legs(tx)).toEqual(expected([x.trips.a1.id], ALL_LEGS));
          expect(await moneyTables(tx)).toEqual(NOTHING);
        },
      );
      await asActor(
        client,
        { kind: 'STAFF', actorId: world.staff.supportAll, countryScope: bothCountries() },
        async (tx) => {
          expect(await legs(tx)).toEqual([]);
          expect(await moneyTables(tx)).toEqual(NOTHING);
        },
      );
    });
  });

  it('FINANCE / ADMIN : tables d’argent de la portée pays (contrôle positif)', async () => {
    await api(async (client) => {
      await asActor(
        client,
        { kind: 'STAFF', actorId: world.staff.adminAll, countryScope: bothCountries() },
        async (tx) => {
          const t = await moneyTables(tx);
          expect(t.line).toEqual(sorted(ourBordereaux()));
          // la vue de l'hôte est une vue sur la table : ADMIN y voit les créances RELEASED_LEG
          expect(t.hostAdvance).toEqual(
            sorted(
              money.flatMap((c) => [c.adv.a1, c.adv.b1, c.finance.decide, c.finance.writeOff]),
            ),
          );
        },
      );
    });
  });

  it('RLS-25 : travailleur hors liste blanche : 0 ligne, commande d’argent refusée (42501)', async () => {
    await withRole('app_worker', async (client) => {
      for (const name of ['hold_expiry', 'booking_conversion', 'webhook_ingest']) {
        await withTestTransaction(client, {}, async (tx) => {
          await setSessionContext(tx, { kind: 'WORKER', workerName: name });
          const balance = await tx.query(
            'SELECT 1 FROM core.settlement_trip_leg_balance WHERE trip_id = ANY ($1::uuid[])',
            [ourTrips()],
          );
          expect(balance.rows, name).toEqual([]);
          expect(await idsOf(tx, 'settlement_platform_advance', 'id', ourAdvances()), name).toEqual(
            [],
          );
          expect(
            await idsOf(tx, 'settlement_insurer_bordereau', 'id', ourBordereaux()),
            name,
          ).toEqual([]);
          expect(
            await idsOf(tx, 'settlement_insurer_ledger_state', 'insurer_id', ourInsurers()),
            name,
          ).toEqual([]);
        });
        // cmd_apply_leg_movement n'existe pas encore (US-061 / US-223) : la commande d'argent
        // existante applique la même règle (travailleur dans la politique et dans le corps)
        await expect(
          withTestTransaction(client, {}, async (tx) => {
            const trip = await insertTrip(tx, COUNTRIES[0], 40);
            await setSessionContext(tx, { kind: 'WORKER', workerName: name });
            return callRecord(
              tx,
              { tripId: trip.id, version: 1 },
              payloadOf(recordOfVector('T03')),
            );
          }),
          name,
        ).rejects.toMatchObject({ code: '42501' });
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------
// RLS-24 : décisions FINANCE à deux personnes
// ---------------------------------------------------------------------------------------------

interface Outcome {
  readonly outcome: string;
  readonly approval_id: string | null;
}

/** Un appel = une instruction (ADR-056, ADR-062) : transaction courte validée, contexte STAFF. */
async function finance(
  client: pg.ClientBase,
  actor: string,
  token: Buffer,
  sql: string,
  params: readonly unknown[],
  scope: readonly string[] = [first()],
): Promise<Outcome> {
  return withTestTransaction(client, { commit: true }, async (tx) => {
    await setSessionContext(tx, {
      kind: 'STAFF',
      actorId: actor,
      countryScope: scope,
      sessionTokenHash: token.toString('hex'),
    });
    const { rows } = await tx.query<Outcome>(sql, [token, ...params]);
    return rows[0] ?? { outcome: '', approval_id: null };
  });
}
const REQUEST = 'SELECT * FROM core.settlement_cmd_request_finance_action($1, $2, $3, $4, $5)';
const APPROVE = 'SELECT * FROM core.settlement_cmd_approve_finance_action($1, $2)';

async function advanceRow(client: pg.ClientBase, id: string) {
  const { rows } = await client.query<{
    status: string;
    decided_by: string | null;
    decision_second_by: string | null;
    written_off_by: string | null;
    write_off_second_by: string | null;
    written_off: boolean;
  }>('SELECT * FROM test_fixture.us062_advance_row($1)', [id]);
  return rows[0];
}
async function auditActions(client: pg.ClientBase, actor: string): Promise<string[]> {
  const { rows } = await client.query<{ action_code: string }>(
    'SELECT action_code FROM test_fixture.audit_rows_of_actor($1)',
    [actor],
  );
  return rows.map((r) => r.action_code);
}

describe('RLS-24 — FINANCE A puis FINANCE B de portée {premier pays}', () => {
  it('lectures : FINANCE {premier pays} ne voit rien du second pays (bordereaux, avances, jambes), même si la portée posée l’inclut', async () => {
    const second = w(1);
    await api((client) =>
      asActor(
        client,
        { kind: 'STAFF', actorId: people.financeA, countryScope: bothCountries() },
        async (tx) => {
          const t = await moneyTables(tx);
          expect(t.bordereau).toEqual([m(0).bordereau]);
          expect(t.advance).not.toContain(m(1).adv.a1);
          expect(t.advance.length).toBeGreaterThan(0);
          const seen = await legs(tx);
          for (const trip of TRIPS) {
            expect(seen.some((k) => k.includes(second.trips[trip].id))).toBe(false);
          }
        },
      ),
    );
  });

  it('DECIDE_ADVANCE : A demande ; A approuve (même session, puis seconde session) : refus journalisé, aucun effet ; B approuve : effet, decided_by ≠ decision_second_by', async () => {
    const adv = m(0).finance.decide;
    await api(async (client) => {
      const req = await finance(client, people.financeA, hashOf(people.financeA), REQUEST, [
        uuid(),
        'DECIDE_ADVANCE',
        adv,
        REASON,
      ]);
      expect(req.outcome).toBe('REQUESTED');
      const approval = req.approval_id ?? '';
      // demande seule : aucun effet d'argent
      expect(await advanceRow(client, adv)).toMatchObject({ decided_by: null, status: 'OPEN' });
      for (const token of [hashOf(people.financeA), people.financeASecond]) {
        expect((await finance(client, people.financeA, token, APPROVE, [approval])).outcome).toBe(
          'SELF_APPROVAL',
        );
      }
      // contexte forgé : actor_id de B posé avec le jeton de A ; l'identité vient de la session
      expect(
        (await finance(client, people.financeB, people.financeASecond, APPROVE, [approval]))
          .outcome,
      ).toBe('SELF_APPROVAL');
      expect(await advanceRow(client, adv)).toMatchObject({
        decided_by: null,
        decision_second_by: null,
      });
      expect(
        (await auditActions(client, people.financeA)).filter(
          (a) => a === 'FINANCE_SELF_APPROVAL_DENIED',
        ).length,
      ).toBeGreaterThanOrEqual(3);
      const ok = await finance(client, people.financeB, hashOf(people.financeB), APPROVE, [
        approval,
      ]);
      expect(ok).toEqual({ outcome: 'APPROVED', approval_id: approval });
      const row = await advanceRow(client, adv);
      expect(row).toMatchObject({
        decided_by: people.financeA,
        decision_second_by: people.financeB,
        status: 'OPEN',
      });
      expect(row?.decided_by).not.toBe(row?.decision_second_by);
      const { rows } = await client.query<{ status: string; approved_by: string }>(
        'SELECT status, approved_by FROM test_fixture.us062_approval_row($1)',
        [approval],
      );
      expect(rows[0]).toEqual({ status: 'APPROVED', approved_by: people.financeB });
      expect(await auditActions(client, people.financeB)).toContain('FINANCE_ACTION_APPROVED');
      // rejouée : plus en attente
      expect(
        (await finance(client, people.financeB, hashOf(people.financeB), APPROVE, [approval]))
          .outcome,
      ).toBe('NOT_PENDING');
    });
  });

  it('WRITE_OFF_RECEIVABLE puis ISSUE_BORDEREAU : même règle ; passage en perte et émission seulement par deux personnes', async () => {
    const adv = m(0).finance.writeOff;
    const bordereau = m(0).bordereau;
    await api(async (client) => {
      for (const [action, subject] of [
        ['WRITE_OFF_RECEIVABLE', adv],
        ['ISSUE_BORDEREAU', bordereau],
      ] as const) {
        const req = await finance(client, people.financeA, hashOf(people.financeA), REQUEST, [
          uuid(),
          action,
          subject,
          REASON,
        ]);
        expect(req.outcome, action).toBe('REQUESTED');
        // une seule demande en attente par (action, sujet)
        expect(
          (
            await finance(client, people.financeB, hashOf(people.financeB), REQUEST, [
              uuid(),
              action,
              subject,
              REASON,
            ])
          ).outcome,
        ).toBe('ALREADY_PENDING');
        expect(
          (
            await finance(client, people.financeA, people.financeASecond, APPROVE, [
              req.approval_id,
            ])
          ).outcome,
          action,
        ).toBe('SELF_APPROVAL');
        expect(
          (
            await finance(client, people.financeB, hashOf(people.financeB), APPROVE, [
              req.approval_id,
            ])
          ).outcome,
          action,
        ).toBe('APPROVED');
      }
      expect(await advanceRow(client, adv)).toMatchObject({
        status: 'WRITTEN_OFF',
        written_off_by: people.financeA,
        write_off_second_by: people.financeB,
        written_off: true,
      });
      const { rows } = await client.query<{
        status: string;
        issued_by: string;
        second_validated_by: string;
      }>(
        'SELECT status, issued_by, second_validated_by FROM test_fixture.us062_bordereau_row($1)',
        [bordereau],
      );
      expect(rows[0]).toEqual({
        status: 'ISSUED',
        issued_by: people.financeA,
        second_validated_by: people.financeB,
      });
    });
  });

  it('aucun accès PY : FINANCE {premier pays} ne peut ni demander ni approuver sur le second pays (FORBIDDEN journalisé)', async () => {
    await api(async (client) => {
      const req = await finance(
        client,
        people.financeA,
        hashOf(people.financeA),
        REQUEST,
        [uuid(), 'DECIDE_ADVANCE', m(1).finance.decide, REASON],
        bothCountries(),
      );
      expect(req).toEqual({ outcome: 'FORBIDDEN', approval_id: null });
      expect(await auditActions(client, people.financeA)).toContain('STAFF_FORBIDDEN');
      // un ADMIN des deux pays demande sur le second pays ; FINANCE B ne peut pas l'approuver
      const admin = await finance(
        client,
        world.staff.adminAll,
        hashOf(world.staff.adminAll),
        REQUEST,
        [uuid(), 'DECIDE_ADVANCE', m(1).finance.decide, REASON],
        bothCountries(),
      );
      expect(admin.outcome).toBe('REQUESTED');
      expect(
        (
          await finance(
            client,
            people.financeB,
            hashOf(people.financeB),
            APPROVE,
            [admin.approval_id],
            bothCountries(),
          )
        ).outcome,
      ).toBe('FORBIDDEN');
      expect(await advanceRow(client, m(1).finance.decide)).toMatchObject({ decided_by: null });
    });
  });

  it('sans session vivante ou hors contexte STAFF : aucune demande ; motif trop court : 22023', async () => {
    await api(async (client) => {
      // jeton inconnu : AUTH_REQUIRED (aucun acteur à journaliser)
      expect(
        (
          await finance(client, people.financeA, randomBytes(32), REQUEST, [
            uuid(),
            'DECIDE_ADVANCE',
            m(0).adv.a1,
            REASON,
          ])
        ).outcome,
      ).toBe('AUTH_REQUIRED');
      // bon jeton, contexte d'hôte : AUTH_REQUIRED
      const outcome = await withTestTransaction(client, {}, async (tx) => {
        await setSessionContext(tx, { kind: 'HOST', actorId: world.holderA, orgId: w(0).orgA });
        const { rows } = await tx.query<Outcome>(REQUEST, [
          hashOf(people.financeA),
          uuid(),
          'DECIDE_ADVANCE',
          m(0).adv.a1,
          REASON,
        ]);
        return rows[0]?.outcome;
      });
      expect(outcome).toBe('AUTH_REQUIRED');
      // motif trop court : 22023
      await expect(
        finance(client, people.financeA, hashOf(people.financeA), REQUEST, [
          uuid(),
          'DECIDE_ADVANCE',
          m(0).adv.a1,
          'court',
        ]),
      ).rejects.toMatchObject({ code: '22023' });
    });
  });

  it('UPDATE direct de decided_by / decision_second_by / status sous app_api : refusé (42501)', async () => {
    await api(async (client) => {
      for (const sql of [
        `UPDATE core.settlement_platform_advance SET decided_by = gen_random_uuid()`,
        `UPDATE core.settlement_platform_advance SET status = 'WRITTEN_OFF'`,
        `UPDATE core.settlement_insurer_bordereau SET status = 'ISSUED'`,
        `UPDATE core.settlement_finance_approval SET status = 'APPROVED'`,
      ]) {
        await expect(
          asActor(
            client,
            { kind: 'STAFF', actorId: people.financeB, countryScope: [first()] },
            (tx) => tx.query(sql),
          ),
          sql,
        ).rejects.toMatchObject({ code: '42501' });
      }
    });
  });

  it('réserve 3 d’US-056 : un travailleur ne passe jamais une avance en perte (politique cmd_advance_upd, sous cmd_money_owner)', async () => {
    await withRole('app_worker', async (client) => {
      for (const name of ['settlement', 'payout']) {
        await expect(
          withTestTransaction(client, {}, async (tx) => {
            await setSessionContext(tx, { kind: 'WORKER', workerName: name });
            return tx.query('SELECT test_fixture.us062_worker_write_off($1)', [m(1).adv.b1]);
          }),
          name,
        ).rejects.toMatchObject({ code: '42501' });
      }
    });
    await api(async (client) => {
      expect(await advanceRow(client, m(1).adv.b1)).toMatchObject({
        status: 'OPEN',
        written_off_by: null,
      });
    });
  });

  it('garde à deux personnes : même migrator ne peut pas écrire une décision sans demande approuvée correspondante', async () => {
    await api(async (client) => {
      await expect(
        withTestTransaction(client, {}, (tx) =>
          tx.query('SELECT test_fixture.us062_force_decision($1, $2, $3, NULL)', [
            m(1).adv.b1,
            people.financeA,
            people.financeB,
          ]),
        ),
      ).rejects.toMatchObject({ code: '23000', constraint: 'advance_two_person_rule' });
      // une demande APPROUVÉE existe (DECIDE_ADVANCE du premier pays), mais pour un AUTRE sujet
      const { rows } = await client.query<{ id: string }>(
        `SELECT approval_id AS id FROM test_fixture.us062_approval_row($1)`,
        [uuid()],
      );
      expect(rows).toEqual([]);
      await expect(
        withTestTransaction(client, {}, (tx) =>
          tx.query('SELECT test_fixture.us062_force_decision($1, $2, $3, $4)', [
            m(1).adv.b1,
            people.financeA,
            people.financeB,
            uuid(),
          ]),
        ),
      ).rejects.toMatchObject({ code: '23000', constraint: 'advance_two_person_rule' });
    });
  });
});

// ---------------------------------------------------------------------------------------------
// RLS-26 et minimisation (host_guest_v, host_advance_v)
// ---------------------------------------------------------------------------------------------

/** Âge en années révolues à l'instant du test (UTC) : attendu indépendant de la base. */
function ageAt(birth: string, now: Date): number {
  const [y, mo, d] = birth.split('-').map(Number) as [number, number, number];
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() + 1 < mo || (now.getUTCMonth() + 1 === mo && now.getUTCDate() < d)) age--;
  return age;
}

describe('RLS-26 et minimisation (NOUVELLE-16) — host_guest_v et host_advance_v', () => {
  it('host_guest_v : exactement prénom, âge, note et statut de vérification ; jamais l’identifiant, le nom, la naissance, l’email ni le téléphone', async () => {
    await api(async (client) => {
      const { rows } = await client.query<{ col: string }>(
        `SELECT a.attname::text AS col FROM pg_catalog.pg_attribute a
          WHERE a.attrelid = 'core.booking_host_guest_v'::regclass AND a.attnum > 0
            AND NOT a.attisdropped ORDER BY a.attnum`,
      );
      expect(rows.map((r) => r.col)).toEqual([
        'trip_id',
        'first_name',
        'age_years',
        'rating',
        'verification_status',
      ]);
    });
  });

  it.each([0, 1])(
    'pays n° %i : titulaire = voyageurs de SES trips ; co-hôte = véhicules de sa portée ; hôte B = les siens',
    async (i) => {
      const x = w(i);
      const now = new Date();
      await api(async (client) => {
        const guests = async (ctx: TestContext) =>
          asActor(client, ctx, async (tx) => {
            const r = await tx.query<{
              trip_id: string;
              first_name: string | null;
              age_years: number | null;
              rating: string | null;
              verification_status: string | null;
            }>(
              `SELECT trip_id, first_name, age_years, rating, verification_status
                 FROM core.booking_host_guest_v WHERE trip_id = ANY ($1::uuid[]) ORDER BY trip_id`,
              [ourTrips()],
            );
            return r.rows;
          });
        const holder = await guests({ kind: 'HOST', actorId: world.holderA, orgId: x.orgA });
        expect(holder.map((r) => r.trip_id)).toEqual(sorted([x.trips.a1.id, x.trips.a2.id]));
        const a1 = holder.find((r) => r.trip_id === x.trips.a1.id);
        // prénom de l'inscription de test (support/rls.ts) ; âge du voyageur 1 ; note et
        // vérification à venir avec leurs stories
        expect(a1).toEqual({
          trip_id: x.trips.a1.id,
          first_name: 'Rls',
          age_years: ageAt(GUEST_BIRTH, now),
          rating: null,
          verification_status: null,
        });
        expect(holder.find((r) => r.trip_id === x.trips.a2.id)?.age_years).toBeNull();
        const cohost = await guests({ kind: 'HOST', actorId: world.cohost, orgId: x.orgA });
        expect(cohost.map((r) => r.trip_id)).toEqual([x.trips.a1.id]);
        const hostB = await guests({ kind: 'HOST', actorId: x.holderB, orgId: x.orgB });
        expect(hostB.map((r) => r.trip_id)).toEqual([x.trips.b1.id]);
        for (const ctx of [
          { kind: 'HOST', actorId: x.holderB, orgId: x.orgA },
          { kind: 'HOST', actorId: world.exCohost, orgId: x.orgA },
          { kind: 'GUEST', actorId: world.guest1 },
          { kind: 'STAFF', actorId: world.staff.adminAll, countryScope: bothCountries() },
        ] as const) {
          expect(await guests(ctx), JSON.stringify(ctx)).toEqual([]);
        }
      });
    },
  );

  it('l’hôte ne lit plus guest_user_id du trip (42501) ni le compte du voyageur (0 ligne)', async () => {
    const x = w(0);
    await api(async (client) => {
      await expect(
        asActor(client, { kind: 'HOST', actorId: world.holderA, orgId: x.orgA }, (tx) =>
          tx.query('SELECT guest_user_id FROM core.booking_trip'),
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await asActor(client, { kind: 'HOST', actorId: world.holderA, orgId: x.orgA }, async (tx) => {
        const trips = await tx.query<{ id: string }>(
          'SELECT id FROM core.booking_trip WHERE id = ANY ($1::uuid[]) ORDER BY id',
          [ourTrips()],
        );
        expect(trips.rows.map((r) => r.id)).toEqual(sorted([x.trips.a1.id, x.trips.a2.id]));
        const acc = await tx.query(
          'SELECT id FROM core.iam_user_account WHERE id = ANY ($1::uuid[])',
          [[world.guest1, world.guest2]],
        );
        expect(acc.rows).toEqual([]);
      });
      // le voyageur lit toujours SES trips et SES opérations (politique réécrite sans guest_user_id)
      await asActor(client, { kind: 'GUEST', actorId: world.guest1 }, async (tx) => {
        const trips = await tx.query<{ id: string }>(
          'SELECT id FROM core.booking_trip WHERE id = ANY ($1::uuid[]) ORDER BY id',
          [ourTrips()],
        );
        expect(trips.rows.map((r) => r.id)).toEqual(
          sorted(world.countries.flatMap((c) => [c.trips.a1.id, c.trips.b1.id])),
        );
        const ops = await tx.query<{ id: string }>(
          'SELECT id FROM core.payment_payment_operation WHERE id = ANY ($1::uuid[]) ORDER BY id',
          [world.countries.flatMap((c) => [c.ops.a1, c.ops.b1, c.ops.h1])],
        );
        expect(ops.rows.map((r) => r.id)).toEqual(
          sorted(world.countries.flatMap((c) => [c.ops.a1, c.ops.b1, c.ops.h1])),
        );
      });
    });
  });

  it.each([0, 1])(
    'pays n° %i : host_advance_v = SA créance (RELEASED_LEG) seulement, sans identifiant du personnel ; jamais un autre hôte ni un crédit',
    async (i) => {
      const x = w(i);
      const c = m(i);
      await api(async (client) => {
        await asActor(
          client,
          { kind: 'HOST', actorId: world.holderA, orgId: x.orgA },
          async (tx) => {
            const t = await moneyTables(tx);
            expect(t.hostAdvance).toEqual(sorted([c.adv.a1, c.finance.decide, c.finance.writeOff]));
            expect(t.hostAdvance).not.toContain(c.adv.a2Credit);
            expect(t.hostAdvance).not.toContain(c.adv.b1);
            expect({ ...t, advance: [], hostAdvance: [] }).toEqual(NOTHING);
            const { rows } = await tx.query<{ outstanding_minor: string; amount_minor: string }>(
              `SELECT amount_minor::text, outstanding_minor::text
               FROM core.settlement_host_advance_v WHERE id = $1`,
              [c.adv.a1],
            );
            const host = captureOf(x.c.currency).legsMinor['HOST'] ?? 0n;
            expect(rows[0]).toEqual({
              amount_minor: host.toString(),
              outstanding_minor: host.toString(),
            });
            const cols = await tx.query<{ col: string }>(
              `SELECT a.attname::text AS col FROM pg_catalog.pg_attribute a
              WHERE a.attrelid = 'core.settlement_host_advance_v'::regclass AND a.attnum > 0
                AND NOT a.attisdropped ORDER BY 1`,
            );
            expect(cols.rows.map((r) => r.col)).toEqual(
              sorted([
                'id',
                'trip_id',
                'country_code',
                'currency',
                'amount_minor',
                'receivable_minor',
                'recovered_minor',
                'outstanding_minor',
                'status',
                'created_at',
              ]),
            );
          },
        );
        await asActor(client, { kind: 'HOST', actorId: x.holderB, orgId: x.orgB }, async (tx) => {
          expect((await moneyTables(tx)).hostAdvance).toEqual([c.adv.b1]);
        });
        for (const sql of [
          'SELECT decided_by FROM core.settlement_platform_advance',
          'SELECT written_off_by FROM core.settlement_platform_advance',
          'SELECT requested_by FROM core.settlement_finance_approval',
          'SELECT issued_by FROM core.settlement_insurer_bordereau',
        ]) {
          await expect(
            asActor(client, { kind: 'HOST', actorId: world.holderA, orgId: x.orgA }, (tx) =>
              tx.query(sql),
            ),
            sql,
          ).rejects.toMatchObject({ code: '42501' });
        }
      });
    },
  );

  it('advance_approvers : refusé à l’hôte (aucune ligne, même avec un jeton) ; rendu à FINANCE de la portée', async () => {
    const adv = m(0).finance.decide;
    await api(async (client) => {
      await asActor(
        client,
        { kind: 'HOST', actorId: world.holderA, orgId: w(0).orgA },
        async (tx) => {
          for (const token of [randomBytes(32), hashOf(people.financeB)]) {
            const { rows } = await tx.query(
              'SELECT * FROM core.settlement_advance_approvers($1, $2)',
              [token, adv],
            );
            expect(rows).toEqual([]);
          }
        },
      );
      await asActor(
        client,
        { kind: 'STAFF', actorId: people.financeB, countryScope: [first()] },
        async (tx) => {
          const { rows } = await tx.query<{ decided_by: string | null }>(
            'SELECT decided_by FROM core.settlement_advance_approvers($1, $2)',
            [hashOf(people.financeB), m(1).finance.decide],
          );
          expect(rows).toEqual([]); // autre pays
          // avance du premier pays décidée plus haut (RLS-24) : les deux personnes, pour FINANCE
          const own = await tx.query<{ decided_by: string; decision_second_by: string }>(
            'SELECT decided_by, decision_second_by FROM core.settlement_advance_approvers($1, $2)',
            [hashOf(people.financeB), adv],
          );
          expect(own.rows).toEqual([
            { decided_by: people.financeA, decision_second_by: people.financeB },
          ]);
        },
      );
    });
  });

  it('sans contexte ou contexte forgé (org_id d’un autre compte) : 0 ligne partout', async () => {
    await api(async (client) => {
      await withRawContext(
        client,
        { 'app.actor_kind': 'HOST', 'app.actor_id': world.cohost, 'app.org_id': w(0).orgB },
        async (tx) => {
          expect(await legs(tx)).toEqual([]);
          expect(await moneyTables(tx)).toEqual(NOTHING);
          const { rows } = await tx.query('SELECT trip_id FROM core.booking_host_guest_v');
          expect(rows).toEqual([]);
        },
      );
    });
  });
});
