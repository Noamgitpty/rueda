import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { scanStyleSource } from '../lint/scan.ts';
import type { SourceKind, StyleRule } from '../lint/scan.ts';
import { EXEMPT_PATHS, LINT_ROOTS, lintStyleTree } from '../lint/tree.ts';
import { REPO_ROOT } from './helpers.ts';

const rules = (source: string, kind: SourceKind): StyleRule[] =>
  scanStyleSource(source, kind).map((f) => f.rule);

// Critère US-030 : « Given un composant, When le lint tourne, Then toute valeur de couleur,
// police, espacement, rayon, ombre ou durée codée en dur fait échouer la CI. »
describe('lint des styles codés en dur : formes simples', () => {
  it.each<[string, string, StyleRule]>([
    ['hexadécimal', '.a { color: #1d3461; }', 'hex-color'],
    ['hexadécimal court', '.a { border: 1px solid #fff; }', 'hex-color'],
    [
      'hexadécimal sur plusieurs lignes',
      '.a {\n  background:\n    linear-gradient(#2a4a7c, #0e1830);\n}',
      'hex-color',
    ],
    ['rgb', '.a { background: rgb(0 0 0 / 50%); }', 'color-function'],
    ['oklch', '.a { color: oklch(60% 0.1 250); }', 'color-function'],
    ['couleur nommée', '.a { color: red; }', 'named-color'],
    ['couleur système', '.a { background: Canvas; }', 'named-color'],
    ['police', '.a { font-family: Inter, sans-serif; }', 'font-family'],
    ['taille', '.a { font-size: 17px; }', 'font-size'],
    ['graisse', '.a { font-weight: 600; }', 'font-weight'],
    ['espacement', '.a { padding: 16px; }', 'spacing'],
    ['espacement logique', '.a { margin-inline: 1rem; }', 'spacing'],
    ['gap', '.a { gap: 8px; }', 'spacing'],
    ['rayon', '.a { border-radius: 12px; }', 'radius'],
    ['ombre', '.a { box-shadow: 0 1px 2px var(--color-text); }', 'shadow'],
    ['durée', '.a { transition: opacity 200ms ease; }', 'duration'],
    ['variable locale en dur', '.a { --gutter: 16px; padding: var(--gutter); }', 'local-variable'],
  ])('CSS : %s', (_label, source, rule) => {
    expect(rules(source, 'css')).toContain(rule);
  });

  it.each<[string, string, StyleRule]>([
    ['couleur dans une chaîne', "const c = '#1D3461';", 'hex-color'],
    ['style React : couleur nommée', "<p style={{ color: 'white' }} />", 'named-color'],
    ['style React : rgba', "<p style={{ background: 'rgba(0,0,0,.5)' }} />", 'color-function'],
    ['style React : police', "<p style={{ fontFamily: 'Manrope' }} />", 'font-family'],
    ['style React : espacement nu', '<p style={{ padding: 16 }} />', 'spacing'],
    ['style React : rayon', "<p style={{ borderRadius: '20px' }} />", 'radius'],
    ['style React : durée', "<p style={{ transitionDuration: '300ms' }} />", 'duration'],
    ['style React : graisse', '<p style={{ fontWeight: 700 }} />', 'font-weight'],
  ])('TSX : %s', (_label, source, rule) => {
    expect(rules(source, 'ts')).toContain(rule);
  });
});

// Revue code US-030 (constat 7) : chaque contournement trouvé doit désormais échouer.
describe('lint des styles codés en dur : contournements fermés', () => {
  it.each<[string, string, SourceKind, StyleRule]>([
    ['raccourci font', '.a { font: 12px Arial; }', 'css', 'font-family'],
    ['raccourci font en TSX', "<p style={{ font: '12px Arial' }} />", 'ts', 'font-family'],
    ['repli de var() : couleur', '.a { color: var(--x, red); }', 'css', 'named-color'],
    ['repli de var() : espacement', '.a { padding: var(--x, 13px); }', 'css', 'spacing'],
    ['repli de var() : durée', '.a { transition: opacity var(--x, 200ms); }', 'css', 'duration'],
    ['repli de var() imbriqué', '.a { color: var(--x, var(--y, #ABCDEF)); }', 'css', 'hex-color'],
    [
      'propriété personnalisée : couleur',
      '.a { --c: red; color: var(--c); }',
      'css',
      'local-variable',
    ],
    ['propriété personnalisée : police', '.a { --f: Arial; }', 'css', 'local-variable'],
    ['propriété personnalisée : pourcentage', '.a { --w: 86%; }', 'css', 'local-variable'],
    ['casse : COLOR:RED', '.a { COLOR:RED }', 'css', 'named-color'],
    ['casse : Padding', '.a { Padding: 13px }', 'css', 'spacing'],
    ['unité % en espacement', '.a { padding: 5%; }', 'css', 'spacing'],
    ['unité dvh', '.a { margin-block: 2dvh; }', 'css', 'spacing'],
    ['unité cm', '.a { gap: 1cm; }', 'css', 'spacing'],
    [
      'dégradé nommé',
      '.a { background-image: linear-gradient(red, blue); }',
      'css',
      'color-function',
    ],
    ['couleur de soulignement', '.a { text-decoration: underline red; }', 'css', 'named-color'],
    ['propriété préfixée', '.a { -webkit-text-fill-color: red; }', 'css', 'named-color'],
    ['filet de colonne', '.a { column-rule: thin solid red; }', 'css', 'named-color'],
    ['filtre drop-shadow', '.a { filter: drop-shadow(0 0 2px currentColor); }', 'css', 'shadow'],
    ['clé entre guillemets doubles', '<p style={{ "font-size": "12px" }} />', 'ts', 'font-size'],
    ['clé entre guillemets simples', "<p style={{ 'color': 'red' }} />", 'ts', 'named-color'],
    ['attribut style en chaîne', '<p style="color:red; padding: 4px" />', 'ts', 'named-color'],
    ['attribut style : espacement', '<p style="padding: 4px" />', 'ts', 'spacing'],
    ['attribut SVG fill', '<path fill="red" />', 'ts', 'named-color'],
    ['attribut SVG stopColor', '<stop stopColor="white" />', 'ts', 'named-color'],
    ['gabarit CSS en chaîne', 'const css = `.a{color:red}`;', 'ts', 'named-color'],
    ['bloc <style> en JSX', '<style>{`.a { margin: 12px }`}</style>', 'ts', 'spacing'],
    ['chaîne CSS simple', "const rule = 'border-radius: 6px';", 'ts', 'radius'],
    ['SVG : attribut fill', '<svg><rect fill="tomato"/></svg>', 'markup', 'named-color'],
    ['HTML : bloc <style>', '<style>.a { padding: 10px }</style>', 'markup', 'spacing'],
  ])('%s', (_label, source, kind, rule) => {
    expect(rules(source, kind)).toContain(rule);
  });

  it('accepte les jetons et les valeurs neutres', () => {
    const css = [
      '.a { color: var(--color-text); background: var(--glass-bg); padding: var(--space-4) 0; }',
      '.b { margin: 0 auto; border: thin solid currentColor; border-radius: 50%; }',
      '.c { font: inherit; transition: opacity var(--motion-duration-fast) var(--motion-easing-standard); }',
      '.d { --x: var(--space-2); --y: calc(var(--space-2) * 2); box-shadow: var(--shadow-card); }',
      '.e { animation-name: snow; transition-property: color, background-color; }',
      '#app { display: grid; }',
      '@media (max-width: 400px) { .f { font-size: var(--font-size-sm); } }',
      '/* #1D3461 en commentaire */',
    ].join('\n');
    expect(scanStyleSource(css, 'css')).toEqual([]);
    const tsx = [
      '<a href="#add" style={{ color: \'var(--color-primary)\', padding: 0 }}>x</a>',
      '// #FFFFFF en commentaire',
      "const label = { title: 'Rojo', fontSize: 'var(--font-size-md)' };",
      "const state = { filter: 'active', transition: 'confirmed' };",
      "const msg = 'Precio final: 25 USD';",
    ].join('\n');
    expect(scanStyleSource(tsx, 'ts')).toEqual([]);
  });

  it('donne la ligne et la colonne', () => {
    const [finding] = scanStyleSource('.a {\n  color: #ABCDEF;\n}', 'css');
    expect(finding).toMatchObject({ line: 2, column: 10, rule: 'hex-color' });
  });
});

describe('parcours du dépôt', () => {
  const root = mkdtempSync(join(tmpdir(), 'rueda-style-lint-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const write = (path: string, content: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };

  it('analyse public/ et out/ imbriqués, configuration, tests, SVG ; ignore les sorties racine', () => {
    write('apps/web/app/public/x.css', '.a { color: red; }');
    write('apps/web/app/out/y.css', '.a { color: red; }');
    write('apps/web/next.config.ts', "export const c = { color: 'red' };");
    write('apps/web/app/z.test.tsx', "const s = { color: 'red' };");
    write('apps/web/public/logo.svg', '<svg><rect fill="#123456"/></svg>');
    write('apps/web/.next/server/chunk.css', '.a { color: red; }');
    write('apps/web/node_modules/lib/a.css', '.a { color: red; }');
    write('packages/ui/src/button.module.css', '.b { padding: 3px; }');
    const files = lintStyleTree(root).findings.map((f) => f.file);
    expect(new Set(files)).toEqual(
      new Set([
        'apps/web/app/public/x.css',
        'apps/web/app/out/y.css',
        'apps/web/next.config.ts',
        'apps/web/app/z.test.tsx',
        'apps/web/public/logo.svg',
        'packages/ui/src/button.module.css',
      ]),
    );
  });

  it("n'exempte que les fichiers listés du paquet de jetons, chacun avec sa raison", () => {
    expect(Object.keys(EXEMPT_PATHS).every((p) => p.startsWith('packages/design-tokens/'))).toBe(
      true,
    );
    expect(Object.values(EXEMPT_PATHS).every((why) => why.length >= 20)).toBe(true);
    write('packages/design-tokens/src/gen.ts', "const c = '#FFFFFF';");
    write('packages/design-tokens/README.css', '.a { color: red; }');
    const files = lintStyleTree(root).findings.map((f) => f.file);
    expect(files).not.toContain('packages/design-tokens/src/gen.ts');
    expect(files).toContain('packages/design-tokens/README.css');
  });

  // Preuve par mutation sur les vrais composants : chaque contournement injecté dans une copie
  // de `home.module.css` ou de `home-content.tsx` fait échouer le lint ; la copie saine passe.
  describe('mutations des composants réels', () => {
    const css = readFileSync(join(REPO_ROOT, 'apps/web/app/home.module.css'), 'utf8');
    const tsx = readFileSync(join(REPO_ROOT, 'apps/web/app/home-content.tsx'), 'utf8');
    const lintCopy = (cssBody: string, tsxBody: string): number => {
      const dir = mkdtempSync(join(tmpdir(), 'rueda-mutation-'));
      try {
        mkdirSync(join(dir, 'apps/web/app'), { recursive: true });
        writeFileSync(join(dir, 'apps/web/app/home.module.css'), cssBody);
        writeFileSync(join(dir, 'apps/web/app/home-content.tsx'), tsxBody);
        return lintStyleTree(dir).findings.length;
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };

    it('copie saine : aucun constat', () => {
      expect(lintCopy(css, tsx)).toBe(0);
    });

    it.each([
      'font: 12px Arial;',
      'color: var(--color-text, red);',
      'padding: var(--space-4, 13px);',
      '--c: red;',
      'COLOR: RED;',
      'margin-block: 3%;',
      '-webkit-text-fill-color: red;',
    ])('CSS muté (%s)', (decl) => {
      expect(lintCopy(css.replace('.tagline {', `.tagline {\n  ${decl}`), tsx)).toBeGreaterThan(0);
    });

    it.each([
      `<p style={{ 'color': 'red' }} />`,
      `<p style="padding: 4px" />`,
      '<style>{`.x{color:red}`}</style>',
      `<svg><path fill="red" /></svg>`,
    ])('TSX muté (%s)', (jsx) => {
      const mutated = tsx.replace('</main>', `  ${jsx}\n    </main>`);
      expect(mutated).not.toBe(tsx);
      expect(lintCopy(css, mutated)).toBeGreaterThan(0);
    });
  });

  it('aucun fichier du dépôt ne contient de style codé en dur', () => {
    const result = lintStyleTree(REPO_ROOT, LINT_ROOTS);
    expect(result.filesScanned).toBeGreaterThan(100);
    expect(result.findings.map((f) => `${f.file}:${f.line} ${f.rule} ${f.text}`)).toEqual([]);
  });
});
