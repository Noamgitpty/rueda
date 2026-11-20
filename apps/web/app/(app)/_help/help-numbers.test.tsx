/**
 * US-310 — numéros d'aide (S17) et lecture des réponses de l'aide : une vue = une langue dans les
 * quatre langues (es, en, fr, pt-BR) ; numéros lus de la réponse (configuration pays de l'API),
 * jamais inventés ; numéros absents ⇒ renvoi à l'aide dans l'appli ; aucune plage publiée ⇒ aucun
 * horaire. Attendus : 19 US-310, 10b S17, 16 SUP-020 ; textes du catalogue officiel. Données de
 * test : pays réservé `ZZ` et numéros de test (indicatif fictif suivi de zéros), jamais de vrais.
 */
import { CATALOGS, createTranslator } from '@rueda/i18n';
import { findForeignStrings } from '@rueda/i18n/testing';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { helpCountriesOf, helpRequestOf, tripHelpOf } from '../../../account/help.ts';
import type { HelpCountry } from '../../../account/help.ts';
import { embeddedBrand } from '../../../brand-source.ts';
import { LOCALE_CONFIG } from '../../../locale-config.ts';
import { HelpNumbers } from './help-numbers.tsx';

const NAMES = {
  es: 'Tierra de prueba',
  en: 'Test country',
  fr: 'Pays de test',
  pt: 'Terra de teste',
};
const raw = (over: Record<string, unknown> = {}) => ({
  country: 'ZZ',
  names: NAMES,
  emergencyNumber: '911',
  trafficAuthority: { id: 'attt', messageKey: 'common.help.authority.attt' },
  supportPhone: null,
  insurerAssistancePhone: null,
  supportHours: null,
  ...over,
});
const ok = (json: unknown, status = 200) => ({ status, json, session: null });

function view(over: Record<string, unknown> = {}): HelpCountry {
  const v = helpCountriesOf(ok({ countries: [raw(over)] }));
  if (v === null || v[0] === undefined) throw new Error('vue illisible');
  return v[0];
}

const decode = (html: string) =>
  html
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

const render = (tag: string, help: HelpCountry) =>
  decode(
    renderToStaticMarkup(
      <HelpNumbers
        i18n={createTranslator(LOCALE_CONFIG.locales.find((p) => p.tag === tag)!)}
        help={help}
        brand={embeddedBrand({}).name}
        idPrefix="t"
      />,
    ),
  );

describe.each(LOCALE_CONFIG.locales.map((p) => [p.tag, p.language] as const))(
  'S17 — numéros d’aide (%s)',
  (tag, language) => {
    const m = CATALOGS[language].messages;

    it('numéros absents : urgence du pays, renvoi à l’appli, aucun numéro inventé ni horaire', () => {
      const html = render(tag, view());
      expect(findForeignStrings(html, language)).toEqual([]);
      expect(html).toContain('href="tel:911"');
      expect(html.match(/href="tel:/g)).toHaveLength(1);
      expect(html).toContain(m['web.help.roadside.inApp']);
      expect(html).toContain(m['web.help.support.inApp']);
      expect(html).toContain(m['web.help.support.noHours']);
      expect(html).toContain(m['common.help.authority.attt']);
      expect(html).not.toMatch(/\+[0-9]{7,}/);
    });

    it('numéros et plage fournis : servis tels quels, avec leur lien d’appel', () => {
      const html = render(
        tag,
        view({
          supportPhone: '+9990000001',
          insurerAssistancePhone: '+9990000002',
          supportHours: { from: '08:00', to: '20:00' },
        }),
      );
      expect(findForeignStrings(html, language)).toEqual([]);
      expect(html).toContain('href="tel:+9990000001"');
      expect(html).toContain('href="tel:+9990000002"');
      expect(html).toContain('08:00');
      expect(html).toContain('20:00');
      expect(html).not.toContain(m['web.help.support.inApp']);
    });
  },
);

describe('lecture défensive des réponses de l’aide', () => {
  it('forme inattendue ⇒ null (jamais un numéro deviné)', () => {
    for (const bad of [
      raw({ supportPhone: '6000-0000' }),
      raw({ emergencyNumber: 'x' }),
      raw({ trafficAuthority: { id: 'zz', messageKey: 'common.help.authority.unknownKey' } }),
      raw({ supportHours: { from: '8h', to: '20:00' } }),
      raw({ names: { es: 'x' } }),
    ]) {
      expect(helpCountriesOf(ok({ countries: [bad] })), JSON.stringify(bad)).toBeNull();
    }
    expect(helpCountriesOf({ status: 'unavailable' })).toBeNull();
    expect(helpCountriesOf(ok({ countries: [raw()] }, 503))).toBeNull();
  });

  it('aide d’un trip : identifiant et rôle exigés ; issue d’une demande', () => {
    const trip = '31000000-0000-4000-8000-000000000001';
    expect(tripHelpOf(ok({ tripId: trip, role: 'HOST', help: raw() }), trip)?.role).toBe('HOST');
    expect(tripHelpOf(ok({ tripId: trip, role: 'STAFF', help: raw() }), trip)).toBeNull();
    expect(
      tripHelpOf(ok({ tripId: trip, role: 'GUEST', help: raw() }), `${trip.slice(0, -1)}2`),
    ).toBeNull();
    expect(helpRequestOf(ok({ caseId: trip, outcome: 'OPENED', offHours: true }, 201))).toEqual({
      outcome: 'OPENED',
      offHours: true,
    });
    expect(helpRequestOf(ok({ caseId: trip, outcome: 'DONE', offHours: true }, 201))).toBeNull();
  });
});
