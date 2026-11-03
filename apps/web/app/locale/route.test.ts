import { LOCALE_COOKIE } from '@rueda/i18n';
import { describe, expect, it } from 'vitest';
import { LOCALE_CONFIG } from '../../locale-config.ts';
import { POST } from './route.ts';

function post(body: string): Request {
  return new Request('http://localhost/locale', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
}

describe('POST /locale (choix explicite mémorisé, 10b UX-11)', () => {
  it.each(LOCALE_CONFIG.locales.map((p) => p.tag))(
    'mémorise %s et revient à l’accueil',
    async (tag) => {
      const response = await POST(post(`locale=${encodeURIComponent(tag)}`));
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/');
      const cookie = response.headers.get('set-cookie') ?? '';
      expect(cookie).toContain(`${LOCALE_COOKIE}=${tag}`);
      expect(cookie.toLowerCase()).toContain('httponly');
      expect(cookie.toLowerCase()).toContain('samesite=lax');
    },
  );

  it.each(['de', 'es', 'fr-FR', '', 'es-PA;x'])('refuse « %s »', async (value) => {
    const response = await POST(post(`locale=${encodeURIComponent(value)}`));
    expect(response.status).toBe(400);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('refuse un corps sans champ locale', async () => {
    expect((await POST(post(''))).status).toBe(400);
  });
});
