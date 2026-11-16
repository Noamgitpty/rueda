import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getProfile } from '@rueda/i18n';
import { ButtonLink, ErrorState } from '@rueda/ui';
import { callApi } from '../../../../account/api-client.ts';
import { clientContext, journeyCountry } from '../../../../account/request.ts';
import { getRequestI18n, getRequestLocaleTag } from '../../../../i18n.ts';
import { LOCALE_CONFIG } from '../../../../locale-config.ts';
import styles from '../../_account/account.module.css';
import { MAIN_ID } from '../../_shell/main-id.ts';
import { EntryForm } from './entry-form.tsx';
import type { EntryCountryOption } from './entry-form.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.s04.entry.title'), robots: { index: false, follow: false } };
}

/** Pays de la configuration rendus par `GET /identity` (lecture défensive ; forme inattendue ⇒ aucun). */
function countriesOf(json: unknown, language: string): EntryCountryOption[] {
  const list = (json as { countries?: unknown } | null)?.countries;
  if (!Array.isArray(list)) return [];
  const out: EntryCountryOption[] = [];
  for (const c of list as unknown[]) {
    const code = (c as { code?: unknown } | null)?.code;
    const names = (c as { names?: unknown } | null)?.names;
    if (typeof code !== 'string' || !/^[A-Z]{2}$/.test(code)) continue;
    const label =
      typeof names === 'object' && names !== null
        ? (names as Record<string, unknown>)[language]
        : undefined;
    out.push({ code, label: typeof label === 'string' ? label : code });
  }
  return out;
}

/**
 * Déclaration d'entrée du voyageur à permis étranger (US-209 partie 209c, ADR-144 ; 16 VER-007,
 * UXQ-03 ; route `POST /identity/entry-declaration` d'US-209b) : statut (touriste ou résident) et
 * date d'entrée, lus par l'ops à la revue d'une réservation signalée ; jamais un refus de
 * réservation (mode FLAG). Ouverte depuis S04 et depuis S05 d'un hold en revue. Sans session :
 * connexion. API injoignable : message dans la langue de la vue, aucun formulaire (fail-closed).
 */
export default async function EntryDeclarationPage({
  searchParams,
}: {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const [i18n, tag, query, ctx] = await Promise.all([
    getRequestI18n(),
    getRequestLocaleTag(),
    searchParams,
    clientContext(),
  ]);
  const t = i18n.t.bind(i18n);
  if (ctx.sessionToken === null) redirect('/login');
  const wanted = journeyCountry(query['country'], tag);
  const reply = await callApi(
    'GET',
    `/identity${wanted !== null ? `?country=${wanted}` : ''}`,
    ctx,
  );
  if (reply.status === 401) redirect('/login');
  const profile = getProfile(LOCALE_CONFIG, tag);
  const countries = reply.status === 200 ? countriesOf(reply.json, profile.language) : [];
  const defaultCountry = countries.find((c) => c.code === wanted)?.code ?? countries[0]?.code ?? '';
  return (
    <main id={MAIN_ID} tabIndex={-1} className={styles['content']}>
      <header className={styles['stackTight']}>
        <h1 className={styles['h1']}>{t('web.s04.entry.title')}</h1>
        <p className={styles['muted']}>{t('web.s04.entry.intro')}</p>
      </header>
      {countries.length === 0 ? (
        <ErrorState
          i18n={i18n}
          message={t('common.error.server')}
          action={<ButtonLink href="/verify-identity/entry">{t('web.host.retry')}</ButtonLink>}
        />
      ) : (
        <EntryForm localeTag={tag} countries={countries} defaultCountry={defaultCountry} />
      )}
      <ButtonLink variant="quiet" href="/verify-identity">
        {t('web.s04.entry.back')}
      </ButtonLink>
    </main>
  );
}
