import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { formatDate, getProfile } from '@rueda/i18n';
import { Banner, ButtonLink } from '@rueda/ui';
import { callApi } from '../../../account/api-client.ts';
import type { ApiResult } from '../../../account/api-client.ts';
import { clientContext, journeyCountry } from '../../../account/request.ts';
import { getRequestI18n, getRequestLocaleTag } from '../../../i18n.ts';
import { LOCALE_CONFIG } from '../../../locale-config.ts';
import styles from '../_account/account.module.css';
import { renderLegalText } from '../_account/legal-text.tsx';
import { MAIN_ID } from '../_shell/main-id.ts';
import { ConsentForm, StartForm, WithdrawForm } from './identity-forms.tsx';
import type { CountryOption } from './identity-forms.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.s04.title'), robots: { index: false, follow: false } };
}

interface IdentityStateView {
  readonly status: string;
  /** Motif du dossier (catégorie seulement, jamais le texte de l'ops ; US-106). */
  readonly reasonCode: string | null;
  readonly country: string | null;
  readonly licenseExpiresOn: string | null;
  readonly sessionLive: boolean;
  readonly phoneVerified: boolean;
  readonly available: boolean;
  readonly consent: {
    readonly version: number;
    readonly accepted: boolean;
    readonly locale: string;
    readonly title: string;
    readonly bodyMd: string;
  } | null;
  readonly countries: readonly {
    readonly code: string;
    readonly names: Readonly<Record<string, string>>;
  }[];
}

const STATUS = /^[A-Z_]{2,32}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** État `GET /identity` (lecture défensive : forme inattendue ⇒ `null`, l'écran le dit). */
function stateOf(reply: ApiResult): IdentityStateView | null {
  if (reply.status !== 200) return null;
  const j = reply.json as Record<string, unknown> | null;
  if (
    j === null ||
    typeof j['status'] !== 'string' ||
    !STATUS.test(j['status']) ||
    typeof j['available'] !== 'boolean' ||
    !Array.isArray(j['countries'])
  ) {
    return null;
  }
  const c = j['consent'] as Record<string, unknown> | null;
  const consent =
    c !== null &&
    typeof c === 'object' &&
    typeof c['version'] === 'number' &&
    Number.isSafeInteger(c['version']) &&
    typeof c['accepted'] === 'boolean' &&
    typeof c['locale'] === 'string' &&
    typeof c['title'] === 'string' &&
    typeof c['bodyMd'] === 'string'
      ? {
          version: c['version'],
          accepted: c['accepted'],
          locale: c['locale'],
          title: c['title'],
          bodyMd: c['bodyMd'],
        }
      : null;
  const countries = (j['countries'] as Record<string, unknown>[]).filter(
    (x) =>
      typeof x['code'] === 'string' &&
      /^[A-Z]{2}$/.test(x['code']) &&
      typeof x['names'] === 'object' &&
      x['names'] !== null,
  ) as unknown as IdentityStateView['countries'];
  const country = j['country'];
  const expires = j['licenseExpiresOn'];
  const reason = j['reasonCode'];
  return {
    status: j['status'],
    reasonCode: typeof reason === 'string' && STATUS.test(reason) ? reason : null,
    country: typeof country === 'string' && /^[A-Z]{2}$/.test(country) ? country : null,
    licenseExpiresOn: typeof expires === 'string' && DAY.test(expires) ? expires : null,
    sessionLive: j['sessionLive'] === true,
    phoneVerified: j['phoneVerified'] === true,
    available: j['available'],
    consent,
    countries,
  };
}

const REVIEW = new Set(['AUTO_CHECKS', 'MANUAL_REVIEW']);
/**
 * Conseil de reprise après une décision de l'ops « nouvelle pièce » (US-106), selon la catégorie du
 * motif ; tout autre motif : conseil général (jamais le détail d'un contrôle, BR-VERIF-03).
 */
const MORE_INFO_KEYS = {
  LIVENESS_FAILED: 'web.s04.moreInfo.LIVENESS_FAILED',
  ID_DOCUMENT_REFUSED: 'web.s04.moreInfo.ID_DOCUMENT_REFUSED',
  LICENSE_NOT_ACCEPTED: 'web.s04.moreInfo.LICENSE_NOT_ACCEPTED',
} as const;
const moreInfoKey = (reason: string | null) =>
  reason !== null && reason in MORE_INFO_KEYS
    ? MORE_INFO_KEYS[reason as keyof typeof MORE_INFO_KEYS]
    : 'web.s04.moreInfo.generic';
// RECHECK : après un retrait du consentement, la vérification se refait depuis l'étape 1
const OPEN = new Set([
  'NOT_STARTED',
  'PHONE_VERIFIED',
  'DOCS_SUBMITTED',
  'MORE_INFO_REQUIRED',
  'RECHECK',
]);

/**
 * S04 — vérification d'identité (US-105 ; 16 VER-001, VER-004 ; 10b S04, UX-37 ; maquette
 * US-033), en 4 étapes : (1) consentement biométrique séparé, texte versionné en vigueur, case
 * jamais pré-cochée ; (2) pays du permis ; (3) parcours HÉBERGÉ chez le fournisseur (aucune photo
 * ne passe par le site) ; (4) résultat (`web.s04.result.*`, revue annoncée). Sans session :
 * connexion. API injoignable ou KYC indisponible (production tant qu'OQ-MK-09 est ouverte) :
 * aucun formulaire de départ (fail-closed), un message dans la langue de la vue.
 */
export default async function VerifyIdentityPage({
  searchParams,
}: {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const [i18n, tag, query, ctx] = await Promise.all([
    getRequestI18n(),
    getRequestLocaleTag(),
    searchParams,
    clientContext(),
  ]);
  const t = i18n.t.bind(i18n);
  const wanted = journeyCountry(query['country'], tag);
  const reply = await callApi(
    'GET',
    `/identity${wanted !== null ? `?country=${wanted}` : ''}`,
    ctx,
  );
  if (reply.status === 401) redirect('/login');
  const state = stateOf(reply);
  const profile = getProfile(LOCALE_CONFIG, tag);
  const countries: CountryOption[] = (state?.countries ?? []).map((c) => ({
    code: c.code,
    label: c.names[profile.language] ?? c.code,
  }));
  const defaultCountry =
    countries.find((c) => c.code === (state?.country ?? wanted))?.code ?? countries[0]?.code ?? '';
  const progress = (step: number) => (
    <p className={styles['muted']}>{t('web.s04.progress', { step, total: 4 })}</p>
  );

  let body: ReactNode;
  if (state === null) {
    body = (
      <Banner tone="danger" live="polite">
        {t('common.kyc.providerUnavailable')}
      </Banner>
    );
  } else if (state.status === 'APPROVED') {
    body = (
      <>
        {progress(4)}
        <Banner tone="success" live="polite">
          {t('web.s04.result.verified')}
        </Banner>
        {state.licenseExpiresOn !== null && (
          <p className={styles['muted']}>
            {t('web.s04.licenseValid', {
              date: formatDate(`${state.licenseExpiresOn}T12:00:00Z`, 'UTC', profile),
            })}
          </p>
        )}
      </>
    );
  } else if (REVIEW.has(state.status)) {
    body = (
      <>
        {progress(4)}
        <Banner tone="info" live="polite">
          {t('common.kyc.inReview')}
        </Banner>
      </>
    );
  } else if (state.status === 'REJECTED') {
    // décision de l'ops (US-106) : refus annoncé, sans le détail des contrôles (BR-VERIF-03)
    body = (
      <>
        {progress(4)}
        <Banner tone="danger" live="polite">
          {t('web.s04.result.rejected')}
        </Banner>
        <p className={styles['muted']}>{t('web.s04.result.rejectedHelp')}</p>
      </>
    );
  } else if (!OPEN.has(state.status)) {
    body = (
      <Banner tone="danger" live="polite">
        {t('common.kyc.notEligible')}
      </Banner>
    );
  } else if (state.consent === null) {
    body = (
      <Banner tone="danger" live="polite">
        {t('common.kyc.consentUnavailable')}
      </Banner>
    );
  } else if (!state.consent.accepted) {
    body = (
      <>
        {progress(1)}
        <section className={styles['stack']} aria-labelledby="s04-consent-heading">
          <h2 id="s04-consent-heading" className={styles['h2']}>
            {t('web.s04.consent.heading')}
          </h2>
          <article className={styles['document']} lang={state.consent.locale}>
            <h3>{state.consent.title}</h3>
            {renderLegalText(state.consent.bodyMd)}
          </article>
          <ConsentForm localeTag={tag} version={state.consent.version} country={wanted} />
        </section>
      </>
    );
  } else {
    body = (
      <>
        {progress(state.sessionLive ? 3 : 2)}
        {state.status === 'MORE_INFO_REQUIRED' && (
          <>
            <Banner tone="warning" live="polite">
              {t('web.s04.result.retake')}
            </Banner>
            <p className={styles['muted']}>{t(moreInfoKey(state.reasonCode))}</p>
          </>
        )}
        <Banner tone="success">{t('web.s04.consent.given')}</Banner>
        {!state.phoneVerified ? (
          <>
            <Banner tone="warning" live="polite">
              {t('web.s04.phoneFirst')}
            </Banner>
            <ButtonLink variant="secondary" href="/verify-phone">
              {t('web.s04.phoneLink')}
            </ButtonLink>
          </>
        ) : state.available && countries.length > 0 ? (
          <StartForm
            localeTag={tag}
            countries={countries}
            defaultCountry={defaultCountry}
            resume={state.sessionLive}
          />
        ) : (
          <Banner tone="danger" live="polite">
            {t('common.kyc.providerUnavailable')}
          </Banner>
        )}
      </>
    );
  }
  // retrait du consentement proposé dans TOUS les états où il est donné (VER-004) : approuvé, en
  // revue, refusé compris, là même où des scores sont conservés
  const withdraw = state?.consent?.accepted === true ? <WithdrawForm localeTag={tag} /> : null;

  return (
    <main id={MAIN_ID} tabIndex={-1} className={styles['content']}>
      <header className={styles['stackTight']}>
        <h1 className={styles['h1']}>{t('web.s04.title')}</h1>
        <p className={styles['muted']}>{t('web.s04.intro')}</p>
      </header>
      {body}
      {withdraw}
    </main>
  );
}
