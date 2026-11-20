/**
 * US-211 partie 211b — contrat des routes du contrat de location d'un trip
 * (`/trips/{tripId}/contract`, `/pdf`, `/sign`) sur l'application RÉELLE (ApiModule, gardes globaux,
 * durcissement HTTP ; harnais d'US-043) avec le FAKE du magasin : chaque réponse est confrontée à
 * `apps/api/openapi/openapi.json`, chaque statut déclaré est exercé.
 *
 * Attendus tirés de 19 US-211 (critères 2 et 3), 16 BKG-018 / BKG-019 (parties, empreinte,
 * `CONTRACT_HASH_MISMATCH`, case et bouton, heure serveur), 17 §2.3 point 5 (IDOR : 404), 10b UX-51
 * (résumé et équivalent HTML), ADR-143 n° 5 (PDF reproduit à l'identique), jamais du code testé :
 * - voyageur et titulaire du compte d'hôte lisent ; toute autre personne, trip inconnu ou
 *   identifiant mal formé ⇒ la même 404 ; la signature est au seul voyageur ;
 * - texte servi = texte du PDF (bloc de signature compris) ; espagnol (fait foi) puis courtoisie ;
 * - PDF rendu de nouveau, empreinte = celle enregistrée ; texte qui ne la redonne plus ⇒ 503 ;
 *   PDF signé vérifiable (un octet modifié ⇒ CONTRACT_HASH_MISMATCH) ;
 * - signature : empreinte différente ⇒ 409 et rien d'écrit ; rejeu ⇒ la signature d'origine.
 * Les règles de la base (partie, version, état du trip, sceau) sont prouvées sur PostgreSQL
 * (`packages/db/test/l0/l0-us211-rental-contract.test.ts`). Données fictives.
 */
import { createHash, randomUUID } from 'node:crypto';
import { parseLocaleConfig } from '@rueda/i18n';
import locales from '@rueda/i18n/config/locales.json' with { type: 'json' };
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
import {
  buildContractBody,
  contractFooter,
  contractSha256,
  renderContractPdf,
  RENTAL_CONTRACT_RENDERER,
  verifyContractPdf,
  verifySignedContractPdf,
} from '../internal/contract/rental-contract.js';
import type { ContractLine } from '../internal/contract/pdf.js';
import type { RentalContractInput } from '../internal/contract/rental-contract.js';
import { FakeTripContractStore } from './fake-trip-contract-store.js';

const apps: ContractApp[] = [];
afterAll(closeContractApps);

/** Premier pays de la configuration du dépôt (aucune constante de pays ici). */
const COUNTRY = [...repoConfig.countries.values()][0]!;

function input(version: number): RentalContractInput {
  return {
    terms: {
      schema: 'ctr.rental/1',
      tripRef: 'K-TEST2110',
      country: COUNTRY.code,
      currency: COUNTRY.currency.code,
      timezone: COUNTRY.timeZone,
      startLocal: '2034-03-08 10:00',
      endLocal: '2034-03-11 10:00',
      bookedAtLocal: '2034-03-01 09:00',
      vehicle: { make: 'Toyota', model: 'Yaris', year: 2022 },
      hostCapacity: 'OWNER',
      priceTotalMinor: '12840',
      priceLines: [{ type: 'TRIP_PRICE', amountMinor: '12840', taxMinor: '0' }],
      protection: {
        level: 'BASICA',
        deductibleMinor: '50000',
        rcMinor: '2500000',
        insurer: 'Aseguradora de prueba',
        broker: null,
      },
      depositMinor: '25000',
      mileage: { mode: 'INCLUDED', includedKm: 600, extraKmPriceMinor: '35' },
      lateGraceMinutes: 29,
    },
    identity: {
      hostName: 'María Gómez',
      guestName: 'Ana P.',
      plate: 'AB1234',
      handoverPlace: 'Casa',
      handoverAddress: 'Calle 50',
      handoverCity: 'Ciudad',
    },
    derived: {
      brand: 'Marca',
      cancellation: {
        freeUntilLocal: '2034-03-07 10:00',
        penaltyDays: '1',
        retainedMinor: '4280',
        engineVersion: 'cxl-beta/1',
      },
    },
    version,
    es: { title: 'Contrato de alquiler', body: 'BORRADOR.\n1. Partes.', isDraft: true },
    courtesy: {
      locale: 'fr',
      title: 'Contrat de location',
      body: 'BROUILLON.\n1. Parties.',
      isDraft: true,
    },
    exponent: COUNTRY.currency.exponent,
    localeConfig: parseLocaleConfig(locales),
    countryNames: COUNTRY.names,
  };
}

/** Version telle que le travailleur l'enregistre : faits, texte figé, empreinte du PDF à signer. */
function version(n: number): {
  body: ContractLine[];
  record: Parameters<FakeTripContractStore['addVersion']>[1];
} {
  const i = input(n);
  const body = buildContractBody(i);
  const sha = contractSha256(
    renderContractPdf(body, contractFooter('K-TEST2110', n), RENTAL_CONTRACT_RENDERER),
  );
  return {
    body,
    record: {
      terms: JSON.parse(JSON.stringify(i.terms)) as unknown,
      derived: JSON.parse(JSON.stringify(i.derived)) as unknown,
      body: JSON.parse(JSON.stringify(body)) as unknown,
      sha256: sha,
      renderer: RENTAL_CONTRACT_RENDERER,
      locale: 'fr',
      draft: true,
    },
  };
}

interface World {
  readonly app: ContractApp;
  readonly store: FakeTripContractStore;
  readonly trip: string;
  readonly guest: Record<string, string>;
  readonly host: Record<string, string>;
  readonly other: Record<string, string>;
}

/** Voyageur = acteur « voyageur » ; hôte = « staff » ; tiers = « staff_sans_mfa ». */
async function world(store = new FakeTripContractStore()): Promise<World> {
  const app = await startContractApp({ ctr: { contracts: store } });
  apps.push(app);
  const trip = randomUUID();
  store.addTrip(trip, app.hash('voyageur'), app.hash('staff'));
  return {
    app,
    store,
    trip,
    guest: app.cookie('voyageur'),
    host: app.cookie('staff'),
    other: app.cookie('staff_sans_mfa'),
  };
}

const pdfBytes = async (
  app: ContractApp,
  path: string,
  headers: Record<string, string>,
): Promise<{ bytes: Buffer; sha: string | null; disposition: string | null }> => {
  const r = await fetch(`http://127.0.0.1:${app.h.port}${path}`, {
    headers: { 'user-agent': 'Mozilla/5.0 rueda-test', accept: 'application/pdf', ...headers },
  });
  expect(r.status).toBe(200);
  return {
    bytes: Buffer.from(await r.arrayBuffer()),
    sha: r.headers.get('x-contract-sha256'),
    disposition: r.headers.get('content-disposition'),
  };
};

describe('US-211 partie 211b — routes du contrat de location d’un trip', () => {
  it('lecture : voyageur (signable) et hôte (lecture) ; résumé des faits ; texte = texte du PDF, espagnol puis courtoisie', async () => {
    const w = await world();
    const v1 = version(1);
    w.store.addVersion(w.trip, v1.record);
    const base = `/trips/${w.trip}/contract`;
    const guest = await w.app.api.request('GET', base, { headers: w.guest });
    expect(guest.status).toBe(200);
    expect(guest.headers.get('cache-control')).toBe('no-store');
    const g = guest.json as Record<string, unknown>;
    expect(g).toMatchObject({
      tripId: w.trip,
      viewerRole: 'GUEST',
      version: 1,
      latestVersion: 1,
      courtesyLocale: 'fr',
      sha256: v1.record.sha256,
      draft: true,
      signature: null,
      signable: true,
      summary: {
        tripRef: 'K-TEST2110',
        country: COUNTRY.code,
        currency: COUNTRY.currency.code,
        currencyExponent: COUNTRY.currency.exponent,
        startLocal: '2034-03-08 10:00',
        priceTotalMinor: '12840',
        protection: { level: 'BASICA', deductibleMinor: '50000' },
        depositMinor: '25000',
        lateGraceMinutes: 29,
        cancellation: {
          freeUntilLocal: '2034-03-07 10:00',
          penaltyDays: '1',
          retainedMinor: '4280',
        },
      },
    });
    const parts = g['parts'] as {
      lang: string;
      authoritative: boolean;
      lines: { style: string; text: string }[];
    }[];
    expect(parts.map((p) => [p.lang, p.authoritative])).toEqual([
      ['es', true],
      ['fr', false],
    ]);
    // même texte que le PDF à signer : bloc de signature à « - », bandeau BROUILLON sous le titre
    const served = parts.flatMap((p) => p.lines.map((l) => ({ s: l.style, t: l.text })));
    expect(served).toHaveLength(v1.body.length);
    expect(served[1]).toEqual({ s: 'note', t: 'BORRADOR.' });
    expect(served.filter((l) => l.s === 'sig').every((l) => l.t.endsWith(': -'))).toBe(true);
    // minimisation : voyageur en prénom et initiale ; aucun champ nominatif dans le résumé
    expect(JSON.stringify(g['summary'])).not.toMatch(/María|Gómez|Ana|AB1234/);
    expect(JSON.stringify(parts)).toContain('Ana P.');

    const host = await w.app.api.request('GET', base, { headers: w.host });
    expect(host.status).toBe(200);
    expect(host.json).toMatchObject({ viewerRole: 'HOST', signable: false });
  });

  it('IDOR et saisie : tiers, trip inconnu ou mal formé ⇒ même 404 ; sans session ⇒ 401 ; version mal formée ⇒ 400, absente ⇒ 404 ; aucun contrat ⇒ 409', async () => {
    const w = await world();
    w.store.addVersion(w.trip, version(1).record);
    const api = w.app.api;
    const base = `/trips/${w.trip}/contract`;
    const notFound = { code: 'CONTRACT_NOT_FOUND', messageKey: 'common.contract.notFound' };
    for (const [path, headers] of [
      [base, w.other],
      [`/trips/${randomUUID()}/contract`, w.guest],
      ['/trips/pas-un-uuid/contract', w.guest],
      [`${base}?version=2`, w.guest],
      [`${base}/pdf`, w.other],
    ] as const) {
      const r = await api.request('GET', path, { headers });
      expect(r.status, path).toBe(404);
      expect(r.json).toEqual(notFound);
    }
    expect((await api.request('GET', base)).status).toBe(401);
    expect((await api.request('GET', `${base}/pdf`)).status).toBe(401);
    const anonymous = await api.request('POST', `${base}/sign`, { body: {} });
    expect(anonymous.status).toBe(401);
    for (const q of ['0', 'x', '10000', '1.5']) {
      const r = await api.request('GET', `${base}?version=${q}`, { headers: w.guest });
      expect(r.status, q).toBe(400);
      expect(r.json).toMatchObject({ code: 'REQUEST_INVALID' });
    }
    const pdfBad = await api.request('GET', `${base}/pdf?version=x`, { headers: w.guest });
    expect(pdfBad.status).toBe(400);
    const empty = await world();
    for (const path of [`/trips/${empty.trip}/contract`, `/trips/${empty.trip}/contract/pdf`]) {
      const r = await empty.app.api.request('GET', path, { headers: empty.guest });
      expect(r.status, path).toBe(409);
      expect(r.json).toMatchObject({ code: 'CONTRACT_NOT_GENERATED' });
    }
  });

  it('critère 2 : seconde version ⇒ la dernière est servie, l’ancienne reste consultable et n’est plus signable', async () => {
    const w = await world();
    w.store.addVersion(w.trip, version(1).record);
    w.store.addVersion(w.trip, version(2).record);
    const base = `/trips/${w.trip}/contract`;
    const latest = await w.app.api.request('GET', base, { headers: w.guest });
    expect(latest.json).toMatchObject({ version: 2, latestVersion: 2, signable: true });
    const old = await w.app.api.request('GET', `${base}?version=1`, { headers: w.guest });
    expect(old.status).toBe(200);
    expect(old.json).toMatchObject({ version: 1, latestVersion: 2, signable: false });
    const oldId = (old.json as { documentId: string; sha256: string }).documentId;
    const sha = (old.json as { sha256: string }).sha256;
    const r = await w.app.api.request('POST', `${base}/sign`, {
      headers: w.guest,
      body: { accepted: true, documentId: oldId, sha256: sha },
    });
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ code: 'CONTRACT_SUPERSEDED' });
  });

  it('critère 3 : PDF reproduit à l’identique (empreinte enregistrée) ; signé, il est vérifiable et un octet modifié ⇒ CONTRACT_HASH_MISMATCH', async () => {
    const w = await world();
    const v1 = version(1);
    const id = w.store.addVersion(w.trip, v1.record);
    const base = `/trips/${w.trip}/contract`;
    const footer = contractFooter('K-TEST2110', 1);
    // contrat à signer
    const contractPdf = await w.app.api.request('GET', `${base}/pdf`, { headers: w.guest });
    expect(contractPdf.status).toBe(200);
    expect(contractPdf.headers.get('content-type')).toBe('application/pdf');
    const unsigned = await pdfBytes(w.app, `${base}/pdf`, w.host);
    expect(unsigned.sha).toBe(v1.record.sha256);
    expect(verifyContractPdf(unsigned.bytes, v1.record.sha256)).toEqual({ ok: true });
    expect(unsigned.disposition).toBe('attachment; filename="contract-K-TEST2110-v1.pdf"');

    // empreinte présentée différente ⇒ 409, rien d'écrit
    const wrong = await w.app.api.request('POST', `${base}/sign`, {
      headers: w.guest,
      body: { accepted: true, documentId: id, sha256: 'f'.repeat(64) },
    });
    expect(wrong.status).toBe(409);
    expect(wrong.json).toMatchObject({ code: 'CONTRACT_HASH_MISMATCH' });
    expect(w.store.writes).toBe(0);

    // signature (case cochée, empreinte présentée par l'écran) ; rejeu ⇒ la signature d'origine
    const body = { accepted: true, documentId: id, sha256: v1.record.sha256 };
    const signed = await w.app.api.request('POST', `${base}/sign`, { headers: w.guest, body });
    expect(signed.status).toBe(200);
    const s = signed.json as { outcome: string; signedAt: string; sealSha256: string };
    expect(s.outcome).toBe('SIGNED');
    const again = await w.app.api.request('POST', `${base}/sign`, { headers: w.guest, body });
    expect(again.json).toEqual({ ...s, outcome: 'ALREADY_SIGNED' });
    expect(w.store.writes).toBe(1);

    const after = await w.app.api.request('GET', base, { headers: w.host });
    expect(after.json).toMatchObject({
      signable: false,
      signature: { signedAt: s.signedAt, sealSha256: s.sealSha256 },
    });
    const sigLines = (after.json as { parts: { lines: { style: string; text: string }[] }[] }).parts
      .flatMap((p) => p.lines)
      .filter((l) => l.style === 'sig');
    expect(sigLines.some((l) => l.text.includes(s.sealSha256))).toBe(true);

    // contrat signé : autres octets ; vérifiable par re-rendu ; un octet modifié ⇒ refus
    const signedPdf = await pdfBytes(w.app, `${base}/pdf`, w.guest);
    expect(signedPdf.disposition).toBe('attachment; filename="contract-K-TEST2110-v1-signed.pdf"');
    expect(signedPdf.sha).toBe(createHash('sha256').update(signedPdf.bytes).digest('hex'));
    expect(signedPdf.sha).not.toBe(v1.record.sha256);
    const full = {
      signatureId: w.store.lastSignatureId ?? '',
      signedAt: new Date(s.signedAt),
      documentSha256: v1.record.sha256,
      sealSha256: s.sealSha256,
    };
    expect(
      verifySignedContractPdf(signedPdf.bytes, v1.body, footer, RENTAL_CONTRACT_RENDERER, full),
    ).toEqual({ ok: true });
    const tampered = Buffer.from(signedPdf.bytes);
    tampered[tampered.indexOf(s.sealSha256)] =
      0x30 + ((tampered[tampered.indexOf(s.sealSha256)]! + 1) % 10);
    expect(
      verifySignedContractPdf(tampered, v1.body, footer, RENTAL_CONTRACT_RENDERER, full),
    ).toEqual({ ok: false, code: 'CONTRACT_HASH_MISMATCH' });
  });

  it('signature : corps invalide ⇒ 400, corps texte ⇒ 415, hôte ou tiers ⇒ 404, trip remis ⇒ 409 CONTRACT_NOT_SIGNABLE ; rien n’est écrit', async () => {
    const w = await world();
    const v1 = version(1);
    const id = w.store.addVersion(w.trip, v1.record);
    const path = `/trips/${w.trip}/contract/sign`;
    const ok = { accepted: true, documentId: id, sha256: v1.record.sha256 };
    for (const body of [
      { ...ok, accepted: false },
      { documentId: id, sha256: v1.record.sha256 },
      { ...ok, extra: 1 },
      { ...ok, sha256: 'F'.repeat(64) },
      { ...ok, documentId: 'x' },
      [ok],
    ]) {
      const r = await w.app.api.request('POST', path, { headers: w.guest, body });
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.json).toMatchObject({ code: 'REQUEST_INVALID' });
    }
    const text = await w.app.api.request('POST', path, textBody(w.guest));
    expect(text.status).toBe(415);
    for (const headers of [w.host, w.other]) {
      const r = await w.app.api.request('POST', path, { headers, body: ok });
      expect(r.status).toBe(404);
      expect(r.json).toMatchObject({ code: 'CONTRACT_NOT_FOUND' });
    }
    w.store.setStatus(w.trip, 'IN_PROGRESS');
    const late = await w.app.api.request('POST', path, { headers: w.guest, body: ok });
    expect(late.status).toBe(409);
    expect(late.json).toMatchObject({ code: 'CONTRACT_NOT_SIGNABLE' });
    expect(w.store.writes).toBe(0);
  });

  it('fail-closed : texte qui ne redonne plus l’empreinte ⇒ 503 sans PDF ; texte pseudonymisé ⇒ 409 ; base ou magasin indisponibles ⇒ 503', async () => {
    const w = await world();
    const v1 = version(1);
    w.store.addVersion(w.trip, { ...v1.record, sha256: 'e'.repeat(64) });
    const base = `/trips/${w.trip}/contract`;
    const integrity = await w.app.api.request('GET', `${base}/pdf`, { headers: w.guest });
    expect(integrity.status).toBe(503);
    expect(integrity.json).toMatchObject({ code: 'CONTRACT_UNAVAILABLE' });

    const e = await world();
    e.store.addVersion(e.trip, v1.record);
    e.store.erase(e.trip);
    const erased = await e.app.api.request('GET', `/trips/${e.trip}/contract/pdf`, {
      headers: e.guest,
    });
    expect(erased.status).toBe(409);
    expect(erased.json).toMatchObject({ code: 'CONTRACT_TEXT_ERASED' });
    const view = await e.app.api.request('GET', `/trips/${e.trip}/contract`, { headers: e.guest });
    expect(view.json).toMatchObject({ parts: null, sha256: v1.record.sha256 });

    w.store.failing = true;
    for (const [method, path] of [
      ['GET', base],
      ['GET', `${base}/pdf`],
      ['POST', `${base}/sign`],
    ] as const) {
      const r = await w.app.api.request(method, path, {
        headers: w.guest,
        ...(method === 'POST'
          ? { body: { accepted: true, documentId: randomUUID(), sha256: 'a'.repeat(64) } }
          : {}),
      });
      expect(r.status, path).toBe(503);
      expect(r.json).toMatchObject({ code: 'CONTRACT_UNAVAILABLE' });
    }
    const bare = await startContractApp();
    apps.push(bare);
    const none = await bare.api.request('GET', `/trips/${randomUUID()}/contract`, {
      headers: bare.cookie('voyageur'),
    });
    expect(none.status).toBe(503);
  });

  it('couverture : chaque statut déclaré pour /trips est exercé', () => {
    // remboursements d'un trip (US-224d) : leur propre suite (avl/testing/trip-refunds.contract) ;
    // liste et détail du trip du voyageur (US-214) : la leur (avl/testing/guest-trips.contract) ;
    // constancia et recherche de l'hôte (US-212) : la leur (ctr/testing/trip-constancia.contract)
    expect(
      missingCoverage(contract, '/trips', coverageOf(...apps)).filter(
        // reçu d'un trip (US-217a) : sa propre suite (avl/testing/trip-receipt.contract)
        (d) =>
          !d.includes(' /trips/{tripId}/refunds ') &&
          !d.includes(' /trips/{tripId}/receipt ') &&
          !/^GET \/trips(\/\{tripId\})? \d{3}$/.test(d) &&
          !d.includes(' /trips/{tripId}/constancia') &&
          !d.includes(' /trips/constancias/') &&
          // photos d'état du véhicule (US-303) : leur propre suite (trp/testing/trip-inspection.contract)
          !d.includes(' /trips/{tripId}/inspections/') &&
          // remise et retour (US-315) : leur propre suite (trp/testing/trip-handover.contract)
          !d.includes(' /trips/{tripId}/handover/') &&
          // messagerie par trip (US-525) : sa propre suite (msg/testing/trip-messages.contract)
          !d.includes(' /trips/{tripId}/messages ') &&
          // rendez-vous d'un trip (US-316) : leur propre suite (msg/testing/trip-meetings.contract)
          !d.includes(' /trips/{tripId}/meetings') &&
          // aide d'un trip et demande d'aide (US-310) : leur suite (sup/testing/help.contract)
          !d.includes(' /trips/{tripId}/help'),
      ),
      'statuts',
    ).toEqual([]);
  });
});
