'use client';
/**
 * Formulaires de la remise et du retour (US-315 ; 10b UX-41, UX-42, A03, A04, S09) : arrivée
 * (« Ya llegué »), contrôle du permis physique en 6 points ou refus motivé (hôte, départ),
 * relevés et validation de sa part. Chaque refus de l'API est dit en clair ; aucune heure n'est
 * saisie ni envoyée (l'heure serveur fait foi). Aucune option de remise sans rencontre.
 */
import { useActionState } from 'react';
import { createTranslator, getProfile } from '@rueda/i18n';
import type { MessageKey } from '@rueda/i18n';
import { Banner, Button, Checkbox, TextField } from '@rueda/ui';
import { CHECKLIST, FUEL_MAX_EIGHTHS, SUBREASONS } from '../../../account/trip-handover.ts';
import type { HandoverDirection, HandoverRole } from '../../../account/trip-handover.ts';
import { LOCALE_CONFIG } from '../../../locale-config.ts';
import accountStyles from '../_account/account.module.css';
import styles from '../host/host.module.css';
import { identityCheckAction, openHandoverAction, validateHandoverAction } from './actions.ts';
import type { HandoverFormState } from './actions.ts';

const INITIAL: HandoverFormState = { key: null };

interface Common {
  readonly localeTag: string;
  readonly tripId: string;
  readonly direction: HandoverDirection;
  readonly role: HandoverRole;
  readonly org: string | null;
}

function translator(localeTag: string) {
  const i18n = createTranslator(getProfile(LOCALE_CONFIG, localeTag));
  return i18n.t.bind(i18n);
}

function Hidden(p: Common) {
  return (
    <>
      <input type="hidden" name="trip" value={p.tripId} />
      <input type="hidden" name="direction" value={p.direction} />
      <input type="hidden" name="role" value={p.role} />
      <input type="hidden" name="org" value={p.org ?? ''} />
    </>
  );
}

function Refusal({ k, t }: { k: MessageKey | null; t: ReturnType<typeof translator> }) {
  return k === null ? null : (
    <Banner tone="danger" live="assertive">
      {t(k)}
    </Banner>
  );
}

/** Étape 1 : « Ya llegué » ; désactivé tant que la remise ne peut pas s'ouvrir. */
export function OpenForm(p: Common & { readonly disabled: boolean }) {
  const t = translator(p.localeTag);
  const [state, action, pending] = useActionState(openHandoverAction, INITIAL);
  return (
    <form action={action} className={styles['actions']} noValidate>
      <Refusal k={state.key} t={t} />
      <Hidden {...p} />
      <Button
        type="submit"
        block
        loading={pending}
        disabled={p.disabled}
        data-testid="handover-arrived"
      >
        {t('web.a03.arrived')}
      </Button>
    </form>
  );
}

/** Étape 2 (hôte, départ) : 6 points vérifiables, confirmer ou ne pas remettre la voiture. */
export function IdentityForm(p: Common) {
  const t = translator(p.localeTag);
  const [state, action, pending] = useActionState(identityCheckAction, INITIAL);
  return (
    <form action={action} className={styles['rows']} noValidate data-testid="handover-identity">
      <Refusal k={state.key} t={t} />
      <Hidden {...p} />
      <fieldset className={styles['choices']}>
        <legend className={styles['legend']}>{t('web.handover.license.points')}</legend>
        {CHECKLIST.map((point) => (
          <Checkbox
            key={point}
            id={`handover-check-${point}`}
            name="check"
            value={point}
            label={t(`web.a03.check.${point}`)}
          />
        ))}
      </fieldset>
      <div className={styles['actions']}>
        <Button
          type="submit"
          name="intent"
          value="confirm"
          block
          loading={pending}
          data-testid="handover-identity-confirm"
        >
          {t('web.handover.license.confirm')}
        </Button>
      </div>
      <div className={styles['field']}>
        <label className={styles['strong']} htmlFor="handover-subreason">
          {t('web.handover.refuse.reason')}
        </label>
        <select id="handover-subreason" name="subreason" className={styles['select']}>
          {SUBREASONS.map((r) => (
            <option key={r} value={r}>
              {t(`web.handover.refuse.${r}`)}
            </option>
          ))}
        </select>
        <p className={styles['hint']}>{t('web.handover.refuse.hint')}</p>
      </div>
      <div className={styles['actions']}>
        <Button
          type="submit"
          name="intent"
          value="refuse"
          variant="secondary"
          block
          disabled={pending}
          data-testid="handover-refuse"
        >
          {t('web.a03.refuse')}
        </Button>
      </div>
    </form>
  );
}

const VALIDATE_LABEL: Readonly<Record<HandoverRole, Record<HandoverDirection, MessageKey>>> = {
  HOST: { checkin: 'web.a03.handover', checkout: 'web.handover.validate.HOST.checkout' },
  GUEST: {
    checkin: 'web.handover.validate.GUEST.checkin',
    checkout: 'web.handover.validate.GUEST.checkout',
  },
};

/** Étape finale : compteur et carburant de sa part, puis validation (heure serveur). */
export function ValidateForm(p: Common) {
  const t = translator(p.localeTag);
  const [state, action, pending] = useActionState(validateHandoverAction, INITIAL);
  return (
    <form action={action} className={styles['rows']} noValidate data-testid="handover-validate">
      <Refusal k={state.key} t={t} />
      <Hidden {...p} />
      <TextField
        i18n={createTranslator(getProfile(LOCALE_CONFIG, p.localeTag))}
        id="handover-odometer"
        name="odometerKm"
        label={t('web.handover.odometer')}
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={7}
        autoComplete="off"
      />
      <div className={styles['field']}>
        <label className={styles['strong']} htmlFor="handover-fuel">
          {t('web.handover.fuel')}
        </label>
        <select
          id="handover-fuel"
          name="fuelEighths"
          className={styles['select']}
          defaultValue={String(FUEL_MAX_EIGHTHS)}
        >
          {Array.from({ length: FUEL_MAX_EIGHTHS + 1 }, (_, n) => (
            <option key={n} value={String(n)}>
              {`${n}/${FUEL_MAX_EIGHTHS}`}
            </option>
          ))}
        </select>
      </div>
      <p className={accountStyles['muted']}>{t('web.handover.validate.hint')}</p>
      <div className={styles['actions']}>
        <Button type="submit" block loading={pending} data-testid="handover-validate-submit">
          {t(VALIDATE_LABEL[p.role][p.direction])}
        </Button>
      </div>
    </form>
  );
}
