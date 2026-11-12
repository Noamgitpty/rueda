/**
 * Avertissements réglementaires côté site (US-125 critère 4 ; 16 LEG-021). Attendus : 19 US-125
 * (« l'avertissement versionné s'affiche » pour l'hôte et le voyageur d'un pays à limite légale
 * connue), DEC-FONDATEUR-17 / 18 (es, en, fr, pt ; une vue = une langue, 10b UX-11), critère 5
 * (aucun interrupteur affiché). Pays fictif `XX` et identifiants lus dans le catalogue : aucune
 * constante de pays dans le test.
 */
import { CATALOGS, createTranslator, getProfile } from '@rueda/i18n';
import { findForeignStrings } from '@rueda/i18n/testing';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ApiResult } from '../account/api-client.ts';
import { regulatoryNoticesOf, regulatoryNoticesPath } from '../account/regulatory-notices.ts';
import type { NoticeAudience } from '../account/regulatory-notices.ts';
import { LOCALE_CONFIG } from '../locale-config.ts';
import { RegulatoryNotices } from './(app)/_account/regulatory-notices.tsx';

const reply = (status: number, json: unknown): ApiResult =>
  ({ status, json, session: null }) as unknown as ApiResult;

/** Avertissements présents au catalogue (identifiant, version, public), lus dans es. */
const CATALOGUED = [
  ...new Set(
    Object.keys(CATALOGS.es.messages)
      .map((k) => /^common\.regulatory\.([a-zA-Z0-9]+)\.v(\d+)\.(host|guest)\.title$/.exec(k))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => `${m[1]}|${m[2]}|${m[3]}`),
  ),
].map((s) => {
  const [id, version, audience] = s.split('|') as [string, string, string];
  return {
    id,
    version: Number(version),
    audience: audience === 'host' ? 'HOST' : 'GUEST',
  } as const;
});

const body = (country: string, audience: NoticeAudience, ids = CATALOGUED) => ({
  country,
  audience,
  notices: ids
    .filter((n) => n.audience === audience)
    .map((n) => ({
      id: n.id,
      version: n.version,
      since: '2026-11-12',
      messageKey: `common.regulatory.${n.id}.v${n.version}.${audience === 'HOST' ? 'host' : 'guest'}`,
    })),
});

describe('regulatoryNoticesOf : lecture défensive', () => {
  it('au moins un avertissement par public au catalogue', () => {
    expect(CATALOGUED.some((n) => n.audience === 'HOST')).toBe(true);
    expect(CATALOGUED.some((n) => n.audience === 'GUEST')).toBe(true);
  });

  it.each(['HOST', 'GUEST'] as const)(
    'public %s : avertissements du catalogue retenus',
    (audience) => {
      const got = regulatoryNoticesOf(reply(200, body('XX', audience)), 'XX', audience);
      expect(got.length).toBe(CATALOGUED.filter((n) => n.audience === audience).length);
      expect(got.length).toBeGreaterThan(0);
    },
  );

  it('réponse illisible, autre pays, autre public, clé hors catalogue ou incohérente : ignorée', () => {
    expect(regulatoryNoticesOf({ status: 'unavailable' }, 'XX', 'HOST')).toEqual([]);
    expect(regulatoryNoticesOf(reply(400, { code: 'REQUEST_INVALID' }), 'XX', 'HOST')).toEqual([]);
    expect(regulatoryNoticesOf(reply(200, body('YY', 'HOST')), 'XX', 'HOST')).toEqual([]);
    expect(regulatoryNoticesOf(reply(200, body('XX', 'GUEST')), 'XX', 'HOST')).toEqual([]);
    const bad = [
      {
        id: 'unknownNotice',
        version: 1,
        since: '2026-11-12',
        messageKey: 'common.regulatory.unknownNotice.v1.host',
      },
      { id: 'x', version: 1, since: '2026-11-12', messageKey: 'common.auth.requestInvalid' },
      { id: 'y', version: 0, since: '2026-11-12', messageKey: 'common.regulatory.y.v0.host' },
      ...(CATALOGUED[0]
        ? [
            {
              id: CATALOGUED[0].id,
              version: CATALOGUED[0].version + 1,
              since: '2026-11-12',
              messageKey: `common.regulatory.${CATALOGUED[0].id}.v${CATALOGUED[0].version}.host`,
            },
          ]
        : []),
    ];
    expect(
      regulatoryNoticesOf(
        reply(200, { country: 'XX', audience: 'HOST', notices: bad }),
        'XX',
        'HOST',
      ),
    ).toEqual([]);
  });

  it('chemin : pays et public dans la requête, rien d’autre', () => {
    expect(regulatoryNoticesPath('XX', 'GUEST')).toBe(
      '/regulatory-notices?country=XX&audience=GUEST',
    );
  });
});

/** Une locale de la configuration par langue de catalogue (es-xx régionale comprise). */
const tagOf = (language: string): string => {
  const p = LOCALE_CONFIG.locales.find((x) => x.language === language);
  if (!p) throw new Error(`aucune locale en ${language}`);
  return p.tag;
};

describe('RegulatoryNotices : rendu dans les quatre langues', () => {
  const tags = ['es', 'en', 'fr', 'pt'].map(tagOf);
  it.each(tags)('vue %s : titre, texte et version, dans la seule langue de la vue', (tag) => {
    const i18n = createTranslator(getProfile(LOCALE_CONFIG, tag));
    for (const audience of ['HOST', 'GUEST'] as const) {
      const notices = regulatoryNoticesOf(reply(200, body('XX', audience)), 'XX', audience);
      const html = renderToStaticMarkup(
        <RegulatoryNotices i18n={i18n} notices={notices} headingId="t-notices" />,
      );
      expect(html).toContain(i18n.t('common.regulatory.heading'));
      for (const n of notices) {
        expect(html).toContain(`data-notice="${n.id}"`);
        expect(html).toContain(`data-notice-version="${n.version}"`);
        expect(html).toContain(i18n.t('common.regulatory.version', { version: n.version }));
      }
      const text = html.replace(/<[^>]+>/g, ' ');
      expect(findForeignStrings(text, getProfile(LOCALE_CONFIG, tag).language)).toEqual([]);
      // critère 5 : aucun interrupteur de mise en service à l'écran
      expect(html).not.toMatch(/enabled|go_?live|insurer_contract|funds_holding/i);
    }
  });

  it('aucun avertissement : rien n’est rendu', () => {
    const i18n = createTranslator(getProfile(LOCALE_CONFIG, tagOf('es')));
    expect(
      renderToStaticMarkup(<RegulatoryNotices i18n={i18n} notices={[]} headingId="t-notices" />),
    ).toBe('');
  });
});
