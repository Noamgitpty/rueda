/**
 * Écran du no-show, commun à l'hôte (« le voyageur n'est pas venu ») et au voyageur (« l'hôte n'est
 * pas venu ») (US-307, ADR-191 ; 16 TRP-015 ; 10b A05, S09) : fenêtre de déclaration en heure
 * SERVEUR dans le fuseau du trip, preuve de l'attente tracée dans les messages du trip, déclaration
 * définitive confirmée, état de la demande. L'hôte est prévenu qu'une déclaration sans message ne lui
 * rapporte rien (OQ-BR-45, comme Turo) ; le voyageur, qu'il est remboursé de tout. Aucun montant
 * n'est affiché ici (le remboursement se lit sur l'écran du remboursement, US-224). En ligne
 * seulement. Un trip d'une autre personne, ou inconnu, rend le même message (404 de l'API).
 */
import { randomUUID } from 'node:crypto';
import type { ReactNode } from 'react';
import { Badge, Banner, ButtonLink, EmptyState, ErrorState } from '@rueda/ui';
import { callApi } from '../../../account/api-client.ts';
import { clientContext } from '../../../account/request.ts';
import {
  BLOCKER_KEYS,
  messagesHref,
  reasonKey,
  tripNoShowOf,
  UUID,
} from '../../../account/trip-no-show.ts';
import type { NoShowRole } from '../../../account/trip-no-show.ts';
import { getRequestI18n, getRequestLocaleTag } from '../../../i18n.ts';
import accountStyles from '../_account/account.module.css';
import { MAIN_ID } from '../_shell/main-id.ts';
import styles from '../host/host.module.css';
import { NoShowForm } from './no-show-form.tsx';

const STATUS_TONE = {
  PENDING: 'info',
  SETTLED: 'success',
  FIN_REVIEW: 'warning',
  FAILED: 'danger',
} as const;
const STATUS_BADGE = {
  PENDING: 'neutral',
  SETTLED: 'success',
  FIN_REVIEW: 'warning',
  FAILED: 'danger',
} as const;

export async function NoShowScreen({
  role,
  tripId,
  org,
}: {
  readonly role: NoShowRole;
  readonly tripId: string;
  readonly org: string | null;
}) {
  const [i18n, localeTag] = await Promise.all([getRequestI18n(), getRequestLocaleTag()]);
  const t = i18n.t.bind(i18n);
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
    role === 'HOST' ? `/host/trips/${tripId}/no-show${orgQuery}` : `/trips/${tripId}/no-show`;
  const shell = (body: ReactNode) => (
    <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']}>
      <header className={accountStyles['stackTight']}>
        <a className={styles['link']} href={back}>
          {t('web.noShow.back')}
        </a>
        <h1 className={accountStyles['h1']} data-testid="no-show-title">
          {t(role === 'HOST' ? 'web.noShow.title.HOST' : 'web.noShow.title.GUEST')}
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
    <EmptyState icon="car" headingLevel={2} title={t('common.noShow.notFound')} />,
  );
  if (!UUID.test(tripId)) return notFound;
  const reply = await callApi('GET', `/trips/${tripId}/no-show`, ctx);
  if (reply.status === 404 || reply.status === 401) return notFound;
  const view = tripNoShowOf(reply);
  if (view === null || view.viewerRole !== role) {
    return shell(
      <ErrorState
        i18n={i18n}
        message={
          reply.status === 'unavailable'
            ? t('common.noShow.unavailable')
            : t('web.noShow.loadError')
        }
        action={<ButtonLink href={self}>{t('web.noShow.retry')}</ButtonLink>}
      />,
    );
  }
  const date = (iso: string) => i18n.dateTime(iso, view.timezone);
  const d = view.declaration;
  return shell(
    <>
      {view.declarableFrom !== null && view.declarableUntil !== null && (
        <p className={accountStyles['text']} data-testid="no-show-window">
          {t(role === 'HOST' ? 'web.noShow.lead.HOST' : 'web.noShow.lead.GUEST', {
            d1: date(view.declarableFrom),
            d2: date(view.declarableUntil),
          })}
        </p>
      )}
      <p className={accountStyles['muted']}>
        {t(role === 'HOST' ? 'web.noShow.rule.HOST' : 'web.noShow.rule.GUEST')}
      </p>
      {d !== null ? (
        <section className={styles['card']} data-testid="no-show-declaration">
          <p className={styles['hint']}>
            <Badge tone={STATUS_BADGE[d.status]}>{t(reasonKey(d.requestedReason))}</Badge>
          </p>
          <Banner tone={STATUS_TONE[d.status]} live="polite">
            {t(`web.noShow.status.${d.status}`, { date: date(d.requestedAt) })}
          </Banner>
        </section>
      ) : (
        <section className={styles['card']} data-testid="no-show-proof">
          <p className={styles['hint']}>
            <Badge tone={view.messageTraced ? 'success' : 'warning'}>
              {t(view.messageTraced ? 'web.noShow.traced.yes' : 'web.noShow.traced.no')}
            </Badge>
          </p>
          <a className={styles['link']} href={messagesHref(role, view.tripId, org)}>
            {t('web.noShow.messagesLink')}
          </a>
        </section>
      )}
      {view.canDeclare ? (
        <NoShowForm
          localeTag={localeTag}
          tripId={view.tripId}
          role={role}
          org={org}
          requestId={randomUUID()}
        />
      ) : (
        view.blocker !== null &&
        d === null && (
          <Banner tone="info" live="off">
            <span data-testid="no-show-blocker">{t(BLOCKER_KEYS[view.blocker])}</span>
          </Banner>
        )
      )}
    </>,
  );
}
