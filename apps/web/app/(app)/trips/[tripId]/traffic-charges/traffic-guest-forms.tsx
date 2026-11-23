'use client';
/**
 * Formulaires du voyageur sur une amende, un péage ou une fourrière refacturés (suite d'US-318,
 * 0181, ADR-201 ; 10b S12 `web.s12.accept` / `web.s12.contest`) :
 * - payer : accord écrit au bouton, total affiché (rendu par l'API) ;
 * - contester : motif (20 à 1 000 caractères) et photos du trip à cocher, facultatives.
 * Chaque refus est dit en clair et la saisie est gardée ; aucune heure n'est saisie. Sans
 * JavaScript : envoi natif.
 */
import { useActionState, useId } from 'react';
import { createTranslator, getProfile } from '@rueda/i18n';
import { Banner, Button, fieldIds } from '@rueda/ui';
import { SLOT_KEYS } from '../../../../../account/trip-incidental.ts';
import { slotGroupOf, TRAFFIC_DISPUTE_MAX } from '../../../../../account/trip-traffic.ts';
import type { TrafficGuestPhoto } from '../../../../../account/trip-traffic.ts';
import { LOCALE_CONFIG } from '../../../../../locale-config.ts';
import incidentalStyles from '../../../_incidental/incidental.module.css';
import hostStyles from '../../../host/host.module.css';
import { acceptTrafficAction, disputeTrafficAction } from './actions.ts';
import type { TrafficGuestFormState } from './actions.ts';

const INITIAL: TrafficGuestFormState = { key: null };

function useT(localeTag: string) {
  const i18n = createTranslator(getProfile(LOCALE_CONFIG, localeTag));
  return { i18n, t: i18n.t.bind(i18n) };
}

export function TrafficAcceptForm(p: {
  readonly localeTag: string;
  readonly tripId: string;
  readonly chargeId: string;
  /** Total refacturé, déjà rendu dans la langue de la vue. */
  readonly total: string;
  readonly brand: string;
}) {
  const { t } = useT(p.localeTag);
  const [state, action, pending] = useActionState(acceptTrafficAction, INITIAL);
  return (
    <form action={action} className={hostStyles['rows']} data-testid="traffic-accept-form">
      {state.key !== null && (
        <Banner tone="danger" live="assertive">
          <span data-testid="traffic-error">{t(state.key, { brand: p.brand })}</span>
        </Banner>
      )}
      <input type="hidden" name="trip" value={p.tripId} />
      <input type="hidden" name="charge" value={p.chargeId} />
      <p className={hostStyles['hint']}>{t('web.trafficGuest.payNotice', { brand: p.brand })}</p>
      <Button type="submit" block loading={pending} data-testid="traffic-accept">
        {t('web.s12.accept', { amount: p.total })}
      </Button>
    </form>
  );
}

export function TrafficDisputeForm(p: {
  readonly localeTag: string;
  readonly tripId: string;
  readonly chargeId: string;
  readonly photos: readonly TrafficGuestPhoto[];
  readonly brand: string;
}) {
  const { t } = useT(p.localeTag);
  const [state, action, pending] = useActionState(disputeTrafficAction, INITIAL);
  const id = useId().replaceAll(':', '');
  const reasonIds = fieldIds(`${id}-reason`);
  const hintId = `${id}-photos-hint`;
  return (
    <details className={incidentalStyles['dispute']} open={state.key !== null}>
      <summary className={incidentalStyles['summary']} data-testid="traffic-contest">
        {t('web.s12.contest')}
      </summary>
      <form
        action={action}
        className={hostStyles['rows']}
        noValidate
        data-testid="traffic-dispute-form"
      >
        {state.key !== null && (
          <Banner tone="danger" live="assertive">
            <span data-testid="traffic-error">{t(state.key, { brand: p.brand })}</span>
          </Banner>
        )}
        <input type="hidden" name="trip" value={p.tripId} />
        <input type="hidden" name="charge" value={p.chargeId} />
        <div className={hostStyles['field']}>
          <label className={incidentalStyles['label']} htmlFor={`${id}-reason`}>
            {t('web.trafficGuest.dispute.reason')}
          </label>
          <textarea
            id={`${id}-reason`}
            name="reason"
            className={incidentalStyles['textarea']}
            maxLength={TRAFFIC_DISPUTE_MAX}
            defaultValue={state.values?.['reason'] ?? ''}
            aria-invalid={state.field === 'reason' ? true : undefined}
            aria-describedby={reasonIds.hint}
            data-testid="traffic-reason"
          />
          <p id={reasonIds.hint} className={hostStyles['hint']}>
            {t('web.trafficGuest.dispute.reasonHint')}
          </p>
        </div>
        {p.photos.length > 0 && (
          <fieldset className={hostStyles['choices']} aria-describedby={hintId}>
            <legend className={hostStyles['legend']}>{t('web.trafficGuest.dispute.photos')}</legend>
            <p id={hintId} className={hostStyles['hint']}>
              {t('web.trafficGuest.dispute.photosHint')}
            </p>
            {p.photos.map((ph) => {
              const group = slotGroupOf(ph.slot);
              return (
                <label key={ph.fileId} className={hostStyles['choice']}>
                  <input
                    type="checkbox"
                    name="evidence"
                    value={ph.fileId}
                    data-testid={`traffic-photo-${ph.kind}-${ph.slot}-${ph.takenBy}`}
                  />
                  <span>
                    {t('web.incidental.photo', {
                      side: t(
                        ph.kind === 'CHECKIN'
                          ? 'web.incidental.side.CHECKIN'
                          : 'web.incidental.side.CHECKOUT',
                      ),
                      slot: t(group === null ? 'web.trafficGuest.slot.OTHER' : SLOT_KEYS[group]),
                      by: t(
                        ph.takenBy === 'HOST'
                          ? 'web.incidental.by.HOST'
                          : 'web.incidental.by.GUEST',
                      ),
                    })}
                  </span>
                </label>
              );
            })}
          </fieldset>
        )}
        <Button
          type="submit"
          variant="secondary"
          block
          loading={pending}
          data-testid="traffic-dispute-submit"
        >
          {t('web.trafficGuest.dispute.submit')}
        </Button>
      </form>
    </details>
  );
}
