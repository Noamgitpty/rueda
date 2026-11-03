/**
 * Enveloppe par sujet (US-009 ; 17 §3.1.3 point 1 ; ADR-051) : AES-256-GCM, liaison au sujet et à
 * l'emplacement, aucune fuite du clair.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { columnAad, ENVELOPE_MIN_BYTES, EnvelopeError, fileAad, open, seal } from './envelope.ts';
import type { SubjectRef } from './envelope.ts';

const ALICE: SubjectRef = { type: 'USER', id: '0a0a0a0a-0000-4000-8000-000000000001' };
const BOB: SubjectRef = { type: 'USER', id: '0b0b0b0b-0000-4000-8000-000000000002' };
const IP = Buffer.from('203.0.113.7', 'utf8'); // RFC 5737 (documentation)

describe('enveloppe v1', () => {
  it('format : 0x01 || nonce 12 || texte chiffré || étiquette 16 ; aller-retour', () => {
    const dek = randomBytes(32);
    const aad = columnAad('audit_log', 'ip_enc', ALICE);
    const env = seal(dek, IP, aad);
    expect(env[0]).toBe(0x01);
    expect(env.length).toBe(1 + 12 + IP.length + 16);
    expect(ENVELOPE_MIN_BYTES).toBe(29);
    expect(open(dek, env, aad)).toEqual(IP);
  });

  it('le clair ne figure pas dans l’enveloppe ; deux scellements diffèrent (nonce aléatoire)', () => {
    const dek = randomBytes(32);
    const aad = columnAad('audit_log', 'ip_enc', ALICE);
    const a = seal(dek, IP, aad);
    const b = seal(dek, IP, aad);
    expect(a.includes(IP)).toBe(false);
    expect(a.toString('latin1')).not.toContain('203.0.113.7');
    expect(a.equals(b)).toBe(false);
  });

  it('refus : autre clé, autre sujet, autre colonne, autre fichier, octet altéré, version inconnue', () => {
    const dek = randomBytes(32);
    const aad = columnAad('audit_log', 'ip_enc', ALICE);
    const env = seal(dek, IP, aad);
    expect(() => open(randomBytes(32), env, aad)).toThrow(EnvelopeError);
    expect(() => open(dek, env, columnAad('audit_log', 'ip_enc', BOB))).toThrow(EnvelopeError);
    expect(() => open(dek, env, columnAad('consent', 'ip_enc', ALICE))).toThrow(EnvelopeError);
    const file = seal(dek, IP, fileAad('f1', ALICE));
    expect(() => open(dek, file, fileAad('f2', ALICE))).toThrow(EnvelopeError);
    for (const at of [1, 13, env.length - 1]) {
      const bad = Buffer.from(env);
      bad[at] = (bad[at] ?? 0) ^ 0x01;
      expect(() => open(dek, bad, aad), `octet ${at}`).toThrow(EnvelopeError);
    }
    const v2 = Buffer.from(env);
    v2[0] = 0x02;
    expect(() => open(dek, v2, aad)).toThrow(EnvelopeError);
    expect(() => open(dek, env.subarray(0, 28), aad)).toThrow(EnvelopeError);
  });

  it('DEK de taille invalide refusée', () => {
    expect(() => seal(randomBytes(16), IP, 'x')).toThrow(EnvelopeError);
  });
});
