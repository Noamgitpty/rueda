'use client';
/**
 * Déclaration d'une amende, d'un péage ou d'une fourrière par l'hôte (US-318 ; 19 US-318
 * critère 3 ; 08 BR-TT-02 à 04, BR-TT-05 ; 10b A09) : nature (liste fermée), date et heure du fait
 * dans le fuseau du trip, montant PAYÉ par l'hôte dans la langue de la vue, pièce photographiée
 * (photo de la série `traffic` non encore utilisée). Après l'envoi, montants RENDUS par l'API
 * (montant, frais de gestion, total refacturé au voyageur) : aucun calcul dans le client.
 */
import { useActionState } from 'react';
import { createTranslator, getProfile } from '@rueda/i18n';
import { Banner, Button, ErrorSummary, TextField } from '@rueda/ui';
import { TRAFFIC_KINDS } from '../../../../../../account/trip-claims.ts';
import { LOCALE_CONFIG } from '../../../../../../locale-config.ts';
import accountStyles from '../../../../_account/account.module.css';
import styles from '../../../../host/host.module.css';
import { declareTrafficChargeAction } from './actions.ts';
import type { TrafficState } from './actions.ts';
import {
  TRAFFIC_AMOUNT_ID,
  TRAFFIC_AT_ID,
  TRAFFIC_FILE_ID,
  TRAFFIC_FORM_ID,
  TRAFFIC_KIND_ID,
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
}

export function TrafficChargeForm(props: TrafficChargeFormProps) {
  const i18n = createTranslator(getProfile(LOCALE_CONFIG, props.localeTag));
  const t = i18n.t.bind(i18n);
  const [state, run, pending] = useActionState(declareTrafficChargeAction, INITIAL);
  const messages = state.errors.map((e) => ({ fieldId: e.fieldId, message: t(e.key, e.values) }));
  const errorOf = (id: string) => messages.find((m) => m.fieldId === id)?.message;
  const formError = errorOf(TRAFFIC_FORM_ID);
  const money = (minor: string) =>
    state.sent === undefined
      ? minor
      : i18n.money({
          amountMinor: BigInt(minor),
          currency: state.sent.currency,
          exponent: state.sent.exponent,
        });
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
            {t('web.traffic.sent.amount', { amount: money(state.sent.amountMinor) })}
          </p>
          <p className={accountStyles['text']}>
            {t('web.traffic.sent.fee', { amount: money(state.sent.adminFeeMinor) })}
          </p>
          <p className={styles['strong']} data-testid="a09-traffic-sent-total">
            {t('web.traffic.sent.total', { amount: money(state.sent.totalMinor) })}
          </p>
        </div>
      )}
      <ErrorSummary i18n={i18n} errors={messages.filter((m) => m.fieldId !== TRAFFIC_FORM_ID)} />
      {formError !== undefined && (
        <Banner tone="danger" live="assertive">
          <span data-testid="a09-traffic-error">{formError}</span>
        </Banner>
      )}
      <input type="hidden" name="trip" value={props.tripId} />
      <input type="hidden" name="org" value={props.org} />
      <input type="hidden" name="request" value={props.requestId} />
      {radios(
        TRAFFIC_KIND_ID,
        'kind',
        t('web.traffic.kind'),
        TRAFFIC_KINDS.map((k) => ({ value: k, label: t(`web.traffic.kind.${k}`) })),
      )}
      <TextField
        i18n={i18n}
        id={TRAFFIC_AT_ID}
        name="at"
        type="datetime-local"
        label={t('web.traffic.at')}
        hint={t('web.traffic.atHint')}
        error={errorOf(TRAFFIC_AT_ID)}
        defaultValue={state.values?.at}
        data-testid="a09-traffic-at-input"
      />
      <TextField
        i18n={i18n}
        id={TRAFFIC_AMOUNT_ID}
        name="amount"
        inputMode="decimal"
        autoComplete="off"
        label={t('web.traffic.amount')}
        hint={t('web.traffic.amountHint', { example: props.amountExample })}
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
      <Button type="submit" block loading={pending} data-testid="a09-traffic-submit">
        {t('web.traffic.submit')}
      </Button>
    </form>
  );
}
