/**
 * Clé de preuve et code d'enrôlement (revue code US-012 : deux mutants survivants).
 * - `RUEDA_STAFF_MFA_PROOF_KEY` : 32 à 64 octets en hexadécimal (comme la contrainte de
 *   `core.iam_mfa_proof_key`) ; absente => null ; sinon refus de démarrer, sans afficher la valeur ;
 * - code d'enrôlement : exactement 16 caractères de l'alphabet base32 (A-Z, 2-7), espaces et tirets
 *   tolérés à la saisie.
 */
import { describe, expect, it } from 'vitest';
import { mfaProofMessage, parseMfaProofKey } from './mfa-proof.js';
import { normalizeEnrollmentCode } from './staff.service.js';

describe('clé de preuve (RUEDA_STAFF_MFA_PROOF_KEY)', () => {
  it('absente ou vide : null (aucune élévation, fail-closed)', () => {
    expect(parseMfaProofKey(undefined)).toBeNull();
    expect(parseMfaProofKey('')).toBeNull();
  });

  it('32 et 64 octets acceptés ; 31, 65 octets, longueur impaire ou non hexadécimal refusés', () => {
    expect(parseMfaProofKey('ab'.repeat(32))?.length).toBe(32);
    expect(parseMfaProofKey('AB'.repeat(64))?.length).toBe(64);
    for (const bad of ['ab'.repeat(31), 'ab'.repeat(65), `${'ab'.repeat(32)}a`, 'zz'.repeat(32)]) {
      expect(() => parseMfaProofKey(bad), String(bad.length)).toThrow(/RUEDA_STAFF_MFA_PROOF_KEY/);
    }
  });

  it('l’erreur ne contient jamais la valeur', () => {
    const value = 'cd'.repeat(31);
    expect(() => parseMfaProofKey(value)).toThrow();
    try {
      parseMfaProofKey(value);
    } catch (error) {
      expect((error as Error).message).not.toContain(value);
    }
  });

  it('message v1 : contexte, empreinte de 32 octets, UUID de 16 octets, pas sur 8 octets', () => {
    const m = mfaProofMessage(Buffer.alloc(32, 1), '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', 258);
    expect(m.length).toBe('rueda-staff-mfa-v1'.length + 32 + 16 + 8);
    expect(m.subarray(-8).toString('hex')).toBe('0000000000000102');
    expect(() =>
      mfaProofMessage(Buffer.alloc(31), '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', 1),
    ).toThrow();
    expect(() => mfaProofMessage(Buffer.alloc(32), 'x', 1)).toThrow();
  });
});

describe('code d’enrôlement', () => {
  it('16 caractères base32, casse, espaces et tirets tolérés', () => {
    expect(normalizeEnrollmentCode('abcd-efgh ijkl-mnop')).toBe('ABCDEFGHIJKLMNOP');
    expect(normalizeEnrollmentCode('A2B3C4D5E6F7G2H3')).toBe('A2B3C4D5E6F7G2H3');
  });

  it.each([
    ['15 caractères', 'ABCDEFGHIJKLMNO'],
    ['17 caractères', 'ABCDEFGHIJKLMNOPQ'],
    ['chiffre 0 hors alphabet', 'ABCDEFGHIJKLMNO0'],
    ['chiffre 1 hors alphabet', 'ABCDEFGHIJKLMNO1'],
    ['chiffre 8 hors alphabet', 'ABCDEFGHIJKLMNO8'],
    ['ponctuation', 'ABCDEFGHIJKLMNO!'],
    ['vide', ''],
  ])('%s : refusé', (_why, code) => {
    expect(normalizeEnrollmentCode(code)).toBeNull();
  });

  it('autre type : refusé', () => {
    expect(normalizeEnrollmentCode(1234567890123456)).toBeNull();
    expect(normalizeEnrollmentCode(null)).toBeNull();
  });
});
