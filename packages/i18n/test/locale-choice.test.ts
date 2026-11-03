import { describe, expect, it } from 'vitest';
import { LOCALE_COOKIE, localeChoiceResponse } from '../src/index.ts';
import { CONFIG } from './helpers.ts';

function post(url: string, body: string): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
}

describe('localeChoiceResponse', () => {
  it('mémorise une locale déclarée (cookie HttpOnly, SameSite=Lax) et renvoie 303 vers /', async () => {
    const response = await localeChoiceResponse(
      post('http://localhost/locale', 'locale=es-PY'),
      CONFIG,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/');
    expect(response.headers.get('set-cookie')).toBe(
      `${LOCALE_COOKIE}=es-PY; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly`,
    );
  });

  it('mémorise le français (DEC-FONDATEUR-17)', async () => {
    const response = await localeChoiceResponse(
      post('http://localhost/locale', 'locale=fr'),
      CONFIG,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('set-cookie')).toMatch(new RegExp(`^${LOCALE_COOKIE}=fr; `));
  });

  it('ajoute Secure en HTTPS', async () => {
    const response = await localeChoiceResponse(
      post('https://example.test/locale', 'locale=en'),
      CONFIG,
    );
    expect(response.headers.get('set-cookie')).toMatch(/; Secure$/);
  });

  it.each([
    'locale=de',
    'locale=fr-FR',
    'locale=es',
    'locale=',
    'locale=en%3B%20Path%3D%2Fx',
    'autre=en',
    '',
  ])('refuse « %s » sans cookie', async (body) => {
    const response = await localeChoiceResponse(post('http://localhost/locale', body), CONFIG);
    expect(response.status).toBe(400);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('refuse un corps illisible', async () => {
    const request = new Request('http://localhost/locale', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"locale":"en"}',
    });
    expect((await localeChoiceResponse(request, CONFIG)).status).toBe(400);
  });
});
