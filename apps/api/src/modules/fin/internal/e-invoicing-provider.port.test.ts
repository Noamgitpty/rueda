/** Conformance du FAKE au port `EInvoicingProvider` (US-020, ADR-057). */
import { describe, expect, it } from 'vitest';
import { FakeClock, FakeEInvoicingProvider } from '@rueda/fake-adapters';
import type { EInvoicingProvider } from '../index.js';

describe('port EInvoicingProvider ← FAKE', () => {
  it('le FAKE se conforme au port ; régime inconnu refusé (capacité inconnue = « non »)', async () => {
    const port: EInvoicingProvider = new FakeEInvoicingProvider({
      clock: new FakeClock('2026-11-03T12:00:00Z'),
      regimes: [],
    });
    expect(port.supportsRegime('FAKE_PAC')).toBe(false);
    expect(await port.getStatus('inconnu')).toEqual({
      status: 'REFUSED',
      reason: 'UNKNOWN_DOCUMENT',
    });
  });
});
