'use server';
/**
 * Actions serveur de l'étape OTP de S15 (US-104, 16 VER-013, 10b UX-38) : demande du code
 * (`POST /phone/otp`) puis saisie (`POST /phone/verify`). Le code part par SMS de façon asynchrone ;
 * l'écran relit l'état (`GET /phone`) après chaque action. Jamais le numéro ni le code dans une
 * URL (corps JSON seulement), jamais de journal.
 */
import { redirect } from 'next/navigation';
import { callApi, codeOf } from '../../../account/api-client.ts';
import type { ApiResult } from '../../../account/api-client.ts';
import { clientContext } from '../../../account/request.ts';
import { apiErrorKey } from '../_account/errors.ts';
import type { FormErrors } from '../_account/errors.ts';

export interface PhoneFormState {
  readonly errors: FormErrors;
  readonly phone: string;
  readonly country: string;
}

export interface CodeFormState {
  readonly errors: FormErrors;
}

const text = (form: FormData, name: string, max: number): string => {
  const v = form.get(name);
  return typeof v === 'string' ? v.slice(0, max) : '';
};

/** Valeurs d'une réponse d'erreur (`values`) : nombres entiers et textes courts seulement. */
function valuesOf(reply: ApiResult): Readonly<Record<string, number | string>> | undefined {
  if (reply.status === 'unavailable') return undefined;
  const raw = (reply.json as { values?: unknown } | null)?.values;
  if (raw === null || typeof raw !== 'object') return undefined;
  const out: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[a-zA-Z]{1,32}$/.test(k)) continue;
    if (typeof v === 'number' && Number.isSafeInteger(v)) out[k] = v;
    else if (typeof v === 'string' && v.length <= 32) out[k] = v;
  }
  return out;
}

export async function requestCodeAction(
  _prev: PhoneFormState,
  form: FormData,
): Promise<PhoneFormState> {
  const phone = text(form, 'phone', 32);
  const country = text(form, 'country', 2);
  const reply = await callApi('POST', '/phone/otp', await clientContext(), { phone, country });
  if (reply.status === 401) redirect('/login');
  if (
    reply.status === 202 ||
    (reply.status === 200 && codeOf(reply) === 'PHONE_ALREADY_VERIFIED')
  ) {
    redirect('/verify-phone');
  }
  const code = codeOf(reply);
  const values = valuesOf(reply);
  return {
    phone,
    country,
    errors: [
      {
        fieldId: code === 'PHONE_INVALID' ? 's15-phone' : 's15-form',
        key: apiErrorKey(code, reply.status),
        ...(values !== undefined ? { values } : {}),
      },
    ],
  };
}

export async function verifyCodeAction(
  _prev: CodeFormState,
  form: FormData,
): Promise<CodeFormState> {
  const code = text(form, 'code', 16).replace(/\s+/g, '');
  const reply = await callApi('POST', '/phone/verify', await clientContext(), { code });
  if (reply.status === 401) redirect('/login');
  if (reply.status === 200 && codeOf(reply) === 'PHONE_VERIFIED') redirect('/verify-phone');
  const stable = codeOf(reply);
  if (stable === 'REQUEST_INVALID') {
    // code mal formé : refusé par l'API sans compter d'essai ; même message qu'un code faux
    const left = Number(text(form, 'attemptsLeft', 3));
    return {
      errors: [
        {
          fieldId: 's15-code',
          key: 'common.otp.invalid',
          values: { attempts: Number.isSafeInteger(left) ? left : 0 },
        },
      ],
    };
  }
  const values = valuesOf(reply);
  return {
    errors: [
      {
        fieldId: stable === 'OTP_INVALID' ? 's15-code' : 's15-form',
        key: apiErrorKey(stable, reply.status),
        ...(values !== undefined ? { values } : {}),
      },
    ],
  };
}
