/**
 * US-410 — CLI de provisionnement et de rotation de la clé de preuve d'ouverture de session :
 * validation des entrées, sans base (la sémantique SQL est prouvée en L0,
 * test/l0/l0-us410-session-open-proof.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { parseSessionOpenKey, rotateSessionOpenKey } from './session-open-key.ts';

describe('clé de preuve d’ouverture de session (entrées de la CLI)', () => {
  it('clé : 32 à 64 octets hexadécimaux', () => {
    expect(parseSessionOpenKey('ab'.repeat(32))).toHaveLength(32);
    expect(parseSessionOpenKey('AB'.repeat(64))).toHaveLength(64);
    for (const bad of [undefined, '', 'ab'.repeat(31), 'ab'.repeat(65), `${'ab'.repeat(32)}z`]) {
      expect(() => parseSessionOpenKey(bad)).toThrow(/RUEDA_SESSION_OPEN_KEY_NEXT/);
    }
  });

  it('le message d’une clé mal formée ne contient jamais la valeur', () => {
    const secret = `${'cd'.repeat(31)}zz`;
    expect(() => parseSessionOpenKey(secret)).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(secret) as unknown }),
    );
  });

  it('action inconnue, STAGE sans clé ou sans mot de passe : refus avant toute connexion', async () => {
    await expect(rotateSessionOpenKey({}, 'DROP')).rejects.toThrow(
      /INSTALL, STAGE, PROMOTE, ABORT/,
    );
    await expect(rotateSessionOpenKey({}, 'INSTALL')).rejects.toThrow(
      /RUEDA_SESSION_OPEN_KEY_NEXT/,
    );
    const key = 'ef'.repeat(32);
    const error = await rotateSessionOpenKey({ RUEDA_SESSION_OPEN_KEY_NEXT: key }, 'STAGE').then(
      () => null,
      (e: unknown) => e,
    );
    expect(String(error)).toMatch(/RUEDA_DB_MIGRATOR_PASSWORD absente/);
    expect(String(error)).not.toContain(key);
  });
});
