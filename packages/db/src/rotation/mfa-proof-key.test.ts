/**
 * US-051 — CLI de rotation de la clé de preuve MFA : validation des entrées, sans base (la
 * sémantique SQL est prouvée en L0, test/l0/l0-us051-mfa-key-rotation.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { parseAction, parseMfaKey, rotateMfaProofKey } from './mfa-proof-key.ts';

describe('rotation de la clé de preuve MFA (entrées)', () => {
  it('actions admises, casse ignorée ; inconnue : refus', () => {
    expect(parseAction('stage')).toBe('STAGE');
    expect(parseAction('PROMOTE')).toBe('PROMOTE');
    expect(() => parseAction('DROP')).toThrow(/INSTALL, STAGE, PROMOTE, ABORT/);
    expect(() => parseAction(undefined)).toThrow();
  });

  it('clé : 32 à 64 octets hexadécimaux ; le message ne contient jamais la valeur', () => {
    expect(parseMfaKey('ab'.repeat(32))).toHaveLength(32);
    expect(parseMfaKey('AB'.repeat(64))).toHaveLength(64);
    for (const bad of [undefined, '', 'ab'.repeat(31), 'ab'.repeat(65), `${'ab'.repeat(32)}z`]) {
      expect(() => parseMfaKey(bad)).toThrow(/RUEDA_STAFF_MFA_PROOF_KEY_NEXT/);
    }
    const secret = `${'cd'.repeat(31)}zz`;
    try {
      parseMfaKey(secret);
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it('STAGE sans clé ou sans mot de passe : refus avant toute connexion, valeurs expurgées', async () => {
    await expect(rotateMfaProofKey({}, 'STAGE')).rejects.toThrow(/RUEDA_STAFF_MFA_PROOF_KEY_NEXT/);
    const key = 'ef'.repeat(32);
    await expect(
      rotateMfaProofKey({ RUEDA_STAFF_MFA_PROOF_KEY_NEXT: key }, 'STAGE'),
    ).rejects.toThrow(/RUEDA_DB_MIGRATOR_PASSWORD absente/);
  });
});
