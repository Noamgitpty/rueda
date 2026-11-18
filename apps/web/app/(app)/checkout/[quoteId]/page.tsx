import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { Banner, ButtonLink, EmptyState, ErrorState, Price, PriceBreakdown } from '@rueda/ui';
import type { MessageKey, Translator } from '@rueda/i18n';
import type { PriceLine } from '@rueda/ui';
import { callApi, codeOf } from '../../../../account/api-client.ts';
import {
  CHECKOUT_DOCUMENT_KINDS,
  checkoutDocumentHref,
  checkoutQuoteOf,
  isUuid,
} from '../../../../account/checkout.ts';
import type { CheckoutQuoteView } from '../../../../account/checkout.ts';
import { publicListingOf } from '../../../../account/host-listings.ts';
import { getRequestBrand } from '../../../../brand-source.ts';
import type { PublicListingView } from '../../../../account/host-listings.ts';
import { clientContext } from '../../../../account/request.ts';
import { getRequestI18n, getRequestLocaleTag } from '../../../../i18n.ts';
import accountStyles from '../../_account/account.module.css';
import { MAIN_ID } from '../../_shell/main-id.ts';
import styles from '../../host/host.module.css';
import { cancellationText } from '../../listings/[listingId]/listing-terms.tsx';
import { CheckoutForm, RenewForm } from './checkout-form.tsx';
import { ProtectionForm } from './protection-form.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.s05.title'), robots: { index: false, follow: false } };
}

/** Nom d'un niveau de protection (ligne du devis et choix de S05, US-226 ; 10b S05). */
function protectionLabel(
  level: string | null,
):
  | 'common.quote.line.protectionBasica'
  | 'common.quote.line.protectionEstandar'
  | 'common.quote.line.protectionTotal'
  | 'common.quote.line.protection' {
  if (level === 'BASICA') return 'common.quote.line.protectionBasica';
  if (level === 'ESTANDAR') return 'common.quote.line.protectionEstandar';
  if (level === 'TOTAL') return 'common.quote.line.protectionTotal';
  return 'common.quote.line.protection';
}

/** Lignes du détail du prix (10b UX-17) : montants du devis rejoué, taxes réunies, aucun calcul du total. */
function priceLines(i18n: Translator, quote: CheckoutQuoteView, exponent: number): PriceLine[] {
  const t = i18n.t.bind(i18n);
  const amount = (amountMinor: bigint) => ({ amountMinor, currency: quote.currency, exponent });
  const lines: PriceLine[] = quote.lines.map((l) => {
    if (l.type === 'TRIP_PRICE') {
      return {
        id: l.type,
        label: t('web.s05.line.tripPrice', { count: quote.billableDays }),
        amount: amount(l.amountMinor),
      };
    }
    // US-226 : protection du voyageur, nommée par son niveau (nom générique si inconnu)
    if (l.type === 'PROTECTION') {
      return {
        id: l.type,
        label: t(protectionLabel(quote.protectionLevel)),
        amount: amount(l.amountMinor),
      };
    }
    return {
      id: l.type,
      label: t('common.quote.line.tripFee'),
      hint: t('common.quote.line.tripFeeHint'),
      amount: amount(l.amountMinor),
    };
  });
  const taxes = quote.lines.reduce((a, l) => a + l.taxMinor, 0n);
  if (taxes > 0n)
    lines.push({ id: 'TAXES', label: t('web.s05.line.taxes'), amount: amount(taxes) });
  return lines;
}

/** Montant formaté dont la devise et le nombre restent sur la même ligne. */
const unbroken = (text: string): string => text.replace(/ /g, '\u00a0');

function Shell({ children }: { readonly children: ReactNode }) {
  return (
    <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']}>
      {children}
    </main>
  );
}

/**
 * Récapitulatif du trip (10b S05) : voiture, hôte, dates aux heures du lieu, zone approximative ;
 * mention d'intermédiaire entre particuliers et hôte en prénom et initiale (19 US-212 critère 3,
 * BOARD N-346 ; nom lu de l'API, jamais le nom complet ; absent : la mention ne nomme personne).
 */
function Summary({
  i18n,
  quote,
  listing,
  timeZone,
  brand,
}: {
  readonly i18n: Translator;
  readonly quote: CheckoutQuoteView;
  readonly listing: PublicListingView;
  readonly timeZone: string;
  readonly brand: string;
}) {
  const t = i18n.t.bind(i18n);
  return (
    <section className={styles['section']} aria-labelledby="s05-summary">
      <h2 id="s05-summary" className={accountStyles['h2']}>
        {t('web.s05.summary.title')}
      </h2>
      <p className={styles['strong']}>
        {`${listing.makeName} ${listing.modelName} ${listing.year}`}
      </p>
      {quote.hostName !== null && (
        <p className={accountStyles['text']}>
          {t('web.s05.summary.host', { host_name: quote.hostName })}
        </p>
      )}
      <dl className={accountStyles['stackTight']}>
        <div>
          <dt className={accountStyles['muted']}>{t('web.s05.summary.pickup')}</dt>
          <dd className={accountStyles['text']}>{i18n.dateTime(quote.startAt, timeZone)}</dd>
        </div>
        <div>
          <dt className={accountStyles['muted']}>{t('web.s05.summary.return')}</dt>
          <dd className={accountStyles['text']}>{i18n.dateTime(quote.endAt, timeZone)}</dd>
        </div>
        <div>
          <dt className={accountStyles['muted']}>{t('web.s05.summary.place')}</dt>
          <dd className={accountStyles['text']}>
            {listing.areaLabel === null ? listing.city : `${listing.areaLabel}, ${listing.city}`}
          </dd>
        </div>
      </dl>
      <p className={accountStyles['muted']}>{t('web.listing.meet.approx')}</p>
      <p className={accountStyles['muted']} data-testid="s05-intermediary">
        {quote.hostName === null
          ? t('web.s05.intermediaryNoHost', { brand })
          : t('web.s05.intermediary', { brand, host_name: quote.hostName })}
      </p>
    </section>
  );
}

/**
 * Phrase de la retenue hors fenêtre (10b UX-54 ; revue ux de 205b n° 3 et 4) : « Después… » à la
 * suite de la date d'annulation gratuite, « Si cancelas… » sans date ; taxes comprises.
 */
function retainedKey(
  days: 'ONE' | 'HALF',
  afterDate: boolean,
):
  | 'web.s05.cancel.retainedDay'
  | 'web.s05.cancel.retainedHalfDay'
  | 'web.s05.cancel.ifCancelDay'
  | 'web.s05.cancel.ifCancelHalfDay' {
  if (afterDate) {
    return days === 'ONE' ? 'web.s05.cancel.retainedDay' : 'web.s05.cancel.retainedHalfDay';
  }
  return days === 'ONE' ? 'web.s05.cancel.ifCancelDay' : 'web.s05.cancel.ifCancelHalfDay';
}

/**
 * Conditions du voyage (US-205b ; 19 US-205 critères 1 et 2 ; 08 BR-CXL-01, BR-CXL-06 ; 10b UX-54) :
 * annulation gratuite en dates si la réservation a lieu maintenant (base, heure du lieu), retenue
 * hors fenêtre en jours de location et en montant (moteur de règlement sur le devis figé, jamais
 * calculée ici), distance FIGÉE dans le devis (km inclus sur la période, prix du km). Une donnée
 * absente n'est jamais devinée : renvoi à la politique publiée.
 */
function TermsSection({
  i18n,
  quote,
  timeZone,
  exponent,
}: {
  readonly i18n: Translator;
  readonly quote: CheckoutQuoteView;
  readonly timeZone: string;
  readonly exponent: number;
}) {
  const t = i18n.t.bind(i18n);
  const money = (amountMinor: bigint) =>
    unbroken(i18n.money({ amountMinor, currency: quote.currency, exponent }));
  const late = quote.lateCancellation;
  const m = quote.mileage;
  return (
    <section className={styles['section']} aria-labelledby="s05-terms" data-testid="s05-terms">
      <h2 id="s05-terms" className={accountStyles['h2']}>
        {t('web.s05.conditions.title')}
      </h2>
      <div data-testid="s05-cancel">
        {quote.cancellation === null ? (
          <p className={accountStyles['muted']}>{t('web.listing.cancel.unavailable')}</p>
        ) : (
          <>
            <p className={accountStyles['text']}>
              <span className={styles['strong']}>
                {cancellationText(i18n, quote.cancellation, timeZone)}
              </span>
            </p>
            {/* revue ux de 205b n° 4 : la note suit la date qu'elle explique */}
            <p className={accountStyles['muted']}>{t('web.s05.conditions.ifNow')}</p>
          </>
        )}
        <p className={accountStyles['text']} data-testid="s05-retained">
          {late === null
            ? t('web.listing.cancel.after')
            : t(retainedKey(late.penaltyDays, quote.cancellation !== null), {
                amount: money(late.retainedMinor),
              })}{' '}
          <a className={styles['link']} href="/legal/CANCELLATION_POLICY">
            {t('web.listing.cancel.policyLink')}
          </a>
        </p>
      </div>
      {m !== null && (
        <div data-testid="s05-distance">
          <h3 className={accountStyles['text']}>
            <span className={styles['strong']}>{t('web.listing.distance.title')}</span>
          </h3>
          {m.mode === 'UNLIMITED' ? (
            <p className={accountStyles['text']}>{t('web.host.listing.unlimited')}</p>
          ) : (
            <>
              <p className={accountStyles['text']}>
                {t('web.listing.distance.total', { count: m.includedKm })}
              </p>
              <p className={accountStyles['text']}>
                {t('web.listing.distance.extra', { amount: money(m.extraKmPriceMinor) })}
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * S05 — checkout en une page (US-208, partie 208b ; 10b §4.1 S05 ; 16 BKG-001 / BKG-006,
 * BKG-002 / BKG-025, BKG-008 / BKG-023 ; ADR-133, ADR-134) :
 *
 * - récapitulatif du trip et détail du prix du devis FIGÉ rejoué par la base (lignes, taxes,
 *   total ; 19 US-208 critère 1 : la somme des lignes égale le total, jamais recalculé ici) ;
 *   validité du prix (heure du lieu) ; prix expiré ⇒ nouveau devis à la demande, puis S05 du
 *   nouveau devis avec son total (`?renewed=1`) ;
 * - conducteur : le titulaire du compte, nom saisi tel que sur le compte (BKG-002 ; conducteur
 *   additionnel par l'ops en bêta) ; case « Sé manejar caja manual » pour une boîte manuelle
 *   (BKG-025) ;
 * - une case par document à accepter (CGU, politique d'annulation, zones de circulation ; BKG-008,
 *   BKG-023), chacune avec le lien vers la VERSION EXACTE affichée ; un document non publié ⇒
 *   aucune réservation possible (fail-closed) ;
 * - bouton de pose du hold inactif (`aria-disabled`) tant qu'un champ manque, occupé pendant
 *   l'envoi ; aucun paiement (US-223).
 *
 * - protection du voyageur (US-226 partie 226b, ADR-137) : âge déclaré, niveaux vendus avec leur
 *   prix par jour et pour la période (API), niveau du devis présélectionné, niveau refusé grisé
 *   avec sa raison ; le choix validé fige un NOUVEAU devis (`?protection=1`, nouveau total) ;
 *   `insurerContractActive` faux ⇒ aucune réservation, retour à la recherche (16 PRT-001).
 *
 * - conditions du voyage (US-205b, `TermsSection`) entre le prix et la confirmation : annulation
 *   gratuite en dates, retenue hors fenêtre (jours et montant), distance figée dans le devis.
 *
 * Caution, contrat hôte-voyageur et consentement MIT : US-701, US-211, US-223 (hors de cette
 * story). États : devis introuvable, erreur, chargement (`loading.tsx`) ; sans session : connexion.
 */
export default async function CheckoutPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly quoteId: string }>;
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const [i18n, localeTag, { quoteId }, query, brand] = await Promise.all([
    getRequestI18n(),
    getRequestLocaleTag(),
    params,
    searchParams,
    getRequestBrand(),
  ]);
  const t = i18n.t.bind(i18n);
  const ctx = await clientContext();
  if (ctx.sessionToken === null) redirect('/login');
  const notFound = (
    <Shell>
      <h1 className={accountStyles['h1']}>{t('web.s05.title')}</h1>
      <EmptyState
        icon="car"
        headingLevel={2}
        title={t('web.s05.notFound')}
        body={t('common.quote.notFound')}
        action={<ButtonLink href="/">{t('web.listing.search')}</ButtonLink>}
      />
    </Shell>
  );
  if (!isUuid(quoteId)) return notFound;
  const reply = await callApi('GET', `/checkout/quotes/${quoteId}`, ctx);
  if (reply.status === 401) redirect('/login');
  if (codeOf(reply) === 'TERMS_REACCEPT_REQUIRED') redirect('/terms/update');
  if (reply.status === 404) return notFound;
  const quote = checkoutQuoteOf(reply);
  const listingReply =
    quote === null
      ? null
      : await callApi('GET', `/listings/${quote.listingId}`, { ...ctx, sessionToken: null });
  const listing = listingReply === null ? null : publicListingOf(listingReply);
  const error = (key: MessageKey) => (
    <Shell>
      <h1 className={accountStyles['h1']}>{t('web.s05.title')}</h1>
      <ErrorState
        i18n={i18n}
        message={t(key)}
        action={<ButtonLink href={`/checkout/${quoteId}`}>{t('web.host.retry')}</ButtonLink>}
      />
    </Shell>
  );
  if (quote === null) return error('web.s05.error');
  // annonce retirée depuis le devis, autre devise ou fuseau inconnu : jamais un récapitulatif faux
  if (listing === null) {
    return error(
      listingReply?.status === 404 ? 'common.checkout.listingUnavailable' : 'web.s05.error',
    );
  }
  if (listing.currency !== quote.currency || listing.timezone === null) {
    return error('web.s05.error');
  }
  const timeZone = listing.timezone;
  const exponent = listing.currencyExponent;
  const total = { amountMinor: quote.totalMinor, currency: quote.currency, exponent };
  const complete = quote.documents.length === CHECKOUT_DOCUMENT_KINDS.length;
  return (
    <Shell>
      <header className={accountStyles['stackTight']}>
        <h1 className={accountStyles['h1']}>{t('web.s05.title')}</h1>
        <p className={accountStyles['muted']}>{t('web.s05.intro')}</p>
      </header>
      {query['renewed'] === '1' && !quote.expired && (
        <Banner tone="warning" live="polite" title={t('web.s05.priceChanged')}>
          {t('common.quote.expired')}
        </Banner>
      )}
      {query['protection'] === '1' && !quote.expired && (
        <Banner tone="success" live="polite" icon="check">
          {t('web.s05.protection.updated')}
        </Banner>
      )}
      {query['terms'] === 'changed' && (
        <Banner tone="warning" live="polite">
          {t('common.legal.versionChanged')}
        </Banner>
      )}

      <Summary i18n={i18n} quote={quote} listing={listing} timeZone={timeZone} brand={brand.name} />

      {/* US-226b : choix de la protection au-dessus du total et du bouton (10b S05) */}
      {!quote.expired && quote.insurerContractActive && quote.protectionOptions.length > 0 && (
        <ProtectionForm
          key={quote.quoteId}
          localeTag={localeTag}
          quoteId={quote.quoteId}
          driverAge={quote.driverAge}
          options={quote.protectionOptions.map((o) => ({
            level: o.level,
            label: t(protectionLabel(o.level)),
            // devise et montant jamais séparés en fin de ligne (insécable)
            price: t('web.s05.protection.price', {
              daily: unbroken(
                i18n.money({ amountMinor: o.dailyMinor, currency: quote.currency, exponent }),
              ),
              total: unbroken(
                i18n.money({ amountMinor: o.lineMinor, currency: quote.currency, exponent }),
              ),
            }),
            minDriverAge: o.minDriverAge,
            selected: o.selected,
            eligible: o.eligible,
          }))}
        />
      )}

      <section className={styles['section']} aria-labelledby="s05-price" data-testid="s05-price">
        <h2 id="s05-price" className={accountStyles['h2']}>
          {t('web.s05.price.title')}
        </h2>
        <Price i18n={i18n} size="lg" total={total} days={quote.billableDays} />
        <PriceBreakdown i18n={i18n} open lines={priceLines(i18n, quote, exponent)} total={total} />
        {/* prix sans suite possible (contrat de l'assureur fermé) : aucune validité promise */}
        {quote.expired || quote.expiresAt === null || !quote.insurerContractActive ? null : (
          <p className={accountStyles['muted']}>
            {t('web.s05.validUntil', { time: i18n.time(quote.expiresAt, timeZone) })}
          </p>
        )}
      </section>

      {/* US-205b : conditions lues avant de confirmer (10b S05, UX-54) ; prix sans suite
          possible (devis expiré, contrat de l'assureur fermé) : aucune condition promise */}
      {!quote.expired && quote.insurerContractActive && (
        <TermsSection i18n={i18n} quote={quote} timeZone={timeZone} exponent={exponent} />
      )}

      {quote.expired ? (
        <section className={styles['section']} aria-labelledby="s05-expired">
          <h2 id="s05-expired" className={accountStyles['h2']}>
            {t('web.s05.expired.title')}
          </h2>
          <p className={accountStyles['text']}>{t('web.s05.expired.body')}</p>
          <RenewForm localeTag={localeTag} quoteId={quote.quoteId} />
        </section>
      ) : !quote.insurerContractActive ? (
        // 16 PRT-001 : vente des protections fermée dans le pays ⇒ aucune réservation possible
        <section className={styles['section']} aria-labelledby="s05-closed">
          <h2 id="s05-closed" className={accountStyles['h2']}>
            {t('web.s05.protection.title')}
          </h2>
          <Banner tone="danger" live="polite">
            {t('common.quote.insurerContractInactive')}
          </Banner>
          <ButtonLink href="/">{t('web.listing.search')}</ButtonLink>
        </section>
      ) : !quote.instantBook ? (
        <Banner tone="info">{t('common.checkout.requestModeUnavailable')}</Banner>
      ) : !complete ? (
        // un document du checkout n'est pas publié : rien à accepter, aucune réservation
        <Banner tone="danger" live="polite">
          {t('common.legal.unavailable')}
        </Banner>
      ) : (
        <CheckoutForm
          // nouveau devis (prix redemandé) : formulaire neuf, cases à cocher de nouveau
          key={quote.quoteId}
          localeTag={localeTag}
          quoteId={quote.quoteId}
          manualRequired={quote.manualTransmission}
          amount={i18n.money(total)}
          documents={quote.documents.map((d) => ({
            kind: d.kind,
            version: d.version,
            title: d.title,
            href: checkoutDocumentHref(d, quote.country, quote.quoteId),
          }))}
        />
      )}
      <ButtonLink variant="quiet" href={`/listings/${quote.listingId}`}>
        {t('web.s05.back')}
      </ButtonLink>
    </Shell>
  );
}
