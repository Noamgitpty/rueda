/**
 * US-212 — contrat des routes de la constancia d'arrendamiento (`/trips/{tripId}/constancia`,
 * `/pdf`, `POST /trips/constancias/search`) sur l'application RÉELLE (ApiModule, gardes globaux,
 * durcissement HTTP ; harnais d'US-043) avec le FAKE du magasin : chaque réponse est confrontée à
 * `apps/api/openapi/openapi.json`, chaque statut déclaré est exercé.
 *
 * Attendus tirés de 19 US-212 critère 1 (plaque, période exacte, hôte, conducteur, es et en ;
 * recherche par plaque et date pour l'hôte), 16 LEG-026 (voyageur et hôte ; `DOCUMENT_GENERATION_
 * FAILED`), 17 §2.3 point 5 (IDOR : 404), 10b UX-51 (équivalent HTML), L2-PM-35 (minimisation),
 * jamais du code testé :
 * - voyageur et titulaire du compte d'hôte lisent ; toute autre personne, trip inconnu ou
 *   identifiant mal formé ⇒ la même 404 ;
 * - texte servi = texte du PDF ; espagnol (fait foi) puis la langue du lecteur (anglais pour un
 *   lecteur hispanophone) ;
 * - PDF rendu à la demande, sans cache, empreinte en en-tête = empreinte des octets = celle de la
 *   vue ; deux rendus des mêmes faits ⇒ mêmes octets ;
 * - recherche : plaque dans le corps, trips de l'hôte de la session seulement.
 * Les règles de la base (partie, faits figés, période, plaque) sont prouvées sur PostgreSQL
 * (`packages/db/test/l0/l0-us212-constancia.test.ts`). Données fictives.
 */
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { repoConfig } from '../../../../test/support/quote.js';
import {
  closeContractApps,
  contract,
  coverageOf,
  startContractApp,
  textBody,
} from '../../../testing/contract/support.js';
import type { ContractApp } from '../../../testing/contract/support.js';
import { missingCoverage } from '../../../testing/openapi-contract.js';
import { FakeTripConstanciaStore } from './fake-trip-constancia-store.js';

const apps: ContractApp[] = [];
afterAll(closeContractApps);

/** Premier pays de la configuration du dépôt (aucune constante de pays ici). */
const COUNTRY = [...repoConfig.countries.values()][0]!;
/** Total de TEST en unités mineures (entier, quel que soit l'exposant de la devise). */
const TOTAL = '1284000';

/** Ligne de `core.booking_trip_constancia` (faits figés du contrat posés par le test). */
function row(): Record<string, unknown> {
  return {
    trip_status: 'BOOKED',
    contract_version: 2,
    terms: {
      schema: 'ctr.rental/1',
      tripRef: 'K-TEST2120',
      country: COUNTRY.code,
      currency: COUNTRY.currency.code,
      timezone: COUNTRY.timeZone,
      startLocal: '2034-03-08 10:00',
      endLocal: '2034-03-11 10:00',
      bookedAtLocal: '2034-03-01 09:00',
      vehicle: { make: 'Toyota', model: 'Yaris', year: 2022 },
      hostCapacity: 'OWNER',
      priceTotalMinor: TOTAL,
    },
    brand: 'Marca',
    host_name: 'María G.',
    guest_name: 'Ana P.',
    plate: 'AB-1234',
    handover_place: 'Estación de prueba',
    handover_city: 'Ciudad de prueba',
    signed_at_local: '2034-03-02 09:15',
  };
}

interface World {
  readonly app: ContractApp;
  readonly store: FakeTripConstanciaStore;
  readonly trip: string;
  readonly guest: Record<string, string>;
  readonly host: Record<string, string>;
  readonly other: Record<string, string>;
}

/** Voyageur = acteur « voyageur » (es) ; hôte = « staff » (fr) ; tiers = « staff_sans_mfa ». */
async function world(store = new FakeTripConstanciaStore()): Promise<World> {
  const app = await startContractApp({ ctr: { constancias: store } });
  apps.push(app);
  const trip = randomUUID();
  store.addTrip(trip, app.hash('voyageur'), app.hash('staff'), row(), {
    guest: COUNTRY.legalLocale,
    host: 'fr',
  });
  return {
    app,
    store,
    trip,
    guest: app.cookie('voyageur'),
    host: app.cookie('staff'),
    other: app.cookie('staff_sans_mfa'),
  };
}

async function pdfOf(
  app: ContractApp,
  path: string,
  headers: Record<string, string>,
): Promise<{
  bytes: Buffer;
  sha: string | null;
  disposition: string | null;
  cache: string | null;
}> {
  const r = await fetch(`http://127.0.0.1:${app.h.port}${path}`, {
    headers: { 'user-agent': 'Mozilla/5.0 rueda-test', accept: 'application/pdf', ...headers },
  });
  expect(r.status).toBe(200);
  return {
    bytes: Buffer.from(await r.arrayBuffer()),
    sha: r.headers.get('x-constancia-sha256'),
    disposition: r.headers.get('content-disposition'),
    cache: r.headers.get('cache-control'),
  };
}

type Part = { lang: string; authoritative: boolean; lines: { style: string; text: string }[] };
const textOf = (parts: Part[]): string =>
  parts.flatMap((p) => p.lines.map((l) => l.text)).join('\n');

describe('US-212 — routes de la constancia d’arrendamiento', () => {
  it('lecture : voyageur (es + en) et hôte (es + fr) ; faits figés ; hôte et conducteur minimisés ; texte = texte du PDF', async () => {
    const w = await world();
    const base = `/trips/${w.trip}/constancia`;
    const guest = await w.app.api.request('GET', base, { headers: w.guest });
    expect(guest.status).toBe(200);
    expect(guest.headers.get('cache-control')).toBe('no-store');
    const g = guest.json as Record<string, unknown>;
    expect(g).toMatchObject({
      tripId: w.trip,
      viewerRole: 'GUEST',
      contractVersion: 2,
      courtesyLocale: 'en',
      renderer: 'ctr.pdf/1',
      templateVersion: 1,
      draft: true,
      summary: {
        tripRef: 'K-TEST2120',
        tripStatus: 'BOOKED',
        country: COUNTRY.code,
        startLocal: '2034-03-08 10:00',
        endLocal: '2034-03-11 10:00',
        vehicle: { make: 'Toyota', model: 'Yaris', year: 2022 },
        plate: 'AB-1234',
        hostName: 'María G.',
        hostCapacity: 'OWNER',
        driverName: 'Ana P.',
        handoverPlace: 'Estación de prueba',
        handoverCity: 'Ciudad de prueba',
        currency: COUNTRY.currency.code,
        currencyExponent: COUNTRY.currency.exponent,
        priceTotalMinor: TOTAL,
        signedAtLocal: '2034-03-02 09:15',
      },
    });
    const parts = g['parts'] as Part[];
    expect(parts.map((p) => [p.lang, p.authoritative])).toEqual([
      ['es', true],
      ['en', false],
    ]);
    const text = textOf(parts);
    for (const fact of ['AB-1234', 'María G.', 'Ana P.', 'K-TEST2120', '2034-03-08 10:00']) {
      expect(text).toContain(fact);
    }
    expect(text).not.toMatch(/inapelable/i);
    // le texte servi est exactement celui que le PDF imprime : même empreinte
    const pdf = await pdfOf(w.app, `${base}/pdf`, w.guest);
    expect(pdf.sha).toBe(g['sha256']);
    expect(createHash('sha256').update(pdf.bytes).digest('hex')).toBe(g['sha256']);
    // l'hôte lit la même constancia, la seconde langue est la sienne
    const host = await w.app.api.request('GET', base, { headers: w.host });
    expect(host.status).toBe(200);
    const h = host.json as Record<string, unknown>;
    expect(h).toMatchObject({ viewerRole: 'HOST', courtesyLocale: 'fr', contractVersion: 2 });
    expect((h['parts'] as Part[]).map((p) => p.lang)).toEqual(['es', 'fr']);
    // la partie espagnole (fait foi) est la même pour les deux parties
    expect((h['parts'] as Part[])[0]).toEqual(parts[0]);
  });

  it('PDF : rendu à la demande, sans cache, empreinte en en-tête, mêmes faits ⇒ mêmes octets ; un fait changé ⇒ autre empreinte', async () => {
    const w = await world();
    const base = `/trips/${w.trip}/constancia/pdf`;
    const r = await w.app.api.request('GET', base, { headers: w.guest });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/^application\/pdf/);
    const a = await pdfOf(w.app, base, w.guest);
    const b = await pdfOf(w.app, base, w.guest);
    expect(a.cache).toBe('no-store');
    expect(a.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(a.disposition).toBe('attachment; filename="constancia-K-TEST2120-v2-es-en.pdf"');
    expect(b.bytes.equals(a.bytes)).toBe(true);
    expect(a.sha).toBe(createHash('sha256').update(a.bytes).digest('hex'));
    w.store.setRow(w.trip, { ...row(), plate: 'AB-1235' });
    const c = await pdfOf(w.app, base, w.guest);
    expect(c.sha).not.toBe(a.sha);
  });

  it('IDOR et états : tiers, trip inconnu ou mal formé ⇒ même 404 ; sans session ⇒ 401 ; annulé, sans contrat, effacé ⇒ 409 ; faits illisibles ⇒ 503 DOCUMENT_GENERATION_FAILED ; base absente ⇒ 503', async () => {
    const w = await world();
    const { api } = w.app;
    const base = `/trips/${w.trip}/constancia`;
    for (const [path, headers] of [
      [base, w.other],
      [`${base}/pdf`, w.other],
      [`/trips/${randomUUID()}/constancia`, w.guest],
      ['/trips/pas-un-uuid/constancia', w.guest],
      ['/trips/pas-un-uuid/constancia/pdf', w.guest],
    ] as const) {
      const r = await api.request('GET', path, { headers });
      expect(r.status, path).toBe(404);
      expect(r.json, path).toEqual({
        code: 'CONSTANCIA_NOT_FOUND',
        messageKey: 'common.constancia.notFound',
      });
    }
    expect((await api.request('GET', base)).status).toBe(401);
    expect((await api.request('GET', `${base}/pdf`)).status).toBe(401);
    for (const [outcome, code] of [
      ['NOT_AVAILABLE', 'CONSTANCIA_NOT_AVAILABLE'],
      ['NOT_GENERATED', 'CONSTANCIA_NOT_GENERATED'],
      ['ERASED', 'CONSTANCIA_ERASED'],
    ] as const) {
      w.store.setOutcome(w.trip, outcome);
      for (const path of [base, `${base}/pdf`]) {
        const r = await api.request('GET', path, { headers: w.guest });
        expect(r.status, `${outcome} ${path}`).toBe(409);
        expect(r.json).toMatchObject({ code });
      }
    }
    w.store.setOutcome(w.trip, 'OK');
    // faits figés d'une forme inconnue : rien n'est servi (jamais un document deviné)
    w.store.setRow(w.trip, { ...row(), terms: { ...(row()['terms'] as object), schema: 'x/9' } });
    for (const path of [base, `${base}/pdf`]) {
      const r = await api.request('GET', path, { headers: w.guest });
      expect(r.status, path).toBe(503);
      expect(r.json).toMatchObject({ code: 'DOCUMENT_GENERATION_FAILED' });
    }
    w.store.setRow(w.trip, { ...row(), signed_at_local: '2034-03-02' });
    expect((await api.request('GET', base, { headers: w.guest })).json).toMatchObject({
      code: 'DOCUMENT_GENERATION_FAILED',
    });
    w.store.failing = true;
    for (const path of [base, `${base}/pdf`]) {
      const r = await api.request('GET', path, { headers: w.guest });
      expect(r.status, path).toBe(503);
      expect(r.json).toMatchObject({ code: 'CONSTANCIA_UNAVAILABLE' });
    }
    const bare = await startContractApp();
    apps.push(bare);
    const none = await bare.api.request('GET', `/trips/${randomUUID()}/constancia`, {
      headers: bare.cookie('voyageur'),
    });
    expect(none.status).toBe(503);
  });

  it('recherche de l’hôte (EC-48) : plaque sans casse ni séparateurs, date locale ; voyageur ou tiers : aucun trip ; saisie invalide ⇒ 400 ; sans session ⇒ 401 ; corps texte ⇒ 415 ; base absente ⇒ 503', async () => {
    const w = await world();
    const { api } = w.app;
    const path = '/trips/constancias/search';
    const found = await api.request('POST', path, {
      headers: w.host,
      body: { plate: 'ab 1234', date: '2034-03-12' },
    });
    expect(found.status).toBe(200);
    expect(found.headers.get('cache-control')).toBe('no-store');
    expect(found.json).toEqual({
      trips: [
        {
          tripId: w.trip,
          tripRef: 'K-TEST2120',
          status: 'BOOKED',
          startLocal: '2034-03-08 10:00',
          endLocal: '2034-03-11 10:00',
        },
      ],
    });
    for (const headers of [w.guest, w.other]) {
      const r = await api.request('POST', path, {
        headers,
        body: { plate: 'AB-1234', date: '2034-03-09' },
      });
      expect(r.status).toBe(200);
      expect(r.json).toEqual({ trips: [] });
    }
    const late = await api.request('POST', path, {
      headers: w.host,
      body: { plate: 'AB-1234', date: '2034-03-13' },
    });
    expect(late.json).toEqual({ trips: [] });
    for (const body of [
      {},
      { plate: 'AB-1234' },
      { plate: 'AB-1234', date: '2034-03-09', extra: 1 },
      { plate: 'AB-1234', date: '09/03/2034' },
      { plate: 'AB-1234', date: '2034-13-01' },
      { plate: 1234, date: '2034-03-09' },
      { plate: 'A', date: '2034-03-09' },
      { plate: '-- --', date: '2034-03-09' },
      [],
    ]) {
      const r = await api.request('POST', path, { headers: w.host, body });
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.json).toMatchObject({ code: 'REQUEST_INVALID' });
    }
    expect(
      (await api.request('POST', path, { body: { plate: 'AB-1234', date: '2034-03-09' } })).status,
    ).toBe(401);
    // corps texte : refusé avant tout appel (parade CSRF)
    const text = await api.request('POST', path, textBody(w.host));
    expect(text.status).toBe(415);
    w.store.failing = true;
    const down = await api.request('POST', path, {
      headers: w.host,
      body: { plate: 'AB-1234', date: '2034-03-09' },
    });
    expect(down.status).toBe(503);
    expect(down.json).toMatchObject({ code: 'CONSTANCIA_UNAVAILABLE' });
  });

  it('couverture : chaque statut déclaré pour /trips/{tripId}/constancia est exercé ; chaque statut déclaré pour /trips/constancias est exercé', () => {
    const covered = coverageOf(...apps);
    expect(missingCoverage(contract, '/trips/{tripId}/constancia', covered), 'lecture').toEqual([]);
    expect(missingCoverage(contract, '/trips/constancias', covered), 'recherche').toEqual([]);
  });
});
