import { loadTheme } from '@rueda/tokens';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getRequestTheme, ThemeStyle } from '../theme.tsx';

// US-030 : la page reçoit les variables CSS du thème actif, sans échappement qui casserait le CSS.
describe('thème de la requête', () => {
  it('Lienzo · Tinta par défaut, en mode automatique', () => {
    const active = getRequestTheme();
    expect(active.theme.id).toBe(process.env['THEME_PALETTE'] || 'lienzo-tinta');
    const html = renderToStaticMarkup(<ThemeStyle active={active} />);
    expect(html).toContain('--color-primary:');
    expect(html).toContain(':root[data-theme="dark"]');
    expect(html).not.toContain('&quot;');
  });

  it('les valeurs injectées sont celles de la palette', () => {
    const tinta = loadTheme('lienzo-tinta');
    const html = renderToStaticMarkup(
      <ThemeStyle
        active={{ theme: tinta, css: '/* x */', colorScheme: 'auto', dataTheme: undefined }}
      />,
    );
    expect(html).toContain('data-theme-id="lienzo-tinta"');
    expect(html).toContain(`data-theme-version="${tinta.version}"`);
  });
});
