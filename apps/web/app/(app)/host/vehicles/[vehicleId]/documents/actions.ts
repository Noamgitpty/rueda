'use server';
/**
 * Actions serveur des documents d'un véhicule (US-124 ; 16 HST-019, HST-039) : déclarations
 * (titulaire du titre, prenda, compteur), dépôt d'une pièce, soumission à la revue. Le site appelle
 * l'API CÔTÉ SERVEUR ; le compte d'hôte et le véhicule viennent de champs cachés que l'API
 * revérifie toujours (un véhicule d'un autre hôte : 404). Formulaires sans JavaScript ; succès :
 * retour à l'écran avec « Guardado » ; soumission refusée : retour à l'écran, qui liste les motifs
 * relus de l'API. Jamais de donnée personnelle dans une URL ; la pièce part en base64 dans le corps.
 */
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import type { MessageKey } from '@rueda/i18n';
import { callApi } from '../../../../../../account/api-client.ts';
import type { ApiResult } from '../../../../../../account/api-client.ts';
import { fieldsOf, formatPhotoMax, messageKeyOf } from '../../../../../../account/host-listings.ts';
import { clientContext } from '../../../../../../account/request.ts';
import { DOCUMENT_TYPES, eligibilityOf } from '../../../../../../account/vehicle-documents.ts';
import { getRequestLocaleTag } from '../../../../../../i18n.ts';
import type { FormErrors } from '../../../../_account/errors.ts';

export interface DocumentsFormState {
  readonly errors: FormErrors;
  readonly values?: Readonly<Record<string, string>>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HIDDEN = new Set(['org', 'vehicle', 'file']);

const text = (form: FormData, name: string, max = 40): string => {
  const v = form.get(name);
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
};
const idOf = (form: FormData, name: string): string | null => {
  const v = text(form, name, 36);
  return UUID.test(v) ? v : null;
};

/** Saisie renvoyée après un refus (React réinitialise le formulaire : rien n'est perdu, UX-10). */
function keep(form: FormData, state: DocumentsFormState): DocumentsFormState {
  const values: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    if (typeof v === 'string' && !HIDDEN.has(k) && !k.startsWith('$')) values[k] = v.slice(0, 40);
  }
  return { ...state, values };
}

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
  if (reply.status === 'unavailable') {
    return [{ fieldId: formId, key: 'common.listing.unavailable' }];
  }
  return [{ fieldId: formId, key: messageKeyOf(reply) ?? 'common.error.server' }];
}

const invalid = (formId: string): DocumentsFormState => ({
  errors: [{ fieldId: formId, key: 'common.listing.field.invalid' }],
});

function back(orgId: string, vehicleId: string, flag: 'saved' | 'refused'): never {
  redirect(`/host/vehicles/${vehicleId}/documents?org=${orgId}&${flag}=1`);
}

async function declareImpl(form: FormData): Promise<DocumentsFormState> {
  const formId = 'a10d-declare';
  const orgId = idOf(form, 'org');
  const vehicleId = idOf(form, 'vehicle');
  if (orgId === null || vehicleId === null) return invalid(formId);
  const holder = text(form, 'titleHolder', 12);
  const km = text(form, 'odometerKm', 8);
  const vin = text(form, 'vin', 40);
  const errors: { fieldId: string; key: MessageKey }[] = [];
  if (holder !== 'HOST' && holder !== 'THIRD_PARTY') {
    errors.push({ fieldId: `${formId}-holder`, key: 'common.listing.field.required' });
  }
  if (!/^\d{1,7}$/.test(km)) {
    errors.push({ fieldId: `${formId}-km`, key: 'common.listing.field.required' });
  }
  if (form.get('owner') !== 'on') {
    errors.push({ fieldId: `${formId}-owner`, key: 'common.vehicleDocs.titleMismatch' });
  }
  if (vin !== '' && !/^[A-Za-z0-9 -]{5,40}$/.test(vin)) {
    errors.push({ fieldId: `${formId}-vin`, key: 'common.listing.field.invalid' });
  }
  if (errors.length > 0) return { errors };
  const reply = await callApi(
    'PUT',
    `/host/accounts/${orgId}/vehicles/${vehicleId}/declaration`,
    await clientContext(),
    {
      titleHolder: holder,
      lienDeclared: form.get('lien') === 'on',
      odometerKm: Number(km),
      ownershipAttested: form.get('owner') === 'on',
      lienAttested: form.get('lienOk') === 'on',
      vin: vin === '' ? null : vin,
    },
  );
  if (reply.status !== 200) {
    return {
      errors: errorsOf(reply, formId, {
        titleHolder: `${formId}-holder`,
        odometerKm: `${formId}-km`,
        vin: `${formId}-vin`,
      }),
    };
  }
  back(orgId, vehicleId, 'saved');
}

async function uploadImpl(form: FormData): Promise<DocumentsFormState> {
  const formId = 'a10d-upload';
  const orgId = idOf(form, 'org');
  const vehicleId = idOf(form, 'vehicle');
  if (orgId === null || vehicleId === null) return invalid(formId);
  const type = text(form, 'type', 24);
  const until = text(form, 'validUntil', 10);
  const file = form.get('file');
  const errors: { fieldId: string; key: MessageKey; values?: Record<string, string> }[] = [];
  if (!(DOCUMENT_TYPES as readonly string[]).includes(type)) {
    errors.push({ fieldId: `${formId}-type`, key: 'common.listing.field.required' });
  }
  if (until !== '' && !DAY.test(until)) {
    errors.push({ fieldId: `${formId}-until`, key: 'common.listing.field.invalid' });
  }
  if (!(file instanceof Blob) || file.size === 0) {
    errors.push({ fieldId: `${formId}-file`, key: 'common.listing.field.required' });
  }
  if (errors.length > 0) return { errors };
  const ctx = await clientContext();
  // taille maximale annoncée par l'API (dépôt fermé : l'API répond 503, rien n'est envoyé ici)
  const state = eligibilityOf(
    await callApi('GET', `/host/accounts/${orgId}/vehicle-eligibility`, ctx),
  );
  const blob = file as Blob;
  if (state !== null && blob.size > state.uploads.maxBytes) {
    return {
      errors: [
        {
          fieldId: `${formId}-file`,
          key: 'web.vehicleDocs.upload.tooLarge',
          values: { max: formatPhotoMax(state.uploads.maxBytes, await getRequestLocaleTag()) },
        },
      ],
    };
  }
  const reply = await callApi(
    'POST',
    `/host/accounts/${orgId}/vehicles/${vehicleId}/documents`,
    ctx,
    {
      requestId: randomUUID(),
      type,
      validUntil: until === '' ? null : until,
      dataBase64: Buffer.from(await blob.arrayBuffer()).toString('base64'),
    },
  );
  if (reply.status !== 201) {
    return {
      errors: errorsOf(reply, formId, {
        type: `${formId}-type`,
        validUntil: `${formId}-until`,
        dataBase64: `${formId}-file`,
      }),
    };
  }
  back(orgId, vehicleId, 'saved');
}

async function submitImpl(form: FormData): Promise<DocumentsFormState> {
  const formId = 'a10d-submit';
  const orgId = idOf(form, 'org');
  const vehicleId = idOf(form, 'vehicle');
  if (orgId === null || vehicleId === null) return invalid(formId);
  const reply = await callApi(
    'POST',
    `/host/accounts/${orgId}/vehicles/${vehicleId}/eligibility`,
    await clientContext(),
    {},
  );
  if (reply.status === 200) back(orgId, vehicleId, 'saved');
  // refus d'une règle : l'écran relit et liste tous les motifs (« Qué falta »)
  if (
    reply.status === 422 ||
    (reply.status === 409 && messageKeyOf(reply) === 'common.catalogAddition.pending')
  ) {
    back(orgId, vehicleId, 'refused');
  }
  return { errors: errorsOf(reply, formId, {}) };
}

export async function declareAction(
  _prev: DocumentsFormState,
  form: FormData,
): Promise<DocumentsFormState> {
  return keep(form, await declareImpl(form));
}

export async function uploadDocumentAction(
  _prev: DocumentsFormState,
  form: FormData,
): Promise<DocumentsFormState> {
  return keep(form, await uploadImpl(form));
}

export async function submitEligibilityAction(
  _prev: DocumentsFormState,
  form: FormData,
): Promise<DocumentsFormState> {
  return keep(form, await submitImpl(form));
}
