'use client';
/**
 * Formulaire du no-show (US-307 ; 16 TRP-015) : déclaration définitive de l'absence de l'autre
 * partie, confirmée par une case explicite ; l'identifiant de la demande est fixé au rendu (clé
 * d'idempotence). Chaque refus de l'API est dit en clair ; aucune heure n'est saisie.
 */
import { useActionState } from 'react';
import { createTranslator, getProfile } from '@rueda/i18n';
import { Banner, Button, Checkbox } from '@rueda/ui';
import type { NoShowRole } from '../../../account/trip-no-show.ts';
import { LOCALE_CONFIG } from '../../../locale-config.ts';
import styles from '../host/host.module.css';
import { reportNoShowAction } from './actions.ts';
import type { NoShowFormState } from './actions.ts';

const INITIAL: NoShowFormState = { key: null };

export function NoShowForm(p: {
  readonly localeTag: string;
  readonly tripId: string;
  readonly role: NoShowRole;
  readonly org: string | null;
  readonly requestId: string;
}) {
  const i18n = createTranslator(getProfile(LOCALE_CONFIG, p.localeTag));
  const t = i18n.t.bind(i18n);
  const [state, action, pending] = useActionState(reportNoShowAction, INITIAL);
  return (
    <form action={action} className={styles['rows']} noValidate data-testid="no-show-form">
      {state.key !== null && (
        <Banner tone="danger" live="assertive">
          {t(state.key)}
        </Banner>
      )}
      <input type="hidden" name="trip" value={p.tripId} />
      <input type="hidden" name="requestId" value={p.requestId} />
      <input type="hidden" name="role" value={p.role === 'HOST' ? 'host' : 'guest'} />
      <input type="hidden" name="org" value={p.org ?? ''} />
      <Checkbox id="no-show-confirm" name="confirm" value="yes" label={t('web.noShow.final')} />
      <Button type="submit" block loading={pending} data-testid="no-show-submit">
        {t(p.role === 'HOST' ? 'web.noShow.declare.HOST' : 'web.noShow.declare.GUEST')}
      </Button>
    </form>
  );
}
