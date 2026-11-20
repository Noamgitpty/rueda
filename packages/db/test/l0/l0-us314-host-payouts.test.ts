/**
 * US-314 (migration 0172, ADR-192) — lecture de ses versements par l'hôte titulaire, écran A08
 * (19 US-314 critère 5 ; 16 PYO-003 ; 08 BR-PAYOUT-02 ; 17 §2.3 RLS-26, RLS-28 ; pré-mortem
 * L3-PM-43 ; red team RT-L3-V10), en USD (PA) et en PYG sans décimale (PY).
 *
 * Sous le rôle de PRODUCTION app_api (`withRole` : assertion L0-05 en tête), dans une transaction
 * ANNULÉE : personnes inscrites par la vraie commande, sessions ouvertes par la vraie commande,
 * compte d'hôte, appartenances et lots posés par fixture (9200, 9300, 9913 : états qu'écrivent
 * US-107, US-708 et US-709, prouvés par leurs fichiers).
 *
 * - Le titulaire lit son calendrier (paramètres de 17 §7.2, valeurs des données CFG du dépôt) et
 *   ses lots, les plus récents d'abord : état, date prévue, premier versement, brut, compensation,
 *   net, motifs de retenue, dates d'émission et de paiement, trips et montants ; aucune autre clé
 *   (aucun identifiant du personnel, aucun compte PSP ni de versement, aucune clé ni référence du
 *   PSP : RLS-26).
 * - Co-hôte doté PAR ERREUR de `finance.read_org_statements` ⇒ FORBIDDEN (RLS-28) ; hôte d'un autre
 *   compte ⇒ FORBIDDEN ; compte inconnu ⇒ FORBIDDEN ; session inconnue ⇒ AUTH_REQUIRED.
 * Montants : jambe HOST des vecteurs TJ01 / TJ08a et pénalité de l'hôte de T14 / T48 (export des
 * oracles), jamais le code testé.
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { legVector, settlementVector } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { newToken, SESSION_TTL_S } from '../support/iam.ts';
import { account, uuid } from '../support/rls.ts';
import { golden } from '../support/settlement.ts';

type Tx = pg.ClientBase;
const REF: Readonly<Record<string, { readonly capture: string; readonly penalty: string }>> = {
  USD: { capture: 'TJ01', penalty: 'T14' },
  PYG: { capture: 'TJ08a', penalty: 'T48' },
};
const READ = 'SELECT * FROM core.payout_host_payouts($1, $2::uuid)';

const params = (
  JSON.parse(
    readFileSync(
      new URL('../../../../apps/api/src/modules/cfg/data/params.json', import.meta.url),
      'utf8',
    ),
  ) as { params: { key: string; values?: Record<string, unknown> }[] }
).params;
const paramOf = (key: string, country: string): unknown =>
  params.find((p) => p.key === key)?.values?.[country];

async function session(tx: Tx, userId: string): Promise<Buffer> {
  const t = newToken();
  await tx.query(`SELECT core.iam_cmd_open_session($1, $2, $3, $4, 'NONE', NULL, 'vitest')`, [
    uuid(),
    userId,
    t.hash,
    SESSION_TTL_S,
  ]);
  return t.hash;
}

/** Compte d'hôte du pays : titulaire P2P_HOST actif, co-hôte actif (fixtures 9200). */
async function hostAccount(
  tx: Tx,
  c: CountryCase,
  cohost?: string,
): Promise<{ org: string; holder: string }> {
  const holder = await account(tx);
  const org = uuid();
  await tx.query('SELECT test_fixture.iam_insert_organization($1, $2, $3)', [
    org,
    holder,
    c.country,
  ]);
  await tx.query(
    `SELECT test_fixture.iam_insert_membership($1, $2, $3, 'P2P_HOST', '{}'::uuid[], 'ACTIVE')`,
    [uuid(), holder, org],
  );
  if (cohost !== undefined) {
    await tx.query(
      `SELECT test_fixture.iam_insert_membership($1, $2, $3, 'CO_HOST', $4::uuid[], 'ACTIVE')`,
      [uuid(), cohost, org, [uuid()]],
    );
  }
  return { org, holder };
}

async function tripOf(
  tx: Tx,
  c: CountryCase,
  org: string,
  start: string,
  end: string,
): Promise<string> {
  const trip = uuid();
  await tx.query('SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)', [
    trip,
    uuid(),
    org,
    uuid(),
    c.country,
    c.currency,
    c.timezone,
    start,
    end,
  ]);
  return trip;
}

interface Row {
  readonly outcome: string;
  readonly country_code: string | null;
  readonly currency: string | null;
  readonly schedule: Record<string, unknown> | null;
  readonly batches: Record<string, unknown>[] | null;
}

async function read(tx: Tx, hash: Buffer, org: string): Promise<Row> {
  const { rows } = await tx.query<Row>(READ, [hash, org]);
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

const BATCH_KEYS = [
  'batchId',
  'currency',
  'firstPayout',
  'grossMinor',
  'holdReasons',
  'initiatedAt',
  'items',
  'kind',
  'netMinor',
  'nettedMinor',
  'paidAt',
  'scheduledFor',
  'status',
];

describe.each(COUNTRIES)('US-314 — versements lus par l’hôte (A08) — $country ($currency)', (c) => {
  const ref = REF[c.currency];
  if (ref === undefined) throw new Error(`aucun vecteur en ${c.currency}`);
  const host = legVector(golden, ref.capture).legsMinor.HOST;
  const penalty = settlementVector(golden, ref.penalty).expected.hostPenaltyMinor;

  it('critère 5 : le titulaire lit son calendrier et ses lots (dates, gels, motifs, montants), sans identifiant du personnel ; co-hôte doté de finance.read_org_statements, autre hôte, compte inconnu ⇒ FORBIDDEN ; sans session ⇒ AUTH_REQUIRED', async () => {
    expect(legVector(golden, ref.capture).currency).toBe(c.currency);
    expect(penalty).toBeGreaterThan(0n);
    expect(penalty).toBeLessThan(host);
    await withRole('app_api', async (api) => {
      await withTestTransaction(api, {}, async (tx) => {
        const cohost = await account(tx);
        const a = await hostAccount(tx, c, cohost);
        const b = await hostAccount(tx, c);
        // le titulaire donne PAR ERREUR la permission des relevés à son co-hôte (RLS-28)
        await tx.query('SELECT test_fixture.us062_set_permission_overrides($1, $2, $3::text[])', [
          cohost,
          a.org,
          ['finance.read_org_statements'],
        ]);
        const t1 = await tripOf(tx, c, a.org, '2033-05-01T10:00:00Z', '2033-05-04T10:00:00Z');
        const t2 = await tripOf(tx, c, a.org, '2033-06-01T10:00:00Z', '2033-06-04T10:00:00Z');
        const tb = await tripOf(tx, c, b.org, '2033-06-01T10:00:00Z', '2033-06-04T10:00:00Z');
        // premier versement payé (compensation de la pénalité), puis un lot retenu
        const paid = (
          await tx.query<{ id: string }>(
            `SELECT test_fixture.us314_batch($1, 'PAID', NULL, $2::timestamptz, true, $3, $4) AS id`,
            [t1, '2033-05-13T15:00:00Z', host.toString(), penalty.toString()],
          )
        ).rows[0]!.id;
        const held = (
          await tx.query<{ id: string }>(
            `SELECT test_fixture.us314_batch($1, 'ON_HOLD', ARRAY['CLAIM', 'PAYOUTS_DISABLED'],
                                             $2::timestamptz, false, $3, 0) AS id`,
            [t2, '2033-06-08T15:00:00Z', host.toString()],
          )
        ).rows[0]!.id;
        await tx.query(
          `SELECT test_fixture.us314_batch($1, 'ON_HOLD', ARRAY['PAYOUTS_DISABLED'],
                                           $2::timestamptz, true, $3, 0)`,
          [tb, '2033-06-08T15:00:00Z', host.toString()],
        );

        const holderHash = await session(tx, a.holder);
        const r = await read(tx, holderHash, a.org);
        expect(r).toMatchObject({ outcome: 'OK', country_code: c.country, currency: c.currency });
        // calendrier : paramètres du pays (données CFG), fuseau du pays
        expect(r.schedule).toEqual({
          businessDayOffset: paramOf('payout_business_day_offset', c.country),
          firstPayoutBusinessDay: paramOf('first_payout_business_day', c.country),
          localTimeMinutes: paramOf('payout_batch_local_time', c.country),
          timeZone: c.timezone,
          // payouts_enabled du pays lu par la base : false sur le banc (17 §0.1)
          payoutsOpen: false,
        });
        // les plus récents d'abord ; seuls les lots du compte A
        expect(r.batches).toEqual([
          {
            batchId: held,
            kind: 'FINAL',
            status: 'ON_HOLD',
            currency: c.currency,
            scheduledFor: '2033-06-08T15:00:00.000Z',
            firstPayout: false,
            grossMinor: host.toString(),
            nettedMinor: '0',
            netMinor: host.toString(),
            holdReasons: ['CLAIM', 'PAYOUTS_DISABLED'],
            initiatedAt: null,
            paidAt: null,
            items: [{ tripId: t2, amountMinor: host.toString() }],
          },
          {
            batchId: paid,
            kind: 'FINAL',
            status: 'PAID',
            currency: c.currency,
            scheduledFor: '2033-05-13T15:00:00.000Z',
            firstPayout: true,
            grossMinor: host.toString(),
            nettedMinor: penalty.toString(),
            netMinor: (host - penalty).toString(),
            holdReasons: [],
            initiatedAt: '2033-05-13T15:01:00.000Z',
            paidAt: '2033-05-14T15:00:00.000Z',
            items: [{ tripId: t1, amountMinor: host.toString() }],
          },
        ]);
        // RLS-26 : exactement ces clés, aucun identifiant du personnel ni du PSP
        for (const batch of r.batches ?? []) {
          expect(Object.keys(batch).sort()).toEqual(BATCH_KEYS);
          expect(JSON.stringify(batch)).not.toMatch(
            /psp|payoutAccount|idempotency|provider|_by|staff/i,
          );
        }

        // RLS-28 : co-hôte doté de la permission, autre hôte, compte inconnu
        const none = { country_code: null, currency: null, schedule: null, batches: null };
        expect(await read(tx, await session(tx, cohost), a.org)).toEqual({
          outcome: 'FORBIDDEN',
          ...none,
        });
        expect(await read(tx, await session(tx, b.holder), a.org)).toEqual({
          outcome: 'FORBIDDEN',
          ...none,
        });
        expect(await read(tx, holderHash, uuid())).toEqual({ outcome: 'FORBIDDEN', ...none });
        // l'autre hôte lit les siens seulement
        const rb = await read(tx, await session(tx, b.holder), b.org);
        expect(rb.batches?.map((x) => (x['items'] as { tripId: string }[])[0]?.tripId)).toEqual([
          tb,
        ]);
        // session inconnue (empreinte jamais émise)
        const unknown = createHash('sha256').update(randomBytes(32)).digest();
        expect(await read(tx, unknown, a.org)).toEqual({ outcome: 'AUTH_REQUIRED', ...none });
      });
    });
  });
});
