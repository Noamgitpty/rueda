/**
 * Écran O01 de 10b, files de travail (US-109 ; 16 ADM-005 fiche 360°, ADM-029 files avec délais,
 * ADM-032 journal d'accès) : files de revue avec retard signalé, dossier KYC ouvert par la file
 * seulement, fiche 360° (recherche, identité, statut KYC sans pièce, restrictions, comptes d'hôte
 * fermés à la réservation, trips, dossiers, notes), restriction et levée motivées, ouverture d'un
 * dossier, ajout d'une pièce. Composant de PRÉSENTATION pur : aucun appel réseau ni état ; la
 * logique est dans `console-client.tsx`. Composants de `@rueda/ui` ; mise en page par les jetons
 * (console.module.css). La base reste juge de chaque droit et journalise chaque consultation.
 */
import type { FormEvent } from 'react';
import type { MessageKey, Translator } from '@rueda/i18n';
import { Badge, Banner, Button, DataTable, EmptyState, ErrorState, TextField } from '@rueda/ui';
import styles from './console.module.css';

export const QUEUES = [
  'KYC',
  'LISTING',
  'HOST_VERIFICATION',
  'RISK_BOOKING',
  'CATALOG_ADDITION',
  'OVERDUE',
  'GRAY_MARKET',
  'LEG_RECONCILIATION',
] as const;
export type Queue = (typeof QUEUES)[number];

export const RESTRICTION_KINDS = ['TS_HOLD', 'POLICY_VIOLATION'] as const;
export type ManualRestriction = (typeof RESTRICTION_KINDS)[number];
export const CASE_CATEGORIES = [
  'ACCOUNT',
  'TRIP',
  'PAYMENT',
  'LISTING',
  'CLAIM',
  'SAFETY',
  'OTHER',
] as const;
export const CASE_CHANNELS = ['PHONE', 'WHATSAPP', 'EMAIL', 'IN_APP'] as const;

export interface QueueSummaryView {
  readonly queue: Queue;
  readonly open: number;
  readonly overdue: number;
}

export interface QueueItemView {
  readonly id: string;
  readonly queue: Queue;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly country: string;
  readonly slaDueAt: string;
  readonly overdue: boolean;
  readonly assigned: boolean;
  readonly assignedToMe: boolean;
}

export interface KycDossierView {
  readonly itemId: string;
  readonly userId: string;
  readonly kycStatus: 'NOT_STARTED';
  readonly legalFirstName: string;
  readonly legalLastName: string;
  readonly dateOfBirth: string | null;
  readonly residenceCountry: string | null;
}

export interface ProfileView {
  readonly country: string;
  readonly profile: {
    readonly id: string;
    readonly email: string;
    readonly emailVerified: boolean;
    readonly phone: string | null;
    readonly phoneVerified: boolean;
    readonly legalFirstName: string;
    readonly legalLastName: string;
    readonly status: string;
  };
  readonly kyc: { readonly status: 'NOT_STARTED' };
  readonly restricted: boolean;
  readonly restrictions: readonly {
    readonly id: string;
    readonly kind: string;
    readonly active: boolean;
    readonly reason: string | null;
    readonly createdAt: string;
  }[];
  readonly notes: readonly {
    readonly id: string;
    readonly authorRole: string;
    readonly body: string;
    readonly createdAt: string;
  }[];
  readonly hostAccounts: readonly {
    readonly orgId: string;
    readonly country: string;
    readonly status: string;
    readonly bookable: boolean;
  }[];
  readonly trips: readonly {
    readonly id: string;
    readonly status: string;
    readonly scheduledStart: string;
  }[];
  readonly cases: readonly {
    readonly id: string;
    readonly category: string;
    readonly status: string;
    readonly assignedToMe: boolean;
  }[];
}

export interface OpsState {
  /** Files : présent pour les rôles qui en ont (OPS, ADMIN) ; la base filtre de toute façon. */
  readonly queues?:
    | {
        readonly summary: readonly QueueSummaryView[];
        readonly selected: Queue | null;
        readonly items: readonly QueueItemView[];
        readonly error?: boolean | undefined;
      }
    | undefined;
  readonly kyc?: KycDossierView | undefined;
  readonly profile?: ProfileView | undefined;
  readonly notice?:
    | {
        readonly tone: 'success' | 'danger' | 'warning';
        readonly key: MessageKey;
        readonly values?: Readonly<Record<string, string>> | undefined;
      }
    | undefined;
}

/** Taille maximale d'une pièce (octets) : celle de l'API en Bêta (64 Kio, ADR-097). */
export const EVIDENCE_MAX_BYTES = 64 * 1024;
export const EVIDENCE_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'application/pdf'] as const;

/**
 * Contrôle avant l'envoi (la base et l'API restent juges) : clé du message de refus, ou `null`.
 * Un HEIC dont le navigateur ne donne pas le type est accepté ici : l'API lit le type réel.
 */
export function evidenceRefusal(file: {
  readonly size: number;
  readonly type: string;
}): 'common.evidence.tooLarge' | 'common.evidence.badType' | null {
  if (file.size === 0 || file.size > EVIDENCE_MAX_BYTES) return 'common.evidence.tooLarge';
  if (file.type !== '' && !(EVIDENCE_TYPES as readonly string[]).includes(file.type)) {
    return 'common.evidence.badType';
  }
  return null;
}

/** Message d'un refus de l'API selon sa cause (`values.reason`) : taille, type, analyse. */
export function evidenceReasonKey(reason: unknown): MessageKey {
  if (reason === 'SIZE') return 'common.evidence.tooLarge';
  if (reason === 'TYPE') return 'common.evidence.badType';
  if (reason === 'SCAN') return 'common.evidence.scanRefused';
  return 'common.evidence.rejected';
}

export interface OpsHandlers {
  readonly onShowQueue: (queue: Queue) => void;
  readonly onClaim: (itemId: string) => void;
  readonly onOpenKyc: (itemId: string, purpose: string) => void;
  readonly onSearch: (email: string, purpose: string) => void;
  readonly onOpenProfile: (userId: string, purpose: string) => void;
  readonly onAddNote: (userId: string, body: string) => void;
  readonly onRestriction: (
    action: 'RESTRICT_ACCOUNT' | 'LIFT_RESTRICTION',
    userId: string,
    kind: ManualRestriction,
    reason: string,
  ) => void;
  readonly onOpenCase: (userId: string, category: string, channel: string) => void;
  readonly onResolveCase: (caseId: string) => void;
  readonly onUpload: (userId: string, file: File | null) => void;
}

const QUEUE_KEYS: Readonly<Record<Queue, MessageKey>> = {
  KYC: 'backoffice.queue.KYC',
  LISTING: 'backoffice.queue.LISTING',
  HOST_VERIFICATION: 'backoffice.queue.HOST_VERIFICATION',
  RISK_BOOKING: 'backoffice.queue.RISK_BOOKING',
  CATALOG_ADDITION: 'backoffice.queue.CATALOG_ADDITION',
  OVERDUE: 'backoffice.queue.OVERDUE',
  GRAY_MARKET: 'backoffice.queue.GRAY_MARKET',
  LEG_RECONCILIATION: 'backoffice.queue.LEG_RECONCILIATION',
};

const RESTRICTION_KEYS: Readonly<Record<string, MessageKey>> = {
  TS_HOLD: 'backoffice.restriction.TS_HOLD',
  POLICY_VIOLATION: 'backoffice.restriction.POLICY_VIOLATION',
  UNPAID_BALANCE: 'backoffice.restriction.UNPAID_BALANCE',
  CHARGEBACK: 'backoffice.restriction.CHARGEBACK',
  PAYMENT_PLAN_ACTIVE: 'backoffice.restriction.PAYMENT_PLAN_ACTIVE',
  KYC_REVOKED: 'backoffice.restriction.KYC_REVOKED',
};

const CATEGORY_KEYS: Readonly<Record<(typeof CASE_CATEGORIES)[number], MessageKey>> = {
  ACCOUNT: 'backoffice.case.category.ACCOUNT',
  TRIP: 'backoffice.case.category.TRIP',
  PAYMENT: 'backoffice.case.category.PAYMENT',
  LISTING: 'backoffice.case.category.LISTING',
  CLAIM: 'backoffice.case.category.CLAIM',
  SAFETY: 'backoffice.case.category.SAFETY',
  OTHER: 'backoffice.case.category.OTHER',
};

const CHANNEL_KEYS: Readonly<Record<(typeof CASE_CHANNELS)[number], MessageKey>> = {
  PHONE: 'backoffice.case.channel.PHONE',
  WHATSAPP: 'backoffice.case.channel.WHATSAPP',
  EMAIL: 'backoffice.case.channel.EMAIL',
  IN_APP: 'backoffice.case.channel.IN_APP',
};

const CASE_STATUS_KEYS: Readonly<Record<string, MessageKey>> = {
  OPEN: 'backoffice.case.status.OPEN',
  PENDING: 'backoffice.case.status.PENDING',
  RESOLVED: 'backoffice.case.status.RESOLVED',
  CLOSED: 'backoffice.case.status.CLOSED',
};

function fieldOf(event: FormEvent<HTMLFormElement>, name: string): string {
  const value = new FormData(event.currentTarget).get(name);
  return typeof value === 'string' ? value : '';
}

function fileOf(event: FormEvent<HTMLFormElement>, name: string): File | null {
  const value = new FormData(event.currentTarget).get(name);
  return typeof value === 'object' && value !== null && value.size > 0 ? value : null;
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

const short = (id: string): string => id.slice(0, 8);

/** Champ du motif de consultation (journalisé avec chaque lecture de données personnelles). */
function PurposeField({ i18n, id }: { readonly i18n: Translator; readonly id: string }) {
  return (
    <TextField
      i18n={i18n}
      id={id}
      name="purpose"
      minLength={10}
      maxLength={500}
      label={i18n.t('backoffice.profile.purpose')}
      hint={i18n.t('backoffice.profile.purposeHint')}
    />
  );
}

export function OpsPanels({
  i18n,
  state,
  handlers,
  busy = false,
  showProfile,
}: {
  readonly i18n: Translator;
  readonly state: OpsState;
  readonly handlers: OpsHandlers;
  readonly busy?: boolean;
  /** Rôles qui lisent les fiches (SUPPORT, OPS, ADMIN) ; la base reste juge. */
  readonly showProfile: boolean;
}) {
  const q = state.queues;
  const p = state.profile;
  return (
    <>
      {state.notice && (
        <Banner
          tone={state.notice.tone}
          live={state.notice.tone === 'success' ? 'polite' : 'assertive'}
        >
          {i18n.t(state.notice.key, state.notice.values)}
        </Banner>
      )}

      {q !== undefined && (
        <section className={styles['panel']} aria-labelledby="queues-heading">
          <h2 id="queues-heading" className={styles['heading']}>
            {i18n.t('backoffice.queues.heading')}
          </h2>
          {q.error ? (
            <ErrorState
              i18n={i18n}
              title={i18n.t('backoffice.queues.heading')}
              message={i18n.t('backoffice.queues.error')}
              headingLevel={3}
            />
          ) : (
            <form
              className={styles['form']}
              onSubmit={prevent((e) => {
                const value = submitted(e);
                const [verb, target] = value.split(':');
                if (verb === 'show' && (QUEUES as readonly string[]).includes(target ?? '')) {
                  handlers.onShowQueue(target as Queue);
                } else if (verb === 'claim' && target !== undefined) handlers.onClaim(target);
                else if (verb === 'kyc' && target !== undefined) {
                  handlers.onOpenKyc(target, fieldOf(e, 'purpose'));
                }
              })}
            >
              <ul className={styles['roles']}>
                {q.summary.map((s) => (
                  <li key={s.queue} className={styles['role']}>
                    <Button
                      type="submit"
                      name="op"
                      value={`show:${s.queue}`}
                      variant={q.selected === s.queue ? 'primary' : 'secondary'}
                      aria-current={q.selected === s.queue ? 'true' : undefined}
                      loading={busy}
                    >
                      {i18n.t(QUEUE_KEYS[s.queue])}
                    </Button>
                    {q.selected === s.queue && (
                      <Badge tone="neutral">{i18n.t('backoffice.queues.current')}</Badge>
                    )}
                    <span className={styles['muted']}>
                      {i18n.t('backoffice.queues.summary', {
                        total: String(s.open),
                        late: String(s.overdue),
                      })}
                    </span>
                    {s.overdue > 0 && (
                      <Badge tone="danger">{i18n.t('backoffice.queues.overdue')}</Badge>
                    )}
                  </li>
                ))}
              </ul>
              {q.selected !== null && (
                <>
                  {q.selected === 'KYC' && <PurposeField i18n={i18n} id="queue-purpose" />}
                  <DataTable
                    id="queue-items"
                    caption={`${i18n.t('backoffice.queues.caption')} · ${i18n.t(QUEUE_KEYS[q.selected])}`}
                    columns={[
                      { key: 'subject', header: i18n.t('backoffice.queues.subject') },
                      { key: 'due', header: i18n.t('backoffice.queues.due') },
                      { key: 'state', header: i18n.t('backoffice.queues.state') },
                      { key: 'actions', header: i18n.t('backoffice.queues.actions') },
                    ]}
                    rows={q.items.map((item) => ({
                      id: item.id,
                      cells: {
                        subject: (
                          <code className={styles['code']}>
                            {item.subjectType} {short(item.subjectId)} · {item.country}
                          </code>
                        ),
                        due: (
                          <span className={styles['role']}>
                            <span>{`${i18n.dateTime(item.slaDueAt, 'UTC')} UTC`}</span>
                            <Badge tone={item.overdue ? 'danger' : 'success'}>
                              {i18n.t(
                                item.overdue
                                  ? 'backoffice.queues.overdue'
                                  : 'backoffice.queues.onTime',
                              )}
                            </Badge>
                          </span>
                        ),
                        state: i18n.t(
                          item.assignedToMe
                            ? 'backoffice.queues.mine'
                            : item.assigned
                              ? 'backoffice.queues.taken'
                              : 'backoffice.queues.unassigned',
                        ),
                        actions: (
                          <span className={styles['actions']}>
                            {!item.assigned && (
                              <Button
                                type="submit"
                                name="op"
                                value={`claim:${item.id}`}
                                variant="secondary"
                                loading={busy}
                              >
                                {i18n.t('backoffice.queues.claim')}
                              </Button>
                            )}
                            {item.queue === 'KYC' && item.assignedToMe && (
                              <Button
                                type="submit"
                                name="op"
                                value={`kyc:${item.id}`}
                                variant="primary"
                                loading={busy}
                              >
                                {i18n.t('backoffice.queues.openKyc')}
                              </Button>
                            )}
                          </span>
                        ),
                      },
                    }))}
                    empty={
                      <EmptyState title={i18n.t('backoffice.queues.empty')} headingLevel={3} />
                    }
                  />
                </>
              )}
            </form>
          )}
        </section>
      )}

      {state.kyc !== undefined && (
        <section className={styles['panel']} aria-labelledby="kyc-heading">
          <h2 id="kyc-heading" className={styles['heading']} tabIndex={-1}>
            {i18n.t('backoffice.kyc.heading')}
          </h2>
          <Banner tone="info" live="polite">
            {i18n.t('backoffice.kyc.logged')}
          </Banner>
          <p>
            {state.kyc.legalFirstName} {state.kyc.legalLastName}
          </p>
          <p className={styles['role']}>
            <span className={styles['label']}>{i18n.t('backoffice.kyc.birthDate')}</span>
            <span>{state.kyc.dateOfBirth ?? i18n.t('backoffice.kyc.unknown')}</span>
          </p>
          <p className={styles['role']}>
            <span className={styles['label']}>{i18n.t('backoffice.kyc.residence')}</span>
            <span>{state.kyc.residenceCountry ?? i18n.t('backoffice.kyc.unknown')}</span>
          </p>
          <Badge tone="neutral" icon={null}>
            {i18n.t('backoffice.kyc.NOT_STARTED')}
          </Badge>
        </section>
      )}

      {showProfile && (
        <section className={styles['panel']} aria-labelledby="profile-heading">
          <h2 id="profile-heading" className={styles['heading']}>
            {i18n.t('backoffice.profile.heading')}
          </h2>
          <p className={styles['muted']}>{i18n.t('backoffice.profile.intro')}</p>
          <form
            className={styles['form']}
            onSubmit={prevent((e) => {
              const purpose = fieldOf(e, 'purpose');
              if (submitted(e) === 'search') handlers.onSearch(fieldOf(e, 'email'), purpose);
              else handlers.onOpenProfile(fieldOf(e, 'userId').trim().toLowerCase(), purpose);
            })}
          >
            <TextField
              i18n={i18n}
              id="profile-email"
              name="email"
              type="email"
              autoComplete="off"
              optional
              label={i18n.t('backoffice.profile.email')}
            />
            <TextField
              i18n={i18n}
              id="profile-user"
              name="userId"
              autoComplete="off"
              spellCheck={false}
              optional
              label={i18n.t('backoffice.profile.userId')}
            />
            <PurposeField i18n={i18n} id="profile-purpose" />
            <div className={styles['actions']}>
              <Button type="submit" name="op" value="search" variant="secondary" loading={busy}>
                {i18n.t('backoffice.profile.search')}
              </Button>
              <Button type="submit" name="op" value="open" variant="primary" loading={busy}>
                {i18n.t('backoffice.profile.open')}
              </Button>
            </div>
          </form>
          {p !== undefined && <ProfileDetails i18n={i18n} p={p} handlers={handlers} busy={busy} />}
        </section>
      )}
    </>
  );
}

function ProfileDetails({
  i18n,
  p,
  handlers,
  busy,
}: {
  readonly i18n: Translator;
  readonly p: ProfileView;
  readonly handlers: OpsHandlers;
  readonly busy: boolean;
}) {
  const id = p.profile.id;
  const verified = (ok: boolean) =>
    i18n.t(ok ? 'backoffice.profile.verified' : 'backoffice.profile.notVerified');
  return (
    <div className={styles['stack']}>
      <div className={styles['group']}>
        <h3 id="profile-identity" className={styles['label']} tabIndex={-1}>
          {i18n.t('backoffice.profile.identity')}
        </h3>
        <p>
          {p.profile.legalFirstName} {p.profile.legalLastName} ·{' '}
          <code className={styles['code']}>{short(id)}</code> · {p.country}
        </p>
        <p className={styles['muted']}>
          {p.profile.email} ({verified(p.profile.emailVerified)})
          {p.profile.phone !== null &&
            ` · ${p.profile.phone} (${verified(p.profile.phoneVerified)})`}
        </p>
        <p className={styles['muted']}>
          {i18n.t('backoffice.profile.accountStatus', { status: p.profile.status })}
        </p>
        <span className={styles['role']}>
          <span className={styles['label']}>{i18n.t('backoffice.profile.kycStatus')}</span>
          <Badge tone="neutral" icon={null}>
            {i18n.t('backoffice.kyc.NOT_STARTED')}
          </Badge>
        </span>
      </div>

      {p.restricted && (
        <Banner tone="warning" live="polite">
          {i18n.t('backoffice.profile.restricted')}
        </Banner>
      )}

      <DataTable
        id="profile-restrictions"
        caption={i18n.t('backoffice.profile.restrictions')}
        columns={[
          { key: 'kind', header: i18n.t('backoffice.profile.kind') },
          { key: 'state', header: i18n.t('backoffice.queues.state') },
          { key: 'reason', header: i18n.t('backoffice.profile.reason') },
          { key: 'since', header: i18n.t('backoffice.profile.since') },
        ]}
        rows={p.restrictions.map((r) => ({
          id: r.id,
          cells: {
            kind: RESTRICTION_KEYS[r.kind]
              ? i18n.t(RESTRICTION_KEYS[r.kind] as MessageKey)
              : r.kind,
            state: (
              <Badge tone={r.active ? 'danger' : 'neutral'} icon={null}>
                {i18n.t(r.active ? 'backoffice.profile.active' : 'backoffice.profile.lifted')}
              </Badge>
            ),
            reason: r.reason ?? '',
            since: `${i18n.dateTime(r.createdAt, 'UTC')} UTC`,
          },
        }))}
        empty={<EmptyState title={i18n.t('backoffice.profile.noRestriction')} headingLevel={3} />}
      />

      <form
        className={styles['form']}
        onSubmit={prevent((e) => {
          const [action, kind] = submitted(e).split(':');
          if (
            (action === 'RESTRICT_ACCOUNT' || action === 'LIFT_RESTRICTION') &&
            (RESTRICTION_KINDS as readonly string[]).includes(kind ?? '')
          ) {
            handlers.onRestriction(action, id, kind as ManualRestriction, fieldOf(e, 'reason'));
          }
        })}
      >
        <TextField
          i18n={i18n}
          id="restriction-reason"
          name="reason"
          minLength={10}
          maxLength={1000}
          label={i18n.t('backoffice.action.reason')}
          hint={i18n.t('backoffice.action.reasonHint')}
        />
        {(['RESTRICT_ACCOUNT', 'LIFT_RESTRICTION'] as const).map((action) => (
          <div
            key={action}
            role="group"
            aria-labelledby={`restriction-${action}`}
            className={styles['group']}
          >
            <h3 id={`restriction-${action}`} className={styles['label']}>
              {i18n.t(`backoffice.action.${action}`)}
            </h3>
            <div className={styles['actions']}>
              {RESTRICTION_KINDS.map((kind) => (
                <Button
                  key={kind}
                  type="submit"
                  name="op"
                  value={`${action}:${kind}`}
                  variant={action === 'RESTRICT_ACCOUNT' ? 'secondary' : 'quiet'}
                  loading={busy}
                >
                  {i18n.t(RESTRICTION_KEYS[kind] as MessageKey)}
                </Button>
              ))}
            </div>
          </div>
        ))}
      </form>

      <DataTable
        id="profile-hosts"
        caption={i18n.t('backoffice.profile.hostAccounts')}
        columns={[
          { key: 'account', header: i18n.t('backoffice.queues.subject') },
          { key: 'bookable', header: i18n.t('backoffice.profile.bookable') },
        ]}
        rows={p.hostAccounts.map((h) => ({
          id: h.orgId,
          cells: {
            account: (
              <code className={styles['code']}>
                {short(h.orgId)} · {h.country} · {h.status}
              </code>
            ),
            bookable: (
              <Badge tone={h.bookable ? 'success' : 'danger'}>
                {i18n.t(h.bookable ? 'backoffice.profile.bookable' : 'backoffice.profile.closed')}
              </Badge>
            ),
          },
        }))}
        empty={<EmptyState title={i18n.t('backoffice.profile.noHost')} headingLevel={3} />}
      />

      <DataTable
        id="profile-trips"
        caption={i18n.t('backoffice.profile.trips')}
        columns={[
          { key: 'trip', header: i18n.t('backoffice.queues.subject') },
          { key: 'start', header: i18n.t('backoffice.queues.due') },
        ]}
        rows={p.trips.map((t) => ({
          id: t.id,
          cells: {
            trip: (
              <code className={styles['code']}>
                {short(t.id)} · {t.status}
              </code>
            ),
            start: `${i18n.dateTime(t.scheduledStart, 'UTC')} UTC`,
          },
        }))}
        empty={<EmptyState title={i18n.t('backoffice.profile.noTrip')} headingLevel={3} />}
      />

      <form
        className={styles['form']}
        onSubmit={prevent((e) => {
          const caseId = submitted(e);
          if (caseId !== '') handlers.onResolveCase(caseId);
        })}
      >
        <DataTable
          id="profile-cases"
          caption={i18n.t('backoffice.profile.cases')}
          columns={[
            { key: 'category', header: i18n.t('backoffice.case.category') },
            { key: 'status', header: i18n.t('backoffice.queues.state') },
            { key: 'actions', header: i18n.t('backoffice.queues.actions') },
          ]}
          rows={p.cases.map((c) => ({
            id: c.id,
            cells: {
              category:
                c.category in CATEGORY_KEYS
                  ? i18n.t(CATEGORY_KEYS[c.category as keyof typeof CATEGORY_KEYS])
                  : c.category,
              status: CASE_STATUS_KEYS[c.status]
                ? i18n.t(CASE_STATUS_KEYS[c.status] as MessageKey)
                : c.status,
              actions:
                c.assignedToMe && (c.status === 'OPEN' || c.status === 'PENDING') ? (
                  <Button type="submit" name="case" value={c.id} variant="secondary" loading={busy}>
                    {i18n.t('backoffice.case.resolve')}
                  </Button>
                ) : (
                  ''
                ),
            },
          }))}
          empty={<EmptyState title={i18n.t('backoffice.profile.noCase')} headingLevel={3} />}
        />
      </form>

      <form
        className={styles['form']}
        onSubmit={prevent((e) => {
          const [category, channel] = submitted(e).split(':');
          if (category && channel) handlers.onOpenCase(id, category, channel);
        })}
      >
        <h3 className={styles['label']}>{i18n.t('backoffice.case.heading')}</h3>
        {CASE_CHANNELS.map((channel) => (
          <div
            key={channel}
            role="group"
            aria-labelledby={`case-channel-${channel}`}
            className={styles['group']}
          >
            <p id={`case-channel-${channel}`} className={styles['role']}>
              <span className={styles['muted']}>{i18n.t('backoffice.case.channel')}</span>
              <span className={styles['label']}>{i18n.t(CHANNEL_KEYS[channel])}</span>
            </p>
            <div className={styles['actions']}>
              {CASE_CATEGORIES.map((category) => (
                <Button
                  key={category}
                  type="submit"
                  name="op"
                  value={`${category}:${channel}`}
                  variant="quiet"
                  loading={busy}
                >
                  {i18n.t(CATEGORY_KEYS[category])}
                </Button>
              ))}
            </div>
          </div>
        ))}
      </form>

      <div className={styles['group']}>
        <h3 className={styles['label']}>{i18n.t('backoffice.profile.notes')}</h3>
        {p.notes.length === 0 ? (
          <EmptyState title={i18n.t('backoffice.profile.noNote')} headingLevel={3} />
        ) : (
          <ul className={styles['roles']}>
            {p.notes.map((n) => (
              <li key={n.id} className={styles['group']}>
                <span className={styles['muted']}>
                  {`${i18n.dateTime(n.createdAt, 'UTC')} UTC`} · {n.authorRole}
                </span>
                <span>{n.body}</span>
              </li>
            ))}
          </ul>
        )}
        <form
          className={styles['form']}
          onSubmit={prevent((e) => handlers.onAddNote(id, fieldOf(e, 'note')))}
        >
          <TextField
            i18n={i18n}
            id="profile-note"
            name="note"
            maxLength={2000}
            label={i18n.t('backoffice.profile.note')}
          />
          <Button type="submit" variant="secondary" loading={busy}>
            {i18n.t('backoffice.profile.addNote')}
          </Button>
        </form>
      </div>

      <form
        className={styles['form']}
        onSubmit={prevent((e) => handlers.onUpload(id, fileOf(e, 'file')))}
      >
        <h3 className={styles['label']}>{i18n.t('backoffice.evidence.heading')}</h3>
        <TextField
          i18n={i18n}
          id="evidence-file"
          name="file"
          type="file"
          accept="image/jpeg,image/png,image/heic,application/pdf"
          label={i18n.t('backoffice.evidence.file')}
        />
        <Button type="submit" variant="secondary" loading={busy}>
          {i18n.t('backoffice.evidence.upload')}
        </Button>
      </form>
    </div>
  );
}
