'use client';
/**
 * Choix du plan de gains d'un véhicule (A11, US-226 partie 226b, ADR-137 ; 16 PRT-008) : un bouton
 * radio par plan vendu dans le pays (jamais `PRO`), plan en vigueur présélectionné, effet rappelé
 * avant le bouton (nouveaux trips seulement). Affiché seulement quand le pays vend plus d'un plan
 * (sinon : aucun sélecteur inutile, revue ux de 226a). Sans JavaScript : envoi natif.
 */
import { useActionState } from 'react';
import { createTranslator, getProfile } from '@rueda/i18n';
import { Banner, Button, ErrorSummary } from '@rueda/ui';
import { LOCALE_CONFIG } from '../../../../../../locale-config.ts';
import accountStyles from '../../../../_account/account.module.css';
import styles from '../../../host.module.css';
import { setEarningsPlanAction } from './actions.ts';
import type { PlanFormState } from './actions.ts';

const INITIAL: PlanFormState = { errors: [] };
const FORM_ID = 'a11-plan';
const PLANS_ID = `${FORM_ID}-plans`;

export interface PlanFormProps {
  readonly localeTag: string;
  readonly orgId: string;
  readonly vehicleId: string;
  readonly current: string | null;
  /** Plans vendus : code et libellé déjà traduit (« Estándar · recibes el 75 % del precio »). */
  readonly plans: readonly { readonly planCode: string; readonly label: string }[];
}

export function PlanForm({ localeTag, orgId, vehicleId, current, plans }: PlanFormProps) {
  const i18n = createTranslator(getProfile(LOCALE_CONFIG, localeTag));
  const t = i18n.t.bind(i18n);
  const [state, run, pending] = useActionState(setEarningsPlanAction, INITIAL);
  const messages = state.errors.map((e) => ({
    fieldId: e.fieldId,
    message: t(e.key, e.values),
  }));
  const formError = messages.find((m) => m.fieldId === FORM_ID)?.message;
  const plansError = messages.find((m) => m.fieldId === PLANS_ID)?.message;
  return (
    <form
      id={FORM_ID}
      className={styles['actions']}
      action={run}
      noValidate
      aria-label={t('web.a11.plan.choose')}
    >
      <ErrorSummary i18n={i18n} errors={messages.filter((m) => m.fieldId !== FORM_ID)} />
      {formError !== undefined && (
        <Banner tone="danger" live="assertive">
          {formError}
        </Banner>
      )}
      <input type="hidden" name="org" value={orgId} />
      <input type="hidden" name="vehicle" value={vehicleId} />
      <fieldset
        id={PLANS_ID}
        className={styles['choices']}
        aria-describedby={plansError === undefined ? undefined : `${PLANS_ID}-error`}
      >
        <legend className={styles['legend']}>{t('web.a11.plan.choose')}</legend>
        {plansError !== undefined && (
          <p id={`${PLANS_ID}-error`} className={styles['error']}>
            {plansError}
          </p>
        )}
        {plans.map((p) => (
          <label key={p.planCode} className={styles['choice']}>
            <input
              type="radio"
              name="planCode"
              value={p.planCode}
              defaultChecked={p.planCode === current}
            />
            <span>{p.label}</span>
          </label>
        ))}
      </fieldset>
      <p className={accountStyles['muted']}>{t('web.a11.plan.newTripsOnly')}</p>
      <Button type="submit" variant="secondary" block loading={pending} data-testid="a11-plan-save">
        {t('web.a11.plan.save')}
      </Button>
    </form>
  );
}
