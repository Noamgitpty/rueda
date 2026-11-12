'use client';
/**
 * Formulaires du calendrier d'un véhicule (A06, US-119) : actions serveur, sans JavaScript requis
 * (`useActionState` ajoute seulement l'état « en cours » et les erreurs sans rechargement). Chaque
 * champ a son libellé visible ; une erreur est liée à son champ et reprise dans le récapitulatif
 * (10b UX-50) ; les messages viennent du catalogue `@rueda/i18n` (es, en, fr, pt). Les heures
 * saisies sont des heures locales du véhicule.
 */
import { useActionState } from 'react';
import type { ReactNode } from 'react';
import { createTranslator, getProfile } from '@rueda/i18n';
import type { Translator } from '@rueda/i18n';
import { Banner, Button, ErrorSummary, TextField } from '@rueda/ui';
import { LOCALE_CONFIG } from '../../../../../locale-config.ts';
import styles from '../../host.module.css';
import { blockDaysAction, blockHoursAction, noticeAction, unblockAction } from './actions.ts';
import type { CalendarFormState } from './actions.ts';

const INITIAL: CalendarFormState = { errors: [] };
type Action = (prev: CalendarFormState, form: FormData) => Promise<CalendarFormState>;

function useForm(localeTag: string, action: Action, formId: string) {
  const i18n = createTranslator(getProfile(LOCALE_CONFIG, localeTag));
  const [state, run, pending] = useActionState(action, INITIAL);
  const messages = state.errors.map((e) => ({
    fieldId: e.fieldId,
    message: i18n.t(e.key, e.values),
  }));
  const formError = messages.find((m) => m.fieldId === formId)?.message;
  const errorOf = (id: string) => messages.find((m) => m.fieldId === id)?.message;
  const valueOf = (name: string): string | undefined => state.values?.[name];
  return { i18n, t: i18n.t.bind(i18n), run, pending, messages, formError, errorOf, valueOf };
}

function Frame({
  i18n,
  run,
  messages,
  formId,
  formError,
  label,
  children,
}: {
  readonly i18n: Translator;
  readonly run: (form: FormData) => void;
  readonly messages: { fieldId: string; message: string }[];
  readonly formId: string;
  readonly formError: string | undefined;
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <form id={formId} className={styles['actions']} action={run} noValidate aria-label={label}>
      <ErrorSummary i18n={i18n} errors={messages.filter((m) => m.fieldId !== formId)} />
      {formError !== undefined && (
        <Banner tone="danger" live="assertive">
          {formError}
        </Banner>
      )}
      {children}
    </form>
  );
}

interface Ids {
  readonly localeTag: string;
  readonly orgId: string;
  readonly vehicleId: string;
}

function Hidden({ orgId, vehicleId }: Ids) {
  return (
    <>
      <input type="hidden" name="org" value={orgId} />
      <input type="hidden" name="vehicle" value={vehicleId} />
    </>
  );
}

export function BlockDaysForm(props: Ids) {
  const f = useForm(props.localeTag, blockDaysAction, 'a06-days');
  const t = f.t;
  return (
    <Frame {...f} formId="a06-days" label={t('web.calendar.block.days')}>
      <h3 className={styles['strong']}>{t('web.calendar.block.days')}</h3>
      <Hidden {...props} />
      <TextField
        i18n={f.i18n}
        id="a06-days-from"
        name="from"
        type="date"
        label={t('web.calendar.block.from')}
        defaultValue={f.valueOf('from')}
        error={f.errorOf('a06-days-from')}
      />
      <TextField
        i18n={f.i18n}
        id="a06-days-to"
        name="to"
        type="date"
        label={t('web.calendar.block.to')}
        defaultValue={f.valueOf('to')}
        error={f.errorOf('a06-days-to')}
      />
      <Button type="submit" block loading={f.pending}>
        {t('web.calendar.block.submitDays')}
      </Button>
    </Frame>
  );
}

export function BlockHoursForm(props: Ids) {
  const f = useForm(props.localeTag, blockHoursAction, 'a06-hours');
  const t = f.t;
  return (
    <Frame {...f} formId="a06-hours" label={t('web.calendar.block.hours')}>
      <h3 className={styles['strong']}>{t('web.calendar.block.hours')}</h3>
      <Hidden {...props} />
      <TextField
        i18n={f.i18n}
        id="a06-hours-day"
        name="day"
        type="date"
        label={t('web.calendar.block.date')}
        defaultValue={f.valueOf('day')}
        error={f.errorOf('a06-hours-day')}
      />
      <TextField
        i18n={f.i18n}
        id="a06-hours-start"
        name="start"
        type="time"
        step={1800}
        label={t('web.calendar.block.start')}
        hint={t('web.calendar.block.hoursHint')}
        defaultValue={f.valueOf('start')}
        error={f.errorOf('a06-hours-start')}
      />
      <TextField
        i18n={f.i18n}
        id="a06-hours-end"
        name="end"
        type="time"
        step={1800}
        label={t('web.calendar.block.end')}
        defaultValue={f.valueOf('end')}
        error={f.errorOf('a06-hours-end')}
      />
      <Button type="submit" variant="secondary" block loading={f.pending}>
        {t('web.calendar.block.submitHours')}
      </Button>
    </Frame>
  );
}

export function UnblockForm(props: Ids & { readonly blockId: string; readonly label: string }) {
  const formId = `a06-block-${props.blockId}`;
  const f = useForm(props.localeTag, unblockAction, formId);
  return (
    <Frame {...f} formId={formId} label={props.label}>
      <Hidden {...props} />
      <input type="hidden" name="block" value={props.blockId} />
      <Button type="submit" variant="quiet" block loading={f.pending}>
        {f.t('web.calendar.remove')}
      </Button>
    </Frame>
  );
}

export function NoticeForm(
  props: Ids & {
    readonly locationId: string;
    /** Valeur de l'hôte ; `null` : défaut du pays. */
    readonly current: number | null;
    /** Choix proposés : minutes et libellé déjà traduit. */
    readonly options: readonly { readonly minutes: number; readonly label: string }[];
  },
) {
  const f = useForm(props.localeTag, noticeAction, 'a06-notice');
  const t = f.t;
  const selected =
    f.valueOf('minutes') ?? (props.current === null ? 'default' : String(props.current));
  const error = f.errorOf('a06-notice-minutes');
  return (
    <Frame {...f} formId="a06-notice" label={t('web.calendar.notice.title')}>
      <Hidden {...props} />
      <input type="hidden" name="location" value={props.locationId} />
      <div className={styles['field']}>
        <label className={styles['strong']} htmlFor="a06-notice-minutes">
          {t('web.calendar.notice.label')}
        </label>
        <select
          id="a06-notice-minutes"
          name="minutes"
          className={styles['select']}
          defaultValue={selected}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={error === undefined ? undefined : 'a06-notice-minutes-error'}
        >
          <option value="default">{t('web.calendar.notice.default')}</option>
          {props.options.map((o) => (
            <option key={o.minutes} value={String(o.minutes)}>
              {o.label}
            </option>
          ))}
        </select>
        {error !== undefined && (
          <p id="a06-notice-minutes-error" className={styles['error']}>
            {error}
          </p>
        )}
      </div>
      <Button type="submit" variant="secondary" block loading={f.pending}>
        {t('web.calendar.notice.save')}
      </Button>
    </Frame>
  );
}
