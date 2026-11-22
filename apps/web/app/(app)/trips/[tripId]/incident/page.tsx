import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { Banner, ButtonLink, EmptyState } from '@rueda/ui';
import { callApi } from '../../../../../account/api-client.ts';
import { tripHelpOf } from '../../../../../account/help.ts';
import { clientContext } from '../../../../../account/request.ts';
import { UUID } from '../../../../../account/trip-claims.ts';
import { tripInspectionOf } from '../../../../../account/trip-inspection.ts';
import { getRequestBrand } from '../../../../../brand-source.ts';
import { getRequestI18n, getRequestLocaleTag } from '../../../../../i18n.ts';
import accountStyles from '../../../_account/account.module.css';
import { HelpNumbers } from '../../../_help/help-numbers.tsx';
import { FreePhotoCapture } from '../../../_inspection/free-photo-capture.tsx';
import { MAIN_ID } from '../../../_shell/main-id.ts';
import styles from '../../../host/host.module.css';
import { IncidentForm } from './incident-form.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.incident.title'), robots: { index: false, follow: false } };
}

/**
 * S17 · incidente — accident ou panne déclaré par le voyageur pendant le trip (US-318, ADR-198 ;
 * 19 US-318 critère 2 ; 16 CLM-002 ; 08 BR-DAMAGE-01, BR-PROT-05 ; 10b S17, S11). En tête, les
 * numéros du pays DU TRIP (urgence, autorité de circulation, assistance routière de l'assureur
 * partenaire : donnée de pays, jamais une constante ; absente ⇒ renvoi à l'aide dans l'appli), le
 * rappel de ne pas continuer à rouler après un dommage plus que mineur, puis les photos prises par
 * la caméra de l'application (série `incident`, heure serveur) et la déclaration, rattachée à la
 * demande d'aide (`?case=`, identifiant seulement). Un trip d'une autre personne ou inconnu rend le
 * même message ; l'hôte n'a pas de série d'incident (même message).
 */
export default async function TripIncidentPage({
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
  if (ctx.sessionToken === null) redirect('/login');
  const back = UUID.test(tripId) ? `/trips/${tripId}/help` : '/trips';
  const shell = (body: ReactNode) => (
    <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']}>
      <header className={accountStyles['stackTight']}>
        <a className={styles['link']} href={back}>
          {t('web.incident.back')}
        </a>
        <h1 className={accountStyles['h1']} data-testid="s17-incident-title">
          {t('web.incident.title')}
        </h1>
      </header>
      {body}
    </main>
  );
  const notFound = shell(
    <EmptyState icon="car" headingLevel={2} title={t('common.tripClaims.notFound')} />,
  );
  if (!UUID.test(tripId)) return notFound;
  const rawCase = query['case'];
  const caseId = typeof rawCase === 'string' ? rawCase.toLowerCase() : '';
  const [helpReply, seriesReply] = await Promise.all([
    callApi('GET', `/trips/${tripId}/help`, ctx),
    callApi('GET', `/trips/${tripId}/inspections/incident`, ctx),
  ]);
  if (helpReply.status === 401 || seriesReply.status === 401) redirect('/login');
  if (helpReply.status === 404 || seriesReply.status === 404) return notFound;
  const help = tripHelpOf(helpReply, tripId);
  const series = tripInspectionOf(seriesReply);
  const numbers =
    help === null ? (
      <Banner tone="danger" live="assertive">
        <span data-testid="s17-incident-help-unavailable">{t('web.help.unavailable')}</span>
      </Banner>
    ) : (
      <HelpNumbers i18n={i18n} help={help.help} brand={brand.name} idPrefix="s17-incident" />
    );
  const warning = (
    <Banner tone="warning">
      <span data-testid="s17-incident-stop">{t('web.incident.stopDriving')}</span>
    </Banner>
  );
  if (series === null || series.viewerRole !== 'GUEST') {
    return shell(
      <>
        {numbers}
        <Banner tone="danger" live="assertive">
          {t('common.tripClaims.unavailable')}
        </Banner>
      </>,
    );
  }
  if (!series.open) {
    return shell(
      <>
        {numbers}
        <Banner tone="info" live="polite">
          <span data-testid="s17-incident-closed">{t('common.tripClaims.incidentNotOpen')}</span>
        </Banner>
      </>,
    );
  }
  if (!UUID.test(caseId)) {
    return shell(
      <>
        {numbers}
        {warning}
        <Banner tone="info" live="polite">
          <span data-testid="s17-incident-no-case">
            {t('common.tripClaims.incidentCaseRequired')}
          </span>
        </Banner>
        <ButtonLink href={`/trips/${tripId}/help`} data-testid="s17-incident-ask-help">
          {t('web.incident.askHelp')}
        </ButtonLink>
      </>,
    );
  }
  return shell(
    <>
      {numbers}
      {warning}
      <section className={styles['section']} aria-labelledby="s17-incident-photos-title">
        <h2 id="s17-incident-photos-title" className={accountStyles['h2']}>
          {t('web.incident.photos.title')}
        </h2>
        <p className={accountStyles['muted']}>{t('web.incident.photos.lead')}</p>
        <FreePhotoCapture
          localeTag={tag}
          tripId={tripId}
          kind="incident"
          timezone={series.timezone}
          taken={series.mine.photos.map((p) => ({ slot: p.slot, receivedAt: p.receivedAt }))}
          editable={series.uploads.open}
          maxBytes={series.uploads.maxBytes}
          maxLongSidePx={series.uploads.maxLongSidePx}
          testId="s17-incident"
        />
      </section>
      <section className={styles['section']}>
        <IncidentForm
          localeTag={tag}
          tripId={tripId}
          caseId={caseId}
          requestId={randomUUID()}
          timezone={series.timezone}
        />
      </section>
    </>,
  );
}
