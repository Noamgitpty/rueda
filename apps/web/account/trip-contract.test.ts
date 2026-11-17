/**
 * Contrat de location côté site (US-211 partie 211b) : lecture défensive de la réponse de l'API
 * (une forme inattendue est refusée en bloc, jamais un contrat partiel) ; relais du PDF (octets
 * tels quels, sans cache ; tout refus de l'API devient 404, rien n'est révélé ; jamais de requête
 * sans session). Attendus : contrat OpenAPI de `/trips/{tripId}/contract` (apps/api), 10b UX-51.
 */
import { describe, expect, it } from 'vitest';
import { localInstant, relayContractPdf, tripContractOf } from './trip-contract.ts';

const TRIP = '21100000-0000-4000-8000-000000000001';
const DOC = '21100000-0000-4000-8000-000000000002';
const SHA = 'a'.repeat(64);
const contract = {
  tripId: TRIP,
  viewerRole: 'GUEST',
  documentId: DOC,
  version: 1,
  latestVersion: 1,
  courtesyLocale: 'en',
  generatedAt: '2036-12-01T10:00:00.000Z',
  sha256: SHA,
  renderer: 'ctr.pdf/1',
  draft: true,
  summary: {
    tripRef: 'K-0001',
    country: 'ZZ',
    currency: 'XXX',
    currencyExponent: 0,
    timezone: 'UTC',
    startLocal: '2036-12-12 10:00',
    endLocal: '2036-12-15 10:00',
    vehicle: { make: 'Toyota', model: 'Yaris', year: 2021 },
    hostCapacity: 'OWNER',
    priceTotalMinor: '850000',
    protection: { level: 'BASICA', deductibleMinor: '100000', insurer: 'Aseguradora' },
    depositMinor: null,
    mileage: { mode: 'INCLUDED', includedKm: 600, extraKmPriceMinor: '500' },
    lateGraceMinutes: 30,
    cancellation: { freeUntilLocal: '2036-12-11 10:00', penaltyDays: '1', retainedMinor: '283333' },
  },
  parts: [
    { lang: 'es', authoritative: true, lines: [{ style: 'title', text: 'Contrato' }] },
    { lang: 'en', authoritative: false, lines: [{ style: 'p', text: 'Agreement' }] },
  ],
  signature: null,
  signable: true,
};
const ok = (json: unknown) => ({ status: 200, json, session: null }) as const;

describe('tripContractOf (US-211 partie 211b)', () => {
  it('réponse conforme : relue telle quelle (montants en chaîne, heures locales)', () => {
    const c = tripContractOf(ok(contract));
    expect(c).toMatchObject({ tripId: TRIP, viewerRole: 'GUEST', signable: true, draft: true });
    expect(c?.summary.cancellation).toEqual({
      freeUntilLocal: '2036-12-11 10:00',
      penaltyDays: '1',
      retainedMinor: '283333',
    });
    expect(c?.parts?.map((p) => p.lang)).toEqual(['es', 'en']);
    const signed = tripContractOf(
      ok({
        ...contract,
        signable: false,
        signature: { signedAt: '2036-12-02T10:00:00.000Z', sealSha256: SHA },
      }),
    );
    expect(signed?.signature?.sealSha256).toBe(SHA);
    expect(tripContractOf(ok({ ...contract, parts: null }))?.parts).toBeNull();
  });

  it('forme inattendue ⇒ null (jamais un contrat partiel)', () => {
    const bad: unknown[] = [
      { ...contract, viewerRole: 'STAFF' },
      { ...contract, sha256: 'x' },
      { ...contract, version: 2 },
      { ...contract, summary: { ...contract.summary, priceTotalMinor: '12.5' } },
      { ...contract, summary: { ...contract.summary, startLocal: '2036-12-12T10:00' } },
      {
        ...contract,
        summary: {
          ...contract.summary,
          mileage: { mode: 'INCLUDED', includedKm: null, extraKmPriceMinor: null },
        },
      },
      { ...contract, parts: [{ lang: 'de', authoritative: true, lines: [] }] },
      {
        ...contract,
        parts: [{ lang: 'es', authoritative: true, lines: [{ style: 'script', text: 'x' }] }],
      },
      { ...contract, signature: { signedAt: 'hier', sealSha256: SHA } },
      { ...contract, signable: 'yes' },
    ];
    for (const json of bad) expect(tripContractOf(ok(json)), JSON.stringify(json)).toBeNull();
    expect(
      tripContractOf({ status: 404, json: { code: 'CONTRACT_NOT_FOUND' }, session: null }),
    ).toBeNull();
    expect(tripContractOf({ status: 'unavailable' })).toBeNull();
  });

  it('heure locale du contrat formatée en UTC : mêmes date et heure que le contrat', () => {
    expect(localInstant('2036-12-12 10:00').toISOString()).toBe('2036-12-12T10:00:00.000Z');
  });
});

describe('relayContractPdf (US-211 partie 211b)', () => {
  const ctx = { forwardedFor: null, userAgent: 'test', sessionToken: 'S'.repeat(43) };
  const env = { WEB_API_URL: 'http://api.test' };
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
  const answer = (status: number, headers: Record<string, string> = {}) =>
    (() =>
      Promise.resolve(new Response(status === 200 ? pdf : null, { status, headers }))) as never;
  const good = {
    'content-type': 'application/pdf',
    'content-disposition': 'attachment; filename="contract-K-0001-v1.pdf"',
    'x-contract-sha256': SHA,
  };

  it('PDF de l’API relayé tel quel, sans cache, avec son empreinte ; session transmise', async () => {
    let seen: { url: string; cookie: string | undefined } | null = null;
    const fetcher = ((url: string, init: RequestInit) => {
      seen = { url, cookie: (init.headers as Record<string, string>)['cookie'] };
      return Promise.resolve(new Response(pdf, { status: 200, headers: good }));
    }) as never;
    const r = await relayContractPdf(TRIP, '2', ctx, { env, fetcher });
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('x-contract-sha256')).toBe(SHA);
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(pdf);
    expect(seen).toEqual({
      url: `http://api.test/trips/${TRIP}/contract/pdf?version=2`,
      cookie: `__Host-session=${'S'.repeat(43)}`,
    });
  });

  it('refus de l’API ⇒ 404 vide ; sans session ⇒ 401 sans appel ; API absente ⇒ 503', async () => {
    for (const s of [404, 409, 400]) {
      expect((await relayContractPdf(TRIP, null, ctx, { env, fetcher: answer(s) })).status).toBe(
        404,
      );
    }
    expect((await relayContractPdf(TRIP, null, ctx, { env, fetcher: answer(503) })).status).toBe(
      503,
    );
    // type ou en-têtes inattendus : rien n'est relayé
    const html = answer(200, { ...good, 'content-type': 'text/html' });
    expect((await relayContractPdf(TRIP, null, ctx, { env, fetcher: html })).status).toBe(404);
    const fail = (() => {
      throw new Error('ne doit pas être appelé');
    }) as never;
    expect(
      (await relayContractPdf(TRIP, null, { ...ctx, sessionToken: null }, { env, fetcher: fail }))
        .status,
    ).toBe(401);
    expect((await relayContractPdf('x', null, ctx, { env, fetcher: fail })).status).toBe(404);
    expect((await relayContractPdf(TRIP, '0', ctx, { env, fetcher: fail })).status).toBe(404);
    expect((await relayContractPdf(TRIP, null, ctx, { env: {}, fetcher: fail })).status).toBe(503);
  });
});
