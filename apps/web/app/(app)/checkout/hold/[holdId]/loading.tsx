import { LoadingState, Skeleton } from '@rueda/ui';
import { getRequestI18n } from '../../../../../i18n.ts';
import accountStyles from '../../../_account/account.module.css';
import { MAIN_ID } from '../../../_shell/main-id.ts';

/** S05 — état de chargement de la confirmation du hold (annoncé poliment). */
export default async function HoldLoading() {
  const i18n = await getRequestI18n();
  return (
    <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']} aria-busy="true">
      <LoadingState i18n={i18n} label={i18n.t('web.s05.loading')}>
        <Skeleton />
        <Skeleton />
      </LoadingState>
    </main>
  );
}
