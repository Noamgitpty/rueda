import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CAR_KINDS, CarIllustration } from '../src/index.ts';

describe('CarIllustration : une silhouette par famille de véhicule (US-033)', () => {
  it('chaque famille a sa propre silhouette, décorative', () => {
    const bodies = new Set<string>();
    for (const kind of CAR_KINDS) {
      const html = renderToStaticMarkup(<CarIllustration kind={kind} tone={2} />);
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain(`data-kind="${kind}"`);
      const body = /<path fill="currentColor" d="([^"]+)"/u.exec(html)?.[1];
      expect(body).toBeDefined();
      bodies.add(body ?? '');
    }
    expect(bodies.size).toBe(CAR_KINDS.length);
  });
  it('berline par défaut', () => {
    expect(renderToStaticMarkup(<CarIllustration />)).toContain('data-kind="sedan"');
  });
});
