/**
 * US-310 — contrat des routes de l'aide et de l'urgence (`GET /help`, `GET /trips/{tripId}/help`,
 * `POST /trips/{tripId}/help-requests`, `GET /console/help-requests`) sur l'application RÉELLE
 * (ApiModule, gardes globaux, durcissement HTTP ; harnais d'US-043) avec un FAKE du magasin :
 * chaque réponse est confrontée à `openapi.json`, chaque statut déclaré est exercé.
 *
 * Attendus tirés de 19 US-310 (numéros lus de la configuration pays, jamais en dur ; absents ⇒
 * renvoi à l'aide dans l'appli sans numéro inventé ; aucun téléphone de l'autre partie), de 16
 * SUP-004 (motif du ticket, hors plage), de 10b S17 (urgences et autorité de circulation du pays)
 * et de 17 §2.3 point 5 (IDOR : même réponse 404), jamais du code testé. La personne, son rôle et
 * le hors plage sont jugés en base et prouvés sur PostgreSQL
 * (`packages/db/test/l0/l0-us310-help-request.test.ts`) ; ici, le FAKE rend ce que rendrait la base.
 */
import { randomUUID } from 'node:crypto';
import { CATALOGS } from '@rueda/i18n';
import { afterAll, describe, expect, it } from 'vitest';
import { CountryConfigService } from '../../cfg/index.js';
import {
  closeContractApps,
  contract,
  COUNTRIES,
  coverageOf,
  FIRST_COUNTRY,
  startContractApp,
  textBody,
} from '../../../testing/contract/support.js';
import type { ContractApp } from '../../../testing/contract/support.js';
import { missingCoverage } from '../../../testing/openapi-contract.js';
import { HelpStoreError } from '../index.js';
import type {
  HelpContextRow,
  HelpHours,
  HelpOpenRow,
  HelpStaffResult,
  HelpStore,
  HelpTopic,
} from '../index.js';

const apps: ContractApp[] = [];
afterAll(closeContractApps);

const config = new CountryConfigService().config;

interface Call {
  readonly proofHex: string;
  readonly tripId: string;
  readonly topic?: HelpTopic;
  readonly hours?: HelpHours | null;
  readonly requestId?: string;
}

/** Magasin en mémoire : ce que la base rendrait à la session (empreinte). */
class FakeHelpStore implements HelpStore {
  /** trip → (empreinte → rôle) ; pays du trip. */
  readonly trips = new Map<string, { country: string; parties: Map<string, 'GUEST' | 'HOST'> }>();
  readonly calls: Call[] = [];
  next: Partial<HelpOpenRow> = {};
  staff: HelpStaffResult = { outcome: 'OK', body: { items: [], m6: [], windowDays: 28 } };
  failing: 'context' | 'open' | 'staff' | 'invalid' | null = null;

  context(proof: Buffer, tripId: string): Promise<HelpContextRow> {
    if (this.failing === 'context') return Promise.reject(new Error('base indisponible'));
    this.calls.push({ proofHex: proof.toString('hex'), tripId });
    const t = this.trips.get(tripId);
    const role = t?.parties.get(proof.toString('hex'));
    if (t === undefined || role === undefined) {
      return Promise.resolve({ outcome: 'NOT_FOUND', role: null, country: null });
    }
    return Promise.resolve({ outcome: 'DONE', role, country: t.country });
  }

  async open(
    proof: Buffer,
    requestId: string,
    tripId: string,
    topic: HelpTopic,
    hours: HelpHours | null,
  ): Promise<HelpOpenRow> {
    if (this.failing === 'open') throw new Error('base indisponible');
    if (this.failing === 'invalid') throw new HelpStoreError('22023');
    this.calls.push({ proofHex: proof.toString('hex'), tripId, topic, hours, requestId });
    const ctx = await this.context(proof, tripId);
    if (ctx.outcome !== 'DONE') {
      return { outcome: 'NOT_FOUND', caseId: null, offHours: null, role: null, country: null };
    }
    return {
      outcome: 'OPENED',
      caseId: requestId,
      offHours: hours === null,
      role: ctx.role,
      country: ctx.country,
      ...this.next,
    };
  }

  staffRequests() {
    if (this.failing === 'staff') return Promise.reject(new Error('base indisponible'));
    return Promise.resolve(this.staff);
  }
}

async function world(): Promise<{ app: ContractApp; store: FakeHelpStore }> {
  const store = new FakeHelpStore();
  const app = await startContractApp({ sup: { help: store } });
  apps.push(app);
  return { app, store };
}

describe('US-310 — aide et urgence (S17)', () => {
  it.each(COUNTRIES)(
    'GET /help?country=%s : urgences, autorité de circulation, numéros et plage lus de la configuration pays',
    async (country) => {
      const w = await world();
      const r = await w.app.api.request('GET', `/help?country=${country}`);
      expect(r.status).toBe(200);
      expect(r.headers.get('cache-control')).toMatch(/^public, max-age=\d+$/);
      const entry = config.countries.get(country)!;
      expect(r.json).toEqual({
        countries: [
          {
            country,
            names: entry.names,
            emergencyNumber: entry.help.emergencyNumber,
            trafficAuthority: {
              id: entry.help.trafficAuthority,
              messageKey: `common.help.authority.${entry.help.trafficAuthority}`,
            },
            // donnée du fondateur absente du dépôt (ADR-174) : null, jamais un numéro inventé
            supportPhone: entry.assistanceContacts?.supportPhone ?? null,
            insurerAssistancePhone: entry.assistanceContacts?.insurerAssistancePhone ?? null,
            // SUP-020 : aucune plage publiée sans planning validé
            supportHours:
              entry.help.supportHours === null
                ? null
                : { from: entry.help.supportHours.from, to: entry.help.supportHours.to },
          },
        ],
      });
      // la référence du planning reste interne ; aucun interrupteur exposé
      expect(r.text).not.toMatch(/staffingPlanRef|enabled|switch/i);
    },
  );

  it('GET /help sans pays : chaque pays configuré ; 400 pour un pays mal formé ou non configuré', async () => {
    const w = await world();
    const all = await w.app.api.request('GET', '/help');
    expect(all.status).toBe(200);
    expect(
      (all.json as { countries: { country: string }[] }).countries.map((c) => c.country),
    ).toEqual([...COUNTRIES].sort());
    for (const q of ['?country=ZZ', `?country=${FIRST_COUNTRY.toLowerCase()}`, '?country=x1']) {
      const r = await w.app.api.request('GET', `/help${q}`);
      expect(r.status, q).toBe(400);
      expect(r.json).toMatchObject({ code: 'REQUEST_INVALID' });
    }
  });

  it('autorité de circulation de chaque pays : texte non vide en es, en, fr et pt', () => {
    for (const entry of config.countries.values()) {
      const key = `common.help.authority.${entry.help.trafficAuthority}`;
      for (const language of ['es', 'en', 'fr', 'pt'] as const) {
        const m = (CATALOGS[language].messages as Readonly<Record<string, unknown>>)[key];
        expect(typeof m === 'string' && m.trim().length > 0, `${language} ${key}`).toBe(true);
      }
    }
  });
});

describe('US-310 — aide d’un trip et demande d’aide', () => {
  it('GET /trips/{tripId}/help : voyageur et hôte du trip reçoivent leur rôle et l’aide de SON pays ; autrui et trip inconnu : 404 ; sans session : 401', async () => {
    const w = await world();
    const trip = randomUUID();
    w.store.trips.set(trip, {
      country: FIRST_COUNTRY,
      parties: new Map([[w.app.hash('voyageur'), 'GUEST']]),
    });
    const r = await w.app.api.request('GET', `/trips/${trip.toUpperCase()}/help`, {
      headers: w.app.cookie('voyageur'),
    });
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.json).toMatchObject({
      tripId: trip,
      role: 'GUEST',
      help: { country: FIRST_COUNTRY },
    });
    // la session de staff n'est pas une partie du trip : même réponse qu'un trip inconnu
    const other = await w.app.api.request('GET', `/trips/${trip}/help`, {
      headers: w.app.cookie('staff'),
    });
    expect(other.status).toBe(404);
    expect(other.json).toMatchObject({ code: 'TRIP_NOT_FOUND' });
    const unknown = await w.app.api.request('GET', `/trips/${randomUUID()}/help`, {
      headers: w.app.cookie('voyageur'),
    });
    expect(unknown.json).toEqual(other.json);
    const malformed = await w.app.api.request('GET', '/trips/x/help', {
      headers: w.app.cookie('voyageur'),
    });
    expect(malformed.status).toBe(404);
    expect((await w.app.api.request('GET', `/trips/${trip}/help`)).status).toBe(401);
    w.store.failing = 'context';
    const down = await w.app.api.request('GET', `/trips/${trip}/help`, {
      headers: w.app.cookie('voyageur'),
    });
    expect(down.status).toBe(503);
    expect(down.json).toMatchObject({ code: 'HELP_UNAVAILABLE' });
  });

  it('POST /trips/{tripId}/help-requests : motif fermé, plage du pays du trip transmise à la base, 201 puis 200 au rejeu ou pour une demande vivante', async () => {
    const w = await world();
    const trip = randomUUID();
    const country = COUNTRIES[COUNTRIES.length - 1] as string;
    w.store.trips.set(trip, {
      country,
      parties: new Map([[w.app.hash('voyageur'), 'HOST']]),
    });
    const requestId = randomUUID();
    const r = await w.app.api.request('POST', `/trips/${trip}/help-requests`, {
      headers: w.app.cookie('voyageur'),
      body: { requestId, topic: 'BREAKDOWN' },
    });
    expect(r.status).toBe(201);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.json).toEqual({
      caseId: requestId,
      outcome: 'OPENED',
      offHours: config.countries.get(country)!.help.supportHours === null,
    });
    const sent = w.store.calls.find((c) => c.topic !== undefined)!;
    expect(sent).toMatchObject({ tripId: trip, topic: 'BREAKDOWN', requestId });
    const hours = config.countries.get(country)!.help.supportHours;
    expect(sent.hours).toEqual(hours === null ? null : { from: hours.from, to: hours.to });

    for (const outcome of ['DUPLICATE', 'EXISTS'] as const) {
      w.store.next = { outcome };
      const again = await w.app.api.request('POST', `/trips/${trip}/help-requests`, {
        headers: w.app.cookie('voyageur'),
        body: { requestId, topic: 'BREAKDOWN' },
      });
      expect(again.status, outcome).toBe(200);
      expect(again.json).toMatchObject({ outcome });
    }
  });

  it('POST : corps invalide 400 (rien n’atteint la base) ; trip d’autrui 404 ; 401 ; 415 ; 503', async () => {
    const w = await world();
    const trip = randomUUID();
    w.store.trips.set(trip, {
      country: FIRST_COUNTRY,
      parties: new Map([[w.app.hash('voyageur'), 'GUEST']]),
    });
    const path = `/trips/${trip}/help-requests`;
    const headers = w.app.cookie('voyageur');
    for (const body of [
      { requestId: randomUUID(), topic: 'CALL_ME' },
      { requestId: 'x', topic: 'OTHER' },
      { topic: 'OTHER' },
      // aucun texte libre ni téléphone accepté (minimisation, ADR-182)
      { requestId: randomUUID(), topic: 'OTHER', message: 'llámame al +50760000000' },
      { requestId: randomUUID(), topic: 'OTHER', phone: '+50760000000' },
    ]) {
      const r = await w.app.api.request('POST', path, { headers, body });
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.json).toMatchObject({ code: 'REQUEST_INVALID' });
    }
    expect(w.store.calls).toEqual([]);
    // la base refuse la donnée (22023) : 400
    w.store.failing = 'invalid';
    expect(
      (
        await w.app.api.request('POST', path, {
          headers,
          body: { requestId: randomUUID(), topic: 'OTHER' },
        })
      ).status,
    ).toBe(400);
    w.store.failing = null;
    const foreign = await w.app.api.request('POST', path, {
      headers: w.app.cookie('staff'),
      body: { requestId: randomUUID(), topic: 'OTHER' },
    });
    expect(foreign.status).toBe(404);
    expect(foreign.json).toMatchObject({ code: 'TRIP_NOT_FOUND' });
    expect(
      (await w.app.api.request('POST', path, { body: { requestId: randomUUID(), topic: 'OTHER' } }))
        .status,
    ).toBe(401);
    expect((await w.app.api.request('POST', path, textBody(headers))).status).toBe(415);
    w.store.failing = 'open';
    const down = await w.app.api.request('POST', path, {
      headers,
      body: { requestId: randomUUID(), topic: 'ACCIDENT' },
    });
    expect(down.status).toBe(503);
    expect(down.json).toMatchObject({ code: 'HELP_UNAVAILABLE' });
  });
});

describe('US-310 — console : demandes d’aide et M6', () => {
  it('GET /console/help-requests : 200 pour le staff élevé ; 403 sans TOTP ou sans rôle ; 401 ; 400', async () => {
    const w = await world();
    const caseId = randomUUID();
    w.store.staff = {
      outcome: 'OK',
      body: {
        items: [
          {
            caseId,
            tripId: randomUUID(),
            country: FIRST_COUNTRY,
            topic: 'ACCIDENT',
            requesterRole: 'GUEST',
            priority: 'URGENT',
            status: 'OPEN',
            offHours: true,
            createdAt: '2026-11-19T10:00:00+00:00',
            firstResponseAt: null,
            assigned: false,
            assignedToMe: false,
          },
        ],
        m6: [
          { country: FIRST_COUNTRY, opened: 3, answered: 2, medianSeconds: 600, p90Seconds: 900 },
        ],
        windowDays: 28,
      },
    };
    const ok = await w.app.api.request('GET', `/console/help-requests?country=${FIRST_COUNTRY}`, {
      headers: w.app.cookie('staff'),
    });
    expect(ok.status).toBe(200);
    const body = ok.json as { items: { createdAt: string; caseId: string }[]; m6: unknown[] };
    expect(body.items[0]?.caseId).toBe(caseId);
    // horodatage de la base rendu en ISO 8601 UTC
    expect(body.items[0]?.createdAt).toBe('2026-11-19T10:00:00.000Z');
    expect(body.m6).toHaveLength(1);
    expect(
      (
        await w.app.api.request('GET', '/console/help-requests', {
          headers: w.app.cookie('staff_sans_mfa'),
        })
      ).status,
    ).toBe(403);
    w.store.staff = { outcome: 'FORBIDDEN', body: null };
    const refused = await w.app.api.request('GET', '/console/help-requests', {
      headers: w.app.cookie('staff'),
    });
    expect(refused.status).toBe(403);
    expect(refused.json).toMatchObject({ code: 'FORBIDDEN' });
    expect((await w.app.api.request('GET', '/console/help-requests')).status).toBe(401);
    for (const q of [`?country=${FIRST_COUNTRY.toLowerCase()}`, '?limit=abc', '?limit=5000']) {
      const r = await w.app.api.request('GET', `/console/help-requests${q}`, {
        headers: w.app.cookie('staff'),
      });
      expect(r.status, q).toBe(400);
    }
  });
});

describe('US-310 — couverture du contrat', () => {
  it('couverture : chaque statut déclaré pour /help est exercé', () => {
    expect(missingCoverage(contract, '/help', coverageOf(...apps))).toEqual([]);
  });
  it('couverture : chaque statut déclaré pour /trips/{tripId}/help est exercé', () => {
    expect(
      missingCoverage(contract, '/trips', coverageOf(...apps)).filter((d) =>
        d.includes(' /trips/{tripId}/help'),
      ),
    ).toEqual([]);
  });
  it('couverture : chaque statut déclaré pour /console/help-requests est exercé', () => {
    // 429 (limite de débit de la console) : exercé par la suite /console sur chaque route /console
    expect(
      missingCoverage(contract, '/console/help-requests', coverageOf(...apps)).filter(
        (d) => !d.endsWith(' 429'),
      ),
    ).toEqual([]);
  });
});
