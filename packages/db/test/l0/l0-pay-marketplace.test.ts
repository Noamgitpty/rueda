/**
 * US-061 — port de place de marché côté base (migration 0039 ; 17 §2.8, §2.9, §3.2.7, §4.3 point 8 ;
 * 08 E7 règles 1 à 3 bis ; ADR-066), sous les rôles de PRODUCTION (assertion L0-05 en tête de chaque
 * test : withRole / connectAs), en USD (PA) et en PYG sans décimale (PY).
 *
 * - Critère 3 : chaque capacité bloquante de 19 US-061 réglée à UNKNOWN (ou absente, ou seulement
 *   DOCUMENTED) ⇒ l'enregistrement de l'hôte comme sous-marchand est refusé
 *   (HOST_PAYOUT_RAIL_UNAVAILABLE), sans ligne écrite ; une capacité inconnue vaut « non ».
 * - Critère 5 (côté base) : `registerSubmerchant` idempotent par sa clé `submerchant:{org}:a{n}`.
 * - Critère 2 (côté base) : `cmd_apply_leg_movement`, seul écrivain de `trip_leg_balance`, refuse
 *   le débit d'une jambe libérée ou gelée (LEG_ALREADY_RELEASED, TJ18a / TJ18c).
 * - Report US-062 / ADR-064 : RLS-25 rejouée sur `cmd_apply_leg_movement` (travailleur hors liste
 *   blanche : appel refusé, 0 ligne).
 * - RLS des sous-marchands : le titulaire lit son statut, jamais la référence PSP ; FINANCE de son
 *   pays ; co-hôte, autre hôte, voyageur : rien.
 * Montants : vecteurs TJ de l'export des oracles (`@rueda/money/golden-vectors`), jamais calculés ici.
 */
import { legVector, loadGoldenVectors } from '@rueda/money/golden-vectors';
import type { GoldenLegVector } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { setSessionContext, translateDbError } from '../../src/index.ts';
import {
  connectAs,
  releaseClient,
  withRole,
  withTestTransaction,
} from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import {
  applyStatus,
  caught,
  insertAccount,
  insertTrip,
  payTx,
  recordOperation,
  uuid,
} from '../support/pay.ts';
import type { Legs } from '../support/pay.ts';
import { asActor, buildWorld } from '../support/rls.ts';
import type { World } from '../support/rls.ts';

const golden = loadGoldenVectors();
const legsOf = (v: GoldenLegVector): Legs => ({ ...v.legsMinor });
const negate = (l: Legs): Legs => ({
  HOST: -l.HOST,
  INSURER: -l.INSURER,
  TAX_THIRD_PARTY: -l.TAX_THIRD_PARTY,
  PLATFORM: -l.PLATFORM,
});
const ZERO: Legs = { HOST: 0n, INSURER: 0n, TAX_THIRD_PARTY: 0n, PLATFORM: 0n };

/** Vecteurs par devise : capture, règlement, jambe libérée (TJ18 : théorique puis exécuté). */
const VECTORS: Record<
  string,
  {
    capture: GoldenLegVector;
    variation: GoldenLegVector;
    releasedTheory: GoldenLegVector;
    releasedExecuted: GoldenLegVector;
  }
> = {
  [legVector(golden, 'TJ01').currency]: {
    capture: legVector(golden, 'TJ01'),
    variation: legVector(golden, 'TJ02b'),
    releasedTheory: legVector(golden, 'TJ18a'),
    releasedExecuted: legVector(golden, 'TJ18b'),
  },
  [legVector(golden, 'TJ08a').currency]: {
    capture: legVector(golden, 'TJ08a'),
    variation: legVector(golden, 'TJ08b'),
    releasedTheory: legVector(golden, 'TJ18c'),
    releasedExecuted: legVector(golden, 'TJ18d'),
  },
};
const vectorsOf = (c: CountryCase) => {
  const v = VECTORS[c.currency];
  if (v === undefined) throw new Error(`aucun vecteur TJ en ${c.currency}`);
  return v;
};

/** Capacités bloquantes nommées par 19 US-061 (critère 3). */
const STORY_BLOCKING = [
  'SUPPORTS_SUBMERCHANT',
  'SUPPORTS_INDIVIDUAL_SUBMERCHANT',
  'SUPPORTS_MULTI_LEG_SPLIT',
  'SUPPORTS_PER_LEG_AMOUNTS',
  'SUPPORTS_B2C_PAYOUT',
  'SUPPORTS_DELAYED_PAYOUT_RELEASE',
  'SUPPORTS_PAYOUT_ADJUSTMENT',
  'SUPPORTS_NEGATIVE_BALANCE_RECOVERY',
  'SUPPORTS_MIT',
] as const;

/** Date d'effet des capacités validées du banc (unique par exécution : aucune collision de clé). */
const BASE_VALID_FROM = new Date(
  Date.UTC(2020, 0, 1) + Math.floor(Math.random() * 1e9),
).toISOString();

async function insertCapability(
  tx: pg.ClientBase,
  country: string,
  capability: string,
  value: unknown,
  status: string,
  validFrom: string,
): Promise<void> {
  await tx.query(
    `INSERT INTO core.payment_psp_capability
            (provider, country_code, method, network, capability, value, status, source,
             validated_at, valid_from)
     VALUES ('FAKE', $1, '*', '*', $2, $3::jsonb, $4, 'test US-061',
             CASE WHEN $4 LIKE 'VALIDATED_%' THEN $5::timestamptz END, $5::timestamptz)`,
    [country, capability, JSON.stringify(value), status, validFrom],
  );
}

const valueOf = (kind: string): unknown =>
  kind === 'bool' ? true : kind === 'int' ? 1 : 'FAKE_HMAC_SHA256';

/** Toutes les capacités bloquantes du catalogue validées pour (FAKE, pays). */
async function validateAllBlocking(tx: pg.ClientBase, country: string, validFrom: string) {
  const { rows } = await tx.query<{ capability: string; kind: string }>(
    `SELECT capability, kind FROM core.payment_psp_capability_catalog WHERE blocking <> 'NO'`,
  );
  for (const r of rows) {
    await insertCapability(
      tx,
      country,
      r.capability,
      valueOf(r.kind),
      'VALIDATED_SANDBOX',
      validFrom,
    );
  }
}

async function register(
  tx: pg.ClientBase,
  orgId: string,
  accountId: string,
  attempt = 1,
  id = uuid(),
): Promise<{ submerchant_id: string; idem_plain: string; replayed: boolean }> {
  const { rows } = await tx.query<{
    submerchant_id: string;
    idem_plain: string;
    replayed: boolean;
  }>(`SELECT * FROM core.payment_cmd_register_submerchant($1, $2, $3, $4)`, [
    id,
    orgId,
    accountId,
    attempt,
  ]);
  const row = rows[0];
  if (row === undefined) throw new Error('register_submerchant sans résultat');
  return row;
}

async function recordStatus(
  tx: pg.ClientBase,
  id: string,
  status: string,
  ref: string | null,
  reason: string | null = null,
): Promise<string> {
  const { rows } = await tx.query<{ outcome: string }>(
    `SELECT core.payment_cmd_record_submerchant_status($1, $2, $3, $4) AS outcome`,
    [id, status, ref, reason],
  );
  return rows[0]?.outcome ?? '';
}

/** Trip réservé par la fixture d'US-011, chez un compte d'hôte CONNU (créé au besoin). */
async function tripOf(tx: pg.ClientBase, c: CountryCase): Promise<{ trip: string; org: string }> {
  const trip = uuid();
  const org = uuid();
  await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
    trip,
    uuid(),
    org,
    uuid(),
    c.country,
    c.currency,
    c.timezone,
    '2031-08-01T10:00:00Z',
    '2031-08-04T10:00:00Z',
  ]);
  return { trip, org };
}

// ---------------------------------------------------------------------------------------------
// Catalogue des capacités (17 §2.8, colonne « Bloquante »)
// ---------------------------------------------------------------------------------------------

describe('catalogue des capacités (17 §2.8)', () => {
  it('les neuf capacités de 19 US-061 sont bloquantes ; SUPPORTS_PLATFORM_LEG_TRANSFER ne l’est pas', async () => {
    await withRole('app_api', async (client) => {
      const { rows } = await client.query<{ capability: string; blocking: string }>(
        `SELECT capability, blocking FROM core.payment_psp_capability_catalog
          WHERE capability = ANY ($1::text[]) ORDER BY capability`,
        [[...STORY_BLOCKING, 'SUPPORTS_PLATFORM_LEG_TRANSFER']],
      );
      const byName = Object.fromEntries(rows.map((r) => [r.capability, r.blocking]));
      for (const name of STORY_BLOCKING) {
        // 17 §2.8 : SUPPORTS_MULTI_LEG_SPLIT « oui en variante A »
        expect(byName[name], name).toBe(name === 'SUPPORTS_MULTI_LEG_SPLIT' ? 'VARIANT_A' : 'YES');
      }
      expect(byName['SUPPORTS_PLATFORM_LEG_TRANSFER']).toBe('NO');
    });
  });

  it('aucune ligne de capacité ⇒ toutes les bloquantes manquent ; PLATFORM_MOR sans la variante A', async () => {
    await withRole('app_worker', async (client) => {
      await payTx(client, {}, async (tx) => {
        const { rows } = await tx.query<{ missing: string[] }>(
          `SELECT core.payment_missing_blocking_capabilities('FAKE', 'ZZ', 'SPLIT_AT_SOURCE') AS missing`,
        );
        expect(rows[0]?.missing).toEqual(expect.arrayContaining([...STORY_BLOCKING]));
        const mor = await tx.query<{ missing: string[] }>(
          `SELECT core.payment_missing_blocking_capabilities('FAKE', 'ZZ', 'PLATFORM_MOR') AS missing`,
        );
        expect(mor.rows[0]?.missing).not.toContain('SUPPORTS_MULTI_LEG_SPLIT');
        expect(mor.rows[0]?.missing).toContain('SUPPORTS_PER_LEG_AMOUNTS');
        // variante inconnue : la variante A s'applique (fail-closed)
        const unknown = await tx.query<{ missing: string[] }>(
          `SELECT core.payment_missing_blocking_capabilities('FAKE', 'ZZ', NULL) AS missing`,
        );
        expect(unknown.rows[0]?.missing).toContain('SUPPORTS_MULTI_LEG_SPLIT');
      });
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Sous-marchands : règle d'activation, idempotence, statuts
// ---------------------------------------------------------------------------------------------

describe.each(COUNTRIES)('sous-marchands — $country ($currency)', (c) => {
  it('capacités bloquantes validées ⇒ tentative PENDING ; rejeu de la même clé ; nouvelle tentative après refus seulement', async () => {
    await withRole('app_worker', async (client) => {
      await payTx(client, { worker: 'payment_command' }, async (tx) => {
        const { org } = await tripOf(tx, c);
        const account = await insertAccount(tx, { country: c.country });
        await validateAllBlocking(tx, c.country, new Date(Date.UTC(2021, 0, 1)).toISOString());
        const first = await register(tx, org, account);
        expect(first).toMatchObject({ idem_plain: `submerchant:${org}:a1`, replayed: false });
        // rejeu : même clé, même ligne (17 §2.8 : idempotent par sa clé)
        const replay = await register(tx, org, account, 1, uuid());
        expect(replay).toMatchObject({ submerchant_id: first.submerchant_id, replayed: true });
        // une seconde tentative tant que la première vit : refusée
        const second = await caught(tx, () => register(tx, org, account, 2));
        expect(second).toMatchObject({
          code: '55000',
          constraint: 'psp_submerchant_attempt_invalid',
        });
        expect(translateDbError(second).code).toBe('INVALID_TRANSITION');
        // le PSP refuse le KYC : la tentative 2 devient possible, la 3 non
        expect(await recordStatus(tx, first.submerchant_id, 'REJECTED', null)).toBe('APPLIED');
        const again = await register(tx, org, account, 2);
        expect(again).toMatchObject({ idem_plain: `submerchant:${org}:a2`, replayed: false });
        const skip = await caught(tx, () => register(tx, org, account, 4));
        expect(skip).toMatchObject({ constraint: 'psp_submerchant_attempt_invalid' });
        // devise de versement : celle du pays (configuration), jamais un paramètre
        const cur = await tx.query<{ payout_currency: string; kyc_status: string }>(
          'SELECT payout_currency, kyc_status FROM core.payment_psp_submerchant WHERE id = $1',
          [again.submerchant_id],
        );
        expect(cur.rows[0]).toEqual({ payout_currency: c.currency, kyc_status: 'PENDING' });
      });
    });
  });

  it.each(STORY_BLOCKING)(
    '%s UNKNOWN, seulement DOCUMENTED ou absente ⇒ HOST_PAYOUT_RAIL_UNAVAILABLE, aucune ligne',
    async (capability) => {
      await withRole('app_worker', async (client) => {
        for (const degrade of ['UNKNOWN', 'DOCUMENTED', 'ABSENT'] as const) {
          await payTx(client, { worker: 'payment_command' }, async (tx) => {
            const { org } = await tripOf(tx, c);
            const account = await insertAccount(tx, { country: c.country });
            // matrice complète à une date, puis la capacité dégradée à une date PLUS RÉCENTE
            // (la ligne en vigueur la plus récente fait foi) ; ABSENT : jamais validée
            const base = new Date(Date.UTC(2022, 0, 1)).toISOString();
            if (degrade === 'ABSENT') {
              const { rows } = await tx.query<{ capability: string; kind: string }>(
                `SELECT capability, kind FROM core.payment_psp_capability_catalog
                  WHERE blocking <> 'NO' AND capability <> $1`,
                [capability],
              );
              for (const r of rows) {
                await insertCapability(
                  tx,
                  c.country,
                  r.capability,
                  valueOf(r.kind),
                  'VALIDATED_SANDBOX',
                  base,
                );
              }
              // une ligne validée d'un autre moyen ne compte pas pour une capacité bloquante
              await tx.query(
                `INSERT INTO core.payment_psp_capability
                        (provider, country_code, method, network, capability, value, status, source,
                         validated_at, valid_from)
                 VALUES ('FAKE', $1, 'CARD', '*', $2, 'true'::jsonb, 'VALIDATED_SANDBOX', 'test',
                         $3::timestamptz, $3::timestamptz)`,
                [c.country, capability, base],
              );
            } else {
              await validateAllBlocking(tx, c.country, base);
              await insertCapability(
                tx,
                c.country,
                capability,
                true,
                degrade,
                new Date(Date.UTC(2023, 0, 1)).toISOString(),
              );
            }
            const err = await caught(tx, () => register(tx, org, account));
            expect(err, degrade).toMatchObject({
              code: '55000',
              constraint: 'host_payout_rail_unavailable',
            });
            expect(translateDbError(err).code).toBe('HOST_PAYOUT_RAIL_UNAVAILABLE');
            const { rows } = await tx.query(
              'SELECT 1 FROM core.payment_psp_submerchant WHERE org_id = $1',
              [org],
            );
            expect(rows, degrade).toEqual([]);
          });
        }
      });
    },
  );

  it('statuts du PSP : ACTIVE (référence, date), DUPLICATE, CONFLICT, SUSPENDED ⇄ ACTIVE ; REJECTED interdit après ACTIVE', async () => {
    await withRole('app_worker', async (client) => {
      await payTx(client, { worker: 'payment_command' }, async (tx) => {
        const { org } = await tripOf(tx, c);
        const account = await insertAccount(tx, { country: c.country });
        await validateAllBlocking(tx, c.country, new Date(Date.UTC(2021, 0, 1)).toISOString());
        const { submerchant_id: id } = await register(tx, org, account);
        expect(await recordStatus(tx, id, 'ACTIVE', 'fk_sm_000001')).toBe('APPLIED');
        expect(await recordStatus(tx, id, 'ACTIVE', 'fk_sm_000001')).toBe('DUPLICATE');
        expect(await recordStatus(tx, id, 'ACTIVE', 'fk_sm_999999')).toBe('CONFLICT');
        const bad = await caught(tx, () => recordStatus(tx, id, 'REJECTED', null));
        expect(bad).toMatchObject({ code: '23000', constraint: 'psp_submerchant_transition' });
        expect(translateDbError(bad).code).toBe('INVALID_TRANSITION');
        expect(await recordStatus(tx, id, 'SUSPENDED', null, 'KYC_REVIEW')).toBe('APPLIED');
        expect(await recordStatus(tx, id, 'ACTIVE', null)).toBe('APPLIED');
        const { rows } = await tx.query<{
          kyc_status: string;
          provider_submerchant_ref: string;
          activated: boolean;
          suspended_reason: string | null;
        }>(
          `SELECT kyc_status, provider_submerchant_ref, activated_at IS NOT NULL AS activated,
                  suspended_reason
             FROM core.payment_psp_submerchant WHERE id = $1`,
          [id],
        );
        expect(rows[0]).toEqual({
          kyc_status: 'ACTIVE',
          provider_submerchant_ref: 'fk_sm_000001',
          activated: true,
          suspended_reason: null,
        });
      });
    });
  });

  it('écriture directe, autre travailleur, compte FAKE en production, hôte d’un autre pays ⇒ refus', async () => {
    await withRole('app_worker', async (client) => {
      await payTx(client, { worker: 'payment_command' }, async (tx) => {
        const { org } = await tripOf(tx, c);
        const account = await insertAccount(tx, { country: c.country });
        await validateAllBlocking(tx, c.country, new Date(Date.UTC(2021, 0, 1)).toISOString());
        const direct = await caught(tx, () =>
          tx.query(
            `INSERT INTO core.payment_psp_submerchant
                    (id, psp_account_id, org_id, country_code, attempt_no, idem_plain, payout_currency)
             VALUES ($1, $2, $3, $4, 1, 'x', $5)`,
            [uuid(), account, org, c.country, c.currency],
          ),
        );
        expect(direct).toMatchObject({ code: '42501' });
        // hôte d'un autre pays que le compte
        const other = COUNTRIES.find((o) => o.country !== c.country);
        if (other === undefined) throw new Error('second pays absent');
        const { org: foreign } = await tripOf(tx, other);
        const mismatch = await caught(tx, () => register(tx, foreign, account));
        expect(mismatch).toMatchObject({ constraint: 'psp_submerchant_org_mismatch' });
        expect(translateDbError(mismatch).code).toBe('PAYMENT_SUBJECT_MISMATCH');
        // base en production : un compte FAKE n'enregistre aucun hôte (C19)
        await tx.query(
          `SELECT pg_catalog.set_config('app.test_deployment_env', 'production', true)`,
        );
        const prod = await caught(tx, () => register(tx, org, account));
        expect(prod).toMatchObject({ constraint: 'psp_account_fake_forbidden' });
        await tx.query(`SELECT pg_catalog.set_config('app.test_deployment_env', 'test', true)`);
        // autre travailleur : 42501
        await tx.query(`SELECT pg_catalog.set_config('app.worker_name', 'payout', true)`);
        const worker = await caught(tx, () => register(tx, org, account));
        expect(worker).toMatchObject({ code: '42501' });
      });
    });
  });
});

// ---------------------------------------------------------------------------------------------
// RLS des sous-marchands (17 §3.2.7 : hôte en lecture de sa ligne, statut seulement)
// ---------------------------------------------------------------------------------------------

describe('sous-marchands : lectures par acteur', () => {
  let world: World;
  const subs: { a: string; b: string }[] = [];

  beforeAll(async () => {
    const api = await connectAs('app_api');
    try {
      world = await buildWorld(api, COUNTRIES);
    } finally {
      await releaseClient(api);
    }
    const worker = await connectAs('app_worker');
    try {
      await payTx(worker, { worker: 'payment_command', commit: true }, async (tx) => {
        for (const x of world.countries) {
          // compte FAKE actif le temps de l'enregistrement, puis remis en attente avant le COMMIT
          // (un seul compte ACTIVE par fournisseur et pays : les autres preuves en posent)
          const account = await insertAccount(tx, { country: x.c.country });
          await validateAllBlocking(tx, x.c.country, BASE_VALID_FROM);
          const a = await register(tx, x.orgA, account);
          const b = await register(tx, x.orgB, account);
          await recordStatus(
            tx,
            a.submerchant_id,
            'ACTIVE',
            `fk_sm_${a.submerchant_id.slice(0, 8)}`,
          );
          await tx.query(
            `UPDATE core.payment_psp_account SET status = 'PENDING_VALIDATION' WHERE id = $1`,
            [account],
          );
          // capacités du banc remises à UNKNOWN avant le COMMIT : aucune autre preuve n'en hérite
          await tx.query(
            `UPDATE core.payment_psp_capability SET status = 'UNKNOWN', validated_at = NULL
              WHERE provider = 'FAKE' AND country_code = $1 AND valid_from = $2::timestamptz`,
            [x.c.country, BASE_VALID_FROM],
          );
          subs.push({ a: a.submerchant_id, b: b.submerchant_id });
        }
      });
    } finally {
      await releaseClient(worker);
    }
  });

  const visible = async (tx: pg.ClientBase): Promise<string[]> => {
    const { rows } = await tx.query<{ id: string; kyc_status: string }>(
      `SELECT id, kyc_status FROM core.payment_psp_submerchant WHERE id = ANY ($1::uuid[]) ORDER BY id`,
      [subs.flatMap((s) => [s.a, s.b])],
    );
    return rows.map((r) => `${r.id}:${r.kyc_status}`);
  };

  it('titulaire : sa ligne (statut) ; autre hôte, co-hôte, org forgé, voyageur, sans contexte : rien', async () => {
    await withRole('app_api', async (client) => {
      for (const [i, x] of world.countries.entries()) {
        const mine = subs[i];
        if (mine === undefined) throw new Error('sous-marchands absents');
        await asActor(
          client,
          { kind: 'HOST', actorId: world.holderA, orgId: x.orgA },
          async (tx) => {
            expect(await visible(tx)).toEqual([`${mine.a}:ACTIVE`]);
            // jamais la référence PSP ni le motif de suspension
            const ref = await caught(tx, () =>
              tx.query('SELECT provider_submerchant_ref FROM core.payment_psp_submerchant'),
            );
            expect(ref).toMatchObject({ code: '42501' });
          },
        );
        await asActor(client, { kind: 'HOST', actorId: x.holderB, orgId: x.orgB }, async (tx) => {
          expect(await visible(tx)).toEqual([`${mine.b}:PENDING`]);
        });
        await asActor(client, { kind: 'HOST', actorId: x.holderB, orgId: x.orgA }, async (tx) => {
          expect(await visible(tx)).toEqual([]);
        });
        await asActor(
          client,
          { kind: 'HOST', actorId: world.cohost, orgId: x.orgA },
          async (tx) => {
            expect(await visible(tx)).toEqual([]);
          },
        );
      }
      await asActor(client, { kind: 'GUEST', actorId: world.guest1 }, async (tx) => {
        expect(await visible(tx)).toEqual([]);
      });
      expect(await visible(client)).toEqual([]);
    });
  });

  it('FINANCE du premier pays : ce pays seulement ; ADMIN des deux pays : tout', async () => {
    const first = subs[0];
    const all = COUNTRIES.map((c) => c.country);
    const firstCountry = all[0];
    if (first === undefined || firstCountry === undefined) throw new Error('monde incomplet');
    await withRole('app_api', async (client) => {
      await asActor(
        client,
        { kind: 'STAFF', actorId: world.staff.financeFirst, countryScope: all },
        async (tx) => {
          expect((await visible(tx)).map((v) => v.split(':')[0]).sort()).toEqual(
            [first.a, first.b].sort(),
          );
        },
      );
      await asActor(
        client,
        { kind: 'STAFF', actorId: world.staff.adminAll, countryScope: all },
        async (tx) => {
          expect(await visible(tx)).toHaveLength(subs.length * 2);
        },
      );
      // OPS et SUPPORT : aucune lecture
      await asActor(
        client,
        { kind: 'STAFF', actorId: world.staff.supportAll, countryScope: all },
        async (tx) => {
          expect(await visible(tx)).toEqual([]);
        },
      );
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Soldes par jambe : cmd_apply_leg_movement (17 §2.9, §4.3 point 8 ; 08 E7 règle 3 bis)
// ---------------------------------------------------------------------------------------------

interface Balance {
  leg: string;
  captured: string;
  refunded: string;
  realloc_in: string;
  realloc_out: string;
  released: string;
}

async function balances(tx: pg.ClientBase, tripId: string): Promise<Record<string, Balance>> {
  const { rows } = await tx.query<Balance>(
    `SELECT leg, captured_minor::text AS captured, refunded_minor::text AS refunded,
            reallocated_in_minor::text AS realloc_in, reallocated_out_minor::text AS realloc_out,
            released_minor::text AS released
       FROM core.settlement_trip_leg_balance WHERE trip_id = $1 AND segment_no = 1`,
    [tripId],
  );
  return Object.fromEntries(rows.map((r) => [r.leg, r]));
}

const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
const col = (b: Record<string, Balance>, field: keyof Balance): Legs =>
  Object.fromEntries(LEGS.map((l) => [l, BigInt(b[l]?.[field] ?? '0')])) as unknown as Legs;
const sum = (l: Legs): bigint => LEGS.reduce((s, k) => s + l[k], 0n);

/** Opération enregistrée par la vraie commande, rendue SUCCEEDED, de montant Σ jambes positives. */
async function succeeded(
  tx: pg.ClientBase,
  tripId: string,
  accountId: string,
  kind: string,
  legs: Legs,
  currency: string,
): Promise<string> {
  const amount =
    kind === 'LEG_REALLOCATION'
      ? LEGS.reduce((s, k) => (legs[k] > 0n ? s + legs[k] : s), 0n)
      : sum(legs);
  const { operation_id: id } = await recordOperation(tx, {
    tripId,
    accountId,
    kind,
    amountMinor: amount,
    currency,
    idemPlain: `trip:${tripId}:${kind}:${uuid()}`,
    legs,
  });
  expect(await applyStatus(tx, id, 'SUCCEEDED')).toBe('APPLIED');
  return id;
}

async function applyMovement(tx: pg.ClientBase, operationId: string): Promise<string> {
  const { rows } = await tx.query<{ outcome: string }>(
    'SELECT core.settlement_cmd_apply_leg_movement($1) AS outcome',
    [operationId],
  );
  return rows[0]?.outcome ?? '';
}

describe.each(COUNTRIES)('soldes par jambe — $country ($currency)', (c) => {
  const v = vectorsOf(c);
  const capture = legsOf(v.capture);
  const refund = negate(legsOf(v.variation));

  it('capture puis remboursement : soldes = jambes de l’opération ; rejeu ⇒ DUPLICATE sans double comptage', async () => {
    await withRole('app_worker', async (client) => {
      await payTx(client, { worker: 'payment_command' }, async (tx) => {
        const trip = await insertTrip(tx, c);
        const account = await insertAccount(tx, { country: c.country });
        const cap = await succeeded(tx, trip, account, 'CAPTURE', capture, c.currency);
        expect(await applyMovement(tx, cap)).toBe('APPLIED');
        expect(await applyMovement(tx, cap)).toBe('DUPLICATE');
        expect(col(await balances(tx, trip), 'captured')).toEqual(capture);
        const ref = await succeeded(tx, trip, account, 'REFUND', refund, c.currency);
        expect(await applyMovement(tx, ref)).toBe('APPLIED');
        const b = await balances(tx, trip);
        expect(col(b, 'captured')).toEqual(capture);
        expect(col(b, 'refunded')).toEqual(refund);
      });
    });
  });

  it('jambe HOST libérée : débit théorique (TJ18a / TJ18c) ⇒ LEG_ALREADY_RELEASED, soldes intacts', async () => {
    await withRole('app_worker', async (client) => {
      await payTx(client, { worker: 'payment_command' }, async (tx) => {
        const trip = await insertTrip(tx, c);
        const account = await insertAccount(tx, { country: c.country });
        await applyMovement(tx, await succeeded(tx, trip, account, 'CAPTURE', capture, c.currency));
        const release = { ...ZERO, HOST: capture.HOST };
        await applyMovement(
          tx,
          await succeeded(tx, trip, account, 'LEG_RELEASE', release, c.currency),
        );
        const before = await balances(tx, trip);
        expect(col(before, 'released')).toEqual(release);
        // la variation théorique débite HOST, déjà versée : refus (08 E7 règle 3 bis)
        const theory = await succeeded(
          tx,
          trip,
          account,
          'REFUND',
          negate(legsOf(v.releasedTheory)),
          c.currency,
        );
        const err = await caught(tx, () => applyMovement(tx, theory));
        expect(err).toMatchObject({ code: '55000', constraint: 'leg_already_released' });
        expect(translateDbError(err).code).toBe('LEG_ALREADY_RELEASED');
        expect(await balances(tx, trip)).toEqual(before);
        // l'ordre exécuté porte la variation sur PLATFORM (TJ18b / TJ18d) : il dépasse la jambe
        // PLATFORM du trip ; l'avance de Kmino n'a pas encore d'écrivain (US-224) ⇒ refus fail-closed
        const executed = await succeeded(
          tx,
          trip,
          account,
          'REFUND',
          negate(legsOf(v.releasedExecuted)),
          c.currency,
        );
        const over = await caught(tx, () => applyMovement(tx, executed));
        expect(over).toMatchObject({ code: '55000', constraint: 'leg_movement_exceeds_balance' });
        expect(translateDbError(over).code).toBe('LEG_AMOUNT_NEGATIVE');
        expect(await balances(tx, trip)).toEqual(before);
      });
    });
  });

  it('jambe gelée (chargeback ouvert) ⇒ tout débit refusé ; opération non réussie ⇒ refus', async () => {
    await withRole('app_worker', async (client) => {
      await payTx(client, { worker: 'payment_command' }, async (tx) => {
        const trip = await insertTrip(tx, c);
        const account = await insertAccount(tx, { country: c.country });
        await applyMovement(tx, await succeeded(tx, trip, account, 'CAPTURE', capture, c.currency));
        await tx.query(`SELECT test_fixture.marketplace_freeze_leg($1, 'HOST')`, [trip]);
        const ref = await succeeded(tx, trip, account, 'REFUND', refund, c.currency);
        const frozen = await caught(tx, () => applyMovement(tx, ref));
        expect(frozen).toMatchObject({ code: '55000', constraint: 'leg_frozen' });
        expect(translateDbError(frozen).code).toBe('LEG_ALREADY_RELEASED');
        const { operation_id: pending } = await recordOperation(tx, {
          tripId: trip,
          accountId: account,
          kind: 'CAPTURE',
          amountMinor: sum(capture),
          currency: c.currency,
          idemPlain: `trip:${trip}:pending:${uuid()}`,
          legs: capture,
        });
        const notYet = await caught(tx, () => applyMovement(tx, pending));
        expect(notYet).toMatchObject({ constraint: 'leg_movement_not_succeeded' });
        expect(translateDbError(notYet).code).toBe('INVALID_TRANSITION');
      });
    });
  });

  it('réaffectation (TJ05b, règle 3) : sortie de HOST, entrée sur PLATFORM', async () => {
    const tj05b = legVector(golden, 'TJ05b');
    if (tj05b.currency !== c.currency) return; // vecteur publié dans une seule devise
    await withRole('app_worker', async (client) => {
      await payTx(client, { worker: 'payment_command' }, async (tx) => {
        const trip = await insertTrip(tx, c);
        const account = await insertAccount(tx, { country: c.country });
        await applyMovement(tx, await succeeded(tx, trip, account, 'CAPTURE', capture, c.currency));
        // 08 E7 règle 3 (TJ05b) : la variation positive de PLATFORM est prise sur HOST
        const moved = tj05b.legsMinor.PLATFORM;
        const realloc = { ...ZERO, HOST: -moved, PLATFORM: moved };
        const op = await succeeded(tx, trip, account, 'LEG_REALLOCATION', realloc, c.currency);
        expect(await applyMovement(tx, op)).toBe('APPLIED');
        const b = await balances(tx, trip);
        expect(col(b, 'realloc_out')).toEqual({ ...ZERO, HOST: moved });
        expect(col(b, 'realloc_in')).toEqual({ ...ZERO, PLATFORM: moved });
      });
    });
  });

  it('RLS-25 (report US-062) : travailleur hors liste blanche ⇒ appel refusé (42501) et 0 ligne ; écriture directe ⇒ 42501', async () => {
    await withRole('app_worker', async (client) => {
      let trip = '';
      let op = '';
      await payTx(client, { worker: 'payment_command', commit: true }, async (tx) => {
        trip = await insertTrip(tx, c);
        const account = await insertAccount(tx, {
          country: c.country,
          status: 'PENDING_VALIDATION',
        });
        // compte ACTIVE le temps de l'enregistrement, remis en attente avant le COMMIT
        await tx.query(`UPDATE core.payment_psp_account SET status = 'ACTIVE' WHERE id = $1`, [
          account,
        ]);
        op = await succeeded(tx, trip, account, 'CAPTURE', capture, c.currency);
        await applyMovement(tx, op);
        await tx.query(
          `UPDATE core.payment_psp_account SET status = 'PENDING_VALIDATION' WHERE id = $1`,
          [account],
        );
      });
      for (const name of ['hold_expiry', 'booking_conversion', 'webhook_ingest', 'settlement']) {
        await withTestTransaction(client, {}, async (tx) => {
          await setSessionContext(tx, { kind: 'WORKER', workerName: name });
          if (name !== 'settlement') {
            const reads = await tx.query(
              `SELECT 1 FROM core.settlement_trip_leg_balance WHERE trip_id = $1
               UNION ALL SELECT 1 FROM core.settlement_leg_movement WHERE trip_id = $1`,
              [trip],
            );
            expect(reads.rows, name).toEqual([]);
          }
          const err = await caught(tx, () => applyMovement(tx, op));
          expect(err, name).toMatchObject({ code: '42501' });
        });
      }
      await withTestTransaction(client, {}, async (tx) => {
        await setSessionContext(tx, { kind: 'WORKER', workerName: 'payment_command' });
        for (const sql of [
          `UPDATE core.settlement_trip_leg_balance SET captured_minor = captured_minor + 1 WHERE trip_id = '${trip}'`,
          `INSERT INTO core.settlement_leg_movement (operation_id, trip_id, segment_no, country_code, kind)
           VALUES ('${op}', '${trip}', 1, '${c.country}', 'CAPTURE')`,
        ]) {
          const err = await caught(tx, () => tx.query(sql));
          expect(err, sql).toMatchObject({ code: '42501' });
        }
        // la commande est idempotente : le même mouvement n'est jamais compté deux fois
        expect(await applyMovement(tx, op)).toBe('DUPLICATE');
        expect(col(await balances(tx, trip), 'captured')).toEqual(capture);
      });
    });
  });
});
