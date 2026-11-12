'use client';
/**
 * Formulaires des documents d'un véhicule (US-124) : actions serveur, sans JavaScript requis
 * (`useActionState` ajoute seulement l'état « en cours » et les erreurs sans rechargement). Chaque
 * champ a son libellé visible ; une erreur est liée à son champ et reprise dans le récapitulatif
 * (10b UX-50) ; les messages viennent du catalogue `@rueda/i18n` (es, en, fr, pt).
 */
import { useActionState } from 'react';
import type { ReactNode } from 'react';
import { createTranslator, getProfile } from '@rueda/i18n';
import type { MessageKey, Translator } from '@rueda/i18n';
import { Banner, Button, Checkbox, ErrorSummary, TextField } from '@rueda/ui';
import { LOCALE_CONFIG } from '../../../../../../locale-config.ts';
import styles from '../../../host.module.css';
import { declareAction, submitEligibilityAction, uploadDocumentAction } from './actions.ts';
import type { DocumentsFormState } from './actions.ts';

const INITIAL: DocumentsFormState = { errors: [] };
type Action = (prev: DocumentsFormState, form: FormData) => Promise<DocumentsFormState>;

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

/** Déclarations : titulaire du titre, prenda, compteur. */
export function DeclarationForm(
  props: Ids & {
    readonly holder: 'HOST' | 'THIRD_PARTY' | null;
    readonly lien: boolean;
    readonly odometerKm: number | null;
    readonly ownershipAttested: boolean;
    readonly lienAttested: boolean;
    /** VIN déjà enregistré : le champ n'est pas proposé (il ne se change pas ici). */
    readonly hasVin: boolean;
  },
) {
  const formId = 'a10d-declare';
  const f = useForm(props.localeTag, declareAction, formId);
  const t = f.t;
  const holder = f.valueOf('titleHolder') ?? props.holder ?? '';
  const error = f.errorOf(`${formId}-holder`);
  return (
    <Frame {...f} formId={formId} label={t('web.vehicleDocs.declaration.title')}>
      <Hidden {...props} />
      <fieldset
        className={styles['choices']}
        aria-describedby={error === undefined ? undefined : `${formId}-holder-error`}
      >
        <legend className={styles['legend']}>{t('web.vehicleDocs.declaration.holder')}</legend>
        {(['HOST', 'THIRD_PARTY'] as const).map((h) => (
          <label key={h} className={styles['choice']} htmlFor={`${formId}-holder-${h}`}>
            <input
              id={`${formId}-holder-${h}`}
              type="radio"
              name="titleHolder"
              value={h}
              defaultChecked={holder === h}
            />
            <span>{t(`web.vehicleDocs.declaration.holder.${h}`)}</span>
          </label>
        ))}
        {error !== undefined && (
          <p id={`${formId}-holder-error`} className={styles['error']} role="alert">
            {error}
          </p>
        )}
      </fieldset>
      <Checkbox
        id={`${formId}-owner`}
        name="owner"
        label={t('web.vehicleDocs.declaration.owner')}
        aria-required="true"
        defaultChecked={(f.valueOf('owner') ?? (props.ownershipAttested ? 'on' : '')) === 'on'}
        error={f.errorOf(`${formId}-owner`)}
      />
      <Checkbox
        id={`${formId}-lien`}
        name="lien"
        label={t('web.vehicleDocs.declaration.lien')}
        defaultChecked={(f.valueOf('lien') ?? (props.lien ? 'on' : '')) === 'on'}
      />
      <Checkbox
        id={`${formId}-lienOk`}
        name="lienOk"
        label={t('web.vehicleDocs.declaration.lienOk')}
        defaultChecked={(f.valueOf('lienOk') ?? (props.lienAttested ? 'on' : '')) === 'on'}
      />
      {!props.hasVin && (
        <TextField
          i18n={f.i18n}
          id={`${formId}-vin`}
          name="vin"
          autoCapitalize="characters"
          maxLength={40}
          label={t('web.vehicleDocs.declaration.vin')}
          hint={t('web.vehicleDocs.declaration.vinHint')}
          defaultValue={f.valueOf('vin')}
          error={f.errorOf(`${formId}-vin`)}
        />
      )}
      <TextField
        i18n={f.i18n}
        id={`${formId}-km`}
        name="odometerKm"
        inputMode="numeric"
        label={t('web.vehicleDocs.declaration.odometer')}
        defaultValue={f.valueOf('odometerKm') ?? props.odometerKm?.toString() ?? ''}
        error={f.errorOf(`${formId}-km`)}
      />
      <Button type="submit" variant="secondary" block loading={f.pending}>
        {t('web.vehicleDocs.declaration.save')}
      </Button>
    </Frame>
  );
}

/** Dépôt d'une pièce : type, fin de validité, fichier (photo ou PDF). */
export function UploadForm(
  props: Ids & { readonly types: readonly string[]; readonly maxLabel: string },
) {
  const formId = 'a10d-upload';
  const f = useForm(props.localeTag, uploadDocumentAction, formId);
  const t = f.t;
  return (
    <Frame {...f} formId={formId} label={t('web.vehicleDocs.upload.title')}>
      <Hidden {...props} />
      <h3 className={styles['strong']}>{t('web.vehicleDocs.upload.title')}</h3>
      <div className={styles['field']}>
        <label className={styles['strong']} htmlFor={`${formId}-type`}>
          {t('web.vehicleDocs.upload.type')}
        </label>
        <select
          id={`${formId}-type`}
          name="type"
          className={styles['select']}
          defaultValue={f.valueOf('type') ?? props.types[0]}
        >
          {props.types.map((type) => (
            <option key={type} value={type}>
              {t(`web.vehicleDocs.type.${type}` as MessageKey)}
            </option>
          ))}
        </select>
      </div>
      <TextField
        i18n={f.i18n}
        id={`${formId}-until`}
        name="validUntil"
        type="date"
        label={t('web.vehicleDocs.upload.validUntil')}
        defaultValue={f.valueOf('validUntil')}
        error={f.errorOf(`${formId}-until`)}
      />
      <div className={styles['field']}>
        <label className={styles['strong']} htmlFor={`${formId}-file`}>
          {t('web.vehicleDocs.upload.file')}
        </label>
        <input
          id={`${formId}-file`}
          name="file"
          type="file"
          accept="image/jpeg,image/png,image/heic,application/pdf"
          className={styles['file']}
          aria-describedby={`${formId}-file-hint`}
        />
        <p id={`${formId}-file-hint`} className={styles['hint']}>
          {t('web.vehicleDocs.upload.max', { max: props.maxLabel })}
        </p>
        {f.errorOf(`${formId}-file`) !== undefined && (
          <p className={styles['error']} role="alert">
            {f.errorOf(`${formId}-file`)}
          </p>
        )}
      </div>
      <Button type="submit" block loading={f.pending}>
        {t('web.vehicleDocs.upload.send')}
      </Button>
    </Frame>
  );
}

/** Soumission du véhicule à la revue de l'ops. */
export function SubmitForm(props: Ids) {
  const formId = 'a10d-submit';
  const f = useForm(props.localeTag, submitEligibilityAction, formId);
  return (
    <Frame {...f} formId={formId} label={f.t('web.vehicleDocs.submit.title')}>
      <Hidden {...props} />
      <Button type="submit" block loading={f.pending}>
        {f.t('web.vehicleDocs.submit.send')}
      </Button>
    </Frame>
  );
}
