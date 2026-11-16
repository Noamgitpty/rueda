'use server';
/**
 * Action serveur du plan de gains d'un véhicule (A11, US-226 partie 226b, ADR-137 ; 16 PRT-008) :
 * `PUT /host/accounts/{orgId}/vehicles/{vehicleId}/earnings-plan`. Le compte d'hôte et le véhicule
 * viennent de champs cachés que l'API revérifie toujours (objet d'un autre hôte : 404) ; le plan
 * est un code de la liste affichée, revérifié par la base (plan non vendu ou `PRO` :
 * `EARNINGS_PLAN_NOT_AVAILABLE`). Effet sur les NOUVEAUX devis seulement (un trip réservé garde son
 * plan). Succès : retour à l'écran avec la confirmation (`?saved=1`, 16 PRT-007 « confirmation
 * in-app du changement de plan »). Formulaire sans JavaScript ; jamais de donnée personnelle dans
 * une URL.
 */
import { redirect } from 'next/navigation';
import { callApi } from '../../../../../../account/api-client.ts';
import { RETIRED_PLAN } from '../../../../../../account/earnings-plans.ts';
import { messageKeyOf } from '../../../../../../account/host-listings.ts';
import { clientContext } from '../../../../../../account/request.ts';
import type { FormErrors } from '../../../../_account/errors.ts';

export interface PlanFormState {
  readonly errors: FormErrors;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PLAN_CODE = /^[A-Z][A-Z0-9_ÁÉÍÓÚÑ]{0,31}$/u;
/** Identifiant du formulaire (`plan-form.tsx`) : erreur du formulaire entier. */
const PLAN_FORM_ID = 'a11-plan';

const field = (form: FormData, name: string, max: number): string => {
  const v = form.get(name);
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
};

export async function setEarningsPlanAction(
  _prev: PlanFormState,
  form: FormData,
): Promise<PlanFormState> {
  const orgId = field(form, 'org', 36);
  const vehicleId = field(form, 'vehicle', 36);
  const planCode = field(form, 'planCode', 32).normalize('NFC');
  if (!UUID.test(orgId) || !UUID.test(vehicleId)) {
    return { errors: [{ fieldId: PLAN_FORM_ID, key: 'common.listing.field.invalid' }] };
  }
  if (!PLAN_CODE.test(planCode) || planCode === RETIRED_PLAN) {
    return { errors: [{ fieldId: `${PLAN_FORM_ID}-plans`, key: 'common.listing.field.required' }] };
  }
  const reply = await callApi(
    'PUT',
    `/host/accounts/${orgId}/vehicles/${vehicleId}/earnings-plan`,
    await clientContext(),
    { planCode },
  );
  if (reply.status === 401) redirect('/login');
  if (reply.status !== 200) {
    const key =
      reply.status === 'unavailable'
        ? 'common.listing.unavailable'
        : (messageKeyOf(reply) ?? 'common.error.server');
    return { errors: [{ fieldId: PLAN_FORM_ID, key }] };
  }
  redirect(`/host/vehicles/${vehicleId}/earnings-plan?org=${orgId}&saved=1`);
}
