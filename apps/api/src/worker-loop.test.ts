import { describe, expect, it } from 'vitest';
import { errorLabel, WorkerLoop, WorkerLoopFailure } from './worker-loop.js';
import type { WorkerLoopParts } from './worker-loop.js';

/** Doubles enregistreurs du module BUS (ordre des appels, échecs programmés). */
function parts(
  options: {
    readonly queues?: string[];
    readonly relayBatches?: number[];
    readonly failing?: ReadonlySet<string>;
  } = {},
): { parts: WorkerLoopParts; calls: string[] } {
  const calls: string[] = [];
  const batches = [...(options.relayBatches ?? [0])];
  const fail = (step: string): void => {
    if (options.failing?.has(step)) {
      throw Object.assign(new Error('relation « core.secret » : valeur 42'), {
        code: '42501',
      });
    }
  };
  return {
    calls,
    parts: {
      registry: { queueNames: () => options.queues ?? ['a', 'b'] },
      relay: {
        runOnce: () => {
          calls.push('relay');
          fail('relay');
          return Promise.resolve({ published: batches.shift() ?? 0, deliveries: 0 });
        },
      },
      runner: {
        runOnce: (queue: string) => {
          calls.push(`queue:${queue}`);
          fail(`queue:${queue}`);
          return Promise.resolve({ outcomes: [], reaped: 0 });
        },
      },
      scheduler: {
        tick: () => {
          calls.push('scheduler');
          fail('scheduler');
          return Promise.resolve([]);
        },
      },
      metrics: {
        collect: () => {
          calls.push('metrics');
          fail('metrics');
          return Promise.resolve({ outboxUnpublished: 0, outboxOldestAgeSeconds: 0, queues: {} });
        },
      },
    },
  };
}

describe('boucle du travailleur (US-003)', () => {
  it('un passage : planificateur, relais jusqu’à épuisement (borné), chaque file, métriques', async () => {
    const { parts: p, calls } = parts({ relayBatches: [100, 100, 3, 0] });
    const logs: string[] = [];
    const loop = new WorkerLoop(p, { log: (l) => logs.push(l), clock: () => 0 });
    const state = { lastSchedule: -Infinity, lastMetrics: -Infinity };
    expect(await loop.runOnce(state)).toEqual({ failed: 0, attempted: 5 });
    expect(calls).toEqual([
      'scheduler',
      'relay',
      'relay',
      'relay',
      'relay',
      'queue:a',
      'queue:b',
      'metrics',
    ]);
    // second passage au même instant : ni planificateur ni métriques (intervalles non échus)
    calls.length = 0;
    expect(await loop.runOnce(state)).toEqual({ failed: 0, attempted: 3 });
    expect(calls).toEqual(['relay', 'queue:a', 'queue:b']);
  });

  it('relais borné à maxRelayBatches par passage', async () => {
    const { parts: p, calls } = parts({ relayBatches: [1, 1, 1, 1, 1], queues: [] });
    const loop = new WorkerLoop(p, { maxRelayBatches: 2, log: () => undefined, clock: () => 0 });
    await loop.runOnce({ lastSchedule: 0, lastMetrics: 0 });
    expect(calls).toEqual(['relay', 'relay']);
  });

  it('une étape en échec n’arrête pas les autres ; journal sans message de la base', async () => {
    const { parts: p, calls } = parts({ failing: new Set(['queue:a']) });
    const logs: string[] = [];
    const loop = new WorkerLoop(p, { log: (l) => logs.push(l), clock: () => 0 });
    const r = await loop.runOnce({ lastSchedule: 0, lastMetrics: 0 });
    expect(r).toEqual({ failed: 1, attempted: 3 });
    expect(calls).toEqual(['relay', 'queue:a', 'queue:b']);
    expect(logs).toEqual([
      JSON.stringify({ level: 'error', step: 'queue:a', error: 'Error:42501' }),
    ]);
    expect(logs.join('')).not.toMatch(/secret|42\b/);
  });

  it('passages entièrement en échec : arrêt en erreur après le seuil (le processus sort en 1)', async () => {
    const { parts: p } = parts({ failing: new Set(['relay', 'queue:a', 'queue:b', 'scheduler']) });
    const loop = new WorkerLoop(p, {
      idleMs: 0,
      maxConsecutiveFailures: 3,
      log: () => undefined,
    });
    await expect(loop.run()).rejects.toBeInstanceOf(WorkerLoopFailure);
  });

  it('stop() : termine le passage, interrompt l’attente, run() rend la main', async () => {
    const { parts: p, calls } = parts();
    const loop = new WorkerLoop(p, { idleMs: 60_000, log: () => undefined });
    const done = loop.run();
    await new Promise((r) => setTimeout(r, 20));
    loop.stop();
    await done;
    expect(loop.stopping).toBe(true);
    expect(calls.filter((c) => c === 'relay')).toHaveLength(1);
  });

  it('options invalides refusées', () => {
    expect(() => new WorkerLoop(parts().parts, { idleMs: -1 })).toThrow(/idleMs/);
    expect(() => new WorkerLoop(parts().parts, { maxRelayBatches: 1.5 })).toThrow(
      /maxRelayBatches/,
    );
  });

  it('étiquette d’erreur : nom et SQLSTATE seulement', () => {
    expect(errorLabel(Object.assign(new TypeError('x'), { code: '40P01' }))).toBe(
      'TypeError:40P01',
    );
    expect(errorLabel(Object.assign(new Error('x'), { code: 'pas un code' }))).toBe('Error');
    expect(errorLabel({ name: 'nom avec espaces' })).toBe('Error');
    expect(errorLabel('chaîne')).toBe('unknown');
    expect(errorLabel(null)).toBe('unknown');
  });
});
