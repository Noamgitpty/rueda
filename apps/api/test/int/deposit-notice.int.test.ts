/**
 * test:int — US-701 partie 701c (T70 c ; ADR-173) : caution annoncée avant le checkout, chaîne
 * RÉELLE de la fiche et des cartes sur la base jetable du banc, sous app_api (assertion L0-05 par
 * `connectAs`), dans chaque pays configuré (USD au PA, PYG sans décimale au PY), transaction
 * ANNULÉE : base de la caution par `PgSearchStore.depositBasis` (`core.catalog_public_deposit_basis`,
 * 0149) puis décision de PAY par `PreCheckoutDepositReader` sur les paramètres lus par le lecteur du
 * checkout (`PgDepositRailConfigReader`).
 *
 * Attendus : 08 BR-PAY-06 et vecteurs T70 c / T72 c (oracle `check_t49plus.py`), graine 0142 lue
 * dans `params.json` : `deposit_amount` À DÉCIDER ⇒ LUXE « caution non disponible » (le checkout
 * refuserait, PARAM_MISSING), STANDARD et PREMIUM ⇒ mention générique ; montant de test de T70 c
 * (300,00 à l'exposant de la devise) posé dans la transaction ⇒ LUXE montre ce montant. Classe
 * inconnue du catalogue ⇒ non disponible (fail-closed). Aucun code de pays ni de devise écrit ici.
 */
import { readFileSync } from 'node:fs';
import { connectAs, releaseClient } from '@rueda/db/testing';
import type {} from '@rueda/db/testing/global-setup';
import type pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { PgSearchStore } from '../../src/modules/cat/index.js';
import {
  PgDepositRailConfigReader,
  PreCheckoutDepositReader,
} from '../../src/modules/pay/index.js';
import { countryCases } from '../support/countries.js';

const NOW = '2026-12-01T12:00:00.000Z';

const read = (file: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../src/modules/cfg/data/${file}`, import.meta.url), 'utf8'));
const PARAMS = (
  read('params.json') as { params: { key: string; values: Record<string, unknown> }[] }
).params;
const EXPONENTS = new Map(
  (read('currencies.json') as { currencies: { code: string; exponent: number }[] }).currencies.map(
    (c) => [c.code, c.exponent],
  ),
);

const opened: pg.Client[] = [];
afterEach(async () => {
  for (const c of opened.splice(0)) await releaseClient(c);
});

async function inApiTx(fn: (client: pg.Client) => Promise<void>): Promise<void> {
  const client = await connectAs('app_api'); // assertion L0-05
  opened.push(client);
  await client.query('BEGIN');
  try {
    await client.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [NOW]);
    await fn(client);
  } finally {
    await client.query('ROLLBACK');
  }
}

async function listing(client: pg.Client, country: string, valueClass: string | null) {
  const { rows } = await client.query<{ listing_id: string; vehicle_id: string }>(
    'SELECT * FROM test_fixture.us208_listed_listing($1, $2, $3, $4)',
    [country, 4_000, 'AUTOMATIC', true],
  );
  const l = rows[0];
  if (l === undefined) throw new Error('annonce de fixture');
  await client.query('SELECT test_fixture.us108_set_value_class($1, $2)', [
    l.vehicle_id,
    valueClass,
  ]);
  return l.listing_id;
}

describe.each(countryCases())('$country ($currency) — caution de la fiche et des cartes', (c) => {
  it('graine : STANDARD / PREMIUM ⇒ générique ; LUXE et classe inconnue ⇒ non disponible ; montant de test de T70 c posé ⇒ LUXE le montre', async () => {
    // graine 0142 : LUXE déclencheur, deposit_amount À DÉCIDER (aucune valeur)
    expect(PARAMS.find((p) => p.key === 'deposit_trigger_classes')?.values[c.country]).toEqual([
      'LUXE',
    ]);
    expect(PARAMS.find((p) => p.key === 'deposit_amount')?.values[c.country]).toBeUndefined();
    const exponent = EXPONENTS.get(c.currency);
    if (exponent === undefined) throw new Error(`devise sans exposant : ${c.currency}`);
    const t70c = 300n * 10n ** BigInt(exponent);
    await inApiTx(async (client) => {
      const ids = {
        standard: await listing(client, c.country, 'STANDARD'),
        premium: await listing(client, c.country, 'PREMIUM'),
        luxe: await listing(client, c.country, 'LUXE'),
        unknown: await listing(client, c.country, null),
      };
      const basis = await new PgSearchStore(client).depositBasis(Object.values(ids));
      expect(basis.get(ids.luxe)).toEqual({ country: c.country, valueClass: 'LUXE' });
      expect(basis.get(ids.unknown)).toEqual({ country: c.country, valueClass: null });
      const reader = new PreCheckoutDepositReader(new PgDepositRailConfigReader(client));
      const notice = async (id: string) => {
        const b = basis.get(id);
        if (b === undefined) throw new Error('base absente');
        return reader.notice(b.country, b.valueClass);
      };
      expect(await notice(ids.standard)).toEqual({ status: 'GENERIC' });
      expect(await notice(ids.premium)).toEqual({ status: 'GENERIC' });
      expect(await notice(ids.luxe)).toEqual({ status: 'UNAVAILABLE' });
      expect(await notice(ids.unknown)).toEqual({ status: 'UNAVAILABLE' });
      // T70 c : montant de test deposit_amount[pays][LUXE] posé dans la transaction annulée
      await client.query('SELECT test_fixture.us225_param_version($1, $2, $3::jsonb)', [
        'deposit_amount',
        c.country,
        JSON.stringify({ LUXE: t70c.toString() }),
      ]);
      expect(await notice(ids.luxe)).toEqual({ status: 'REQUIRED', amountMinor: t70c });
      expect(await notice(ids.premium)).toEqual({ status: 'GENERIC' });
      expect(await notice(ids.unknown)).toEqual({ status: 'UNAVAILABLE' });
    });
  });
});
