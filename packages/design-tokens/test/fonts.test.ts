import { describe, expect, it } from 'vitest';
import {
  buildTheme,
  PALETTE_IDS,
  paletteDocument,
  themeFontFamilies,
  UnknownPaletteError,
} from '../src/index.ts';
import { patch, tinta } from './helpers.ts';

// US-034 : polices nommées d'un thème (contrôle FONT_NOT_APPROVED) et copie d'une palette du
// registre (brouillon « revenir à une ancienne palette »).
describe('themeFontFamilies', () => {
  it('Tinta : Bricolage Grotesque et Manrope, sans les familles génériques', () => {
    expect(themeFontFamilies(buildTheme(tinta()))).toEqual(['Bricolage Grotesque', 'Manrope']);
  });

  it('une police ajoutée par surcharge apparaît', () => {
    const t = patch(tinta(), 'font.family.mono.$value', ['Comic Neue', 'monospace']);
    expect(themeFontFamilies(buildTheme(t))).toContain('Comic Neue');
  });
});

describe('paletteDocument', () => {
  it('rend une copie profonde de chaque palette du registre', () => {
    for (const id of PALETTE_IDS) {
      const a = paletteDocument(id);
      (a['meta'] as Record<string, unknown>)['version'] = '9.9.9';
      expect((paletteDocument(id)['meta'] as Record<string, unknown>)['version']).not.toBe('9.9.9');
    }
  });

  it('palette inconnue : refus', () => {
    expect(() => paletteDocument('inconnue')).toThrow(UnknownPaletteError);
  });
});
