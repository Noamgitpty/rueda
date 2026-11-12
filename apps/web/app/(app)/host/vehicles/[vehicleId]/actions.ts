'use server';
/**
 * Actions serveur du calendrier d'un véhicule (A06, US-119) : blocage par jours ou par heures,
 * levée d'un blocage, préavis du lieu de remise. Le site appelle l'API CÔTÉ SERVEUR ; le compte
 * d'hôte, le véhicule, le lieu et le blocage viennent de champs cachés que l'API revérifie toujours
 * (un objet d'un autre hôte : 404). Les heures saisies sont des heures LOCALES du véhicule : l'API
 * les convertit dans le fuseau du véhicule (jamais le navigateur). Formulaires sans JavaScript ;
 * succès : retour à l'écran avec « Guardado ». Jamais de donnée personnelle dans une URL.
 */
import { redirect } from 'next/navigation';
import type { MessageKey } from '@rueda/i18n';
import { callApi } from '../../../../../account/api-client.ts';
import type { ApiResult } from '../../../../../account/api-client.ts';
import { fieldsOf, messageKeyOf } from '../../../../../account/host-listings.ts';
import { clientContext } from '../../../../../account/request.ts';
import type { FormErrors } from '../../../_account/errors.ts';

export interface CalendarFormState {
  readonly errors: FormErrors;
  readonly values?: Readonly<Record<string, string>>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
const HIDDEN = new Set(['org', 'vehicle', 'location', 'block']);

const text = (form: FormData, name: string, max = 40): string => {
  const v = form.get(name);
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
};
const idOf = (form: FormData, name: string): string | null => {
  const v = text(form, name, 36);
  return UUID.test(v) ? v : null;
};

/** Saisie renvoyée après un refus (React réinitialise le formulaire : rien n'est perdu, UX-10). */
function keep(form: FormData, state: CalendarFormState): CalendarFormState {
  const values: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    if (typeof v === 'string' && !HIDDEN.has(k) && !k.startsWith('$')) values[k] = v.slice(0, 40);
  }
  return { ...state, values };
}

/** Erreur d'une réponse : champ refusé lié à son champ, sinon message du code sur le formulaire. */
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
  if (reply.status === 'unavailable')
    return [{ fieldId: formId, key: 'common.listing.unavailable' }];
  return [{ fieldId: formId, key: messageKeyOf(reply) ?? 'common.error.server' }];
}

const invalid = (formId: string): CalendarFormState => ({
  errors: [{ fieldId: formId, key: 'common.listing.field.invalid' }],
});

function done(orgId: string, vehicleId: string): never {
  redirect(`/host/vehicles/${vehicleId}?org=${orgId}&saved=1`);
}

async function blockDaysImpl(form: FormData): Promise<CalendarFormState> {
  const formId = 'a06-days';
  const orgId = idOf(form, 'org');
  const vehicleId = idOf(form, 'vehicle');
  if (orgId === null || vehicleId === null) return invalid(formId);
  const from = text(form, 'from', 10);
  const to = text(form, 'to', 10) || from;
  const errors: { fieldId: string; key: MessageKey }[] = [];
  if (!DAY.test(from))
    errors.push({ fieldId: `${formId}-from`, key: 'common.listing.field.required' });
  if (!DAY.test(to)) errors.push({ fieldId: `${formId}-to`, key: 'common.listing.field.invalid' });
  if (errors.length > 0) return { errors };
  const reply = await callApi(
    'POST',
    `/host/accounts/${orgId}/vehicles/${vehicleId}/blocks`,
    await clientContext(),
    { from, to },
  );
  if (reply.status !== 201) {
    return { errors: errorsOf(reply, formId, { from: `${formId}-from`, to: `${formId}-to` }) };
  }
  done(orgId, vehicleId);
}

async function blockHoursImpl(form: FormData): Promise<CalendarFormState> {
  const formId = 'a06-hours';
  const orgId = idOf(form, 'org');
  const vehicleId = idOf(form, 'vehicle');
  if (orgId === null || vehicleId === null) return invalid(formId);
  const day = text(form, 'day', 10);
  const start = text(form, 'start', 5);
  const end = text(form, 'end', 5);
  const errors: { fieldId: string; key: MessageKey }[] = [];
  if (!DAY.test(day))
    errors.push({ fieldId: `${formId}-day`, key: 'common.listing.field.required' });
  if (!TIME.test(start)) {
    errors.push({ fieldId: `${formId}-start`, key: 'common.listing.field.required' });
  }
  if (!TIME.test(end))
    errors.push({ fieldId: `${formId}-end`, key: 'common.listing.field.required' });
  if (errors.length > 0) return { errors };
  const reply = await callApi(
    'POST',
    `/host/accounts/${orgId}/vehicles/${vehicleId}/blocks`,
    await clientContext(),
    { start: `${day}T${start}`, end: `${day}T${end}` },
  );
  if (reply.status !== 201) {
    return {
      errors: errorsOf(reply, formId, { start: `${formId}-start`, end: `${formId}-end` }),
    };
  }
  done(orgId, vehicleId);
}

async function unblockImpl(form: FormData): Promise<CalendarFormState> {
  const orgId = idOf(form, 'org');
  const vehicleId = idOf(form, 'vehicle');
  const blockId = idOf(form, 'block');
  const formId = `a06-block-${blockId ?? 'x'}`;
  if (orgId === null || vehicleId === null || blockId === null) return invalid(formId);
  const reply = await callApi(
    'DELETE',
    `/host/accounts/${orgId}/vehicles/${vehicleId}/blocks/${blockId}`,
    await clientContext(),
    {},
  );
  if (reply.status !== 200) return { errors: errorsOf(reply, formId, {}) };
  done(orgId, vehicleId);
}

async function noticeImpl(form: FormData): Promise<CalendarFormState> {
  const formId = 'a06-notice';
  const orgId = idOf(form, 'org');
  const vehicleId = idOf(form, 'vehicle');
  const locationId = idOf(form, 'location');
  if (orgId === null || vehicleId === null || locationId === null) return invalid(formId);
  const raw = text(form, 'minutes', 6);
  if (raw !== 'default' && !/^[1-9][0-9]{1,4}$/.test(raw)) {
    return { errors: [{ fieldId: `${formId}-minutes`, key: 'common.calendar.noticeInvalid' }] };
  }
  const reply = await callApi(
    'PUT',
    `/host/accounts/${orgId}/locations/${locationId}/notice`,
    await clientContext(),
    { minutes: raw === 'default' ? null : Number(raw) },
  );
  if (reply.status !== 200) {
    return { errors: errorsOf(reply, formId, { minutes: `${formId}-minutes` }) };
  }
  done(orgId, vehicleId);
}

export async function blockDaysAction(
  _prev: CalendarFormState,
  form: FormData,
): Promise<CalendarFormState> {
  return keep(form, await blockDaysImpl(form));
}

export async function blockHoursAction(
  _prev: CalendarFormState,
  form: FormData,
): Promise<CalendarFormState> {
  return keep(form, await blockHoursImpl(form));
}

export async function unblockAction(
  _prev: CalendarFormState,
  form: FormData,
): Promise<CalendarFormState> {
  return keep(form, await unblockImpl(form));
}

export async function noticeAction(
  _prev: CalendarFormState,
  form: FormData,
): Promise<CalendarFormState> {
  return keep(form, await noticeImpl(form));
}
