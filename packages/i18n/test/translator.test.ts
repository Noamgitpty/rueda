import { describe, expect, it } from 'vitest';
import {
  MissingVariableError,
  UnknownMessageKeyError,
  createTranslator,
  formatNumber,
} from '../src/index.ts';
import type { MessageKey } from '../src/index.ts';
import { amount, profile, tz } from './helpers.ts';

const NBSP = String.fromCodePoint(0xa0);
const NNBSP = String.fromCodePoint(0x202f);

describe('createTranslator', () => {
  it('es-PA et es-PY lisent le catalogue es, en le catalogue en', () => {
    expect(createTranslator(profile('es-PA')).t('backoffice.meta.description')).toBe(
      'Consola interna.',
    );
    expect(createTranslator(profile('es-PY')).t('backoffice.meta.description')).toBe(
      'Consola interna.',
    );
    expect(createTranslator(profile('en')).t('backoffice.meta.description')).toBe(
      'Internal console.',
    );
  });

  it('interpole les variables sans les réinterpréter', () => {
    const t = createTranslator(profile('es-PA')).t;
    expect(t('backoffice.meta.title', { brand: '{brand_name}' })).toBe(
      '{brand_name} — administración',
    );
  });

  it('variable manquante : erreur, jamais « {x} » affiché (17 §1.4)', () => {
    const t = createTranslator(profile('en')).t;
    expect(() => t('backoffice.meta.title')).toThrow(MissingVariableError);
  });

  it('clé inconnue : erreur', () => {
    const t = createTranslator(profile('en')).t;
    expect(() => t('nope.key' as MessageKey)).toThrow(UnknownMessageKeyError);
  });

  it('pluriels (UX-15 « Precio final · {n} días »), nombre formaté selon la locale', () => {
    const es = createTranslator(profile('es-PA')).t;
    const en = createTranslator(profile('en')).t;
    expect(es('common.price.finalForDays', { count: 1 })).toBe('Precio final · 1 día');
    expect(es('common.price.finalForDays', { count: 3 })).toBe('Precio final · 3 días');
    expect(es('common.price.finalForDays', { count: 0 })).toBe('Precio final · 0 días');
    expect(en('common.price.finalForDays', { count: 1 })).toBe('Final price · 1 day');
    expect(en('common.price.finalForDays', { count: 1200n })).toBe('Final price · 1,200 days');
    // Catégorie CLDR « many » de l'espagnol (1 000 000) absente du catalogue : repli sur « other ».
    expect(es('common.price.finalForDays', { count: 1000000 })).toBe(
      'Precio final · 1.000.000 días',
    );
  });

  it('pluriels français (CLDR : « one » pour 0 et 1), DEC-FONDATEUR-17', () => {
    const fr = createTranslator(profile('fr')).t;
    expect(fr('common.price.finalForDays', { count: 0 })).toBe('Prix final · 0 jour');
    expect(fr('common.price.finalForDays', { count: 1 })).toBe('Prix final · 1 jour');
    expect(fr('common.price.finalForDays', { count: 2 })).toBe('Prix final · 2 jours');
    expect(fr('common.price.finalForDays', { count: 1n })).toBe('Prix final · 1 jour');
    // « many » (1 000 000) absente du catalogue : repli sur « other » ; espace fine insécable.
    expect(fr('common.price.finalForDays', { count: 1000000 })).toBe(
      `Prix final · 1${NNBSP}000${NNBSP}000 jours`,
    );
  });

  it('français : catalogue fr, variables et formats de la locale fr', () => {
    const i18n = createTranslator(profile('fr'));
    expect(i18n.t('backoffice.meta.description')).toBe('Console interne.');
    expect(i18n.t('common.locale.current', { language: 'Français' })).toBe(
      `Langue actuelle${NBSP}: Français`,
    );
    expect(i18n.number(1234567)).toBe(`1${NNBSP}234${NNBSP}567`);
    expect(i18n.dateTime('2026-01-10T15:05:00Z', tz('America/Asuncion'))).toBe('10/01/2026 12:05');
    expect(i18n.time('2026-01-10T15:05:00Z', tz('America/Panama'))).toBe('10:05');
  });

  it('pluriel sans « count » entier : erreur', () => {
    const t = createTranslator(profile('es-PA')).t;
    expect(() => t('common.price.finalForDays')).toThrow(RangeError);
    expect(() => t('common.price.finalForDays', { count: 1.5 })).toThrow(RangeError);
  });

  it('surcharge régionale prioritaire, le reste vient du catalogue de la langue', () => {
    const t = createTranslator(profile('es-PY'), { 'web.home.tagline': 'Texto regional.' }).t;
    expect(t('web.home.tagline')).toBe('Texto regional.');
    expect(t('backoffice.meta.description')).toBe('Consola interna.');
  });

  it('expose les formats de la locale', () => {
    const i18n = createTranslator(profile('es-PY'));
    expect(i18n.money(amount(1050000n, 'PYG'))).toBe('₲ 1.050.000');
    expect(i18n.number(1234567)).toBe('1.234.567');
    expect(i18n.dateTime('2026-01-10T15:05:00Z', tz('America/Asuncion'))).toBe('10/01/2026 12:05');
    expect(i18n.date('2026-01-10T15:05:00Z', tz('America/Asuncion'))).toBe('10/01/2026');
    expect(i18n.time('2026-01-10T15:05:00Z', tz('America/Asuncion'))).toBe('12:05');
  });
});

describe('formatNumber (quantités non monétaires)', () => {
  it('séparateurs du profil', () => {
    expect(formatNumber(1234567, profile('es-PA').number)).toBe('1.234.567');
    expect(formatNumber(1234567, profile('en').number)).toBe('1,234,567');
    expect(formatNumber(12.5, profile('es-PY').number, { fractionDigits: 1 })).toBe('12,5');
    expect(formatNumber(-4321n, profile('en').number)).toBe('-4,321');
    expect(formatNumber(999, profile('en').number)).toBe('999');
  });

  it('regroupement à partir de deux chiffres (option de profil)', () => {
    const p = { group: '.', decimal: ',', minimumGroupingDigits: 2 as const };
    expect(formatNumber(1234, p)).toBe('1234');
    expect(formatNumber(12345, p)).toBe('12.345');
  });

  it('pas de « -0 » ; refuse l’infini', () => {
    expect(formatNumber(-0.2, profile('en').number)).toBe('0');
    expect(() => formatNumber(Number.POSITIVE_INFINITY, profile('en').number)).toThrow(RangeError);
  });
});
