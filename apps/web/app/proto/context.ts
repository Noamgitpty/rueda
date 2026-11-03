/**
 * Contexte d'un écran du prototype : textes (officiels + prototype), marché fictif, options d'URL,
 * nom de marque (donnée du thème, DEC-MARQUE) et fabrique de liens.
 */
import { createTranslator, getProfile } from '@rueda/i18n';
import type { Translator } from '@rueda/i18n';
import { paletteDocument } from '@rueda/design-tokens';
import { BRAND_NAME } from '../../brand.ts';
import { getRequestI18n } from '../../i18n.ts';
import { LOCALE_CONFIG } from '../../locale-config.ts';
import { getRequestTheme } from '../../theme.tsx';
import { createCopy } from './copy/index.ts';
import type { Copy, CopyKey, CopyValues } from './copy/index.ts';
import { marketFor } from './data/scenario.ts';
import type { InstantName, ProtoMarket } from './data/scenario.ts';
import { parseProtoOptions, protoHref, screenOf } from './options.ts';
import type { ProtoOptions, ScreenSpec, StateId } from './options.ts';

export interface ScreenContext {
  readonly copy: Copy;
  readonly i18n: Translator;
  readonly t: (key: CopyKey, values?: CopyValues) => string;
  readonly market: ProtoMarket;
  readonly options: ProtoOptions;
  readonly state: StateId;
  readonly brand: string;
  /** Nom du pays du marché, dans la langue de la vue. */
  readonly country: string;
  readonly href: (screen: string | null, change?: Parameters<typeof protoHref>[2]) => string;
  /** Date (jj/mm/aaaa) d'un instant du scénario, dans le fuseau du marché. */
  readonly date: (name: InstantName) => string;
  readonly time: (name: InstantName) => string;
  readonly dateTime: (name: InstantName) => string;
}

type Params = Readonly<Record<string, string | string[] | undefined>>;

/** Nom de marque lu dans la palette active (`brand.name`), repli sur `BRAND_NAME`. */
export function brandName(): string {
  try {
    const doc = paletteDocument(getRequestTheme().theme.id) as {
      brand?: { name?: { $value?: unknown } };
    };
    const value = doc.brand?.name?.$value;
    return typeof value === 'string' && value.trim() !== '' ? value : BRAND_NAME;
  } catch {
    return BRAND_NAME;
  }
}

export async function screenContext(
  params: Params,
  screen?: ScreenSpec | undefined,
): Promise<ScreenContext> {
  const tags = LOCALE_CONFIG.locales.map((p) => p.tag);
  const options = parseProtoOptions(params, tags, screen);
  const i18n = options.locale
    ? createTranslator(getProfile(LOCALE_CONFIG, options.locale))
    : await getRequestI18n();
  const copy = createCopy(i18n);
  const market = marketFor(options.market, i18n.profile.tag);
  const at = (name: InstantName) => ({ instant: market.instants[name], tz: market.timeZone });
  return {
    copy,
    i18n,
    t: copy.t,
    market,
    options,
    state: options.state,
    brand: brandName(),
    country: market.countryName[copy.language],
    href: (target, change) => protoHref(options, target, change),
    date: (name) => i18n.date(at(name).instant, at(name).tz),
    time: (name) => i18n.time(at(name).instant, at(name).tz),
    dateTime: (name) => i18n.dateTime(at(name).instant, at(name).tz),
  };
}

export { screenOf };
