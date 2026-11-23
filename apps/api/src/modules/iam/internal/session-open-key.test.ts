/**
 * US-410 — preuve d'ouverture de session (ADR-205, migration 0185) :
 * - message v1 reconstruit À LA MAIN en hexadécimal (oracle indépendant du code testé) ;
 * - un champ modifié change la preuve ;
 * - `RUEDA_SESSION_OPEN_KEY` : 32 à 64 octets en hexadécimal ; absente => null (aucune session) ;
 *   mal formée => refus de démarrer, sans afficher la valeur.
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  parseSessionOpenKey,
  sessionOpenKeyFromEnv,
  sessionOpenMessage,
  sessionOpenProof,
} from './session-open-key.js';

const fields = {
  sessionId: '00112233-4455-6677-8899-aabbccddeeff',
  userId: 'ffeeddcc-bbaa-9988-7766-554433221100',
  tokenHash: Buffer.alloc(32, 0xab),
  ttlS: 3600,
  issuedAtMs: 1_790_000_000_123n,
};

describe('message et preuve v1 (ADR-205)', () => {
  it('message = contexte ‖ session ‖ compte ‖ empreinte ‖ durée int4 ‖ instant int8, en hexadécimal', () => {
    const expected =
      Buffer.from('rueda-session-open-v1', 'utf8').toString('hex') +
      '00112233445566778899aabbccddeeff' +
      'ffeeddccbbaa99887766554433221100' +
      'ab'.repeat(32) +
      '00000e10' + // 3600
      '000001a0c4506c7b'; // 1 790 000 000 123
    expect(sessionOpenMessage(fields).toString('hex')).toBe(expected);
    const key = Buffer.alloc(32, 7);
    expect(sessionOpenProof(key, fields).toString('hex')).toBe(
      createHmac('sha256', key).update(Buffer.from(expected, 'hex')).digest('hex'),
    );
  });

  it('chaque champ modifié change la preuve', () => {
    const key = Buffer.alloc(32, 7);
    const base = sessionOpenProof(key, fields).toString('hex');
    for (const changed of [
      { ...fields, sessionId: '00112233-4455-6677-8899-aabbccddeef0' },
      { ...fields, userId: 'ffeeddcc-bbaa-9988-7766-554433221101' },
      { ...fields, tokenHash: Buffer.alloc(32, 0xac) },
      { ...fields, ttlS: 3601 },
      { ...fields, issuedAtMs: fields.issuedAtMs + 1n },
    ]) {
      expect(sessionOpenProof(key, changed).toString('hex')).not.toBe(base);
    }
    expect(sessionOpenProof(Buffer.alloc(32, 8), fields).toString('hex')).not.toBe(base);
  });

  it('entrées mal formées refusées', () => {
    expect(() => sessionOpenMessage({ ...fields, tokenHash: Buffer.alloc(31) })).toThrow(
      /32 octets/,
    );
    expect(() => sessionOpenMessage({ ...fields, sessionId: 'x' })).toThrow(/UUID/);
    expect(() => sessionOpenMessage({ ...fields, userId: 'x' })).toThrow(/UUID/);
    expect(() => sessionOpenMessage({ ...fields, ttlS: 1.5 })).toThrow(/durée/);
  });
});

describe('clé RUEDA_SESSION_OPEN_KEY', () => {
  it('absente ou vide : null (aucune session ouverte) ; valide : 32 à 64 octets', () => {
    expect(parseSessionOpenKey(undefined)).toBeNull();
    expect(parseSessionOpenKey('')).toBeNull();
    expect(sessionOpenKeyFromEnv({})).toBeNull();
    expect(parseSessionOpenKey('ab'.repeat(32))).toHaveLength(32);
    expect(parseSessionOpenKey('AB'.repeat(64))).toHaveLength(64);
    expect(sessionOpenKeyFromEnv({ RUEDA_SESSION_OPEN_KEY: 'cd'.repeat(48) })).toHaveLength(48);
  });

  it('mal formée : refus, sans la valeur dans le message', () => {
    for (const bad of ['ab'.repeat(31), 'ab'.repeat(65), `${'ab'.repeat(32)}z`, 'zz'.repeat(32)]) {
      expect(() => parseSessionOpenKey(bad)).toThrow(/RUEDA_SESSION_OPEN_KEY/);
      expect(() => parseSessionOpenKey(bad)).toThrow(
        expect.objectContaining({ message: expect.not.stringContaining(bad) as unknown }),
      );
    }
  });
});
