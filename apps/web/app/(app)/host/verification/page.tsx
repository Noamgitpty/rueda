import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { Badge, Banner, ButtonLink, EmptyState, ErrorState } from '@rueda/ui';
import type { BadgeTone } from '@rueda/ui';
import type { MessageKey } from '@rueda/i18n';
import { callApi } from '../../../../account/api-client.ts';
import type { ApiResult } from '../../../../account/api-client.ts';
import { hostAccountsOf } from '../../../../account/host-listings.ts';
import { clientContext } from '../../../../account/request.ts';
import { getRequestBrand } from '../../../../brand-source.ts';
import { getRequestI18n, getRequestLocaleTag } from '../../../../i18n.ts';
import accountStyles from '../../_account/account.module.css';
import { MAIN_ID } from '../../_shell/main-id.ts';
import styles from '../host.module.css';
import { SubmitForm, TaxForm } from './verification-forms.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.a07.title'), robots: { index: false, follow: false } };
}

interface VerificationView {
  readonly country: string;
  readonly orgStatus: string;
  readonly verificationStatus: string | null;
  readonly missing: readonly string[];
  readonly kycApproved: boolean;
  readonly ageStatus: string;
  readonly taxSaved: boolean;
  readonly taxKind: string | null;
  readonly taxKinds: readonly string[];
  readonly termsAccepted: boolean;
  readonly screeningDone: boolean;
  readonly blockers: readonly string[];
}

const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const codes = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && CODE.test(x)) : [];

/** État `GET …/verification` (lecture défensive : forme inattendue ⇒ `null`, l'écran le dit). */
function viewOf(reply: ApiResult): VerificationView | null {
  if (reply.status !== 200) return null;
  const j = reply.json as Record<string, unknown> | null;
  if (
    j === null ||
    typeof j['country'] !== 'string' ||
    !/^[A-Z]{2}$/.test(j['country']) ||
    typeof j['orgStatus'] !== 'string' ||
    !CODE.test(j['orgStatus'])
  ) {
    return null;
  }
  const v = j['verificationStatus'];
  const kind = j['taxKind'];
  return {
    country: j['country'],
    orgStatus: j['orgStatus'],
    verificationStatus: typeof v === 'string' && CODE.test(v) ? v : null,
    missing: codes(j['missing']),
    kycApproved: j['kycApproved'] === true,
    ageStatus: typeof j['ageStatus'] === 'string' ? j['ageStatus'] : 'UNVERIFIED',
    taxSaved: j['taxSaved'] === true,
    taxKind: typeof kind === 'string' && CODE.test(kind) ? kind : null,
    taxKinds: codes(j['taxKinds']),
    termsAccepted: j['termsAccepted'] === true,
    screeningDone: j['screeningDone'] === true,
    blockers: codes(j['blockers']),
  };
}

/** Nom du pays dans la langue de la vue (`Intl.DisplayNames`), sinon son code. */
function countryName(tag: string, code: string): string {
  try {
    return new Intl.DisplayNames([tag], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

const STATUS_TONE: Readonly<Record<string, BadgeTone>> = {
  DOCS_PENDING: 'warning',
  IN_REVIEW: 'neutral',
  APPROVED: 'success',
  REJECTED: 'danger',
  BLOCKED: 'warning',
};
/** Tâche manquante du dossier → libellé de la tâche (10b UX-40). */
const MISSING_TASK: Readonly<Record<string, MessageKey>> = {
  HOST_KYC_REQUIRED: 'web.a07.task.identity',
  HOST_TAX_ID_REQUIRED: 'web.a07.task.tax',
  TERMS_REACCEPT_REQUIRED: 'web.a07.task.terms',
  HOST_SCREENING_MISSING: 'web.a07.task.screening',
};
const COUNTRY_CLOSED = new Set(['P2P_HOSTS_DISABLED', 'INSURER_CONTRACT_INACTIVE']);
const EDITABLE = new Set(['OPEN', 'DOCS_PENDING', 'IN_REVIEW']);

/**
 * A07 — « Deviens hôte » : liste de tâches de l'hôte (US-123 ; 16 HST-049 / FIN-008 ; 10b A07,
 * UX-40). Chaque tâche a un statut et, s'il y a lieu, une action : identité et permis (S04), âge,
 * numéro fiscal (formulaire), CGU de l'hôte (espace de l'hôte, US-126), contrôles de sécurité (faits
 * par Kmino à l'envoi), compte de versement revu par le prestataire de paiement. Le statut du
 * dossier et du compte d'hôte est dit honnêtement : pays pas encore ouvert ⇒
 * `web.a07.waitingCountry`, sans date promise (fail-closed). Aucune donnée personnelle affichée
 * (ni date de naissance ni numéro fiscal) ; un filtrage de sanctions n'est jamais nommé.
 */
export default async function HostVerificationPage({
  searchParams,
}: {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const [i18n, tag, query, ctx, brand] = await Promise.all([
    getRequestI18n(),
    getRequestLocaleTag(),
    searchParams,
    clientContext(),
    getRequestBrand(),
  ]);
  const t = i18n.t.bind(i18n);
  const shell = (body: ReactNode) => (
    <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']}>
      <header className={accountStyles['stackTight']}>
        <h1 className={accountStyles['h1']}>{t('web.a07.title')}</h1>
        <p className={accountStyles['muted']}>{t('web.a07.intro')}</p>
      </header>
      {body}
    </main>
  );
  const error = shell(
    <ErrorState
      i18n={i18n}
      message={t('web.a07.error')}
      action={<ButtonLink href="/host/verification">{t('web.a07.retry')}</ButtonLink>}
    />,
  );
  if (ctx.sessionToken === null) {
    return shell(
      <EmptyState
        icon="car"
        title={t('web.a07.loginRequired')}
        action={<ButtonLink href="/login">{t('web.a07.login')}</ButtonLink>}
      />,
    );
  }
  const session = await callApi('GET', '/auth/session', ctx);
  if (session.status === 401) redirect('/login');
  const accounts = hostAccountsOf(session);
  if (accounts === null) return error;
  if (accounts.length === 0) {
    return shell(
      <EmptyState
        icon="car"
        title={t('web.a07.noHostAccount')}
        action={<ButtonLink href="/host">{t('web.a07.openHost')}</ButtonLink>}
      />,
    );
  }
  const wanted = typeof query['org'] === 'string' ? query['org'] : undefined;
  const account = accounts.find((a) => a.orgId === wanted) ?? accounts[0];
  if (account === undefined) return error;
  const reply = await callApi('GET', `/host/accounts/${account.orgId}/verification`, ctx);
  if (reply.status === 401) redirect('/login');
  const v = viewOf(reply);
  if (v === null) return error;

  const status = v.verificationStatus;
  const editable = status === null || EDITABLE.has(status);
  const approved = status === 'APPROVED';
  const countryClosed = v.blockers.some((b) => COUNTRY_CLOSED.has(b));
  const badge = (done: boolean, waiting = false) => (
    <Badge tone={done ? 'success' : waiting ? 'neutral' : 'warning'}>
      {t(done ? 'web.a07.done' : waiting ? 'web.a07.waiting' : 'web.a07.todo')}
    </Badge>
  );
  const missingTasks = v.missing
    .map((m) => MISSING_TASK[m])
    .filter((k): k is MessageKey => k !== undefined)
    .map((k) => t(k));

  return shell(
    <>
      {/* état du compte d'hôte et du dossier, dit honnêtement (10b UX-40) */}
      {v.orgStatus === 'ACTIVE' ? (
        <Banner tone="success">{t('web.a07.active')}</Banner>
      ) : v.orgStatus === 'PENDING_ACTIVATION' ? (
        <Banner tone="info">
          {t('web.a07.pendingActivation')}{' '}
          {countryClosed &&
            t('web.a07.waitingCountry', {
              brand: brand.name,
              country: countryName(tag, v.country),
            })}
        </Banner>
      ) : (
        status !== null &&
        STATUS_TONE[status] !== undefined && (
          <Banner tone={STATUS_TONE[status] === 'neutral' ? 'info' : STATUS_TONE[status]}>
            {t(`web.a07.status.${status}` as MessageKey)}
            {status === 'DOCS_PENDING' && missingTasks.length > 0 && (
              <> {t('web.a07.missing', { tasks: missingTasks.join(', ') })}</>
            )}
          </Banner>
        )
      )}

      <section className={styles['section']} aria-labelledby="a07-tasks">
        <h2 id="a07-tasks" className={accountStyles['h2']}>
          {t('web.a07.tasksHeading')}
        </h2>
        <ul className={accountStyles['stack']}>
          <li className={accountStyles['stackTight']}>
            <p className={accountStyles['text']}>
              {badge(v.kycApproved)} {t('web.a07.task.identity')}
            </p>
            {!v.kycApproved && (
              <ButtonLink href="/verify-identity" variant="secondary">
                {t('web.a07.task.identityAction')}
              </ButtonLink>
            )}
          </li>
          <li className={accountStyles['stackTight']}>
            <p className={accountStyles['text']}>
              {badge(v.ageStatus === 'OK')} {t('web.a07.task.age')}
            </p>
            <p className={accountStyles['muted']}>{t('web.a07.task.ageHint')}</p>
          </li>
          <li className={accountStyles['stackTight']}>
            <p className={accountStyles['text']}>
              {badge(v.taxSaved)} {t('web.a07.task.tax')}
            </p>
            {v.taxSaved && v.taxKind !== null && (
              <p className={accountStyles['muted']}>
                {t('web.a07.tax.saved', { kind: v.taxKind })}
              </p>
            )}
            {editable && v.taxKinds.length > 0 && (
              <TaxForm localeTag={tag} orgId={account.orgId} kinds={v.taxKinds} />
            )}
          </li>
          <li className={accountStyles['stackTight']}>
            <p className={accountStyles['text']}>
              {badge(v.termsAccepted)} {t('web.a07.task.terms')}
            </p>
            {!v.termsAccepted && (
              <ButtonLink
                href={`/host?${new URLSearchParams({ org: account.orgId }).toString()}#a10-terms`}
                variant="secondary"
              >
                {t('web.a07.task.termsAction')}
              </ButtonLink>
            )}
          </li>
          <li className={accountStyles['stackTight']}>
            <p className={accountStyles['text']}>
              {badge(v.screeningDone, !v.screeningDone)} {t('web.a07.task.screening')}
            </p>
            <p className={accountStyles['muted']}>{t('web.a07.task.screeningHint')}</p>
          </li>
          <li className={accountStyles['stackTight']}>
            <p className={accountStyles['text']}>
              {badge(approved && !v.blockers.includes('SUBMERCHANT_NOT_ACTIVE'), true)}{' '}
              {t('web.a07.task.payments')}
            </p>
            <p className={accountStyles['muted']}>{t('web.a07.task.paymentsHint')}</p>
          </li>
        </ul>
      </section>

      {editable && <SubmitForm localeTag={tag} orgId={account.orgId} />}
      <p className={accountStyles['text']}>
        <a
          className={styles['link']}
          href={`/host?${new URLSearchParams({ org: account.orgId }).toString()}`}
        >
          {t('web.a07.back')}
        </a>
      </p>
    </>,
  );
}
