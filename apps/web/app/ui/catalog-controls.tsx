import type { LocaleProfile, Translator } from '@rueda/i18n';
import { catalogHref } from './catalog-options.ts';
import type { CatalogOptions } from './catalog-options.ts';
import styles from './controls.module.css';

interface Option {
  readonly key: string;
  readonly label: string;
  readonly lang?: string;
  readonly href: string;
  readonly current: boolean;
}

function Group({
  legend,
  options,
}: {
  readonly legend: string;
  readonly options: readonly Option[];
}) {
  return (
    <nav aria-label={legend}>
      <p className={styles['legend']} aria-hidden="true">
        {legend}
      </p>
      <ul className={styles['list']}>
        {options.map((o) => (
          <li key={o.key}>
            <a
              className={styles['option']}
              href={o.href}
              lang={o.lang}
              aria-current={o.current ? 'true' : undefined}
            >
              {o.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Langue, thème et largeur de la vitrine : de simples liens (fonctionnent sans JavaScript). Les
 * noms de langue viennent de la configuration (`displayName`), chacun dans sa langue.
 */
export function CatalogControls({
  i18n,
  options,
  locales,
}: {
  readonly i18n: Translator;
  readonly options: CatalogOptions;
  readonly locales: readonly LocaleProfile[];
}) {
  const current = i18n.profile.tag;
  return (
    <div className={styles['controls']}>
      <Group
        legend={i18n.t('common.locale.switchLabel')}
        options={locales.map((p) => ({
          key: p.tag,
          label: p.displayName,
          lang: p.tag,
          href: catalogHref(options, { locale: p.tag }),
          current: p.tag === current,
        }))}
      />
      <Group
        legend={i18n.t('web.catalog.controls.theme')}
        options={(['auto', 'light', 'dark'] as const).map((mode) => ({
          key: mode,
          label: i18n.t(`web.catalog.controls.${mode}`),
          href: catalogHref({ ...options, locale: current }, { theme: mode }),
          current: options.theme === mode,
        }))}
      />
      <Group
        legend={i18n.t('web.catalog.controls.width')}
        options={(['mobile', 'full'] as const).map((width) => ({
          key: width,
          label: i18n.t(`web.catalog.controls.${width}`),
          href: catalogHref({ ...options, locale: current }, { width }),
          current: options.width === width,
        }))}
      />
    </div>
  );
}
