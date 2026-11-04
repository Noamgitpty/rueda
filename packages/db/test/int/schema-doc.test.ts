/**
 * US-038, critère 2 — « Given une migration, When elle est fusionnée, Then la documentation du
 * schéma est régénérée et l'historique des migrations est lisible ». Le document est relu dans le
 * catalogue de la base `production` du banc (migrations de production seules), sous `app_api`
 * (assertion L0-05), et comparé octet par octet à `docs/architecture/schema.md` : un écart fait
 * échouer `pnpm test:int`, donc la CI. En cas d'écart, le document attendu est imprimé entre deux
 * marqueurs dans le journal (à recopier), ou écrit si `RUEDA_DOCS_WRITE=1`.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  introspectSchema,
  renderSchemaDocument,
  SCHEMA_DOC_COMMAND,
  SCHEMA_DOC_PATH,
} from '../../src/schema-doc.ts';
import { benchInfo, withRole } from '../../src/testing/index.ts';

const file = new URL(`../../../../${SCHEMA_DOC_PATH}`, import.meta.url);

describe('document du schéma (docs/architecture/schema.md)', () => {
  it('est à jour : régénéré depuis la base migrée, identique au fichier commité', async () => {
    const applied = benchInfo().appliedMigrations.production;
    const expected = await withRole(
      'app_api',
      async (client) => renderSchemaDocument(await introspectSchema(client, applied)),
      { database: 'production' },
    );
    // garde-fous : le document décrit vraiment la base (pas un rendu vide)
    expect(expected).toContain('`core.booking_trip`');
    expect(expected).toContain('## Fonctions `SECURITY DEFINER`');
    expect(applied.length).toBeGreaterThan(0);

    if (process.env['RUEDA_DOCS_WRITE'] === '1') writeFileSync(file, expected, 'utf8');
    const actual = existsSync(file) ? readFileSync(file, 'utf8').replaceAll('\r\n', '\n') : '';
    if (actual !== expected) {
      process.stdout.write(
        `\n----- ${SCHEMA_DOC_PATH} : DÉBUT -----\n${expected}\n----- ${SCHEMA_DOC_PATH} : FIN -----\n`,
      );
    }
    expect(
      actual === expected,
      `${SCHEMA_DOC_PATH} n'est plus à jour : ${SCHEMA_DOC_COMMAND}`,
    ).toBe(true);
  });
});
