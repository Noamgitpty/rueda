/**
 * US-212 (migration 0137, ADR-162) — constancia d'arrendamiento d'un trip et recherche de l'hôte par
 * plaque et date : `core.booking_trip_constancia` et `core.booking_host_constancia_search`
 * (SECURITY DEFINER, EXECUTE app_api). Rôles de PRODUCTION seulement (assertion L0-05 par
 * `connectAs`), au Panama (USD) et au Paraguay (PYG sans décimale).
 *
 * Attendus tirés de 19 US-212 critère 1 (« plaque, période exacte (fuseau du pays), hôte (pièce
 * masquée) et identité du conducteur ; recherche par plaque et date possible pour l'hôte »), de 16
 * LEG-026 (« téléchargeable par le voyageur et par l'hôte » ; régénérée à chaque modification ;
 * EC-48 : amende reçue après le trip), de 08 BR-TT-03 (PV de stationnement imputables jusqu'à 24 h
 * après la fin), de 17 §2.3 point 5 (IDOR : même réponse qu'un trip absent) et du pré-mortem du
 * lot 2 (L2-PM-35 : hôte en prénom et initiale, aucune adresse exacte). Les faits attendus sont
 * CEUX que le test écrit dans le contrat figé (montants en unités mineures, PYG sans décimale) : la
 * lecture les rend sans les recalculer. Jamais le code testé comme oracle.
 *
 * Tout se passe dans des transactions ANNULÉES sous app_api (monde du trip de la fixture 9963,
 * contrat posé par 9946 avec les faits du test, signature par 9963, sessions ouvertes par la vraie
 * commande) ; aucun interrupteur n'est touché.
 */
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { connectAs, releaseClient } from '../../src/testing/index.ts';
import { COUNTRIES, inTx, uuid } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { newToken, openSession, register, setVirtualNow } from '../support/iam.ts';
import { uniquePlate } from '../support/unique.ts';

type Tx = pg.ClientBase;
type Row = Record<string, unknown>;

/** Montants de TEST en unités mineures, par devise (jamais par pays) ; total = Σ lignes. */
const AMOUNTS: Readonly<
  Record<
    string,
    {
      readonly lines: readonly { type: string; amountMinor: string }[];
      readonly total: string;
      readonly deductibles: Readonly<Record<string, string>>;
      readonly rc: string;
      readonly deposit: string;
      readonly extraKm: string;
    }
  >
> = {
  USD: {
    lines: [
      { type: 'TRIP_PRICE', amountMinor: '12000' },
      { type: 'TRIP_FEE', amountMinor: '840' },
    ],
    total: '12840',
    deductibles: { BASICA: '50000', ESTANDAR: '25000', TOTAL: '0' },
    rc: '10000000',
    deposit: '25000',
    extraKm: '35',
  },
  PYG: {
    lines: [
      { type: 'TRIP_PRICE', amountMinor: '1000000' },
      { type: 'TRIP_FEE', amountMinor: '71000' },
    ],
    total: '1071000',
    deductibles: { BASICA: '3500000', ESTANDAR: '1750000', TOTAL: '0' },
    rc: '750000000',
    deposit: '1750000',
    extraKm: '2500',
  },
};

const READ = 'SELECT * FROM core.booking_trip_constancia($1, $2::uuid)';
const SEARCH = 'SELECT * FROM core.booking_host_constancia_search($1, $2, $3::date)';
const T0 = '2035-05-02T09:17:23.000Z';
const START = '2035-06-10T15:00:00.000Z';
const END = '2035-06-13T15:00:00.000Z';
const at = (minutes: number): string => new Date(Date.parse(T0) + minutes * 60_000).toISOString();

/** Heure locale « AAAA-MM-JJ HH:MM » dans le fuseau du pays (attendu indépendant du SQL). */
function local(iso: string, timeZone: string): string {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}`;
}

/** Date locale (AAAA-MM-JJ) décalée de `days` jours depuis l'heure locale donnée. */
function localDate(localTime: string, days: number): string {
  const d = new Date(`${localTime.slice(0, 10)}T00:00:00.000Z`);
  return new Date(d.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/** Trip BOOKED complet (fixture 9963) : voyageur Ana Pérez (pt-BR), hôte María Gómez. */
async function world(
  tx: Tx,
  c: CountryCase,
  guest: string,
  plate: string,
): Promise<{ trip: string; holder: string }> {
  const a = AMOUNTS[c.currency]!;
  const w = (
    await tx.query<{ trip_id: string; holder_id: string }>(
      `SELECT * FROM test_fixture.us211_world($1, $2, 'Ana', 'Pérez', 'pt-BR', 'María', 'Gómez',
                                              $3, 'HOST', $4, $5, $6::jsonb, 'BASICA', 600, $7,
                                              $8::jsonb, $9, $10)`,
      [
        c.country,
        guest,
        plate,
        START,
        END,
        JSON.stringify(a.lines),
        a.extraKm,
        JSON.stringify(a.deductibles),
        a.rc,
        a.deposit,
      ],
    )
  ).rows[0]!;
  return { trip: w.trip_id, holder: w.holder_id };
}

/** Faits figés du contrat posés par le test (forme de `terms` de 0122, valeurs du test). */
function terms(c: CountryCase, tripRef: string): Row {
  const a = AMOUNTS[c.currency]!;
  return {
    schema: 'ctr.rental/1',
    tripRef,
    country: c.country,
    currency: c.currency,
    timezone: c.timezone,
    startLocal: local(START, c.timezone),
    endLocal: local(END, c.timezone),
    bookedAtLocal: local(T0, c.timezone),
    vehicle: { make: 'Toyota', model: 'Yaris', year: 2022 },
    hostCapacity: 'OWNER',
    priceTotalMinor: a.total,
  };
}

const identity = (plate: string): Row => ({
  hostName: 'María Gómez',
  guestName: 'Ana P.',
  plate,
  handoverPlace: 'Estación de prueba',
  handoverAddress: 'Calle Falsa 123',
  handoverCity: 'Ciudad de prueba',
});

async function contract(tx: Tx, trip: string, t: Row, who: Row): Promise<number> {
  return (
    await tx.query<{ version: number }>(
      'SELECT * FROM test_fixture.us212_contract($1, $2::jsonb, $3::jsonb)',
      [trip, JSON.stringify(t), JSON.stringify(who)],
    )
  ).rows[0]!.version;
}

const read = async (tx: Tx, hash: Buffer, trip: string): Promise<Row[]> =>
  (await tx.query<Row>(READ, [hash, trip])).rows;
const search = async (
  tx: Tx,
  hash: Buffer,
  plate: string | null,
  date: string | null,
): Promise<Row[]> => (await tx.query<Row>(SEARCH, [hash, plate, date])).rows;

/** Forme d'un refus : une ligne, aucune donnée du trip. */
function refused(rows: Row[], outcome: string, role: string | null): void {
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    outcome,
    viewer_role: role,
    terms: null,
    host_name: null,
    guest_name: null,
    plate: null,
    handover_place: null,
    handover_city: null,
    signed_at_local: null,
  });
}

describe.each(COUNTRIES)('US-212 — constancia d’arrendamiento ($country, $currency)', (c) => {
  const a = AMOUNTS[c.currency]!;

  it('critère 1 : faits figés du dernier contrat pour le voyageur et l’hôte, hôte en prénom et initiale, signature à l’heure locale, version suivante ; autrui : NOT_FOUND', async () => {
    const api = await connectAs('app_api');
    try {
      await inTx(api, { virtualNow: T0 }, async (tx) => {
        const guest = uuid();
        const plate = await uniquePlate(tx, 'K');
        const w = await world(tx, c, guest, plate);
        const ref = `K-${w.trip.slice(0, 8).toUpperCase()}`;
        await setVirtualNow(tx, at(1));
        const g = await openSession(tx, guest);
        const host = await openSession(tx, w.holder);
        const other = await register(tx);
        const o = await openSession(tx, other.userId);

        // aucun contrat encore : la partie l'apprend, rien d'autre
        refused(await read(tx, g.hash, w.trip), 'NOT_GENERATED', 'GUEST');

        const t1 = terms(c, ref);
        expect(await contract(tx, w.trip, t1, identity(plate))).toBe(1);
        const rows = await read(tx, g.hash, w.trip);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          outcome: 'OK',
          viewer_role: 'GUEST',
          viewer_locale: 'pt-BR',
          trip_status: 'BOOKED',
          contract_version: 1,
          brand: 'Marca',
          // L2-PM-35 : prénom et initiale de l'hôte, jamais le nom complet du contrat
          host_name: 'María G.',
          // conducteur : nom figé du contrat (prénom et initiale)
          guest_name: 'Ana P.',
          plate,
          handover_place: 'Estación de prueba',
          handover_city: 'Ciudad de prueba',
          signed_at_local: null,
        });
        // faits figés rendus tels quels (montant en unités mineures, PYG sans décimale)
        expect(rows[0]!['terms']).toEqual(t1);
        expect((rows[0]!['terms'] as Row)['priceTotalMinor']).toBe(a.total);
        // aucune adresse exacte, aucune pièce : la ligne n'a pas ces colonnes
        expect(Object.keys(rows[0]!)).not.toContain('handover_address');
        expect(JSON.stringify(rows[0])).not.toContain('Calle Falsa');
        expect(JSON.stringify(rows[0])).not.toContain('Gómez');

        // signature du voyageur (heure du serveur) : rendue à l'heure locale du trip
        await setVirtualNow(tx, at(2));
        await tx.query('SELECT test_fixture.us211_sign($1)', [w.trip]);
        const signed = (await read(tx, g.hash, w.trip))[0]!;
        expect(signed['signed_at_local']).toBe(local(at(2), c.timezone));

        // l'hôte du trip lit la même constancia
        const h = (await read(tx, host.hash, w.trip))[0]!;
        expect(h).toMatchObject({
          outcome: 'OK',
          viewer_role: 'HOST',
          contract_version: 1,
          host_name: 'María G.',
          guest_name: 'Ana P.',
          plate,
          signed_at_local: local(at(2), c.timezone),
        });
        expect(h['terms']).toEqual(t1);

        // nouvelle version du contrat (plaque corrigée) : la constancia la suit, non signée
        const plate2 = await uniquePlate(tx, 'L');
        expect(await contract(tx, w.trip, t1, identity(plate2))).toBe(2);
        expect((await read(tx, g.hash, w.trip))[0]).toMatchObject({
          outcome: 'OK',
          contract_version: 2,
          plate: plate2,
          signed_at_local: null,
        });

        // IDOR : autre personne, trip inconnu, session inconnue : même réponse, aucune donnée
        refused(await read(tx, o.hash, w.trip), 'NOT_FOUND', null);
        refused(await read(tx, g.hash, uuid()), 'NOT_FOUND', null);
        refused(await read(tx, newToken().hash, w.trip), 'NOT_FOUND', null);

        // recherche de l'hôte (EC-48) : plaque saisie sans casse ni séparateurs, date locale
        const startLocal = local(START, c.timezone);
        const endLocal = local(END, c.timezone);
        const typed = `${plate2.slice(0, 3).toLowerCase()}-${plate2.slice(3)} `;
        const found = await search(tx, host.hash, typed, localDate(startLocal, 0));
        expect(found).toEqual([
          {
            outcome: 'DONE',
            trip_id: w.trip,
            public_ref: ref,
            status: 'BOOKED',
            start_local: startLocal,
            end_local: endLocal,
          },
        ]);
        // BR-TT-03 : jusqu'au lendemain de la fin ; ni avant le début ni au-delà
        expect(
          (await search(tx, host.hash, plate2, localDate(endLocal, 1))).map((r) => r['trip_id']),
        ).toEqual([w.trip]);
        expect(await search(tx, host.hash, plate2, localDate(endLocal, 2))).toEqual([]);
        expect(await search(tx, host.hash, plate2, localDate(startLocal, -1))).toEqual([]);
        // plaque FIGÉE au dernier contrat : l'ancienne ne trouve plus rien
        expect(await search(tx, host.hash, plate, localDate(startLocal, 0))).toEqual([]);
        // ni le voyageur ni un tiers ne trouvent le trip de l'hôte
        expect(await search(tx, g.hash, plate2, localDate(startLocal, 0))).toEqual([]);
        expect(await search(tx, o.hash, plate2, localDate(startLocal, 0))).toEqual([]);
        // session inconnue ; saisie invalide
        expect(await search(tx, newToken().hash, plate2, localDate(startLocal, 0))).toEqual([
          expect.objectContaining({ outcome: 'AUTH_REQUIRED', trip_id: null }),
        ]);
        for (const [p, d] of [
          ['K', localDate(startLocal, 0)],
          ['-- --', localDate(startLocal, 0)],
          ['ABCDEFGHIJKLM', localDate(startLocal, 0)],
          [plate2, null],
        ] as const) {
          expect(await search(tx, host.hash, p, d)).toEqual([
            expect.objectContaining({ outcome: 'REQUEST_INVALID', trip_id: null }),
          ]);
        }

        // trip annulé : aucune location à attester ; absent de la recherche
        await tx.query('SELECT test_fixture.us207_force_status($1, $2)', [
          w.trip,
          'CANCELLED_BY_HOST',
        ]);
        const cx = await read(tx, g.hash, w.trip);
        refused(cx, 'NOT_AVAILABLE', 'GUEST');
        expect(cx[0]!['trip_status']).toBe('CANCELLED_BY_HOST');
        expect(await search(tx, host.hash, plate2, localDate(startLocal, 0))).toEqual([]);
      });
    } finally {
      await releaseClient(api);
    }
  });

  it('rétention : partie nominative pseudonymisée ⇒ ERASED, aucune donnée ; absente de la recherche', async () => {
    const api = await connectAs('app_api');
    try {
      await inTx(api, { virtualNow: T0 }, async (tx) => {
        const guest = uuid();
        const plate = await uniquePlate(tx, 'M');
        const w = await world(tx, c, guest, plate);
        await contract(tx, w.trip, terms(c, 'K-ERASED'), identity(plate));
        await tx.query('SELECT test_fixture.us212_erase($1)', [w.trip]);
        await setVirtualNow(tx, at(1));
        const g = await openSession(tx, guest);
        const host = await openSession(tx, w.holder);
        const rows = await read(tx, g.hash, w.trip);
        refused(rows, 'ERASED', 'GUEST');
        expect(rows[0]!['contract_version']).toBe(1);
        expect(await search(tx, host.hash, plate, local(START, c.timezone).slice(0, 10))).toEqual(
          [],
        );
      });
    } finally {
      await releaseClient(api);
    }
  });
});

describe('US-212 — la constancia est fermée aux autres rôles de production', () => {
  it.each(['app_worker', 'app_anon'] as const)(
    '%s ne peut exécuter ni la lecture ni la recherche (42501)',
    async (role) => {
      const client = await connectAs(role);
      try {
        await expect(client.query(READ, [newToken().hash, uuid()])).rejects.toMatchObject({
          code: '42501',
        });
        await expect(
          client.query(SEARCH, [newToken().hash, 'ABC123', '2035-06-10']),
        ).rejects.toMatchObject({ code: '42501' });
      } finally {
        await releaseClient(client);
      }
    },
  );
});
