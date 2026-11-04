import { describe, expect, it } from 'vitest';
import { deployConfig, main, PASSWORD_VARIABLES } from './setup.ts';

/** Valeurs factices, construites (aucun secret littéral dans le dépôt). */
const fake = (n: number): string => String.fromCharCode(97 + n).repeat(32);

const valid = (): Record<string, string | undefined> => ({
  RUEDA_ENV: 'preproduction',
  PGHOST: 'db.internal',
  PGPORT: '5432',
  PGDATABASE: 'kmino',
  RUEDA_DB_ADMIN_USER: 'rueda_admin',
  RUEDA_DB_ADMIN_PASSWORD: fake(0),
  ...Object.fromEntries(Object.values(PASSWORD_VARIABLES).map((v, i) => [v, fake(i + 1)])),
});

describe('job de base du déploiement — configuration (US-003)', () => {
  it('préproduction et production acceptées', () => {
    expect(deployConfig(valid()).environment).toBe('preproduction');
    expect(deployConfig({ ...valid(), RUEDA_ENV: 'production' }).environment).toBe('production');
  });

  it('environnement absent, development, test ou inconnu : refus (le job déclare, il ne devine pas)', () => {
    for (const env of [undefined, '', 'development', 'test', 'staging', 'PRODUCTION']) {
      expect(() => deployConfig({ ...valid(), RUEDA_ENV: env }), String(env)).toThrow(/RUEDA_ENV/);
    }
  });

  it('base du banc, hôte ou port invalides : refus', () => {
    expect(() => deployConfig({ ...valid(), PGDATABASE: 'rueda_test_x' })).toThrow(/PGDATABASE/);
    expect(() => deployConfig({ ...valid(), PGDATABASE: undefined })).toThrow(/PGDATABASE/);
    expect(() => deployConfig({ ...valid(), PGHOST: 'a b' })).toThrow(/PGHOST/);
    expect(() => deployConfig({ ...valid(), PGPORT: '0' })).toThrow(/PGPORT/);
  });

  it('administrateur : jamais un rôle applicatif ni migrator', () => {
    for (const user of ['app_api', 'app_worker', 'app_anon', 'migrator', '', 'Admin']) {
      expect(() => deployConfig({ ...valid(), RUEDA_DB_ADMIN_USER: user }), user).toThrow(
        /RUEDA_DB_ADMIN_USER/,
      );
    }
  });

  it('secrets : présents, une ligne, 24 caractères au moins ; jamais dans le message', () => {
    for (const name of ['RUEDA_DB_ADMIN_PASSWORD', ...Object.values(PASSWORD_VARIABLES)]) {
      expect(() => deployConfig({ ...valid(), [name]: undefined }), name).toThrow(name);
      expect(() => deployConfig({ ...valid(), [name]: 'court' }), name).toThrow(/24 caractères/);
      const twoLines = `${fake(9)}\n${fake(10)}`;
      try {
        deployConfig({ ...valid(), [name]: twoLines });
        expect.unreachable();
      } catch (error) {
        expect(String(error)).toMatch(/une seule ligne/);
        expect(String(error)).not.toContain(fake(9));
      }
    }
  });

  it('échec de configuration : message expurgé des secrets fournis', async () => {
    const env = { ...valid(), RUEDA_ENV: 'development' };
    await expect(main(env)).rejects.toThrow(/RUEDA_ENV/);
    try {
      await main({ ...valid(), PGHOST: fake(0) + ' x' });
    } catch (error) {
      expect(String(error)).not.toContain(fake(0));
    }
  });
});
