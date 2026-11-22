'use client';
/**
 * Formulaires des frais annexes (US-706 ; 16 CLM-021 ; 10b A04 `web.a04.addFee`, S12
 * `web.s12.accept` / `web.s12.contest`) :
 * - hôte : type de la liste fermée, montant dans la langue de la vue, motif, photos du trip
 *   (cases à cocher, au moins une ; sans photo, aucune demande) ;
 * - voyageur : payer (accord écrit au bouton, montant affiché) ou contester avec un motif et des
 *   photos du trip ;
 * - hôte : annuler une demande en attente ou contestée.
 * L'identifiant de la demande est fixé au rendu (clé d'idempotence). Chaque refus est dit en clair
 * et la saisie est gardée ; aucune heure n'est saisie. Sans JavaScript : envoi natif.
 */
import { useActionState, useId } from 'react';
import { createTranslator, getProfile } from '@rueda/i18n';
import { Banner, Button, fieldIds, TextField } from '@rueda/ui';
import type { FeeType } from '../../../account/trip-incidental.ts';
import { FEE_KEYS, SLOT_KEYS } from '../../../account/trip-incidental.ts';
import type { IncidentalPhoto } from '../../../account/trip-incidental.ts';
import { LOCALE_CONFIG } from '../../../locale-config.ts';
import hostStyles from '../host/host.module.css';
import {
  acceptIncidentalAction,
  cancelIncidentalAction,
  disputeIncidentalAction,
  submitIncidentalAction,
} from './actions.ts';
import type { IncidentalFormState } from './actions.ts';
import styles from './incidental.module.css';

const INITIAL: IncidentalFormState = { key: null };

function useT(localeTag: string) {
  const i18n = createTranslator(getProfile(LOCALE_CONFIG, localeTag));
  return { i18n, t: i18n.t.bind(i18n) };
}

/** Cases des photos du trip (départ, retour ; emplacement ; auteur), au moins une. */
function PhotoChoices(p: {
  readonly localeTag: string;
  readonly photos: readonly IncidentalPhoto[];
  readonly legend: string;
  readonly hint: string;
  readonly prefix: string;
}) {
  const { t } = useT(p.localeTag);
  const hintId = `${p.prefix}-photos-hint`;
  return (
    <fieldset className={hostStyles['choices']} aria-describedby={hintId}>
      <legend className={hostStyles['legend']}>{p.legend}</legend>
      <p id={hintId} className={hostStyles['hint']}>
        {p.hint}
      </p>
      {p.photos.map((ph) => (
        <label key={ph.fileId} className={hostStyles['choice']}>
          <input
            type="checkbox"
            name="evidence"
            value={ph.fileId}
            data-testid={`incidental-photo-${ph.kind}-${ph.slotCode}-${ph.takenBy}`}
          />
          <span>
            {t('web.incidental.photo', {
              side: t(
                ph.kind === 'CHECKIN'
                  ? 'web.incidental.side.CHECKIN'
                  : 'web.incidental.side.CHECKOUT',
              ),
              slot: t(SLOT_KEYS[ph.slotGroup]),
              by: t(ph.takenBy === 'HOST' ? 'web.incidental.by.HOST' : 'web.incidental.by.GUEST'),
            })}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function IncidentalFeeForm(p: {
  readonly localeTag: string;
  readonly tripId: string;
  readonly org: string | null;
  readonly requestId: string;
  readonly currency: string;
  readonly exponent: number;
  readonly example: string;
  readonly feeTypes: readonly FeeType[];
  /** Plafond du pays par type, déjà rendu (revue ux n° 3). */
  readonly caps: readonly string[];
  readonly photos: readonly IncidentalPhoto[];
}) {
  const { i18n, t } = useT(p.localeTag);
  const [state, action, pending] = useActionState(submitIncidentalAction, INITIAL);
  const id = useId().replaceAll(':', '');
  const descIds = fieldIds(`${id}-description`);
  const v = state.values ?? {};
  return (
    <form action={action} className={hostStyles['rows']} noValidate data-testid="incidental-form">
      {state.key !== null && (
        <Banner tone="danger" live="assertive">
          {t(state.key, { example: v['example'] ?? p.example })}
        </Banner>
      )}
      <input type="hidden" name="trip" value={p.tripId} />
      <input type="hidden" name="requestId" value={p.requestId} />
      <input type="hidden" name="org" value={p.org ?? ''} />
      <input type="hidden" name="exponent" value={String(p.exponent)} />
      <div className={hostStyles['field']}>
        <label className={styles['label']} htmlFor={`${id}-type`}>
          {t('web.incidental.form.type')}
        </label>
        <select
          id={`${id}-type`}
          name="feeType"
          className={hostStyles['select']}
          defaultValue={v['feeType'] ?? p.feeTypes[0]}
          data-testid="incidental-type"
        >
          {p.feeTypes.map((f) => (
            <option key={f} value={f}>
              {t(FEE_KEYS[f])}
            </option>
          ))}
        </select>
      </div>
      <TextField
        i18n={i18n}
        id={`${id}-amount`}
        name="amount"
        label={t('web.incidental.form.amount', { currency: p.currency })}
        hint={[t('web.incidental.form.amountHint', { example: p.example }), ...p.caps].join(' ')}
        inputMode={p.exponent === 0 ? 'numeric' : 'decimal'}
        autoComplete="off"
        maxLength={24}
        defaultValue={v['amount'] ?? ''}
        error={
          state.field === 'amount'
            ? t('web.incidental.form.amountInvalid', { example: p.example })
            : undefined
        }
        data-testid="incidental-amount"
      />
      <div className={hostStyles['field']}>
        <label className={styles['label']} htmlFor={`${id}-description`}>
          {t('web.incidental.form.description')}
        </label>
        <textarea
          id={`${id}-description`}
          name="description"
          className={styles['textarea']}
          maxLength={500}
          defaultValue={v['description'] ?? ''}
          aria-invalid={state.field === 'description' ? true : undefined}
          aria-describedby={descIds.hint}
          data-testid="incidental-description"
        />
        <p id={descIds.hint} className={hostStyles['hint']}>
          {t('web.incidental.form.descriptionHint')}
        </p>
      </div>
      <PhotoChoices
        localeTag={p.localeTag}
        photos={p.photos}
        legend={t('web.incidental.form.photos')}
        hint={t('web.incidental.form.photosHint')}
        prefix={id}
      />
      <Button type="submit" block loading={pending} data-testid="incidental-submit">
        {t('web.incidental.form.submit')}
      </Button>
    </form>
  );
}

export function IncidentalAcceptForm(p: {
  readonly localeTag: string;
  readonly tripId: string;
  readonly invoiceId: string;
  readonly amount: string;
}) {
  const { t } = useT(p.localeTag);
  const [state, action, pending] = useActionState(acceptIncidentalAction, INITIAL);
  return (
    <form action={action} className={hostStyles['rows']} data-testid="incidental-accept-form">
      {state.key !== null && (
        <Banner tone="danger" live="assertive">
          {t(state.key)}
        </Banner>
      )}
      <input type="hidden" name="trip" value={p.tripId} />
      <input type="hidden" name="invoice" value={p.invoiceId} />
      <p className={hostStyles['hint']}>{t('web.incidental.payNotice')}</p>
      <Button type="submit" block loading={pending} data-testid="incidental-accept">
        {t('web.s12.accept', { amount: p.amount })}
      </Button>
    </form>
  );
}

export function IncidentalDisputeForm(p: {
  readonly localeTag: string;
  readonly tripId: string;
  readonly invoiceId: string;
  readonly photos: readonly IncidentalPhoto[];
}) {
  const { t } = useT(p.localeTag);
  const [state, action, pending] = useActionState(disputeIncidentalAction, INITIAL);
  const id = useId().replaceAll(':', '');
  const reasonIds = fieldIds(`${id}-reason`);
  return (
    <details className={styles['dispute']} open={state.key !== null}>
      <summary className={styles['summary']} data-testid="incidental-contest">
        {t('web.s12.contest')}
      </summary>
      <form
        action={action}
        className={hostStyles['rows']}
        noValidate
        data-testid="incidental-dispute-form"
      >
        {state.key !== null && (
          <Banner tone="danger" live="assertive">
            {t(state.key)}
          </Banner>
        )}
        <input type="hidden" name="trip" value={p.tripId} />
        <input type="hidden" name="invoice" value={p.invoiceId} />
        <div className={hostStyles['field']}>
          <label className={styles['label']} htmlFor={`${id}-reason`}>
            {t('web.incidental.dispute.reason')}
          </label>
          <textarea
            id={`${id}-reason`}
            name="reason"
            className={styles['textarea']}
            maxLength={1000}
            defaultValue={state.values?.['reason'] ?? ''}
            aria-invalid={state.field === 'reason' ? true : undefined}
            aria-describedby={reasonIds.hint}
            data-testid="incidental-reason"
          />
          <p id={reasonIds.hint} className={hostStyles['hint']}>
            {t('web.incidental.dispute.reasonHint')}
          </p>
        </div>
        <PhotoChoices
          localeTag={p.localeTag}
          photos={p.photos}
          legend={t('web.incidental.dispute.photos')}
          hint={t('web.incidental.form.photosHint')}
          prefix={id}
        />
        <Button
          type="submit"
          variant="secondary"
          block
          loading={pending}
          data-testid="incidental-dispute-submit"
        >
          {t('web.incidental.dispute.submit')}
        </Button>
      </form>
    </details>
  );
}

export function IncidentalCancelForm(p: {
  readonly localeTag: string;
  readonly tripId: string;
  readonly invoiceId: string;
  readonly org: string | null;
}) {
  const { t } = useT(p.localeTag);
  const [state, action, pending] = useActionState(cancelIncidentalAction, INITIAL);
  return (
    <form action={action} data-testid="incidental-cancel-form">
      {state.key !== null && (
        <Banner tone="danger" live="assertive">
          {t(state.key)}
        </Banner>
      )}
      <input type="hidden" name="trip" value={p.tripId} />
      <input type="hidden" name="invoice" value={p.invoiceId} />
      <input type="hidden" name="org" value={p.org ?? ''} />
      <Button type="submit" variant="secondary" loading={pending} data-testid="incidental-cancel">
        {t('web.incidental.cancel')}
      </Button>
    </form>
  );
}
