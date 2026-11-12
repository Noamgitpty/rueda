import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Badge, Banner, ButtonLink, EmptyState, ErrorState } from '@rueda/ui';
import type { BadgeTone } from '@rueda/ui';
import { callApi } from '../../../../../account/api-client.ts';
import { calendarOf, durationLabel, NOTICE_PRESETS } from '../../../../../account/host-calendar.ts';
import type { EntryKind } from '../../../../../account/host-calendar.ts';
import { hostAccountsOf, vehiclesOf } from '../../../../../account/host-listings.ts';
import { clientContext } from '../../../../../account/request.ts';
import { getRequestI18n, getRequestLocaleTag } from '../../../../../i18n.ts';
import accountStyles from '../../../_account/account.module.css';
import { MAIN_ID } from '../../../_shell/main-id.ts';
import styles from '../../host.module.css';
import { BlockDaysForm, BlockHoursForm, NoticeForm, UnblockForm } from './calendar-forms.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.calendar.title'), robots: { index: false, follow: false } };
}

const TONE: Readonly<Record<EntryKind, BadgeTone>> = {
  TRIP: 'success',
  HOLD: 'warning',
  HOST_BLOCK: 'neutral',
  BUFFER: 'neutral',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A06 — calendrier d'un véhicule de l'hôte (US-119 ; 16 CAL-001 / CAL-002, CAL-003 ; bêta :
 * liste des occupations, 16 CAL-001 « SIMPLIFIÉ ») : occupations à venir (trip, réservation en
 * cours, blocage, battement), bornes dans le fuseau du véhicule ; blocage par jours ou par heures ;
 * préavis du lieu de remise. Jamais le voyageur. États : sans session, véhicule inconnu (404 de
 * l'API, aussi pour le véhicule d'un autre hôte), vide, erreur, chargement (`loading.tsx`).
 */
export default async function VehicleCalendarPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly vehicleId: string }>;
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const [i18n, tag, { vehicleId }, query] = await Promise.all([
    getRequestI18n(),
    getRequestLocaleTag(),
    params,
    searchParams,
  ]);
  const t = i18n.t.bind(i18n);
  const ctx = await clientContext();
  const shell = (body: ReactNode, intro = true) => (
    <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']}>
      <header className={accountStyles['stackTight']}>
        <a
          className={styles['link']}
          href={orgParam(query) === null ? '/host' : `/host?org=${orgParam(query)}`}
        >
          {t('web.calendar.back')}
        </a>
        <h1 className={accountStyles['h1']}>{t('web.calendar.title')}</h1>
        {intro && <p className={accountStyles['muted']}>{t('web.calendar.intro')}</p>}
      </header>
      {body}
    </main>
  );
  const error = shell(
    <ErrorState
      i18n={i18n}
      message={t('web.host.error')}
      action={<ButtonLink href="/host">{t('web.host.retry')}</ButtonLink>}
    />,
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
  if (accounts === null) return error;
  const wanted = orgParam(query);
  const account = accounts.find((a) => a.orgId === wanted) ?? accounts[0];
  const notFound = shell(<EmptyState icon="car" title={t('web.calendar.notFound')} />, false);
  if (account === undefined || !UUID.test(vehicleId)) return notFound;
  const base = `/host/accounts/${account.orgId}`;
  const [calReply, vehReply] = await Promise.all([
    callApi('GET', `${base}/vehicles/${vehicleId}/calendar`, ctx),
    callApi('GET', `${base}/vehicles`, ctx),
  ]);
  if (calReply.status === 404) return notFound;
  const calendar = calendarOf(calReply);
  const vehicles = vehiclesOf(vehReply);
  if (calendar === null || vehicles === null) return error;
  const car = vehicles.find((v) => v.id === vehicleId);
  const { vehicle, entries } = calendar;
  const ids = { localeTag: tag, orgId: account.orgId, vehicleId: vehicle.id };
  const when = (iso: string) => i18n.dateTime(iso, vehicle.timezone);
  const presets = [...NOTICE_PRESETS];
  if (vehicle.noticeMinutes !== null && !presets.includes(vehicle.noticeMinutes)) {
    presets.push(vehicle.noticeMinutes);
    presets.sort((a, b) => a - b);
  }
  return shell(
    <>
      {car !== undefined && (
        <p className={accountStyles['text']}>
          <span className={styles['strong']}>
            {[car.makeText, car.modelText].filter(Boolean).join(' ')} {car.year} · {car.plate}
          </span>
        </p>
      )}
      <p className={styles['hint']}>{t('web.calendar.timezone', { timezone: vehicle.timezone })}</p>
      {query['saved'] === '1' && (
        <Banner tone="success" live="polite" icon="check">
          {t('web.host.saved')}
        </Banner>
      )}

      <section className={styles['section']} aria-labelledby="a06-upcoming">
        <h2 id="a06-upcoming" className={accountStyles['h2']}>
          {t('web.calendar.upcoming.title')}
        </h2>
        {entries.length === 0 ? (
          <p className={accountStyles['muted']}>{t('web.calendar.empty')}</p>
        ) : (
          <ul className={styles['rows']}>
            {entries.map((e) => {
              const range = t('web.calendar.range', {
                start: when(e.startsAt),
                end: when(e.endsAt),
              });
              return (
                <li key={e.id} className={styles['card']}>
                  <div className={styles['between']}>
                    <Badge tone={TONE[e.kind]}>{t(`web.calendar.kind.${e.kind}`)}</Badge>
                  </div>
                  <p className={accountStyles['text']}>{range}</p>
                  {e.removable && (
                    <UnblockForm
                      {...ids}
                      blockId={e.id}
                      label={`${t('web.calendar.remove')} · ${range}`}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className={styles['section']} aria-labelledby="a06-block">
        <h2 id="a06-block" className={accountStyles['h2']}>
          {t('web.calendar.block.title')}
        </h2>
        {vehicle.listed ? (
          <>
            <BlockDaysForm {...ids} />
            <BlockHoursForm {...ids} />
          </>
        ) : (
          <p className={accountStyles['muted']} role="status">
            {t('web.calendar.block.notListed')}
          </p>
        )}
      </section>

      <section className={styles['section']} aria-labelledby="a06-notice-title">
        <h2 id="a06-notice-title" className={accountStyles['h2']}>
          {t('web.calendar.notice.title')}
        </h2>
        <p className={accountStyles['muted']}>{t('web.calendar.notice.intro')}</p>
        {vehicle.effectiveNoticeMinutes !== null && (
          <p className={accountStyles['text']}>
            {t('web.calendar.notice.current', {
              duration: durationLabel(i18n, vehicle.effectiveNoticeMinutes),
            })}
          </p>
        )}
        <NoticeForm
          {...ids}
          locationId={vehicle.locationId}
          current={vehicle.noticeMinutes}
          options={presets.map((m) => ({ minutes: m, label: durationLabel(i18n, m) }))}
        />
      </section>
    </>,
  );
}

function orgParam(query: Readonly<Record<string, string | string[] | undefined>>): string | null {
  const org = query['org'];
  return typeof org === 'string' && UUID.test(org) ? org : null;
}
