/**
 * Écran des photos d'état du véhicule, commun à l'hôte (A03 remise, A04 retour) et au voyageur
 * (S09 · check-in, S09 · check-out) (US-303, ADR-179 ; 10b UX-07 ; 16 TRP-004) : rendu serveur de
 * la série de la session (`GET /trips/{id}/inspections/{kind}`), compteur des photos obligatoires,
 * avancement de l'autre partie (sa série ne remplace pas la tienne), assistant de capture.
 * Un trip d'une autre personne, ou inconnu, rend le même message (404 de l'API, rien n'est révélé).
 */
import type { ReactNode } from 'react';
import { Badge, Banner, ButtonLink, EmptyState, ErrorState } from '@rueda/ui';
import { callApi } from '../../../account/api-client.ts';
import { getRequestBrand } from '../../../brand-source.ts';
import { clientContext } from '../../../account/request.ts';
import {
  kindSegmentOf,
  requiredProgress,
  tripInspectionOf,
  UUID,
} from '../../../account/trip-inspection.ts';
import { getRequestI18n, getRequestLocaleTag } from '../../../i18n.ts';
import accountStyles from '../_account/account.module.css';
import { MAIN_ID } from '../_shell/main-id.ts';
import styles from '../host/host.module.css';
import { InspectionCapture } from './inspection-capture.tsx';

export interface InspectionScreenProps {
  readonly role: 'HOST' | 'GUEST';
  readonly tripId: string;
  readonly kind: string;
  readonly org: string | null;
  readonly done: boolean;
}

export async function InspectionScreen({ role, tripId, kind, org, done }: InspectionScreenProps) {
  const [i18n, localeTag, brand] = await Promise.all([
    getRequestI18n(),
    getRequestLocaleTag(),
    getRequestBrand(),
  ]);
  const t = i18n.t.bind(i18n);
  const segment = kindSegmentOf(kind);
  const orgQuery = org === null ? '' : `?org=${org}`;
  const back =
    role === 'HOST'
      ? UUID.test(tripId)
        ? `/host/trips/${tripId}${orgQuery}`
        : '/host/trips'
      : UUID.test(tripId)
        ? `/trips/${tripId}`
        : '/trips';
  const self =
    role === 'HOST'
      ? `/host/trips/${tripId}/inspection/${kind}${orgQuery}`
      : `/trips/${tripId}/inspection/${kind}`;
  const shell = (body: ReactNode) => (
    <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']}>
      <header className={accountStyles['stackTight']}>
        <a className={styles['link']} href={back}>
          {t('web.inspection.back')}
        </a>
        <h1 className={accountStyles['h1']} data-testid="inspection-title">
          {t(
            segment === 'checkout'
              ? 'web.inspection.title.checkout'
              : 'web.inspection.title.checkin',
          )}
        </h1>
      </header>
      {body}
    </main>
  );
  const ctx = await clientContext();
  if (ctx.sessionToken === null) {
    return shell(
      <EmptyState
        icon="car"
        headingLevel={2}
        title={t('web.host.loginRequired')}
        action={<ButtonLink href="/login">{t('web.host.login')}</ButtonLink>}
      />,
    );
  }
  const notFound = shell(
    <EmptyState icon="car" headingLevel={2} title={t('common.inspection.notFound')} />,
  );
  if (!UUID.test(tripId) || segment === null) return notFound;
  const reply = await callApi('GET', `/trips/${tripId}/inspections/${segment}`, ctx);
  if (reply.status === 404 || reply.status === 401) return notFound;
  const view = tripInspectionOf(reply);
  if (view === null || view.viewerRole !== role) {
    return shell(
      <ErrorState
        i18n={i18n}
        message={t('web.inspection.loadError')}
        action={<ButtonLink href={self}>{t('web.inspection.retry')}</ButtonLink>}
      />,
    );
  }
  const mine = requiredProgress(view.slots, view.mine);
  const theirs = requiredProgress(view.slots, view.other);
  const submitted = view.mine.status === 'SUBMITTED';
  const taken = Object.fromEntries(view.mine.photos.map((p) => [p.slot, p.receivedAt]));
  return shell(
    <>
      <p className={accountStyles['text']}>{t('web.inspection.lead', { brand: brand.name })}</p>
      {(done || submitted) && (
        <Banner tone="success" live="polite">
          {t('web.s09c.done')}
          {view.mine.submittedAt !== null &&
            ` · ${t('web.inspection.doneAt', {
              date: i18n.dateTime(view.mine.submittedAt, view.timezone),
            })}`}
        </Banner>
      )}
      {!view.open && !submitted && (
        <Banner tone="info" live="off">
          {t('web.inspection.closed')}
        </Banner>
      )}
      {view.open && !submitted && !view.uploads.open && (
        <Banner tone="warning" live="off">
          {t('web.inspection.uploadsClosed')}
        </Banner>
      )}
      <section className={styles['card']} data-testid="inspection-progress">
        <p className={styles['strong']}>
          {t('web.inspection.progress', { count: mine.done, total: mine.total })}
        </p>
        <p className={styles['hint']}>
          {t(
            view.other.role === 'HOST' ? 'web.inspection.other.HOST' : 'web.inspection.other.GUEST',
            {
              count: theirs.done,
              total: theirs.total,
            },
          )}{' '}
          {view.other.status === 'SUBMITTED' && (
            <Badge tone="success">{t('web.inspection.otherDone')}</Badge>
          )}
        </p>
      </section>
      <InspectionCapture
        localeTag={localeTag}
        tripId={view.tripId}
        kind={segment}
        role={role}
        org={org}
        timezone={view.timezone}
        slots={view.slots}
        taken={taken}
        editable={view.uploads.open && !submitted}
        maxBytes={view.uploads.maxBytes}
        maxLongSidePx={view.uploads.maxLongSidePx}
      />
    </>,
  );
}
