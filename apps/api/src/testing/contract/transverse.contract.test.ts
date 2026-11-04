/**
 * US-038 — réponses TRANSVERSES du contrat (`x-rueda-transverse-responses`) sur l'application
 * réelle : défi anti-robot (403), corps trop gros (413), limite de débit globale (429 avec
 * `Retry-After`) et erreur interne (500 au corps stable, sans détail). Chacune est observée au
 * moins une fois et validée contre l'OpenAPI.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AbuseGuard,
  MemoryRateCounterStore,
  RateKeyHasher,
  UnavailableBotChallenge,
} from '../../modules/risk/index.js';
import { CountryConfigService } from '../../modules/cfg/index.js';
import { closeContractApps, contract, startContractApp } from './support.js';
import type { ContractApp } from './support.js';

describe('contrat HTTP — réponses transverses', () => {
  const apps: ContractApp[] = [];
  afterAll(closeContractApps);

  it('403 BOT_CHALLENGE_REQUIRED : deux signaux anti-robot, sans jeton de défi', async () => {
    const a = await startContractApp({ risk: { rhythm: { record: () => true } } });
    apps.push(a);
    const r = await a.api.request('GET', '/brand', { headers: { 'user-agent': '' } });
    expect(r.json).toMatchObject({ code: 'BOT_CHALLENGE_REQUIRED' });
  });

  it('413 PAYLOAD_TOO_LARGE : corps JSON au-delà de 100 Kio, aucun écho', async () => {
    const a = await startContractApp();
    apps.push(a);
    const big = JSON.stringify({ email: 'x@example.test', pad: 'x'.repeat(110 * 1024) });
    const r = await a.api.request('POST', '/auth/login', { raw: big });
    expect(r.status).toBe(413);
    expect(r.text).not.toContain('example.test');
  });

  it('429 RATE_LIMITED : limite globale par IP, Retry-After', async () => {
    const config = new CountryConfigService().config;
    const a = await startContractApp({
      risk: {
        guard: new AbuseGuard({
          store: new MemoryRateCounterStore(),
          hasher: new RateKeyHasher(randomBytes(32)),
          policy: { limit: () => 1, isCountry: (c) => config.countries.has(c) },
        }),
        challenge: new UnavailableBotChallenge(),
      },
    });
    apps.push(a);
    const statuses: number[] = [];
    for (let i = 0; i < 3; i += 1) statuses.push((await a.api.request('GET', '/brand')).status);
    expect(statuses).toContain(429);
  });

  it('500 INTERNAL_ERROR : adaptateur en échec, corps stable sans détail', async () => {
    const a = await startContractApp();
    apps.push(a);
    // le magasin du staff du harnais n'a pas `auditRead` : l'appel rejette
    const r = await a.api.request('GET', '/staff/audit', { headers: a.cookie('staff') });
    expect(r.status).toBe(500);
    expect(r.json).toEqual({ code: 'INTERNAL_ERROR', messageKey: 'common.auth.requestInvalid' });
    expect(r.text).not.toContain('harnais');
  });

  it('couverture : chaque réponse transverse est observée', () => {
    const seen = new Set(apps.flatMap((a) => [...a.api.coveredTransverse]));
    const declared = Object.keys(contract.document['x-rueda-transverse-responses'] ?? {});
    expect(declared.length).toBeGreaterThan(0);
    expect(declared.filter((s) => !seen.has(s))).toEqual([]);
  });
});
