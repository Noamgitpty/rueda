'use server';
/**
 * Action serveur de la recherche de constancia par l'hôte (US-212, ADR-162 ; 16 LEG-026 parcours
 * EC-48 : amende reçue après le trip) : `POST /trips/constancias/search` avec la plaque et la date
 * locale dans le CORPS (jamais dans une URL ni un journal). La base ne rend que les trips du compte
 * d'hôte de la session. Formulaire sans JavaScript.
 */
import { redirect } from 'next/navigation';
import { callApi, codeOf } from '../../../../account/api-client.ts';
import { clientContext } from '../../../../account/request.ts';
import { constanciaSearchOf } from '../../../../account/trip-constancia.ts';
import type { ConstanciaSearchItem } from '../../../../account/trip-constancia.ts';
import type { FormErrors } from '../../_account/errors.ts';
import { SEARCH_DATE_ID, SEARCH_FORM_ID, SEARCH_PLATE_ID } from './ids.ts';

export interface ConstanciaSearchState {
  readonly errors: FormErrors;
  /** `null` : aucune recherche encore ; liste (éventuellement vide) sinon. */
  readonly trips: readonly ConstanciaSearchItem[] | null;
}

const field = (form: FormData, name: string, max: number): string => {
  const v = form.get(name);
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
};

export async function searchConstanciaAction(
  _prev: ConstanciaSearchState,
  form: FormData,
): Promise<ConstanciaSearchState> {
  const plate = field(form, 'plate', 32);
  const date = field(form, 'date', 10);
  const errors = [
    ...(plate.replace(/[^A-Za-z0-9]/g, '').length < 2
      ? [{ fieldId: SEARCH_PLATE_ID, key: 'web.constancia.search.invalid' as const }]
      : []),
    ...(!/^\d{4}-\d{2}-\d{2}$/.test(date)
      ? [{ fieldId: SEARCH_DATE_ID, key: 'web.constancia.search.invalid' as const }]
      : []),
  ];
  if (errors.length > 0) return { errors, trips: null };
  const reply = await callApi('POST', '/trips/constancias/search', await clientContext(), {
    plate,
    date,
  });
  if (reply.status === 401) redirect('/login');
  const code = codeOf(reply);
  if (code === 'TERMS_REACCEPT_REQUIRED') redirect('/terms/update');
  if (code === 'REQUEST_INVALID') {
    return {
      errors: [{ fieldId: SEARCH_PLATE_ID, key: 'web.constancia.search.invalid' }],
      trips: null,
    };
  }
  const trips = constanciaSearchOf(reply);
  if (trips === null) {
    return {
      errors: [{ fieldId: SEARCH_FORM_ID, key: 'common.constancia.unavailable' }],
      trips: null,
    };
  }
  return { errors: [], trips };
}
