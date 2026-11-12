'use server';
/**
 * Actions serveur de l'écran A07 « Deviens hôte » (US-123 ; 16 HST-049 / FIN-008 ; 10b A07,
 * UX-40) : profil fiscal (`POST /host/accounts/{orgId}/verification/tax-profile`) et envoi du
 * dossier (`POST /host/accounts/{orgId}/verification`). Le site appelle l'API CÔTÉ SERVEUR ; le
 * compte d'hôte vient d'un champ caché que l'API revérifie toujours (compte d'un autre : 404). Le
 * numéro fiscal ne figure jamais dans une URL, un journal ni une saisie renvoyée après un refus.
 */
import { redirect } from 'next/navigation';
import { callApi, codeOf } from '../../../../account/api-client.ts';
import { clientContext } from '../../../../account/request.ts';
import { apiErrorKey } from '../../_account/errors.ts';
import type { FormErrors } from '../../_account/errors.ts';

export interface VerificationFormState {
  readonly errors: FormErrors;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const text = (form: FormData, name: string, max: number): string => {
  const v = form.get(name);
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
};

const back = (org: string): never =>
  redirect(`/host/verification?${new URLSearchParams({ org }).toString()}`);

export async function saveTaxAction(
  _prev: VerificationFormState,
  form: FormData,
): Promise<VerificationFormState> {
  const org = text(form, 'org', 36);
  if (!UUID.test(org)) return { errors: [{ fieldId: 'a07-tax-form', key: 'common.error.server' }] };
  const kind = text(form, 'kind', 32);
  const taxId = text(form, 'taxId', 64);
  const regime = text(form, 'regime', 32);
  if (taxId === '') {
    return { errors: [{ fieldId: 'a07-tax-number', key: 'common.hostVerification.taxIdInvalid' }] };
  }
  const reply = await callApi(
    'POST',
    `/host/accounts/${org}/verification/tax-profile`,
    await clientContext(),
    { kind, taxId, ...(regime === '' ? {} : { regime: regime.toUpperCase() }) },
  );
  if (reply.status === 401) redirect('/login');
  if (reply.status === 200) back(org);
  const code = codeOf(reply);
  const fieldId =
    code === 'HOST_TAX_ID_INVALID'
      ? 'a07-tax-number'
      : code === 'HOST_TAX_ID_KIND_INVALID'
        ? 'a07-tax-kind'
        : code === 'REQUEST_INVALID' && regime !== ''
          ? 'a07-tax-regime'
          : 'a07-tax-form';
  return { errors: [{ fieldId, key: apiErrorKey(code, reply.status) }] };
}

export async function submitAction(
  _prev: VerificationFormState,
  form: FormData,
): Promise<VerificationFormState> {
  const org = text(form, 'org', 36);
  if (!UUID.test(org)) {
    return { errors: [{ fieldId: 'a07-submit-form', key: 'common.error.server' }] };
  }
  const reply = await callApi(
    'POST',
    `/host/accounts/${org}/verification`,
    await clientContext(),
    {},
  );
  if (reply.status === 401) redirect('/login');
  if (reply.status === 200) back(org);
  return {
    errors: [{ fieldId: 'a07-submit-form', key: apiErrorKey(codeOf(reply), reply.status) }],
  };
}
