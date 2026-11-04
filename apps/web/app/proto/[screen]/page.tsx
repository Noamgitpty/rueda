import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ThemeMode } from '../../ui/theme-mode.tsx';
import { screenContext } from '../context.ts';
import { isPrototypeEnabled, screenOf } from '../options.ts';
import { SCREEN_COMPONENTS } from '../screens/index.ts';
import { Toolbar, styles } from '../shell.tsx';

// Évalué à chaque requête : le drapeau est lu au démarrage du serveur, pas au build.
export const dynamic = 'force-dynamic';

type Params = Promise<{ screen: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}): Promise<Metadata> {
  if (!isPrototypeEnabled()) return {};
  const spec = screenOf((await params).screen);
  if (!spec) return {};
  const ctx = await screenContext(await searchParams, spec);
  return {
    title: `${ctx.t(spec.title)} — ${ctx.t('proto.meta.title')}`,
    robots: { index: false, follow: false },
  };
}

/**
 * Prototype cliquable des écrans clés de la bêta (US-033) : `/proto/s01?lang=fr&state=empty`.
 * Données fictives, aucun appel d'API, aucun paiement. Ouvert seulement en développement ou avec
 * `WEB_PROTOTYPE_ENABLED=true` (jamais en production).
 */
export default async function ProtoScreenPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  if (!isPrototypeEnabled()) notFound();
  const { screen } = await params;
  const spec = screenOf(screen);
  const Screen = SCREEN_COMPONENTS[screen];
  if (!spec || !Screen) notFound();
  const ctx = await screenContext(await searchParams, spec);
  return (
    <div
      className={styles['page']}
      lang={ctx.i18n.profile.tag}
      data-screen={screen}
      data-state={ctx.state}
    >
      <ThemeMode mode={ctx.options.theme} />
      <div className={styles['phone']}>
        <p className={styles['ribbon']}>{ctx.t('proto.ribbon')}</p>
        {!ctx.options.capture && <Toolbar ctx={ctx} screen={screen} />}
        <Screen ctx={ctx} />
      </div>
    </div>
  );
}
