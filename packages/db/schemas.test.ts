import { describe, expect, it } from 'vitest';
import { MODULE_CODES } from '../../apps/api/src/modules/dependency-graph.ts';
import { BETA_SCHEMA, MODULE_SCHEMAS, SHARED_SCHEMAS, betaTableName } from './schemas.ts';

const IDENTIFIER = /^[a-z][a-z_]*$/;
const RESERVED = ['public', 'information_schema', BETA_SCHEMA, ...Object.keys(SHARED_SCHEMAS)];

describe('correspondance module → schéma PostgreSQL', () => {
  it('chaque module du graphe a un schéma, et seulement eux', () => {
    expect(Object.keys(MODULE_SCHEMAS).sort()).toEqual([...MODULE_CODES].sort());
  });

  it('les schémas sont distincts, en snake_case, hors noms réservés', () => {
    const schemas = Object.values(MODULE_SCHEMAS).map((s) => s.schema);
    expect(new Set(schemas).size).toBe(schemas.length);
    for (const schema of schemas) {
      expect(schema).toMatch(IDENTIFIER);
      expect(schema.startsWith('pg_')).toBe(false);
      expect(RESERVED).not.toContain(schema);
    }
  });

  it('reprend les schémas écrits dans le SQL de 17', () => {
    expect(MODULE_SCHEMAS.AVL).toMatchObject({ schema: 'booking', origin: '17' });
    expect(MODULE_SCHEMAS.CAT).toMatchObject({ schema: 'catalog', origin: '17' });
    expect(MODULE_SCHEMAS.PAY).toMatchObject({ schema: 'payment', origin: '17' });
    expect(MODULE_SCHEMAS.FIN).toMatchObject({ schema: 'finance', origin: '17' });
    expect(MODULE_SCHEMAS.CFG).toMatchObject({ schema: 'config', origin: '17' });
    expect(Object.keys(SHARED_SCHEMAS).sort()).toEqual(['app', 'platform']);
  });

  it('chaque entrée justifie son nom', () => {
    for (const entry of Object.values(MODULE_SCHEMAS))
      expect(entry.evidence.length).toBeGreaterThan(5);
  });

  it('nomme les tables Bêta par préfixe de schéma (D1)', () => {
    expect(betaTableName('AVL', 'checkout_hold')).toBe('booking_checkout_hold');
    expect(betaTableName('CFG', 'currency')).toBe('config_currency');
  });
});
