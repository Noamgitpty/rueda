/**
 * Aides de la red team du lot 1 (US-122, PR n° 1 : RLS, abus, KYC, véhicules, interrupteurs).
 *
 * Toutes les connexions passent par `withRole` / `connectAs` (assertion L0-05 en tête, rôles de
 * production seulement). Les personnes, hôtes et membres du staff sont créés par les VRAIES
 * commandes (inscription, session, compte d'hôte, élévation TOTP) ; les fixtures `test_fixture.*`
 * ne servent qu'à poser un état que la production atteint par un autre chemin (compte ACTIVE,
 * contrat d'assureur, paramètre du pays, classe de valeur). Aucune constante de pays : les pays
 * viennent de `COUNTRIES` (données de test).
 *
 * Les valeurs attendues viennent de 19 (US-107 à US-127), de 16 (HST, VER, ACC), de 17 §2.3, §7.2
 * et de 08, jamais du code testé.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { withRole, withTestTransaction } from '../../../src/testing/index.ts';
import { COUNTRIES, uuid } from '../../support/avl.ts';
import type { CountryCase } from '../../support/avl.ts';
import { freshSession, requestSwitch, approveSwitch } from '../../support/golive.ts';
import type { StaffActor } from '../../support/golive.ts';
import { person } from '../../support/kyc.ts';
import { staff as rlsStaff, staffSessionHash } from '../../support/rls.ts';
import { elevatedStaff as elevatedRaw, installTestProofKey } from '../../support/staff.ts';

export { COUNTRIES, uuid };
export type { CountryCase };

export type Tx = pg.ClientBase;
export const ALL = COUNTRIES.map((c) => c.country);
export const byCountry = COUNTRIES.map((c) => [c.country, c.currency, c] as const);
export const otherOf = (c: CountryCase): CountryCase =>
  COUNTRIES.find((x) => x.country !== c.country) as CountryCase;

/** Corps de test dans une transaction ANNULÉE, sous app_api (assertion L0-05 par withRole). */
export const rolledBack = <T>(body: (tx: Tx) => Promise<T>): Promise<T> =>
  withRole('app_api', (client) => withTestTransaction(client, {}, body));

/** Données de configuration des pays (jamais une constante du code). */
const cfg = (file: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(`../../../../../apps/api/src/modules/cfg/data/${file}`, import.meta.url),
      'utf8',
    ),
  );

/** Valeur d'un paramètre par pays, telle que la graine des données CFG la déclare. */
export const paramValues = (key: string): Record<string, unknown> =>
  (
    cfg('params.json') as { params: { key: string; values?: Record<string, unknown> }[] }
  ).params.find((p) => p.key === key)?.values ?? {};

// ---------------------------------------------------------------------------------------------
// Hôtes, véhicules, annonces (mêmes commandes que l0-us115 / l0-us118 / l0-us124)
// ---------------------------------------------------------------------------------------------
export interface Host {
  readonly userId: string;
  readonly hash: Buffer;
  readonly org: string;
  readonly location: string;
  readonly country: string;
}

/**
 * Hôte : personne (e-mail et téléphone vérifiés), compte d'hôte, CGU de l'hôte v1 acceptées,
 * compte forcé ACTIVE (sa vérification est prouvée par l0-us123), lieu dont la zone est un quartier.
 */
export async function hostOf(
  c: Tx,
  country: string,
  names: { first: string; last: string } = { first: 'Ana', last: 'Pérez' },
): Promise<Host> {
  const p = await person(c, country, names);
  const acc = await c.query<{ outcome: string; org_id: string | null }>(
    'SELECT * FROM core.iam_cmd_open_host_account($1, $2, $3)',
    [p.token, country, 'INDIVIDUAL'],
  );
  const org = acc.rows[0]?.org_id;
  if (acc.rows[0]?.outcome !== 'DONE' || !org) throw new Error('compte d’hôte refusé');
  const t = await c.query<{ outcome: string }>(
    'SELECT * FROM core.ctr_cmd_accept_host_terms($1, $2, 1, $3)',
    [p.token, org, 'es'],
  );
  if (t.rows[0]?.outcome !== 'DONE') throw new Error('CGU de l’hôte refusées');
  await c.query('SELECT test_fixture.us115_set_org_status($1, $2)', [org, 'ACTIVE']);
  const loc = await createLocation(c, { hash: p.token, org }, 'Barrio Norte');
  if (loc.outcome !== 'DONE' || !loc.id) throw new Error(`lieu : ${loc.outcome}`);
  return { userId: p.userId, hash: p.token, org, location: loc.id, country };
}

export interface Outcome {
  readonly outcome: string;
  readonly id: string | null;
}

export async function createLocation(
  c: Tx,
  h: { hash: Buffer; org: string },
  area: string | null,
  city = 'Ciudad Uno',
): Promise<Outcome> {
  const { rows } = await c.query<{ outcome: string; location_id: string | null }>(
    `SELECT * FROM core.catalog_cmd_create_location($1, $2, 'HOME', 'Casa', 'Calle Ficticia 123',
                                                    $4, $3, NULL, NULL)`,
    [h.hash, h.org, area, city],
  );
  return { outcome: rows[0]?.outcome ?? '', id: rows[0]?.location_id ?? null };
}

export const plate = (): string => `R${randomBytes(4).toString('hex').toUpperCase()}`;
export const vin = (): string => {
  const alphabet = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
  return Array.from(randomBytes(17), (b) => alphabet[b % alphabet.length]).join('');
};

/** Année civile en cours dans le fuseau du pays (oracle indépendant de la base). */
export const localYear = (cc: CountryCase): number =>
  Number(new Intl.DateTimeFormat('en-CA', { timeZone: cc.timezone, year: 'numeric' }).format());

export interface VehicleSpec {
  readonly plate?: string;
  readonly vin?: string | null;
  readonly year?: number;
  readonly offCatalog?: boolean;
  readonly make?: string;
  readonly model?: string;
  readonly location?: string;
}

/** Véhicule du compte de `h` (catalogue, ou hors catalogue avec marque et modèle saisis). */
export async function vehicleOf(
  c: Tx,
  h: Host,
  cc: CountryCase,
  v: VehicleSpec = {},
): Promise<Outcome> {
  const variant = v.offCatalog
    ? null
    : (await c.query<{ v: string }>('SELECT test_fixture.us124_variant($1) AS v', [cc.country]))
        .rows[0]?.v;
  const { rows } = await c.query<{ outcome: string; vehicle_id: string | null }>(
    `SELECT * FROM core.catalog_cmd_create_vehicle($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL,
                                                   'MANUAL', 5::smallint, 'GASOLINE', NULL,
                                                   false, false)`,
    [
      h.hash,
      h.org,
      v.location ?? h.location,
      v.plate ?? plate(),
      v.vin === undefined ? vin() : v.vin,
      variant ?? null,
      v.offCatalog ? (v.make ?? 'Chery') : null,
      v.offCatalog ? (v.model ?? 'Tiggo 2') : null,
      v.year ?? localYear(cc) - 2,
    ],
  );
  const id = rows[0]?.vehicle_id ?? null;
  if (id) {
    // classe de valeur connue (couverture de l'assureur : une donnée inconnue n'est jamais couverte)
    await c.query('SELECT test_fixture.us108_set_value_class($1, $2)', [id, 'STANDARD']);
  }
  return { outcome: rows[0]?.outcome ?? '', id };
}

/** Déclaration de l'hôte puis contrôles automatiques : issue de la soumission (ELIGIBLE attendu). */
export async function declareAndSubmit(
  c: Tx,
  h: Host,
  vehicleId: string,
  d: { holder?: string; lien?: boolean; owner?: boolean; lienOk?: boolean; km?: number } = {},
): Promise<{ declared: string; submitted: string }> {
  const dec = await c.query<{ outcome: string }>(
    'SELECT * FROM core.catalog_cmd_declare_vehicle($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [
      h.hash,
      h.org,
      vehicleId,
      d.holder ?? 'HOST',
      d.lien ?? false,
      d.km ?? 42_000,
      d.owner ?? true,
      d.lienOk ?? true,
      null,
    ],
  );
  const sub = await c.query<{ outcome: string }>(
    'SELECT * FROM core.catalog_cmd_submit_vehicle_eligibility($1, $2, $3)',
    [h.hash, h.org, vehicleId],
  );
  return { declared: dec.rows[0]?.outcome ?? '', submitted: sub.rows[0]?.outcome ?? '' };
}

/** Annonce DRAFT au prix du pays (`40 × pas`), pourvue des photos minimales demandées. */
export async function listingOf(
  c: Tx,
  h: Host,
  cc: CountryCase,
  vehicleId: string,
  photos = 0,
): Promise<string> {
  const lst = await c.query<{ outcome: string; listing_id: string | null }>(
    `SELECT * FROM core.catalog_cmd_create_listing($1, $2, $3, $4, 'UNLIMITED', NULL, NULL, NULL)`,
    [h.hash, h.org, vehicleId, 40 * cc.priceStepMinor],
  );
  const id = lst.rows[0]?.listing_id;
  if (!id) throw new Error(`annonce : ${lst.rows[0]?.outcome}`);
  for (let i = 0; i < photos; i += 1) {
    const p = await c.query<{ outcome: string }>(
      'SELECT * FROM core.catalog_cmd_add_listing_photo($1, $2, $3, $4, $5, $6, $7, $8)',
      [h.hash, h.org, id, uuid(), uuid(), 'image/jpeg', 123_456, randomBytes(32)],
    );
    if (p.rows[0]?.outcome !== 'DONE') throw new Error(`photo : ${p.rows[0]?.outcome}`);
  }
  return id;
}

/** Hôte avec un véhicule ELIGIBLE et une annonce DRAFT : le monde minimal d'une cible d'IDOR. */
export interface Target {
  readonly host: Host;
  readonly vehicle: string;
  readonly listing: string;
}
export async function targetOf(c: Tx, cc: CountryCase): Promise<Target> {
  const host = await hostOf(c, cc.country);
  const v = await vehicleOf(c, host, cc);
  if (!v.id) throw new Error(`véhicule : ${v.outcome}`);
  const r = await declareAndSubmit(c, host, v.id);
  if (r.submitted !== 'ELIGIBLE') throw new Error(`éligibilité : ${r.submitted}`);
  return { host, vehicle: v.id, listing: await listingOf(c, host, cc, v.id) };
}

// ---------------------------------------------------------------------------------------------
// Personnel de la console
// ---------------------------------------------------------------------------------------------
export type Staff = Awaited<ReturnType<typeof elevatedRaw>>;

/** Membre du staff élevé par TOTP (clé de preuve de test installée d'abord). */
export async function ops(c: Tx, role: string, scope: readonly string[]): Promise<Staff> {
  await installTestProofKey(c);
  return elevatedRaw(c, role, scope);
}

/** Acteur de staff du banc de RLS (session élevée posée par fixture), pour les interrupteurs. */
export async function switchActor(
  c: Tx,
  role: string,
  scope: readonly string[],
): Promise<StaffActor> {
  const id = await rlsStaff(c, role, scope);
  return { userId: id, hash: Buffer.from(staffSessionHash(id) ?? '', 'hex'), scope };
}

/** Ouvre un interrupteur dans la transaction ANNULÉE de l'appelant (procédure à deux personnes). */
export async function openSwitchInTx(
  c: Tx,
  key: 'p2p_private_hosts_enabled' | 'insurer_contract_active',
  country: string,
): Promise<void> {
  const requester = await switchActor(c, 'ADMIN', [country]);
  const approver = await freshSession(c, await switchActor(c, 'SUPERADMIN', [country]));
  const r = await requestSwitch(c, requester, key, country, true);
  if (r.outcome !== 'REQUESTED' || r.request_id === null) throw new Error(`demande : ${r.outcome}`);
  const a = await approveSwitch(c, approver, r.request_id);
  if (a.outcome !== 'APPLIED') throw new Error(`approbation : ${a.outcome}`);
}

/** Pièces non exigées, revue du pays fixée, contrat d'assureur en vigueur (dans la transaction). */
export async function countryRules(c: Tx, country: string, review: boolean): Promise<void> {
  for (const key of [
    'elig_doc_title',
    'elig_doc_plate_vin_photo',
    'elig_doc_inspection',
    'elig_doc_compulsory_insurance',
    'elig_doc_owner_authorization',
    'elig_doc_lender_consent',
  ]) {
    await c.query('SELECT test_fixture.us124_param_version($1, $2, $3::jsonb)', [
      key,
      country,
      'false',
    ]);
  }
  await c.query('SELECT test_fixture.us118_param_version($1, $2, $3::jsonb)', [
    'listing_manual_review_required',
    country,
    review ? 'true' : 'false',
  ]);
  await c.query('SELECT test_fixture.us108_insurer_contract($1, $2, $3)', [
    country,
    50,
    ['STANDARD', 'PREMIUM', 'LUXE'],
  ]);
}

/** Contenu de la ligne d'une fonction de lecture, sans identifiant propre à l'appel (comparaison). */
export const shape = (rows: readonly unknown[]): string => JSON.stringify(rows);
