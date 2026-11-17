'use server';
/**
 * Actions serveur de l'écran S04 (US-105 ; 16 VER-001, VER-004 ; 10b S04) : consentement
 * biométrique séparé (`POST /identity/consent`, version AFFICHÉE renvoyée), retrait, puis ouverture
 * du parcours hébergé du fournisseur (`POST /identity/verification`) et redirection vers son
 * adresse. Aucune pièce ni photo ne passe par le site ; jamais de donnée dans une URL du site.
 */
import { redirect } from 'next/navigation';
import { callApi, codeOf } from '../../../account/api-client.ts';
import {
  ENTRY_FIELD,
  entryInputErrors,
  entryInputOf,
  entryRequestOf,
} from '../../../account/entry-declaration.ts';
import type { ResidencyStatus } from '../../../account/entry-declaration.ts';
import { clientContext } from '../../../account/request.ts';
import { apiErrorKey } from '../_account/errors.ts';
import type { FormErrors } from '../_account/errors.ts';

export interface IdentityFormState {
  readonly errors: FormErrors;
}

const text = (form: FormData, name: string, max: number): string => {
  const v = form.get(name);
  return typeof v === 'string' ? v.slice(0, max) : '';
};

export async function consentAction(
  _prev: IdentityFormState,
  form: FormData,
): Promise<IdentityFormState> {
  if (form.get('consent') !== 'on') {
    return { errors: [{ fieldId: 's04-consent', key: 'web.s04.consent.required' }] };
  }
  const version = Number(text(form, 'version', 6));
  const country = text(form, 'country', 2);
  const reply = await callApi('POST', '/identity/consent', await clientContext(), {
    accepted: true,
    version: Number.isSafeInteger(version) ? version : 0,
    ...(/^[A-Z]{2}$/.test(country) ? { country } : {}),
  });
  if (reply.status === 401) redirect('/login');
  if (reply.status === 200) redirect('/verify-identity');
  return { errors: [{ fieldId: 's04-form', key: apiErrorKey(codeOf(reply), reply.status) }] };
}

export async function withdrawAction(prev: IdentityFormState): Promise<IdentityFormState> {
  const reply = await callApi('POST', '/identity/consent', await clientContext(), {
    accepted: false,
  });
  if (reply.status === 401) redirect('/login');
  if (reply.status === 200) redirect('/verify-identity');
  return {
    ...prev,
    errors: [{ fieldId: 's04-form', key: apiErrorKey(codeOf(reply), reply.status) }],
  };
}

export async function startAction(
  _prev: IdentityFormState,
  form: FormData,
): Promise<IdentityFormState> {
  const country = text(form, 'country', 2);
  const locale = text(form, 'locale', 5);
  const reply = await callApi('POST', '/identity/verification', await clientContext(), {
    country,
    ...(/^[a-z]{2}(-[A-Z]{2})?$/.test(locale) ? { locale } : {}),
  });
  if (reply.status === 401) redirect('/login');
  if (reply.status === 200 || reply.status === 201) {
    const url = (reply.json as { hostedUrl?: unknown } | null)?.hostedUrl;
    // parcours HÉBERGÉ chez le fournisseur : adresse https rendue par l'API seulement
    if (typeof url === 'string' && /^https:\/\/[^\s]+$/.test(url) && url.length <= 500) {
      redirect(url);
    }
    return { errors: [{ fieldId: 's04-form', key: 'common.kyc.sessionFailed' }] };
  }
  const code = codeOf(reply);
  return {
    errors: [
      {
        fieldId:
          code === 'COUNTRY_UNKNOWN' || code === 'KYC_DOCUMENT_UNSUPPORTED'
            ? 's04-country'
            : 's04-form',
        key: apiErrorKey(code, reply.status),
      },
    ],
  };
}

/** État de l'écran de déclaration d'entrée (US-209 partie 209c). */
export interface EntryFormState {
  readonly errors: FormErrors;
  /** Déclaration enregistrée (statut et jour envoyés), affichée en confirmation. */
  readonly saved: { readonly residency: ResidencyStatus; readonly date: string } | null;
  /** Saisie renvoyée après un refus. */
  readonly values?: Readonly<Record<string, string>>;
}

/**
 * Déclaration d'entrée (`POST /identity/entry-declaration`, US-209b ; 16 VER-007) : statut
 * (touriste ou résident) et, pour un touriste, date d'entrée ; contrôles de forme puis refus de
 * l'API sur leur champ (date future ⇒ KYC_ENTRY_DATE_INVALID, pays inconnu). Aucune donnée dans
 * une URL du site : la confirmation est rendue par l'état de l'action.
 */
export async function declareEntryAction(
  _prev: EntryFormState,
  form: FormData,
): Promise<EntryFormState> {
  const input = entryInputOf(form);
  const values = {
    country: input.country,
    residencyStatus: input.residency ?? '',
    entryDate: input.date,
  };
  const errors = entryInputErrors(input);
  if (errors.length > 0) return { errors, saved: null, values };
  const reply = await callApi(
    'POST',
    '/identity/entry-declaration',
    await clientContext(),
    entryRequestOf(input),
  );
  if (reply.status === 401) redirect('/login');
  if (reply.status === 200 && input.residency !== null) {
    return { errors: [], saved: { residency: input.residency, date: input.date }, values };
  }
  const code = codeOf(reply);
  const fieldId =
    code === 'KYC_ENTRY_DATE_INVALID'
      ? ENTRY_FIELD.date
      : code === 'COUNTRY_UNKNOWN'
        ? ENTRY_FIELD.country
        : ENTRY_FIELD.form;
  return { errors: [{ fieldId, key: apiErrorKey(code, reply.status) }], saved: null, values };
}
