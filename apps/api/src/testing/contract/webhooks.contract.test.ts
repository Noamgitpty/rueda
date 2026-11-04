/**
 * US-038 — contrat de POST /webhooks/{provider}/{publicWebhookId} (US-020 ; 17 §4.4) sur
 * l'application réelle : 200, 401, 404, 503, réponses sans corps et jamais mises en cache. Le
 * vérificateur de signature est un double du port (la vraie vérification FAKE est prouvée par
 * `webhook-http.test.ts`) ; le magasin rend l'issue de la base.
 */
import { afterAll, describe, expect, it } from 'vitest';
import type { PayWebhookOptions } from '../../modules/pay/index.js';
import { missingCoverage } from '../openapi-contract.js';
import { closeContractApps, contract, startContractApp } from './support.js';
import type { ContractApp } from './support.js';

const KNOWN = 'wh_contract_0123456789';
const NO_SECRET = 'wh_contract_nosecret01';
const SIGNATURE = 'x-test-signature';

const pay: Partial<PayWebhookOptions> = {
  registry: {
    get: (provider) =>
      provider === 'STUB'
        ? {
            provider: 'STUB',
            verifyAndParseWebhook: (_raw, headers) => ({
              signatureValid: headers[SIGNATURE] === 'valide',
              signedAt: new Date('2031-07-01T08:00:00.000Z'),
              providerEventId: 'evt_1',
              events: [],
            }),
          }
        : undefined,
  },
  store: {
    resolveAccount: (_provider, publicWebhookId) =>
      Promise.resolve(
        publicWebhookId === KNOWN || publicWebhookId === NO_SECRET
          ? {
              accountId: 'acc-contract',
              provider: 'STUB',
              publicWebhookId,
              webhookSecretRef: publicWebhookId === KNOWN ? 'vault:psp/stub' : null,
            }
          : null,
      ),
    receive: (input) =>
      Promise.resolve({
        outcome: input.signatureValid ? 'RECEIVED' : 'REJECTED_SIGNATURE',
        inboxId: null,
      }),
  },
  secrets: { resolve: () => Promise.resolve(new TextEncoder().encode('secret-de-test')) },
};

describe('contrat HTTP — /webhooks', () => {
  let a: ContractApp;
  afterAll(closeContractApps);

  it('200 signé, 401 signature invalide, 404 inconnu, 503 secret introuvable', async () => {
    a = await startContractApp({ pay });
    const post = (provider: string, id: string, signature: string) =>
      a.api.request('POST', `/webhooks/${provider}/${id}`, {
        raw: '{"type":"payment.captured"}',
        headers: { [SIGNATURE]: signature },
      });
    const ok = await post('stub', KNOWN, 'valide');
    expect(ok.status).toBe(200);
    expect(ok.text).toBe('');
    expect((await post('stub', KNOWN, 'fausse')).status).toBe(401);
    expect((await post('autre', KNOWN, 'valide')).status).toBe(404);
    expect((await post('stub', 'wh_inconnu_0123456789', 'valide')).status).toBe(404);
    expect((await post('stub', NO_SECRET, 'valide')).status).toBe(503);
  });

  it('couverture : chaque statut déclaré pour /webhooks est exercé', () => {
    expect(missingCoverage(contract, '/webhooks', a.api.covered)).toEqual([]);
  });
});
