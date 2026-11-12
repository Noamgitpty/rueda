'use server';
/**
 * Action serveur de la contestation d'une plaque ou d'un VIN (US-124, BOARD N-61) : plaque, VIN
 * facultatif et titre du demandeur (photo ou PDF, en base64 dans le corps). Le site appelle l'API
 * CÔTÉ SERVEUR ; le compte d'hôte vient d'un champ caché que l'API revérifie. Succès : retour à
 * l'écran avec « Guardado ». Jamais de donnée personnelle dans une URL.
 */
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import type { MessageKey } from '@rueda/i18n';
import { callApi } from '../../../../account/api-client.ts';
import { fieldsOf, messageKeyOf } from '../../../../account/host-listings.ts';
import { clientContext } from '../../../../account/request.ts';
import type { FormErrors } from '../../_account/errors.ts';

export interface ClaimFormState {
  readonly errors: FormErrors;
  readonly values?: Readonly<Record<string, string>>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const text = (form: FormData, name: string, max: number): string => {
  const v = form.get(name);
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
};

async function claimImpl(form: FormData): Promise<ClaimFormState> {
  const formId = 'a10c-claim';
  const orgId = text(form, 'org', 36);
  if (!UUID.test(orgId))
    return { errors: [{ fieldId: formId, key: 'common.listing.field.invalid' }] };
  const plate = text(form, 'plate', 24);
  const vin = text(form, 'vin', 40);
  const file = form.get('file');
  const errors: { fieldId: string; key: MessageKey }[] = [];
  if (!/^[A-Za-z0-9 .-]{2,24}$/.test(plate)) {
    errors.push({ fieldId: `${formId}-plate`, key: 'common.listing.field.required' });
  }
  if (vin !== '' && !/^[A-Za-z0-9 -]{5,40}$/.test(vin)) {
    errors.push({ fieldId: `${formId}-vin`, key: 'common.listing.field.invalid' });
  }
  if (!(file instanceof Blob) || file.size === 0) {
    errors.push({ fieldId: `${formId}-file`, key: 'common.listing.field.required' });
  }
  if (errors.length > 0) return { errors };
  const reply = await callApi(
    'POST',
    `/host/accounts/${orgId}/vehicle-claims`,
    await clientContext(),
    {
      requestId: randomUUID(),
      plate,
      vin: vin === '' ? null : vin,
      dataBase64: Buffer.from(await (file as Blob).arrayBuffer()).toString('base64'),
    },
  );
  if (reply.status !== 201) {
    const fields = fieldsOf(reply);
    if (fields.length > 0) {
      const ids: Record<string, string> = {
        plate: `${formId}-plate`,
        vin: `${formId}-vin`,
        dataBase64: `${formId}-file`,
      };
      return {
        errors: fields.map((f) => ({
          fieldId: ids[f.field] ?? formId,
          key: (f.reason === 'REQUIRED'
            ? 'common.listing.field.required'
            : 'common.listing.field.invalid') as MessageKey,
        })),
      };
    }
    if (reply.status === 'unavailable') {
      return { errors: [{ fieldId: formId, key: 'common.listing.unavailable' }] };
    }
    return { errors: [{ fieldId: formId, key: messageKeyOf(reply) ?? 'common.error.server' }] };
  }
  redirect(`/host/claims?org=${orgId}&saved=1`);
}

export async function openClaimAction(
  _prev: ClaimFormState,
  form: FormData,
): Promise<ClaimFormState> {
  const state = await claimImpl(form);
  const values: Record<string, string> = {};
  for (const name of ['plate', 'vin']) {
    const v = form.get(name);
    if (typeof v === 'string') values[name] = v.slice(0, 40);
  }
  return { ...state, values };
}
