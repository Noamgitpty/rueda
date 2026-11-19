'use server';
/**
 * Action serveur de l'écran « compte de versement » de l'hôte (US-707 ; 16 PYO-001 ; 10b A07,
 * UX-40, UX-43) : `POST /host/accounts/{orgId}/payout-account`. Le site appelle l'API CÔTÉ
 * SERVEUR ; le compte d'hôte vient d'un champ caché que l'API revérifie toujours (compte d'un
 * autre : 404 ; co-hôte : 403). Le numéro de compte et le numéro fiscal du titulaire ne figurent
 * jamais dans une URL, un journal ni l'état renvoyé au formulaire après un refus (minimisation,
 * données C2 / C3 de 17).
 */
import { redirect } from 'next/navigation';
import { callApi, codeOf } from '../../../../account/api-client.ts';
import { clientContext } from '../../../../account/request.ts';
import { apiErrorKey } from '../../_account/errors.ts';
import type { FormError, FormErrors } from '../../_account/errors.ts';

export interface PayoutFormState {
  readonly errors: FormErrors;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const text = (form: FormData, name: string, max: number): string => {
  const v = form.get(name);
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
};

/** Champ de l'écran rattaché au code de refus de l'API (sinon : erreur du formulaire). */
const FIELD_OF: Readonly<Record<string, string>> = {
  PAYOUT_ACCOUNT_INVALID: 'a07p-number',
  PAYOUT_RAIL_UNSUPPORTED: 'a07p-institution',
  PAYOUT_HOLDER_MISMATCH: 'a07p-surnames',
};

export async function savePayoutAction(
  _prev: PayoutFormState,
  form: FormData,
): Promise<PayoutFormState> {
  const org = text(form, 'org', 36);
  if (!UUID.test(org)) return { errors: [{ fieldId: 'a07p-form', key: 'common.error.server' }] };
  const body = {
    kind: text(form, 'kind', 32),
    institution: text(form, 'institution', 32),
    accountNumber: text(form, 'accountNumber', 64),
    holderGivenNames: text(form, 'holderGivenNames', 100),
    holderSurnames: text(form, 'holderSurnames', 100),
    holderTaxId: text(form, 'holderTaxId', 64),
  };
  // champs vides : erreurs liées au champ, rien n'est envoyé
  const missing: FormError[] = (
    [
      ['institution', 'a07p-institution'],
      ['accountNumber', 'a07p-number'],
      ['holderGivenNames', 'a07p-given'],
      ['holderSurnames', 'a07p-surnames'],
      ['holderTaxId', 'a07p-tax'],
    ] as const
  )
    .filter(([name]) => body[name] === '')
    .map(([, fieldId]) => ({ fieldId, key: 'web.a07.payout.required' }));
  if (missing.length > 0) return { errors: missing };
  const reply = await callApi(
    'POST',
    `/host/accounts/${org}/payout-account`,
    await clientContext(),
    body,
  );
  if (reply.status === 401) redirect('/login');
  if (reply.status === 200) {
    redirect(`/host/payout-account?${new URLSearchParams({ org }).toString()}`);
  }
  const code = codeOf(reply);
  const fieldId = (code !== null ? FIELD_OF[code] : undefined) ?? 'a07p-form';
  return { errors: [{ fieldId, key: apiErrorKey(code, reply.status) }] };
}
