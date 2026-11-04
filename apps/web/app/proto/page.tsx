import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ButtonLink } from '@rueda/ui';
import { LOCALE_CONFIG } from '../../locale-config.ts';
import { ThemeMode } from '../ui/theme-mode.tsx';
import { screenContext } from './context.ts';
import { SCREENS, isPrototypeEnabled } from './options.ts';
import type { ScreenGroup, StateId } from './options.ts';
import type { ProtoKey } from './copy/index.ts';
import { Wordmark, styles } from './shell.tsx';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** États exigés par US-033 pour chaque écran clé ; un état absent est « sans objet » dans 10b §4.1. */
const REQUIRED: readonly StateId[] = ['empty', 'loading', 'error'];

/** Parcours de l'index, dans l'ordre de 10b §4.2 : voyageur, hôte, plateforme. */
const GROUPS = [
  { id: 'guest', title: 'proto.index.flow' },
  { id: 'host', title: 'proto.index.flow.host' },
  { id: 'platform', title: 'proto.index.flow.platform' },
] as const satisfies ReadonlyArray<{ readonly id: ScreenGroup; readonly title: ProtoKey }>;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  if (!isPrototypeEnabled()) return {};
  const ctx = await screenContext(await searchParams);
  return { title: ctx.t('proto.index.title'), robots: { index: false, follow: false } };
}

/** Index du prototype US-033 : chaque écran et chacun de ses états, en un clic. */
export default async function ProtoIndexPage({ searchParams }: { searchParams: SearchParams }) {
  if (!isPrototypeEnabled()) notFound();
  const ctx = await screenContext(await searchParams);
  const { t } = ctx;
  const current = ctx.i18n.profile.tag;
  return (
    <div className={styles['page']} lang={current}>
      <ThemeMode mode={ctx.options.theme} />
      <main className={styles['indexMain']}>
        <p className={styles['ribbon']}>{t('proto.ribbon')}</p>
        <header className={styles['stackTight']}>
          <p className={styles['h2']}>
            <Wordmark brand={ctx.brand} />
          </p>
          <h1 className={styles['h1']}>{t('proto.index.title')}</h1>
          <p className={styles['muted']}>{t('proto.index.intro')}</p>
        </header>
        <nav className={styles['toolbarGroup']} aria-label={t('common.locale.switchLabel')}>
          <ul className={styles['chips']}>
            {LOCALE_CONFIG.locales.map((p) => (
              <li key={p.tag}>
                <a
                  className={styles['chip']}
                  href={ctx.href(null, { locale: p.tag })}
                  lang={p.tag}
                  aria-current={p.tag === current ? 'true' : undefined}
                >
                  {p.displayName}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className={styles['twoCols']}>
          <ButtonLink href={ctx.href('s01', { locale: current })}>
            {t('proto.index.start')}
          </ButtonLink>
          <ButtonLink variant="secondary" href={ctx.href('a01', { locale: current })}>
            {t('proto.index.startHost')}
          </ButtonLink>
        </div>
        {GROUPS.map((group) => (
          <section
            key={group.id}
            className={styles['section']}
            aria-labelledby={`proto-flow-${group.id}`}
          >
            <h2 id={`proto-flow-${group.id}`} className={styles['h2']}>
              {t(group.title)}
            </h2>
            <ol className={styles['indexList']}>
              {SCREENS.filter((screen) => screen.group === group.id).map((screen) => (
                <li key={screen.id} className={styles['indexItem']}>
                  <a className={styles['link']} href={ctx.href(screen.id, { locale: current })}>
                    {t(screen.title)}
                  </a>
                  <ul className={styles['chips']} aria-label={t('proto.index.states')}>
                    {screen.states.map((state) => (
                      <li key={state}>
                        <a
                          className={styles['chip']}
                          href={ctx.href(screen.id, { locale: current, state })}
                        >
                          {t(`proto.state.${state}`)}
                        </a>
                      </li>
                    ))}
                  </ul>
                  {REQUIRED.filter((s) => !screen.states.includes(s)).length > 0 && (
                    <p className={styles['na']}>
                      {REQUIRED.filter((s) => !screen.states.includes(s))
                        .map((s) => t(`proto.state.${s}`))
                        .join(', ')}
                      {' — '}
                      {t('proto.state.notApplicable')}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </section>
        ))}
        <p className={styles['muted']}>{t('proto.index.later')}</p>
      </main>
    </div>
  );
}
