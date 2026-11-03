/** Lecture fail-closed de l'export : toute forme inattendue est refusée (US-016). */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GOLDEN_VECTORS_PATH,
  GoldenVectorsError,
  decodeValue,
  parseGoldenVectors,
  settlementVector,
} from '../../src/golden-vectors/index.ts';

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const raw = (): Raw => JSON.parse(readFileSync(GOLDEN_VECTORS_PATH, 'utf8')) as Raw;
const rejects = (mutate: (d: Raw) => void): void => {
  const d = raw();
  mutate(d);
  expect(() => parseGoldenVectors(d)).toThrow(GoldenVectorsError);
};

describe('parseGoldenVectors', () => {
  it('accepte l’export commité', () => {
    expect(() => parseGoldenVectors(raw())).not.toThrow();
  });

  it('refuse un montant écrit comme nombre JSON', () => {
    rejects((d) => (d.settlement[0].expected.guestRefundMinor = 25666));
  });

  it('refuse un montant décimal', () => {
    rejects((d) => (d.settlement[0].expected.guestRefundMinor = '256.66'));
  });

  it('refuse « -0 » et un zéro de tête', () => {
    rejects((d) => (d.legs[0].legsMinor.HOST = '-0'));
    rejects((d) => (d.legs[0].legsMinor.HOST = '013125'));
  });

  it('refuse une clé inconnue', () => {
    rejects((d) => (d.settlement[0].expected.bonusMinor = '1'));
  });

  it('refuse une clé manquante', () => {
    rejects((d) => delete d.legs[0].legsMinor.INSURER);
  });

  it('refuse une devise absente du bloc currencies', () => {
    rejects((d) => (d.legs[0].currency = 'EUR'));
  });

  it('refuse un exposant non entier', () => {
    rejects((d) => (d.currencies.PYG.exponent = 0.5));
  });

  it('refuse un identifiant en double', () => {
    rejects((d) => d.settlement.push(d.settlement[0]));
  });

  it('refuse un format inconnu', () => {
    rejects((d) => (d.format = 2));
  });

  it('refuse un vecteur non normatif sans raison', () => {
    rejects((d) => {
      const v = (d.settlement as Raw[]).find((x) => x.id === 'T48');
      if (v) delete v.nonNormativeReason;
    });
  });

  it('refuse une fraction mal formée, un tarif ou une nature TJ inconnus', () => {
    rejects((d) => (d.settlement[0].trip.hostSharePct = '0.75'));
    rejects((d) => (d.settlement[0].trip.rate = 'FLEX'));
    rejects((d) => (d.legs[0].kind = 'OTHER'));
  });

  it('refuse un événement sans horodatage', () => {
    rejects((d) => delete d.settlement[0].event.requestedAtMinutes);
  });
});

describe('decodeValue', () => {
  it('décode entiers, fractions, listes et objets sans perte', () => {
    expect(
      decodeValue([
        { $int: '-11844' },
        { $ratio: '70/1' },
        'SENT',
        true,
        null,
        { a: { $int: '1' } },
      ]),
    ).toEqual([-11844n, { numerator: 70n, denominator: 1n }, 'SENT', true, null, { a: 1n }]);
  });

  it('refuse un nombre JSON nu et une clé réservée inconnue', () => {
    expect(() => decodeValue(12)).toThrow(GoldenVectorsError);
    expect(() => decodeValue({ $float: '1.5' })).toThrow(GoldenVectorsError);
  });
});

describe('accès par identifiant', () => {
  it('un identifiant absent lève GOLDEN_VECTOR_NOT_FOUND', () => {
    const set = parseGoldenVectors(raw());
    expect(() => settlementVector(set, 'T99')).toThrow(/GOLDEN_VECTOR_NOT_FOUND/);
  });
});
