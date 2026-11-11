'use server';
/**
 * Actions serveur de l'espace de l'hôte (A10, US-115) : lieu de remise, véhicule, annonce, prix,
 * photo, soumission et suppression. Le site appelle l'API CÔTÉ SERVEUR (`account/api-client.ts`) ;
 * le compte d'hôte et l'annonce viennent de champs cachés que l'API revérifie toujours (un compte
 * ou un objet d'un autre hôte : 404). Formulaires sans JavaScript ; succès : retour à l'écran
 * avec « Guardado ». Jamais de donnée personnelle dans une URL ni dans un journal.
 */
import { redirect } from 'next/navigation';
import { getProfile } from '@rueda/i18n';
import type { MessageKey } from '@rueda/i18n';
import { callApi } from '../../../account/api-client.ts';
import type { ApiResult } from '../../../account/api-client.ts';
import { fieldsOf, messageKeyOf, minorFromInput } from '../../../account/host-listings.ts';
import { clientContext } from '../../../account/request.ts';
import { getRequestLocaleTag } from '../../../i18n.ts';
import { LOCALE_CONFIG } from '../../../locale-config.ts';
import type { FormErrors } from '../_account/errors.ts';

export interface HostFormState {
  readonly errors: FormErrors;
  /** Saisie renvoyée après un refus : React réinitialise le formulaire, rien n'est perdu (UX-10). */
  readonly values?: Readonly<Record<string, string>>;
}

const HIDDEN = new Set(['org', 'listing', 'exponent', 'step', 'photo']);

/** Champs texte saisis (jamais les champs cachés ni le fichier), bornés. */
function keep(form: FormData, state: HostFormState): HostFormState {
  const values: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    if (typeof v === 'string' && !HIDDEN.has(k) && !k.startsWith('$')) values[k] = v.slice(0, 200);
  }
  return { ...state, values };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const text = (form: FormData, name: string, max = 200): string => {
  const v = form.get(name);
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
};
const opt = (form: FormData, name: string, max = 200): string | null =>
  text(form, name, max) || null;
const idOf = (form: FormData, name: string): string | null => {
  const v = text(form, name, 36);
  return UUID.test(v) ? v : null;
};

/** Erreur d'une réponse de l'API : champs refusés liés au formulaire, sinon message du code. */
function errorsOf(reply: ApiResult, formId: string, fieldIds: Record<string, string>): FormErrors {
  const fields = fieldsOf(reply);
  if (fields.length > 0) {
    return fields.map((f) => ({
      fieldId: fieldIds[f.field] ?? formId,
      key: (f.reason === 'REQUIRED'
        ? 'common.listing.field.required'
        : 'common.listing.field.invalid') as MessageKey,
    }));
  }
  if (reply.status === 'unavailable' || reply.status === 413) {
    return [
      {
        fieldId: formId,
        key: formId.endsWith('photo')
          ? 'common.listing.photoUnavailable'
          : 'common.listing.unavailable',
      },
    ];
  }
  return [{ fieldId: formId, key: messageKeyOf(reply) ?? 'common.error.server' }];
}

function done(orgId: string): never {
  redirect(`/host?org=${orgId}&saved=1`);
}

const invalid = (formId: string): HostFormState => ({
  errors: [{ fieldId: formId, key: 'common.listing.field.invalid' }],
});

async function createLocationImpl(_prev: HostFormState, form: FormData): Promise<HostFormState> {
  const orgId = idOf(form, 'org');
  if (orgId === null) return invalid('a10-place-form');
  const reply = await callApi('POST', `/host/accounts/${orgId}/locations`, await clientContext(), {
    kind: text(form, 'kind', 16) || 'HOME',
    label: text(form, 'label', 80),
    addressLine: text(form, 'addressLine'),
    city: text(form, 'city', 80),
    areaLabel: opt(form, 'areaLabel', 80),
  });
  if (reply.status !== 201) {
    return {
      errors: errorsOf(reply, 'a10-place-form', {
        label: 'a10-place-label',
        addressLine: 'a10-place-address',
        city: 'a10-place-city',
        areaLabel: 'a10-place-area',
      }),
    };
  }
  done(orgId);
}

async function createVehicleImpl(_prev: HostFormState, form: FormData): Promise<HostFormState> {
  const orgId = idOf(form, 'org');
  if (orgId === null) return invalid('a10-car-form');
  const year = Number(text(form, 'year', 4));
  const seats = Number(text(form, 'seats', 2));
  const reply = await callApi('POST', `/host/accounts/${orgId}/vehicles`, await clientContext(), {
    locationId: idOf(form, 'locationId') ?? '',
    plate: text(form, 'plate', 24),
    vin: opt(form, 'vin', 40),
    makeText: text(form, 'makeText', 80),
    modelText: text(form, 'modelText', 80),
    year: Number.isInteger(year) ? year : 0,
    transmission: text(form, 'transmission', 16),
    seats: Number.isInteger(seats) ? seats : 0,
    fuelType: text(form, 'fuelType', 16),
  });
  if (reply.status !== 201) {
    return {
      errors: errorsOf(reply, 'a10-car-form', {
        plate: 'a10-car-plate',
        vin: 'a10-car-vin',
        makeText: 'a10-car-make',
        modelText: 'a10-car-model',
        year: 'a10-car-year',
        seats: 'a10-car-seats',
      }),
    };
  }
  done(orgId);
}

/** Tarif saisi dans la langue de la vue, converti en unités mineures avec l'exposant du compte. */
async function pricingOf(form: FormData, formId: string) {
  const exponent = Number(text(form, 'exponent', 1));
  const number = getProfile(LOCALE_CONFIG, await getRequestLocaleTag()).number;
  const price = minorFromInput(text(form, 'price', 32), exponent, number);
  const km = text(form, 'km', 6);
  const extra = text(form, 'extraKm', 32);
  const errors: { fieldId: string; key: MessageKey }[] = [];
  if (price === null)
    errors.push({ fieldId: `${formId}-price`, key: 'common.listing.priceInvalid' });
  let mileage: Record<string, unknown> = { mileageMode: 'UNLIMITED' };
  if (km !== '') {
    const extraMinor = minorFromInput(extra === '' ? '0' : extra, exponent, number);
    if (!/^[1-9][0-9]{0,4}$/.test(km) || extraMinor === null) {
      errors.push({ fieldId: `${formId}-km`, key: 'common.listing.mileageInvalid' });
    }
    mileage = {
      mileageMode: 'INCLUDED',
      includedKmPerDay: Number(km),
      extraKmPriceMinor: extraMinor,
    };
  }
  return { errors, body: { dailyPriceMinor: price, ...mileage } };
}

async function createListingImpl(_prev: HostFormState, form: FormData): Promise<HostFormState> {
  const orgId = idOf(form, 'org');
  if (orgId === null) return invalid('a10-new');
  const p = await pricingOf(form, 'a10-new');
  if (p.errors.length > 0) return { errors: p.errors };
  const reply = await callApi('POST', `/host/accounts/${orgId}/listings`, await clientContext(), {
    vehicleId: idOf(form, 'vehicleId') ?? '',
    ...p.body,
  });
  if (reply.status !== 201) return { errors: errorsOf(reply, 'a10-new', {}) };
  done(orgId);
}

async function savePriceImpl(_prev: HostFormState, form: FormData): Promise<HostFormState> {
  const orgId = idOf(form, 'org');
  const listingId = idOf(form, 'listing');
  const formId = `a10-${listingId ?? 'x'}`;
  if (orgId === null || listingId === null) return invalid(formId);
  const p = await pricingOf(form, formId);
  if (p.errors.length > 0) return { errors: p.errors };
  const reply = await callApi(
    'PUT',
    `/host/accounts/${orgId}/listings/${listingId}/pricing`,
    await clientContext(),
    p.body,
  );
  if (reply.status !== 200) return { errors: errorsOf(reply, formId, {}) };
  done(orgId);
}

async function addPhotoImpl(_prev: HostFormState, form: FormData): Promise<HostFormState> {
  const orgId = idOf(form, 'org');
  const listingId = idOf(form, 'listing');
  const formId = `a10-${listingId ?? 'x'}-photo`;
  if (orgId === null || listingId === null) return invalid(formId);
  const file = form.get('photo');
  if (!(file instanceof Blob) || file.size === 0) {
    return { errors: [{ fieldId: formId, key: 'common.listing.field.required' }] };
  }
  const data = Buffer.from(await file.arrayBuffer()).toString('base64');
  const reply = await callApi(
    'POST',
    `/host/accounts/${orgId}/listings/${listingId}/photos`,
    await clientContext(),
    { dataBase64: data },
  );
  if (reply.status !== 201) return { errors: errorsOf(reply, formId, {}) };
  done(orgId);
}

async function listingStepImpl(_prev: HostFormState, form: FormData): Promise<HostFormState> {
  const orgId = idOf(form, 'org');
  const listingId = idOf(form, 'listing');
  const step = text(form, 'step', 8);
  const formId = `a10-${listingId ?? 'x'}-${step}`;
  if (orgId === null || listingId === null || (step !== 'submit' && step !== 'delete')) {
    return invalid(formId);
  }
  const ctx = await clientContext();
  const reply =
    step === 'submit'
      ? await callApi('POST', `/host/accounts/${orgId}/listings/${listingId}/submit`, ctx, {})
      : await callApi('DELETE', `/host/accounts/${orgId}/listings/${listingId}`, ctx, {});
  if (reply.status !== 200) return { errors: errorsOf(reply, formId, {}) };
  done(orgId);
}

export async function createLocationAction(
  prev: HostFormState,
  form: FormData,
): Promise<HostFormState> {
  return keep(form, await createLocationImpl(prev, form));
}

export async function createVehicleAction(
  prev: HostFormState,
  form: FormData,
): Promise<HostFormState> {
  return keep(form, await createVehicleImpl(prev, form));
}

export async function createListingAction(
  prev: HostFormState,
  form: FormData,
): Promise<HostFormState> {
  return keep(form, await createListingImpl(prev, form));
}

export async function savePriceAction(prev: HostFormState, form: FormData): Promise<HostFormState> {
  return keep(form, await savePriceImpl(prev, form));
}

export async function addPhotoAction(prev: HostFormState, form: FormData): Promise<HostFormState> {
  return keep(form, await addPhotoImpl(prev, form));
}

export async function listingStepAction(
  prev: HostFormState,
  form: FormData,
): Promise<HostFormState> {
  return keep(form, await listingStepImpl(prev, form));
}
