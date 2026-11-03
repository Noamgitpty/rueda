import { describe, expect, it } from 'vitest';
import { FakeEInvoicingProvider } from '../src/e-invoicing/index.ts';
import type { SubmitFiscalDocumentRequest } from '../src/e-invoicing/index.ts';
import { clock, configuredCountries } from './support.ts';

// Deux régimes simulés (17 §5 : PAC synchrone, service de type SIFEN asynchrone par lots). Le
// régime d'un pays sera lu dans `legalEntity.invoicingRegime` (aujourd'hui nul, OQ-MK-06) : le
// test associe donc un régime FAKE à chaque pays configuré, par position.
const countries = configuredCountries();
const REGIMES = [
  { regime: 'FAKE_PAC', mode: 'SYNC' as const },
  { regime: 'FAKE_SIFEN', mode: 'ASYNC' as const },
];
const cases = countries.slice(0, 2).map((c, i) => ({ country: c, regime: REGIMES[i]! }));

function doc(
  currency: string,
  regime: string,
  over: Partial<SubmitFiscalDocumentRequest> = {},
): SubmitFiscalDocumentRequest {
  return {
    idempotencyKey: `fin:${regime}:001`,
    regime,
    issuerTaxId: 'ISSUER-1',
    receiverTaxId: null,
    number: '001-001-0000001',
    issuedAt: new Date('2026-11-03T12:00:00Z'),
    currency,
    totalMinor: 1_070n,
    taxMinor: 70n,
    lines: [
      {
        description: 'trip fee',
        quantity: 1,
        unitPriceMinor: 1_000n,
        taxMinor: 70n,
        totalMinor: 1_070n,
      },
    ],
    ...over,
  };
}

const setup = () => new FakeEInvoicingProvider({ clock: clock(), regimes: REGIMES });

describe('FakeEInvoicingProvider (PAC et SIFEN simulés)', () => {
  it.each(cases)(
    'réussite : $country.code ($country.currency) en régime $regime.regime',
    async ({ country, regime }) => {
      const fin = setup();
      const out = await fin.submit(doc(country.currency, regime.regime));
      expect(out.status).toBe('OK');
      if (out.status !== 'OK') return;
      if (regime.mode === 'SYNC') {
        expect(out.value.status).toBe('AUTHORIZED');
        expect(out.value.authorizationCode).toMatch(/^FAKE-[0-9A-F]{40}$/);
      } else {
        expect(out.value.status).toBe('PENDING');
        expect(fin.process()).toHaveLength(1);
        expect(await fin.getStatus(out.value.providerRef)).toMatchObject({
          value: { status: 'AUTHORIZED' },
        });
      }
    },
  );

  it('déterministe : le même document donne le même code d’autorisation dans deux instances', async () => {
    const a = await setup().submit(doc('XTS', 'FAKE_PAC'));
    const b = await setup().submit(doc('XTS', 'FAKE_PAC'));
    expect(
      a.status === 'OK' &&
        b.status === 'OK' &&
        a.value.authorizationCode === b.value.authorizationCode,
    ).toBe(true);
  });

  it('capacité inconnue = « non » : régime non configuré', async () => {
    const fin = setup();
    expect(fin.supportsRegime('AUTRE')).toBe(false);
    expect(await fin.submit(doc('XTS', 'AUTRE'))).toEqual({
      status: 'REFUSED',
      reason: 'UNSUPPORTED_REGIME',
    });
  });

  it('document incohérent refusé (Σ lignes ≠ total, taxe, montant négatif)', async () => {
    const fin = setup();
    expect(await fin.submit(doc('XTS', 'FAKE_PAC', { totalMinor: 1_071n }))).toEqual({
      status: 'REFUSED',
      reason: 'INVALID_DOCUMENT',
    });
    expect(await fin.submit(doc('XTS', 'FAKE_PAC', { taxMinor: 69n }))).toEqual({
      status: 'REFUSED',
      reason: 'INVALID_DOCUMENT',
    });
    expect(await fin.submit(doc('XTS', 'FAKE_PAC', { lines: [] }))).toEqual({
      status: 'REFUSED',
      reason: 'INVALID_DOCUMENT',
    });
  });

  it('doublon : même clé ⇒ même reçu rejoué ; même numéro sous une autre clé ⇒ DUPLICATE_NUMBER', async () => {
    const fin = setup();
    const first = await fin.submit(doc('XTS', 'FAKE_PAC'));
    expect(await fin.submit(doc('XTS', 'FAKE_PAC'))).toEqual({ ...first, replayed: true });
    expect(await fin.submit(doc('XTS', 'FAKE_PAC', { idempotencyKey: 'autre' }))).toEqual({
      status: 'REFUSED',
      reason: 'DUPLICATE_NUMBER',
    });
  });

  it('doublon côté fournisseur : document transmis deux fois au service fiscal', async () => {
    const fin = setup();
    fin.runtime.script.script('submit', { kind: 'DUPLICATE' });
    const out = await fin.submit(doc('XTS', 'FAKE_PAC'));
    if (out.status !== 'OK') throw new Error('reçu attendu');
    expect(fin.transmissions(out.value.providerRef)).toBe(2);
  });

  it('échec : panne, issue inconnue puis rejeu, rejet asynchrone, lot en panne puis repris', async () => {
    const fin = setup();
    fin.runtime.script.script('submit', { kind: 'UNAVAILABLE' }, { kind: 'TIMEOUT_AFTER' });
    expect(await fin.submit(doc('XTS', 'FAKE_SIFEN'))).toEqual({ status: 'UNAVAILABLE' });
    expect(await fin.submit(doc('XTS', 'FAKE_SIFEN'))).toEqual({ status: 'TIMEOUT' });
    const replay = await fin.submit(doc('XTS', 'FAKE_SIFEN'));
    expect(replay).toMatchObject({ status: 'OK', replayed: true, value: { status: 'PENDING' } });

    const second = await fin.submit(
      doc('XTS', 'FAKE_SIFEN', { idempotencyKey: 'k2', number: '001-001-0000002' }),
    );
    if (replay.status !== 'OK' || second.status !== 'OK') throw new Error('reçus attendus');
    fin.runtime.script.script(
      'process',
      { kind: 'UNAVAILABLE' },
      { kind: 'OK' },
      { kind: 'REFUSE', reason: 'REJECTED' },
    );
    expect(fin.process()).toHaveLength(1); // le premier reste PENDING (lot en panne), le second est autorisé
    const retried = fin.process();
    expect(retried).toEqual([{ ...replay.value, status: 'REJECTED', rejectionCode: 'REJECTED' }]);
  });

  it('délai simulé ; statut d’un document inconnu', async () => {
    const fin = setup();
    fin.runtime.script.script('submit', { kind: 'DELAY', ms: 8_000 });
    expect((await fin.submit(doc('XTS', 'FAKE_PAC'))).status).toBe('OK');
    expect(fin.runtime.clock.now().toISOString()).toBe('2026-11-03T12:00:08.000Z');
    expect(await fin.getStatus('fk_fdoc_999999')).toEqual({
      status: 'REFUSED',
      reason: 'UNKNOWN_DOCUMENT',
    });
  });
});
