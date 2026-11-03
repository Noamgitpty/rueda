/**
 * Conformance du FAKE au port `MessagingChannel` (US-020, ADR-058). Membres du port déclarés en
 * propriétés fonctions : un FAKE qui exigerait plus que le port (paramètre restreint) ne compile pas.
 */
import { describe, expect, it } from 'vitest';
import { FakeClock, FakeMessagingChannel } from '@rueda/fake-adapters';
import type { MessageChannelKind, MessagingChannel, OutboundMessage } from '../index.js';

const RECIPIENT: Record<MessageChannelKind, string> = {
  EMAIL: 'a@example.invalid',
  SMS: '+15550000001',
};

describe.each<MessageChannelKind>(['EMAIL', 'SMS'])(
  'port MessagingChannel ← FAKE %s',
  (channel) => {
    const message = (over: Partial<OutboundMessage> = {}): OutboundMessage => ({
      idempotencyKey: 'k',
      channel,
      to: RECIPIENT[channel],
      locale: 'fr',
      templateKey: 't',
      subject: null,
      body: 'b',
      ...over,
    });

    it('le FAKE se conforme au port ; réussite, rejeu, panne et autre canal en valeurs', async () => {
      const fake = new FakeMessagingChannel({
        clock: new FakeClock('2026-11-03T12:00:00Z'),
        channel,
      });
      const port: MessagingChannel = fake;
      expect(await port.send(message())).toMatchObject({ status: 'OK', replayed: false });
      expect(await port.send(message())).toMatchObject({ status: 'OK', replayed: true });
      fake.runtime.script.script('send', { kind: 'UNAVAILABLE' });
      expect(await port.send(message({ idempotencyKey: 'k2' }))).toEqual({ status: 'UNAVAILABLE' });
      const other: MessageChannelKind = channel === 'EMAIL' ? 'SMS' : 'EMAIL';
      expect(await port.send(message({ idempotencyKey: 'k3', channel: other }))).toEqual({
        status: 'REFUSED',
        reason: 'UNSUPPORTED_CHANNEL',
      });
    });
  },
);
