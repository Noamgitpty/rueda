import { describe, expect, it } from 'vitest';
import { maskConnectionString, redactError, redactSecrets } from './secrets.ts';

const FAKE = 'fake-Secret-123';

describe('maskConnectionString', () => {
  it('masque le mot de passe d’une URL postgres', () => {
    expect(maskConnectionString(`échec postgres://bob:${FAKE}@db:5432/x ici`)).toBe(
      'échec postgres://bob:***@db:5432/x ici',
    );
    expect(maskConnectionString(`postgresql://u:${FAKE}@h/d`)).toBe('postgresql://u:***@h/d');
  });
  it('laisse intacte une URL sans mot de passe', () => {
    expect(maskConnectionString('postgres://postgres@localhost:5432/postgres')).toBe(
      'postgres://postgres@localhost:5432/postgres',
    );
  });
});

describe('redactSecrets / redactError', () => {
  it('remplace chaque occurrence des secrets', () => {
    expect(redactSecrets(`a ${FAKE} b ${FAKE}`, [FAKE])).toBe('a *** b ***');
  });
  it('masque le secret le plus long en entier', () => {
    expect(redactSecrets('abcdef', ['abc', 'abcdef'])).toBe('***');
  });
  it('expurge message, pile et champs PostgreSQL, conserve le code', () => {
    const source = Object.assign(new Error(`password ${FAKE} rejected`), {
      code: '28P01',
      detail: `role x ${FAKE}`,
    });
    const safe = redactError(source, [FAKE]);
    expect(safe.message).toBe('password *** rejected');
    expect(safe.stack).not.toContain(FAKE);
    expect((safe as unknown as { detail: string }).detail).toBe('role x ***');
    expect((safe as unknown as { code: string }).code).toBe('28P01');
  });
});
