import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATALOGS, CATALOG_LANGUAGES } from '../src/index.ts';

/**
 * Textes des règles photo d'US-031 (ADR-069 point 7), versés dans les catalogues (ADR-071) :
 * les clés `web.photo.*` des quatre catalogues sont identiques, texte pour texte, aux données de
 * `packages/design-tokens/rules/photo.messages.json` (lues comme un fichier, sans dépendance au
 * paquet). Un texte changé d'un seul côté fait échouer ce test.
 */
interface PhotoMessagesDoc {
  readonly languages: readonly string[];
  readonly [language: string]: unknown;
}

const doc = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../design-tokens/rules/photo.messages.json', import.meta.url)),
    'utf8',
  ),
) as PhotoMessagesDoc;

describe('règles photo d’US-031 versées dans les catalogues', () => {
  it('mêmes langues que les catalogues (es, en, fr, pt)', () => {
    expect([...doc.languages]).toEqual([...CATALOG_LANGUAGES]);
  });

  it.each(CATALOG_LANGUAGES)(
    '%s : chaque clé web.photo.* a le même texte des deux côtés',
    (lang) => {
      const source = doc[lang] as Readonly<Record<string, string>>;
      const catalog = CATALOGS[lang].messages as Readonly<Record<string, unknown>>;
      const inCatalog = Object.keys(catalog).filter((k) => k.startsWith('web.photo.'));
      expect(inCatalog.sort()).toEqual(Object.keys(source).sort());
      for (const [key, text] of Object.entries(source)) expect(catalog[key], key).toBe(text);
    },
  );
});
