/**
 * Écran de la remise et du retour entre particuliers, commun à l'hôte (A03 remise, A04 retour) et
 * au voyageur (S09 · check-in, S09 · check-out) (US-315, ADR-183 ; 10b UX-41, UX-42 ; 16 TRP-002,
 * VER-015, TRP-033) : un seul écran à étapes, chacune dit ce qui bloque et pourquoi :
 *   1. arrivée (« Ya llegué ») et blocages de la remise (paiement, contrat, caution, assureur) ;
 *   2. contrôle du permis physique par l'hôte : prénom, initiale et année de naissance du
 *      voyageur, rien d'autre (jamais le numéro ni l'image d'une pièce), 6 cases ou refus motivé ;
 *   3. photos des deux côtés (écran des photos d'US-303) ;
 *   4. relevés et validation de sa part ; fin : heure SERVEUR dans le fuseau du trip.
 * Remise en personne seulement : aucune option sans rencontre (OQ-P2P-05). En ligne seulement
 * (ADR-005, ADR-039 : aucune file hors ligne au lot 3). Un trip d'une autre personne, ou inconnu,
 * rend le même message (404 de l'API, rien n'est révélé).
 */
import type { ReactNode } from 'react';
import type { MessageKey } from '@rueda/i18n';
import { Badge, Banner, ButtonLink, EmptyState, ErrorState } from '@rueda/ui';
import { callApi } from '../../../account/api-client.ts';
import { clientContext } from '../../../account/request.ts';
import { directionOf, photosHref, tripHandoverOf, UUID } from '../../../account/trip-handover.ts';
import type { PhotoSeriesStatus } from '../../../account/trip-handover.ts';
import { getRequestI18n, getRequestLocaleTag } from '../../../i18n.ts';
import accountStyles from '../_account/account.module.css';
import { MAIN_ID } from '../_shell/main-id.ts';
import styles from '../host/host.module.css';
import { IdentityForm, OpenForm, ValidateForm } from './handover-forms.tsx';

export interface HandoverScreenProps {
  readonly role: 'HOST' | 'GUEST';
  readonly tripId: string;
  readonly direction: string;
  readonly org: string | null;
}

const SERIES_BADGE: Readonly<Record<PhotoSeriesStatus, 'neutral' | 'warning' | 'success'>> = {
  NONE: 'neutral',
  DRAFT: 'warning',
  SUBMITTED: 'success',
};

export async function HandoverScreen({ role, tripId, direction, org }: HandoverScreenProps) {
  const [i18n, localeTag] = await Promise.all([getRequestI18n(), getRequestLocaleTag()]);
  const t = i18n.t.bind(i18n);
  const segment = directionOf(direction);
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
      ? `/host/trips/${tripId}/handover/${direction}${orgQuery}`
      : `/trips/${tripId}/handover/${direction}`;
  const shell = (body: ReactNode) => (
    <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']}>
      <header className={accountStyles['stackTight']}>
        <a className={styles['link']} href={back}>
          {t('web.handover.back')}
        </a>
        <h1 className={accountStyles['h1']} data-testid="handover-title">
          {t(segment === 'checkout' ? 'web.handover.title.checkout' : 'web.handover.title.checkin')}
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
    <EmptyState icon="car" headingLevel={2} title={t('common.handover.notFound')} />,
  );
  if (!UUID.test(tripId) || segment === null) return notFound;
  const reply = await callApi('GET', `/trips/${tripId}/handover/${segment}`, ctx);
  if (reply.status === 404 || reply.status === 401) return notFound;
  const view = tripHandoverOf(reply);
  if (view === null || view.viewerRole !== role) {
    return shell(
      <ErrorState
        i18n={i18n}
        message={
          reply.status === 'unavailable'
            ? t('common.handover.unavailable')
            : t('web.handover.loadError')
        }
        action={<ButtonLink href={self}>{t('web.handover.retry')}</ButtonLink>}
      />,
    );
  }
  const common = { localeTag, tripId: view.tripId, direction: view.direction, role, org };
  const checkin = view.direction === 'checkin';
  const mine = view.validations.mine;
  const other = view.validations.other;
  const failed = view.identityCheck?.status === 'FAILED';
  const identityOk = !checkin || view.identityCheck?.status === 'OK';
  const photosDone = view.photos.mine === 'SUBMITTED';
  const date = (iso: string) => i18n.dateTime(iso, view.timezone);
  const step = (id: string, title: MessageKey, body: ReactNode) => (
    <li className={styles['card']} aria-labelledby={id} data-testid={id}>
      <h2 id={id} className={accountStyles['h2']}>
        {t(title)}
      </h2>
      {body}
    </li>
  );
  const blockersList =
    view.blockers.length === 0 ? null : (
      <div data-testid="handover-blockers">
        <p className={styles['strong']}>{t('web.handover.blockersTitle')}</p>
        <ul className={styles['list']}>
          {view.blockers.map((b) => (
            <li key={b}>{t(`web.handover.blocker.${b}`)}</li>
          ))}
        </ul>
      </div>
    );

  const arrival =
    checkin &&
    step(
      'handover-step-arrival',
      'web.handover.step.arrival',
      view.tripStatus === 'BOOKED' ? (
        <>
          {view.opensAt !== null && (
            <p className={styles['hint']}>
              {t('web.handover.opensAt', { date: date(view.opensAt) })}
            </p>
          )}
          {blockersList}
          <OpenForm {...common} disabled={!view.canOpen} />
        </>
      ) : (
        <>
          <p className={styles['hint']}>
            {t(view.open ? 'web.handover.opened' : 'web.handover.closed')}
          </p>
          {blockersList}
        </>
      ),
    );

  const license =
    checkin &&
    step(
      'handover-step-license',
      'web.handover.step.license',
      failed ? (
        <Banner tone="danger" live="off">
          {t('web.handover.license.failed')}
        </Banner>
      ) : view.identityCheck?.status === 'OK' ? (
        <p className={styles['hint']}>
          <Badge tone="success">{t('web.handover.license.ok')}</Badge>
        </p>
      ) : role === 'GUEST' ? (
        <p className={styles['hint']}>{t('web.handover.license.guest')}</p>
      ) : !view.open ? (
        <p className={styles['hint']}>{t('web.handover.closed')}</p>
      ) : (
        <>
          <p className={accountStyles['text']}>{t('web.handover.license.lead')}</p>
          <dl className={styles['rows']} data-testid="handover-guest">
            <div>
              <dt className={styles['strong']}>{t('web.handover.license.name')}</dt>
              <dd>
                {view.guest?.firstName != null
                  ? `${view.guest.firstName}${view.guest.lastInitial != null ? ` ${view.guest.lastInitial}.` : ''}`
                  : t('web.handover.license.unknown')}
              </dd>
            </div>
            <div>
              <dt className={styles['strong']}>{t('web.handover.license.birthYear')}</dt>
              <dd>
                {view.guest?.birthYear != null
                  ? String(view.guest.birthYear)
                  : t('web.handover.license.unknown')}
              </dd>
            </div>
          </dl>
          <IdentityForm {...common} />
        </>
      ),
    );

  const series = (who: 'mine' | 'other') => {
    const s = view.photos[who];
    const key: MessageKey =
      who === 'mine'
        ? `web.handover.photos.mine.${s}`
        : `web.handover.photos.other.${role === 'HOST' ? 'GUEST' : 'HOST'}.${s}`;
    return (
      <p className={styles['hint']}>
        <Badge tone={SERIES_BADGE[s]}>{t(key)}</Badge>
      </p>
    );
  };
  const photos = step(
    'handover-step-photos',
    'web.handover.step.photos',
    <>
      {series('mine')}
      {series('other')}
      {(view.open || photosDone) && (
        <a
          className={styles['link']}
          href={photosHref(role, view.tripId, view.direction, org)}
          data-testid="handover-photos-link"
        >
          {t(photosDone ? 'web.handover.photos.view' : 'web.handover.photos.take')}
        </a>
      )}
    </>,
  );

  const reading = (v: NonNullable<typeof mine>) =>
    t('web.handover.reading', { km: String(v.odometerKm), fuel: String(v.fuelEighths) });
  const finish = step(
    'handover-step-validate',
    checkin ? 'web.handover.step.keys' : 'web.handover.step.close',
    view.completedAt !== null ? (
      <Banner tone="success" live="polite">
        {t(checkin ? 'web.handover.done.checkin' : 'web.handover.done.checkout', {
          date: date(view.completedAt),
        })}
      </Banner>
    ) : mine !== null ? (
      <>
        <p className={styles['hint']} data-testid="handover-mine">
          {reading(mine)}
        </p>
        {other === null && (
          <Banner tone="info" live="polite">
            {t(role === 'HOST' ? 'web.handover.waiting.HOST' : 'web.handover.waiting.GUEST')}
          </Banner>
        )}
      </>
    ) : !view.open ? (
      <p className={styles['hint']}>
        {t(checkin ? 'web.handover.closed' : 'web.handover.checkoutClosed')}
      </p>
    ) : failed ? (
      <p className={styles['hint']}>{t('web.handover.license.failed')}</p>
    ) : !photosDone ? (
      <p className={styles['hint']}>{t('web.handover.photosFirst')}</p>
    ) : role === 'HOST' && !identityOk ? (
      <p className={styles['hint']}>{t('web.handover.licenseFirst')}</p>
    ) : (
      <>
        {other !== null && <p className={styles['hint']}>{t('web.handover.otherDone')}</p>}
        <ValidateForm {...common} />
      </>
    ),
  );

  return shell(
    <>
      <p className={accountStyles['text']}>
        {t(checkin ? 'web.handover.lead.checkin' : 'web.handover.lead.checkout')}
      </p>
      <p className={accountStyles['muted']}>{t('web.handover.online')}</p>
      <ol className={styles['rows']} data-testid="handover-steps">
        {arrival}
        {license}
        {photos}
        {finish}
      </ol>
    </>,
  );
}
