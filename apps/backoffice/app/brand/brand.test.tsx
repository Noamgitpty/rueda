/**
 * Écran « Apparence / Marque » (US-120, O02), rendu et logique, sans réseau :
 *
 * - critère 1 : un brouillon à la palette modifiée se prévisualise dans S01, S03, S05, A02 et un
 *   e-mail, en clair et en sombre, par des variables portées par les cadres (jamais `:root`) :
 *   la page et la production ne changent pas ;
 * - critère 2 : une palette sous le contraste AA est signalée avant publication et le refus de
 *   publication nomme la paire en cause (oracle : README de @rueda/design-tokens, Lienzo · Azur
 *   refusée, « lien primary sur verre 3,89:1 (clair) ») ;
 * - critère 3 : le retour arrière est un bouton de l'historique (l'API journalise, test d'API) ;
 * - N-46 : un refus de texte juridique cite le mot déclencheur et le refus du ZWJ est expliqué,
 *   dans les quatre langues ;
 * - images : taille bornée (64 Kio, `assetMaxBytes` d'US-034) et type réel lu dans les octets.
 *
 * Une vue = une langue : aucun texte d'une autre langue (findForeignStrings). Textes attendus :
 * catalogue @rueda/i18n (es fait foi).
 */
import { DEFAULT_SELECTION, paletteDocument } from '@rueda/design-tokens';
import { createTranslator, EDITABLE_BLOCKS } from '@rueda/i18n';
import type { Translator } from '@rueda/i18n';
import { findForeignStrings } from '@rueda/i18n/testing';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LOCALE_CONFIG } from '../../locale-config.ts';
import {
  ASSET_MAX_BYTES,
  bodyIssue,
  checkDraft,
  draftTokens,
  failuresOf,
  fontChoices,
  initialDraft,
  legalTrigger,
  logoDataUri,
  precheckAsset,
  sniffImage,
  versionsOf,
  ZWJ,
} from './brand-logic.ts';
import type { DraftEdits, VersionView } from './brand-logic.ts';
import { BrandView } from './brand-view.tsx';
import type { BrandHandlers, BrandScreenState, ContentEditor } from './brand-view.tsx';
import { BrandPreview, PREVIEW_SCREENS } from './preview.tsx';

const noop: BrandHandlers = {
  onBase: () => undefined,
  onBrandName: () => undefined,
  onColor: () => undefined,
  onFont: () => undefined,
  onLogoFile: () => undefined,
  onSaveDraft: () => undefined,
  onPublish: () => undefined,
  onRollback: () => undefined,
  onPreview: () => undefined,
  onAsset: () => undefined,
  onContentKey: () => undefined,
  onContentBody: () => undefined,
  onContentPublish: () => undefined,
  onContentRollback: () => undefined,
};

const LANGS = ['es', 'en', 'fr', 'pt'] as const;
const translator = (language: string): Translator => {
  const profile = LOCALE_CONFIG.locales.find((p) => p.language === language);
  if (profile === undefined) throw new Error(language);
  return createTranslator(profile);
};

const VERSIONS: VersionView[] = [
  {
    id: '01200000-0000-4000-8000-000000000002',
    versionNo: 2,
    status: 'DRAFT',
    brandName: 'Kmino',
    tokens: paletteDocument('lienzo-tinta'),
    createdAt: '2026-11-13T10:00:00.000Z',
    publishedAt: null,
  },
  {
    id: '01200000-0000-4000-8000-000000000001',
    versionNo: 1,
    status: 'PUBLISHED',
    brandName: 'Kmino',
    tokens: paletteDocument('lienzo-tinta'),
    createdAt: '2026-11-12T10:00:00.000Z',
    publishedAt: '2026-11-12T11:00:00.000Z',
  },
];

const editor = (over: Partial<ContentEditor> = {}): ContentEditor => ({
  key: 'home.hero.title',
  bodies: { es: 'Hola', en: 'Hello', fr: 'Bonjour', pt: 'Olá' },
  ...over,
});

function screenState(draft: DraftEdits, over: Partial<BrandScreenState> = {}): BrandScreenState {
  const tokens = draftTokens(draft, VERSIONS);
  return {
    access: 'ready',
    versions: VERSIONS,
    draft,
    check: checkDraft(draft, tokens),
    tokens,
    logo: { light: logoDataUri(tokens, 'logo'), dark: logoDataUri(tokens, 'logoDark') },
    preview: { mode: 'light', width: 'mobile' },
    content: editor(),
    ...over,
  };
}

const render = (state: BrandScreenState, language: string): string =>
  renderToStaticMarkup(<BrandView i18n={translator(language)} state={state} handlers={noop} />);

/** Texte tel que React l'écrit dans le HTML (apostrophes et guillemets échappés). */
const esc = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');

/**
 * Texte visible de l'interface : sans balises ni attributs, sans la feuille d'aperçu, sans les
 * saisies du fondateur (un texte par langue, chacun marqué `lang`) ni les noms propres des
 * polices (« Archivo » est un nom de police, pas de l'espagnol).
 */
const interfaceText = (html: string): string =>
  html
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<textarea[\s\S]*?<\/textarea>/g, ' ')
    .replace(/<select id="o02-font-[\s\S]*?<\/select>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');

/** Couleur d'action d'une autre palette US-028 (aucune couleur écrite dans le code). */
const OTHER_PRIMARY = (
  paletteDocument('lienzo-grafito') as { color: { light: { primary: { $value: string } } } }
).color.light.primary.$value;

/** Brouillon : palette par défaut, couleur d'action retouchée en clair (saisie en minuscules). */
const touched: DraftEdits = {
  ...initialDraft([], DEFAULT_SELECTION.palette),
  colors: { light: { primary: OTHER_PRIMARY.toLowerCase() }, dark: {} },
};

describe('critère 1 : aperçu en direct, sans toucher la production', () => {
  it('la couleur retouchée est posée sur les cadres d’aperçu, jamais sur :root', () => {
    const tokens = draftTokens(touched, []);
    const check = checkDraft(touched, tokens);
    expect(check.failures).toEqual([]);
    const html = renderToStaticMarkup(
      <BrandPreview
        i18n={translator('es')}
        theme={check.theme}
        brandName="Kmino"
        logo={{ light: undefined, dark: undefined }}
        mode="light"
        width="mobile"
      />,
    );
    expect(html).toContain('[data-brand-preview="light"]{color-scheme:light;');
    expect(html).toContain(`--color-primary:${OTHER_PRIMARY.toUpperCase()};`);
    expect(html).not.toContain(':root');
    for (const screen of PREVIEW_SCREENS) {
      expect(html).toMatch(
        new RegExp(`data-brand-preview="light" class="[^"]*" data-screen="${screen}"`),
      );
    }
    // cadres inertes : rien n'est cliquable ni focalisable dans la maquette
    expect(html.match(/ inert=""/g)).toHaveLength(PREVIEW_SCREENS.length);
  });

  it('mode sombre : les cadres passent en sombre', () => {
    const check = checkDraft(touched, draftTokens(touched, []));
    const html = renderToStaticMarkup(
      <BrandPreview
        i18n={translator('en')}
        theme={check.theme}
        brandName="Kmino"
        logo={{ light: undefined, dark: undefined }}
        mode="dark"
        width="desktop"
      />,
    );
    expect(html.match(/data-brand-preview="dark" class=/g)).toHaveLength(PREVIEW_SCREENS.length);
  });

  it('le registre des palettes n’est pas modifié par un brouillon (copie profonde)', () => {
    const before = JSON.stringify(paletteDocument(DEFAULT_SELECTION.palette));
    draftTokens(touched, []);
    expect(JSON.stringify(paletteDocument(DEFAULT_SELECTION.palette))).toBe(before);
  });

  it('nom, police et logo du brouillon sont écrits dans les jetons', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect width="4" height="4"/></svg>';
    const font = fontChoices()[0] as string;
    const tokens = draftTokens(
      { ...touched, brandName: ' Rueda ', fonts: { heading: font }, logos: { logo: svg } },
      [],
    ) as {
      brand: { name: { $value: string }; logo: { $value: string } };
      font: { family: { heading: { $value: string[] } } };
    };
    expect(tokens.brand.name.$value).toBe('Rueda');
    expect(tokens.brand.logo.$value).toBe(svg);
    expect(tokens.font.family.heading.$value[0]).toBe(font);
    expect(logoDataUri(tokens, 'logo')).toBe(`data:image/svg+xml,${encodeURIComponent(svg)}`);
  });

  it('logo SVG avec script : signalé, jamais montré', () => {
    const bad = '<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>';
    const draft = { ...touched, logos: { logo: bad } };
    const tokens = draftTokens(draft, []);
    expect(checkDraft(draft, tokens).logoInvalid).toBe(true);
    expect(logoDataUri(tokens, 'logo')).toBeUndefined();
  });

  it('couleur mal formée : champ en erreur, valeur ignorée pour l’aperçu', () => {
    const draft = { ...touched, colors: { light: { primary: '#12' }, dark: {} } };
    const check = checkDraft(draft, draftTokens(draft, []));
    expect(check.invalidColors).toEqual(['light:primary']);
    expect(check.formatProblems).toEqual([]);
  });

  it('point de départ : la version publiée, sinon la palette par défaut', () => {
    expect(initialDraft(VERSIONS, 'lienzo-tinta').base).toEqual({
      kind: 'version',
      id: VERSIONS[1]?.id,
    });
    expect(initialDraft([], 'lienzo-tinta').base).toEqual({ kind: 'palette', id: 'lienzo-tinta' });
  });
});

describe('critère 2 : contraste contrôlé avant publication, paire nommée au refus', () => {
  const azur: DraftEdits = {
    ...touched,
    base: { kind: 'palette', id: 'lienzo-azur' },
    colors: { light: {}, dark: {} },
  };

  it('Lienzo · Azur : primary / glass sous 4,5:1 en clair (oracle README design-tokens : 3,89:1)', () => {
    const failures = checkDraft(azur, draftTokens(azur, [])).failures;
    expect(failures).toContainEqual(
      expect.objectContaining({ mode: 'light', pair: 'primary / glass', ratio: 3.89, min: 4.5 }),
    );
  });

  it.each(LANGS)('alerte avant publication et refus nommant la paire (%s)', (language) => {
    const refused = failuresOf({
      failures: [{ mode: 'light', pair: 'primary / glass', ratio: 3.89, min: 4.5, why: 'x' }],
    });
    const html = render(screenState(azur, { refusedPairs: refused }), language);
    const t = translator(language);
    expect(html).toContain(esc(t.t('backoffice.o02.publish.refused')));
    expect(html).toContain(
      esc(
        t.t('backoffice.o02.contrast.pair', {
          pair: 'primary / glass',
          mode: t.t('backoffice.o02.mode.light'),
          ratio: new Intl.NumberFormat(t.profile.tag, { maximumFractionDigits: 2 }).format(3.89),
          min: new Intl.NumberFormat(t.profile.tag, { maximumFractionDigits: 2 }).format(4.5),
        }),
      ),
    );
    expect(html).toContain(
      esc(
        t.t('backoffice.o02.contrast.failing', {
          count: checkDraft(azur, draftTokens(azur, [])).failures.length,
        }),
      ),
    );
  });

  it('refus sans détail exploitable : aucune paire inventée', () => {
    expect(failuresOf(undefined)).toEqual([]);
    expect(failuresOf({ failures: [{ pair: 1 }] })).toEqual([]);
  });

  it('les palettes sous le contraste sont signalées dans le choix du point de départ', () => {
    const html = render(screenState(touched), 'es');
    expect(html).toContain(
      esc(
        translator('es').t('backoffice.o02.draft.fromPaletteFailing', { palette: 'lienzo-azur' }),
      ),
    );
  });
});

describe('critère 3 et historique', () => {
  it.each(LANGS)(
    'historique, publication d’un brouillon et retour arrière en un clic (%s)',
    (language) => {
      const html = render(screenState(touched), language);
      const t = translator(language);
      expect(html).toContain(esc(t.t('backoffice.o02.rollback.action')));
      expect(html).toContain(esc(t.t('backoffice.o02.history.publish', { no: 2 })));
      expect(html).toContain(esc(t.t('backoffice.o02.status.PUBLISHED')));
      // un seul bouton « publier » : pour le brouillon, pas pour la version publiée
      expect(html).not.toContain(esc(t.t('backoffice.o02.history.publish', { no: 1 })));
    },
  );

  it('aucune version publiée : le thème par défaut est annoncé (10b O02, noVersion)', () => {
    const html = render(screenState(touched, { versions: [VERSIONS[0] as VersionView] }), 'es');
    expect(html).toContain(esc(translator('es').t('backoffice.o02.noVersion')));
  });

  it('lecture de l’historique : formes inattendues écartées', () => {
    expect(versionsOf({ versions: [{ id: 1 }, ...VERSIONS] })).toHaveLength(2);
    expect(versionsOf({})).toBeNull();
  });

  it('accès refusé (pas ADMIN, pas de session élevée) : aucun formulaire', () => {
    const html = render(screenState(touched, { access: 'denied' }), 'es');
    expect(html).toContain(esc(translator('es').t('backoffice.o02.denied')));
    expect(html).not.toContain('<form');
  });
});

describe('N-46 : refus des textes expliqués dans les quatre langues', () => {
  it('mot déclencheur d’un texte juridique (motif LEGAL_BLOCK_KEY)', () => {
    expect(legalTrigger('help.terminos_uso')).toBe('terminos');
    expect(legalTrigger('trip.seguro')).toBe('seguro');
    expect(legalTrigger('footer.cookies')).toBe('cookies');
    expect(legalTrigger('home.hero.title')).toBeNull();
    // aucune clé du registre n'est juridique (même motif qu'à l'API et en base)
    for (const key of Object.keys(EDITABLE_BLOCKS)) expect(legalTrigger(key), key).toBeNull();
  });

  it('ZWJ (émoji composé) : motif propre ; vide ; trop long ; autre format', () => {
    const block = EDITABLE_BLOCKS['home.hero.title'];
    expect(bodyIssue(`Familia 👨${ZWJ}👩${ZWJ}👧`, block)).toBe('zwj');
    expect(bodyIssue('   ', block)).toBe('blank');
    expect(bodyIssue('a'.repeat(block.maxLength + 1), block)).toBe('tooLong');
    expect(bodyIssue('une\ndeux', block)).toBe('format');
    expect(bodyIssue('Alquila un auto 🚗', block)).toBeNull();
  });

  it.each(LANGS)('le mot est cité et le ZWJ expliqué (%s)', (language) => {
    const t = translator(language);
    const legal = render(
      screenState(touched, { content: editor({ refusal: { kind: 'legal', word: 'terminos' } }) }),
      language,
    );
    expect(legal).toContain(esc(t.t('backoffice.o02.content.legal', { word: 'terminos' })));
    expect(legal).toContain('terminos');
    const zwj = render(
      screenState(touched, {
        content: editor({ refusal: { kind: 'body', issues: [{ locale: 'pt', issue: 'zwj' }] } }),
      }),
      language,
    );
    const pt = new Intl.DisplayNames([t.profile.tag], { type: 'language' }).of('pt') ?? 'pt';
    expect(zwj).toContain(esc(t.t('backoffice.o02.content.zwj', { language: pt })));
    expect(zwj).toContain('ZWJ');
  });
});

describe('images de marque : taille et type réel avant l’envoi', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  it('PNG, JPEG, WebP reconnus ; SVG et inconnu refusés', () => {
    expect(sniffImage(png)).toBe('image/png');
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    const webp = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ');
    expect(sniffImage(webp)).toBe('image/webp');
    expect(sniffImage(new TextEncoder().encode('<svg xmlns="x"/>'))).toBeNull();
  });

  it('vide, trop gros (au-delà de 64 Kio) ou mauvais type : refusé avant l’envoi', () => {
    expect(ASSET_MAX_BYTES).toBe(65_536);
    expect(precheckAsset(new Uint8Array())).toBe('empty');
    const big = new Uint8Array(ASSET_MAX_BYTES + 1);
    big.set(png);
    expect(precheckAsset(big)).toBe('tooBig');
    expect(precheckAsset(new TextEncoder().encode('GIF89a'))).toBe('badType');
    expect(precheckAsset(png)).toBe('ok');
  });
});

describe('une vue = une langue', () => {
  it.each(LANGS)('écran complet rendu en %s : aucune chaîne d’une autre langue', (language) => {
    const html = render(screenState(touched), language);
    expect(findForeignStrings(interfaceText(html), language)).toEqual([]);
  });
});
