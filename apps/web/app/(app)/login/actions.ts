'use server';
/**
 * Actions serveur de la connexion et de la réacceptation des documents (S15, US-102).
 *
 * - Connexion : `POST /auth/login` ; le cookie de session émis par l'API est reposé sur le site.
 *   Puis `GET /legal/consents` : après une version MAJEURE des CGU ou de la confidentialité,
 *   l'écran de réacceptation passe AVANT toute réservation (16 ACC-001, `TERMS_REACCEPT_REQUIRED`).
 * - Réacceptation : `POST /legal/consents/accept` avec les versions AFFICHÉES ; une version
 *   périmée (`TERMS_VERSION_CHANGED`) recharge l'écran.
 */
import { redirect } from 'next/navigation';
import { callApi, codeOf } from '../../../account/api-client.ts';
import { clientContext, storeSession } from '../../../account/request.ts';
import { apiErrorKey } from '../_account/errors.ts';
import type { FormErrors } from '../_account/errors.ts';

export interface LoginState {
  readonly errors: FormErrors;
  readonly email: string;
}

const text = (form: FormData, name: string, max = 254): string => {
  const v = form.get(name);
  return typeof v === 'string' ? v.slice(0, max) : '';
};

export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = text(form, 'email');
  const ctx = await clientContext();
  const reply = await callApi('POST', '/auth/login', ctx, {
    email,
    password: text(form, 'password', 1024),
  });
  if (reply.status !== 200 || reply.session === null) {
    const code = codeOf(reply);
    return {
      email,
      errors: [
        {
          fieldId: code === 'AUTH_INVALID_CREDENTIALS' ? 's15-login-email' : 's15-form',
          key: apiErrorKey(code, reply.status),
        },
      ],
    };
  }
  await storeSession(reply.session);
  const consents = await callApi('GET', '/legal/consents', {
    ...ctx,
    sessionToken: reply.session.token,
  });
  // fail-closed : état illisible ⇒ l'écran de réacceptation (qui relit l'état) plutôt qu'un passage
  if (consents.status !== 200 || codeOf(consents) !== 'TERMS_CURRENT') redirect('/terms/update');
  redirect('/login/done');
}

export interface AcceptState {
  readonly errors: FormErrors;
}

export async function acceptAction(_prev: AcceptState, form: FormData): Promise<AcceptState> {
  const documents: { kind: string; version: number }[] = [];
  for (const kind of ['TOS_GUEST', 'PRIVACY']) {
    const v = Number(text(form, kind, 6));
    if (Number.isInteger(v) && v >= 1) documents.push({ kind, version: v });
  }
  if (form.get('accept') !== 'on') {
    return { errors: [{ fieldId: 's15-accept', key: 'common.auth.termsNotAccepted' }] };
  }
  const reply = await callApi('POST', '/legal/consents/accept', await clientContext(), {
    documents,
  });
  if (reply.status === 200 && codeOf(reply) === 'TERMS_CURRENT') redirect('/login/done');
  if (reply.status === 401) redirect('/login');
  return { errors: [{ fieldId: 's15-form', key: apiErrorKey(codeOf(reply), reply.status) }] };
}
