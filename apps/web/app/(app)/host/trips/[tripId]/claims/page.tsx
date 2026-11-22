import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { randomUUID } from 'node:crypto';
import { getProfile } from '@rueda/i18n';
import type { MessageKey } from '@rueda/i18n';
import { Badge, Banner, ButtonLink, EmptyState, ErrorState } from '@rueda/ui';
import type { BadgeTone } from '@rueda/ui';
import { callApi } from '../../../../../../account/api-client.ts';
import { hostAccountsOf, priceExample } from '../../../../../../account/host-listings.ts';
import { hostTripOf } from '../../../../../../account/host-trips.ts';
import { clientContext } from '../../../../../../account/request.ts';
import { feePercentText, tripClaimsOf, UUID } from '../../../../../../account/trip-claims.ts';
import { tripInspectionOf } from '../../../../../../account/trip-inspection.ts';
import { getRequestBrand } from '../../../../../../brand-source.ts';
import { getRequestI18n, getRequestLocaleTag } from '../../../../../../i18n.ts';
import { LOCALE_CONFIG } from '../../../../../../locale-config.ts';
import accountStyles from '../../../../_account/account.module.css';
import { FreePhotoCapture } from '../../../../_inspection/free-photo-capture.tsx';
import { MAIN_ID } from '../../../../_shell/main-id.ts';
import styles from '../../../host.module.css';
import { TrafficChargeForm } from './traffic-charge-form.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.traffic.title'), robots: { index: false, follow: false } };
}

const STATUS_TONE: Readonly<Record<string, BadgeTone>> = {
  PENDING: 'neutral',
  DONE: 'success',
  BLOCKED: 'warning',
};

/**
 * A09 · sinistres du trip vus par l'hôte (US-318, ADR-198 ; 19 US-318 critères 1 et 3 ; 16 TRP-038,
 * CLM-002 ; 08 BR-TT-02 à 05 ; 22 OQ-BR-17, OQ-BR-19 ; 10b A09) : (a) vol présumé (dossier ouvert
 * quand l'escalade atteint la plainte) : état, déclaration à l'assureur partenaire, versement
 * retenu tant que le vol est présumé ; Kmino ne récupère ni n'immobilise jamais la voiture ;
 * (b) amende, péage ou fourrière payés par l'hôte pour la période du trip, avec la pièce
 * photographiée, refacturés au voyageur avec les frais de gestion du pays (jamais un transfert de
 * l'amende ; parking de récupération non refacturable) ; (c) refacturations déclarées et leur état.
 * Réservé au titulaire du compte d'hôte : toute autre personne ou un trip inconnu rend le même
 * message (404 de l'API).
 */
export default async function HostTripClaimsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly tripId: string }>;
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const [i18n, tag, brand, { tripId }, query] = await Promise.all([
    getRequestI18n(),
    getRequestLocaleTag(),
    getRequestBrand(),
    params,
    searchParams,
  ]);
  const t = i18n.t.bind(i18n);
  const ctx = await clientContext();
  const org = typeof query['org'] === 'string' ? query['org'] : undefined;
  const orgQuery = org === undefined ? '' : `?org=${org}`;
  const back = UUID.test(tripId) ? `/host/trips/${tripId}${orgQuery}` : '/host/trips';
  const shell = (body: ReactNode) => (
    <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']}>
      <header className={accountStyles['stackTight']}>
        <a className={styles['link']} href={back}>
          {t('web.traffic.back')}
        </a>
        <h1 className={accountStyles['h1']} data-testid="a09-claims-title">
          {t('web.traffic.title')}
        </h1>
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
  const error = shell(
    <ErrorState
      i18n={i18n}
      message={t('common.tripClaims.unavailable')}
      action={<ButtonLink href={back}>{t('web.a05.retry')}</ButtonLink>}
    />,
  );
  const notFound = shell(
    <EmptyState icon="car" headingLevel={2} title={t('common.tripClaims.notFound')} />,
  );
  if (ctx.sessionToken === null) return login;
  const session = await callApi('GET', '/auth/session', ctx);
  if (session.status === 401) return login;
  const accounts = hostAccountsOf(session);
  if (accounts === null) return error;
  const account = accounts.find((a) => a.orgId === org) ?? accounts[0];
  if (account === undefined || !UUID.test(tripId)) return notFound;
  const [tripReply, claimsReply, seriesReply] = await Promise.all([
    callApi('GET', `/host/accounts/${account.orgId}/trips/${tripId}`, ctx),
    callApi('GET', `/trips/${tripId}/claims`, ctx),
    callApi('GET', `/trips/${tripId}/inspections/traffic`, ctx),
  ]);
  if (tripReply.status === 404 || claimsReply.status === 404) return notFound;
  const read = hostTripOf(tripReply);
  const claims = tripClaimsOf(claimsReply, tripId);
  if (read === null || claims === null) return error;
  const series = seriesReply.status === 200 ? tripInspectionOf(seriesReply) : null;
  const timezone = read.trip.timezone;
  const money = (minor: string) =>
    i18n.money({
      amountMinor: BigInt(minor),
      currency: read.market.currency,
      exponent: read.market.currencyExponent,
    });
  const available = claims.evidence
    .filter((e) => !e.used)
    .map((e) => ({ fileId: e.fileId, receivedAt: e.receivedAt }))
    .reverse();
  const number = getProfile(LOCALE_CONFIG, tag).number;
  return shell(
    <>
      {claims.theft !== null && (
        <section className={styles['section']} aria-labelledby="a09-theft-title">
          <h2 id="a09-theft-title" className={accountStyles['h2']}>
            {t('web.theft.title')}
          </h2>
          <Banner tone={claims.theft.status === 'RETURNED' ? 'info' : 'warning'} live="polite">
            <span data-testid="a09-theft-status">
              {t(`web.theft.status.${claims.theft.status}` as MessageKey, {
                time: i18n.dateTime(claims.theft.closedAt ?? claims.theft.openedAt, timezone),
              })}
            </span>
          </Banner>
          <p className={accountStyles['text']} data-testid="a09-theft-insurer">
            {t(`web.theft.insurer.${claims.theft.insurerStatus}` as MessageKey)}
          </p>
          {claims.theft.status === 'THEFT_INVESTIGATION' && (
            <p className={accountStyles['text']}>{t('web.theft.payoutHeld')}</p>
          )}
          <p className={accountStyles['muted']}>
            {t('web.theft.noRecovery', { brand: brand.name })}
          </p>
        </section>
      )}
      <section className={styles['section']} aria-labelledby="a09-traffic-rules">
        <h2 id="a09-traffic-rules" className={accountStyles['h2']}>
          {t('web.traffic.rules.title')}
        </h2>
        {claims.deadlineAt !== null && (
          <p className={accountStyles['text']} data-testid="a09-traffic-deadline">
            {t('web.traffic.deadline', { time: i18n.dateTime(claims.deadlineAt, timezone) })}
          </p>
        )}
        {claims.feeBps !== null && (
          <p className={accountStyles['text']} data-testid="a09-traffic-fee">
            {t('web.traffic.feeRule', { pct: feePercentText(claims.feeBps, tag) })}
          </p>
        )}
        <p className={accountStyles['muted']}>{t('web.traffic.rules.lead')}</p>
      </section>
      {claims.open ? (
        <>
          <section className={styles['section']} aria-labelledby="a09-traffic-photos-title">
            <h2 id="a09-traffic-photos-title" className={accountStyles['h2']}>
              {t('web.traffic.photos.title')}
            </h2>
            <FreePhotoCapture
              localeTag={tag}
              tripId={tripId}
              kind="traffic"
              timezone={timezone}
              taken={claims.evidence.map((e) => ({ slot: e.slot, receivedAt: e.receivedAt }))}
              editable={series !== null && series.uploads.open}
              maxBytes={series?.uploads.maxBytes ?? 0}
              maxLongSidePx={series?.uploads.maxLongSidePx ?? 0}
              testId="a09-traffic"
            />
          </section>
          <section className={styles['section']}>
            <TrafficChargeForm
              localeTag={tag}
              tripId={tripId}
              org={account.orgId}
              requestId={randomUUID()}
              timezone={timezone}
              evidence={available}
              amountExample={priceExample(read.market.currencyExponent, number)}
            />
          </section>
        </>
      ) : (
        <Banner tone="info" live="polite">
          <span data-testid="a09-traffic-closed">
            {t(
              claims.tripEndAt === null
                ? 'common.tripClaims.trafficTripNotEnded'
                : 'web.traffic.closed',
            )}
          </span>
        </Banner>
      )}
      <section className={styles['section']} aria-labelledby="a09-charges-title">
        <h2 id="a09-charges-title" className={accountStyles['h2']}>
          {t('web.traffic.list.title')}
        </h2>
        {claims.charges.length === 0 ? (
          <p className={accountStyles['muted']} data-testid="a09-charges-empty">
            {t('web.traffic.list.empty')}
          </p>
        ) : (
          <ul className={styles['rows']} data-testid="a09-charges">
            {claims.charges.map((c) => (
              <li key={c.id} className={styles['card']}>
                <p className={styles['strong']}>
                  {t(`web.traffic.kind.${c.kind}`)} · {i18n.dateTime(c.occurredAt, timezone)}
                </p>
                <p className={accountStyles['text']}>
                  {t('web.traffic.list.amounts', {
                    amount: money(c.amountMinor),
                    fee: money(c.adminFeeMinor),
                    total: money(c.totalMinor),
                  })}
                </p>
                <Badge tone={STATUS_TONE[c.status] ?? 'neutral'}>
                  {t(`web.traffic.status.${c.status}`)}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>,
  );
}
