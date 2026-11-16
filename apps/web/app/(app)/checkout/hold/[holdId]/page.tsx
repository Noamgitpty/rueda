import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { Banner, ButtonLink, EmptyState, ErrorState } from '@rueda/ui';
import type { MessageKey } from '@rueda/i18n';
import { callApi, codeOf } from '../../../../../account/api-client.ts';
import { checkoutHoldOf, isUuid } from '../../../../../account/checkout.ts';
import { publicListingOf } from '../../../../../account/host-listings.ts';
import { clientContext } from '../../../../../account/request.ts';
import { getRequestI18n } from '../../../../../i18n.ts';
import accountStyles from '../../../_account/account.module.css';
import { MAIN_ID } from '../../../_shell/main-id.ts';
import styles from '../../../host/host.module.css';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.s05.hold.title'), robots: { index: false, follow: false } };
}

function Shell({ children }: { readonly children: ReactNode }) {
  return (
    <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']}>
      {children}
    </main>
  );
}

const DOC_LABEL: Readonly<Record<string, MessageKey>> = {
  TOS_GUEST: 'web.s05.doc.TOS_GUEST',
  CANCELLATION_POLICY: 'web.s05.doc.CANCELLATION_POLICY',
  GEO_TERMS: 'web.s05.doc.GEO_TERMS',
};

/**
 * S05 — hold posé (US-208, partie 208b ; 10b UX `web.s05.hold.until`) : l'auto est gardé pour le
 * voyageur jusqu'à l'heure d'expiration du hold (heure du lieu), avec le total du devis engagé et
 * la version exacte de chaque document accepté (19 US-208 critère 3, relu par
 * `GET /checkout/holds/{id}`). Aucun paiement ici : l'intention de paiement arrive avec US-223.
 */
export default async function HoldPage({
  params,
}: {
  readonly params: Promise<{ readonly holdId: string }>;
}) {
  const [i18n, { holdId }] = await Promise.all([getRequestI18n(), params]);
  const t = i18n.t.bind(i18n);
  const ctx = await clientContext();
  if (ctx.sessionToken === null) redirect('/login');
  const notFound = (
    <Shell>
      <h1 className={accountStyles['h1']}>{t('web.s05.hold.title')}</h1>
      <EmptyState
        icon="car"
        headingLevel={2}
        title={t('web.s05.hold.notFound')}
        body={t('common.checkout.holdNotFound')}
        action={<ButtonLink href="/">{t('web.listing.search')}</ButtonLink>}
      />
    </Shell>
  );
  if (!isUuid(holdId)) return notFound;
  const reply = await callApi('GET', `/checkout/holds/${holdId}`, ctx);
  if (reply.status === 401) redirect('/login');
  if (codeOf(reply) === 'TERMS_REACCEPT_REQUIRED') redirect('/terms/update');
  if (reply.status === 404) return notFound;
  const hold = checkoutHoldOf(reply);
  const listing =
    hold === null
      ? null
      : publicListingOf(
          await callApi('GET', `/listings/${hold.listingId}`, { ...ctx, sessionToken: null }),
        );
  if (
    hold === null ||
    listing === null ||
    listing.currency !== hold.currency ||
    listing.timezone === null
  ) {
    return (
      <Shell>
        <h1 className={accountStyles['h1']}>{t('web.s05.hold.title')}</h1>
        <ErrorState
          i18n={i18n}
          message={t('web.s05.error')}
          action={<ButtonLink href={`/checkout/hold/${holdId}`}>{t('web.host.retry')}</ButtonLink>}
        />
      </Shell>
    );
  }
  const tz = listing.timezone;
  const active = hold.status === 'ACTIVE';
  return (
    <Shell>
      <header className={accountStyles['stackTight']}>
        <h1 className={accountStyles['h1']}>{t('web.s05.hold.title')}</h1>
      </header>
      {active ? (
        <Banner tone="success" live="polite">
          {t('web.s05.hold.until', { time: i18n.time(hold.expiresAt, tz) })}
        </Banner>
      ) : (
        <Banner tone="warning" live="polite">
          {t('web.s05.hold.ended')}
        </Banner>
      )}
      <section className={styles['section']} aria-labelledby="s05-hold-trip">
        <h2 id="s05-hold-trip" className={accountStyles['h2']}>
          {t('web.s05.summary.title')}
        </h2>
        <p className={styles['strong']}>
          {`${listing.makeName} ${listing.modelName} ${listing.year}`}
        </p>
        <dl className={accountStyles['stackTight']}>
          <div>
            <dt className={accountStyles['muted']}>{t('web.s05.summary.pickup')}</dt>
            <dd className={accountStyles['text']}>{i18n.dateTime(hold.startAt, tz)}</dd>
          </div>
          <div>
            <dt className={accountStyles['muted']}>{t('web.s05.summary.return')}</dt>
            <dd className={accountStyles['text']}>{i18n.dateTime(hold.endAt, tz)}</dd>
          </div>
        </dl>
        {/* total du devis engagé, tel que la base l'a rejoué (jamais recalculé ici) */}
        <p className={styles['price']} data-testid="s05-hold-total">
          {t('web.s05.hold.total', {
            amount: i18n.money({
              amountMinor: hold.totalMinor,
              currency: hold.currency,
              exponent: listing.currencyExponent,
            }),
          })}
        </p>
      </section>
      <section className={styles['section']} aria-labelledby="s05-hold-docs">
        <h2 id="s05-hold-docs" className={accountStyles['h2']}>
          {t('web.s05.hold.documents')}
        </h2>
        <ul className={styles['list']} data-testid="s05-hold-documents">
          {hold.documents.map((d) => (
            <li key={d.kind}>
              {t('web.s05.hold.accepted', {
                document: t(DOC_LABEL[d.kind] ?? 'web.s05.doc.TOS_GUEST'),
                version: String(d.version),
              })}
            </li>
          ))}
        </ul>
      </section>
      <p className={accountStyles['muted']}>{t('web.s05.hold.payment')}</p>
      <ButtonLink variant="quiet" href={`/listings/${hold.listingId}`}>
        {t('web.s05.back')}
      </ButtonLink>
    </Shell>
  );
}
