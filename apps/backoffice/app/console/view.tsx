/**
 * Écrans de la console interne (US-012 ; écran O01 de 10b, socle d'accès) : connexion, enrôlement
 * TOTP, code TOTP, refus, console (rôles et pays, action motivée, journal). US-101 : catalogue des
 * actions de console groupé (changer un état, enregistrer seulement avec pièces, décisions FINANCE à
 * deux personnes), pièces, et demandes FINANCE en attente à approuver par une seconde personne. US-109 :
 * files de revue, dossier KYC et fiche 360° (ops-view.tsx). Composant de
 * PRÉSENTATION pur : aucun appel réseau, aucun état (rendu testable dans chaque locale) ; la
 * logique est dans `console-client.tsx`. Composants de `@rueda/ui` seulement, mise en page par les
 * jetons de design (console.module.css) : aucun style en dur.
 */
import type { FormEvent } from 'react';
import type { MessageKey, Translator } from '@rueda/i18n';
import { Badge, Banner, Button, DataTable, EmptyState, ErrorState, TextField } from '@rueda/ui';
import styles from './console.module.css';
import { OpsPanels, SANCTIONS_LISTS } from './ops-view.tsx';
import type { OpsHandlers, OpsState, SanctionsList, SanctionsListResult } from './ops-view.tsx';

export interface StaffRoleView {
  readonly role: string;
  readonly countries: readonly string[];
}

export interface JournalEntryView {
  readonly id: string;
  readonly at: string;
  readonly actorRole: string;
  readonly actionCode: string;
  readonly subjectType: string;
  readonly subjectId: string;
}

/** Bloc de contenu publié à revoir (US-121, `GET /console/content/gaps`). */
export interface ContentGapView {
  readonly key: string;
  readonly country: string | null;
  readonly editable: boolean;
  readonly missing: readonly string[];
  readonly invalid: readonly string[];
}

/** Demande FINANCE en attente (GET /console/finance/approvals). */
export interface ApprovalView {
  readonly id: string;
  readonly action: string;
  readonly subjectId: string;
  readonly country: string;
  readonly reason: string;
  readonly requestedAt: string;
}

export type ConsoleState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'login'; readonly error?: MessageKey | undefined }
  | { readonly kind: 'totp'; readonly error?: MessageKey | undefined }
  | {
      readonly kind: 'enroll';
      readonly enrollmentCode?: string | undefined;
      readonly secret?: { readonly secret: string; readonly otpauthUri: string } | undefined;
      readonly error?: MessageKey | undefined;
    }
  | { readonly kind: 'denied'; readonly reason: 'NOT_STAFF' | 'TOTP_NOT_ENROLLED' | 'LOCKED' }
  | {
      readonly kind: 'console';
      readonly roles: readonly StaffRoleView[];
      readonly entries: readonly JournalEntryView[];
      /** La lecture du journal a échoué : distinct d'un journal vide (revue UX US-012). */
      readonly journalError?: boolean | undefined;
      /**
       * Blocs de contenu à revoir (US-121) : liste (vide = rien à signaler), `'error'` si la
       * lecture a échoué, absent si le rôle n'a pas `brand.edit`.
       */
      readonly contentGaps?: readonly ContentGapView[] | 'error' | undefined;
      /** Demandes FINANCE en attente (FINANCE et ADMIN seulement ; la base filtre, RLS-24). */
      readonly approvals?: readonly ApprovalView[] | undefined;
      readonly approvalsError?: boolean | undefined;
      readonly notice?:
        { readonly tone: 'success' | 'danger' | 'warning'; readonly key: MessageKey } | undefined;
    };

/**
 * Actions de console proposées, groupées comme 19 US-101 (catalogue de 17 §10 ; la base reste juge
 * de chaque droit et de la disponibilité de chaque commande de domaine).
 */
export const ACTION_GROUPS = {
  state: [
    'CANCEL_TRIP_GUEST',
    'CANCEL_TRIP_HOST',
    'CANCEL_TRIP_PLATFORM',
    'DECLARE_NO_SHOW',
    'REFUSE_AT_PICKUP',
    'KYC_DECISION',
    'HOST_VERIFICATION_DECISION',
    'PUBLISH_LISTING',
    'ESCALATE_OVERDUE',
    'REVIEW_FLAGGED_BOOKING',
    // US-107 : compte d'hôte d'une personne inscrite (sujet : son compte de personne)
    'CREATE_HOST_ACCOUNT',
  ],
  record: [
    'RECORD_CLAIM',
    'ISSUE_DECISION',
    'RECORD_CHARGEBACK',
    'OPEN_INCIDENT',
    'RECORD_REVIEW',
    'HANDLE_DSR',
  ],
  finance: ['ISSUE_BORDEREAU', 'DECIDE_ADVANCE', 'WRITE_OFF_RECEIVABLE'],
} as const;
export type ConsoleAction = (typeof ACTION_GROUPS)[keyof typeof ACTION_GROUPS][number];
export const CONSOLE_ACTIONS: readonly ConsoleAction[] = [
  ...ACTION_GROUPS.state,
  ...ACTION_GROUPS.record,
  ...ACTION_GROUPS.finance,
];

const GROUP_KEYS: Readonly<Record<keyof typeof ACTION_GROUPS, MessageKey>> = {
  state: 'backoffice.action.groupState',
  record: 'backoffice.action.groupRecord',
  finance: 'backoffice.action.groupFinance',
};

/** US-108 : rôles qui détiennent `ops.review_listing_host` (filtrage manuel ; la base reste juge). */
const SCREENING_ROLES = new Set(['OPS_AGENT', 'ADMIN']);
const SANCTIONS_LIST_KEYS: Readonly<Record<SanctionsList, MessageKey>> = {
  unList: 'backoffice.host.list.unList',
  ofacList: 'backoffice.host.list.ofacList',
  nationalList: 'backoffice.host.list.nationalList',
};

/** Rôles qui voient les demandes FINANCE en attente (17 §2.3 fin_read). */
const APPROVER_ROLES = new Set(['FINANCE', 'ADMIN']);
/** Rôles qui lisent les fiches 360° (16 ADM-005 : SUPPORT, OPS ; 17 §2.3 : ADMIN). */
export const PROFILE_ROLES = new Set(['SUPPORT_AGENT', 'OPS_AGENT', 'ADMIN']);

/** Identifiants des pièces saisis (virgules, espaces ou retours à la ligne), en minuscules. */
export function evidenceOf(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,;]+/)
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

export interface ConsoleHandlers {
  readonly onLogin: (email: string, password: string) => void;
  readonly onReveal: (enrollmentCode: string) => void;
  readonly onVerify: (code: string) => void;
  readonly onAction: (
    action: ConsoleAction,
    subjectId: string,
    reason: string,
    evidence: readonly string[],
  ) => void;
  /**
   * US-108 : filtrage manuel des sanctions (`HOST_SANCTIONS_SCREENING`) sur un compte d'hôte, saisie
   * fermée par liste ; le même formulaire existe dans le dossier ouvert depuis la file (O01).
   */
  readonly onHostScreening?: (
    orgId: string,
    results: Readonly<Record<SanctionsList, SanctionsListResult>>,
    reason: string,
    evidence: readonly string[],
  ) => void;
  readonly onApprove: (approvalId: string) => void;
  readonly onSignOut: () => void;
}

const ROLE_KEYS: Readonly<Record<string, MessageKey>> = {
  SUPPORT_AGENT: 'backoffice.role.SUPPORT_AGENT',
  OPS_AGENT: 'backoffice.role.OPS_AGENT',
  FINANCE: 'backoffice.role.FINANCE',
  ADMIN: 'backoffice.role.ADMIN',
  SUPERADMIN: 'backoffice.role.SUPERADMIN',
};

const ACTION_KEYS: Readonly<Record<ConsoleAction, MessageKey>> = {
  CANCEL_TRIP_GUEST: 'backoffice.action.CANCEL_TRIP_GUEST',
  CANCEL_TRIP_HOST: 'backoffice.action.CANCEL_TRIP_HOST',
  CANCEL_TRIP_PLATFORM: 'backoffice.action.CANCEL_TRIP_PLATFORM',
  DECLARE_NO_SHOW: 'backoffice.action.DECLARE_NO_SHOW',
  REFUSE_AT_PICKUP: 'backoffice.action.REFUSE_AT_PICKUP',
  KYC_DECISION: 'backoffice.action.KYC_DECISION',
  HOST_VERIFICATION_DECISION: 'backoffice.action.HOST_VERIFICATION_DECISION',
  PUBLISH_LISTING: 'backoffice.action.PUBLISH_LISTING',
  ESCALATE_OVERDUE: 'backoffice.action.ESCALATE_OVERDUE',
  REVIEW_FLAGGED_BOOKING: 'backoffice.action.REVIEW_FLAGGED_BOOKING',
  CREATE_HOST_ACCOUNT: 'backoffice.action.CREATE_HOST_ACCOUNT',
  RECORD_CLAIM: 'backoffice.action.RECORD_CLAIM',
  ISSUE_DECISION: 'backoffice.action.ISSUE_DECISION',
  RECORD_CHARGEBACK: 'backoffice.action.RECORD_CHARGEBACK',
  OPEN_INCIDENT: 'backoffice.action.OPEN_INCIDENT',
  RECORD_REVIEW: 'backoffice.action.RECORD_REVIEW',
  HANDLE_DSR: 'backoffice.action.HANDLE_DSR',
  ISSUE_BORDEREAU: 'backoffice.action.ISSUE_BORDEREAU',
  DECIDE_ADVANCE: 'backoffice.action.DECIDE_ADVANCE',
  WRITE_OFF_RECEIVABLE: 'backoffice.action.WRITE_OFF_RECEIVABLE',
};

function fieldOf(event: FormEvent<HTMLFormElement>, name: string): string {
  const value = new FormData(event.currentTarget).get(name);
  return typeof value === 'string' ? value : '';
}

function submitted(event: FormEvent<HTMLFormElement>): string {
  const submitter = (event.nativeEvent as SubmitEvent).submitter;
  return submitter instanceof HTMLButtonElement ? submitter.value : '';
}

const prevent =
  (fn: (event: FormEvent<HTMLFormElement>) => void) => (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    fn(event);
  };

/** Titre de chaque écran : le focus y est posé à l'arrivée (console-client.tsx). */
export const SCREEN_HEADINGS: Readonly<Record<ConsoleState['kind'], string | null>> = {
  loading: null,
  login: 'login-heading',
  totp: 'totp-heading',
  enroll: 'enroll-heading',
  denied: 'denied-heading',
  console: 'roles-heading',
};

export function ConsoleView({
  i18n,
  state,
  handlers,
  busy = false,
  ops,
}: {
  readonly i18n: Translator;
  readonly state: ConsoleState;
  readonly handlers: ConsoleHandlers;
  /** Envoi en cours : bouton en chargement, aucun second envoi (jamais `disabled`, UX-50). */
  readonly busy?: boolean;
  /** Files de revue et fiche 360° (US-109). */
  readonly ops?: { readonly state: OpsState; readonly handlers: OpsHandlers } | undefined;
}) {
  switch (state.kind) {
    case 'loading':
      return <p className={styles['muted']}>{i18n.t('common.ui.loading')}</p>;

    case 'login':
      return (
        <section className={styles['panel']} aria-labelledby="login-heading">
          <h2 id="login-heading" className={styles['heading']} tabIndex={-1}>
            {i18n.t('backoffice.login.heading')}
          </h2>
          {state.error && (
            <Banner tone="danger" live="assertive">
              {i18n.t(state.error)}
            </Banner>
          )}
          <form
            className={styles['form']}
            onSubmit={prevent((e) => handlers.onLogin(fieldOf(e, 'email'), fieldOf(e, 'password')))}
          >
            <TextField
              i18n={i18n}
              id="login-email"
              name="email"
              type="email"
              autoComplete="username"
              label={i18n.t('backoffice.login.email')}
            />
            <TextField
              i18n={i18n}
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              label={i18n.t('backoffice.login.password')}
            />
            <Button type="submit" block loading={busy}>
              {i18n.t('backoffice.login.submit')}
            </Button>
          </form>
        </section>
      );

    case 'totp':
      return (
        <section className={styles['panel']} aria-labelledby="totp-heading">
          <h2 id="totp-heading" className={styles['heading']} tabIndex={-1}>
            {i18n.t('backoffice.totp.heading')}
          </h2>
          <p className={styles['muted']}>{i18n.t('backoffice.totp.intro')}</p>
          {state.error && (
            <Banner tone="danger" live="assertive">
              {i18n.t(state.error)}
            </Banner>
          )}
          <form
            className={styles['form']}
            onSubmit={prevent((e) => handlers.onVerify(fieldOf(e, 'code')))}
          >
            <TextField
              i18n={i18n}
              id="totp-code"
              name="code"
              error={state.error ? i18n.t(state.error) : undefined}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]{6,7}"
              maxLength={7}
              label={i18n.t('backoffice.totp.code')}
            />
            <Button type="submit" block loading={busy}>
              {i18n.t('backoffice.totp.submit')}
            </Button>
          </form>
        </section>
      );

    case 'enroll':
      return (
        <section className={styles['panel']} aria-labelledby="enroll-heading">
          <h2 id="enroll-heading" className={styles['heading']} tabIndex={-1}>
            {i18n.t('backoffice.enroll.heading')}
          </h2>
          <p className={styles['muted']}>{i18n.t('backoffice.enroll.intro')}</p>
          {state.error && (
            <Banner tone="danger" live="assertive">
              {i18n.t(state.error)}
            </Banner>
          )}
          {state.secret === undefined ? (
            <form
              className={styles['form']}
              onSubmit={prevent((e) => handlers.onReveal(fieldOf(e, 'enrollmentCode')))}
            >
              <TextField
                i18n={i18n}
                id="enroll-code"
                name="enrollmentCode"
                autoComplete="off"
                spellCheck={false}
                label={i18n.t('backoffice.enroll.enrollmentCode')}
              />
              <Button type="submit" block loading={busy}>
                {i18n.t('backoffice.enroll.reveal')}
              </Button>
            </form>
          ) : (
            <form
              className={styles['form']}
              onSubmit={prevent((e) => handlers.onVerify(fieldOf(e, 'code')))}
            >
              <div className={styles['secret']}>
                <p className={styles['label']}>{i18n.t('backoffice.enroll.secret')}</p>
                <code className={styles['code']}>{state.secret.secret}</code>
                <a className={styles['link']} href={state.secret.otpauthUri}>
                  {i18n.t('backoffice.enroll.openApp')}
                </a>
              </div>
              <TextField
                i18n={i18n}
                id="enroll-totp"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                label={i18n.t('backoffice.totp.code')}
              />
              <Button type="submit" block loading={busy}>
                {i18n.t('backoffice.enroll.confirm')}
              </Button>
            </form>
          )}
        </section>
      );

    case 'denied':
      return (
        <section className={styles['panel']} aria-labelledby="denied-heading">
          <h2 id="denied-heading" className={styles['heading']} tabIndex={-1}>
            {i18n.t('backoffice.denied.heading')}
          </h2>
          <Banner tone={state.reason === 'LOCKED' ? 'warning' : 'danger'} live="polite">
            {i18n.t(
              state.reason === 'NOT_STAFF'
                ? 'backoffice.denied.notStaff'
                : state.reason === 'LOCKED'
                  ? 'common.auth.totpLocked'
                  : 'backoffice.denied.noTotp',
            )}
          </Banner>
          <Button variant="secondary" onClick={handlers.onSignOut}>
            {i18n.t('backoffice.console.signOut')}
          </Button>
        </section>
      );

    case 'console':
      return (
        <div className={styles['stack']}>
          <section className={styles['panel']} aria-labelledby="roles-heading">
            <h2 id="roles-heading" className={styles['heading']} tabIndex={-1}>
              {i18n.t('backoffice.console.roles')}
            </h2>
            <ul className={styles['roles']}>
              {state.roles.map((r) => (
                <li key={r.role} className={styles['role']}>
                  <Badge tone="neutral" icon={null}>
                    {ROLE_KEYS[r.role] ? i18n.t(ROLE_KEYS[r.role] as MessageKey) : r.role}
                  </Badge>
                  <span className={styles['muted']}>
                    {i18n.t('backoffice.console.countries', { countries: r.countries.join(', ') })}
                  </span>
                </li>
              ))}
            </ul>
            <Button variant="quiet" onClick={handlers.onSignOut}>
              {i18n.t('backoffice.console.signOut')}
            </Button>
          </section>

          {state.notice && (
            <Banner tone={state.notice.tone} live="polite">
              {i18n.t(state.notice.key)}
            </Banner>
          )}

          <ContentGaps i18n={i18n} gaps={state.contentGaps} />

          {ops !== undefined && (
            <OpsPanels
              i18n={i18n}
              state={ops.state}
              handlers={ops.handlers}
              busy={busy}
              showProfile={state.roles.some((r) => PROFILE_ROLES.has(r.role))}
            />
          )}

          <section className={styles['panel']} aria-labelledby="action-heading">
            <h2 id="action-heading" className={styles['heading']}>
              {i18n.t('backoffice.action.heading')}
            </h2>
            <form
              className={styles['form']}
              onSubmit={prevent((e) => {
                const action = submitted(e);
                if ((CONSOLE_ACTIONS as readonly string[]).includes(action)) {
                  handlers.onAction(
                    action as ConsoleAction,
                    fieldOf(e, 'subjectId'),
                    fieldOf(e, 'reason'),
                    evidenceOf(fieldOf(e, 'evidence')),
                  );
                }
              })}
            >
              <TextField
                i18n={i18n}
                id="action-subject"
                name="subjectId"
                autoComplete="off"
                spellCheck={false}
                label={i18n.t('backoffice.action.subject')}
              />
              <TextField
                i18n={i18n}
                id="action-reason"
                name="reason"
                minLength={10}
                maxLength={1000}
                label={i18n.t('backoffice.action.reason')}
                hint={i18n.t('backoffice.action.reasonHint')}
              />
              <TextField
                i18n={i18n}
                id="action-evidence"
                name="evidence"
                autoComplete="off"
                spellCheck={false}
                optional
                label={i18n.t('backoffice.action.evidence')}
                hint={i18n.t('backoffice.action.evidenceHint')}
              />
              <p className={styles['muted']}>{i18n.t('backoffice.action.amountNote')}</p>
              {(Object.keys(ACTION_GROUPS) as (keyof typeof ACTION_GROUPS)[]).map((group) => (
                <div
                  key={group}
                  role="group"
                  aria-labelledby={`action-group-${group}`}
                  className={styles['group']}
                >
                  <h3 id={`action-group-${group}`} className={styles['label']}>
                    {i18n.t(GROUP_KEYS[group])}
                  </h3>
                  <div className={styles['actions']}>
                    {ACTION_GROUPS[group].map((a) => (
                      <Button
                        key={a}
                        type="submit"
                        name="action"
                        value={a}
                        variant="secondary"
                        loading={busy}
                      >
                        {i18n.t(ACTION_KEYS[a])}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </form>
          </section>

          {handlers.onHostScreening !== undefined &&
            state.roles.some((r) => SCREENING_ROLES.has(r.role)) && (
              <section className={styles['panel']} aria-labelledby="screening-action-heading">
                <h2 id="screening-action-heading" className={styles['heading']}>
                  {i18n.t('backoffice.host.screeningHeading')}
                </h2>
                <p className={styles['muted']}>{i18n.t('backoffice.host.screeningHint')}</p>
                <form
                  className={styles['form']}
                  onSubmit={prevent((e) => {
                    const values = SANCTIONS_LISTS.map((l) => {
                      const v = new FormData(e.currentTarget).get(l);
                      return [l, v === 'CLEAR' || v === 'MATCH' ? v : null] as const;
                    });
                    if (values.every(([, r]) => r !== null)) {
                      handlers.onHostScreening?.(
                        fieldOf(e, 'orgId'),
                        Object.fromEntries(values) as Record<SanctionsList, SanctionsListResult>,
                        fieldOf(e, 'reason'),
                        evidenceOf(fieldOf(e, 'evidence')),
                      );
                    }
                  })}
                >
                  <TextField
                    i18n={i18n}
                    id="screening-org"
                    name="orgId"
                    autoComplete="off"
                    spellCheck={false}
                    label={i18n.t('backoffice.host.subject')}
                  />
                  {SANCTIONS_LISTS.map((list) => (
                    <fieldset key={list} className={styles['checks']}>
                      <legend className={styles['label']}>
                        {i18n.t(SANCTIONS_LIST_KEYS[list])}
                      </legend>
                      {(['CLEAR', 'MATCH'] as const).map((result) => (
                        <label key={result} className={styles['choice']}>
                          <input
                            type="radio"
                            name={list}
                            value={result}
                            required
                            className={styles['choiceInput']}
                          />
                          <span>
                            {i18n.t(
                              result === 'CLEAR'
                                ? 'backoffice.host.clear'
                                : 'backoffice.host.match',
                            )}
                          </span>
                        </label>
                      ))}
                    </fieldset>
                  ))}
                  <TextField
                    i18n={i18n}
                    id="screening-reason"
                    name="reason"
                    minLength={10}
                    maxLength={1000}
                    label={i18n.t('backoffice.action.reason')}
                    hint={i18n.t('backoffice.action.reasonHint')}
                  />
                  <TextField
                    i18n={i18n}
                    id="screening-evidence"
                    name="evidence"
                    autoComplete="off"
                    spellCheck={false}
                    optional
                    label={i18n.t('backoffice.action.evidence')}
                    hint={i18n.t('backoffice.action.evidenceHint')}
                  />
                  <div className={styles['actions']}>
                    <Button type="submit" variant="primary" loading={busy}>
                      {i18n.t('backoffice.host.record')}
                    </Button>
                  </div>
                </form>
              </section>
            )}

          {state.roles.some((r) => APPROVER_ROLES.has(r.role)) &&
            (state.approvalsError ? (
              <ErrorState
                i18n={i18n}
                title={i18n.t('backoffice.approvals.caption')}
                message={i18n.t('backoffice.approvals.error')}
                headingLevel={3}
              />
            ) : (
              <form
                className={styles['form']}
                onSubmit={prevent((e) => {
                  const id = submitted(e);
                  if (id !== '') handlers.onApprove(id);
                })}
              >
                <DataTable
                  id="approvals"
                  caption={i18n.t('backoffice.approvals.caption')}
                  columns={[
                    { key: 'request', header: i18n.t('backoffice.approvals.request') },
                    { key: 'country', header: i18n.t('backoffice.approvals.country') },
                    { key: 'reason', header: i18n.t('backoffice.approvals.reason') },
                    { key: 'when', header: i18n.t('backoffice.approvals.requestedAt') },
                    { key: 'approve', header: i18n.t('backoffice.approvals.approve') },
                  ]}
                  rows={(state.approvals ?? []).map((a) => ({
                    id: a.id,
                    cells: {
                      request: (
                        <span>
                          {(CONSOLE_ACTIONS as readonly string[]).includes(a.action)
                            ? i18n.t(ACTION_KEYS[a.action as ConsoleAction])
                            : a.action}{' '}
                          <code className={styles['code']}>{a.subjectId.slice(0, 8)}</code>
                        </span>
                      ),
                      country: a.country,
                      reason: a.reason,
                      when: `${i18n.dateTime(a.requestedAt, 'UTC')} UTC`,
                      approve: (
                        <Button
                          type="submit"
                          name="approval"
                          value={a.id}
                          variant="primary"
                          loading={busy}
                        >
                          {i18n.t('backoffice.approvals.approve')}
                        </Button>
                      ),
                    },
                  }))}
                  empty={
                    <EmptyState title={i18n.t('backoffice.approvals.empty')} headingLevel={3} />
                  }
                />
                <p className={styles['muted']}>{i18n.t('backoffice.approvals.hint')}</p>
              </form>
            ))}

          {state.journalError ? (
            <ErrorState
              i18n={i18n}
              title={i18n.t('backoffice.journal.caption')}
              message={i18n.t('backoffice.journal.error')}
              headingLevel={3}
            />
          ) : (
            <DataTable
              id="journal"
              caption={i18n.t('backoffice.journal.caption')}
              columns={[
                { key: 'when', header: i18n.t('backoffice.journal.when') },
                { key: 'who', header: i18n.t('backoffice.journal.who') },
                { key: 'action', header: i18n.t('backoffice.journal.action') },
                { key: 'subject', header: i18n.t('backoffice.journal.subject') },
              ]}
              rows={state.entries.map((e) => ({
                id: e.id,
                cells: {
                  when: `${i18n.dateTime(e.at, 'UTC')} UTC`,
                  who: ROLE_KEYS[e.actorRole]
                    ? i18n.t(ROLE_KEYS[e.actorRole] as MessageKey)
                    : e.actorRole,
                  action: <code className={styles['code']}>{e.actionCode}</code>,
                  subject: (
                    <code className={styles['code']}>
                      {e.subjectType} {e.subjectId.slice(0, 8)}
                    </code>
                  ),
                },
              }))}
              empty={<EmptyState title={i18n.t('backoffice.journal.empty')} headingLevel={3} />}
            />
          )}
          <p className={styles['muted']}>{i18n.t('backoffice.journal.scope')}</p>
        </div>
      );
  }
}

/**
 * Signalement des blocs de contenu à revoir (US-121 ; 17 §3.2.13 « locale manquante, signalée au
 * back-office ») : langue absente (le site montre alors le texte livré dans cette langue) ou
 * corps hors des règles. Rien à signaler : rien n'est affiché.
 */
function ContentGaps({
  i18n,
  gaps,
}: {
  readonly i18n: Translator;
  readonly gaps: readonly ContentGapView[] | 'error' | undefined;
}) {
  if (gaps === undefined || (gaps !== 'error' && gaps.length === 0)) return null;
  if (gaps === 'error') {
    return (
      <Banner tone="warning" live="polite">
        {i18n.t('backoffice.content.gaps.error')}
      </Banner>
    );
  }
  const scope = (g: ContentGapView): string =>
    g.country ?? i18n.t('backoffice.content.gaps.common');
  // langues nommées dans la langue de la vue (« inglés », « anglais »), jamais un code brut
  const names = new Intl.DisplayNames([i18n.profile.tag], { type: 'language' });
  const languages = (codes: readonly string[]): string =>
    codes.map((c) => names.of(c) ?? c).join(', ');
  const title = i18n.t('backoffice.content.gaps.title', { count: gaps.length });
  return (
    <section className={styles['panel']} aria-label={title}>
      <Banner tone="warning" title={title}>
        {i18n.t('backoffice.content.gaps.hint')}
      </Banner>
      <ul className={styles['roles']}>
        {gaps.flatMap((g) => [
          ...(g.missing.length > 0
            ? [
                <li key={`${g.key}:${g.country ?? ''}:m`} className={styles['muted']}>
                  {i18n.t('backoffice.content.gaps.missing', {
                    key: g.key,
                    scope: scope(g),
                    locales: languages(g.missing),
                  })}
                </li>,
              ]
            : []),
          ...(!g.editable
            ? [
                <li key={`${g.key}:${g.country ?? ''}:n`} className={styles['muted']}>
                  {i18n.t('backoffice.content.gaps.notEditable', { key: g.key, scope: scope(g) })}
                </li>,
              ]
            : g.invalid.length > 0
              ? [
                  <li key={`${g.key}:${g.country ?? ''}:i`} className={styles['muted']}>
                    {i18n.t('backoffice.content.gaps.invalid', {
                      key: g.key,
                      scope: scope(g),
                      locales: languages(g.invalid),
                    })}
                  </li>,
                ]
              : []),
        ])}
      </ul>
    </section>
  );
}
