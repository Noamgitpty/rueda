/**
 * Signalement au back-office des blocs de contenu à revoir (US-121, critère 2 : « un bloc publié
 * en es sans traduction en ⇒ signalement au back-office » ; 17 §3.2.13). Une vue = une langue
 * dans chaque locale configurée ; textes attendus : catalogue @rueda/i18n (es fait foi).
 */
import { CATALOGS, createTranslator } from '@rueda/i18n';
import { findForeignStrings } from '@rueda/i18n/testing';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LOCALE_CONFIG } from '../../locale-config.ts';
import { gapsOf } from './api.ts';
import { ConsoleView } from './view.tsx';
import type { ConsoleHandlers, ConsoleState } from './view.tsx';

const noop: ConsoleHandlers = {
  onLogin: () => undefined,
  onReveal: () => undefined,
  onVerify: () => undefined,
  onAction: () => undefined,
  onSignOut: () => undefined,
  onApprove: () => undefined,
};

const state = (contentGaps: Extract<ConsoleState, { kind: 'console' }>['contentGaps']) =>
  ({
    kind: 'console',
    roles: [{ role: 'ADMIN', countries: ['AA', 'BB'] }],
    entries: [],
    contentGaps,
  }) as const;

const render = (s: ConsoleState, tag: string): string => {
  const profile = LOCALE_CONFIG.locales.find((p) => p.tag === tag);
  if (profile === undefined) throw new Error(tag);
  return renderToStaticMarkup(
    <ConsoleView i18n={createTranslator(profile)} state={s} handlers={noop} />,
  );
};

const GAPS = [
  { key: 'home.hero.title', country: null, editable: true, missing: ['en', 'fr'], invalid: [] },
  { key: 'home.owner.body', country: 'AA', editable: true, missing: [], invalid: ['pt'] },
];

describe('blocs à revoir : affichés, traduits, jamais muets', () => {
  const es = CATALOGS.es.messages;
  const tag = LOCALE_CONFIG.locales.find((p) => p.language === 'es')?.tag ?? '';

  it('bloc publié en es sans en ni fr : nommé avec les langues absentes', () => {
    const out = render(state(GAPS), tag);
    expect(out).toContain('2 textos publicados necesitan revisión');
    expect(out).toContain(es['backoffice.content.gaps.hint']);
    // langues nommées dans la langue de la vue (oracle : Intl.DisplayNames de Node, CLDR)
    expect(out).toContain('home.hero.title · común: falta inglés, francés');
    expect(out).toContain('home.owner.body · AA: formato no permitido (portugués)');
    expect(out).not.toMatch(/falta en,/);
  });

  it('clé hors registre : message propre, sans tiret ni langue', () => {
    const out = render(
      state([{ key: 'home.old.title', country: null, editable: false, missing: [], invalid: [] }]),
      tag,
    );
    expect(out).toContain(
      'home.old.title · común: esta clave no es un texto editable; nunca se muestra.',
    );
    expect(out).not.toContain('(—)');
  });

  it('rien à signaler, ou rôle sans brand.edit : rien n’est affiché ; échec de lecture : signalé', () => {
    for (const gaps of [[], undefined]) {
      expect(render(state(gaps), tag)).not.toContain('revisión');
    }
    expect(render(state('error'), tag)).toContain(es['backoffice.content.gaps.error']);
  });

  // oracle : textes attendus écrits à la main dans chaque langue (noms CLDR des langues) ; un
  // test par langue, la locale de la configuration est exigée (aucun repli silencieux sur es)
  const view = (language: 'es' | 'en' | 'fr' | 'pt'): string => {
    const profile = LOCALE_CONFIG.locales.find((p) => p.language === language);
    if (profile === undefined) throw new Error(`locale ${language} absente de la configuration`);
    return render(state(GAPS), profile.tag).replace(/<[^>]+>/g, '');
  };

  it('bandeau en espagnol (es)', () => {
    const out = view('es');
    expect(out).toContain('home.hero.title · común: falta inglés, francés');
    expect(out).toContain('home.owner.body · AA: formato no permitido (portugués)');
  });

  it('bandeau en anglais (en)', () => {
    const out = view('en');
    expect(out).toContain('home.hero.title · shared: missing English, French');
    expect(out).toContain('home.owner.body · AA: format not allowed (Portuguese)');
  });

  it('bandeau en français (fr)', () => {
    const out = view('fr');
    expect(out).toContain('home.hero.title · commun : manque anglais, français');
    expect(out).toContain('home.owner.body · AA : format non autorisé (portugais)');
  });

  it('bandeau en portugais du Brésil (pt)', () => {
    const out = view('pt');
    expect(out).toContain('home.hero.title · geral: falta inglês, francês');
    expect(out).toContain('home.owner.body · AA: formato não permitido (português)');
  });

  it.each(LOCALE_CONFIG.locales.map((p) => [p.tag, p] as const))(
    '%s : une langue',
    (t, profile) => {
      const out = render(state(GAPS), t).replace(/<[^>]+>/g, ' ');
      expect(findForeignStrings(out, profile.language)).toEqual([]);
    },
  );
});

describe('gapsOf : réponse de GET /console/content/gaps', () => {
  it('liste lue ; formes inattendues écartées ; 401 / 403 : rien ; autre échec : erreur', () => {
    expect(
      gapsOf({
        ok: true,
        body: { gaps: [...GAPS, { key: 1 }, null, { ...GAPS[0], missing: 'en' }] } as never,
      }),
    ).toEqual(GAPS);
    expect(gapsOf({ ok: true, body: {} as never })).toBe('error');
    for (const status of [401, 403]) {
      expect(
        gapsOf({ ok: false, status, code: 'FORBIDDEN', messageKey: 'common.auth.forbidden' }),
      ).toBeUndefined();
    }
    for (const status of [0, 500, 503]) {
      expect(gapsOf({ ok: false, status, code: 'X', messageKey: 'common.auth.forbidden' })).toBe(
        'error',
      );
    }
  });
});
