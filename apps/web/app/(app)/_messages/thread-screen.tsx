/**
 * S16 — messages du trip (US-525, ADR-181 ; 16 MSG-001 / MSG-007 ; 10b S16) : écran commun au
 * voyageur (`/trips/{id}/messages`) et à l'hôte (`/host/trips/{id}/messages`). La partie est celle
 * de la session, jugée par l'API et la base (voyageur, titulaire du compte d'hôte, co-hôte de
 * portée) ; un trip dont la session n'est pas partie rend le même message qu'un trip inconnu.
 *
 * Contenu (10b S16) : bandeau permanent « tout paiement passe par la plateforme »
 * (`web.s16.payOnPlatform`), prénoms seulement, horodatage à l'heure locale du trip, coordonnées
 * masquées avec explication (MSG-007), rappels à l'expéditeur après un envoi signalé (critères 1
 * et 2 d'US-525), fil en lecture seule après la fin du trip + `review_window_days`, formulaire qui
 * garde le texte en cas d'échec. Rendu serveur ; jamais de texte de message dans une URL.
 *
 * Rendez-vous (US-316, ADR-186 ; 10b S16 « heure et détails du rendez-vous ») : bloc
 * « rendez-vous » au-dessus du fil : remise et retour proposés par l'hôte (lieu sans coordonnées,
 * heure locale du trip, statut), confirmation ou refus par le voyageur, formulaire de proposition
 * pour l'hôte ; les avis n'en donnent que l'heure. Rendez-vous illisibles : le fil reste servi, le
 * bloc dit l'erreur.
 */
import { randomUUID } from 'node:crypto';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { Banner, Button, ButtonLink, EmptyState, ErrorState } from '@rueda/ui';
import { callApi, codeOf } from '../../../account/api-client.ts';
import { clientContext } from '../../../account/request.ts';
import {
  ANSWER_ERROR_KEYS,
  answerErrorFromQuery,
  meetingDoneFromQuery,
  tripMeetingsOf,
} from '../../../account/trip-meetings.ts';
import type { MeetingKind, MeetingStatus, TripMeetings } from '../../../account/trip-meetings.ts';
import { noticesFromQuery, threadPath, tripThreadOf } from '../../../account/trip-messages.ts';
import type { TripMessage, ViewerRole } from '../../../account/trip-messages.ts';
import { getRequestBrand } from '../../../brand-source.ts';
import { getRequestI18n, getRequestLocaleTag } from '../../../i18n.ts';
import accountStyles from '../_account/account.module.css';
import { MAIN_ID } from '../_shell/main-id.ts';
import hostStyles from '../host/host.module.css';
import { answerMeetingAction } from './meeting-actions.ts';
import { MeetingForm } from './meeting-form.tsx';
import { MessageForm } from './message-form.tsx';
import styles from './messages.module.css';

const ROLE_KEYS = {
  GUEST: 'web.s16.role.GUEST',
  HOST: 'web.s16.role.HOST',
  CO_HOST: 'web.s16.role.CO_HOST',
} as const satisfies Readonly<Record<ViewerRole, string>>;
const KIND_KEYS = {
  PICKUP: 'web.s16.meeting.kind.PICKUP',
  RETURN: 'web.s16.meeting.kind.RETURN',
} as const satisfies Readonly<Record<MeetingKind, string>>;
const STATUS_KEYS = {
  PROPOSED: 'web.s16.meeting.status.PROPOSED',
  ACCEPTED: 'web.s16.meeting.status.ACCEPTED',
  DECLINED: 'web.s16.meeting.status.DECLINED',
} as const satisfies Readonly<Record<MeetingStatus, string>>;
const DONE_KEYS = {
  PROPOSED: 'web.s16.meeting.done.PROPOSED',
  ACCEPTED: 'web.s16.meeting.done.ACCEPTED',
  DECLINED: 'web.s16.meeting.done.DECLINED',
} as const;

export interface ThreadScreenProps {
  readonly scope: 'guest' | 'host';
  readonly tripId: string;
  /** Retour au détail du trip (S09 ou A05). */
  readonly back: string;
  readonly query: Readonly<Record<string, string | string[] | undefined>>;
}

export async function ThreadScreen({ scope, tripId, back, query }: ThreadScreenProps) {
  const [i18n, localeTag, brand] = await Promise.all([
    getRequestI18n(),
    getRequestLocaleTag(),
    getRequestBrand(),
  ]);
  const t = i18n.t.bind(i18n);
  const ctx = await clientContext();
  if (ctx.sessionToken === null) redirect('/login');
  const self = threadPath(scope, tripId);
  const shell = (title: string, body: ReactNode) => (
    <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']}>
      <header className={accountStyles['stackTight']}>
        <a className={hostStyles['link']} href={back}>
          {t('web.s16.back')}
        </a>
        <h1 className={accountStyles['h1']} data-testid="s16-title">
          {t('web.s16.heading')}
        </h1>
        <p className={accountStyles['muted']}>{title}</p>
      </header>
      <div data-testid="s16-pay-on-platform">
        <Banner tone="info">{t('web.s16.payOnPlatform', { brand: brand.name })}</Banner>
      </div>
      {body}
    </main>
  );
  const notFound = shell(
    t('web.s16.withUnknown'),
    <EmptyState icon="car" headingLevel={2} title={t('common.trips.notFound')} />,
  );
  if (self === null) return notFound;
  const [reply, meetingsReply] = await Promise.all([
    callApi('GET', `/trips/${tripId}/messages`, ctx),
    callApi('GET', `/trips/${tripId}/meetings`, ctx),
  ]);
  if (reply.status === 401) redirect('/login');
  if (codeOf(reply) === 'TERMS_REACCEPT_REQUIRED') redirect('/terms/update');
  if (reply.status === 404) return notFound;
  const thread = tripThreadOf(reply, tripId);
  if (thread === null) {
    return shell(
      t('web.s16.withUnknown'),
      <ErrorState
        i18n={i18n}
        message={t('web.s16.loadError')}
        action={<ButtonLink href={self}>{t('web.s16.retry')}</ButtonLink>}
      />,
    );
  }
  const name = thread.counterpartName;
  const notices = noticesFromQuery(query['n']);
  // identifiant du prochain message : un nouvel écran (après un envoi) remonte le formulaire vide
  const messageId = randomUUID();
  const sent = query['sent'] === '1';
  const meetings: TripMeetings | null = tripMeetingsOf(meetingsReply, tripId);
  const meetingDone = meetingDoneFromQuery(query['mt']);
  const answerError = answerErrorFromQuery(query['me']);
  // identifiant de la prochaine proposition (même principe que le message)
  const meetingId = randomUUID();
  const authorOf = (m: TripMessage): string =>
    m.mine ? t('web.s16.you') : (m.authorName ?? t(ROLE_KEYS[m.authorRole]));
  return shell(
    name === null ? t('web.s16.withUnknown') : t('web.s16.with', { name }),
    <>
      <p className={accountStyles['muted']}>{t('web.s16.privacy')}</p>
      <section
        aria-labelledby="s16-meeting"
        className={`${styles['form']} ${styles['meetings']}`}
        data-testid="s16-meetings"
      >
        <h2 id="s16-meeting" className={accountStyles['h2']}>
          {t('web.s16.meeting.heading')}
        </h2>
        {meetingDone !== null && (
          <div data-testid="s16-meeting-done">
            <Banner tone="success" live="polite">
              {t(DONE_KEYS[meetingDone])}
            </Banner>
          </div>
        )}
        {answerError !== null && (
          <div data-testid="s16-meeting-error">
            <Banner tone="danger" live="assertive">
              {t(ANSWER_ERROR_KEYS[answerError])}
            </Banner>
          </div>
        )}
        {meetings === null ? (
          <p className={accountStyles['muted']} data-testid="s16-meetings-error">
            {t('common.messages.unavailable')}
          </p>
        ) : (
          <>
            <p className={accountStyles['muted']}>
              {meetings.viewerRole === 'GUEST'
                ? t('web.s16.meeting.leadGuest')
                : t('web.s16.meeting.leadHost')}{' '}
              {t('web.s16.meeting.privacy')}
            </p>
            {meetings.meetings.length === 0 ? (
              <p className={accountStyles['muted']} data-testid="s16-meetings-none">
                {t('web.s16.meeting.none')}
              </p>
            ) : (
              <ul className={styles['thread']}>
                {meetings.meetings.map((m) => (
                  <li key={m.id} className={styles['meeting']} data-testid="s16-meeting">
                    <p className={styles['author']}>
                      {t(KIND_KEYS[m.kind])} · {t(STATUS_KEYS[m.status])}
                    </p>
                    <p className={styles['body']}>
                      <time dateTime={m.meetAt}>{i18n.dateTime(m.meetAt, meetings.timezone)}</time>
                    </p>
                    <p className={styles['body']}>
                      {t('web.s16.meeting.place', { place: m.place })}
                    </p>
                    {meetings.viewerRole === 'GUEST' && m.status === 'PROPOSED' && (
                      <form action={answerMeetingAction} className={styles['answers']}>
                        <input type="hidden" name="trip" value={tripId} />
                        <input type="hidden" name="meeting" value={m.id} />
                        <Button
                          type="submit"
                          name="decision"
                          value="ACCEPT"
                          data-testid="s16-meeting-accept"
                        >
                          {t('web.s16.meeting.accept')}
                        </Button>
                        <Button
                          type="submit"
                          name="decision"
                          value="DECLINE"
                          variant="secondary"
                          data-testid="s16-meeting-decline"
                        >
                          {t('web.s16.meeting.decline')}
                        </Button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {meetings.canPropose && (
              <MeetingForm
                key={meetingId}
                localeTag={localeTag}
                tripId={tripId}
                timezone={meetings.timezone}
                meetingId={meetingId}
              />
            )}
          </>
        )}
      </section>
      {sent && notices.length === 0 && (
        <div data-testid="s16-sent">
          <Banner tone="success" live="polite">
            {t('web.s16.sent')}
          </Banner>
        </div>
      )}
      {notices.includes('CONTACT_MASKED') && (
        <div data-testid="s16-notice-contact">
          <Banner tone="warning" live="polite">
            {t('web.s16.notice.contactMasked', { brand: brand.name })}
          </Banner>
        </div>
      )}
      {notices.includes('OFF_PLATFORM_PAYMENT') && (
        <div data-testid="s16-notice-payment">
          <Banner tone="warning" live="polite">
            {t('web.s16.notice.offPlatform', { brand: brand.name })}
          </Banner>
        </div>
      )}
      <section aria-labelledby="s16-thread" className={styles['form']}>
        <h2 id="s16-thread" className={accountStyles['h2']}>
          {name === null ? t('web.s16.withUnknown') : t('web.s16.with', { name })}
        </h2>
        {thread.messages.length === 0 ? (
          <p className={accountStyles['muted']} data-testid="s16-empty">
            {thread.viewerRole === 'GUEST'
              ? t('web.s16.empty', { host_name: name ?? t('web.s16.role.HOST') })
              : t('web.s16.emptyHost', { name: name ?? t('web.s16.role.GUEST') })}
          </p>
        ) : (
          <ol className={styles['thread']} data-testid="s16-thread">
            {thread.messages.map((m) => (
              <li
                key={m.id}
                className={m.mine ? `${styles['bubble']} ${styles['mine']}` : styles['bubble']}
                data-testid="s16-message"
              >
                <p className={styles['author']}>{authorOf(m)}</p>
                <p className={styles['body']}>
                  {m.body ?? (m.purged ? t('web.s16.purged') : t('web.s16.hidden'))}
                </p>
                {m.body !== null && m.masked && (
                  <p className={styles['meta']}>{t('web.s16.masked')}</p>
                )}
                <p className={styles['meta']}>
                  <time dateTime={m.sentAt}>
                    {t('web.s16.sentAt', { date: i18n.dateTime(m.sentAt, thread.timezone) })}
                  </time>
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
      {thread.writable ? (
        <>
          {thread.closesAt !== null && (
            <p className={accountStyles['muted']}>
              {t('web.s16.closesAt', { date: i18n.date(thread.closesAt, thread.timezone) })}
            </p>
          )}
          <MessageForm
            key={messageId}
            localeTag={localeTag}
            tripId={tripId}
            scope={scope}
            messageId={messageId}
          />
        </>
      ) : (
        <div data-testid="s16-closed">
          <Banner tone="info">{t('web.s16.closed')}</Banner>
        </div>
      )}
    </>,
  );
}
