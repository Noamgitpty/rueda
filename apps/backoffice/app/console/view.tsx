/**
 * Écrans de la console interne (US-012 ; écran O01 de 10b, socle d'accès) : connexion, enrôlement
 * TOTP, code TOTP, refus, console (rôles et pays, action motivée, journal). Composant de
 * PRÉSENTATION pur : aucun appel réseau, aucun état (rendu testable dans chaque locale) ; la
 * logique est dans `console-client.tsx`. Composants de `@rueda/ui` seulement, mise en page par les
 * jetons de design (console.module.css) : aucun style en dur.
 */
import type { FormEvent } from 'react';
import type { MessageKey, Translator } from '@rueda/i18n';
import { Badge, Banner, Button, DataTable, EmptyState, TextField } from '@rueda/ui';
import styles from './console.module.css';

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
      readonly notice?:
        { readonly tone: 'success' | 'danger' | 'warning'; readonly key: MessageKey } | undefined;
    };

/** Actions de console proposées (catalogue de 17 §10 ; la base reste juge de chaque droit). */
export const CONSOLE_ACTIONS = ['RECORD_CLAIM', 'CANCEL_TRIP_PLATFORM', 'DECLARE_NO_SHOW'] as const;
export type ConsoleAction = (typeof CONSOLE_ACTIONS)[number];

export interface ConsoleHandlers {
  readonly onLogin: (email: string, password: string) => void;
  readonly onReveal: (enrollmentCode: string) => void;
  readonly onVerify: (code: string) => void;
  readonly onAction: (action: ConsoleAction, subjectId: string, reason: string) => void;
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
  RECORD_CLAIM: 'backoffice.action.RECORD_CLAIM',
  CANCEL_TRIP_PLATFORM: 'backoffice.action.CANCEL_TRIP_PLATFORM',
  DECLARE_NO_SHOW: 'backoffice.action.DECLARE_NO_SHOW',
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

export function ConsoleView({
  i18n,
  state,
  handlers,
}: {
  readonly i18n: Translator;
  readonly state: ConsoleState;
  readonly handlers: ConsoleHandlers;
}) {
  switch (state.kind) {
    case 'loading':
      return <p className={styles['muted']}>{i18n.t('common.ui.loading')}</p>;

    case 'login':
      return (
        <section className={styles['panel']} aria-labelledby="login-heading">
          <h2 id="login-heading" className={styles['heading']}>
            {i18n.t('backoffice.login.heading')}
          </h2>
          {state.error && <Banner tone="danger">{i18n.t(state.error)}</Banner>}
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
            <Button type="submit" block>
              {i18n.t('backoffice.login.submit')}
            </Button>
          </form>
        </section>
      );

    case 'totp':
      return (
        <section className={styles['panel']} aria-labelledby="totp-heading">
          <h2 id="totp-heading" className={styles['heading']}>
            {i18n.t('backoffice.totp.heading')}
          </h2>
          <p className={styles['muted']}>{i18n.t('backoffice.totp.intro')}</p>
          {state.error && <Banner tone="danger">{i18n.t(state.error)}</Banner>}
          <form
            className={styles['form']}
            onSubmit={prevent((e) => handlers.onVerify(fieldOf(e, 'code')))}
          >
            <TextField
              i18n={i18n}
              id="totp-code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]{6,7}"
              maxLength={7}
              label={i18n.t('backoffice.totp.code')}
            />
            <Button type="submit" block>
              {i18n.t('backoffice.totp.submit')}
            </Button>
          </form>
        </section>
      );

    case 'enroll':
      return (
        <section className={styles['panel']} aria-labelledby="enroll-heading">
          <h2 id="enroll-heading" className={styles['heading']}>
            {i18n.t('backoffice.enroll.heading')}
          </h2>
          <p className={styles['muted']}>{i18n.t('backoffice.enroll.intro')}</p>
          {state.error && <Banner tone="danger">{i18n.t(state.error)}</Banner>}
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
              <Button type="submit" block>
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
              <Button type="submit" block>
                {i18n.t('backoffice.enroll.confirm')}
              </Button>
            </form>
          )}
        </section>
      );

    case 'denied':
      return (
        <section className={styles['panel']} aria-labelledby="denied-heading">
          <h2 id="denied-heading" className={styles['heading']}>
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
            <h2 id="roles-heading" className={styles['heading']}>
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
              <div className={styles['actions']}>
                {CONSOLE_ACTIONS.map((a, i) => (
                  <Button
                    key={a}
                    type="submit"
                    name="action"
                    value={a}
                    variant={i === 0 ? 'primary' : 'secondary'}
                  >
                    {i18n.t(ACTION_KEYS[a])}
                  </Button>
                ))}
              </div>
            </form>
          </section>

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
        </div>
      );
  }
}
