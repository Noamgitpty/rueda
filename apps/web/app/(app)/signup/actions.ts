'use server';
/**
 * Action serveur de l'inscription (S15, US-102) : relaie le formulaire à `POST /auth/signup`
 * (corps JSON, jamais de donnée personnelle dans une URL) et traduit le code de l'API en erreur de
 * champ. Les versions des documents AFFICHÉES sont renvoyées à l'API, qui refuse une version
 * périmée (`TERMS_VERSION_CHANGED`). Succès : écran « Revisa tu correo », identique que l'email
 * soit libre ou déjà pris (16 ACC-001).
 */
import { redirect } from 'next/navigation';
import { callApi, codeOf } from '../../../account/api-client.ts';
import { clientContext } from '../../../account/request.ts';
import { LOCALE_CONFIG } from '../../../locale-config.ts';
import { apiErrorKey } from '../_account/errors.ts';
import type { FormErrors } from '../_account/errors.ts';

export interface SignupValues {
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly marketing: boolean;
}

export interface SignupState {
  readonly errors: FormErrors;
  readonly values: SignupValues;
}

const text = (form: FormData, name: string, max = 254): string => {
  const v = form.get(name);
  return typeof v === 'string' ? v.slice(0, max) : '';
};
const version = (form: FormData, name: string): number | null => {
  const v = Number(text(form, name, 6));
  return Number.isInteger(v) && v >= 1 ? v : null;
};

/** Champ visé par chaque code de l'API (le reste est une erreur de formulaire). */
const FIELD_OF: Readonly<Record<string, string>> = {
  AUTH_EMAIL_INVALID: 's15-email',
  AUTH_PASSWORD_WEAK: 's15-password',
  AUTH_TERMS_NOT_ACCEPTED: 's15-terms',
  TERMS_VERSION_CHANGED: 's15-terms',
  REQUEST_INVALID: 's15-first',
};

export async function signupAction(_prev: SignupState, form: FormData): Promise<SignupState> {
  const values: SignupValues = {
    firstName: text(form, 'firstName', 100),
    lastName: text(form, 'lastName', 100),
    email: text(form, 'email'),
    marketing: form.get('marketing') === 'on',
  };
  const locale = text(form, 'locale', 8);
  const country = text(form, 'country', 2);
  const tos = version(form, 'tosVersion');
  const privacy = version(form, 'privacyVersion');
  const knownLocale = LOCALE_CONFIG.locales.some((l) => l.tag === locale);
  const reply = await callApi('POST', '/auth/signup', await clientContext(), {
    email: values.email,
    password: text(form, 'password', 1024),
    legalFirstName: values.firstName,
    legalLastName: values.lastName,
    locale: knownLocale ? locale : LOCALE_CONFIG.defaultLocale,
    termsAccepted: form.get('terms') === 'on',
    marketingOptIn: values.marketing,
    ...(/^[A-Z]{2}$/.test(country) ? { country } : {}),
    ...(tos !== null && privacy !== null
      ? {
          acceptedDocuments: [
            { kind: 'TOS_GUEST', version: tos },
            { kind: 'PRIVACY', version: privacy },
          ],
        }
      : {}),
  });
  if (reply.status === 202) redirect('/signup/sent');
  const code = codeOf(reply);
  const minimum = (reply.status !== 'unavailable' &&
    (reply.json as { values?: { min?: unknown } } | null)?.values?.min) as unknown;
  return {
    values,
    errors: [
      {
        fieldId: (code !== null ? FIELD_OF[code] : undefined) ?? 's15-form',
        key: apiErrorKey(code, reply.status),
        ...(code === 'AUTH_PASSWORD_WEAK' && typeof minimum === 'number'
          ? { values: { min: minimum } }
          : {}),
      },
    ],
  };
}
