/**
 * Blocs de contenu éditables (US-121, ADR-095), côté API, avec un magasin en mémoire.
 *
 * Attendus (jamais le code testé) : 19 US-121 (critères 1 à 3), 17 §3.2.13 (`content_block` :
 * Markdown restreint, liens internes seulement, `legal.*` refusé, locale manquante ⇒ repli `es`
 * signalé au back-office), 10b UX-58 (aucune publication incomplète), registre
 * `EDITABLE_BLOCKS` de `@rueda/i18n`.
 */
import { EDITABLE_BLOCKS } from '@rueda/i18n';
import type { EditableBlocks } from '@rueda/i18n';
import { InMemoryFileStore } from '@rueda/fake-adapters/files';
import { describe, expect, it } from 'vitest';
import { BrandAccessError, BrandConsoleService, BrandReadService } from './brand.service.js';
import type { BrandOptions } from './brand.service.js';
import type { ContentLocale } from './checks.js';
import { BrandError } from './errors.js';
import { loadBrandParams } from './params.js';
import type { BrandStore, ContentOutcome, PublishedBlock } from './store.js';

const HASH = Buffer.alloc(32, 7);
const PARAMS = loadBrandParams();
let n = 0;
const id = (): string => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

/** Magasin minimal : blocs publiés en mémoire, appels des commandes consignés. */
class ContentStore {
  readonly calls: Array<{ method: string; key?: string; bodies?: unknown }> = [];
  readonly blocks: PublishedBlock[] = [];
  draftOutcome = 'SAVED';
  access = 'OK';

  saveContentDraft(
    _t: Buffer,
    _r: string,
    key: string,
    _c: string | null,
    bodies: unknown,
  ): Promise<ContentOutcome> {
    this.calls.push({ method: 'saveContentDraft', key, bodies });
    return Promise.resolve({ outcome: this.draftOutcome, versionNo: 1 });
  }
  publishedBlocks(country: string | null): Promise<PublishedBlock[]> {
    return Promise.resolve(
      this.blocks.filter((b) => b.countryCode === null || b.countryCode === country),
    );
  }
  allPublishedBlocks(): Promise<PublishedBlock[]> {
    return Promise.resolve([...this.blocks]);
  }
  staffReadAccess(): Promise<string> {
    this.calls.push({ method: 'staffReadAccess' });
    return Promise.resolve(this.access);
  }
}

function setup(blocks?: EditableBlocks) {
  const store = new ContentStore();
  const options: BrandOptions = {
    store: store as unknown as BrandStore,
    files: new InMemoryFileStore(),
    params: PARAMS,
    newId: id,
    nowMs: () => 0,
    ...(blocks !== undefined ? { blocks } : {}),
  };
  const read = new BrandReadService(options);
  return { store, read, console: new BrandConsoleService(options, read) };
}

const block = (
  blockKey: string,
  locale: ContentLocale,
  bodyMd: string,
  countryCode: string | null = null,
  versionNo = 1,
): PublishedBlock => ({ blockKey, locale, countryCode, versionNo, bodyMd, assetId: null });

const ALL = (key: string, prefix: string, country: string | null = null, v = 1) =>
  (['es', 'en', 'fr', 'pt'] as const).map((l) => block(key, l, `${prefix} ${l}`, country, v));

async function rejection(p: Promise<unknown>): Promise<BrandError> {
  try {
    await p;
  } catch (error) {
    if (error instanceof BrandError) return error;
    throw error;
  }
  throw new Error('aucune erreur');
}

describe('critère 1 — bloc publié : servi dans la langue demandée, arbre assaini', () => {
  it('format plain : le texte publié, tel quel, dans chaque langue ; aucun HTML rendu', async () => {
    const { store, read } = setup();
    store.blocks.push(...ALL('home.hero.title', 'Nuevo título'));
    for (const locale of ['es', 'en', 'fr', 'pt'] as const) {
      const [view] = await read.publishedContent(locale, null);
      expect(view).toMatchObject({
        key: 'home.hero.title',
        locale,
        fallback: false,
        format: 'plain',
        doc: { format: 'plain', text: `Nuevo título ${locale}` },
      });
    }
  });

  it('format rich : paragraphes, gras, liens internes ; balise gardée comme texte', async () => {
    const { store, read } = setup();
    store.blocks.push(
      block('home.owner.body', 'es', 'Gana **más**.\n\n- Ver [cómo](/hosts) <b>x</b>'),
    );
    const [view] = await read.publishedContent('es', null);
    expect(view?.doc).toEqual({
      format: 'rich',
      blocks: [
        {
          t: 'p',
          c: [
            { t: 'text', v: 'Gana ' },
            { t: 'strong', v: 'más' },
            { t: 'text', v: '.' },
          ],
        },
        {
          t: 'ul',
          items: [
            [
              { t: 'text', v: 'Ver ' },
              { t: 'link', v: 'cómo', href: '/hosts' },
              { t: 'text', v: ' <b>x</b>' },
            ],
          ],
        },
      ],
    });
  });

  it('clé hors du registre : jamais servie ; corps qui ne passe plus les règles : ignoré', async () => {
    const { store, read } = setup();
    store.blocks.push(
      ...ALL('home.unknown.title', 'Inconnu'),
      // publié avant une règle plus stricte (plain sur plusieurs lignes) : pas servi en es
      block('home.hero.subtitle', 'es', 'Ligne 1\nLigne 2'),
      block('home.hero.subtitle', 'en', 'One line'),
    );
    expect(await read.publishedContent('fr', null)).toEqual([]);
    expect(await read.publishedContent('en', null)).toEqual([
      expect.objectContaining({ key: 'home.hero.subtitle', locale: 'en', fallback: false }),
    ]);
    expect(await read.publishedContent('es', null)).toEqual([]);
  });
});

describe('critère 2 — publié en es sans en : repli signalé au back-office, jamais un bloc vide', () => {
  it('lecture en : version es servie, marquée fallback (le site affiche alors le catalogue en)', async () => {
    const { store, read } = setup();
    store.blocks.push(block('home.hero.title', 'es', 'Solo en español'));
    expect(await read.publishedContent('en', null)).toEqual([
      expect.objectContaining({ key: 'home.hero.title', locale: 'es', fallback: true }),
    ]);
  });

  it('signalement : langues absentes et corps hors règles, par clé et par pays ; clé hors registre', async () => {
    const { store, console } = setup();
    store.blocks.push(
      block('home.hero.title', 'es', 'Solo es', null, 3),
      ...ALL('home.hero.title', 'Pays', 'XX', 2),
      ...ALL('home.how.title', 'Completo'),
      block('home.hero.subtitle', 'es', 'a\nb'),
      block('home.hero.subtitle', 'en', 'ok'),
      block('home.hero.subtitle', 'fr', 'ok'),
      block('home.hero.subtitle', 'pt', 'ok'),
      ...ALL('home.old.title', 'Ancien'),
    );
    expect(await console.contentGaps(HASH)).toEqual([
      {
        key: 'home.hero.subtitle',
        country: null,
        versionNo: 1,
        editable: true,
        missing: [],
        invalid: ['es'],
      },
      {
        key: 'home.hero.title',
        country: null,
        versionNo: 3,
        editable: true,
        missing: ['en', 'fr', 'pt'],
        invalid: [],
      },
      {
        key: 'home.old.title',
        country: null,
        versionNo: 1,
        editable: false,
        missing: [],
        invalid: [],
      },
    ]);
  });

  it('signalement réservé à brand.edit (refus de la base relayé, jamais une liste vide)', async () => {
    for (const outcome of ['AUTH_REQUIRED', 'MFA_REQUIRED', 'FORBIDDEN', 'INATTENDU']) {
      const { store, console } = setup();
      store.access = outcome;
      store.blocks.push(block('home.hero.title', 'es', 'x'));
      await expect(console.contentGaps(HASH)).rejects.toBeInstanceOf(BrandAccessError);
    }
  });
});

describe('critère 3 — texte juridique : refusé, il reste un document_template', () => {
  it.each(['legal.terms.body', 'page.cgu.body', 'trip.contract.body', 'help.cancellation_policy'])(
    '%s : CONTENT_KEY_FORBIDDEN, la base est appelée sans corps (refus journalisé)',
    async (key) => {
      const { store, console } = setup();
      store.draftOutcome = 'KEY_FORBIDDEN';
      const e = await rejection(
        console.saveContentDraft(HASH, id(), key, null, { es: 'a', en: 'b', fr: 'c', pt: 'd' }),
      );
      expect(e.code).toBe('CONTENT_KEY_FORBIDDEN');
      expect(store.calls).toEqual([{ method: 'saveContentDraft', key, bodies: {} }]);
    },
  );

  it('texte juridique, staff sans droit : refus d’accès (401 / 403), pas un 422', async () => {
    const { store, console } = setup();
    store.draftOutcome = 'FORBIDDEN';
    await expect(
      console.saveContentDraft(HASH, id(), 'legal.terms', null, {}),
    ).rejects.toBeInstanceOf(BrandAccessError);
  });

  it('publication et retour arrière d’une clé juridique : refusés avant la base', async () => {
    const { store, console } = setup();
    expect(
      (await rejection(console.publishContent(HASH, id(), 'page.cgu.body', null, 1))).code,
    ).toBe('CONTENT_KEY_FORBIDDEN');
    expect((await rejection(console.rollbackContent(HASH, id(), 'page.cgu.body', null))).code).toBe(
      'CONTENT_KEY_FORBIDDEN',
    );
    expect(store.calls).toEqual([]);
  });
});

describe('brouillon : liste blanche du registre avant la base', () => {
  const FOUR = { es: 'Hola', en: 'Hello', fr: 'Salut', pt: 'Olá' };

  it('clé hors du registre : CONTENT_KEY_NOT_EDITABLE, rien n’est écrit', async () => {
    const { store, console } = setup();
    const e = await rejection(console.saveContentDraft(HASH, id(), 'home.nope.title', null, FOUR));
    expect(e.code).toBe('CONTENT_KEY_NOT_EDITABLE');
    expect(store.calls).toEqual([]);
  });

  it.each([
    ['plain sur deux lignes', 'home.hero.title', 'Hola\nmundo'],
    [
      'plain trop long',
      'home.hero.title',
      'x'.repeat(EDITABLE_BLOCKS['home.hero.title'].maxLength + 1),
    ],
    ['rich : lien externe', 'home.owner.body', 'Ver [aquí](https://example.test)'],
    ['rich : javascript:', 'home.owner.body', 'Ver [aquí](javascript:alert(1))'],
    ['rich : balise', 'home.owner.body', '<script>alert(1)</script>'],
    ['contrôle de direction', 'home.hero.title', 'Hola \u202e mundo'],
  ])('%s : CONTENT_MARKDOWN_FORBIDDEN, rien n’est écrit', async (_label, key, es) => {
    const { store, console } = setup();
    const e = await rejection(console.saveContentDraft(HASH, id(), key, null, { ...FOUR, es }));
    expect(e.code).toBe('CONTENT_MARKDOWN_FORBIDDEN');
    expect(String((e.details?.['problems'] as string[])[0])).toMatch(/^es : /);
    expect(store.calls).toEqual([]);
  });

  it('bloc conforme : une seule commande, corps des quatre langues', async () => {
    const { store, console } = setup();
    await console.saveContentDraft(HASH, id(), 'home.owner.body', 'XX', {
      ...FOUR,
      es: 'Gana **más**.\n\nVer [cómo](/hosts).',
    });
    expect(store.calls).toHaveLength(1);
    expect(store.calls[0]).toMatchObject({ key: 'home.owner.body' });
  });

  it('registre injecté (tests d’intégration) : une clé déclarée est éditable', async () => {
    const { store, console } = setup({
      'home.test_x.title': { catalogKey: 'web.s01.title', format: 'plain', maxLength: 80 },
    });
    await console.saveContentDraft(HASH, id(), 'home.test_x.title', null, FOUR);
    expect(store.calls).toHaveLength(1);
  });
});
