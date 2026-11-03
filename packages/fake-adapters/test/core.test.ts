import { describe, expect, it } from 'vitest';
import { FakeClock } from '../src/core/clock.ts';
import { FakeRuntime, fingerprint, Sequence } from '../src/core/runtime.ts';
import { checkFakeWebhook, signFakeWebhook } from '../src/core/webhook.ts';
import { clock, secret } from './support.ts';

type Op = 'write' | 'read';

function harness() {
  const runtime = new FakeRuntime<Op, 'NOPE'>(clock());
  const effects: number[] = [];
  const write = (key: string, content: unknown) =>
    runtime.execute('write', { idempotencyKey: key, content }, (times) => {
      for (let i = 0; i < times; i++) effects.push(effects.length + 1);
      return { ok: true, value: `v-${String(content)}` };
    });
  return { runtime, effects, write };
}

describe('FakeRuntime : tableau des cas difficiles (ADR-058)', () => {
  it('OK : un effet, réponse OK non rejouée', async () => {
    const h = harness();
    expect(await h.write('k1', 'a')).toEqual({ status: 'OK', value: 'v-a', replayed: false });
    expect(h.effects).toHaveLength(1);
  });

  it('idempotence : même clé et même contenu ⇒ même réponse, rejouée, aucun nouvel effet', async () => {
    const h = harness();
    await h.write('k1', 'a');
    expect(await h.write('k1', 'a')).toEqual({ status: 'OK', value: 'v-a', replayed: true });
    expect(h.effects).toHaveLength(1);
  });

  it('idempotence : même clé, contenu différent ⇒ IDEMPOTENCY_CONFLICT sans effet', async () => {
    const h = harness();
    await h.write('k1', 'a');
    expect(await h.write('k1', 'b')).toEqual({ status: 'REFUSED', reason: 'IDEMPOTENCY_CONFLICT' });
    expect(h.effects).toHaveLength(1);
  });

  it('UNAVAILABLE et TIMEOUT_BEFORE : aucun effet', async () => {
    const h = harness();
    h.runtime.script.script('write', { kind: 'UNAVAILABLE' }, { kind: 'TIMEOUT_BEFORE' });
    expect(await h.write('k1', 'a')).toEqual({ status: 'UNAVAILABLE' });
    expect(await h.write('k1', 'a')).toEqual({ status: 'TIMEOUT' });
    expect(h.effects).toHaveLength(0);
    expect(h.runtime.script.calls('write')).toBe(2);
  });

  it('TIMEOUT_AFTER : effet produit, issue inconnue ; le rejeu de la clé rend OK sans second effet', async () => {
    const h = harness();
    h.runtime.script.script('write', { kind: 'TIMEOUT_AFTER' });
    expect(await h.write('k1', 'a')).toEqual({ status: 'TIMEOUT' });
    expect(h.effects).toHaveLength(1);
    expect(await h.write('k1', 'a')).toEqual({ status: 'OK', value: 'v-a', replayed: true });
    expect(h.effects).toHaveLength(1);
  });

  it('DUPLICATE : effet produit deux fois', async () => {
    const h = harness();
    h.runtime.script.script('write', { kind: 'DUPLICATE' });
    expect((await h.write('k1', 'a')).status).toBe('OK');
    expect(h.effects).toEqual([1, 2]);
  });

  it('DELAY : horloge virtuelle avancée, réussite', async () => {
    const h = harness();
    const before = h.runtime.clock.nowMs();
    h.runtime.script.script('write', { kind: 'DELAY', ms: 45_000 });
    expect((await h.write('k1', 'a')).status).toBe('OK');
    expect(h.runtime.clock.nowMs() - before).toBe(45_000);
  });

  it('REFUSE : motif scripté, aucun effet, refus non mémorisé', async () => {
    const h = harness();
    h.runtime.script.script('write', { kind: 'REFUSE', reason: 'NOPE' });
    expect(await h.write('k1', 'a')).toEqual({ status: 'REFUSED', reason: 'NOPE' });
    expect(h.effects).toHaveLength(0);
    expect((await h.write('k1', 'a')).status).toBe('OK');
  });

  it('panne prolongée : setDefault s’applique quand la file est vide', async () => {
    const h = harness();
    h.runtime.script.setDefault('write', { kind: 'UNAVAILABLE' }).script('write', { kind: 'OK' });
    expect((await h.write('k1', 'a')).status).toBe('OK');
    expect((await h.write('k2', 'a')).status).toBe('UNAVAILABLE');
    expect((await h.write('k3', 'a')).status).toBe('UNAVAILABLE');
    expect(h.runtime.script.pending('write')).toBe(0);
  });

  it('scénario invalide refusé', () => {
    const h = harness();
    expect(() => h.runtime.script.script('write', { kind: 'DELAY', ms: -1 })).toThrow(RangeError);
  });
});

describe('socle déterministe', () => {
  it('empreinte stable : ordre des clés indifférent, bigint / Date / octets normalisés', () => {
    const a = fingerprint({ b: 1n, a: new Date('2026-01-01T00:00:00Z'), c: Buffer.from('x') });
    const b = fingerprint({ c: Buffer.from('x'), a: new Date('2026-01-01T00:00:00Z'), b: 1n });
    expect(a).toBe(b);
    expect(fingerprint({ b: 1n })).not.toBe(fingerprint({ b: '1' }));
    expect(fingerprint({ a: undefined })).toBe(fingerprint({}));
  });

  it('identifiants séquentiels', () => {
    const s = new Sequence('fk_x');
    expect([s.next(), s.next()]).toEqual(['fk_x_000001', 'fk_x_000002']);
  });

  it('horloge : jamais d’avance négative', () => {
    const c = new FakeClock('2026-01-01T00:00:00Z');
    expect(() => c.advance(-1)).toThrow(RangeError);
    expect(() => new FakeClock('pas une date')).toThrow(RangeError);
  });

  it('rappels signés : valide, altéré, périmé, absent ; secret trop court refusé', () => {
    const key = secret();
    const header = signFakeWebhook(key, '{"a":1}', 1000);
    expect(checkFakeWebhook(key, '{"a":1}', header, 1000, 300)).toBe('VALID');
    expect(checkFakeWebhook(key, '{"a":2}', header, 1000, 300)).toBe('BAD_SIGNATURE');
    expect(checkFakeWebhook(secret(), '{"a":1}', header, 1000, 300)).toBe('BAD_SIGNATURE');
    expect(checkFakeWebhook(key, '{"a":1}', header, 1301, 300)).toBe('STALE');
    expect(checkFakeWebhook(key, '{"a":1}', undefined, 1000, 300)).toBe('BAD_SIGNATURE');
    expect(checkFakeWebhook(key, '{"a":1}', 't=1000,v1=zz', 1000, 300)).toBe('BAD_SIGNATURE');
    expect(() => signFakeWebhook('court', 'x', 1)).toThrow(RangeError);
  });
});
