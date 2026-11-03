import { describe, expect, it } from 'vitest';
import { FakeMessagingChannel } from '../src/messaging/index.ts';
import type { MessageChannelKind, OutboundMessage } from '../src/messaging/index.ts';
import { clock } from './support.ts';

const RECIPIENT: Record<MessageChannelKind, string> = {
  EMAIL: 'voyageur@example.invalid',
  SMS: '+15550000001',
};

const message = (
  channel: MessageChannelKind,
  over: Partial<OutboundMessage> = {},
): OutboundMessage => ({
  idempotencyKey: `ntf:evt-1:${channel}`,
  channel,
  to: RECIPIENT[channel],
  locale: 'es',
  templateKey: 'common.auth.otp',
  subject: channel === 'EMAIL' ? 'Código' : null,
  body: 'Código: 123456',
  ...over,
});

describe.each<MessageChannelKind>(['EMAIL', 'SMS'])('FakeMessagingChannel %s', (channel) => {
  const setup = () => new FakeMessagingChannel({ clock: clock(), channel });

  it('réussite dans les trois langues ; accusé de remise', async () => {
    const ch = setup();
    for (const locale of ['es', 'en', 'fr']) {
      const out = await ch.send(message(channel, { idempotencyKey: `k-${locale}`, locale }));
      expect(out.status).toBe('OK');
    }
    expect(ch.sent().map((m) => m.locale)).toEqual(['es', 'en', 'fr']);
    expect(ch.takeReceipts().map((r) => r.status)).toEqual(['DELIVERED', 'DELIVERED', 'DELIVERED']);
  });

  it('capacité inconnue = « non » : autre canal refusé', async () => {
    const other: MessageChannelKind = channel === 'EMAIL' ? 'SMS' : 'EMAIL';
    expect(await setup().send(message(other))).toEqual({
      status: 'REFUSED',
      reason: 'UNSUPPORTED_CHANNEL',
    });
  });

  it('refus : destinataire invalide ou bloqué ; rien ne part', async () => {
    const ch = setup();
    expect(await ch.send(message(channel, { to: 'n importe quoi' }))).toEqual({
      status: 'REFUSED',
      reason: 'INVALID_RECIPIENT',
    });
    ch.block(RECIPIENT[channel]);
    expect(await ch.send(message(channel))).toEqual({ status: 'REFUSED', reason: 'BLOCKED' });
    expect(ch.sent()).toHaveLength(0);
  });

  it('échec : panne, issue inconnue (le message est parti), rejeu sans second envoi', async () => {
    const ch = setup();
    ch.runtime.script.script('send', { kind: 'UNAVAILABLE' }, { kind: 'TIMEOUT_AFTER' });
    expect(await ch.send(message(channel))).toEqual({ status: 'UNAVAILABLE' });
    expect(ch.sent()).toHaveLength(0);
    expect(await ch.send(message(channel))).toEqual({ status: 'TIMEOUT' });
    expect(ch.sent()).toHaveLength(1);
    expect(await ch.send(message(channel))).toMatchObject({ status: 'OK', replayed: true });
    expect(ch.sent()).toHaveLength(1);
  });

  it('doublon : le fournisseur envoie deux fois ; accusés en double, en retard, rebond, perdu', async () => {
    const ch = setup();
    ch.runtime.script.script('send', { kind: 'DUPLICATE' });
    ch.runtime.script.script(
      'receipt',
      { kind: 'DUPLICATE' },
      { kind: 'DELAY', ms: 90_000 },
      { kind: 'REFUSE', reason: 'BOUNCED' },
      { kind: 'UNAVAILABLE' },
    );
    await ch.send(message(channel, { idempotencyKey: 'a' }));
    expect(ch.sent()).toHaveLength(2);
    await ch.send(message(channel, { idempotencyKey: 'b' }));
    await ch.send(message(channel, { idempotencyKey: 'c' }));
    await ch.send(message(channel, { idempotencyKey: 'd' }));
    const now = ch.takeReceipts();
    expect(now.map((r) => r.status)).toEqual(['DELIVERED', 'DELIVERED', 'BOUNCED']);
    expect(now[0]).toEqual(now[1]);
    ch.runtime.clock.advance(90_000);
    expect(ch.takeReceipts()).toHaveLength(1);
    expect(ch.takeReceipts()).toHaveLength(0);
  });

  it('délai simulé', async () => {
    const ch = setup();
    ch.runtime.script.script('send', { kind: 'DELAY', ms: 61_000 });
    expect((await ch.send(message(channel))).status).toBe('OK');
    expect(ch.runtime.clock.now().toISOString()).toBe('2026-11-03T12:01:01.000Z');
  });
});
