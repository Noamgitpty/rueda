import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CATALOGS } from '@rueda/i18n';
import type { CatalogLanguage } from '@rueda/i18n';
import { compareCatalogs, findForeignStrings } from '@rueda/i18n/testing';
import { LOCALE_CONFIG } from '../../locale-config.ts';
import { screenContext } from './context.ts';
import { PROTO_CATALOGS, mergedCatalogs } from './copy/index.ts';
import { MARKETS, hostActivatable, planOf } from './data/scenario.ts';
import {
  PROTOTYPE_FLAG,
  SCREENS,
  isPrototypeEnabled,
  parseProtoOptions,
  protoHref,
} from './options.ts';
import { SCREEN_COMPONENTS } from './screens/index.ts';

const LANGS: readonly CatalogLanguage[] = ['es', 'en', 'fr', 'pt'];
const TAGS = LOCALE_CONFIG.locales.map((p) => p.tag);

/** Texte visible d'un rendu HTML (balises retirées, entités courantes décodées). */
function textOf(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&#x27;|&#39;/gu, "'")
    .replace(/&quot;/gu, '"')
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&nbsp;/gu, ' ')
    .replace(/[ \t\n]+/gu, ' ');
}

describe('drapeau du prototype (jamais actif en production)', () => {
  it('ouvert en développement ou avec exactement « true »', () => {
    expect(isPrototypeEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(isPrototypeEnabled({ NODE_ENV: 'production', [PROTOTYPE_FLAG]: 'true' })).toBe(true);
  });
  it('fermé par défaut en production, et pour toute autre valeur', () => {
    expect(isPrototypeEnabled({ NODE_ENV: 'production' })).toBe(false);
    for (const value of ['1', 'TRUE', 'yes', ' true', '']) {
      expect(isPrototypeEnabled({ NODE_ENV: 'production', [PROTOTYPE_FLAG]: value })).toBe(false);
    }
  });
});

describe('paramètres d’URL', () => {
  it('valeurs inconnues ignorées, état par défaut = premier état de l’écran', () => {
    const s02 = SCREENS.find((s) => s.id === 's02');
    const o = parseProtoOptions(
      { lang: 'xx', theme: 'neon', state: 'nope', sel: '<x>' },
      TAGS,
      s02,
    );
    expect(o).toEqual({
      locale: undefined,
      theme: 'auto',
      market: undefined,
      state: 'normal',
      sel: undefined,
      capture: false,
    });
  });
  it('un état non déclaré pour l’écran retombe sur l’état normal', () => {
    const s06 = SCREENS.find((s) => s.id === 's06');
    expect(parseProtoOptions({ state: 'empty' }, TAGS, s06).state).toBe('normal');
  });
  it('les liens gardent langue, thème, marché et mode capture', () => {
    const o = parseProtoOptions(
      { lang: 'fr', theme: 'dark', market: 'guarani', capture: '1' },
      TAGS,
    );
    expect(protoHref(o, 's03', { state: 'error' })).toBe(
      '/proto/s03?lang=fr&theme=dark&market=guarani&state=error&capture=1',
    );
    expect(protoHref(o, null)).toBe('/proto?lang=fr&theme=dark&market=guarani&capture=1');
  });
});

describe('textes du prototype (format de @rueda/i18n, quatre langues)', () => {
  it('en, fr et pt ont exactement les clés, pluriels et emplacements de es', () => {
    for (const language of ['en', 'fr', 'pt'] as const) {
      expect(compareCatalogs(PROTO_CATALOGS.es, PROTO_CATALOGS[language])).toEqual([]);
    }
  });
  it('aucune clé du prototype ne redéfinit une clé officielle', () => {
    const official = Object.keys(CATALOGS.es.messages);
    expect(Object.keys(PROTO_CATALOGS.es).filter((k) => official.includes(k))).toEqual([]);
  });
  it('typographie française : insécable avant « : ; ? ! », apostrophe typographique', () => {
    for (const message of Object.values(PROTO_CATALOGS.fr)) {
      const text = typeof message === 'string' ? message : Object.values(message).join(' | ');
      expect(text).not.toMatch(/ [:;?!]/u);
      expect(text).not.toMatch(/'/u);
    }
  });
  it('chaque langue réunie (officiel + prototype) ne contient aucune chaîne des trois autres', () => {
    const merged = mergedCatalogs();
    for (const language of LANGS) {
      const all = Object.values(PROTO_CATALOGS[language])
        .map((m) => (typeof m === 'string' ? m : Object.values(m).join(' | ')))
        .join(' | ');
      expect(findForeignStrings(all, language, merged), language).toEqual([]);
    }
  });
});

describe('données fictives cohérentes', () => {
  it('deux marchés, l’un à deux décimales, l’autre sans décimale (contrainte des deux pays)', () => {
    expect(MARKETS.map((m) => m.exponent).sort()).toEqual([0, 2]);
  });
  it('chaque total de plan = loyer + frais de voyage + protection + taxe (données, pas code)', () => {
    for (const market of MARKETS) {
      const { rentMinor, tripFeeMinor } = market.featured.lines;
      for (const plan of market.featured.plans) {
        const sum =
          BigInt(rentMinor) +
          BigInt(tripFeeMinor) +
          BigInt(plan.priceMinor) +
          BigInt(plan.taxMinor);
        expect(sum.toString(), `${market.id} ${plan.id}`).toBe(plan.totalMinor);
      }
      const featured = market.cars.find((c) => c.id === market.featured.carId);
      expect(featured?.totalMinor).toBe(planOf(market, 'BASICA').totalMinor);
    }
  });
});

describe('protection Básica obligatoire et payante (08 BR-PROT-02, BR-PRICE-11)', () => {
  it('chaque plan a un prix non nul, Básica comprise, et aucun texte ne la dit incluse', () => {
    for (const market of MARKETS) {
      for (const plan of market.featured.plans) expect(BigInt(plan.priceMinor) > 0n).toBe(true);
    }
    for (const language of LANGS) {
      const keys = Object.keys(PROTO_CATALOGS[language]);
      expect(keys.some((k) => k.includes('included'))).toBe(false);
    }
  });
});

describe('espace hôte : jambes et part de l’hôte (oracle de 08, données)', () => {
  it('chaque trip : jambes HOST + INSURER + TAX_THIRD_PARTY + PLATFORM = total payé', () => {
    for (const market of MARKETS) {
      for (const trip of market.host.trips) {
        const legs =
          BigInt(trip.hostMinor) +
          BigInt(trip.insurerMinor) +
          BigInt(trip.taxThirdMinor) +
          BigInt(trip.platformMinor);
        expect(legs.toString(), `${market.id} ${trip.id}`).toBe(trip.totalMinor);
        const lines =
          BigInt(trip.rentMinor) +
          BigInt(trip.tripFeeMinor) +
          BigInt(trip.protectionMinor) +
          BigInt(trip.taxMinor);
        expect(lines.toString(), `${market.id} ${trip.id}`).toBe(trip.totalMinor);
        expect(BigInt(trip.protectionMinor) > 0n).toBe(true);
      }
    }
  });
  it('le trip à venir de l’hôte est celui que le voyageur paie (même total, Básica)', () => {
    for (const market of MARKETS) {
      const upcoming = market.host.trips.find((t) => t.id === 'upcoming');
      expect(upcoming?.totalMinor).toBe(planOf(market, 'BASICA').totalMinor);
      expect(upcoming?.rentMinor).toBe(market.featured.lines.rentMinor);
      expect(market.host.carId).toBe(market.featured.carId);
    }
  });
  it('gains du mois = somme des jambes HOST des trips terminés', () => {
    for (const market of MARKETS) {
      const sum = market.host.trips
        .filter((t) => t.status === 'sent' || t.status === 'scheduled' || t.status === 'onHold')
        .reduce((acc, t) => acc + BigInt(t.hostMinor), 0n);
      expect(sum.toString(), market.id).toBe(market.host.monthEarningsMinor);
    }
  });
});

describe('mise en service : aucun hôte activable tant que le pays est fermé', () => {
  it('interrupteurs à false et capacité PSP inconnue, comme en production', () => {
    for (const market of MARKETS) {
      expect(hostActivatable(market.host.gates), market.id).toBe(false);
      expect(market.host.gates.insurerContractActive).toBe(false);
    }
  });
  it('une capacité PSP inconnue suffit à bloquer, même si tout le reste est ouvert', () => {
    const open = {
      p2pPrivateHostsEnabled: true,
      insurerContractActive: true,
      fundsHoldingEnabled: true,
      payoutsEnabled: true,
    };
    expect(hostActivatable({ ...open, pspPayoutCapability: 'unknown' })).toBe(false);
    expect(hostActivatable({ ...open, pspPayoutCapability: 'no' })).toBe(false);
    expect(hostActivatable({ ...open, pspPayoutCapability: 'yes' })).toBe(true);
    expect(
      hostActivatable({ ...open, insurerContractActive: false, pspPayoutCapability: 'yes' }),
    ).toBe(false);
  });
  it('A07 dit « en attente d’ouverture » et montre l’activation bloquée', async () => {
    const A07 = SCREEN_COMPONENTS['a07'];
    const spec = SCREENS.find((s) => s.id === 'a07');
    expect(A07).toBeDefined();
    if (!A07) return;
    for (const market of MARKETS) {
      const normal = await screenContext({ lang: TAGS[0], market: market.id }, spec);
      const text = textOf(renderToStaticMarkup(<A07 ctx={normal} />));
      expect(text).toContain(normal.t('web.a07.activation.locked'));
      const waiting = await screenContext(
        { lang: TAGS[0], market: market.id, state: 'waiting' },
        spec,
      );
      expect(textOf(renderToStaticMarkup(<A07 ctx={waiting} />))).toContain(
        waiting.t('web.a07.waitingCountry', { brand: waiting.brand, country: waiting.country }),
      );
    }
  });
});

describe('chaque écran, chaque état, chaque locale et chaque marché se rend', () => {
  for (const screen of SCREENS) {
    it(`${screen.id} : ${screen.states.join(', ')}`, async () => {
      const Screen = SCREEN_COMPONENTS[screen.id];
      expect(Screen).toBeDefined();
      if (!Screen) return;
      const merged = mergedCatalogs();
      for (const tag of TAGS) {
        for (const market of MARKETS) {
          for (const state of screen.states) {
            const ctx = await screenContext({ lang: tag, state, market: market.id }, screen);
            expect(ctx.state).toBe(state);
            const text = textOf(renderToStaticMarkup(<Screen ctx={ctx} />));
            expect(text, `${screen.id} ${tag} ${state}`).not.toMatch(/\{[A-Za-z_]+\}/u);
            expect(
              findForeignStrings(text, ctx.copy.language, merged),
              `${screen.id} ${tag} ${market.id} ${state}`,
            ).toEqual([]);
          }
        }
      }
    });
  }
});

describe('couverture des états exigés par US-033', () => {
  it('chaque écran déclare au moins un état normal et un état de chargement ou d’erreur', () => {
    for (const screen of SCREENS) {
      expect(screen.states[0]).toBe('normal');
      expect(screen.states.some((s) => s === 'loading' || s === 'error')).toBe(true);
    }
  });
});
