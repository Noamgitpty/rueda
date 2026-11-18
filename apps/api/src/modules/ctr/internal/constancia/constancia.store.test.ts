/**
 * US-212 — adaptateur PostgreSQL de la constancia : requêtes paramétrées vers les seules fonctions
 * de 0136, issues de la base rendues telles quelles, réponse mal formée refusée en entier (jamais
 * une liste partielle), erreur de la base réduite à son SQLSTATE. Exécuteur en mémoire ; les
 * règles de la base sont prouvées par `packages/db/test/l0/l0-us212-constancia.test.ts`.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ConstanciaStoreError, PgTripConstanciaStore } from './constancia.store.js';
import type { ConstanciaSqlExecutor } from './constancia.store.js';

function executor(rows: Record<string, unknown>[] | Error): ConstanciaSqlExecutor & {
  calls: { text: string; values: readonly unknown[] }[];
} {
  const calls: { text: string; values: readonly unknown[] }[] = [];
  return {
    calls,
    query<R extends Record<string, unknown>>(text: string, values: readonly unknown[] = []) {
      calls.push({ text, values });
      return rows instanceof Error ? Promise.reject(rows) : Promise.resolve({ rows: rows as R[] });
    },
  };
}

const proof = Buffer.alloc(32, 7);
const trip = randomUUID();

describe('US-212 — PgTripConstanciaStore', () => {
  it('lecture : fonction de 0136, paramètres liés ; issues de refus rendues telles quelles', async () => {
    for (const outcome of ['NOT_FOUND', 'NOT_AVAILABLE', 'NOT_GENERATED', 'ERASED']) {
      const db = executor([{ outcome }]);
      expect(await new PgTripConstanciaStore(db).read(proof, trip)).toEqual({ outcome });
      expect(db.calls).toEqual([
        { text: 'SELECT * FROM core.booking_trip_constancia($1, $2::uuid)', values: [proof, trip] },
      ]);
    }
    const ok = await new PgTripConstanciaStore(executor([{ outcome: 'OK', plate: 'X' }])).read(
      proof,
      trip,
    );
    expect(ok).toEqual({ outcome: 'OK', row: { outcome: 'OK', plate: 'X' } });
  });

  it('lecture : issue inconnue, aucune ligne ou plusieurs ⇒ erreur ; erreur de la base ⇒ SQLSTATE seul', async () => {
    for (const rows of [[], [{ outcome: 'MAYBE' }], [{ outcome: 'OK' }, { outcome: 'OK' }]]) {
      await expect(new PgTripConstanciaStore(executor(rows)).read(proof, trip)).rejects.toThrow(
        ConstanciaStoreError,
      );
    }
    const failure = Object.assign(new Error('détail du serveur à ne pas divulguer'), {
      code: '42501',
    });
    const e = await new PgTripConstanciaStore(executor(failure)).read(proof, trip).catch((x) => x);
    expect(e).toBeInstanceOf(ConstanciaStoreError);
    expect((e as ConstanciaStoreError).sqlstate).toBe('42501');
    expect((e as Error).message).not.toContain('divulguer');
  });

  it('recherche : lignes DONE contrôlées ; AUTH_REQUIRED / REQUEST_INVALID ; ligne mal formée ⇒ toute la réponse refusée', async () => {
    const good = {
      outcome: 'DONE',
      trip_id: trip,
      public_ref: 'K-1',
      status: 'COMPLETED',
      start_local: '2034-03-08 10:00',
      end_local: '2034-03-11 10:00',
    };
    const db = executor([good]);
    expect(await new PgTripConstanciaStore(db).search(proof, 'ab-12', '2034-03-09')).toEqual({
      outcome: 'DONE',
      trips: [
        {
          tripId: trip,
          tripRef: 'K-1',
          status: 'COMPLETED',
          startLocal: '2034-03-08 10:00',
          endLocal: '2034-03-11 10:00',
        },
      ],
    });
    expect(db.calls[0]).toEqual({
      text: 'SELECT * FROM core.booking_host_constancia_search($1, $2, $3::date)',
      values: [proof, 'ab-12', '2034-03-09'],
    });
    expect(await new PgTripConstanciaStore(executor([])).search(proof, 'AB', '2034-03-09')).toEqual(
      { outcome: 'DONE', trips: [] },
    );
    for (const outcome of ['AUTH_REQUIRED', 'REQUEST_INVALID']) {
      expect(
        await new PgTripConstanciaStore(executor([{ outcome }])).search(proof, 'AB', '2034-03-09'),
      ).toEqual({ outcome });
    }
    for (const bad of [
      { ...good, trip_id: 'x' },
      { ...good, start_local: '2034-03-08' },
      { ...good, outcome: 'AUTH_REQUIRED' },
    ]) {
      await expect(
        new PgTripConstanciaStore(executor([good, bad])).search(proof, 'AB', '2034-03-09'),
      ).rejects.toThrow(ConstanciaStoreError);
    }
  });
});
