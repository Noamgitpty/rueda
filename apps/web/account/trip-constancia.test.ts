/**
 * US-212 — lecture défensive de la constancia et de la recherche de l'hôte, relais du PDF : toute
 * forme inattendue ⇒ `null` (l'écran dit l'erreur, jamais une constancia partielle) ; PDF relayé
 * tel quel, sans cache, avec son empreinte ; refus de l'API réduits à 404 / 401 / 503.
 */
import { describe, expect, it } from 'vitest';
import { constanciaSearchOf, relayConstanciaPdf, tripConstanciaOf } from './trip-constancia.ts';

const TRIP = '21200000-0000-4000-8000-000000000001';
const SHA = 'b'.repeat(64);
const view = {
  tripId: TRIP,
  viewerRole: 'HOST',
  contractVersion: 2,
  courtesyLocale: 'fr',
  sha256: SHA,
  renderer: 'ctr.pdf/1',
  templateVersion: 1,
  draft: true,
  summary: {
    tripRef: 'K-0001',
    tripStatus: 'COMPLETED',
    country: 'ZZ',
    startLocal: '2036-12-12 10:00',
    endLocal: '2036-12-15 10:00',
    vehicle: { make: 'Toyota', model: 'Yaris', year: 2021 },
    plate: 'AB 1234',
    hostName: 'María G.',
    hostCapacity: 'OWNER',
    driverName: 'Ana P.',
    handoverPlace: null,
    handoverCity: 'Ciudad',
    currency: 'XXX',
    currencyExponent: 0,
    priceTotalMinor: '1071000',
    signedAtLocal: '2036-12-01 09:30',
  },
  parts: [
    { lang: 'es', authoritative: true, lines: [{ style: 'title', text: 'CONSTANCIA' }] },
    { lang: 'fr', authoritative: false, lines: [{ style: 'title', text: 'ATTESTATION' }] },
  ],
};
const ok = (json: unknown) => ({ status: 200, json, session: null }) as const;

describe('tripConstanciaOf (US-212)', () => {
  it('réponse conforme : vue rendue, lieu sans nom et contrat signé compris', () => {
    const v = tripConstanciaOf(ok(view));
    expect(v).toMatchObject({
      tripId: TRIP,
      viewerRole: 'HOST',
      contractVersion: 2,
      sha256: SHA,
      draft: true,
      summary: { plate: 'AB 1234', handoverPlace: null, priceTotalMinor: '1071000' },
    });
    expect(v?.parts.map((p) => p.lang)).toEqual(['es', 'fr']);
    expect(
      tripConstanciaOf(ok({ ...view, summary: { ...view.summary, signedAtLocal: null } })),
    ).not.toBeNull();
  });

  it.each([
    ['statut', { status: 404, json: view, session: null }],
    ['rôle', ok({ ...view, viewerRole: 'OPS' })],
    ['trip', ok({ ...view, tripId: 'x' })],
    ['empreinte', ok({ ...view, sha256: 'z' })],
    ['montant décimal', ok({ ...view, summary: { ...view.summary, priceTotalMinor: '10.5' } })],
    ['heure locale', ok({ ...view, summary: { ...view.summary, startLocal: '2036-12-12' } })],
    ['plaque', ok({ ...view, summary: { ...view.summary, plate: '' } })],
    ['signature', ok({ ...view, summary: { ...view.summary, signedAtLocal: 'hier' } })],
    ['une seule partie', ok({ ...view, parts: [view.parts[0]] })],
    ['espagnol absent en tête', ok({ ...view, parts: [view.parts[1], view.parts[0]] })],
    [
      'style inconnu',
      ok({
        ...view,
        parts: [view.parts[0], { ...view.parts[1], lines: [{ style: 'x', text: 'y' }] }],
      }),
    ],
  ] as const)('forme inattendue (%s) ⇒ null', (_label, reply) => {
    expect(tripConstanciaOf(reply as never)).toBeNull();
  });
});

describe('constanciaSearchOf (US-212)', () => {
  const trip = {
    tripId: TRIP,
    tripRef: 'K-1',
    status: 'BOOKED',
    startLocal: '2036-12-12 10:00',
    endLocal: '2036-12-15 10:00',
  };
  it('liste rendue ; vide permise ; une ligne mal formée ⇒ null (jamais une liste partielle)', () => {
    expect(constanciaSearchOf(ok({ trips: [trip] }))).toEqual([
      {
        tripId: TRIP,
        tripRef: 'K-1',
        startLocal: '2036-12-12 10:00',
        endLocal: '2036-12-15 10:00',
      },
    ]);
    expect(constanciaSearchOf(ok({ trips: [] }))).toEqual([]);
    expect(constanciaSearchOf(ok({ trips: [trip, { ...trip, tripId: 'x' }] }))).toBeNull();
    expect(constanciaSearchOf(ok({}))).toBeNull();
    expect(constanciaSearchOf({ status: 'unavailable' })).toBeNull();
  });
});

describe('relayConstanciaPdf (US-212)', () => {
  const ctx = { forwardedFor: null, userAgent: 'test', sessionToken: 'S'.repeat(43) };
  const env = { WEB_API_URL: 'http://api.test' };
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
  const good = {
    'content-type': 'application/pdf',
    'content-disposition': 'attachment; filename="constancia-K-0001-v2-es-fr.pdf"',
    'x-constancia-sha256': SHA,
  };
  const answer = (status: number, headers: Record<string, string> = good) =>
    (() =>
      Promise.resolve(new Response(status === 200 ? pdf : null, { status, headers }))) as never;

  it('PDF de l’API relayé tel quel, sans cache, avec son empreinte ; session transmise', async () => {
    let seen: { url: string; cookie: string | undefined } | null = null;
    const fetcher = ((url: string, init: RequestInit) => {
      seen = { url, cookie: (init.headers as Record<string, string>)['cookie'] };
      return Promise.resolve(new Response(pdf, { status: 200, headers: good }));
    }) as never;
    const r = await relayConstanciaPdf(TRIP, ctx, { env, fetcher });
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('x-constancia-sha256')).toBe(SHA);
    expect(r.headers.get('content-disposition')).toBe(good['content-disposition']);
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(pdf);
    expect(seen).toEqual({
      url: `http://api.test/trips/${TRIP}/constancia/pdf`,
      cookie: `__Host-session=${'S'.repeat(43)}`,
    });
  });

  it('refus : identifiant mal formé ⇒ 404 sans appel ; sans session ⇒ 401 ; refus de l’API ⇒ 404 ; en-têtes douteux ⇒ 404 ; API absente ⇒ 503', async () => {
    expect((await relayConstanciaPdf('x', ctx, { env, fetcher: answer(200) })).status).toBe(404);
    expect(
      (
        await relayConstanciaPdf(
          TRIP,
          { ...ctx, sessionToken: null },
          { env, fetcher: answer(200) },
        )
      ).status,
    ).toBe(401);
    expect((await relayConstanciaPdf(TRIP, ctx, { env, fetcher: answer(401) })).status).toBe(401);
    for (const s of [404, 409]) {
      expect((await relayConstanciaPdf(TRIP, ctx, { env, fetcher: answer(s) })).status).toBe(404);
    }
    expect((await relayConstanciaPdf(TRIP, ctx, { env, fetcher: answer(503) })).status).toBe(503);
    for (const bad of [
      { ...good, 'content-type': 'text/html' },
      { ...good, 'x-constancia-sha256': 'nope' },
      { ...good, 'content-disposition': 'attachment; filename="../x.pdf"' },
    ]) {
      expect((await relayConstanciaPdf(TRIP, ctx, { env, fetcher: answer(200, bad) })).status).toBe(
        404,
      );
    }
    expect((await relayConstanciaPdf(TRIP, ctx, { env: {}, fetcher: answer(200) })).status).toBe(
      503,
    );
  });
});
