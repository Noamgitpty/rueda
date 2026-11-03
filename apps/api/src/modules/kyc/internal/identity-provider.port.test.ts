/**
 * Conformance du FAKE au port `IdentityProvider` (US-020, ADR-058) : l'affectation typée échoue à
 * la compilation (`pnpm typecheck`) si le FAKE et le port divergent ; le test rejoue un échec.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FakeClock, FakeIdentityProvider } from '@rueda/fake-adapters';
import type { IdentityProvider } from '../index.js';

describe('port IdentityProvider ← FAKE', () => {
  it('le FAKE se conforme au port ; pièce inconnue refusée (capacité inconnue = « non »)', async () => {
    const port: IdentityProvider = new FakeIdentityProvider({
      clock: new FakeClock('2026-11-03T12:00:00Z'),
      documents: [],
      webhookSecret: randomBytes(24).toString('hex'),
      sessionTtlMs: 60_000,
      webhookToleranceSeconds: 300,
    });
    const out = await port.startVerification({
      idempotencyKey: 'k',
      subjectRef: 'subj',
      document: { country: 'XX', kind: 'NATIONAL_ID' },
      locale: 'fr',
      returnUrl: 'https://app.example.invalid/',
    });
    expect(out).toEqual({ status: 'REFUSED', reason: 'UNSUPPORTED_DOCUMENT' });
    expect(port.parseWebhook('{}', undefined, new Date())).toEqual({
      status: 'REJECTED',
      reason: 'BAD_SIGNATURE',
    });
  });
});
