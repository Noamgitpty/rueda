'use client';
/**
 * Formulaires de l'espace de l'hôte (A10, US-115) : actions serveur, sans JavaScript requis
 * (`useActionState` ajoute seulement l'état « en cours » et les erreurs sans rechargement). Chaque
 * champ a son libellé visible ; une erreur est liée à son champ et reprise dans le récapitulatif
 * (10b UX-50) ; les messages viennent du catalogue `@rueda/i18n` (es, en, fr, pt).
 */
import { useActionState } from 'react';
import type { ReactNode } from 'react';
import { createTranslator, getProfile } from '@rueda/i18n';
import type { Translator } from '@rueda/i18n';
import { Banner, Button, ErrorSummary, TextField } from '@rueda/ui';
import { LOCALE_CONFIG } from '../../../locale-config.ts';
import styles from './host.module.css';
import {
  addPhotoAction,
  createListingAction,
  createLocationAction,
  createVehicleAction,
  listingStepAction,
  savePriceAction,
} from './actions.ts';
import type { HostFormState } from './actions.ts';

const INITIAL: HostFormState = { errors: [] };
type Action = (prev: HostFormState, form: FormData) => Promise<HostFormState>;

function useForm(localeTag: string, action: Action, formId: string) {
  const i18n = createTranslator(getProfile(LOCALE_CONFIG, localeTag));
  const [state, run, pending] = useActionState(action, INITIAL);
  const messages = state.errors.map((e) => ({
    fieldId: e.fieldId,
    message: i18n.t(e.key, e.values),
  }));
  const formError = messages.find((m) => m.fieldId === formId)?.message;
  const errorOf = (id: string) => messages.find((m) => m.fieldId === id)?.message;
  const valueOf = (name: string): string | undefined => state.values?.[name];
  return { i18n, t: i18n.t.bind(i18n), run, pending, messages, formError, errorOf, valueOf };
}

function FormFrame({
  i18n,
  run,
  messages,
  formId,
  formError,
  children,
  label,
}: {
  readonly i18n: Translator;
  readonly run: (form: FormData) => void;
  readonly messages: { fieldId: string; message: string }[];
  readonly formId: string;
  readonly formError: string | undefined;
  readonly children: ReactNode;
  readonly label: string;
}) {
  return (
    <form id={formId} className={styles['actions']} action={run} noValidate aria-label={label}>
      <ErrorSummary i18n={i18n} errors={messages.filter((m) => m.fieldId !== formId)} />
      {formError !== undefined && (
        <Banner tone="danger" live="assertive">
          {formError}
        </Banner>
      )}
      {children}
    </form>
  );
}

function Radios({
  name,
  legend,
  options,
  defaultValue,
}: {
  readonly name: string;
  readonly legend: string;
  readonly options: readonly { value: string; label: string }[];
  readonly defaultValue: string;
}) {
  return (
    <fieldset className={styles['choices']}>
      <legend className={styles['legend']}>{legend}</legend>
      {options.map((o) => (
        <label key={o.value} className={styles['choice']}>
          <input
            type="radio"
            name={name}
            value={o.value}
            defaultChecked={o.value === defaultValue}
          />
          <span>{o.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

export function LocationForm({ localeTag, orgId }: { localeTag: string; orgId: string }) {
  const f = useForm(localeTag, createLocationAction, 'a10-place-form');
  const t = f.t;
  return (
    <FormFrame {...f} formId="a10-place-form" label={t('web.host.places.title')}>
      <input type="hidden" name="org" value={orgId} />
      <Radios
        name="kind"
        legend={t('web.host.place.kind')}
        defaultValue="POI"
        options={(['POI', 'HOME', 'AIRPORT'] as const).map((k) => ({
          value: k,
          label: t(`web.host.place.kind.${k}`),
        }))}
      />
      <TextField
        defaultValue={f.valueOf('label')}
        i18n={f.i18n}
        id="a10-place-label"
        name="label"
        label={t('web.host.place.label')}
        maxLength={80}
        error={f.errorOf('a10-place-label')}
      />
      <TextField
        defaultValue={f.valueOf('addressLine')}
        i18n={f.i18n}
        id="a10-place-address"
        name="addressLine"
        label={t('web.host.place.address')}
        autoComplete="street-address"
        maxLength={200}
        hint={t('web.host.place.privacy')}
        error={f.errorOf('a10-place-address')}
      />
      <TextField
        defaultValue={f.valueOf('city')}
        i18n={f.i18n}
        id="a10-place-city"
        name="city"
        label={t('web.host.place.city')}
        autoComplete="address-level2"
        maxLength={80}
        error={f.errorOf('a10-place-city')}
      />
      <TextField
        defaultValue={f.valueOf('areaLabel')}
        i18n={f.i18n}
        id="a10-place-area"
        name="areaLabel"
        label={t('web.host.place.area')}
        optional
        maxLength={80}
        error={f.errorOf('a10-place-area')}
      />
      <Button type="submit" block loading={f.pending}>
        {t('web.host.place.add')}
      </Button>
    </FormFrame>
  );
}

export function VehicleForm({
  localeTag,
  orgId,
  locations,
}: {
  localeTag: string;
  orgId: string;
  locations: readonly { id: string; label: string }[];
}) {
  const f = useForm(localeTag, createVehicleAction, 'a10-car-form');
  const t = f.t;
  return (
    <FormFrame {...f} formId="a10-car-form" label={t('web.host.cars.title')}>
      <input type="hidden" name="org" value={orgId} />
      <div className={styles['field']}>
        <label className={styles['strong']} htmlFor="a10-car-place">
          {t('web.host.car.place')}
        </label>
        <select id="a10-car-place" name="locationId" className={styles['select']}>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </div>
      <TextField
        defaultValue={f.valueOf('plate')}
        i18n={f.i18n}
        id="a10-car-plate"
        name="plate"
        label={t('web.host.car.plate')}
        autoCapitalize="characters"
        maxLength={24}
        error={f.errorOf('a10-car-plate')}
      />
      <TextField
        defaultValue={f.valueOf('vin')}
        i18n={f.i18n}
        id="a10-car-vin"
        name="vin"
        label={t('web.host.car.vin')}
        optional
        autoCapitalize="characters"
        maxLength={40}
        error={f.errorOf('a10-car-vin')}
      />
      <TextField
        defaultValue={f.valueOf('makeText')}
        i18n={f.i18n}
        id="a10-car-make"
        name="makeText"
        label={t('web.host.car.make')}
        maxLength={80}
        error={f.errorOf('a10-car-make')}
      />
      <TextField
        defaultValue={f.valueOf('modelText')}
        i18n={f.i18n}
        id="a10-car-model"
        name="modelText"
        label={t('web.host.car.model')}
        maxLength={80}
        error={f.errorOf('a10-car-model')}
      />
      <TextField
        defaultValue={f.valueOf('year')}
        i18n={f.i18n}
        id="a10-car-year"
        name="year"
        label={t('web.host.car.year')}
        inputMode="numeric"
        maxLength={4}
        error={f.errorOf('a10-car-year')}
      />
      <TextField
        i18n={f.i18n}
        id="a10-car-seats"
        name="seats"
        label={t('web.host.car.seats')}
        inputMode="numeric"
        maxLength={2}
        defaultValue={f.valueOf('seats') ?? '5'}
        error={f.errorOf('a10-car-seats')}
      />
      <Radios
        name="transmission"
        legend={t('web.host.car.transmission')}
        defaultValue="AUTOMATIC"
        options={(['AUTOMATIC', 'MANUAL'] as const).map((k) => ({
          value: k,
          label: t(`web.host.car.transmission.${k}`),
        }))}
      />
      <Radios
        name="fuelType"
        legend={t('web.host.car.fuel')}
        defaultValue="GASOLINE"
        options={(['GASOLINE', 'DIESEL', 'HYBRID', 'EV'] as const).map((k) => ({
          value: k,
          label: t(`web.host.car.fuel.${k}`),
        }))}
      />
      <Button type="submit" block loading={f.pending}>
        {t('web.host.car.add')}
      </Button>
    </FormFrame>
  );
}

function PricingFields({
  f,
  prefix,
  currency,
  defaults,
}: {
  f: ReturnType<typeof useForm>;
  prefix: string;
  currency: string;
  defaults?: { price: string; km: string };
}) {
  const t = f.t;
  return (
    <>
      <TextField
        i18n={f.i18n}
        id={`${prefix}-price`}
        name="price"
        label={t('web.host.listing.price', { currency })}
        inputMode="decimal"
        maxLength={32}
        defaultValue={f.valueOf('price') ?? defaults?.price}
        error={f.errorOf(`${prefix}-price`)}
      />
      <TextField
        i18n={f.i18n}
        id={`${prefix}-km`}
        name="km"
        label={t('web.host.listing.km')}
        optional
        inputMode="numeric"
        maxLength={5}
        defaultValue={f.valueOf('km') ?? defaults?.km}
        error={f.errorOf(`${prefix}-km`)}
      />
      <TextField
        defaultValue={f.valueOf('extraKm')}
        i18n={f.i18n}
        id={`${prefix}-extra`}
        name="extraKm"
        label={t('web.host.listing.extraKm', { currency })}
        optional
        inputMode="decimal"
        maxLength={32}
      />
    </>
  );
}

export function NewListingForm({
  localeTag,
  orgId,
  vehicles,
  currency,
  exponent,
}: {
  localeTag: string;
  orgId: string;
  vehicles: readonly { id: string; label: string }[];
  currency: string;
  exponent: number;
}) {
  const f = useForm(localeTag, createListingAction, 'a10-new');
  const t = f.t;
  return (
    <FormFrame {...f} formId="a10-new" label={t('web.host.listing.create')}>
      <input type="hidden" name="org" value={orgId} />
      <input type="hidden" name="exponent" value={exponent} />
      <div className={styles['field']}>
        <label className={styles['strong']} htmlFor="a10-new-car">
          {t('web.host.listing.car')}
        </label>
        <select id="a10-new-car" name="vehicleId" className={styles['select']}>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </div>
      <PricingFields f={f} prefix="a10-new" currency={currency} />
      <Button type="submit" block loading={f.pending}>
        {t('web.host.listing.create')}
      </Button>
    </FormFrame>
  );
}

export function ListingForms({
  localeTag,
  orgId,
  listingId,
  currency,
  exponent,
  editable,
  defaults,
}: {
  localeTag: string;
  orgId: string;
  listingId: string;
  currency: string;
  exponent: number;
  editable: boolean;
  defaults: { price: string; km: string };
}) {
  const price = useForm(localeTag, savePriceAction, `a10-${listingId}`);
  const photo = useForm(localeTag, addPhotoAction, `a10-${listingId}-photo`);
  const submit = useForm(localeTag, listingStepAction, `a10-${listingId}-submit`);
  const remove = useForm(localeTag, listingStepAction, `a10-${listingId}-delete`);
  const t = price.t;
  return (
    <div className={styles['actions']}>
      <FormFrame {...price} formId={`a10-${listingId}`} label={t('web.host.listing.savePrice')}>
        <input type="hidden" name="org" value={orgId} />
        <input type="hidden" name="listing" value={listingId} />
        <input type="hidden" name="exponent" value={exponent} />
        <PricingFields
          f={price}
          prefix={`a10-${listingId}`}
          currency={currency}
          defaults={defaults}
        />
        <Button type="submit" variant="secondary" block loading={price.pending}>
          {t('web.host.listing.savePrice')}
        </Button>
      </FormFrame>
      {editable && (
        <>
          <FormFrame
            {...photo}
            formId={`a10-${listingId}-photo`}
            label={t('web.host.listing.addPhoto')}
          >
            <input type="hidden" name="org" value={orgId} />
            <input type="hidden" name="listing" value={listingId} />
            <div className={styles['field']}>
              <label className={styles['strong']} htmlFor={`a10-${listingId}-file`}>
                {t('web.host.listing.photo')}
              </label>
              <input
                id={`a10-${listingId}-file`}
                className={styles['file']}
                type="file"
                name="photo"
                accept="image/jpeg,image/png,image/webp"
              />
            </div>
            <Button type="submit" variant="secondary" block loading={photo.pending}>
              {t('web.host.listing.addPhoto')}
            </Button>
          </FormFrame>
          <FormFrame
            {...submit}
            formId={`a10-${listingId}-submit`}
            label={t('web.host.listing.submit')}
          >
            <input type="hidden" name="org" value={orgId} />
            <input type="hidden" name="listing" value={listingId} />
            <input type="hidden" name="step" value="submit" />
            <Button type="submit" block loading={submit.pending}>
              {t('web.host.listing.submit')}
            </Button>
          </FormFrame>
          <FormFrame
            {...remove}
            formId={`a10-${listingId}-delete`}
            label={t('web.host.listing.delete')}
          >
            <input type="hidden" name="org" value={orgId} />
            <input type="hidden" name="listing" value={listingId} />
            <input type="hidden" name="step" value="delete" />
            <Button type="submit" variant="quiet" block loading={remove.pending}>
              {t('web.host.listing.delete')}
            </Button>
          </FormFrame>
        </>
      )}
    </div>
  );
}
