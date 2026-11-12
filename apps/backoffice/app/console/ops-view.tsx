/**
 * Écran O01 de 10b, files de travail (US-109 ; 16 ADM-005 fiche 360°, ADM-029 files avec délais,
 * ADM-032 journal d'accès) : files de revue avec retard signalé, dossier KYC ouvert par la file
 * seulement, fiche 360° (recherche, identité, statut KYC sans pièce, restrictions, comptes d'hôte
 * fermés à la réservation, trips, dossiers, notes), restriction et levée motivées, ouverture d'un
 * dossier, ajout d'une pièce ; demande d'ajout au catalogue (US-114 ; 16 ADM-036 : rapprocher d'une
 * variante existante, créer la variante sous licence, ou refuser avec un motif). Composant de
 * PRÉSENTATION pur : aucun appel réseau ni état ; la
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

/** Demande d'ajout au catalogue d'un élément CATALOG_ADDITION pris en charge (US-114). */
export interface CatalogAdditionView {
  readonly itemId: string;
  readonly requestId: string;
  readonly country: string;
  readonly makeText: string;
  readonly modelText: string;
  readonly year: number;
  readonly trimText: string | null;
  readonly vinMasked: string | null;
  readonly transmission: 'MANUAL' | 'AUTOMATIC';
  readonly seats: number;
  readonly fuelType: 'GASOLINE' | 'DIESEL' | 'HYBRID' | 'EV';
  readonly slaDueAt: string;
  readonly candidates: readonly {
    readonly variantId: string;
    readonly make: string;
    readonly model: string;
    readonly yearFrom: number;
    readonly yearTo: number | null;
    readonly trim: string | null;
    /** `null` : variante sans fiche (import de la douane, ADR-109), à compléter par l'ops. */
    readonly transmission: string | null;
    readonly fuelType: string | null;
    readonly drive: string | null;
    readonly seats: number | null;
    readonly modelMatch: boolean;
  }[];
}

export const BODY_TYPES = [
  'SUV',
  'PICKUP',
  'SEDAN',
  'HATCHBACK',
  'VAN',
  'MINIVAN',
  'COUPE',
  'CONVERTIBLE',
  'WAGON',
] as const;
export const GEARBOXES = ['MT', 'AT', 'CVT', 'DCT'] as const;
export const FUELS = ['GASOLINE', 'DIESEL', 'HYBRID', 'PHEV', 'EV', 'LPG'] as const;
export const DRIVES = ['FWD', 'RWD', 'AWD', '4X4'] as const;
export const REJECT_REASONS = ['INSUFFICIENT_DETAILS', 'UNKNOWN_MODEL', 'NOT_ELIGIBLE'] as const;

/** Décision de l'ops (la base juge chaque valeur, l'année et le marché). */
export type CatalogResolutionInput =
  | { readonly decision: 'MERGE'; readonly variantId: string }
  | { readonly decision: 'APPROVE'; readonly entry: Readonly<Record<string, unknown>> }
  | { readonly decision: 'REJECT'; readonly rejectReason: (typeof REJECT_REASONS)[number] };

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
  readonly catalog?: CatalogAdditionView | undefined;
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
  readonly onOpenCatalog: (itemId: string) => void;
  readonly onResolveCatalog: (itemId: string, resolution: CatalogResolutionInput) => void;
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

// libellés du catalogue de référence (US-113, `common.vehicle.*`)
const BODY_KEYS: Readonly<Record<(typeof BODY_TYPES)[number], MessageKey>> = {
  SUV: 'common.vehicle.bodyType.suv',
  PICKUP: 'common.vehicle.bodyType.pickup',
  SEDAN: 'common.vehicle.bodyType.sedan',
  HATCHBACK: 'common.vehicle.bodyType.hatchback',
  VAN: 'common.vehicle.bodyType.van',
  MINIVAN: 'common.vehicle.bodyType.minivan',
  COUPE: 'common.vehicle.bodyType.coupe',
  CONVERTIBLE: 'common.vehicle.bodyType.convertible',
  WAGON: 'common.vehicle.bodyType.wagon',
};
const GEARBOX_KEYS: Readonly<Record<string, MessageKey>> = {
  MT: 'common.vehicle.gearbox.manual',
  AT: 'common.vehicle.gearbox.automatic',
  CVT: 'common.vehicle.gearbox.cvt',
  DCT: 'common.vehicle.gearbox.dualClutch',
  MANUAL: 'common.vehicle.gearbox.manual',
  AUTOMATIC: 'common.vehicle.gearbox.automatic',
};
const FUEL_KEYS: Readonly<Record<string, MessageKey>> = {
  GASOLINE: 'common.vehicle.fuel.gasoline',
  DIESEL: 'common.vehicle.fuel.diesel',
  HYBRID: 'common.vehicle.fuel.hybrid',
  PHEV: 'common.vehicle.fuel.plugInHybrid',
  EV: 'common.vehicle.fuel.electric',
  LPG: 'common.vehicle.fuel.lpg',
};
const DRIVE_KEYS: Readonly<Record<string, MessageKey>> = {
  FWD: 'common.vehicle.drive.front',
  RWD: 'common.vehicle.drive.rear',
  AWD: 'common.vehicle.drive.allWheel',
  '4X4': 'common.vehicle.drive.fourByFour',
};
const labelOf = (i18n: Translator, keys: Readonly<Record<string, MessageKey>>, v: string) =>
  keys[v] ? i18n.t(keys[v] as MessageKey) : v;

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
                } else if (verb === 'catalog' && target !== undefined) {
                  handlers.onOpenCatalog(target);
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
                            {item.queue === 'CATALOG_ADDITION' && item.assignedToMe && (
                              <Button
                                type="submit"
                                name="op"
                                value={`catalog:${item.id}`}
                                variant="primary"
                                loading={busy}
                              >
                                {i18n.t('backoffice.catalog.open')}
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

      {state.catalog !== undefined && (
        <CatalogPanel i18n={i18n} c={state.catalog} handlers={handlers} busy={busy} />
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

function SelectField(props: {
  readonly i18n: Translator;
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly options: readonly string[];
  readonly defaultValue?: string | undefined;
  readonly keys: Readonly<Record<string, MessageKey>>;
}) {
  const { i18n, id, name, label, options, defaultValue, keys } = props;
  // sans valeur par défaut : aucune présélection, le choix est exigé (revue ux US-114)
  return (
    <div className={styles['group']}>
      <label className={styles['label']} htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        name={name}
        defaultValue={defaultValue ?? ''}
        required
        className={styles['select']}
      >
        {defaultValue === undefined && (
          <option value="" disabled>
            {i18n.t('backoffice.catalog.choose')}
          </option>
        )}
        {options.map((o) => (
          <option key={o} value={o}>
            {labelOf(i18n, keys, o)}
          </option>
        ))}
      </select>
    </div>
  );
}

const intOf = (raw: string): number | null => (/^[0-9]{1,4}$/.test(raw) ? Number(raw) : null);

/**
 * Demande d'ajout au catalogue (US-114) : saisie de l'hôte, variantes candidates à rattacher,
 * création d'une variante sous licence (la marque et le modèle existants sont repris par la base),
 * refus motivé. Aucune donnée personnelle (VIN sans numéro de série).
 */
function CatalogPanel({
  i18n,
  c,
  handlers,
  busy,
}: {
  readonly i18n: Translator;
  readonly c: CatalogAdditionView;
  readonly handlers: OpsHandlers;
  readonly busy: boolean;
}) {
  const gearbox = c.transmission === 'MANUAL' ? 'MT' : 'AT';
  return (
    <section className={styles['panel']} aria-labelledby="catalog-heading">
      <h2 id="catalog-heading" className={styles['heading']} tabIndex={-1}>
        {i18n.t('backoffice.catalog.heading')}
      </h2>
      <p className={styles['muted']}>
        {i18n.t('backoffice.catalog.due', { date: `${i18n.dateTime(c.slaDueAt, 'UTC')} UTC` })}
      </p>
      <div className={styles['group']}>
        <h3 className={styles['label']}>{i18n.t('backoffice.catalog.requested')}</h3>
        <p>
          {c.makeText} {c.modelText} {c.year}
          {c.trimText !== null ? ` · ${c.trimText}` : ''} · {c.country}
        </p>
        {c.vinMasked !== null && (
          <p className={styles['role']}>
            <span className={styles['label']}>{i18n.t('backoffice.catalog.vin')}</span>
            <code className={styles['code']}>{c.vinMasked}</code>
          </p>
        )}
        <p className={styles['role']}>
          <span className={styles['label']}>{i18n.t('backoffice.catalog.declared')}</span>
          <span>
            {labelOf(i18n, GEARBOX_KEYS, c.transmission)} · {labelOf(i18n, FUEL_KEYS, c.fuelType)} ·{' '}
            {c.seats}
          </span>
        </p>
      </div>

      <form
        className={styles['form']}
        onSubmit={prevent((e) => {
          const variantId = submitted(e);
          if (variantId !== '') {
            handlers.onResolveCatalog(c.itemId, { decision: 'MERGE', variantId });
          }
        })}
      >
        <DataTable
          id="catalog-candidates"
          caption={i18n.t('backoffice.catalog.candidates')}
          columns={[
            { key: 'version', header: i18n.t('backoffice.catalog.version') },
            { key: 'years', header: i18n.t('backoffice.catalog.years') },
            { key: 'specs', header: i18n.t('backoffice.catalog.declared') },
            { key: 'actions', header: i18n.t('backoffice.queues.actions') },
          ]}
          rows={c.candidates.map((k) => ({
            id: k.variantId,
            cells: {
              version: (
                <span className={styles['role']}>
                  <span>
                    {k.make} {k.model}
                    {k.trim !== null ? ` · ${k.trim}` : ''}
                  </span>
                  {k.modelMatch && (
                    <Badge tone="success">{i18n.t('backoffice.catalog.modelMatch')}</Badge>
                  )}
                </span>
              ),
              years: `${k.yearFrom}–${k.yearTo ?? i18n.t('backoffice.catalog.ongoing')}`,
              specs:
                k.transmission === null ||
                k.fuelType === null ||
                k.drive === null ||
                k.seats === null
                  ? i18n.t('backoffice.catalog.specsPending')
                  : `${labelOf(i18n, GEARBOX_KEYS, k.transmission)} · ${labelOf(i18n, FUEL_KEYS, k.fuelType)} · ${labelOf(i18n, DRIVE_KEYS, k.drive)} · ${k.seats}`,
              actions: (
                <Button
                  type="submit"
                  name="variant"
                  value={k.variantId}
                  variant="secondary"
                  loading={busy}
                >
                  {i18n.t('backoffice.catalog.merge')}
                </Button>
              ),
            },
          }))}
          empty={<EmptyState title={i18n.t('backoffice.catalog.noCandidate')} headingLevel={3} />}
        />
      </form>

      <form
        className={styles['form']}
        aria-labelledby="catalog-approve"
        onSubmit={prevent((e) => {
          const yearTo = fieldOf(e, 'yearTo').trim();
          handlers.onResolveCatalog(c.itemId, {
            decision: 'APPROVE',
            entry: {
              makeName: fieldOf(e, 'makeName').trim(),
              modelName: fieldOf(e, 'modelName').trim(),
              bodyType: fieldOf(e, 'bodyType'),
              yearFrom: intOf(fieldOf(e, 'yearFrom').trim()),
              yearTo: yearTo === '' ? null : intOf(yearTo),
              trimName: fieldOf(e, 'trimName').trim() || null,
              transmission: fieldOf(e, 'transmission'),
              fuelType: fieldOf(e, 'fuelType'),
              drive: fieldOf(e, 'drive'),
              seats: intOf(fieldOf(e, 'seats').trim()),
              doors: intOf(fieldOf(e, 'doors').trim()),
              licenseNote: fieldOf(e, 'licenseNote').trim(),
            },
          });
        })}
      >
        <h3 id="catalog-approve" className={styles['label']}>
          {i18n.t('backoffice.catalog.approveHeading')}
        </h3>
        <TextField
          i18n={i18n}
          id="catalog-make"
          name="makeName"
          maxLength={80}
          defaultValue={c.makeText}
          label={i18n.t('backoffice.catalog.makeName')}
        />
        <TextField
          i18n={i18n}
          id="catalog-model"
          name="modelName"
          maxLength={80}
          defaultValue={c.modelText}
          label={i18n.t('backoffice.catalog.modelName')}
        />
        <SelectField
          i18n={i18n}
          id="catalog-body"
          name="bodyType"
          label={i18n.t('backoffice.catalog.bodyType')}
          options={BODY_TYPES}
          keys={BODY_KEYS}
        />
        <TextField
          i18n={i18n}
          id="catalog-year-from"
          name="yearFrom"
          inputMode="numeric"
          maxLength={4}
          defaultValue={String(c.year)}
          label={i18n.t('backoffice.catalog.yearFrom')}
        />
        <TextField
          i18n={i18n}
          id="catalog-year-to"
          name="yearTo"
          inputMode="numeric"
          maxLength={4}
          optional
          label={i18n.t('backoffice.catalog.yearTo')}
        />
        <TextField
          i18n={i18n}
          id="catalog-trim"
          name="trimName"
          maxLength={80}
          optional
          defaultValue={c.trimText ?? undefined}
          label={i18n.t('backoffice.catalog.trimName')}
        />
        <SelectField
          i18n={i18n}
          id="catalog-gearbox"
          name="transmission"
          label={i18n.t('backoffice.catalog.transmission')}
          options={GEARBOXES}
          defaultValue={gearbox}
          keys={GEARBOX_KEYS}
        />
        <SelectField
          i18n={i18n}
          id="catalog-fuel"
          name="fuelType"
          label={i18n.t('backoffice.catalog.fuel')}
          options={FUELS}
          defaultValue={c.fuelType}
          keys={FUEL_KEYS}
        />
        <SelectField
          i18n={i18n}
          id="catalog-drive"
          name="drive"
          label={i18n.t('backoffice.catalog.drive')}
          options={DRIVES}
          keys={DRIVE_KEYS}
        />
        <TextField
          i18n={i18n}
          id="catalog-seats"
          name="seats"
          inputMode="numeric"
          maxLength={2}
          defaultValue={String(c.seats)}
          label={i18n.t('backoffice.catalog.seats')}
        />
        <TextField
          i18n={i18n}
          id="catalog-doors"
          name="doors"
          inputMode="numeric"
          maxLength={1}
          label={i18n.t('backoffice.catalog.doors')}
        />
        <TextField
          i18n={i18n}
          id="catalog-license"
          name="licenseNote"
          minLength={10}
          maxLength={500}
          label={i18n.t('backoffice.catalog.licenseNote')}
          hint={i18n.t('backoffice.catalog.licenseHint')}
        />
        <Button type="submit" variant="primary" loading={busy}>
          {i18n.t('backoffice.catalog.approve')}
        </Button>
      </form>

      <form
        className={styles['form']}
        onSubmit={prevent((e) => {
          const reason = submitted(e);
          if (
            fieldOf(e, 'confirmReject') !== '' &&
            (REJECT_REASONS as readonly string[]).includes(reason)
          ) {
            handlers.onResolveCatalog(c.itemId, {
              decision: 'REJECT',
              rejectReason: reason as (typeof REJECT_REASONS)[number],
            });
          }
        })}
      >
        <div role="group" aria-labelledby="catalog-reject" className={styles['group']}>
          <h3 id="catalog-reject" className={styles['label']}>
            {i18n.t('backoffice.catalog.rejectHeading')}
          </h3>
          {/* confirmation exigée avant l'envoi : l'hôte est prévenu aussitôt (revue ux US-114) */}
          <label className={styles['role']} htmlFor="catalog-reject-confirm">
            <input id="catalog-reject-confirm" type="checkbox" name="confirmReject" required />
            <span>{i18n.t('backoffice.catalog.rejectConfirm')}</span>
          </label>
          <div className={styles['actions']}>
            {REJECT_REASONS.map((reason) => (
              <Button
                key={reason}
                type="submit"
                name="reason"
                value={reason}
                variant="quiet"
                loading={busy}
              >
                {i18n.t(`backoffice.catalog.reject.${reason}`)}
              </Button>
            ))}
          </div>
        </div>
      </form>
    </section>
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
