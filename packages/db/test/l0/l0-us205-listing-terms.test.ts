/**
 * Preuves des conditions affichées sur la fiche (US-205, migrations 0114 et 0115, ADR-138 ;
 * fixture 9973) sous les rôles de production (assertion L0-05 en tête de chaque connexion :
 * `withRole`), en USD (PA) et en PYG sans décimale (PY). Personnes, sessions, comptes d'hôte,
 * lieux, véhicules et annonces sont créés par les VRAIES commandes (US-107, US-115) ; les
 * interrupteurs `p2p_private_hosts_enabled` et `insurer_contract_active` ne sont ouverts que par la
 * procédure à deux personnes d'US-125, dans une transaction ANNULÉE ; le contrat de l'assureur
 * (qu'aucune commande n'écrit) est posé par la fixture, dans la même transaction annulée.
 *
 * Attendus tirés de 19 US-205 (« Given un départ le 14/01 10:00 réservé 5 j avant, Then gratuite
 * jusqu'au 13/01 10:00 ; départ dans 20 h ⇒ gratuite pendant 1 h après la réservation » ; « 200 km
 * / j et 3 jours facturables ⇒ 600 km » (le produit est fait par l'API, la base rend la distance par
 * jour et le prix du km de l'annonce) ; « assureur, RC tiers incluse, franchises et exclusions du
 * contrat ; RC sous le minimum légal ⇒ POLICY_RC_BELOW_MINIMUM » ; « insurer_contract_active =
 * false ⇒ aucune promesse de couverture »), de 08 BR-CXL-01 (formulation exécutable : `lastMinute =
 * (start − bookedAt) < lastMinuteThreshold` (25 h), `freeUntil = lastMinute ? min(bookedAt + 60 min,
 * start) : start − 24 h`, fenêtre de 0117 depuis US-205b) et de 16 LST-013 / PRT-003 (bloc absent si le véhicule n'est pas couvert par le contrat
 * en vigueur), jamais du code testé.
 */
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { signedOpenParams, withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES, uuid } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { approveSwitch, freshSession, requestSwitch } from '../support/golive.ts';
import type { StaffActor } from '../support/golive.ts';
import { newToken, phcArgon2id, SESSION_TTL_S } from '../support/iam.ts';
import { placeName } from '../support/names.ts';
import { uniquePlate } from '../support/unique.ts';
import { staff as rlsStaff, staffSessionHash } from '../support/rls.ts';

type Tx = pg.ClientBase;
type Row = Record<string, unknown>;

const DOCS = '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]';
const TERMS = 'SELECT * FROM core.catalog_public_terms($1::uuid, $2::timestamptz)';
const HOUR = 3_600_000;

/**
 * Données de TEST par pays (unités mineures de la devise du pays) : prix du km de l'annonce, RC
 * (au minimum de 0114 : 100 000,00 USD ; 750 000 000 PYG), franchises par niveau.
 */
const MONEY: Readonly<
  Record<string, { extraKm: number; rc: string; deductibles: Record<string, string> }>
> = {
  PA: {
    extraKm: 35,
    rc: '10000000',
    deductibles: { BASICA: '150000', ESTANDAR: '50000', TOTAL: '0' },
  },
  PY: {
    extraKm: 3000,
    rc: '750000000',
    deductibles: { BASICA: '10000000', ESTANDAR: '3500000', TOTAL: '0' },
  },
};
const EXCLUSIONS = {
  es: 'Daños interiores y mecánicos; salida del territorio.',
  en: 'Interior and mechanical damage; leaving the country.',
  fr: 'Dommages intérieurs et mécaniques ; sortie du territoire.',
  'pt-BR': 'Danos internos e mecânicos; saída do território.',
};

interface Car {
  readonly org: string;
  readonly vehicle: string;
  readonly listing: string;
}

/** Personne inscrite (compte ACTIVE) et session ouverte (vraies commandes d'US-102 et d'IAM). */
async function person(c: Tx, country: string): Promise<Buffer> {
  const userId = uuid();
  const r = await c.query<{ ok: boolean }>(
    `SELECT core.iam_cmd_register_with_consents($1, $2, $3, 'Ana', 'Pérez', 'es', $4, $5, 86400,
                                                NULL, $6, $7::jsonb, false) AS ok`,
    [userId, `s205-${userId}@example.test`, phcArgon2id(), uuid(), randomBytes(32), country, DOCS],
  );
  if (r.rows[0]?.ok !== true) throw new Error('inscription de test refusée');
  await c.query('SELECT test_fixture.iam_set_account_status($1, $2)', [userId, 'ACTIVE']);
  const t = newToken();
  const s = await c.query<{ expires_at: Date | null }>(
    `SELECT core.iam_cmd_open_session($1, $2, $3, $4, 'NONE', NULL, 'vitest', $5, $6) AS expires_at`,
    await signedOpenParams(c, [uuid(), userId, t.hash, SESSION_TTL_S]),
  );
  if (!s.rows[0]?.expires_at) throw new Error('session refusée');
  return t.hash;
}

/**
 * Hôte, lieu, véhicule (classe STANDARD) et annonce publiée ; distance incluse de 200 km par jour
 * (19 US-205 critère 2) et prix du km de `MONEY`, ou kilométrage illimité.
 */
async function car(c: Tx, cc: CountryCase, mileage: 'INCLUDED' | 'UNLIMITED'): Promise<Car> {
  const hash = await person(c, cc.country);
  const acc = await c.query<{ outcome: string; org_id: string | null }>(
    'SELECT * FROM core.iam_cmd_open_host_account($1, $2, $3)',
    [hash, cc.country, 'INDIVIDUAL'],
  );
  const org = acc.rows[0]?.org_id;
  if (acc.rows[0]?.outcome !== 'DONE' || !org) throw new Error('compte d’hôte refusé');
  await c.query('SELECT test_fixture.us115_set_org_status($1, $2)', [org, 'ACTIVE']);
  const loc = await c.query<{ location_id: string | null; outcome: string }>(
    'SELECT * FROM core.catalog_cmd_create_location($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [hash, org, 'HOME', 'Casa', 'Calle', placeName('Villa'), placeName('Barrio'), '8.98', '-79.51'],
  );
  const location = loc.rows[0]?.location_id;
  if (!location) throw new Error(`lieu refusé : ${loc.rows[0]?.outcome}`);
  const veh = await c.query<{ vehicle_id: string | null }>(
    `SELECT * FROM core.catalog_cmd_create_vehicle($1, $2, $3, $4, NULL, NULL, 'Marca', 'Modelo',
                                                   2021, NULL, 'AUTOMATIC', 5::smallint,
                                                   'GASOLINE', 42000, false, false)`,
    [hash, org, location, await uniquePlate(c, 'C')],
  );
  const vehicle = veh.rows[0]?.vehicle_id;
  if (!vehicle) throw new Error('véhicule refusé');
  await c.query('SELECT test_fixture.us108_set_value_class($1, $2)', [vehicle, 'STANDARD']);
  const money = MONEY[cc.country];
  if (money === undefined) throw new Error('pays sans données de test');
  const lst = await c.query<{ listing_id: string | null; outcome: string }>(
    'SELECT * FROM core.catalog_cmd_create_listing($1, $2, $3, $4, $5, $6, $7, NULL)',
    [
      hash,
      org,
      vehicle,
      40 * cc.priceStepMinor * 100,
      mileage,
      mileage === 'INCLUDED' ? 200 : null,
      mileage === 'INCLUDED' ? money.extraKm : null,
    ],
  );
  const listing = lst.rows[0]?.listing_id;
  if (!listing) throw new Error(`annonce refusée : ${lst.rows[0]?.outcome}`);
  await c.query('SELECT test_fixture.us115_set_listing_status($1, $2)', [listing, 'LISTED']);
  return { org, vehicle, listing };
}

/** Interrupteur ouvert par la procédure à deux personnes d'US-125, dans la transaction annulée. */
async function openSwitch(
  c: Tx,
  key: 'p2p_private_hosts_enabled' | 'insurer_contract_active',
  country: string,
): Promise<void> {
  const actor = async (role: string): Promise<StaffActor> => {
    const id = await rlsStaff(c, role, [country]);
    return { userId: id, hash: Buffer.from(staffSessionHash(id) ?? '', 'hex'), scope: [country] };
  };
  const requester = await actor('ADMIN');
  const approver = await freshSession(c, await actor('SUPERADMIN'));
  const r = await requestSwitch(c, requester, key, country, true);
  if (r.outcome !== 'REQUESTED' || r.request_id === null) throw new Error(`demande : ${r.outcome}`);
  const a = await approveSwitch(c, approver, r.request_id);
  if (a.outcome !== 'APPLIED') throw new Error(`approbation : ${a.outcome}`);
}

/** Contrat de l'assureur du pays avec ses conditions (fixture : aucune commande ne l'écrit). */
async function contract(c: Tx, cc: CountryCase, rc?: string, broker = true): Promise<string> {
  const money = MONEY[cc.country];
  if (money === undefined) throw new Error('pays sans données de test');
  const { rows } = await c.query<{ id: string }>(
    `SELECT test_fixture.us205_insurer_contract($1, $2, $3::bigint, $4::jsonb, $5::jsonb, $6)
              AS id`,
    [
      cc.country,
      cc.currency,
      rc ?? money.rc,
      JSON.stringify(money.deductibles),
      JSON.stringify(EXCLUSIONS),
      broker,
    ],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('contrat refusé');
  return id;
}

async function terms(c: Tx, listing: string, start: string | null): Promise<Row[]> {
  return (await c.query<Row>(TERMS, [listing, start])).rows;
}

/** Code d'une erreur de la base dans un point de sauvegarde (la transaction reste utilisable). */
async function refusal(c: Tx, body: () => Promise<unknown>): Promise<string | null> {
  await c.query('SAVEPOINT us205');
  try {
    await body();
    await c.query('RELEASE SAVEPOINT us205');
    return null;
  } catch (error) {
    await c.query('ROLLBACK TO SAVEPOINT us205');
    return (error as { message?: string }).message ?? 'erreur';
  }
}

/** Pose l'horloge de la base (`platform.now()`, horloge virtuelle des tests, 9000). */
async function setNow(c: Tx, iso: string): Promise<void> {
  await c.query("SELECT pg_catalog.set_config('app.virtual_now', $1, true)", [iso]);
}

const rolledBack = (body: (tx: Tx) => Promise<void>) =>
  withRole('app_api', (client) => withTestTransaction(client, {}, body));

/** Colonnes de la protection (toutes nulles quand rien n'est promis). */
const PROTECTION_COLUMNS = [
  'insurer_name',
  'insurer_license_ref',
  'broker_name',
  'broker_license_ref',
  'contract_version',
  'rc_amount_minor',
  'deductibles',
  'exclusions',
] as const;

function expectNoPromise(r: Row | undefined): void {
  expect(r?.['protection_offered']).toBe(false);
  for (const k of PROTECTION_COLUMNS) expect(r?.[k], k).toBeNull();
}

describe.each(COUNTRIES)('US-205 — conditions de la fiche ($country, $currency)', (cc) => {
  it('critère 1 (08 BR-CXL-01) : départ le 14/01 10:00 réservé 5 j avant ⇒ gratuite jusqu’au 13/01 10:00 ; départ dans 20 h ⇒ dernière minute, gratuite 1 h après la réservation (US-205b : min(maintenant + 60 min, départ)) ; départ dans 30 min ⇒ jusqu’au départ ; 25 h pile ⇒ hors dernière minute (seuil strict) ; sans départ : paramètres seuls', async () => {
    await rolledBack(async (tx) => {
      const x = await car(tx, cc, 'UNLIMITED');
      // heure locale 10:00 du 14/01/2037 dans le fuseau du pays (donnée IANA, aucune constante)
      const { rows: s } = await tx.query<{ start: Date }>(
        `SELECT ('2037-01-14 10:00'::timestamp AT TIME ZONE $1) AS start`,
        [cc.timezone],
      );
      const start = s[0]?.start;
      if (!start) throw new Error('instant illisible');
      await setNow(tx, new Date(start.getTime() - 5 * 24 * HOUR).toISOString());
      const [row] = await terms(tx, x.listing, start.toISOString());
      expect(row).toMatchObject({
        listing_id: x.listing,
        currency: cc.currency,
        timezone: cc.timezone,
        free_cancel_lead_hours: 24,
        last_minute_threshold_hours: 25,
        last_minute_window_minutes: 60,
        last_minute: false,
      });
      // 13/01 10:00, heure locale du pays
      const { rows: f } = await tx.query<{ local: string }>(
        `SELECT pg_catalog.to_char($1::timestamptz AT TIME ZONE $2, 'DD/MM HH24:MI') AS local`,
        [row?.['free_until'], cc.timezone],
      );
      expect(f[0]?.local).toBe('13/01 10:00');
      expect((row?.['free_until'] as Date).getTime()).toBe(start.getTime() - 24 * HOUR);
      expect((row?.['read_at'] as Date).getTime()).toBe(start.getTime() - 5 * 24 * HOUR);

      // départ dans 20 h : réservation de dernière minute (< 25 h), gratuite 1 h après la
      // réservation (US-205b : last_minute_free_window_minutes = 60 de 0117, 08 BR-CXL-01)
      await setNow(tx, new Date(start.getTime() - 20 * HOUR).toISOString());
      const late = (await terms(tx, x.listing, start.toISOString()))[0];
      expect(late).toMatchObject({ last_minute: true, last_minute_window_minutes: 60 });
      expect((late?.['free_until'] as Date).getTime()).toBe(start.getTime() - 19 * HOUR);
      // départ dans 30 min : min(bookedAt + 60 min, start) = départ, jamais après le début (08)
      await setNow(tx, new Date(start.getTime() - 30 * 60_000).toISOString());
      const soon = (await terms(tx, x.listing, start.toISOString()))[0];
      expect(soon?.['last_minute']).toBe(true);
      expect((soon?.['free_until'] as Date).getTime()).toBe(start.getTime());
      // 25 h pile : pas de dernière minute (comparaison stricte de 08), gratuite jusqu'à start − 24 h
      await setNow(tx, new Date(start.getTime() - 25 * HOUR).toISOString());
      const edge = (await terms(tx, x.listing, start.toISOString()))[0];
      expect(edge?.['last_minute']).toBe(false);
      expect((edge?.['free_until'] as Date).getTime()).toBe(start.getTime() - 24 * HOUR);
      // 24 h 59 min : dernière minute
      await setNow(tx, new Date(start.getTime() - 25 * HOUR + 60_000).toISOString());
      expect((await terms(tx, x.listing, start.toISOString()))[0]?.['last_minute']).toBe(true);
      // sans départ, ou départ passé : paramètres seuls, aucune date
      for (const st of [null, new Date(start.getTime() - 26 * HOUR).toISOString()]) {
        expect((await terms(tx, x.listing, st))[0]).toMatchObject({
          free_cancel_lead_hours: 24,
          last_minute_window_minutes: 60,
          last_minute: null,
          free_until: null,
        });
      }
    });
  });

  it('critère 2 : distance de l’annonce (200 km par jour, prix du km de l’hôte, devise du pays) ; illimité ⇒ aucun prix du km ; annonce inconnue ou non publiée ⇒ aucune ligne', async () => {
    await rolledBack(async (tx) => {
      const x = await car(tx, cc, 'INCLUDED');
      expect((await terms(tx, x.listing, null))[0]).toMatchObject({
        mileage_mode: 'INCLUDED',
        included_km_per_day: 200,
        extra_km_price_minor: String(MONEY[cc.country]?.extraKm),
        currency: cc.currency,
      });
      const u = await car(tx, cc, 'UNLIMITED');
      expect((await terms(tx, u.listing, null))[0]).toMatchObject({
        mileage_mode: 'UNLIMITED',
        included_km_per_day: null,
        extra_km_price_minor: null,
      });
      await tx.query('SELECT test_fixture.us115_set_listing_status($1, $2)', [
        x.listing,
        'UNLISTED',
      ]);
      expect(await terms(tx, x.listing, null)).toEqual([]);
      expect(await terms(tx, uuid(), null)).toEqual([]);
    });
  });

  it('critère 4 : insurer_contract_active = false (défaut de production) ⇒ aucune promesse de couverture, même avec un contrat en vigueur et ses conditions', async () => {
    await rolledBack(async (tx) => {
      const x = await car(tx, cc, 'UNLIMITED');
      await contract(tx, cc);
      expectNoPromise((await terms(tx, x.listing, null))[0]);
      await openSwitch(tx, 'insurer_contract_active', cc.country);
      expect((await terms(tx, x.listing, null))[0]?.['protection_offered']).toBe(true);
    });
  });

  it('critère 3 : contrat en vigueur ⇒ assureur, courtier, RC tiers, franchises par niveau et exclusions recopiés du contrat ; sans contrat, véhicule hors contrat, assureur ou courtier inactif ⇒ rien', async () => {
    await rolledBack(async (tx) => {
      const x = await car(tx, cc, 'UNLIMITED');
      await openSwitch(tx, 'insurer_contract_active', cc.country);
      // interrupteur ouvert mais aucun contrat en vigueur : jamais couvert (fail-closed)
      expectNoPromise((await terms(tx, x.listing, null))[0]);
      const id = await contract(tx, cc);
      const [row] = await terms(tx, x.listing, null);
      const money = MONEY[cc.country];
      expect(row).toMatchObject({
        protection_offered: true,
        insurer_name: 'Aseguradora de prueba',
        insurer_license_ref: 'SSRP-TEST-1',
        broker_name: 'Corredor de prueba',
        broker_license_ref: null,
        rc_amount_minor: money?.rc,
        deductibles: money?.deductibles,
        exclusions: EXCLUSIONS,
      });
      expect(Number(row?.['contract_version'])).toBeGreaterThanOrEqual(1);
      // véhicule hors des critères du contrat (classe LUXE non couverte) : bloc absent (LST-013)
      await tx.query('SELECT test_fixture.us108_set_value_class($1, $2)', [x.vehicle, 'LUXE']);
      expectNoPromise((await terms(tx, x.listing, null))[0]);
      await tx.query('SELECT test_fixture.us108_set_value_class($1, $2)', [x.vehicle, 'STANDARD']);
      // courtier, puis assureur, devenus inactifs : rien n'est promis
      await tx.query('SELECT test_fixture.us205_set_insurer_status($1, true, $2)', [
        id,
        'INACTIVE',
      ]);
      expectNoPromise((await terms(tx, x.listing, null))[0]);
      await tx.query('SELECT test_fixture.us205_set_insurer_status($1, true, $2)', [id, 'ACTIVE']);
      await tx.query('SELECT test_fixture.us205_set_insurer_status($1, false, $2)', [
        id,
        'INACTIVE',
      ]);
      expectNoPromise((await terms(tx, x.listing, null))[0]);
    });
  });

  it('critère 3 : RC sous le minimum légal du pays ⇒ POLICY_RC_BELOW_MINIMUM, rien d’écrit ; au minimum pile ⇒ accepté ; minimum relevé après coup ⇒ plus aucune promesse ; conditions immuables, devise autre que celle du pays refusée', async () => {
    await rolledBack(async (tx) => {
      const x = await car(tx, cc, 'UNLIMITED');
      await openSwitch(tx, 'insurer_contract_active', cc.country);
      const money = MONEY[cc.country];
      if (money === undefined) throw new Error('pays sans données de test');
      const below = (BigInt(money.rc) - 1n).toString();
      expect(await refusal(tx, () => contract(tx, cc, below))).toContain('POLICY_RC_BELOW_MINIMUM');
      expectNoPromise((await terms(tx, x.listing, null))[0]);
      // autre devise que celle du pays : refusé (la RC se lit dans la devise du pays)
      const other = COUNTRIES.find((o) => o.currency !== cc.currency)?.currency ?? 'XTS';
      expect(
        await refusal(tx, () =>
          tx.query(
            `SELECT test_fixture.us205_insurer_contract($1, $2, $3::bigint, $4::jsonb, $5::jsonb,
                                                        false)`,
            [
              cc.country,
              other,
              money.rc,
              JSON.stringify(money.deductibles),
              JSON.stringify(EXCLUSIONS),
            ],
          ),
        ),
      ).toContain('INSURER_CONTRACT_CURRENCY_MISMATCH');
      // au minimum pile : accepté et promis
      const id = await contract(tx, cc, money.rc);
      expect((await terms(tx, x.listing, null))[0]?.['protection_offered']).toBe(true);
      // conditions posées : immuables (nouvelle version du contrat à la place)
      expect(
        await refusal(tx, () =>
          tx.query('SELECT test_fixture.us205_set_terms($1, $2::bigint)', [
            id,
            (BigInt(money.rc) * 2n).toString(),
          ]),
        ),
      ).toContain('INSURER_CONTRACT_TERMS_IMMUTABLE');
      // minimum du pays relevé au-dessus de la RC du contrat : la promesse disparaît à la lecture
      await tx.query('SELECT test_fixture.us205_set_rc_minimum($1, $2)', [
        cc.country,
        (BigInt(money.rc) + 1n).toString(),
      ]);
      expectNoPromise((await terms(tx, x.listing, null))[0]);
    });
  });

  it('revue sécurité : clôture d’une version sous un minimum relevé depuis ⇒ acceptée (rien n’est rejoué), puis nouvelle version au nouveau minimum ⇒ promise ; version à conditions jamais supprimée', async () => {
    await rolledBack(async (tx) => {
      const x = await car(tx, cc, 'UNLIMITED');
      await openSwitch(tx, 'insurer_contract_active', cc.country);
      const money = MONEY[cc.country];
      if (money === undefined) throw new Error('pays sans données de test');
      const first = await contract(tx, cc, money.rc);
      const raised = (BigInt(money.rc) * 2n).toString();
      await tx.query('SELECT test_fixture.us205_set_rc_minimum($1, $2)', [cc.country, raised]);
      expectNoPromise((await terms(tx, x.listing, null))[0]);
      // une version qui porte des conditions ne se supprime pas
      expect(
        await refusal(tx, () => tx.query('SELECT test_fixture.us205_delete_contract($1)', [first])),
      ).toContain('INSURER_CONTRACT_TERMS_IMMUTABLE');
      // clôture : seul valid_to change, le minimum relevé n'est pas rejoué
      // instant rendu en texte : la précision de la base (µs) est gardée, jamais arrondie à la ms
      const { rows: closed } = await tx.query<{ t: string | null }>(
        'SELECT test_fixture.us205_close_contract($1)::text AS t',
        [first],
      );
      const closedAt = closed[0]?.t;
      if (!closedAt) throw new Error('clôture refusée');
      // version suivante à partir de la clôture (exclusion GiST respectée), RC au nouveau minimum
      const { rows: next } = await tx.query<{ id: string }>(
        `SELECT test_fixture.us205_insurer_contract($1, $2, $3::bigint, $4::jsonb, $5::jsonb, false,
                                                    $6::timestamptz) AS id`,
        [
          cc.country,
          cc.currency,
          raised,
          JSON.stringify(money.deductibles),
          JSON.stringify(EXCLUSIONS),
          closedAt,
        ],
      );
      expect(next[0]?.id).toBeTruthy();
      const [row] = await terms(tx, x.listing, null);
      expect(row).toMatchObject({ protection_offered: true, rc_amount_minor: raised });
    });
  });

  it('caution de la plateforme du pays et de la classe (même règle que les cartes) ; aucune politique ⇒ NULL (mention générique)', async () => {
    await rolledBack(async (tx) => {
      const x = await car(tx, cc, 'UNLIMITED');
      expect((await terms(tx, x.listing, null))[0]?.['deposit_amount_minor']).toBeNull();
      const amount = String(250 * cc.priceStepMinor * 100);
      await tx.query('SELECT test_fixture.us203_set_deposit_policy($1, $2, $3::bigint, $4)', [
        cc.country,
        'STANDARD',
        amount,
        cc.currency,
      ]);
      expect((await terms(tx, x.listing, null))[0]?.['deposit_amount_minor']).toBe(amount);
    });
  });

  it('aucune donnée personnelle ni de l’hôte : colonnes rendues exactement celles des conditions', async () => {
    await rolledBack(async (tx) => {
      const x = await car(tx, cc, 'INCLUDED');
      const [row] = await terms(tx, x.listing, null);
      expect(Object.keys(row ?? {}).sort()).toEqual(
        [
          'listing_id',
          'currency',
          'timezone',
          'read_at',
          'free_cancel_lead_hours',
          'last_minute_threshold_hours',
          'last_minute',
          'free_until',
          'last_minute_window_minutes',
          'mileage_mode',
          'included_km_per_day',
          'extra_km_price_minor',
          'deposit_amount_minor',
          'protection_offered',
          ...PROTECTION_COLUMNS,
        ].sort(),
      );
      expect(JSON.stringify(row)).not.toContain(x.org);
      expect(JSON.stringify(row)).not.toContain(x.vehicle);
    });
  });
});

describe('US-205 — droits', () => {
  it('app_anon et app_worker ne peuvent pas exécuter core.catalog_public_terms ; app_api ne lit pas le contrat de l’assureur directement', async () => {
    for (const role of ['app_anon', 'app_worker'] as const) {
      await withRole(role, async (client) => {
        await expect(client.query(TERMS, [uuid(), null])).rejects.toMatchObject({
          code: '42501',
        });
      });
    }
    await withRole('app_api', async (client) => {
      await expect(
        client.query('SELECT rc_amount_minor FROM core.settlement_insurer_contract'),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });
});
