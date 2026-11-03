/** Conformance du FAKE au port `MessagingChannel` (US-020, ADR-057). */
import { describe, expect, it } from 'vitest';
import { FakeClock, FakeMessagingChannel } from '@rueda/fake-adapters';
import type { MessagingChannel } from '../index.js';

describe('port MessagingChannel ← FAKE', () => {
  it('le FAKE se conforme au port ; panne rendue en valeur', async () => {
    const fake = new FakeMessagingChannel({
      clock: new FakeClock('2026-11-03T12:00:00Z'),
      channel: 'EMAIL',
    });
    fake.runtime.script.script('send', { kind: 'UNAVAILABLE' });
    const port: MessagingChannel = fake;
    const out = await port.send({
      idempotencyKey: 'k',
      channel: 'EMAIL',
      to: 'a@example.invalid',
      locale: 'fr',
      templateKey: 't',
      subject: 's',
      body: 'b',
    });
    expect(out).toEqual({ status: 'UNAVAILABLE' });
  });
});
