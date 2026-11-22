/**
 * Écran des frais annexes, commun à l'hôte (A04 « Ajouter des frais avec justificatif ») et au
 * voyageur (S12 « payer ou contester ») (US-706, ADR-197 ; 16 CLM-021 ; 10b A04, S12) :
 * - hôte : délai pour demander (heure SERVEUR dans le fuseau du trip), formulaire (liste fermée,
 *   montant, motif, photos du trip), demandes envoyées avec leur état et l'état du paiement,
 *   annulation d'une demande en attente ou contestée ;
 * - voyageur : chaque frais demandé (type, montant, motif, nombre de photos, échéance), payer ou
 *   contester avec preuves avant l'échéance ; contestation, décision de la plateforme et paiement.
 * Aucune heure n'est saisie ; un trip d'une autre personne, ou inconnu, rend le même message (404
 * de l'API). En ligne seulement.
 */
import { randomUUID } from 'node:crypto';
import type { ReactNode } from 'react';
import type { MessageKey } from '@rueda/i18n';
import { getProfile } from '@rueda/i18n';
import { Badge, Banner, ButtonLink, EmptyState, ErrorState } from '@rueda/ui';
import { callApi } from '../../../account/api-client.ts';
import { priceExample } from '../../../account/host-listings.ts';
import { clientContext } from '../../../account/request.ts';
import {
  CHARGE_KEYS,
  DONE_KEYS,
  FEE_KEYS,
  incidentalHref,
  STATUS_KEYS,
  STATUS_TONE,
  tripIncidentalOf,
  UUID,
} from '../../../account/trip-incidental.ts';
import type { Done, IncidentalInvoice, IncidentalRole } from '../../../account/trip-incidental.ts';
import { getRequestBrand } from '../../../brand-source.ts';
import { getRequestI18n, getRequestLocaleTag } from '../../../i18n.ts';
import { LOCALE_CONFIG } from '../../../locale-config.ts';
import accountStyles from '../_account/account.module.css';
import { MAIN_ID } from '../_shell/main-id.ts';
import hostStyles from '../host/host.module.css';
import {
  IncidentalAcceptForm,
  IncidentalCancelForm,
  IncidentalDisputeForm,
  IncidentalFeeForm,
} from './incidental-forms.tsx';
import styles from './incidental.module.css';

export async function IncidentalScreen({
  role,
  tripId,
  org,
  done,
}: {
  readonly role: IncidentalRole;
  readonly tripId: string;
  readonly org: string | null;
  readonly done: Done | null;
}) {
  const [i18n, localeTag, brand] = await Promise.all([
    getRequestI18n(),
    getRequestLocaleTag(),
    getRequestBrand(),
  ]);
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
  const title: MessageKey =
    role === 'HOST' ? 'web.incidental.title.HOST' : 'web.incidental.title.GUEST';
  const shell = (body: ReactNode) => (
    <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']}>
      <header className={accountStyles['stackTight']}>
        <a className={hostStyles['link']} href={back}>
          {t('web.incidental.back')}
        </a>
        <h1 className={accountStyles['h1']} data-testid="incidental-title">
          {t(title)}
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
    <EmptyState icon="car" headingLevel={2} title={t('common.incidental.notFound')} />,
  );
  if (!UUID.test(tripId)) return notFound;
  const reply = await callApi('GET', `/trips/${tripId}/incidental-fees`, ctx);
  if (reply.status === 404 || reply.status === 401) return notFound;
  const view = tripIncidentalOf(reply);
  if (view === null || view.viewerRole !== role) {
    return shell(
      <ErrorState
        i18n={i18n}
        message={
          reply.status === 'unavailable' || reply.status === 503
            ? t('common.incidental.unavailable')
            : t('web.incidental.loadError')
        }
        action={
          <ButtonLink href={incidentalHref(role, tripId, org)}>
            {t('web.incidental.retry')}
          </ButtonLink>
        }
      />,
    );
  }
  const date = (iso: string) => i18n.dateTime(iso, view.timezone);
  const money = (minor: string) =>
    i18n.money({
      amountMinor: BigInt(minor),
      currency: view.currency,
      exponent: view.currencyExponent,
    });
  const number = getProfile(LOCALE_CONFIG, localeTag).number;
  const values = { brand: brand.name };

  const invoice = (inv: IncidentalInvoice) => (
    <li
      key={inv.id}
      className={`${hostStyles['card']} ${styles['invoice']}`}
      data-testid="incidental-invoice"
    >
      <div className={hostStyles['between']}>
        <h2 className={accountStyles['h2']}>{t(FEE_KEYS[inv.feeType])}</h2>
        <span className={styles['amount']} data-testid="incidental-amount-shown">
          {money(inv.amountMinor)}
        </span>
      </div>
      <p className={accountStyles['muted']}>{t('web.incidental.reason')}</p>
      <p className={styles['quote']}>{inv.description}</p>
      <p className={accountStyles['muted']}>
        {t('web.incidental.evidenceCount', { count: String(inv.evidenceCount) })}
      </p>
      {/* état : texte long, bandeau qui passe à la ligne à 360 px */}
      <Banner tone={STATUS_TONE[inv.status]} live="off">
        <span data-testid="incidental-status">
          {t(STATUS_KEYS[inv.status], { ...values, date: date(inv.responseDueAt) })}
        </span>
      </Banner>
      {inv.chargeStatus !== null && (
        <Badge
          tone={
            inv.chargeStatus === 'UNPAID'
              ? 'danger'
              : inv.chargeStatus === 'PAID'
                ? 'success'
                : 'neutral'
          }
        >
          {t(CHARGE_KEYS[inv.chargeStatus])}
        </Badge>
      )}
      {inv.disputeReason !== null && (
        <>
          <p className={accountStyles['muted']}>{t('web.incidental.disputeReason')}</p>
          <p className={styles['quote']} data-testid="incidental-dispute-reason">
            {inv.disputeReason}
          </p>
        </>
      )}
      {inv.decisionRationale !== null && (
        <>
          <p className={accountStyles['muted']}>{t('web.incidental.decision', values)}</p>
          <p className={styles['quote']}>{inv.decisionRationale}</p>
        </>
      )}
      {role === 'GUEST' && inv.windowOpen && (
        <>
          <IncidentalAcceptForm
            localeTag={localeTag}
            tripId={view.tripId}
            invoiceId={inv.id}
            amount={money(inv.amountMinor)}
          />
          <IncidentalDisputeForm
            localeTag={localeTag}
            tripId={view.tripId}
            invoiceId={inv.id}
            photos={view.photos}
          />
        </>
      )}
      {role === 'HOST' && (inv.status === 'AWAITING_GUEST' || inv.status === 'DISPUTED') && (
        <IncidentalCancelForm
          localeTag={localeTag}
          tripId={view.tripId}
          invoiceId={inv.id}
          org={org}
        />
      )}
    </li>
  );

  const list =
    view.invoices.length === 0 ? (
      <p className={accountStyles['muted']} data-testid="incidental-empty">
        {t(role === 'HOST' ? 'web.incidental.empty.HOST' : 'web.incidental.empty.GUEST')}
      </p>
    ) : (
      <section className={hostStyles['section']} aria-labelledby="incidental-list">
        <h2 id="incidental-list" className={accountStyles['h2']}>
          {t('web.incidental.list')}
        </h2>
        <ul className={styles['invoices']}>{view.invoices.map(invoice)}</ul>
      </section>
    );

  const doneBanner =
    done === null ? null : (
      <Banner tone="success" live="polite">
        <span data-testid="incidental-done">{t(DONE_KEYS[done], values)}</span>
      </Banner>
    );

  if (role === 'GUEST') {
    return shell(
      <>
        {doneBanner}
        <p className={accountStyles['text']}>{t('web.incidental.lead.GUEST', values)}</p>
        {list}
      </>,
    );
  }
  const intro =
    view.endedAt === null ? (
      <Banner tone="info" live="off">
        {t('web.incidental.notEnded.HOST')}
      </Banner>
    ) : view.canSubmit && view.hostDeadlineAt !== null ? (
      <p className={accountStyles['text']} data-testid="incidental-deadline">
        {t('web.incidental.lead.HOST', { date: date(view.hostDeadlineAt) })}
      </p>
    ) : (
      <Banner tone="info" live="off">
        {t('web.incidental.closed.HOST', {
          date: view.hostDeadlineAt === null ? '' : date(view.hostDeadlineAt),
        })}
      </Banner>
    );
  return shell(
    <>
      {doneBanner}
      {intro}
      {view.canSubmit && (
        <section className={hostStyles['section']} aria-labelledby="incidental-add">
          <h2 id="incidental-add" className={accountStyles['h2']}>
            {t('web.a04.addFee')}
          </h2>
          {view.photos.length === 0 ? (
            <Banner tone="warning" live="off">
              {t('web.incidental.form.noPhotos')}
            </Banner>
          ) : (
            <IncidentalFeeForm
              localeTag={localeTag}
              tripId={view.tripId}
              org={org}
              requestId={randomUUID()}
              currency={view.currency}
              exponent={view.currencyExponent}
              example={priceExample(view.currencyExponent, number)}
              feeTypes={view.feeTypes}
              photos={view.photos}
            />
          )}
        </section>
      )}
      {list}
    </>,
  );
}
