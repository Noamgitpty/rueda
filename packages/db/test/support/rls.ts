/**
 * Monde de test des preuves RLS par acteur et par pays (US-011 ; 17 §2.3, tests RLS-1 à RLS-20).
 *
 * Tout est créé sous app_api (assertion L0-05 faite par l'appelant) par les commandes IAM et les
 * fixtures `test_fixture.*` (9200, 9300), dans UNE transaction validée. Les pays viennent de
 * l'appelant (données de test de support/avl.ts) : aucune constante pays ici.
 *
 * Pour chaque pays c :
 *   - compte d'hôte A_c : titulaire `holderA` (LE MÊME particulier dans tous les pays : un compte
 *     d'hôte par pays, 17 §1.1), véhicules v1 et v2, co-hôte actif `cohost` de portée {v1}, co-hôte
 *     RETIRÉ `exCohost` de portée {v1, v2} ;
 *   - compte d'hôte B_c : titulaire `holderB_c`, véhicule v3 ;
 *   - trips BOOKED : a1 (guest1, A, v1), a2 (guest2, A, v2), b1 (guest1, B, v3) ;
 *   - holds ACTIVE : h1 (guest1, A, v4), h2 (guest2, B, v5) ; opérations : trip a1, trip b1, hold h1.
 * Voyageurs `guest1`, `guest2` communs à tous les pays (un voyageur voit ses objets partout).
 * Staff : OPS du premier pays, SUPPORT des deux pays sans dossier, FINANCE du premier pays, ADMIN
 * des deux pays, ADMIN expiré, ADMIN au compte suspendu (RESTRICTED). Dossiers : (1) a1 du premier pays assigné à l'OPS ; (2) a1 du second
 * pays assigné au MÊME OPS (RLS-20) ; (3) a2 du premier pays, CLOS, assigné à l'OPS.
 *
 * US-012 (RLS-18 réduite, ADR-062) : un contexte STAFF n'a d'effet qu'avec l'empreinte du jeton
 * d'une session VIVANTE et ÉLEVÉE par TOTP de l'acteur. Chaque membre du staff du monde reçoit
 * donc une telle session (fixture 9650, qui remplace ici le parcours MFA prouvé par
 * l0-iam-staff-mfa) ; `asActor` complète un contexte STAFF sans `sessionTokenHash` par celle de
 * l'acteur, s'il en a une (sinon le contexte reste sans preuve : aucun pouvoir de staff).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { setSessionContext } from '../../src/index.ts';
import type { SessionContext } from '../../src/index.ts';
import { withTestTransaction } from '../../src/testing/index.ts';

export const uuid = (): string => randomUUID();

export interface CountryInput {
  readonly country: string;
  readonly currency: string;
  readonly timezone: string;
  readonly rentMinor: string;
}

export interface Trip {
  readonly id: string;
  readonly publicRef: string;
  readonly guest: string;
  readonly org: string;
  readonly vehicle: string;
}

export interface CountryWorld {
  readonly c: CountryInput;
  readonly orgA: string;
  readonly orgB: string;
  readonly holderB: string;
  readonly v1: string;
  readonly v2: string;
  readonly v3: string;
  readonly trips: { readonly a1: Trip; readonly a2: Trip; readonly b1: Trip };
  readonly holds: { readonly h1: string; readonly h2: string };
  readonly ops: { readonly a1: string; readonly b1: string; readonly h1: string };
}

export interface World {
  readonly countries: readonly CountryWorld[];
  readonly holderA: string;
  readonly cohost: string;
  readonly exCohost: string;
  readonly guest1: string;
  readonly guest2: string;
  readonly staff: {
    readonly opsFirst: string;
    readonly supportAll: string;
    readonly financeFirst: string;
    readonly adminAll: string;
    readonly adminExpired: string;
    readonly adminSuspended: string;
  };
  readonly cases: {
    readonly firstA1: string;
    readonly secondA1: string;
    readonly closedA2: string;
  };
}

const PHC =
  '$argon2id$v=19$m=65536,t=3,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g';

/** Compte voyageur ACTIVE de test (commande d'inscription réelle). */
export async function account(tx: pg.ClientBase): Promise<string> {
  const id = uuid();
  const r = await tx.query<{ ok: boolean }>(
    `SELECT core.iam_cmd_register($1, $2, $3, 'Rls', 'Test', 'en', $4, $5, 86400, NULL) AS ok`,
    [id, `rls-${id}@example.test`, PHC, uuid(), randomBytes(32)],
  );
  if (r.rows[0]?.ok !== true) throw new Error('inscription de test refusée');
  return id;
}

/** Empreinte (hex) de la session élevée de chaque membre du staff créé par `buildWorld`. */
const STAFF_SESSIONS = new Map<string, string>();

/** Empreinte de la session élevée d'un membre du staff du monde (preuve de possession). */
export function staffSessionHash(actorId: string): string | undefined {
  return STAFF_SESSIONS.get(actorId);
}

/** Membre du staff de test, rôle attribué et session élevée (empreinte : staffSessionHash). */
export async function staff(
  tx: pg.ClientBase,
  role: string,
  scope: readonly string[],
  expiresAt: string | null = null,
  status = 'ACTIVE',
): Promise<string> {
  const id = await account(tx);
  // un rôle interne n'a d'effet que sur un compte ACTIVE (app.has_staff_role, US-011)
  await tx.query(`SELECT test_fixture.iam_set_account_status($1, $2)`, [id, status]);
  await tx.query(`SELECT test_fixture.iam_grant_staff_role($1, $2, $3, $4::text[], NULL, $5)`, [
    uuid(),
    id,
    role,
    scope,
    expiresAt,
  ]);
  const hash = createHash('sha256').update(randomBytes(32)).digest();
  await tx.query('SELECT test_fixture.iam_open_elevated_session($1, $2)', [id, hash]);
  STAFF_SESSIONS.set(id, hash.toString('hex'));
  return id;
}

/** Instant ISO à `days` jours d'une base future fixe (périodes disjointes par trip). */
const day = (days: number): string =>
  new Date(Date.UTC(2031, 0, 1) + days * 86_400_000).toISOString();

export async function buildWorld(
  api: pg.ClientBase,
  inputs: readonly CountryInput[],
): Promise<World> {
  return withTestTransaction(api, { commit: true }, async (tx) => {
    const holderA = await account(tx);
    const cohost = await account(tx);
    const exCohost = await account(tx);
    const guest1 = await account(tx);
    const guest2 = await account(tx);
    const all = inputs.map((i) => i.country);
    const first = all[0];
    if (first === undefined) throw new Error('au moins un pays');
    const s = {
      opsFirst: await staff(tx, 'OPS_AGENT', [first]),
      supportAll: await staff(tx, 'SUPPORT_AGENT', all),
      financeFirst: await staff(tx, 'FINANCE', [first]),
      adminAll: await staff(tx, 'ADMIN', all),
      adminExpired: await staff(tx, 'ADMIN', all, '2001-01-01T00:00:00Z'),
      adminSuspended: await staff(tx, 'ADMIN', all, null, 'RESTRICTED'),
    };

    const countries: CountryWorld[] = [];
    let slot = 0;
    for (const c of inputs) {
      const orgA = uuid();
      const orgB = uuid();
      const holderB = await account(tx);
      const [v1, v2, v3, v4, v5] = [uuid(), uuid(), uuid(), uuid(), uuid()];
      await tx.query(`SELECT test_fixture.iam_insert_organization($1, $2, $3)`, [
        orgA,
        holderA,
        c.country,
      ]);
      await tx.query(`SELECT test_fixture.iam_insert_organization($1, $2, $3)`, [
        orgB,
        holderB,
        c.country,
      ]);
      for (const [user, org, role, scope, status] of [
        [holderA, orgA, 'P2P_HOST', [], 'ACTIVE'],
        [holderB, orgB, 'P2P_HOST', [], 'ACTIVE'],
        [cohost, orgA, 'CO_HOST', [v1], 'ACTIVE'],
        [exCohost, orgA, 'CO_HOST', [v1, v2], 'REMOVED'],
      ] as const) {
        await tx.query(
          `SELECT test_fixture.iam_insert_membership($1, $2, $3, $4, $5::uuid[], $6)`,
          [uuid(), user, org, role, scope, status],
        );
      }
      const trip = async (guest: string, org: string, vehicle: string): Promise<Trip> => {
        const id = uuid();
        const start = day(slot * 3);
        const end = day(slot * 3 + 2);
        slot++;
        await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
          id,
          guest,
          org,
          vehicle,
          c.country,
          c.currency,
          c.timezone,
          start,
          end,
        ]);
        return { id, publicRef: `T-${id}`, guest, org, vehicle };
      };
      const trips = {
        a1: await trip(guest1, orgA, v1),
        a2: await trip(guest2, orgA, v2),
        b1: await trip(guest1, orgB, v3),
      };
      const hold = async (guest: string, org: string, vehicle: string): Promise<string> => {
        const id = uuid();
        await tx.query(
          `SELECT test_fixture.place_hold($1, $2, $3, $4, $5, $6, $7::tstzrange, '10 minutes'::interval)`,
          [id, uuid(), guest, vehicle, org, c.country, `[${day(400)},${day(402)})`],
        );
        return id;
      };
      const holds = { h1: await hold(guest1, orgA, v4), h2: await hold(guest2, orgB, v5) };
      const ops = { a1: uuid(), b1: uuid(), h1: uuid() };
      await tx.query(`SELECT test_fixture.rls_insert_trip_operation($1, $2, $3::bigint)`, [
        ops.a1,
        trips.a1.id,
        c.rentMinor,
      ]);
      await tx.query(`SELECT test_fixture.rls_insert_trip_operation($1, $2, $3::bigint)`, [
        ops.b1,
        trips.b1.id,
        c.rentMinor,
      ]);
      await tx.query(
        `SELECT test_fixture.insert_payment_operation($1, $2, $3, $4, $5::bigint, 'CAPTURE', 'RENT', 'PENDING')`,
        [ops.h1, holds.h1, c.country, c.currency, c.rentMinor],
      );
      countries.push({ c, orgA, orgB, holderB, v1, v2, v3, trips, holds, ops });
    }

    const [w0, w1] = countries;
    if (w0 === undefined || w1 === undefined) throw new Error('deux pays attendus');
    const supportCase = async (
      w: CountryWorld,
      trip: Trip,
      status: string,
      category = 'TRIP',
      reason: string | null = null,
    ): Promise<string> => {
      const id = uuid();
      await tx.query(`SELECT test_fixture.rls_insert_support_case($1, $2, $3, $4, $5, $6, $7)`, [
        id,
        w.c.country,
        trip.id,
        s.opsFirst,
        status,
        category,
        reason,
      ]);
      return id;
    };
    const cases = {
      firstA1: await supportCase(w0, w0.trips.a1, 'OPEN'),
      secondA1: await supportCase(w1, w1.trips.a1, 'OPEN'),
      closedA2: await supportCase(w0, w0.trips.a2, 'CLOSED'),
    };
    return { countries, holderA, cohost, exCohost, guest1, guest2, staff: s, cases };
  });
}

/** Contexte de test : un contexte STAFF peut omettre l'empreinte (celle du monde est prise). */
export type TestContext =
  | SessionContext
  | {
      readonly kind: 'STAFF';
      readonly actorId: string;
      readonly countryScope: readonly string[];
      readonly sessionTokenHash?: string;
    };

/** Une empreinte qui ne désigne aucune session : le contexte STAFF reste sans preuve. */
const NO_SESSION = '0'.repeat(64);

/** Transaction annulée sous un contexte posé par la couche d'accès (setSessionContext). */
export async function asActor<T>(
  client: pg.ClientBase,
  ctx: TestContext,
  fn: (tx: pg.ClientBase) => Promise<T>,
): Promise<T> {
  const full: SessionContext =
    ctx.kind === 'STAFF'
      ? {
          ...ctx,
          sessionTokenHash:
            ctx.sessionTokenHash ?? STAFF_SESSIONS.get(ctx.actorId.toLowerCase()) ?? NO_SESSION,
        }
      : ctx;
  return withTestTransaction(client, {}, async (tx) => {
    await setSessionContext(tx, full);
    return fn(tx);
  });
}

/** Transaction annulée avec des paramètres `app.*` BRUTS (contextes forgés ou mal formés). */
export async function withRawContext<T>(
  client: pg.ClientBase,
  settings: Readonly<Record<string, string>>,
  fn: (tx: pg.ClientBase) => Promise<T>,
): Promise<T> {
  return withTestTransaction(client, {}, async (tx) => {
    for (const [name, value] of Object.entries(settings)) {
      await tx.query('SELECT pg_catalog.set_config($1, $2, true)', [name, value]);
    }
    return fn(tx);
  });
}

/** Identifiants visibles d'une table, triés. */
export async function ids(tx: pg.ClientBase, table: string, column = 'id'): Promise<string[]> {
  if (!/^[a-z_]+$/.test(table) || !/^[a-z_]+$/.test(column)) throw new Error('identifiant');
  const { rows } = await tx.query<{ v: string }>(
    `SELECT ${column}::text AS v FROM core.${table} ORDER BY 1`,
  );
  return rows.map((r) => r.v);
}

export const sorted = (xs: readonly string[]): string[] => [...xs].sort();
