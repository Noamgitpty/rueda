import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { Banner, ButtonLink, EmptyState, ErrorState } from '@rueda/ui';
import { callApi, codeOf } from '../../../../../account/api-client.ts';
import { hostAccountsOf, listingsOf, vehiclesOf } from '../../../../../account/host-listings.ts';
import { hostRequestOf, requestHref } from '../../../../../account/host-requests.ts';
import { clientContext } from '../../../../../account/request.ts';
import { getRequestI18n, getRequestLocaleTag } from '../../../../../i18n.ts';
import accountStyles from '../../../_account/account.module.css';
import { MAIN_ID } from '../../../_shell/main-id.ts';
import styles from '../../host.module.css';
import { DecisionForm } from '../decision-form.tsx';
import { RequestCard } from '../request-card.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.a05.request.pageTitle'), robots: { index: false, follow: false } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const one = (v: string | string[] | undefined): string | undefined =>
  typeof v === 'string' ? v : undefined;

/**
 * A05 — une demande de réservation (US-223 partie 223d, ADR-152 ; routes de 223c, ADR-146 ; 19
 * US-219 critères 4 à 6 ; 10b A05 « en mode REQUEST boutons `web.a05.accept` / `web.a05.decline`
 * avec heure limite », UX-52). Le serveur lit l'API avec la session de l'hôte ; une demande
 * inconnue, d'un autre compte ou déjà sortie de l'attente rend la même réponse (404) : message sans
 * détail. Deux étapes : la demande et ses deux boutons, puis la confirmation (`?confirm=accept|
 * decline`) qui dit la conséquence (montant débité au voyageur, ou aucun débit et dates libérées)
 * avant le bouton final. Une demande acceptée dont la capture attend sa preuve n'offre plus aucune
 * action. Aucun montant n'est calculé ici : total et jambe HOST relus de l'API, exposant de la
 * devise du compte.
 */
export default async function HostRequestPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly holdId: string }>;
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const [i18n, localeTag, { holdId }, query] = await Promise.all([
    getRequestI18n(),
    getRequestLocaleTag(),
    params,
    searchParams,
  ]);
  const t = i18n.t.bind(i18n);
  const ctx = await clientContext();
  const org = one(query['org']);
  const back = org === undefined ? '/host/trips' : `/host/trips?org=${encodeURIComponent(org)}`;
  const shell = (body: ReactNode) => (
    <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']}>
      <header className={accountStyles['stackTight']}>
        <a className={styles['link']} href={back}>
          {t('web.a05.back')}
        </a>
        <h1 className={accountStyles['h1']}>{t('web.a05.request.pageTitle')}</h1>
      </header>
      {body}
    </main>
  );
  const login = shell(
    <EmptyState
      icon="car"
      title={t('web.host.loginRequired')}
      action={<ButtonLink href="/login">{t('web.host.login')}</ButtonLink>}
    />,
  );
  const notFound = shell(
    <EmptyState
      icon="car"
      headingLevel={2}
      title={t('common.request.notFound')}
      action={<ButtonLink href={back}>{t('web.a05.back')}</ButtonLink>}
    />,
  );
  if (ctx.sessionToken === null) return login;
  const session = await callApi('GET', '/auth/session', ctx);
  if (session.status === 401) return login;
  const accounts = hostAccountsOf(session);
  const error = shell(
    <ErrorState
      i18n={i18n}
      message={t('web.a05.requests.loadError')}
      action={<ButtonLink href={back}>{t('web.a05.retry')}</ButtonLink>}
    />,
  );
  if (accounts === null) return error;
  const account = accounts.find((a) => a.orgId === org);
  if (account === undefined || !UUID.test(holdId)) return notFound;
  const base = `/host/accounts/${account.orgId}`;
  const [reqReply, vehReply, lstReply] = await Promise.all([
    callApi('GET', `${base}/requests/${holdId}`, ctx),
    callApi('GET', `${base}/vehicles`, ctx),
    callApi('GET', `${base}/listings`, ctx),
  ]);
  if (reqReply.status === 401) redirect('/login');
  if (codeOf(reqReply) === 'TERMS_REACCEPT_REQUIRED') redirect('/terms/update');
  if (reqReply.status === 404) return notFound;
  const request = hostRequestOf(reqReply);
  const market = listingsOf(lstReply)?.market ?? null;
  // devise de la demande ≠ devise du compte : aucun montant affiché avec un exposant douteux
  if (request === null || market === null || market.currency !== request.currency) return error;
  const v = (vehiclesOf(vehReply) ?? []).find((x) => x.id === request.vehicleId);
  const car =
    v === undefined
      ? null
      : `${[v.makeText, v.modelText].filter(Boolean).join(' ')} ${v.year} · ${v.plate}`;
  const amount = i18n.money({
    amountMinor: request.totalMinor,
    currency: request.currency,
    exponent: market.currencyExponent,
  });
  const confirm = one(query['confirm']);
  const card = (
    <RequestCard
      i18n={i18n}
      request={request}
      car={car}
      exponent={market.currencyExponent}
      href={null}
      headingLevel={2}
    />
  );
  if (request.status === 'CAPTURING') {
    return shell(
      <>
        {card}
        <Banner tone="info" live="off">
          {t('web.a05.request.capturingBody')}
        </Banner>
      </>,
    );
  }
  if (confirm === 'accept' || confirm === 'decline') {
    const accept = confirm === 'accept';
    return shell(
      <>
        {card}
        <section
          className={styles['section']}
          aria-labelledby="a05-confirm"
          data-testid="a05-confirm"
          data-verb={confirm}
        >
          <h2 id="a05-confirm" className={accountStyles['h2']}>
            {t(
              accept
                ? 'web.a05.request.confirmAccept.title'
                : 'web.a05.request.confirmDecline.title',
            )}
          </h2>
          <p className={accountStyles['text']}>
            {accept
              ? t('web.a05.request.confirmAccept.body', { amount })
              : t('web.a05.request.confirmDecline.body')}
          </p>
          <DecisionForm
            localeTag={localeTag}
            orgId={account.orgId}
            holdId={request.holdId}
            verb={confirm}
          />
          <ButtonLink variant="quiet" href={requestHref(account.orgId, request.holdId)}>
            {t('web.a05.request.cancel')}
          </ButtonLink>
        </section>
      </>,
    );
  }
  return shell(
    <>
      {card}
      <div className={accountStyles['stack']}>
        <ButtonLink
          href={requestHref(account.orgId, request.holdId, 'accept')}
          data-testid="a05-open-accept"
        >
          {t('web.a05.accept')}
        </ButtonLink>
        <ButtonLink
          variant="secondary"
          href={requestHref(account.orgId, request.holdId, 'decline')}
          data-testid="a05-open-decline"
        >
          {t('web.a05.decline')}
        </ButtonLink>
      </div>
    </>,
  );
}
