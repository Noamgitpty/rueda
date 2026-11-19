import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { Badge, Banner, ButtonLink, EmptyState, ErrorState } from '@rueda/ui';
import type { BadgeTone } from '@rueda/ui';
import type { MessageKey } from '@rueda/i18n';
import { callApi, codeOf } from '../../../../account/api-client.ts';
import type { ApiResult } from '../../../../account/api-client.ts';
import { hostAccountsOf } from '../../../../account/host-listings.ts';
import { clientContext } from '../../../../account/request.ts';
import { getRequestI18n, getRequestLocaleTag } from '../../../../i18n.ts';
import accountStyles from '../../_account/account.module.css';
import { MAIN_ID } from '../../_shell/main-id.ts';
import styles from '../host.module.css';
import { PayoutForm } from './payout-forms.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.a07.payout.title'), robots: { index: false, follow: false } };
}

/** Types de compte connus de l'écran (les autres sont ignorés : aucun libellé à montrer). */
const KINDS = ['BANK_ACCOUNT', 'WALLET'] as const;
type Kind = (typeof KINDS)[number];
const isKind = (v: unknown): v is Kind =>
  typeof v === 'string' && (KINDS as readonly string[]).includes(v);
const STATUSES = ['PENDING', 'VERIFIED', 'REJECTED'] as const;
type Status = (typeof STATUSES)[number];
const REJECT_REASONS = ['HOLDER_MISMATCH', 'TAX_ID_MISMATCH', 'ACCOUNT_INVALID'] as const;
type RejectReason = (typeof REJECT_REASONS)[number];
const CODE = /^[A-Z0-9][A-Z0-9_]{0,63}$/;

interface Rail {
  readonly kind: Kind;
  readonly institutions: readonly string[] | null;
}
interface AccountView {
  readonly status: Status;
  readonly kind: Kind | null;
  readonly institution: string | null;
  readonly last4: string | null;
  readonly holdUntil: Date | null;
  readonly rejectReason: RejectReason | null;
}
interface PayoutView {
  readonly country: string;
  readonly rails: readonly Rail[];
  readonly taxKind: string | null;
  readonly account: AccountView | null;
}

/** État `GET …/payout-account` (lecture défensive : forme inattendue ⇒ `null`, l'écran le dit). */
function viewOf(reply: ApiResult): PayoutView | null {
  if (reply.status !== 200) return null;
  const j = reply.json as Record<string, unknown> | null;
  if (
    j === null ||
    typeof j['country'] !== 'string' ||
    !/^[A-Z]{2}$/.test(j['country']) ||
    !Array.isArray(j['rails'])
  ) {
    return null;
  }
  const rails: Rail[] = [];
  for (const r of j['rails'] as unknown[]) {
    const o = r as Record<string, unknown> | null;
    if (o === null || typeof o !== 'object' || !isKind(o['kind'])) continue;
    const list = o['institutions'];
    const institutions = Array.isArray(list)
      ? list.filter((x): x is string => typeof x === 'string' && CODE.test(x))
      : null;
    if (institutions !== null && institutions.length === 0) continue;
    rails.push({ kind: o['kind'], institutions });
  }
  const tax = j['taxKind'];
  const a = j['account'] as Record<string, unknown> | null | undefined;
  let account: AccountView | null = null;
  if (a !== null && a !== undefined && typeof a === 'object') {
    const status = a['status'];
    if (typeof status !== 'string' || !(STATUSES as readonly string[]).includes(status))
      return null;
    const hold = typeof a['holdUntil'] === 'string' ? new Date(a['holdUntil']) : null;
    const reason = a['rejectReason'];
    account = {
      status: status as Status,
      kind: isKind(a['kind']) ? a['kind'] : null,
      institution:
        typeof a['institution'] === 'string' && CODE.test(a['institution'])
          ? a['institution']
          : null,
      last4:
        typeof a['last4'] === 'string' && /^[0-9A-Z]{2,4}$/.test(a['last4']) ? a['last4'] : null,
      holdUntil: hold !== null && !Number.isNaN(hold.getTime()) ? hold : null,
      rejectReason:
        typeof reason === 'string' && (REJECT_REASONS as readonly string[]).includes(reason)
          ? (reason as RejectReason)
          : null,
    };
  }
  return {
    country: j['country'],
    rails,
    taxKind: typeof tax === 'string' && CODE.test(tax) ? tax : null,
    account,
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

/** « 21 de noviembre, 10:30 UTC » : fin de la retenue (instant de l'API, affiché en UTC). */
function holdLabel(tag: string, at: Date): string {
  try {
    return new Intl.DateTimeFormat(tag, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
      timeZoneName: 'short',
    }).format(at);
  } catch {
    return at.toISOString();
  }
}

const STATUS_TONE: Readonly<Record<Status, BadgeTone>> = {
  VERIFIED: 'success',
  PENDING: 'neutral',
  REJECTED: 'danger',
};

/**
 * Compte de versement de l'hôte (US-707 ; 16 PYO-001 ; 08 BR-PAYOUT-01 ; 10b A07 / UX-40, UX-43).
 * Un compte bancaire ou un portefeuille AU NOM de l'hôte, vérifié par le prestataire de paiement :
 * compte courant MASQUÉ (4 derniers chiffres, établissement, statut, motif d'un refus), retenue
 * des versements de 48 h après un changement dite avec sa date (UX-43, délai de prise d'effet),
 * formulaire du type choisi (liens `?kind=`, sans JavaScript). Numéro fiscal absent ⇒ lien vers
 * A07 ; pays sans rail ⇒ dit honnêtement, sans promesse de date (fail-closed). Seul le titulaire
 * gère ce compte : un co-hôte reçoit 403 de l'API et le message correspondant. Aucun numéro
 * complet n'est jamais affiché.
 */
export default async function HostPayoutAccountPage({
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
  const shell = (body: ReactNode) => (
    <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']}>
      <header className={accountStyles['stackTight']}>
        <h1 className={accountStyles['h1']}>{t('web.a07.payout.title')}</h1>
        <p className={accountStyles['muted']}>{t('web.a07.payout.intro')}</p>
      </header>
      {body}
    </main>
  );
  const retry = (org: string | null) =>
    org === null
      ? '/host/payout-account'
      : `/host/payout-account?${new URLSearchParams({ org }).toString()}`;
  const error = (org: string | null, message: string = t('web.a07.payout.error')) =>
    shell(
      <ErrorState
        i18n={i18n}
        message={message}
        action={<ButtonLink href={retry(org)}>{t('web.a07.retry')}</ButtonLink>}
      />,
    );
  if (ctx.sessionToken === null) {
    return shell(
      <EmptyState
        icon="car"
        title={t('web.a07.payout.loginRequired')}
        action={<ButtonLink href="/login">{t('web.a07.login')}</ButtonLink>}
      />,
    );
  }
  const session = await callApi('GET', '/auth/session', ctx);
  if (session.status === 401) redirect('/login');
  const accounts = hostAccountsOf(session);
  if (accounts === null) return error(null);
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
  const host = accounts.find((a) => a.orgId === wanted) ?? accounts[0];
  if (host === undefined) return error(null);
  const org = host.orgId;
  const reply = await callApi('GET', `/host/accounts/${org}/payout-account`, ctx);
  if (reply.status === 401) redirect('/login');
  const backLink = (
    <p className={accountStyles['text']}>
      <a
        className={styles['link']}
        href={`/host/verification?${new URLSearchParams({ org }).toString()}`}
      >
        {t('web.a07.payout.back')}
      </a>
    </p>
  );
  if (reply.status === 403 && codeOf(reply) === 'PAYOUT_MANAGE_FORBIDDEN') {
    // co-hôte : seul le titulaire voit et change le compte de versement (16 PYO-001)
    return shell(
      <>
        <Banner tone="warning" live="polite">
          {t('common.payoutAccount.manageForbidden')}
        </Banner>
        {backLink}
      </>,
    );
  }
  const v = viewOf(reply);
  if (v === null) return error(org);

  const account = v.account;
  const holdUntil =
    account?.holdUntil != null && account.holdUntil.getTime() > Date.now()
      ? account.holdUntil
      : null;
  const wantedKind = typeof query['kind'] === 'string' ? query['kind'] : undefined;
  const rail = v.rails.find((r) => r.kind === wantedKind) ?? v.rails[0];
  const kindHref = (kind: Kind) =>
    `/host/payout-account?${new URLSearchParams({ org, kind }).toString()}#a07p-form`;

  return shell(
    <>
      {holdUntil !== null && (
        <Banner tone="warning" live="polite">
          {t('web.a07.payout.hold', { date: holdLabel(tag, holdUntil) })}
        </Banner>
      )}

      {account !== null && (
        <section className={styles['section']} aria-labelledby="a07p-current">
          <h2 id="a07p-current" className={accountStyles['h2']}>
            {t('web.a07.payout.currentHeading')}
          </h2>
          <div className={styles['card']}>
            <p className={accountStyles['text']}>
              <Badge tone={STATUS_TONE[account.status]}>
                {t(`web.a07.payout.status.${account.status}` as MessageKey)}
              </Badge>{' '}
              {account.kind !== null && t(`web.a07.payout.kind.${account.kind}` as MessageKey)}
            </p>
            {account.last4 !== null && (
              <p className={accountStyles['text']} id="a07p-masked">
                {t('web.a07.payout.masked', { last4: account.last4 })}
              </p>
            )}
            {account.institution !== null && (
              <p className={accountStyles['muted']}>
                {t('web.a07.payout.institutionOf', { institution: account.institution })}
              </p>
            )}
            {account.status === 'PENDING' && (
              <p className={accountStyles['muted']}>{t('web.a07.payout.pendingHint')}</p>
            )}
            {account.status === 'REJECTED' && account.rejectReason !== null && (
              <p className={accountStyles['muted']}>
                {t(`web.a07.payout.reject.${account.rejectReason}` as MessageKey)}
              </p>
            )}
          </div>
        </section>
      )}

      {v.rails.length === 0 || rail === undefined ? (
        <Banner tone="info" live="polite">
          {t('web.a07.payout.railsClosed', { country: countryName(tag, v.country) })}
        </Banner>
      ) : v.taxKind === null ? (
        <section className={styles['section']} aria-labelledby="a07p-tax-first">
          <p id="a07p-tax-first" className={accountStyles['text']}>
            {t('web.a07.payout.taxFirst')}
          </p>
          <ButtonLink
            href={`/host/verification?${new URLSearchParams({ org }).toString()}#a07-tax-form`}
            variant="secondary"
          >
            {t('web.a07.payout.taxAction')}
          </ButtonLink>
        </section>
      ) : (
        <section className={styles['section']}>
          {v.rails.length > 1 && (
            <nav aria-label={t('web.a07.payout.kindLabel')}>
              <ul className={accountStyles['stackTight']}>
                {v.rails.map((r) => (
                  <li key={r.kind}>
                    <a
                      className={styles['link']}
                      href={kindHref(r.kind)}
                      aria-current={r.kind === rail.kind ? 'page' : undefined}
                    >
                      {t(`web.a07.payout.kind.${r.kind}` as MessageKey)}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}
          <PayoutForm
            key={rail.kind}
            localeTag={tag}
            orgId={org}
            kind={rail.kind}
            institutions={rail.institutions}
            taxKind={v.taxKind}
            change={account !== null}
          />
        </section>
      )}
      {backLink}
    </>,
  );
}
