/** Conformance du FAKE au port `SignatureService` (US-020, ADR-057). */
import { describe, expect, it } from 'vitest';
import { FakeClock, FakeSignatureService } from '@rueda/fake-adapters';
import type { SignatureService } from '../index.js';

describe('port SignatureService ← FAKE', () => {
  it('le FAKE se conforme au port ; signature inconnue refusée', async () => {
    const port: SignatureService = new FakeSignatureService({
      clock: new FakeClock('2026-11-03T12:00:00Z'),
      maxOtpAgeMs: 10 * 60_000,
    });
    expect(await port.verify('inconnue', '0'.repeat(64))).toEqual({
      status: 'REFUSED',
      reason: 'UNKNOWN_SIGNATURE',
    });
  });
});
