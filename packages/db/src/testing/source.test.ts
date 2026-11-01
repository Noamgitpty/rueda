import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseAdminUrl, readPasswordFile, resolveAdminSource } from './source.ts';

const FAKE = 'fake-Secret-456';
const dir = mkdtempSync(join(tmpdir(), 'rueda-db-source-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('parseAdminUrl', () => {
  it('analyse une URL sans mot de passe', () => {
    expect(parseAdminUrl('postgres://postgres@localhost:5432/postgres')).toEqual({
      host: 'localhost',
      port: 5432,
      user: 'postgres',
      database: 'postgres',
    });
    expect(parseAdminUrl('postgresql://admin@[::1]/')).toMatchObject({ host: '::1', port: 5432 });
  });

  it('refuse une URL qui porte un mot de passe, sans le recopier', () => {
    let message = '';
    try {
      parseAdminUrl(`postgres://postgres:${FAKE}@localhost/postgres`);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/ne doit pas contenir de mot de passe/);
    expect(message).not.toContain(FAKE);
  });

  it('refuse un autre schéma et un utilisateur manquant', () => {
    expect(() => parseAdminUrl('mysql://u@h/d')).toThrow(/postgres/);
    expect(() => parseAdminUrl('postgres://localhost/d')).toThrow(/utilisateur/);
  });
});

describe('readPasswordFile', () => {
  it('retire la fin de ligne finale et le BOM', () => {
    const path = join(dir, 'ok.secret');
    writeFileSync(path, `\uFEFF${FAKE}\r\n`);
    expect(readPasswordFile(path)).toBe(FAKE);
  });

  it('refuse un fichier vide ou multiligne sans afficher son contenu', () => {
    const path = join(dir, 'bad.secret');
    writeFileSync(path, `${FAKE}\nautre\n`);
    expect(() => readPasswordFile(path)).toThrow(/une seule ligne/);
    try {
      readPasswordFile(path);
    } catch (error) {
      expect((error as Error).message).not.toContain(FAKE);
    }
    writeFileSync(path, '');
    expect(() => readPasswordFile(path)).toThrow(/une seule ligne/);
  });

  it('signale un fichier absent par son chemin', () => {
    expect(() => readPasswordFile(join(dir, 'absent.secret'))).toThrow(/ENOENT/);
  });
});

describe('resolveAdminSource', () => {
  it('lit URL + fichier de mot de passe (mode natif)', async () => {
    const path = join(dir, 'native.secret');
    writeFileSync(path, FAKE);
    const source = await resolveAdminSource({
      RUEDA_PG_ADMIN_URL: 'postgres://postgres@localhost:5432/postgres',
      RUEDA_PG_SUPERUSER_PASSWORD_FILE: path,
    });
    expect(source.kind).toBe('native');
    expect(source.admin.password).toBe(FAKE);
    expect(source.label).not.toContain(FAKE);
  });

  it('exige le fichier de mot de passe avec l’URL', async () => {
    await expect(
      resolveAdminSource({ RUEDA_PG_ADMIN_URL: 'postgres://postgres@localhost/postgres' }),
    ).rejects.toThrow(/RUEDA_PG_SUPERUSER_PASSWORD_FILE/);
  });

  it('échoue bruyamment sans configuration (jamais de faux vert)', async () => {
    await expect(resolveAdminSource({})).rejects.toThrow(/banc PostgreSQL non configuré/);
  });
});
