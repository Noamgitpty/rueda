/**
 * Dommages, incidents et décisions motivées dans la console (US-309, ADR-195 ; écran A09 de 10b ;
 * 16 CLM-001 / CLM-002, CLM-006, ADM-008, LEG-024). Composant de PRÉSENTATION pur (aucun appel
 * réseau, aucun état) ; l'enchaînement est dans `console-client.tsx`.
 *
 * Parcours : (1) l'agent enregistre la déclaration de dommage de l'hôte ou d'incident du voyageur
 * depuis le dossier de support CLAIM qui lui est assigné (la base juge le délai à son heure) ou
 * ouvre une déclaration existante ; (2) il lit le délai, les preuves relues par la base (séries de
 * photos de départ et de retour) et la franchise acceptée au contrat ; (3) il prépare la décision
 * par gabarit (faits, issue, montants par ligne) et en voit l'APERÇU rendu par la base : jambes
 * explicites, lignes exclues comme non refacturables (parking de récupération, frais non imputable),
 * plafond, règle et voies de recours — jamais une décision « définitive » ; (4) il l'enregistre.
 * L'exécution (débit séparé, franchise de l'hôte, déclaration à l'assureur) est faite par Kmino.
 *
 * Montants saisis dans la devise du trip (exposant de la configuration), envoyés en unités mineures
 * (texte d'un entier) ; la base reste seule juge des sommes, des plafonds et des droits.
 */
import type { FormEvent } from 'react';
import type { MessageKey, Translator } from '@rueda/i18n';
import { Badge, Banner, Button, Checkbox, DataTable, TextField } from '@rueda/ui';
import styles from './console.module.css';

/** Rôles qui détiennent `claim.declare` et `dispute.decide` (0034, 0060 ; la base reste juge). */
export const CLAIM_ROLES = new Set(['OPS_AGENT', 'ADMIN']);

export const DECLARED_BY = ['HOST', 'GUEST'] as const;
export type DeclaredBy = (typeof DECLARED_BY)[number];
export const CLAIM_KINDS = ['DAMAGE', 'INCIDENT'] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];
export const OUTCOMES = ['GUEST_LIABLE', 'NO_GUEST_CHARGE', 'INELIGIBLE'] as const;
export type Outcome = (typeof OUTCOMES)[number];
/** Lignes du gabarit : les deux dernières sont toujours exclues (08 BR-TT-05, BR-FUEL-03). */
export const LINE_CATEGORIES = [
  'REPAIR',
  'INSURER_RECOVERY',
  'PROCESSING_FEE',
  'PROCESSING_FEE_TAX',
  'RECOVERY_PARKING',
  'NOT_ATTRIBUTABLE',
] as const;
export type LineCategory = (typeof LINE_CATEGORIES)[number];
const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;

export interface ClaimEvidenceView {
  readonly checkinPhotos: boolean;
  readonly checkoutPhotos: boolean;
  readonly guestAgreement?: boolean;
}

export interface ClaimLineView {
  readonly category: string;
  readonly leg?: string;
  readonly amountMinor: string;
}

export interface ClaimExcludedView {
  readonly category: string;
  readonly amountMinor: string;
  readonly code: string;
  readonly rule: string;
}

export interface ClaimDecisionView {
  readonly decisionId: string;
  readonly outcome: string;
  readonly covered: boolean;
  readonly repairCostMinor: string;
  readonly amountMinor: string;
  readonly legs: Readonly<Record<string, string>>;
  readonly lines: readonly ClaimLineView[];
  readonly excluded: readonly ClaimExcludedView[];
  readonly hostDeductibleMinor: string;
  readonly evidence: ClaimEvidenceView;
  readonly facts: string;
  readonly decidedRole: string;
  readonly decidedAt: string;
  readonly execution: string;
  readonly executionCode: string | null;
  readonly insurerDeclaration: string | null;
}

/** Déclaration lue dans l'API (GET /console/claims/{id}, 0175). */
export interface ClaimView {
  readonly claimId: string;
  readonly tripId: string;
  readonly caseId: string;
  readonly country: string;
  readonly currency: string;
  readonly exponent: number;
  readonly declaredBy: string;
  readonly kind: string;
  readonly description: string;
  readonly status: string;
  readonly reportedAt: string;
  readonly tripEndAt: string;
  readonly deadlineAt: string;
  readonly evidence: ClaimEvidenceView;
  readonly guestCapMinor: string | null;
  readonly decision: ClaimDecisionView | null;
}

/** Aperçu du gabarit rendu par la base (rien n'est écrit). */
export interface ClaimPreviewView {
  /** Débits déjà décidés au voyageur pour ce trip (plafond du trip). */
  readonly alreadyChargedMinor?: string;
  readonly currency: string;
  readonly exponent: number;
  readonly outcome: string;
  readonly covered: boolean;
  readonly repairCostMinor: string;
  readonly amountMinor: string;
  readonly legs: Readonly<Record<string, string>>;
  readonly lines: readonly ClaimLineView[];
  readonly excluded: readonly ClaimExcludedView[];
  readonly hostDeductibleMinor: string;
  readonly guestCapMinor: string | null;
  readonly evidence: ClaimEvidenceView;
  readonly adminRequired: boolean;
}

export interface ClaimRecordDraft {
  readonly tripId: string;
  readonly caseId: string;
  readonly declaredBy: DeclaredBy | null;
  readonly kind: ClaimKind | null;
  readonly description: string;
}

/** Saisie de la décision : montants en unités MINEURES (texte), déjà convertis. */
export interface DecisionDraft {
  readonly outcome: Outcome;
  readonly covered: boolean;
  readonly repairCostMinor: string;
  readonly amountMinor: string;
  readonly lines: readonly { readonly category: LineCategory; readonly amountMinor: string }[];
  readonly hostDeductibleMinor: string;
  readonly facts: string;
}

export interface ClaimsState {
  readonly claim: ClaimView | null;
  /** Aperçu de la base pour la saisie courante ; l'enregistrement envoie cette saisie. */
  readonly preview: {
    readonly draft: DecisionDraft;
    readonly view: ClaimPreviewView;
    /** Identifiant de la décision, gardé pour un rejeu exact (réponse perdue). */
    readonly requestId: string;
  } | null;
  readonly notice?:
    { readonly tone: 'success' | 'warning' | 'danger'; readonly key: MessageKey } | undefined;
}

export interface ClaimsHandlers {
  readonly onClaimRecord: (draft: ClaimRecordDraft) => void;
  readonly onClaimRead: (claimId: string) => void;
  /** `null` : un montant saisi n'est pas lisible dans la devise (rien n'est envoyé). */
  readonly onDecisionPreview: (draft: DecisionDraft | null) => void;
  readonly onDecisionIssue: () => void;
  /** Toute modification du formulaire de décision : l'aperçu affiché n'est plus valable. */
  readonly onDecisionEdit: () => void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Saisie de la déclaration vérifiée avant l'envoi (la base reste juge). */
export function recordProblem(d: ClaimRecordDraft): MessageKey | null {
  if (!UUID.test(d.tripId)) return 'backoffice.claim.error.trip';
  if (!UUID.test(d.caseId)) return 'backoffice.claim.error.case';
  if (d.declaredBy === null || d.kind === null) return 'backoffice.claim.error.who';
  const n = [...d.description.trim()].length;
  if (n < 10 || n > 1000) return 'backoffice.claim.error.description';
  return null;
}

/**
 * Montant saisi dans la devise (« 450 », « 450.5 », « 450,50 ») ⇒ unités mineures (texte d'un
 * entier), selon l'exposant de la devise ; vide ⇒ « 0 » ; invalide ⇒ null. Aucun nombre flottant.
 */
export function minorOf(text: string, exponent: number): string | null {
  const t = text.trim().replace(/\s/g, '');
  if (t === '') return '0';
  const m = /^(\d{1,13})(?:[.,](\d+))?$/.exec(t);
  if (m === null) return null;
  const frac = m[2] ?? '';
  if (frac.length > exponent) return null;
  const minor =
    BigInt(m[1] ?? '0') * 10n ** BigInt(exponent) + BigInt(frac.padEnd(exponent, '0') || '0');
  return minor.toString();
}

const KEYS = {
  declaredBy: {
    HOST: 'backoffice.claim.declaredBy.HOST',
    GUEST: 'backoffice.claim.declaredBy.GUEST',
  },
  kind: { DAMAGE: 'backoffice.claim.kind.DAMAGE', INCIDENT: 'backoffice.claim.kind.INCIDENT' },
  status: {
    REPORTED: 'backoffice.claim.status.REPORTED',
    DECIDED: 'backoffice.claim.status.DECIDED',
  },
  outcome: {
    GUEST_LIABLE: 'backoffice.claim.outcome.GUEST_LIABLE',
    NO_GUEST_CHARGE: 'backoffice.claim.outcome.NO_GUEST_CHARGE',
    INELIGIBLE: 'backoffice.claim.outcome.INELIGIBLE',
  },
  rule: {
    GUEST_LIABLE: 'backoffice.claim.rule.GUEST_LIABLE',
    NO_GUEST_CHARGE: 'backoffice.claim.rule.NO_GUEST_CHARGE',
    INELIGIBLE: 'backoffice.claim.rule.INELIGIBLE',
  },
  line: {
    REPAIR: 'backoffice.claim.line.REPAIR',
    INSURER_RECOVERY: 'backoffice.claim.line.INSURER_RECOVERY',
    PROCESSING_FEE: 'backoffice.claim.line.PROCESSING_FEE',
    PROCESSING_FEE_TAX: 'backoffice.claim.line.PROCESSING_FEE_TAX',
    RECOVERY_PARKING: 'backoffice.claim.line.RECOVERY_PARKING',
    NOT_ATTRIBUTABLE: 'backoffice.claim.line.NOT_ATTRIBUTABLE',
  },
  excludedRule: {
    'BR-TT-05': 'backoffice.claim.excluded.parking',
    'BR-FUEL-03': 'backoffice.claim.excluded.notAttributable',
  },
  execution: {
    PENDING: 'backoffice.claim.execution.PENDING',
    DONE: 'backoffice.claim.execution.DONE',
    BLOCKED: 'backoffice.claim.execution.BLOCKED',
  },
  insurer: {
    PENDING: 'backoffice.claim.insurer.PENDING',
    SENT: 'backoffice.claim.insurer.SENT',
  },
} as const satisfies Record<string, Record<string, MessageKey>>;

const LEG_KEYS: Readonly<Record<string, MessageKey>> = {
  HOST: 'backoffice.cancel.leg.HOST',
  INSURER: 'backoffice.cancel.leg.INSURER',
  TAX_THIRD_PARTY: 'backoffice.cancel.leg.TAX_THIRD_PARTY',
  PLATFORM: 'backoffice.cancel.leg.PLATFORM',
};

/** Texte d'un code connu, sinon le code lui-même (jamais un texte inventé). */
function labelOf(i18n: Translator, keys: Readonly<Record<string, MessageKey>>, code: string) {
  const key = keys[code];
  return key === undefined ? code : i18n.t(key);
}

function fieldOf(event: FormEvent<HTMLFormElement>, name: string): string {
  const value = new FormData(event.currentTarget).get(name);
  return typeof value === 'string' ? value : '';
}

const oneOf = <T extends string>(value: string, allowed: readonly T[]): T | null =>
  (allowed as readonly string[]).includes(value) ? (value as T) : null;

function money(i18n: Translator, v: { currency: string; exponent: number }, minor: string) {
  return i18n.money({ amountMinor: BigInt(minor), currency: v.currency, exponent: v.exponent });
}

/** Saisie d'un montant dans la devise, depuis les unités mineures (reprise après un aperçu). */
function majorOf(minor: string, exponent: number): string {
  if (minor === '0') return '';
  const s = minor.padStart(exponent + 1, '0');
  return exponent === 0 ? s : `${s.slice(0, -exponent)}.${s.slice(-exponent)}`;
}

/**
 * Saisie modifiée après un aperçu (ux n° 1) : l'aperçu n'est plus celui de la saisie, il disparaît
 * avec son bouton ; un nouvel aperçu est exigé avant tout enregistrement.
 */
export function withoutPreview(state: ClaimsState): ClaimsState {
  return state.preview === null ? state : { ...state, preview: null };
}

/** Aide d'un champ de montant selon l'exposant de la devise (ux n° 7). */
function amountHint(i18n: Translator, exponent: number): string {
  return exponent === 0
    ? i18n.t('backoffice.claim.amountHintWhole')
    : i18n.t('backoffice.claim.amountHint');
}

/** Zone de texte multiligne libellée, avec aide (faits, résumé ; ux n° 4). */
function TextArea({
  id,
  label,
  hint,
  ...rest
}: {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly name: string;
  readonly maxLength: number;
  readonly minLength?: number;
  readonly rows?: number;
  readonly defaultValue?: string | undefined;
}) {
  return (
    <div className={styles['group']}>
      <label className={styles['label']} htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className={styles['select']}
        aria-describedby={`${id}-hint`}
        rows={rest.rows ?? 4}
        name={rest.name}
        maxLength={rest.maxLength}
        minLength={rest.minLength}
        defaultValue={rest.defaultValue}
      />
      <p id={`${id}-hint`} className={styles['muted']}>
        {hint}
      </p>
    </div>
  );
}

export function ClaimsPanel({
  i18n,
  state,
  handlers,
  busy = false,
  isAdmin = false,
}: {
  readonly i18n: Translator;
  readonly state: ClaimsState;
  readonly handlers: ClaimsHandlers;
  readonly busy?: boolean;
  /** L'agent tient ADMIN dans un pays (la base reste juge du pays). */
  readonly isAdmin?: boolean;
}) {
  return (
    <section className={styles['panel']} aria-labelledby="claims-heading" data-testid="claims">
      <h2 id="claims-heading" className={styles['heading']} tabIndex={-1}>
        {i18n.t('backoffice.claim.heading')}
      </h2>
      <p className={styles['muted']}>{i18n.t('backoffice.claim.lead')}</p>
      {state.notice !== undefined && (
        <Banner
          tone={state.notice.tone}
          live={state.notice.tone === 'danger' ? 'assertive' : 'polite'}
        >
          {i18n.t(state.notice.key)}
        </Banner>
      )}
      {state.claim === null ? (
        <>
          <RecordForm i18n={i18n} handlers={handlers} busy={busy} />
          <form
            className={styles['form']}
            aria-labelledby="claims-read-heading"
            onSubmit={(e) => {
              e.preventDefault();
              handlers.onClaimRead(fieldOf(e, 'claimId').trim().toLowerCase());
            }}
          >
            <h3 id="claims-read-heading" className={styles['label']}>
              {i18n.t('backoffice.claim.readHeading')}
            </h3>
            <TextField
              i18n={i18n}
              id="claims-id"
              name="claimId"
              autoComplete="off"
              spellCheck={false}
              label={i18n.t('backoffice.claim.claimId')}
            />
            <div className={styles['actions']}>
              <Button type="submit" variant="secondary" loading={busy}>
                {i18n.t('backoffice.claim.read')}
              </Button>
            </div>
          </form>
        </>
      ) : (
        <ClaimDetail
          i18n={i18n}
          state={state}
          claim={state.claim}
          handlers={handlers}
          busy={busy}
          isAdmin={isAdmin}
        />
      )}
    </section>
  );
}

function RecordForm({
  i18n,
  handlers,
  busy,
}: {
  readonly i18n: Translator;
  readonly handlers: ClaimsHandlers;
  readonly busy: boolean;
}) {
  return (
    <form
      className={styles['form']}
      aria-labelledby="claims-record-heading"
      data-testid="claims-record"
      onSubmit={(e) => {
        e.preventDefault();
        handlers.onClaimRecord({
          tripId: fieldOf(e, 'tripId').trim().toLowerCase(),
          caseId: fieldOf(e, 'caseId').trim().toLowerCase(),
          declaredBy: oneOf(fieldOf(e, 'declaredBy'), DECLARED_BY),
          kind: oneOf(fieldOf(e, 'kind'), CLAIM_KINDS),
          description: fieldOf(e, 'description'),
        });
      }}
    >
      <h3 id="claims-record-heading" className={styles['label']}>
        {i18n.t('backoffice.claim.recordHeading')}
      </h3>
      <TextField
        i18n={i18n}
        id="claims-trip"
        name="tripId"
        autoComplete="off"
        spellCheck={false}
        label={i18n.t('backoffice.claim.trip')}
      />
      <TextField
        i18n={i18n}
        id="claims-case"
        name="caseId"
        autoComplete="off"
        spellCheck={false}
        label={i18n.t('backoffice.claim.case')}
        hint={i18n.t('backoffice.claim.caseHint')}
      />
      <div className={styles['group']}>
        <label className={styles['label']} htmlFor="claims-declared-by">
          {i18n.t('backoffice.claim.declaredBy')}
        </label>
        <select
          id="claims-declared-by"
          name="declaredBy"
          defaultValue=""
          required
          className={styles['select']}
        >
          <option value="" disabled>
            {i18n.t('backoffice.catalog.choose')}
          </option>
          {DECLARED_BY.map((w) => (
            <option key={w} value={w}>
              {i18n.t(KEYS.declaredBy[w])}
            </option>
          ))}
        </select>
      </div>
      <div className={styles['group']}>
        <label className={styles['label']} htmlFor="claims-kind">
          {i18n.t('backoffice.claim.kind')}
        </label>
        <select id="claims-kind" name="kind" defaultValue="" required className={styles['select']}>
          <option value="" disabled>
            {i18n.t('backoffice.catalog.choose')}
          </option>
          {CLAIM_KINDS.map((k) => (
            <option key={k} value={k}>
              {i18n.t(KEYS.kind[k])}
            </option>
          ))}
        </select>
      </div>
      <TextArea
        id="claims-description"
        name="description"
        minLength={10}
        maxLength={1000}
        label={i18n.t('backoffice.claim.description')}
        hint={i18n.t('backoffice.claim.descriptionHint')}
      />
      <p className={styles['muted']}>{i18n.t('backoffice.claim.deadlineNote')}</p>
      <div className={styles['actions']}>
        <Button type="submit" variant="primary" loading={busy} data-testid="claims-record-submit">
          {i18n.t('backoffice.claim.record')}
        </Button>
      </div>
    </form>
  );
}

function EvidenceList({
  i18n,
  evidence,
}: {
  readonly i18n: Translator;
  readonly evidence: ClaimEvidenceView;
}) {
  const item = (ok: boolean, yes: MessageKey, no: MessageKey) => (
    <li>
      <Badge tone={ok ? 'success' : 'warning'} icon={null}>
        {i18n.t(ok ? yes : no)}
      </Badge>
    </li>
  );
  return (
    <ul className={styles['list']} data-testid="claims-evidence">
      {item(
        evidence.checkinPhotos,
        'backoffice.claim.evidence.checkin',
        'backoffice.claim.evidence.checkinMissing',
      )}
      {item(
        evidence.checkoutPhotos,
        'backoffice.claim.evidence.checkout',
        'backoffice.claim.evidence.checkoutMissing',
      )}
    </ul>
  );
}

function ClaimDetail({
  i18n,
  state,
  claim,
  handlers,
  busy,
  isAdmin,
}: {
  readonly i18n: Translator;
  readonly state: ClaimsState;
  readonly claim: ClaimView;
  readonly handlers: ClaimsHandlers;
  readonly busy: boolean;
  readonly isAdmin: boolean;
}) {
  return (
    <>
      <h3 id="claims-detail-heading" className={styles['label']} tabIndex={-1}>
        {i18n.t('backoffice.claim.detailHeading')}
      </h3>
      <dl className={styles['list']} data-testid="claims-detail">
        <div>
          <dt className={styles['label']}>{i18n.t('backoffice.claim.declaredBy')}</dt>
          <dd>
            {labelOf(i18n, KEYS.declaredBy, claim.declaredBy)} ·{' '}
            {labelOf(i18n, KEYS.kind, claim.kind)}
          </dd>
        </div>
        <div>
          <dt className={styles['label']}>{i18n.t('backoffice.claim.statusLabel')}</dt>
          <dd>
            <Badge tone={claim.status === 'DECIDED' ? 'success' : 'neutral'} icon={null}>
              {labelOf(i18n, KEYS.status, claim.status)}
            </Badge>
          </dd>
        </div>
        <div>
          <dt className={styles['label']}>{i18n.t('backoffice.claim.deadline')}</dt>
          <dd>
            {i18n.t('backoffice.claim.deadlineValue', {
              reported: `${i18n.dateTime(claim.reportedAt, 'UTC')} UTC`,
              deadline: `${i18n.dateTime(claim.deadlineAt, 'UTC')} UTC`,
            })}
          </dd>
        </div>
        <div>
          <dt className={styles['label']}>{i18n.t('backoffice.claim.cap')}</dt>
          <dd>
            {claim.guestCapMinor === null
              ? i18n.t('backoffice.claim.capUnknown')
              : money(i18n, claim, claim.guestCapMinor)}
          </dd>
        </div>
        <div>
          <dt className={styles['label']}>{i18n.t('backoffice.claim.description')}</dt>
          <dd>{claim.description}</dd>
        </div>
      </dl>
      <h3 className={styles['label']}>{i18n.t('backoffice.claim.evidenceHeading')}</h3>
      <EvidenceList i18n={i18n} evidence={claim.evidence} />
      {claim.decision !== null ? (
        <DecisionSummary i18n={i18n} claim={claim} decision={claim.decision} />
      ) : (
        <>
          <DecisionForm i18n={i18n} claim={claim} state={state} handlers={handlers} busy={busy} />
          {state.preview !== null && (
            <PreviewBlock
              i18n={i18n}
              state={state}
              handlers={handlers}
              busy={busy}
              isAdmin={isAdmin}
            />
          )}
        </>
      )}
    </>
  );
}

function LegsTable({
  i18n,
  id,
  v,
  legs,
}: {
  readonly i18n: Translator;
  readonly id: string;
  readonly v: { readonly currency: string; readonly exponent: number };
  readonly legs: Readonly<Record<string, string>>;
}) {
  return (
    <DataTable
      id={id}
      caption={i18n.t('backoffice.claim.legsCaption')}
      columns={[
        { key: 'leg', header: i18n.t('backoffice.claim.legColumn') },
        { key: 'amount', header: i18n.t('backoffice.claim.amountColumn'), align: 'end' },
      ]}
      rows={LEGS.map((leg) => ({
        id: leg,
        cells: { leg: labelOf(i18n, LEG_KEYS, leg), amount: money(i18n, v, legs[leg] ?? '0') },
      }))}
    />
  );
}

function ExcludedList({
  i18n,
  v,
  excluded,
}: {
  readonly i18n: Translator;
  readonly v: { readonly currency: string; readonly exponent: number };
  readonly excluded: readonly ClaimExcludedView[];
}) {
  if (excluded.length === 0) return null;
  return (
    <>
      <h4 className={styles['label']}>{i18n.t('backoffice.claim.excludedHeading')}</h4>
      <ul className={styles['list']} data-testid="claims-excluded">
        {excluded.map((x) => (
          <li key={`${x.category}:${x.rule}`}>
            {i18n.t('backoffice.claim.excludedLine', {
              line: labelOf(i18n, KEYS.line, x.category),
              amount: money(i18n, v, x.amountMinor),
              why: labelOf(i18n, KEYS.excludedRule, x.rule),
            })}
          </li>
        ))}
      </ul>
    </>
  );
}

function DecisionForm({
  i18n,
  claim,
  state,
  handlers,
  busy,
}: {
  readonly i18n: Translator;
  readonly claim: ClaimView;
  readonly state: ClaimsState;
  readonly handlers: ClaimsHandlers;
  readonly busy: boolean;
}) {
  const d = state.preview?.draft;
  const amountOf = (category: LineCategory): string =>
    majorOf(d?.lines.find((l) => l.category === category)?.amountMinor ?? '0', claim.exponent);
  return (
    <form
      className={styles['form']}
      aria-labelledby="claims-decision-heading"
      data-testid="claims-decision"
      // ux n° 1 : toute modification invalide l'aperçu ; l'enregistrement envoie ce qui est affiché
      onChange={() => handlers.onDecisionEdit()}
      onSubmit={(e) => {
        e.preventDefault();
        const lines = LINE_CATEGORIES.map((category) => ({
          category,
          amountMinor: minorOf(fieldOf(e, `line-${category}`), claim.exponent),
        }));
        const repair = minorOf(fieldOf(e, 'repairCost'), claim.exponent);
        const deductible = minorOf(fieldOf(e, 'hostDeductible'), claim.exponent);
        const outcome = oneOf(fieldOf(e, 'outcome'), OUTCOMES);
        if (
          outcome === null ||
          repair === null ||
          deductible === null ||
          lines.some((l) => l.amountMinor === null)
        ) {
          // montant illisible dans la devise : rien n'est envoyé
          handlers.onDecisionPreview(null);
          return;
        }
        const kept = lines
          .filter((l) => l.amountMinor !== '0')
          .map((l) => ({ category: l.category, amountMinor: l.amountMinor as string }));
        // montant débité : somme des lignes REFACTURABLES (la base le recompte et l'exige égal)
        const total = kept
          .filter((l) => l.category !== 'RECOVERY_PARKING' && l.category !== 'NOT_ATTRIBUTABLE')
          .reduce((s, l) => s + BigInt(l.amountMinor), 0n);
        handlers.onDecisionPreview({
          outcome,
          covered: new FormData(e.currentTarget).get('covered') === 'on',
          repairCostMinor: repair,
          amountMinor: total.toString(),
          lines: kept,
          hostDeductibleMinor: deductible,
          facts: fieldOf(e, 'facts'),
        });
      }}
    >
      <h3 id="claims-decision-heading" className={styles['label']}>
        {i18n.t('backoffice.claim.decisionHeading')}
      </h3>
      <p className={styles['muted']}>{i18n.t('backoffice.claim.decisionLead')}</p>
      <div className={styles['group']}>
        <label className={styles['label']} htmlFor="claims-outcome">
          {i18n.t('backoffice.claim.outcome')}
        </label>
        <select
          id="claims-outcome"
          name="outcome"
          defaultValue={d?.outcome ?? ''}
          required
          className={styles['select']}
        >
          <option value="" disabled>
            {i18n.t('backoffice.catalog.choose')}
          </option>
          {OUTCOMES.map((o) => (
            <option key={o} value={o}>
              {i18n.t(KEYS.outcome[o])}
            </option>
          ))}
        </select>
      </div>
      <Checkbox
        id="claims-covered"
        name="covered"
        defaultChecked={d?.covered ?? false}
        label={i18n.t('backoffice.claim.covered')}
      />
      <TextField
        i18n={i18n}
        id="claims-repair"
        name="repairCost"
        inputMode="decimal"
        autoComplete="off"
        optional
        defaultValue={majorOf(d?.repairCostMinor ?? '0', claim.exponent)}
        label={i18n.t('backoffice.claim.repairCost', { currency: claim.currency })}
        hint={amountHint(i18n, claim.exponent)}
      />
      <fieldset className={styles['group']}>
        <legend className={styles['label']}>{i18n.t('backoffice.claim.linesLegend')}</legend>
        {LINE_CATEGORIES.map((c) => (
          <TextField
            key={c}
            i18n={i18n}
            id={`claims-line-${c}`}
            name={`line-${c}`}
            inputMode="decimal"
            autoComplete="off"
            optional
            defaultValue={amountOf(c)}
            label={`${i18n.t(KEYS.line[c])} (${claim.currency})`}
            hint={amountHint(i18n, claim.exponent)}
          />
        ))}
      </fieldset>
      <TextField
        i18n={i18n}
        id="claims-deductible"
        name="hostDeductible"
        inputMode="decimal"
        autoComplete="off"
        optional
        defaultValue={majorOf(d?.hostDeductibleMinor ?? '0', claim.exponent)}
        label={i18n.t('backoffice.claim.hostDeductible', { currency: claim.currency })}
        hint={`${i18n.t('backoffice.claim.hostDeductibleHint')} ${amountHint(i18n, claim.exponent)}`}
      />
      <TextArea
        id="claims-facts"
        name="facts"
        maxLength={2000}
        rows={6}
        defaultValue={d?.facts}
        label={i18n.t('backoffice.claim.facts')}
        hint={i18n.t('backoffice.claim.factsHint')}
      />
      <div className={styles['actions']}>
        <Button type="submit" variant="secondary" loading={busy} data-testid="claims-preview">
          {i18n.t('backoffice.claim.preview')}
        </Button>
      </div>
    </form>
  );
}

function PreviewBlock({
  i18n,
  state,
  handlers,
  busy,
  isAdmin,
}: {
  readonly i18n: Translator;
  readonly state: ClaimsState;
  readonly handlers: ClaimsHandlers;
  readonly busy: boolean;
  readonly isAdmin: boolean;
}) {
  const p = state.preview;
  if (p === null) return null;
  const v = p.view;
  return (
    <section
      className={styles['group']}
      aria-labelledby="claims-template-heading"
      data-testid="claims-template"
    >
      <h3 id="claims-template-heading" className={styles['label']} tabIndex={-1}>
        {i18n.t('backoffice.claim.templateHeading')}
      </h3>
      <dl className={styles['list']}>
        <div>
          <dt className={styles['label']}>{i18n.t('backoffice.claim.template.facts')}</dt>
          <dd>{p.draft.facts}</dd>
        </div>
        <div>
          <dt className={styles['label']}>{i18n.t('backoffice.claim.template.rule')}</dt>
          <dd>{labelOf(i18n, KEYS.rule, v.outcome)}</dd>
        </div>
        <div>
          <dt className={styles['label']}>{i18n.t('backoffice.claim.template.amount')}</dt>
          <dd>
            {i18n.t('backoffice.claim.template.amountValue', {
              amount: money(i18n, v, v.amountMinor),
              cap: v.guestCapMinor === null ? '—' : money(i18n, v, v.guestCapMinor),
            })}
          </dd>
        </div>
        {v.hostDeductibleMinor !== '0' && (
          <div>
            <dt className={styles['label']}>
              {i18n.t('backoffice.claim.template.hostDeductible')}
            </dt>
            <dd>{money(i18n, v, v.hostDeductibleMinor)}</dd>
          </div>
        )}
        {v.covered && (
          <div>
            <dt className={styles['label']}>{i18n.t('backoffice.claim.template.insurer')}</dt>
            <dd>{i18n.t('backoffice.claim.template.insurerValue')}</dd>
          </div>
        )}
      </dl>
      <LegsTable i18n={i18n} id="claims-preview-legs" v={v} legs={v.legs} />
      <ExcludedList i18n={i18n} v={v} excluded={v.excluded} />
      <Banner tone="info" live="polite">
        {i18n.t('backoffice.claim.template.recourse')}
      </Banner>
      {v.adminRequired && !isAdmin ? (
        // ux n° 6 : un OPS voit avant l'envoi que la décision est réservée à un administrateur
        <Banner tone="warning" live="polite">
          {i18n.t('backoffice.claim.adminOnly')}
        </Banner>
      ) : (
        <>
          {/* ux n° 3 : confirmation explicite de l'effet, juste au-dessus du bouton */}
          {v.adminRequired && (
            <Banner tone="warning" live="polite">
              {i18n.t('backoffice.claim.confirm', {
                amount: money(i18n, v, v.amountMinor),
                retained: money(i18n, v, v.hostDeductibleMinor),
              })}
            </Banner>
          )}
          <p className={styles['muted']}>{i18n.t('backoffice.claim.executionNote')}</p>
          <div className={styles['actions']}>
            <Button
              variant="primary"
              loading={busy}
              data-testid="claims-issue"
              onClick={() => handlers.onDecisionIssue()}
            >
              {v.amountMinor === '0'
                ? i18n.t('backoffice.claim.issue')
                : i18n.t('backoffice.claim.issueCharge', { amount: money(i18n, v, v.amountMinor) })}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

function DecisionSummary({
  i18n,
  claim,
  decision,
}: {
  readonly i18n: Translator;
  readonly claim: ClaimView;
  readonly decision: ClaimDecisionView;
}) {
  return (
    <section
      className={styles['group']}
      aria-labelledby="claims-decided-heading"
      data-testid="claims-decided"
    >
      <h3 id="claims-decided-heading" className={styles['label']} tabIndex={-1}>
        {i18n.t('backoffice.claim.decidedHeading')}
      </h3>
      <dl className={styles['list']}>
        <div>
          <dt className={styles['label']}>{i18n.t('backoffice.claim.outcome')}</dt>
          <dd>{labelOf(i18n, KEYS.outcome, decision.outcome)}</dd>
        </div>
        <div>
          <dt className={styles['label']}>{i18n.t('backoffice.claim.template.amount')}</dt>
          <dd>{money(i18n, claim, decision.amountMinor)}</dd>
        </div>
        <div>
          <dt className={styles['label']}>{i18n.t('backoffice.claim.execution')}</dt>
          <dd>
            <Badge
              tone={
                decision.execution === 'DONE'
                  ? 'success'
                  : decision.execution === 'BLOCKED'
                    ? 'warning'
                    : 'neutral'
              }
              icon={null}
            >
              {labelOf(i18n, KEYS.execution, decision.execution)}
            </Badge>
          </dd>
        </div>
        {decision.insurerDeclaration !== null && (
          <div>
            <dt className={styles['label']}>{i18n.t('backoffice.claim.template.insurer')}</dt>
            <dd>{labelOf(i18n, KEYS.insurer, decision.insurerDeclaration)}</dd>
          </div>
        )}
      </dl>
      <LegsTable i18n={i18n} id="claims-decided-legs" v={claim} legs={decision.legs} />
      <ExcludedList i18n={i18n} v={claim} excluded={decision.excluded} />
      <Banner tone="info" live="polite">
        {i18n.t('backoffice.claim.template.recourse')}
      </Banner>
    </section>
  );
}
