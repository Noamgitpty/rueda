import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONTRAST_RULES,
  GLASS_TEXT,
  listPalettes,
  loadTheme,
  themeStyleSheet,
} from '@rueda/design-tokens';
import { describe, expect, it } from 'vitest';

// Les composants n'écrivent que des jetons (US-030) : ces tests vérifient que chaque jeton lu
// existe dans **toutes** les palettes acceptées, que chaque paire texte / fond posée par un même
// bloc est une paire contrôlée par le thème (contraste garanti par construction), que les cibles
// interactives font 48 px et que toute animation s'arrête avec `prefers-reduced-motion`.

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const REPO = fileURLToPath(new URL('../../../', import.meta.url));

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? cssFiles(join(dir, e.name))
      : e.name.endsWith('.css')
        ? [join(dir, e.name)]
        : [],
  );
}

const FILES = cssFiles(SRC).map((path) => ({
  name: relative(SRC, path).split('\\').join('/'),
  css: readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''),
}));

const PALETTES = listPalettes().filter((p) => p.accepted);

describe('jetons lus par les composants', () => {
  it('au moins une palette acceptée, dont la palette par défaut', () => {
    expect(PALETTES.map((p) => p.id)).toContain('lienzo-tinta');
  });

  it.each(PALETTES.map((p) => [p.id] as const))('%s : chaque var(--…) existe', (id) => {
    const sheet = themeStyleSheet(loadTheme(id));
    for (const { name, css } of FILES) {
      for (const m of css.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) {
        expect(sheet, `${name} lit ${m[1]}`).toContain(`${m[1]}:`);
      }
    }
  });
});

/** Blocs `sélecteur { déclarations }` les plus internes. */
function blocks(css: string): Array<{ selector: string; body: string }> {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: (m[1] ?? '').trim(),
    body: m[2] ?? '',
  }));
}

const colorToken = (body: string, prop: 'color' | 'background'): string | undefined => {
  const m = new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*var\\(--(color-[\\w-]+|glass-bg)\\)\\s*;`).exec(
    body,
  );
  return m?.[1];
};

describe('contraste par construction', () => {
  const allowed = new Set(CONTRAST_RULES.map((r) => `${r.fg}/${r.bg}`));
  const pairs = FILES.flatMap(({ name, css }) =>
    blocks(css).flatMap(({ selector, body }) => {
      const fg = colorToken(body, 'color');
      const bg = colorToken(body, 'background');
      return fg && bg ? [{ where: `${name} ${selector}`, fg, bg }] : [];
    }),
  );

  it('les composants posent des paires texte / fond', () => {
    expect(pairs.length).toBeGreaterThan(10);
  });

  it.each(pairs.map((p) => [p.where, p] as const))('%s', (_where, { fg, bg }) => {
    const f = fg.replace(/^color-/, '');
    if (bg === 'glass-bg') {
      expect(GLASS_TEXT as readonly string[]).toContain(f);
      return;
    }
    expect(allowed, `${f} sur ${bg.replace(/^color-/, '')}`).toContain(
      `${f}/${bg.replace(/^color-/, '')}`,
    );
  });
});

describe('cibles tactiles et mouvement', () => {
  const css = (file: string) => FILES.find((f) => f.name === file)?.css ?? '';
  const block = (file: string, selector: string) =>
    blocks(css(file)).find((b) => b.selector === selector)?.body ?? '';

  it.each([
    ['button.module.css', '.button'],
    ['icon-button.module.css', '.iconButton'],
    ['field.module.css', '.input'],
    ['field.module.css', '.check'],
    ['field.module.css', '.summaryList a'],
    ['card.module.css', '.link'],
    ['price.module.css', '.summary'],
  ])('%s %s : au moins 48 px (10b UX-47)', (file, selector) => {
    expect(block(file, selector)).toMatch(/(min-)?block-size:\s*var\(--size-touch-target\)/);
  });

  it('case photo : deux cibles de haut', () => {
    expect(block('photo-slot.module.css', '.slot')).toContain(
      'min-block-size: calc(var(--size-touch-target) * 2)',
    );
  });

  it.each(FILES.filter((f) => /animation:\s*ui-/.test(f.css)).map((f) => [f.name, f.css] as const))(
    '%s : animation arrêtée avec prefers-reduced-motion (10b UX-69)',
    (_name, text) => {
      expect(text).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/);
    },
  );
});

describe('lint des styles codés en dur (US-030)', () => {
  it('aucun constat dans packages/ui ni dans la vitrine de apps/web', () => {
    let output: string;
    try {
      output = execFileSync(
        process.execPath,
        [join(REPO, 'packages/design-tokens/lint/cli.ts'), '--root', REPO],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch (error) {
      output = String((error as { stderr?: string }).stderr ?? error);
    }
    const ours = output
      .split('\n')
      .filter((line) => line.startsWith('packages/ui/') || line.startsWith('apps/web/app/ui/'));
    expect(ours).toEqual([]);
    expect(output).toMatch(/styles : (OK|\d+ erreur)/);
  });
});
