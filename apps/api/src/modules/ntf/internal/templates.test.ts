/**
 * Critère 1 d'US-021 : « Given chaque gabarit du catalogue, When il est testé en es et en (et fr,
 * DEC-FONDATEUR-17), Then aucune variable non résolue ». 10b §3.13 : UX-59 (variables nommées,
 * identiques dans toutes les langues), UX-60 (chaque gabarit × langue × canal, jeux réalistes :
 * noms accentués, noms longs, montant à 0, trip de plus de 30 jours), UX-61 (longueurs par canal).
 *
 * Les attentes viennent de 16 NTF-001, 10b §3.13 et des données CFG / `@rueda/i18n`, jamais du code
 * testé. Chaque cas tourne en USD (PA) et en PYG sans décimale (PY).
 */
import { describe, expect, it } from 'vitest';
import { CATALOG_LANGUAGES, CATALOGS, formatMoney, getProfile, placeholdersOf } from '@rueda/i18n';
import { compareCatalogs } from '@rueda/i18n/testing';
import type { MessageChannelKind } from './messaging-channel.port.js';
import type { TemplateSpec } from './catalog.js';
import { assistanceKeyOf, messageKeyOf, RULES, TEMPLATE_KEYS, TEMPLATES } from './catalog.js';
import type { AssistanceContacts, StoredVariable } from './render.js';
import { renderTemplate, shortRef, smsSegments, TemplateRenderError } from './render.js';
import {
  COUNTRY_CASES,
  COUNTRY_CONFIG,
  COUNTRY_DATA,
  LOCALE_CONFIG,
  TEST_BRAND,
} from './ntf.test-support.js';

const TEMPLATE_LIST: TemplateSpec[] = TEMPLATE_KEYS.map((k) => TEMPLATES[k]);
const PARTS = (channel: MessageChannelKind): ('subject' | 'body')[] =>
  channel === 'EMAIL' ? ['subject', 'body'] : ['body'];
/** Tous les canaux qu'un gabarit peut emprunter (envoi direct et repli). */
const channelsOf = (t: TemplateSpec): MessageChannelKind[] => [
  ...new Set(t.channels.flatMap((c) => (c.fallback ? [c.channel, c.fallback] : [c.channel]))),
];

/** Jeux de données réalistes (10b UX-60). */
const DATASETS = [
  {
    name: 'nom accentué, trip court',
    firstName: 'José Ñúñez',
    start: '2026-12-24T14:00:00Z',
    end: '2026-12-27T10:00:00Z',
    units: 120n,
  },
  {
    name: 'nom long, trip de plus de 30 jours',
    firstName: 'María Fernanda de los Ángeles',
    start: '2027-01-02T09:30:00Z',
    end: '2027-02-15T18:45:00Z',
    units: 98_765n,
  },
  {
    name: 'montant à 0',
    firstName: 'Zoë',
    start: '2026-11-05T00:00:00Z',
    end: '2026-11-06T00:00:00Z',
    units: 0n,
  },
];

/**
 * Numéros de test d'un pays, à la longueur d'un numéro national du pays (CFG `phone`) pour éprouver
 * le budget des SMS : l'indicatif, des zéros, puis 1 ou 2 ; jamais un vrai numéro (la vraie valeur
 * est une donnée du fondateur, US-213, ADR-174).
 */
function testAssistance(code: string): AssistanceContacts {
  const phone = COUNTRY_CONFIG.countries.get(code)?.phone;
  if (phone === undefined) throw new Error(`pays ${code}`);
  const national = (last: string) => '0'.repeat(phone.nationalLength - 1) + last;
  return {
    supportPhone: `+${phone.callingCode}${national('1')}`,
    insurerAssistancePhone: `+${phone.callingCode}${national('2')}`,
  };
}

function storedVariables(
  t: TemplateSpec,
  data: (typeof DATASETS)[number],
  c: (typeof COUNTRY_CASES)[number],
): Record<string, StoredVariable> {
  const out: Record<string, StoredVariable> = {};
  for (const [name, source] of Object.entries(t.variables)) {
    if (source.from !== 'payload') continue;
    if (source.type === 'ref') out[name] = shortRef('0190f5a2-7c3e-7d4b-8a1f-3c5e9b2d4a6f');
    else if (source.type === 'instant') out[name] = name === 'start_at' ? data.start : data.end;
    else {
      out[name] = {
        amount_minor: (data.units * 10n ** BigInt(c.exponent)).toString(),
        currency: c.currency,
      };
    }
  }
  return out;
}

describe('catalogue des gabarits (16 NTF-001, 10b §3.13)', () => {
  it('chaque règle vise un gabarit du catalogue ; chaque gabarit est déclenché par au moins une règle', () => {
    for (const rule of RULES) expect(TEMPLATE_KEYS).toContain(rule.template);
    for (const key of TEMPLATE_KEYS) {
      expect(
        RULES.some((r) => r.template === key),
        key,
      ).toBe(true);
    }
  });

  it('les quatre langues ont chaque clé de chaque gabarit et canal (es, en, fr, pt)', () => {
    expect([...CATALOG_LANGUAGES].sort()).toEqual(['en', 'es', 'fr', 'pt']);
    for (const t of TEMPLATE_LIST) {
      for (const channel of channelsOf(t)) {
        for (const part of PARTS(channel)) {
          const key = messageKeyOf(t, channel, part);
          for (const language of CATALOG_LANGUAGES) {
            expect(Object.hasOwn(CATALOGS[language].messages, key), `${language} ${key}`).toBe(
              true,
            );
          }
        }
      }
    }
  });

  it('parité : mêmes emplacements dans les quatre langues pour toutes les clés ntf.*', () => {
    const only = (language: (typeof CATALOG_LANGUAGES)[number]) =>
      Object.fromEntries(
        Object.entries(CATALOGS[language].messages).filter(([k]) => k.startsWith('ntf.')),
      );
    expect(Object.keys(only('es')).length).toBeGreaterThan(0);
    expect(compareCatalogs(only('es'), only('en'))).toEqual([]);
    expect(compareCatalogs(only('es'), only('fr'))).toEqual([]);
    expect(compareCatalogs(only('es'), only('pt'))).toEqual([]);
  });

  it('variables déclarées = emplacements des textes ; aucun emplacement non déclaré (UX-59)', () => {
    for (const t of TEMPLATE_LIST) {
      const used = new Set<string>();
      for (const channel of channelsOf(t)) {
        for (const part of PARTS(channel)) {
          const text = CATALOGS.es.messages[messageKeyOf(t, channel, part) as never] as string;
          for (const name of placeholdersOf(text)) {
            expect(Object.keys(t.variables), `${t.key} : {${name}}`).toContain(name);
            used.add(name);
          }
        }
      }
      expect([...used].sort(), t.key).toEqual(Object.keys(t.variables).sort());
    }
  });

  it('aucune clé ntf.* orpheline (sans gabarit)', () => {
    const expected = new Set(
      TEMPLATE_LIST.flatMap((t) =>
        channelsOf(t).flatMap((ch) => PARTS(ch).map((p) => messageKeyOf(t, ch, p))),
      ),
    );
    // phrases d'assistance des gabarits qui en déclarent une (US-213, ADR-174)
    for (const t of TEMPLATE_LIST) {
      for (const source of Object.values(t.variables)) {
        if (source.from !== 'assistance') continue;
        for (const ch of channelsOf(t)) {
          for (const form of ['numbers', 'inApp'] as const) {
            expected.add(assistanceKeyOf(source.audience, ch, form));
          }
        }
      }
    }
    const present = Object.keys(CATALOGS.es.messages).filter((k) => k.startsWith('ntf.'));
    expect(present.sort()).toEqual([...expected].sort());
  });
});

describe.each(COUNTRY_CASES)('rendu de chaque gabarit — $country ($currency)', (c) => {
  const country = COUNTRY_DATA.countryOf(c.country);
  if (!country) throw new Error(`pays ${c.country}`);

  for (const tag of country.locales) {
    for (const data of DATASETS) {
      for (const assistance of [null, testAssistance(c.country)]) {
        const label = assistance === null ? 'numéros absents' : 'numéros fournis';
        it(`${tag}, ${data.name}, ${label} : tout est résolu, aucun motif résiduel, longueurs bornées`, () => {
          const profile = getProfile(LOCALE_CONFIG, tag);
          for (const t of TEMPLATE_LIST) {
            for (const channel of channelsOf(t)) {
              const message = renderTemplate(t, channel, {
                profile,
                timeZone: country.timeZone,
                exponentOf: COUNTRY_DATA.exponentOf,
                brand: TEST_BRAND,
                assistance,
                firstName: data.firstName,
                variables: storedVariables(t, data, c),
              });
              const all = `${message.subject ?? ''}\n${message.body}`;
              // 10b UX-60 : ni {…}, ni {{…}}, ni %s, undefined, null, NaN
              expect(all, `${t.key} ${channel}`).not.toMatch(/[{}]|%s|undefined|null|NaN/);
              if (channel === 'EMAIL') {
                expect(message.subject, t.key).not.toBeNull();
                // UX-61 : titre d'email ≤ 60 caractères (marque de test comprise)
                expect(
                  (message.subject ?? '').length,
                  `${t.key} ${message.subject}`,
                ).toBeLessThanOrEqual(60);
              } else {
                expect(message.subject).toBeNull();
                // UX-61 : budget PROPOSÉ (ADR-061) de 3 segments, sur l'encodage réel
                expect(
                  smsSegments(message.body).segments,
                  `${t.key} ${message.body}`,
                ).toBeLessThanOrEqual(3);
              }
              if ('first_name' in t.variables && channel === 'EMAIL') {
                expect(message.body).toContain(data.firstName);
              }
            }
          }
        });
      }
    }
  }

  it('le montant est affiché dans la devise du pays, avec son exposant (formatMoney)', () => {
    const t = TEMPLATES.EVT_PAYOUT_SENT;
    const profile = getProfile(LOCALE_CONFIG, country.defaultLocale);
    const ctx = {
      profile,
      timeZone: country.timeZone,
      exponentOf: COUNTRY_DATA.exponentOf,
      brand: TEST_BRAND,
      assistance: null,
      firstName: 'Ana',
    };
    const render = (minor: string) =>
      renderTemplate(t, 'EMAIL', {
        ...ctx,
        variables: { amount: { amount_minor: minor, currency: c.currency } },
      }).subject ?? '';
    // oracle : formatMoney de @rueda/i18n (paquet testé à part) sur la même valeur
    const expected = formatMoney(
      { amountMinor: BigInt(c.amountMinor), currency: c.currency, exponent: c.exponent },
      profile,
    );
    expect(render(c.amountMinor)).toContain(expected);
    expect(render(c.amountMinor)).not.toBe(render('0'));
  });
});

/**
 * US-213 critère 2 : la confirmation « affiche les numéros du support et de l'assistance de
 * l'assureur ; le téléphone personnel de l'hôte n'y figure pas ». Attentes tirées de 19 US-213, de
 * 16 NTF-007 et d'ADR-174 (voyageur : les deux numéros ; hôte : le support), jamais du code testé.
 */
describe.each(COUNTRY_CASES)('numéros d’assistance de la confirmation — $country (US-213)', (c) => {
  const country = COUNTRY_DATA.countryOf(c.country);
  if (!country) throw new Error(`pays ${c.country}`);
  const numbers = testAssistance(c.country);
  const variables = {
    booking_ref: 'ABCD1234',
    start_at: '2026-12-24T14:00:00Z',
    end_at: '2026-12-27T10:00:00Z',
  };
  const render = (
    t: TemplateSpec,
    channel: MessageChannelKind,
    tag: string,
    assistance: AssistanceContacts | null,
  ): string => {
    const m = renderTemplate(t, channel, {
      profile: getProfile(LOCALE_CONFIG, tag),
      timeZone: country.timeZone,
      exponentOf: COUNTRY_DATA.exponentOf,
      brand: TEST_BRAND,
      assistance,
      firstName: 'Ana',
      variables,
    });
    return `${m.subject ?? ''}\n${m.body}`;
  };

  it.each(country.locales)(
    '%s : le voyageur reçoit le support et l’assistance de l’assureur',
    (tag) => {
      for (const channel of ['EMAIL', 'SMS'] as const) {
        const text = render(TEMPLATES.EVT_BOOKING_CONFIRMED, channel, tag, numbers);
        expect(text, channel).toContain(numbers.supportPhone);
        expect(text, channel).toContain(numbers.insurerAssistancePhone);
      }
    },
  );

  it.each(country.locales)('%s : l’hôte reçoit le support, pas l’assistance du voyageur', (tag) => {
    for (const channel of ['EMAIL', 'SMS'] as const) {
      const text = render(TEMPLATES.EVT_BOOKING_CONFIRMED_HOST, channel, tag, numbers);
      expect(text, channel).toContain(numbers.supportPhone);
      expect(text, channel).not.toContain(numbers.insurerAssistancePhone);
    }
  });

  it.each(country.locales)(
    '%s : numéros absents ⇒ renvoi à l’appli, aucun numéro inventé',
    (tag) => {
      for (const t of [TEMPLATES.EVT_BOOKING_CONFIRMED, TEMPLATES.EVT_BOOKING_CONFIRMED_HOST]) {
        for (const channel of ['EMAIL', 'SMS'] as const) {
          const text = render(t, channel, tag, null);
          // aucun numéro de téléphone (« + » suivi de chiffres) dans le message
          expect(text, `${t.key} ${channel}`).not.toMatch(/\+[0-9]/);
          expect(text).not.toBe(render(t, channel, tag, numbers));
        }
      }
    },
  );

  it('seules les deux confirmations portent une phrase d’assistance', () => {
    const carriers = TEMPLATE_LIST.filter((t) =>
      Object.values(t.variables).some((v) => v.from === 'assistance'),
    ).map((t) => t.key);
    expect(carriers.sort()).toEqual(['EVT_BOOKING_CONFIRMED', 'EVT_BOOKING_CONFIRMED_HOST']);
  });
});

describe('variables manquantes ou invalides : TEMPLATE_VARIABLE_MISSING, jamais envoyé', () => {
  const [c] = COUNTRY_CASES;
  if (!c) throw new Error('aucun pays');
  const country = COUNTRY_DATA.countryOf(c.country);
  if (!country) throw new Error('pays');
  const base = {
    profile: getProfile(LOCALE_CONFIG, country.defaultLocale),
    timeZone: country.timeZone,
    exponentOf: COUNTRY_DATA.exponentOf,
    brand: TEST_BRAND,
    assistance: null,
    firstName: 'Ana',
  };
  const t = TEMPLATES.EVT_BOOKING_CONFIRMED;
  const ok = {
    booking_ref: 'ABCD1234',
    start_at: '2026-12-24T14:00:00Z',
    end_at: '2026-12-27T10:00:00Z',
  };

  it.each([
    [
      'variable de charge utile absente',
      { ...base, variables: { booking_ref: 'ABCD1234', start_at: ok.start_at } },
    ],
    ['prénom vide', { ...base, firstName: ' ', variables: ok }],
    ['marque vide', { ...base, brand: '', variables: ok }],
    ['instant sans fuseau', { ...base, variables: { ...ok, start_at: '2026-12-24T14:00:00' } }],
    ['pays inconnu (pas de fuseau)', { ...base, timeZone: null, variables: ok }],
    [
      'numéro d’assistance vide (US-213)',
      { ...base, assistance: { supportPhone: ' ', insurerAssistancePhone: ' ' }, variables: ok },
    ],
  ])('%s', (_name, ctx) => {
    for (const channel of ['EMAIL', 'SMS'] as const) {
      expect(() => renderTemplate(t, channel, ctx)).toThrow(TemplateRenderError);
    }
  });

  it('montant d’une devise inconnue ou non entier', () => {
    const p = TEMPLATES.EVT_PAYOUT_SENT;
    for (const amount of [
      { amount_minor: '12000', currency: 'XXX' },
      { amount_minor: '12.5', currency: c.currency },
    ]) {
      expect(() => renderTemplate(p, 'EMAIL', { ...base, variables: { amount } })).toThrow(
        TemplateRenderError,
      );
    }
  });

  it('une valeur qui contient un motif résiduel est refusée (10b UX-60)', () => {
    expect(() => renderTemplate(t, 'EMAIL', { ...base, firstName: '{6}', variables: ok })).toThrow(
      TemplateRenderError,
    );
  });
});

describe('segments SMS (10b UX-61 : á, í, ó, ú font passer en UCS-2)', () => {
  it.each([
    ['a'.repeat(160), 'GSM-7', 1],
    ['a'.repeat(161), 'GSM-7', 2],
    ['ñ'.repeat(160), 'GSM-7', 1],
    ['€'.repeat(80), 'GSM-7', 1],
    ['á' + 'a'.repeat(69), 'UCS-2', 1],
    ['á' + 'a'.repeat(70), 'UCS-2', 2],
  ] as const)('%#', (text, encoding, segments) => {
    expect(smsSegments(text)).toEqual({ encoding, segments });
  });
});
