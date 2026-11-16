import type { Metadata } from 'next';
import {
  Badge,
  Banner,
  Button,
  ButtonLink,
  CarIllustration,
  EmptyState,
  ErrorState,
  HostCard,
  Icon,
  Price,
  Rating,
} from '@rueda/ui';
import type { MessageKey, Translator } from '@rueda/i18n';
import { callApi } from '../../../../account/api-client.ts';
import { slotPriceOf } from '../../../../account/checkout.ts';
import type { SlotPriceView } from '../../../../account/checkout.ts';
import { publicListingOf } from '../../../../account/host-listings.ts';
import { listingConditionsOf, slotTermsOf } from '../../../../account/listing-terms.ts';
import type { PublicListingView } from '../../../../account/host-listings.ts';
import {
  listingExtrasOf,
  meetingPointOf,
  ratingValue,
  slotApiPath,
  slotInputOf,
  slotViewOf,
} from '../../../../account/listing-page.ts';
import type { SlotInput, SlotView } from '../../../../account/listing-page.ts';
import {
  regulatoryNoticesOf,
  regulatoryNoticesPath,
  regulatoryNoticesUnavailable,
} from '../../../../account/regulatory-notices.ts';
import { clientContext } from '../../../../account/request.ts';
import { listingDatesOf, searchHref, TIME_SLOTS, wallClock } from '../../../../account/search.ts';
import { getRequestI18n, getRequestLocaleTag } from '../../../../i18n.ts';
import accountStyles from '../../_account/account.module.css';
import { RegulatoryNotices } from '../../_account/regulatory-notices.tsx';
import searchStyles from '../../_search/search.module.css';
import { MAIN_ID } from '../../_shell/main-id.ts';
import styles from '../../host/host.module.css';
import { BookForm } from './book-form.tsx';
import { ListingGallery } from './listing-gallery.tsx';
import { ListingTerms, protectionOffered } from './listing-terms.tsx';
import pageStyles from './listing.module.css';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.listing.meet.title'), robots: { index: false, follow: false } };
}

const TRANSMISSIONS = new Set(['MANUAL', 'AUTOMATIC']);
const FUELS = new Set(['GASOLINE', 'DIESEL', 'HYBRID', 'EV']);

/** Message de l'issue des dates choisies, déjà traduit. */
function slotMessage(t: Translator['t'], view: SlotView): string {
  if (view.kind === 'OK') return t('web.listing.slot.ok');
  if (view.kind === 'NOTICE') return t('common.listing.datesNoticeTooShort', { count: view.hours });
  if (view.kind === 'REFUSED') return t(view.key);
  return t('web.listing.slot.error');
}

/**
 * Sélecteur de dates de la fiche (16 LST-006) : formulaire GET vers la fiche elle-même (il marche
 * sans JavaScript, l'URL garde les dates), dates et heures du lieu au pas de 30 min.
 */
function SlotForm({
  i18n,
  listingId,
  input,
}: {
  readonly i18n: Translator;
  readonly listingId: string;
  readonly input: SlotInput | null;
}) {
  const t = i18n.t.bind(i18n);
  const id = (name: string): string => `s03-slot-${name}`;
  const [sd, st] = input === null ? ['', '10:00'] : input.start.split('T');
  const [ed, et] = input === null ? ['', '10:00'] : input.end.split('T');
  const timeLabel = (slot: string): string => i18n.time(wallClock(`2000-01-01T${slot}`), 'UTC');
  const pair = (prefix: 'start' | 'end', date: string | undefined, time: string | undefined) => (
    <div className={searchStyles['pair']}>
      <div className={searchStyles['field']}>
        <label className={searchStyles['sub']} htmlFor={id(`${prefix}Date`)}>
          {t('web.search.date')}
        </label>
        <input
          id={id(`${prefix}Date`)}
          name={`${prefix}Date`}
          type="date"
          className={searchStyles['control']}
          defaultValue={date}
          required
        />
      </div>
      <div className={searchStyles['field']}>
        <label className={searchStyles['sub']} htmlFor={id(`${prefix}Time`)}>
          {t('web.search.time')}
        </label>
        <select
          id={id(`${prefix}Time`)}
          name={`${prefix}Time`}
          className={searchStyles['control']}
          defaultValue={time}
          required
        >
          {TIME_SLOTS.map((slot) => (
            <option key={slot} value={slot}>
              {timeLabel(slot)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
  return (
    <form
      className={searchStyles['form']}
      action={`/listings/${listingId}`}
      method="get"
      aria-labelledby={id('title')}
      aria-describedby={id('hint')}
    >
      <h3 id={id('title')} className={searchStyles['label']}>
        {t('web.listing.slot.title')}
      </h3>
      <fieldset className={searchStyles['group']}>
        <legend className={searchStyles['legend']}>{t('web.search.from')}</legend>
        {pair('start', sd, st)}
      </fieldset>
      <fieldset className={searchStyles['group']}>
        <legend className={searchStyles['legend']}>{t('web.search.until')}</legend>
        {pair('end', ed, et)}
      </fieldset>
      <p id={id('hint')} className={searchStyles['hint']}>
        {t('web.search.localTime')}
      </p>
      <Button type="submit" block>
        {t('web.listing.slot.check')}
      </Button>
    </form>
  );
}

/** Dates de la fiche : période reprise ou choisie, issue du contrôle, sélecteur, retour à S02. */
function DatesSection({
  i18n,
  listing,
  fromSearch,
  input,
  view,
}: {
  readonly i18n: Translator;
  readonly listing: PublicListingView;
  readonly fromSearch: SlotInput | null;
  readonly input: SlotInput | null;
  readonly view: SlotView | null;
}) {
  const t = i18n.t.bind(i18n);
  return (
    <section className={styles['section']} aria-labelledby="s03-dates">
      <h2 id="s03-dates" className={accountStyles['h2']}>
        {t('web.listing.dates.title')}
      </h2>
      {input !== null && (
        <p className={accountStyles['text']}>
          {/* heures locales du lieu, rendues sans conversion (fuseau UTC de l'instant fictif) */}
          {t('web.search.result.period', {
            from: i18n.dateTime(wallClock(input.start), 'UTC'),
            to: i18n.dateTime(wallClock(input.end), 'UTC'),
          })}
        </p>
      )}
      {input !== null && listing.timezone !== null && (
        <p className={accountStyles['muted']}>
          {t('web.search.result.timezone', { city: listing.city })}
        </p>
      )}
      {view !== null &&
        (view.kind === 'OK' ? (
          <Banner tone="success" live="polite">
            {slotMessage(t, view)}
          </Banner>
        ) : (
          <p className={searchStyles['error']} role="alert" data-testid="slot-refusal">
            {slotMessage(t, view)}
          </p>
        ))}
      <SlotForm i18n={i18n} listingId={listing.id} input={input} />
      {fromSearch !== null && (
        <a
          className={styles['link']}
          href={searchHref({
            country: listing.country,
            city: listing.city,
            area: listing.areaLabel,
            ...fromSearch,
          })}
        >
          {t('web.listing.dates.change')}
        </a>
      )}
    </section>
  );
}

/**
 * Prix final et barre d'action (US-208 ; 10b S03 « prix final + détail », `web.s03.cta`) : total
 * TTC du devis PROVISOIRE rendu par l'API pour les dates contrôlées (même chiffre que la recherche,
 * jamais recalculé ici), puis « Reservar » qui fige le devis et ouvre S05. Aucun devis possible ⇒
 * aucun bouton ; annonce sur demande ⇒ pas encore réservable (N-128, US-223).
 */
function BookingSection({
  i18n,
  localeTag,
  listing,
  view,
  price,
  bookable,
}: {
  readonly i18n: Translator;
  readonly localeTag: string;
  readonly listing: PublicListingView;
  readonly view: Extract<SlotView, { kind: 'OK' }>;
  readonly price: SlotPriceView | null;
  /** Protection promise par la base (US-205 critère 4) ; sinon aucun bouton « Reservar ». */
  readonly bookable: boolean;
}) {
  const t = i18n.t.bind(i18n);
  // devise du devis différente de celle de l'annonce : jamais un total affiché (aucune conversion)
  const usable = price !== null && price.currency === listing.currency ? price : null;
  return (
    <section className={styles['section']} aria-labelledby="s03-price" data-testid="s03-price">
      <h2 id="s03-price" className={accountStyles['h2']}>
        {t('web.listing.total.title')}
      </h2>
      {usable === null ? (
        <p className={accountStyles['muted']}>{t('common.quote.unavailable')}</p>
      ) : (
        <>
          <Price
            i18n={i18n}
            size="lg"
            total={{
              amountMinor: usable.totalMinor,
              currency: usable.currency,
              exponent: listing.currencyExponent,
            }}
            days={usable.billableDays}
          />
          <p className={accountStyles['muted']}>{t('web.listing.total.hint')}</p>
          {!bookable ? (
            <Banner tone="info">{t('common.quote.insurerContractInactive')}</Banner>
          ) : listing.instantBook ? (
            <BookForm
              localeTag={localeTag}
              listingId={listing.id}
              startAt={view.startAt}
              endAt={view.endAt}
              label={t('web.s03.cta')}
            />
          ) : (
            <Banner tone="info">{t('common.checkout.requestModeUnavailable')}</Banner>
          )}
        </>
      )}
    </section>
  );
}

/**
 * S03 — fiche publique d'une annonce publiée (US-115 critère 4, US-201, US-204 ; 10b §4.1 S03,
 * UX-65, maquette US-033) :
 *
 * - galerie des photos de l'hôte dans SON ordre, photo indisponible remplacée par une vignette, le
 *   reste intact (16 LST-002 ; US-204 critère 1) ; sans photo : illustration ;
 * - en-tête (marque, modèle, année, note du véhicule ou « Nuevo », prix par jour, mode de
 *   réservation) et bloc de l'hôte (prénom et monogramme, note, trips, « identité vérifiée » ;
 *   16 LST-020 bêta SIMPLIFIÉ) ;
 * - dates : reprises de la recherche (`?start=&end=`) ou choisies sur la fiche, contrôlées par
 *   l'API (préavis du lieu ⇒ `DATES_NOTICE_TOO_SHORT`, créneau pris ⇒ `DATES_UNAVAILABLE` ;
 *   US-204 critère 2) ;
 * - prix final TTC des dates acceptées (devis provisoire de l'API, jamais recalculé par le site) et
 *   « Reservar » vers le checkout S05 (US-208), seulement si la base promet la protection de
 *   l'assureur partenaire (US-205 critère 4) ;
 * - conditions (US-205, `listing-terms.tsx`) : annulation gratuite en dates (heure du lieu) ou
 *   règle du pays, distance incluse sur la période, protection de l'assureur (RC, franchises,
 *   exclusions du contrat) ou aucune promesse, caution de la plateforme ;
 * - lieu de remise : zone approximative pour tous ; libellé et adresse exacte au SEUL voyageur
 *   d'un trip confirmé et non terminé (US-204 critère 3, L2-PM-29), jugé par la base.
 *
 * États : annonce introuvable ou non publiée (404), erreur (API injoignable), chargement
 * (`loading.tsx`) ; hors connexion : coquille et écran `/offline`.
 */
export default async function ListingPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly listingId: string }>;
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const [i18n, localeTag, { listingId }, query] = await Promise.all([
    getRequestI18n(),
    getRequestLocaleTag(),
    params,
    searchParams,
  ]);
  const fromSearch = listingDatesOf(query);
  const slot = slotInputOf(query);
  const t = i18n.t.bind(i18n);
  const ctx = await clientContext();
  const reply = /^[0-9a-f-]{36}$/.test(listingId)
    ? await callApi('GET', `/listings/${listingId}`, { ...ctx, sessionToken: null })
    : ({ status: 404, json: null, session: null } as const);
  const listing = publicListingOf(reply);
  const extras = listing === null ? null : listingExtrasOf(reply);
  if (listing === null || extras === null) {
    return (
      <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']}>
        {reply.status === 404 ? (
          <EmptyState
            icon="car"
            headingLevel={2}
            title={t('web.listing.notFound')}
            body={t('web.listing.notFound.body')}
            action={<ButtonLink href="/">{t('web.listing.search')}</ButtonLink>}
          />
        ) : (
          <ErrorState
            i18n={i18n}
            message={t('web.listing.error')}
            action={<ButtonLink href={`/listings/${listingId}`}>{t('web.host.retry')}</ButtonLink>}
          />
        )}
      </main>
    );
  }
  const title = `${listing.makeName} ${listing.modelName} ${listing.year}`;
  const [noticeReply, slotReply, meetingReply, conditionsReply] = await Promise.all([
    // US-125 : limite légale connue du pays de l'annonce, pour le voyageur
    callApi('GET', regulatoryNoticesPath(listing.country, 'GUEST'), { ...ctx, sessionToken: null }),
    slot !== null && slot.ok
      ? callApi('GET', slotApiPath(listing.id, slot.input), { ...ctx, sessionToken: null })
      : Promise.resolve(null),
    // lieu exact : demandé seulement avec une session (voyageur d'un trip confirmé, jugé en base)
    ctx.sessionToken !== null
      ? callApi('GET', `/listings/${listing.id}/meeting-point`, ctx)
      : Promise.resolve(null),
    // US-205 : annulation du pays, caution, protection de l'assureur partenaire (jugée en base)
    callApi('GET', `/listings/${listing.id}/conditions`, { ...ctx, sessionToken: null }),
  ]);
  const notices = regulatoryNoticesOf(noticeReply, listing.country, 'GUEST');
  const slotView: SlotView | null =
    slot === null
      ? null
      : slot.ok
        ? slotViewOf(slotReply ?? { status: 'unavailable' })
        : { kind: 'REFUSED', key: 'common.search.datesInvalid' };
  const meeting = meetingReply === null ? null : meetingPointOf(meetingReply);
  const price = slotView?.kind === 'OK' && slotReply !== null ? slotPriceOf(slotReply) : null;
  const slotTerms = slotView?.kind === 'OK' && slotReply !== null ? slotTermsOf(slotReply) : null;
  const conditions = listingConditionsOf(conditionsReply);
  const total = String(extras.photos.length);
  return (
    <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']}>
      {extras.photos.length === 0 ? (
        <div className={styles['media']}>
          <CarIllustration />
        </div>
      ) : (
        <ListingGallery
          headingId="s03-photos"
          headingClassName={accountStyles['h2']}
          title={t('web.listing.gallery.title')}
          brokenLabel={t('web.listing.gallery.broken')}
          slides={extras.photos.map((p, i) => ({
            id: p.id,
            src: p.src,
            alt: t('web.listing.gallery.photoAlt', { car: title, n: String(i + 1), total }),
            caption:
              listing.hostFirstName === null
                ? `${i + 1} / ${total}`
                : t('web.s03.photos', {
                    n: String(i + 1),
                    total,
                    host_name: listing.hostFirstName,
                  }),
          }))}
        />
      )}
      <header className={accountStyles['stackTight']}>
        <h1 className={accountStyles['h1']}>{title}</h1>
        <Rating
          i18n={i18n}
          value={ratingValue(extras.vehicleRating)}
          trips={extras.vehicleRating?.tripCount ?? 0}
        />
        <p className={styles['price']}>
          {t('web.listing.perDay', {
            amount: i18n.money({
              amountMinor: listing.dailyPriceMinor,
              currency: listing.currency,
              exponent: listing.currencyExponent,
            }),
          })}
        </p>
        <div>
          <Badge tone={listing.instantBook ? 'success' : 'neutral'}>
            {t(listing.instantBook ? 'web.listing.instant' : 'web.listing.request')}
          </Badge>
        </div>
      </header>

      <DatesSection
        i18n={i18n}
        listing={listing}
        fromSearch={fromSearch}
        input={slot !== null && slot.ok ? slot.input : null}
        view={slotView}
      />

      {slotView?.kind === 'OK' && (
        <BookingSection
          i18n={i18n}
          localeTag={localeTag}
          listing={listing}
          view={slotView}
          price={price}
          bookable={protectionOffered(conditions, listing)}
        />
      )}

      <ListingTerms
        i18n={i18n}
        localeTag={localeTag}
        listing={listing}
        conditions={conditions}
        slot={slotTerms}
      />

      <RegulatoryNotices
        i18n={i18n}
        notices={notices}
        headingId="s03-notices"
        unavailable={regulatoryNoticesUnavailable(noticeReply)}
      />

      <section className={styles['section']} aria-labelledby="s03-features">
        <h2 id="s03-features" className={accountStyles['h2']}>
          {t('web.listing.features')}
        </h2>
        <ul className={styles['list']}>
          <li>{t('web.listing.seats', { count: listing.seats })}</li>
          {TRANSMISSIONS.has(listing.transmission) && (
            <li>{t(`web.host.car.transmission.${listing.transmission}` as MessageKey)}</li>
          )}
          {FUELS.has(listing.fuelType) && (
            <li>{t(`web.host.car.fuel.${listing.fuelType}` as MessageKey)}</li>
          )}
          <li>
            {listing.mileageMode === 'INCLUDED' && listing.includedKmPerDay !== null
              ? t('web.host.listing.kmPerDay', { count: listing.includedKmPerDay })
              : t('web.host.listing.unlimited')}
          </li>
        </ul>
      </section>

      {/* bloc de l'hôte (10b UX-65, 16 LST-020 bêta) : prénom seulement, jamais le nom complet */}
      {listing.hostFirstName !== null && (
        <HostCard
          i18n={i18n}
          id="s03-host"
          name={listing.hostFirstName}
          rating={ratingValue(extras.hostRating)}
          trips={extras.hostRating?.tripCount ?? 0}
          verified={extras.hostVerified}
        />
      )}

      <section className={styles['section']} aria-labelledby="s03-meet">
        <h2 id="s03-meet" className={accountStyles['h2']}>
          {t('web.listing.meet.title')}
        </h2>
        {meeting === null ? (
          <>
            <p className={styles['between']}>
              <span className={styles['strong']}>
                <Icon name="pin" />{' '}
                {listing.areaLabel === null
                  ? listing.city
                  : `${listing.areaLabel}, ${listing.city}`}
              </span>
            </p>
            <p className={accountStyles['muted']}>{t('web.listing.meet.approx')}</p>
          </>
        ) : (
          <div className={accountStyles['stackTight']} data-testid="meeting-point">
            <h3 className={accountStyles['text']}>
              <span className={styles['strong']}>{t('web.listing.meet.exact.title')}</span>
            </h3>
            <address className={pageStyles['address']}>
              <span className={styles['strong']}>
                <Icon name="pin" /> {meeting.placeLabel}
              </span>
              <br />
              {meeting.addressLine}
              <br />
              {meeting.areaLabel === null ? meeting.city : `${meeting.areaLabel}, ${meeting.city}`}
            </address>
            <p className={accountStyles['text']}>{t('web.listing.meet.sameReturn')}</p>
            <p className={accountStyles['muted']}>{t('web.listing.meet.exact.only')}</p>
          </div>
        )}
      </section>
    </main>
  );
}
