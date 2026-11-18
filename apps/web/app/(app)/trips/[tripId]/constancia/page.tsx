import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { Banner, ButtonLink, EmptyState, ErrorState } from '@rueda/ui';
import { callApi, codeOf } from '../../../../../account/api-client.ts';
import { clientContext } from '../../../../../account/request.ts';
import { tripConstanciaOf, UUID } from '../../../../../account/trip-constancia.ts';
import { countryName, localInstant } from '../../../../../account/trip-contract.ts';
import { getRequestI18n, getRequestLocaleTag } from '../../../../../i18n.ts';
import accountStyles from '../../../_account/account.module.css';
import { Part } from '../../../_contract/contract-view.tsx';
import contractStyles from '../../../_contract/contract.module.css';
import { MAIN_ID } from '../../../_shell/main-id.ts';
import styles from '../../../host/host.module.css';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.constancia.title'), robots: { index: false, follow: false } };
}

/**
 * Constancia d'arrendamiento d'un trip (US-212, ADR-162 ; 16 LEG-026 ; 10b S07 « constancia PDF »,
 * S09, A05, UX-51) pour le voyageur ou l'hôte du trip : usage rappelé (contrôle routier pour le
 * voyageur, amende reçue après le trip pour l'hôte), bandeau BROUILLON tant que l'avocat n'a pas
 * validé le gabarit (GL-39), résumé (plaque, période à l'heure locale avec le NOM du pays, auto,
 * hôte et conducteur en prénom et initiale, lieu de remise, total payé, signature), PDF, texte
 * complet accessible (équivalent HTML : espagnol, qui fait foi, puis la langue du lecteur). Un trip
 * d'une autre personne, ou inconnu, rend le même message (404 de l'API, rien n'est révélé).
 */
export default async function TripConstanciaPage({
  params,
}: {
  readonly params: Promise<{ readonly tripId: string }>;
}) {
  const [i18n, localeTag, { tripId }] = await Promise.all([
    getRequestI18n(),
    getRequestLocaleTag(),
    params,
  ]);
  const t = i18n.t.bind(i18n);
  const ctx = await clientContext();
  if (ctx.sessionToken === null) redirect('/login');
  const self = `/trips/${tripId}/constancia`;
  const shell = (body: ReactNode, back: string | null = null) => (
    <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']}>
      <header className={accountStyles['stackTight']}>
        {back !== null && (
          <a className={styles['link']} href={back}>
            {t('web.constancia.back')}
          </a>
        )}
        <h1 className={accountStyles['h1']} data-testid="constancia-title">
          {t('web.constancia.title')}
        </h1>
      </header>
      {body}
    </main>
  );
  const empty = (key: Parameters<typeof t>[0]) =>
    shell(<EmptyState icon="car" headingLevel={2} title={t(key)} />);
  if (!UUID.test(tripId)) return empty('common.constancia.notFound');
  const reply = await callApi('GET', `/trips/${tripId}/constancia`, ctx);
  if (reply.status === 401) redirect('/login');
  const code = codeOf(reply);
  if (code === 'TERMS_REACCEPT_REQUIRED') redirect('/terms/update');
  if (reply.status === 404) return empty('common.constancia.notFound');
  if (code === 'CONSTANCIA_NOT_AVAILABLE') return empty('common.constancia.notAvailable');
  if (code === 'CONSTANCIA_ERASED') return empty('common.constancia.erased');
  if (code === 'CONSTANCIA_NOT_GENERATED') {
    return shell(
      <EmptyState
        icon="car"
        headingLevel={2}
        title={t('common.constancia.notGenerated')}
        action={<ButtonLink href={self}>{t('web.contract.retry')}</ButtonLink>}
      />,
    );
  }
  const c = tripConstanciaOf(reply);
  if (c === null) {
    return shell(
      <ErrorState
        i18n={i18n}
        message={t('web.constancia.loadError')}
        action={<ButtonLink href={self}>{t('web.contract.retry')}</ButtonLink>}
      />,
    );
  }
  const s = c.summary;
  const back =
    c.viewerRole === 'HOST' ? `/host/trips/${tripId}/contract` : `/trips/${tripId}/contract`;
  const when = (local: string) => i18n.dateTime(localInstant(local), 'UTC');
  const items: readonly [Parameters<typeof t>[0], string][] = [
    ['web.constancia.label.plate', s.plate],
    [
      'web.contract.label.period',
      t('web.contract.period', {
        start: when(s.startLocal),
        end: when(s.endLocal),
        country: countryName(localeTag, s.country),
      }),
    ],
    [
      'web.contract.label.vehicle',
      t('web.contract.vehicle', {
        make: s.vehicle.make,
        model: s.vehicle.model,
        year: String(s.vehicle.year),
      }),
    ],
    ['web.constancia.label.host', s.hostName],
    ['web.constancia.label.driver', s.driverName],
    [
      'web.constancia.label.place',
      [s.handoverPlace, s.handoverCity].filter((x): x is string => x !== null).join(', '),
    ],
    [
      'web.contract.label.total',
      i18n.money({
        amountMinor: BigInt(s.priceTotalMinor),
        currency: s.currency,
        exponent: s.currencyExponent,
      }),
    ],
    [
      'web.constancia.label.contract',
      s.signedAtLocal === null
        ? t('web.constancia.unsigned')
        : t('web.constancia.signed', { date: when(s.signedAtLocal) }),
    ],
  ];
  return shell(
    <>
      <p className={accountStyles['text']}>
        {t(c.viewerRole === 'HOST' ? 'web.constancia.leadHost' : 'web.constancia.lead')}
      </p>
      {c.draft && (
        <Banner tone="warning" live="off">
          {t('web.constancia.draft')}
        </Banner>
      )}
      <section className={styles['section']} aria-labelledby="constancia-summary">
        <h2 id="constancia-summary" className={accountStyles['h2']}>
          {t('web.contract.summary')}
        </h2>
        <p className={accountStyles['muted']}>
          {t('web.constancia.ref', { ref: s.tripRef, version: c.contractVersion })}
        </p>
        <dl className={contractStyles['summary']} data-testid="constancia-summary">
          {items.map(([label, value]) => (
            <div key={label} className={contractStyles['item']}>
              <dt>{t(label)}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <ButtonLink variant="secondary" href={`${self}/pdf`} data-testid="constancia-pdf">
          {t('web.constancia.pdf')}
        </ButtonLink>
        <p className={contractStyles['hash']}>{t('web.contract.hash', { hash: c.sha256 })}</p>
      </section>
      <section className={styles['section']} aria-labelledby="constancia-text">
        <h2 id="constancia-text" className={accountStyles['h2']}>
          {t('web.constancia.text')}
        </h2>
        {c.parts.map((p) => (
          <Part key={p.lang} part={p} t={t} />
        ))}
      </section>
    </>,
    back,
  );
}
