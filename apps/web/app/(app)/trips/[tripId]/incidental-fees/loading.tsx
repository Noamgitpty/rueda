import { LoadingState, Skeleton } from '@rueda/ui';
import { getRequestI18n } from '../../../../../i18n.ts';
import accountStyles from '../../../_account/account.module.css';
import { MAIN_ID } from '../../../_shell/main-id.ts';

/** S12 · frais annexes — état de chargement (squelettes des cartes ; annoncé poliment ; US-706). */
export default async function GuestIncidentalLoading() {
  const i18n = await getRequestI18n();
  return (
    <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']} aria-busy="true">
      <h1 className={accountStyles['h1']}>{i18n.t('web.incidental.title.GUEST')}</h1>
      <LoadingState i18n={i18n} label={i18n.t('web.host.loading')}>
        <Skeleton />
        <Skeleton />
      </LoadingState>
    </main>
  );
}
