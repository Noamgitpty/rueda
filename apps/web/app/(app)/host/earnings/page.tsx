import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Badge, Banner, ButtonLink, EmptyState, ErrorState } from '@rueda/ui';
import { callApi } from '../../../../account/api-client.ts';
import { percentLabel, planName, sharePercentOf } from '../../../../account/earnings-plans.ts';
import { hostEarningsOf, monthOf, shiftMonth } from '../../../../account/host-earnings.ts';
import type { EarningLineView } from '../../../../account/host-earnings.ts';
import { hostAccountsOf } from '../../../../account/host-listings.ts';
import { clientContext } from '../../../../account/request.ts';
import { getRequestBrand } from '../../../../brand-source.ts';
import { getRequestI18n, getRequestLocaleTag } from '../../../../i18n.ts';
import accountStyles from '../../_account/account.module.css';
import { MAIN_ID } from '../../_shell/main-id.ts';
import styles from '../host.module.css';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.a08.title'), robots: { index: false, follow: false } };
}

const textOf = (
  q: Readonly<Record<string, string | string[] | undefined>>,
  key: string,
): string | undefined => (typeof q[key] === 'string' ? q[key] : undefined);

/** Nom du pays dans la langue de la vue (`Intl.DisplayNames`), sinon son code. */
function countryName(tag: string, code: string): string {
  try {
    return new Intl.DisplayNames([tag], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** « mayo de 2034 » : libellé du mois du relevé (affichage seulement, en UTC). */
function monthLabel(tag: string, month: string): string {
  try {
    return new Intl.DateTimeFormat(tag, {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${month}-01T12:00:00.000Z`));
  } catch {
    return month;
  }
}

/**
 * A08 — gains de l'hôte (US-217 partie 217b, ADR-161 / ADR-167 ; 19 US-217 critères 1 et 2 ; 10b
 * A08, UX-45 ; 16 PYO-013 ; 08 E7, BR-PROT-06). Relevé d'un mois lu de
 * `GET /host/accounts/{orgId}/earnings/{month}` : par devise, **acquis** (jambes HOST des règlements
 * et pénalités du host_ledger) et **à liquider** (trips à venir ou en cours, capturés sans
 * règlement), deux sommes rendues par l'API (N-339) ; puis une carte par trip (base sur laquelle la
 * part est calculée, commission de Kmino, part de l'hôte selon le plan figé) et, sur une ligne À
 * PART, chaque pénalité de l'hôte (08 E7 règle 7). Montants jamais recalculés ni additionnés ici ;
 * PYG sans décimale. Aucun versement n'est promis : `payouts_enabled` vaut `false` en production et
 * aucune date de versement n'existe encore (`web.a08.payoutsOff`, 10b ; PROPOSÉ). Navigation par
 * mois (`?month=YYYY-MM`, mois courant UTC par défaut). Un compte d'un autre hôte n'est jamais lisible
 * (404 de l'API). Relevé annuel : lot 5 (US-541) ; PDF : HTML accessible équivalent (10b UX-51).
 */
export default async function HostEarningsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const [i18n, tag, query, brand] = await Promise.all([
    getRequestI18n(),
    getRequestLocaleTag(),
    searchParams,
    getRequestBrand(),
  ]);
  const t = i18n.t.bind(i18n);
  const ctx = await clientContext();
  const org = textOf(query, 'org');
  const shell = (body: ReactNode) => (
    <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']}>
      <header className={accountStyles['stackTight']}>
        <a className={styles['link']} href={org === undefined ? '/host' : `/host?org=${org}`}>
          {t('web.a08.back')}
        </a>
        <h1 className={accountStyles['h1']} data-testid="a08-title">
          {t('web.a08.title')}
        </h1>
        <p className={accountStyles['muted']}>{t('web.a08.intro')}</p>
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
  if (ctx.sessionToken === null) return login;
  const session = await callApi('GET', '/auth/session', ctx);
  if (session.status === 401) return login;
  const accounts = hostAccountsOf(session);
  const month = monthOf(textOf(query, 'month'), new Date());
  const self = (m: string, o: string) =>
    `/host/earnings?${new URLSearchParams({ org: o, month: m }).toString()}`;
  const error = (o: string | undefined) =>
    shell(
      <ErrorState
        i18n={i18n}
        message={t('web.a08.loadError')}
        action={
          <ButtonLink href={o === undefined ? '/host/earnings' : self(month, o)}>
            {t('web.a08.retry')}
          </ButtonLink>
        }
      />,
    );
  if (accounts === null) return error(undefined);
  if (accounts.length === 0) {
    return shell(
      <EmptyState icon="car" title={t('web.host.noAccount')} body={t('web.host.noAccount.body')} />,
    );
  }
  const account = accounts.find((a) => a.orgId === org) ?? accounts[0];
  if (account === undefined) return error(undefined);
  const reply = await callApi(
    'GET',
    `/host/accounts/${account.orgId}/earnings/${encodeURIComponent(month)}`,
    ctx,
  );
  const view = hostEarningsOf(reply);
  if (view === null || view.month !== month) return error(account.orgId);

  const label = monthLabel(tag, month);
  const nav = (
    <nav aria-label={t('web.a08.monthNav')} className={styles['between']}>
      <a
        className={styles['link']}
        href={self(shiftMonth(month, -1), account.orgId)}
        data-testid="a08-prev"
      >
        {t('web.a08.prev')}
      </a>
      <a
        className={styles['link']}
        href={self(shiftMonth(month, 1), account.orgId)}
        data-testid="a08-next"
      >
        {t('web.a08.next')}
      </a>
    </nav>
  );
  const payoutsOff = (
    <Banner tone="info">
      {t('web.a08.payoutsOff', { country: countryName(tag, view.country) })}
    </Banner>
  );
  const intermediary = (
    <p className={styles['hint']}>{t('web.a08.intermediary', { brand: brand.name })}</p>
  );
  if (view.statements.length === 0) {
    return shell(
      <>
        <h2 className={accountStyles['h2']} data-testid="a08-month">
          {t('web.a08.summary', { month: label })}
        </h2>
        {nav}
        <EmptyState icon="car" headingLevel={2} title={t('web.a08.empty')} />
        {payoutsOff}
        {intermediary}
      </>,
    );
  }
  const lineTitle = (l: EarningLineView): string =>
    l.kind === 'ADJUSTMENT'
      ? t('web.a08.line.HOST_CANCELLATION_PENALTY')
      : t(l.kind === 'EARNING' ? 'web.a08.line.EARNING' : 'web.a08.line.CXL_EARNING');
  const shareLabel = (l: EarningLineView): string => {
    const percent = sharePercentOf(l.hostSharePct);
    if (l.hostPlanCode === null || percent === null) return t('web.a08.line.shareNoPlan');
    return t('web.a08.line.share', {
      plan: planName(i18n, { planCode: l.hostPlanCode, sharePercent: percent }),
      share: percentLabel(i18n, percent),
    });
  };
  return shell(
    <>
      <h2 className={accountStyles['h2']} data-testid="a08-month">
        {t('web.a08.summary', { month: label })}
      </h2>
      {nav}
      {payoutsOff}
      {view.statements.map((s) => {
        const money = (amountMinor: bigint) =>
          i18n.money({ amountMinor, currency: s.currency, exponent: s.currencyExponent });
        return (
          <section
            key={s.currency}
            className={styles['section']}
            aria-labelledby={`a08-${s.currency}`}
            data-testid="a08-statement"
          >
            <h3 id={`a08-${s.currency}`} className={accountStyles['h2']}>
              {t('web.a08.tripsCount', { count: String(s.tripsCount) })}
            </h3>
            <div className={styles['card']}>
              <div className={styles['between']}>
                <span className={styles['strong']}>{t('web.a08.earned')}</span>
                <span className={styles['strong']} data-testid="a08-earned">
                  {money(s.earnedMinor)}
                </span>
              </div>
              <p className={styles['hint']}>{t('web.a08.earnedHint')}</p>
              <div className={styles['between']}>
                <span>{t('web.a08.pending')}</span>
                <span data-testid="a08-pending">{money(s.pendingMinor)}</span>
              </div>
              <p className={styles['hint']}>{t('web.a08.pendingHint')}</p>
            </div>
            <h4 className={accountStyles['h2']}>{t('web.a08.lines')}</h4>
            <ul className={styles['rows']} data-testid="a08-lines">
              {s.lines.map((l) => (
                <li
                  key={`${l.tripId}-${l.kind}-${l.eventAt}`}
                  className={styles['card']}
                  data-testid={`a08-line-${l.kind}`}
                >
                  <div className={styles['between']}>
                    <span className={styles['strong']}>{lineTitle(l)}</span>
                    {l.kind !== 'ADJUSTMENT' && (
                      <Badge tone={l.source === 'CAPTURE' ? 'warning' : 'success'}>
                        {t(
                          l.source === 'CAPTURE' ? 'web.a08.line.pending' : 'web.a08.line.settled',
                        )}
                      </Badge>
                    )}
                  </div>
                  {l.shareBaseMinor !== null && (
                    <div className={styles['between']}>
                      <span>{t('web.a08.line.base')}</span>
                      <span>{money(l.shareBaseMinor)}</span>
                    </div>
                  )}
                  {l.kminoFeeMinor !== null && (
                    <div className={styles['between']}>
                      <span>{t('web.a08.line.fee', { brand: brand.name })}</span>
                      <span data-testid="a08-fee">{money(l.kminoFeeMinor)}</span>
                    </div>
                  )}
                  <div className={styles['between']}>
                    <span>
                      {l.kind === 'ADJUSTMENT' ? t('web.a08.line.penaltyHint') : shareLabel(l)}
                    </span>
                    <span className={styles['strong']} data-testid="a08-amount">
                      {money(l.amountMinor)}
                    </span>
                  </div>
                  {l.kind !== 'ADJUSTMENT' && (
                    <a
                      className={styles['link']}
                      href={`/host/trips/${l.tripId}?${new URLSearchParams({ org: account.orgId }).toString()}`}
                    >
                      {t('web.a08.line.trip')}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {intermediary}
    </>,
  );
}
