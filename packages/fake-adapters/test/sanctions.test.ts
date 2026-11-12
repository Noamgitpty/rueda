import { describe, expect, it } from 'vitest';
import { FakeSanctionsScreener } from '../src/sanctions/index.ts';
import { clock, configuredCountries } from './support.ts';

const LISTS = { UN: '2026-11-01', OFAC: '2026-11-10', NATIONAL: 'v42' };
const countries = configuredCountries().map((c) => c.code);

const setup = () => new FakeSanctionsScreener({ clock: clock(), listsVersion: LISTS });

describe('FakeSanctionsScreener (VER-028, US-123)', () => {
  it.each(countries)(
    '%s : CLEAR par défaut, versions des listes, aucune référence ; aucune donnée personnelle reçue',
    async (country) => {
      const s = setup();
      const r = await s.screen({
        idempotencyKey: 'screening:k1:a1',
        identityProvider: 'FAKE',
        identitySessionRef: 'fk_idv_000001',
        country,
      });
      expect(r).toMatchObject({
        status: 'OK',
        replayed: false,
        value: { result: 'CLEAR', listsVersion: LISTS, matchRef: null },
      });
      expect(Object.keys(s.received[0] ?? {}).sort()).toEqual([
        'country',
        'idempotencyKey',
        'identityProvider',
        'identitySessionRef',
      ]);
    },
  );

  it('correspondance marquée : résultat et référence opaque ; rejeu idempotent ; contenu différent refusé', async () => {
    const s = setup();
    s.flag('fk_idv_000002', 'POTENTIAL_MATCH');
    const req = {
      idempotencyKey: 'screening:k2:a1',
      identityProvider: 'FAKE',
      identitySessionRef: 'fk_idv_000002',
      country: countries[0] ?? '',
    };
    const first = await s.screen(req);
    expect(first).toMatchObject({ status: 'OK', value: { result: 'POTENTIAL_MATCH' } });
    if (first.status !== 'OK') throw new Error('filtrage refusé');
    expect(first.value.matchRef).toMatch(/^fk_aml_case_\d{6}$/);
    expect(await s.screen(req)).toMatchObject({ status: 'OK', replayed: true });
    expect(await s.screen({ ...req, identitySessionRef: 'autre' })).toEqual({
      status: 'REFUSED',
      reason: 'IDEMPOTENCY_CONFLICT',
    });
  });

  it('panne : UNAVAILABLE, rien de fait', async () => {
    const s = setup();
    s.runtime.script.script('screen', { kind: 'UNAVAILABLE' });
    expect(
      await s.screen({
        idempotencyKey: 'screening:k3:a1',
        identityProvider: 'FAKE',
        identitySessionRef: 'fk_idv_000003',
        country: countries[0] ?? '',
      }),
    ).toEqual({ status: 'UNAVAILABLE' });
    expect(s.received).toEqual([]);
  });
});
