/** Cas de test par pays configuré, pour les tests d'intégration (copie de doubles.test-support.ts). */
import { readFileSync } from 'node:fs';

export interface CountryCase {
  readonly country: string;
  readonly currency: string;
  /** 120 unités de la devise, en unités mineures (chaîne bigint). */
  readonly amountMinor: string;
}

/**
 * Cas de test par pays configuré (CLAUDE.md point 3 : USD et PYG sans décimale), lus dans les
 * données de configuration pays (apps/api/src/modules/cfg/data, US-013 ; ADR-024) et non écrits
 * en constantes : lecture de fichier de données, pas un import du module CFG.
 */
export function countryCases(): CountryCase[] {
  const read = (file: string): unknown =>
    JSON.parse(
      readFileSync(new URL(`../../src/modules/cfg/data/${file}`, import.meta.url), 'utf8'),
    );
  const countries = (read('countries.json') as { countries: { code: string; currency: string }[] })
    .countries;
  const currencies = (
    read('currencies.json') as { currencies: { code: string; exponent: number }[] }
  ).currencies;
  return countries.map((c) => {
    const exponent = currencies.find((x) => x.code === c.currency)?.exponent;
    if (exponent === undefined) throw new Error(`devise sans exposant : ${c.currency}`);
    return {
      country: c.code,
      currency: c.currency,
      amountMinor: (120n * 10n ** BigInt(exponent)).toString(),
    };
  });
}
