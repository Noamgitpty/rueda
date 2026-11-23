'use client';
/**
 * Déclaration d'une amende, d'un péage ou d'une fourrière par l'hôte (US-318 ; 19 US-318
 * critère 3 ; 08 BR-TT-02 à 04, BR-TT-05 ; 10b A09) : nature (liste fermée), date et heure du fait
 * dans le fuseau du trip, montant PAYÉ par l'hôte dans la langue de la vue, pièce photographiée
 * (photo de la série `traffic` non encore utilisée). Deux temps (revue ux n° 1) : « Revisar »
 * affiche le récapitulatif calculé par l'API (montant, frais de gestion, total refacturé au
 * voyageur, débit séparé sur sa carte après avis) ; « Confirmar » déclare, « Corregir » revient à
 * la saisie. Aucun montant calculé dans le client. Date dans l'ordre de la langue (revue ux n° 6).
 * Suite (0181, ADR-201) : référence de l'avis, du PV ou du reçu obligatoire ; plafond du pays dans
 * l'aide du montant ; récapitulatif avec la référence et le délai du voyageur (48 h, 08 BR-TT-02),
 * échéance du voyageur après la déclaration.
 */
import { useActionState } from 'react';
import { createTranslator, getProfile } from '@rueda/i18n';
import { Banner, Button, ErrorSummary, TextField } from '@rueda/ui';
import { TRAFFIC_KINDS, TRAFFIC_REFERENCE_MAX } from '../../../../../../account/trip-claims.ts';
import { LOCALE_CONFIG } from '../../../../../../locale-config.ts';
import accountStyles from '../../../../_account/account.module.css';
import styles from '../../../../host/host.module.css';
import { trafficChargeAction } from './actions.ts';
import type { TrafficState } from './actions.ts';
import {
  TRAFFIC_AMOUNT_ID,
  TRAFFIC_AT_ID,
  TRAFFIC_FILE_ID,
  TRAFFIC_FORM_ID,
  TRAFFIC_KIND_ID,
  TRAFFIC_REFERENCE_ID,
  TRAFFIC_TIME_ID,
} from './ids.ts';

const INITIAL: TrafficState = { errors: [] };

export interface TrafficChargeFormProps {
  readonly localeTag: string;
  readonly tripId: string;
  readonly org: string;
  readonly requestId: string;
  readonly timezone: string;
  /** Pièces disponibles (photos non encore utilisées), plus récente d'abord. */
  readonly evidence: readonly { readonly fileId: string; readonly receivedAt: string }[];
  /** Exemple de saisie du montant dans la langue de la vue (« 12,50 », « 150.000 »). */
  readonly amountExample: string;
  /** Format de la date dans l'ordre de la langue de la vue (« dd/mm/aaaa »). */
  readonly dateExample: string;
  /** Plafond du montant du pays, déjà rendu (« Plafond du pays : 500,00 $ US. ») ; `null` : inconnu. */
  readonly capHint: string | null;
  /** Nom de la marque (donnée de thème), pour le récapitulatif. */
  readonly brand: string;
}

export function TrafficChargeForm(props: TrafficChargeFormProps) {
  const i18n = createTranslator(getProfile(LOCALE_CONFIG, props.localeTag));
  const t = i18n.t.bind(i18n);
  const [state, run, pending] = useActionState(trafficChargeAction, INITIAL);
  const messages = state.errors.map((e) => ({ fieldId: e.fieldId, message: t(e.key, e.values) }));
  const errorOf = (id: string) => messages.find((m) => m.fieldId === id)?.message;
  const formError = errorOf(TRAFFIC_FORM_ID);
  const money = (minor: string, currency: string, exponent: number) =>
    i18n.money({ amountMinor: BigInt(minor), currency, exponent });
  const radios = (
    id: string,
    name: string,
    legend: string,
    items: readonly { value: string; label: string }[],
  ) => {
    const error = errorOf(id);
    return (
      <fieldset
        id={id}
        className={styles['choices']}
        aria-describedby={error === undefined ? undefined : `${id}-error`}
      >
        <legend className={styles['legend']}>{legend}</legend>
        {error !== undefined && (
          <p id={`${id}-error`} className={styles['error']}>
            {error}
          </p>
        )}
        {items.map((it, i) => (
          <label key={it.value} className={styles['choice']}>
            <input
              type="radio"
              name={name}
              value={it.value}
              defaultChecked={
                state.values === undefined
                  ? name === 'file' && i === 0
                  : (name === 'file' ? state.values.file : state.values.kind) === it.value
              }
              data-testid={`${id}-${i}`}
            />
            <span>{it.label}</span>
          </label>
        ))}
      </fieldset>
    );
  };
  const hidden = (
    <>
      <input type="hidden" name="trip" value={props.tripId} />
      <input type="hidden" name="org" value={props.org} />
      <input type="hidden" name="request" value={props.requestId} />
    </>
  );
  const p = state.preview;
  if (p !== undefined && state.values !== undefined) {
    const v = state.values;
    return (
      <form
        id={TRAFFIC_FORM_ID}
        className={styles['actions']}
        action={run}
        noValidate
        aria-labelledby="a09-traffic-review-title"
        data-testid="a09-traffic-review"
      >
        <h2 id="a09-traffic-review-title" className={accountStyles['h2']}>
          {t('web.traffic.review.title')}
        </h2>
        {hidden}
        <input type="hidden" name="kind" value={v.kind} />
        <input type="hidden" name="reference" value={v.reference} />
        <input type="hidden" name="date" value={v.date} />
        <input type="hidden" name="time" value={v.time} />
        <input type="hidden" name="amount" value={v.amount} />
        <input type="hidden" name="file" value={v.file} />
        <div className={styles['card']}>
          <p className={accountStyles['text']}>
            {t('web.traffic.review.kind', { kind: t(`web.traffic.kind.${p.kind}`) })}
          </p>
          <p className={accountStyles['text']} data-testid="a09-traffic-review-reference">
            {t('web.traffic.review.reference', { reference: p.reference })}
          </p>
          <p className={accountStyles['text']}>
            {t('web.traffic.review.at', { time: i18n.dateTime(p.occurredAt, props.timezone) })}
          </p>
          <p className={accountStyles['text']} data-testid="a09-traffic-review-amount">
            {t('web.traffic.sent.amount', { amount: money(p.amountMinor, p.currency, p.exponent) })}
          </p>
          <p className={accountStyles['text']} data-testid="a09-traffic-review-fee">
            {t('web.traffic.sent.fee', { amount: money(p.adminFeeMinor, p.currency, p.exponent) })}
          </p>
          <p className={styles['strong']} data-testid="a09-traffic-review-total">
            {t('web.traffic.review.total', { amount: money(p.totalMinor, p.currency, p.exponent) })}
          </p>
          <p className={accountStyles['muted']}>{t('web.traffic.review.card')}</p>
          <p className={accountStyles['muted']} data-testid="a09-traffic-review-response">
            {t('web.traffic.review.response', {
              n: String(p.responseHours),
              brand: props.brand,
            })}
          </p>
        </div>
        {formError !== undefined && (
          <Banner tone="danger" live="assertive">
            <span data-testid="a09-traffic-error">{formError}</span>
          </Banner>
        )}
        <Button
          type="submit"
          name="intent"
          value="confirm"
          block
          loading={pending}
          data-testid="a09-traffic-confirm"
        >
          {t('web.traffic.review.confirm')}
        </Button>
        <Button
          type="submit"
          name="intent"
          value="correct"
          variant="secondary"
          block
          disabled={pending}
          data-testid="a09-traffic-correct"
        >
          {t('web.traffic.review.correct')}
        </Button>
      </form>
    );
  }
  return (
    <form
      id={TRAFFIC_FORM_ID}
      className={styles['actions']}
      action={run}
      noValidate
      aria-labelledby="a09-traffic-title"
    >
      <h2 id="a09-traffic-title" className={accountStyles['h2']}>
        {t('web.traffic.form.title')}
      </h2>
      {state.sent !== undefined && (
        <div className={styles['card']} data-testid="a09-traffic-sent">
          <Banner tone="success" live="polite">
            {t('web.traffic.sent')}
          </Banner>
          <p className={accountStyles['text']}>
            {t('web.traffic.sent.amount', {
              amount: money(state.sent.amountMinor, state.sent.currency, state.sent.exponent),
            })}
          </p>
          <p className={accountStyles['text']}>
            {t('web.traffic.sent.fee', {
              amount: money(state.sent.adminFeeMinor, state.sent.currency, state.sent.exponent),
            })}
          </p>
          <p className={styles['strong']} data-testid="a09-traffic-sent-total">
            {t('web.traffic.sent.total', {
              amount: money(state.sent.totalMinor, state.sent.currency, state.sent.exponent),
            })}
          </p>
          <p className={accountStyles['text']} data-testid="a09-traffic-sent-due">
            {t('web.traffic.sent.due', {
              time: i18n.dateTime(state.sent.responseDueAt, props.timezone),
            })}
          </p>
        </div>
      )}
      <ErrorSummary i18n={i18n} errors={messages.filter((m) => m.fieldId !== TRAFFIC_FORM_ID)} />
      {formError !== undefined && (
        <Banner tone="danger" live="assertive">
          <span data-testid="a09-traffic-error">{formError}</span>
        </Banner>
      )}
      {hidden}
      {radios(
        TRAFFIC_KIND_ID,
        'kind',
        t('web.traffic.kind'),
        TRAFFIC_KINDS.map((k) => ({ value: k, label: t(`web.traffic.kind.${k}`) })),
      )}
      <TextField
        i18n={i18n}
        id={TRAFFIC_REFERENCE_ID}
        name="reference"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={TRAFFIC_REFERENCE_MAX}
        label={t('web.traffic.reference')}
        hint={t('web.traffic.referenceHint')}
        error={errorOf(TRAFFIC_REFERENCE_ID)}
        defaultValue={state.values?.reference}
        data-testid="a09-traffic-reference-input"
      />
      <TextField
        i18n={i18n}
        id={TRAFFIC_AT_ID}
        name="date"
        inputMode="numeric"
        autoComplete="off"
        label={t('web.traffic.date')}
        hint={t('web.traffic.dateHint', { example: props.dateExample })}
        error={errorOf(TRAFFIC_AT_ID)}
        defaultValue={state.values?.date}
        data-testid="a09-traffic-date-input"
      />
      <TextField
        i18n={i18n}
        id={TRAFFIC_TIME_ID}
        name="time"
        inputMode="numeric"
        autoComplete="off"
        label={t('web.traffic.time')}
        hint={t('web.traffic.timeHint')}
        error={errorOf(TRAFFIC_TIME_ID)}
        defaultValue={state.values?.time}
        data-testid="a09-traffic-time-input"
      />
      <TextField
        i18n={i18n}
        id={TRAFFIC_AMOUNT_ID}
        name="amount"
        inputMode="decimal"
        autoComplete="off"
        label={t('web.traffic.amount')}
        hint={[t('web.traffic.amountHint', { example: props.amountExample }), props.capHint]
          .filter((h): h is string => h !== null)
          .join(' ')}
        error={errorOf(TRAFFIC_AMOUNT_ID)}
        defaultValue={state.values?.amount}
        data-testid="a09-traffic-amount-input"
      />
      {props.evidence.length === 0 ? (
        <p
          id={TRAFFIC_FILE_ID}
          className={errorOf(TRAFFIC_FILE_ID) === undefined ? styles['hint'] : styles['error']}
          data-testid="a09-traffic-no-file"
        >
          {errorOf(TRAFFIC_FILE_ID) ?? t('web.traffic.fileNone')}
        </p>
      ) : (
        radios(
          TRAFFIC_FILE_ID,
          'file',
          t('web.traffic.file'),
          props.evidence.map((e) => ({
            value: e.fileId,
            label: t('web.traffic.fileItem', {
              time: i18n.dateTime(e.receivedAt, props.timezone),
            }),
          })),
        )
      )}
      <p className={accountStyles['muted']}>{t('web.traffic.notTransferred')}</p>
      <p className={accountStyles['muted']}>{t('web.traffic.noParking')}</p>
      <Button
        type="submit"
        name="intent"
        value="review"
        block
        loading={pending}
        data-testid="a09-traffic-submit"
      >
        {t('web.traffic.review.submit')}
      </Button>
    </form>
  );
}
