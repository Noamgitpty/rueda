/**
 * US-707 — tests de contrat des routes `/host/accounts/{orgId}/payout-account` sur l'application
 * RÉELLE (ApiModule, harnais d'US-043), le FAKE du magasin (sans base), le FAKE du coffre
 * (enveloppe réelle de `@rueda/db/audit`) et le FAKE du PSP : chaque réponse est confrontée à
 * `apps/api/openapi/openapi.json`. Attendus : 19 US-707 et 16 PYO-001 (compte au nom de l'hôte ;
 * titulaire ou cédula / RUC discordant ⇒ refus ; changement ⇒ versements retenus 48 h ; co-hôte
 * ou autre hôte ⇒ 404 ; numéro chiffré, jamais renvoyé ni journalisé). Les règles elles-mêmes sont
 * prouvées sur PostgreSQL (packages/db/test/l0/l0-us707-payout-account.test.ts), en PA et en PY.
 * Rails et types de numéro : données CFG, jamais des constantes. Données fictives.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { CountryConfigService } from '../../cfg/index.js';
import {
  closeContractApps,
  contract,
  COUNTRIES,
  coverageOf,
  startContractApp,
  textBody,
} from '../../../testing/contract/support.js';
import type { ContractApp } from '../../../testing/contract/support.js';
import { missingCoverage } from '../../../testing/openapi-contract.js';
import { FakePayoutAccountStore } from './fake-payout-account-store.js';
import { FakePayoutAccountVault } from './fake-payout-account-vault.js';
import { FakePayoutAccountVerifier } from './fake-payout-account-verifier.js';

const JSON_HEADERS = { 'content-type': 'application/json' };
const config = new CountryConfigService().config;
type Rail = { accountPattern: string; institutions?: string[]; institutionPattern?: string };
const railsOf = (country: string): Record<string, Rail> =>
  (config.values.find((v) => v.key === 'payout_account_rails' && v.country === country)?.value ??
    {}) as unknown as Record<string, Rail>;
const TAX_ID = '1234567-8';

interface World {
  readonly app: ContractApp;
  readonly store: FakePayoutAccountStore;
  readonly vault: FakePayoutAccountVault;
  readonly psp: FakePayoutAccountVerifier;
  readonly headers: Record<string, string>;
  readonly org: string;
  readonly base: string;
  readonly country: string;
}

const apps: ContractApp[] = [];

async function world(
  country: string,
  options: { vault?: boolean; psp?: boolean; tax?: boolean; kycApproved?: boolean } = {},
): Promise<World> {
  const store = new FakePayoutAccountStore();
  const vault = new FakePayoutAccountVault();
  vault.available = options.vault !== false;
  const psp = new FakePayoutAccountVerifier();
  const app = await startContractApp({
    pyo: {
      store,
      vault,
      verifier: options.psp === false ? null : psp,
      log: { warn: () => undefined },
    },
  });
  apps.push(app);
  const org = randomUUID();
  const entry = config.countries.get(country);
  store.addHost(app.hash('voyageur'), org, {
    country,
    currency: entry?.currency.code ?? '',
    rails: railsOf(country),
    kycApproved: options.kycApproved !== false,
    tax:
      options.tax === false
        ? null
        : { kind: entry?.hostTaxIdKinds[0] ?? '', envelope: vault.sealTaxId(org, TAX_ID) },
  });
  return {
    app,
    store,
    vault,
    psp,
    headers: { ...app.cookie('voyageur'), ...JSON_HEADERS },
    org,
    base: `/host/accounts/${org}/payout-account`,
    country,
  };
}

/** Corps conforme au premier rail du pays (numéro tiré du motif : chiffres seulement). */
function bodyFor(country: string, over: Record<string, unknown> = {}) {
  const [kind, rail] = Object.entries(railsOf(country))[0] ?? ['BANK_ACCOUNT', undefined];
  const accountNumber = rail?.accountPattern.startsWith('^09') ? '0981234567' : '000123456789';
  return {
    kind,
    institution: rail?.institutions?.[0] ?? '0123',
    accountNumber,
    holderGivenNames: 'Ana María',
    holderSurnames: 'Pérez Gómez',
    holderTaxId: TAX_ID,
    ...over,
  };
}

afterAll(async () => {
  await closeContractApps();
});

describe.each(COUNTRIES)('US-707 — compte de versement de l’hôte (%s)', (country) => {
  it('GET : état sans compte, rails et type de numéro du pays ; aucun numéro', async () => {
    const w = await world(country);
    const r = await w.app.api.request('GET', w.base, { headers: w.headers });
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.json).toMatchObject({
      code: 'PAYOUT_ACCOUNT_STATE',
      country,
      account: null,
      taxKind: config.countries.get(country)?.hostTaxIdKinds[0],
    });
    const kinds = (r.json as { rails: { kind: string }[] }).rails.map((x) => x.kind);
    expect(kinds).toEqual(Object.keys(railsOf(country)));
  });

  it('critère 1 : compte au nom de l’hôte ⇒ vérifié par le PSP, masqué aux 4 derniers caractères ; numéro chiffré, jamais renvoyé ni journalisé', async () => {
    const w = await world(country);
    const body = bodyFor(country);
    const r = await w.app.api.request('POST', w.base, { headers: w.headers, body });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      code: 'PAYOUT_ACCOUNT_SAVED',
      account: { status: 'VERIFIED', last4: body.accountNumber.slice(-4), holdUntil: null },
    });
    const out = JSON.stringify(r.json) + w.app.h.logs.join('\n');
    expect(out).not.toContain(body.accountNumber);
    expect(out).not.toContain(TAX_ID);
    const [row] = w.store.rowsOf(w.org);
    expect(row?.envelope.includes(Buffer.from(body.accountNumber))).toBe(false);
    expect(w.vault.openAccount(w.org, row?.envelope as Buffer)).toBe(body.accountNumber);
    // le PSP reçoit la clé d'idempotence du compte et la pièce du titulaire
    expect(w.psp.requests[0]).toMatchObject({
      idempotencyKey: `payout-account:${row?.id ?? ''}`,
      hostReference: w.org,
      holderTaxId: TAX_ID,
    });
  });

  it('critère 1 : titulaire ou pièce fiscale discordants ⇒ 422 PAYOUT_HOLDER_MISMATCH, rien n’est écrit ; PSP qui refuse ⇒ 422, compte refusé', async () => {
    const w = await world(country);
    for (const over of [
      { holderGivenNames: 'Otro', holderSurnames: 'Titular' },
      { holderTaxId: '7654321-0' },
    ]) {
      const r = await w.app.api.request('POST', w.base, {
        headers: w.headers,
        body: bodyFor(country, over),
      });
      expect(r.status, JSON.stringify(over)).toBe(422);
      expect(r.json).toMatchObject({ code: 'PAYOUT_HOLDER_MISMATCH' });
    }
    expect(w.store.rowsOf(w.org)).toHaveLength(0);
    expect(w.psp.requests).toHaveLength(0);
    const body = bodyFor(country);
    w.psp.reject(body.accountNumber, 'HOLDER_MISMATCH');
    const r = await w.app.api.request('POST', w.base, { headers: w.headers, body });
    expect(r.status).toBe(422);
    expect(r.json).toMatchObject({ code: 'PAYOUT_HOLDER_MISMATCH' });
    const s = await w.app.api.request('GET', w.base, { headers: w.headers });
    expect(s.json).toMatchObject({
      account: { status: 'REJECTED', rejectReason: 'HOLDER_MISMATCH' },
    });
  });

  it('critère 2 : changement de compte ⇒ retenue des versements (holdUntil à 48 h)', async () => {
    const w = await world(country);
    expect(
      (await w.app.api.request('POST', w.base, { headers: w.headers, body: bodyFor(country) }))
        .status,
    ).toBe(200);
    const before = Date.now();
    const r = await w.app.api.request('POST', w.base, {
      headers: w.headers,
      body: bodyFor(country, { accountNumber: '000987654321' }),
    });
    expect(r.status).toBe(200);
    const hold = Date.parse((r.json as { account: { holdUntil: string } }).account.holdUntil);
    expect(hold).toBeGreaterThanOrEqual(before + 48 * 3_600_000 - 60_000);
    expect(w.store.rowsOf(w.org).map((x) => x.status)).toEqual(['REPLACED', 'VERIFIED']);
  });

  it('critère 3 : co-hôte, autre hôte, compte inconnu ou mal formé ⇒ 404 ; permission absente ⇒ 403 ; 401 sans session', async () => {
    const w = await world(country);
    expect((await w.app.api.request('GET', w.base)).status).toBe(401);
    expect((await w.app.api.request('POST', w.base, { body: bodyFor(country) })).status).toBe(401);
    const other = randomUUID();
    w.store.addHost('autre-titulaire', other, { country, currency: '', rails: railsOf(country) });
    for (const org of [other, randomUUID(), 'pas-un-uuid']) {
      const base = `/host/accounts/${org}/payout-account`;
      const get = await w.app.api.request('GET', base, { headers: w.headers });
      expect(get.status).toBe(404);
      expect(get.json).toMatchObject({ code: 'HOST_ACCOUNT_NOT_FOUND' });
      const post = await w.app.api.request('POST', base, {
        headers: w.headers,
        body: bodyFor(country),
      });
      expect(post.status).toBe(404);
    }
    expect(w.store.rowsOf(other)).toHaveLength(0);
    const h = w.store.host(w.org);
    if (h === undefined) throw new Error('hôte absent');
    h.permission = false;
    for (const method of ['GET', 'POST'] as const) {
      const r = await w.app.api.request(method, w.base, {
        headers: w.headers,
        ...(method === 'POST' ? { body: bodyFor(country) } : {}),
      });
      expect(r.status).toBe(403);
      expect(r.json).toMatchObject({ code: 'PAYOUT_MANAGE_FORBIDDEN' });
    }
  });

  it('refus jugés en base ou par la configuration : 409 sans numéro fiscal, 403 KYC, 422 rail ou numéro, 400 corps, 415 texte', async () => {
    const noTax = await world(country, { tax: false });
    const t = await noTax.app.api.request('POST', noTax.base, {
      headers: noTax.headers,
      body: bodyFor(country),
    });
    expect(t.status).toBe(409);
    expect(t.json).toMatchObject({ code: 'HOST_TAX_ID_REQUIRED' });
    const noKyc = await world(country, { kycApproved: false });
    const k = await noKyc.app.api.request('POST', noKyc.base, {
      headers: noKyc.headers,
      body: bodyFor(country),
    });
    expect(k.status).toBe(403);
    expect(k.json).toMatchObject({ code: 'HOST_KYC_REQUIRED' });

    const w = await world(country);
    const post = (body: unknown) => w.app.api.request('POST', w.base, { headers: w.headers, body });
    const configured = Object.keys(railsOf(country));
    const absent = ['BANK_ACCOUNT', 'WALLET'].find((x) => !configured.includes(x));
    if (absent !== undefined) {
      const r = await post(bodyFor(country, { kind: absent }));
      expect(r.status).toBe(422);
      expect(r.json).toMatchObject({ code: 'PAYOUT_RAIL_UNSUPPORTED' });
    }
    for (const over of [{ accountNumber: '12' }, { institution: '!!' }]) {
      const r = await post(bodyFor(country, over));
      expect(r.status, JSON.stringify(over)).toBe(422);
      expect(r.json).toMatchObject({ code: 'PAYOUT_ACCOUNT_INVALID' });
    }
    for (const body of [
      bodyFor(country, { extra: true }),
      bodyFor(country, { kind: 'CASH' }),
      bodyFor(country, { holderSurnames: '  ' }),
      [],
    ]) {
      const r = await post(body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.json).toMatchObject({ code: 'REQUEST_INVALID' });
    }
    expect(
      (await w.app.api.request('POST', w.base, textBody(w.app.cookie('voyageur')))).status,
    ).toBe(415);
    expect(w.store.rowsOf(w.org)).toHaveLength(0);
  });

  it('fail-closed : sans coffre ⇒ 503, rien n’est écrit ; sans PSP ⇒ compte en vérification ; base indisponible ⇒ 503 ; rails absents ⇒ 503', async () => {
    const noVault = await world(country, { vault: false });
    const v = await noVault.app.api.request('POST', noVault.base, {
      headers: noVault.headers,
      body: bodyFor(country),
    });
    expect(v.status).toBe(503);
    expect(v.json).toMatchObject({ code: 'PAYOUT_VAULT_UNAVAILABLE' });
    expect(noVault.store.rowsOf(noVault.org)).toHaveLength(0);

    const noPsp = await world(country, { psp: false });
    const p = await noPsp.app.api.request('POST', noPsp.base, {
      headers: noPsp.headers,
      body: bodyFor(country),
    });
    expect(p.status).toBe(200);
    expect(p.json).toMatchObject({ account: { status: 'PENDING' } });

    const down = await world(country);
    down.psp.available = false;
    const d = await down.app.api.request('POST', down.base, {
      headers: down.headers,
      body: bodyFor(country),
    });
    expect(d.json).toMatchObject({ account: { status: 'PENDING' } });
    down.store.failing = true;
    for (const method of ['GET', 'POST'] as const) {
      const r = await down.app.api.request(method, down.base, {
        headers: down.headers,
        ...(method === 'POST' ? { body: bodyFor(country) } : {}),
      });
      expect(r.status).toBe(503);
      expect(r.json).toMatchObject({ code: 'PAYOUT_ACCOUNT_UNAVAILABLE' });
    }

    const closed = new FakePayoutAccountStore();
    const app = await startContractApp({
      pyo: {
        store: closed,
        vault: new FakePayoutAccountVault(),
        verifier: null,
        log: { warn: () => undefined },
      },
    });
    apps.push(app);
    const org = randomUUID();
    closed.addHost(app.hash('voyageur'), org, { country, currency: '', rails: null });
    const r = await app.api.request('POST', `/host/accounts/${org}/payout-account`, {
      headers: { ...app.cookie('voyageur'), ...JSON_HEADERS },
      body: bodyFor(country),
    });
    expect(r.status).toBe(503);
    expect(r.json).toMatchObject({ code: 'HOST_PAYOUT_RAIL_UNAVAILABLE' });
  });
});

describe('US-707 — couverture du contrat', () => {
  it('chaque statut déclaré pour /host/accounts/{orgId}/payout-account est exercé', () => {
    expect(
      missingCoverage(contract, '/host/accounts/{orgId}/payout-account', coverageOf(...apps)),
    ).toEqual([]);
  });
});
