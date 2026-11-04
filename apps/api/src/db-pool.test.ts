/**
 * Rotation sans coupure du mot de passe de la base (US-051, ADR-082) : sans PostgreSQL, par un
 * client simulé qui joue la base (un seul mot de passe accepté, `28P01` sinon, comme PostgreSQL).
 * La preuve sur une vraie base et l'image de production est la répétition de rotation
 * (scripts/ops/rotation-drill.sh, job CI « reprise »).
 */
import { EventEmitter } from 'node:events';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { AUTH_FAILED, passwordCandidates, RotatingPasswordPool } from './db-pool.js';
import type { RotationLogEntry } from './db-pool.js';

/** Valeurs de test, sans entropie (jamais des secrets). */
const OLD = 'a';
const NEW = 'b';
/** Valeur que la « base » accepte, modifiable au cours du test (ALTER ROLE). */
const server = { accepted: OLD, attempts: [] as string[] };

class FakeClient extends EventEmitter {
  readonly #options: { password?: string | (() => string) };

  constructor(options: { password?: string | (() => string) }) {
    super();
    this.#options = options;
  }

  connect(cb: (err?: Error) => void): void {
    const p = this.#options.password;
    const given = typeof p === 'function' ? p() : (p ?? process.env['PGPASSWORD'] ?? '');
    server.attempts.push(given);
    queueMicrotask(() => {
      if (given === server.accepted) cb();
      else cb(Object.assign(new Error('authentification refusée'), { code: AUTH_FAILED }));
    });
  }

  query(_t: string, _v: unknown, cb: (err: Error | undefined, res: unknown) => void): void {
    queueMicrotask(() => {
      cb(undefined, { rows: [{ ok: 1 }] });
    });
  }

  end(cb?: () => void): void {
    cb?.();
  }
}

const config = { Client: FakeClient, user: 'app_api' } as unknown as pg.PoolConfig;

describe('passwordCandidates', () => {
  it('sans valeur suivante : la seule valeur courante', () => {
    expect(passwordCandidates({ PGPASSWORD: 'a'.repeat(24) }).values).toEqual(['a'.repeat(24)]);
    expect(passwordCandidates({}).values).toEqual([]);
  });

  it('pendant une rotation : courante puis suivante ; identiques ⇒ une seule', () => {
    expect(passwordCandidates({ PGPASSWORD: 'a', RUEDA_PGPASSWORD_NEXT: 'b' }).values).toEqual([
      'a',
      'b',
    ]);
    expect(passwordCandidates({ PGPASSWORD: 'a', RUEDA_PGPASSWORD_NEXT: 'a' }).values).toEqual([
      'a',
    ]);
  });

  it('valeur suivante sans courante, ou sur deux lignes : refus, sans afficher la valeur', () => {
    expect(() => passwordCandidates({ RUEDA_PGPASSWORD_NEXT: 'secret-x' })).toThrow(
      /rotation incohérente/,
    );
    try {
      passwordCandidates({ PGPASSWORD: 'a', RUEDA_PGPASSWORD_NEXT: 'secret-y\nz' });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain('secret-y');
    }
  });
});

describe('RotatingPasswordPool', () => {
  it('rotation complète : aucune requête en échec, bascule journalisée sans valeur', async () => {
    server.accepted = OLD;
    server.attempts = [];
    const log: RotationLogEntry[] = [];
    const pool = new RotatingPasswordPool(
      { ...config, max: 1, idleTimeoutMillis: 1 },
      { values: [OLD, NEW] },
      (e) => log.push(e),
    );
    // 1. les deux valeurs déployées, rôle encore sur l'ancienne : la courante suffit
    await expect(pool.query('SELECT 1')).resolves.toMatchObject({ rows: [{ ok: 1 }] });
    expect(pool.preferredRank).toBe('courante');
    // 2. ALTER ROLE : une nouvelle connexion essaie l'ancienne (28P01) puis la suivante
    server.accepted = NEW;
    await new Promise((r) => setTimeout(r, 20)); // connexion inactive fermée (idleTimeoutMillis)
    await expect(pool.query('SELECT 1')).resolves.toMatchObject({ rows: [{ ok: 1 }] });
    const client = await pool.connect();
    client.release();
    expect(pool.preferredRank).toBe('suivante');
    expect(log).toEqual([
      { level: 'warn', event: 'db.password.switched', role: 'app_api', to: 'suivante' },
    ]);
    expect(Object.keys(log[0] ?? {})).toEqual(['level', 'event', 'role', 'to']);
    await pool.end();
  });

  it('connexions SIMULTANÉES pendant la rotation : aucune ne revient à l’ancienne valeur, aucune n’échoue', async () => {
    server.accepted = NEW; // ALTER ROLE déjà fait, rang préféré encore « courante »
    server.attempts = [];
    const log: RotationLogEntry[] = [];
    const pool = new RotatingPasswordPool({ ...config, max: 8 }, { values: [OLD, NEW] }, (e) =>
      log.push(e),
    );
    // huit connexions lancées ensemble : toutes essaient l'ancienne valeur et échouent ensemble
    const clients = await Promise.all(Array.from({ length: 8 }, () => pool.connect()));
    expect(clients).toHaveLength(8);
    for (const c of clients) c.release();
    expect(pool.preferredRank).toBe('suivante');
    // une seule bascule journalisée (les autres échecs ont vu la bascule déjà faite)
    expect(log).toHaveLength(1);
    // aucune connexion n'est revenue à l'ancienne valeur après la bascule
    const firstNew = server.attempts.indexOf(NEW);
    expect(server.attempts.slice(firstNew)).not.toContain(OLD);
    await pool.end();
  });

  it('une valeur seule : aucun second essai (l’échec remonte tel quel)', async () => {
    server.accepted = 'c';
    const pool = new RotatingPasswordPool({ ...config, password: 'd' }, { values: ['d'] });
    await expect(pool.query('SELECT 1')).rejects.toMatchObject({ code: AUTH_FAILED });
    await pool.end();
  });

  it('deux valeurs toutes deux refusées : échec après un seul second essai', async () => {
    server.accepted = 'c';
    server.attempts = [];
    const pool = new RotatingPasswordPool({ ...config, max: 1 }, { values: ['a', 'b'] }, () => {});
    await expect(pool.connect()).rejects.toMatchObject({ code: AUTH_FAILED });
    expect(server.attempts).toEqual(['a', 'b']);
    await pool.end();
  });
});
