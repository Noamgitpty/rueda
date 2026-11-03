import type { MinorUnitAmount } from '@rueda/i18n';
import { describe, expect, it } from 'vitest';
import { Price, PriceBreakdown } from '../src/index.ts';
import fixture from './fixtures/amounts.json' with { type: 'json' };
import { LOCALES, render, textOf } from './helpers.tsx';

// Critère US-032 : « Given un montant, When le composant prix l'affiche, Then il utilise le
// formatage de US-014 (USD et PYG) ». Attendus : tableau du README de @rueda/i18n (fixture).
const cases = fixture.cases.map((c) => ({
  amount: { amountMinor: BigInt(c.amountMinor), currency: c.currency, exponent: c.exponent },
  expected: c.expected as Readonly<Record<string, string>>,
}));

describe('Price', () => {
  for (const [tag, , i18n] of LOCALES) {
    it.each(cases.map((c) => [c.amount.currency, c] as const))(`${tag} : %s`, (_code, c) => {
      const expected = c.expected[tag];
      expect(expected, `attendu manquant pour ${tag}`).toBeDefined();
      const text = textOf(
        render(<Price i18n={i18n} total={c.amount} days={3} perDay={c.amount} />),
      );
      expect(text).toContain(expected);
      expect(text).toContain(i18n.t('common.price.finalForDays', { count: 3 }));
      expect(text).toContain(i18n.t('common.price.perDay', { amount: expected as string }));
    });
  }

  it('affiche le montant reçu, sans calcul (le total ne vient pas du prix par jour)', () => {
    const [, , i18n] = LOCALES[0]!;
    const [first, second] = cases;
    const total: MinorUnitAmount = first!.amount;
    const perDay: MinorUnitAmount = { ...first!.amount, amountMinor: 1n };
    const text = textOf(render(<Price i18n={i18n} total={total} perDay={perDay} days={2} />));
    expect(text).toContain(i18n.money(total));
    expect(text).toContain(i18n.money(perDay));
    expect(second).toBeDefined();
  });

  it('prix susceptible de changer : région polie (10b UX-20)', () => {
    const [, , i18n] = LOCALES[0]!;
    const html = render(<Price i18n={i18n} total={cases[0]!.amount} days={1} live />);
    expect(html).toContain('aria-live="polite"');
  });

  it('refuse un montant en nombre flottant (formatMoney, fail-closed)', () => {
    const [, , i18n] = LOCALES[0]!;
    const bad = { amountMinor: 12.5, currency: cases[0]!.amount.currency, exponent: 2 };
    expect(() =>
      render(<Price i18n={i18n} total={bad as unknown as MinorUnitAmount} days={1} />),
    ).toThrow(TypeError);
  });
});

describe('PriceBreakdown', () => {
  it.each(LOCALES)('%s : une ligne par poste, total donné tel quel', (_tag, _p, i18n) => {
    const amount = cases[1]!.amount;
    const html = render(
      <PriceBreakdown
        i18n={i18n}
        open
        lines={[
          { id: 'a', label: 'A', amount },
          { id: 'b', label: 'B', amount: { ...amount, amountMinor: -amount.amountMinor } },
        ]}
        total={{ ...amount, amountMinor: 0n }}
      />,
    );
    expect(html).toContain('<details');
    expect(html).toContain(' open=""');
    expect((html.match(/<dt>/g) ?? []).length).toBe(3);
    expect(textOf(html)).toContain(i18n.money({ ...amount, amountMinor: -amount.amountMinor }));
    expect(textOf(html)).toContain(i18n.t('common.price.total'));
  });
});
