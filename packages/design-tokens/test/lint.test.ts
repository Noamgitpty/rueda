import { describe, expect, it } from 'vitest';
import { scanStyleSource } from '../lint/scan.ts';
import type { StyleRule } from '../lint/scan.ts';
import { COMPONENT_ROOTS, lintStyleTree } from '../lint/tree.ts';
import { REPO_ROOT } from './helpers.ts';

const rules = (source: string, kind: 'css' | 'ts'): StyleRule[] =>
  scanStyleSource(source, kind).map((f) => f.rule);

// Critère US-030 : « Given un composant, When le lint tourne, Then toute valeur de couleur,
// police, espacement, rayon, ombre ou durée codée en dur fait échouer la CI. »
describe('lint des styles codés en dur', () => {
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

  it('accepte les jetons et les valeurs neutres', () => {
    const css = [
      '.a { color: var(--color-text); background: var(--glass-bg); padding: var(--space-4) 0; }',
      '.b { margin: 0 auto; border: thin solid currentColor; border-radius: 50%; }',
      '.c { font: inherit; transition: opacity var(--motion-duration-fast) var(--motion-easing-standard); }',
      '.d { --x: var(--space-2); box-shadow: var(--shadow-card); gap: calc(var(--space-2) * 2); }',
      '#app { display: grid; }',
      '/* #1D3461 en commentaire */',
    ].join('\n');
    expect(scanStyleSource(css, 'css')).toEqual([]);
    const tsx = [
      '<a href="#add" style={{ color: \'var(--color-primary)\', padding: 0 }}>x</a>',
      '// #FFFFFF en commentaire',
      "const label = { title: 'Rojo', fontSize: 'var(--font-size-md)' };",
    ].join('\n');
    expect(scanStyleSource(tsx, 'ts')).toEqual([]);
  });

  it('donne la ligne et la colonne', () => {
    const [finding] = scanStyleSource('.a {\n  color: #ABCDEF;\n}', 'css');
    expect(finding).toMatchObject({ line: 2, column: 10, rule: 'hex-color' });
  });

  it('aucun composant du dépôt ne contient de style codé en dur', () => {
    const result = lintStyleTree(REPO_ROOT, COMPONENT_ROOTS);
    expect(result.filesScanned).toBeGreaterThan(0);
    expect(result.findings.map((f) => `${f.file}:${f.line} ${f.rule} ${f.text}`)).toEqual([]);
  });
});
