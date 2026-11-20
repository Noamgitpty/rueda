/**
 * Console : no-show et refus du véhicule (US-307, ADR-191 ; 16 TRP-015, TRP-007 ; 19 US-307). Deux
 * actions de domaine du cadre d'US-101, chacune à saisie FERMÉE (catalogue de 0171) :
 *   - `DECLARE_NO_SHOW` : partie absente (`absentParty` GUEST ou HOST) ;
 *   - `REFUSE_AT_PICKUP` : motif du refus (`refusalReason` : propreté, sécurité, permis non conforme,
 *     identité non vérifiée, autre conducteur envoyé).
 * Aucun montant n'est saisi : la base dérive le motif, lit les délais en heure serveur et règle la
 * demande par le moteur unique (remboursement par jambe, pénalité de l'hôte au host_ledger). Une
 * pièce jointe est la « preuve validée » d'un refus pour permis (T07, sinon T08) et d'un no-show de
 * l'hôte déclaré par l'ops. Panneau des rôles qui détiennent `trip.declare_no_show` et
 * `kyc.license_check_at_handover` (OPS_AGENT, ADMIN ; la base reste juge).
 */
import { useState } from 'react';
import type { FormEvent } from 'react';
import type { MessageKey, Translator } from '@rueda/i18n';
import { Button, TextField } from '@rueda/ui';
import styles from './console.module.css';

/** Rôles qui détiennent les deux permissions (17 §2.3 ; la base reste juge). */
export const NO_SHOW_ROLES = new Set(['OPS_AGENT', 'ADMIN']);

/** Choix fermés de la console → action et saisie du catalogue (0171) ; jamais un montant. */
export const NO_SHOW_CHOICES = {
  NO_SHOW_GUEST: { action: 'DECLARE_NO_SHOW', input: { absentParty: 'GUEST' } },
  NO_SHOW_HOST: { action: 'DECLARE_NO_SHOW', input: { absentParty: 'HOST' } },
  // rejet du signalement du voyageur en attente (l'hôte était là) : aucune annulation
  NO_SHOW_REJECT_REPORT: { action: 'DECLARE_NO_SHOW', input: { absentParty: 'NONE' } },
  REFUSE_CLEANLINESS: { action: 'REFUSE_AT_PICKUP', input: { refusalReason: 'CLEANLINESS' } },
  REFUSE_SAFETY: { action: 'REFUSE_AT_PICKUP', input: { refusalReason: 'SAFETY' } },
  REFUSE_INVALID_LICENSE: {
    action: 'REFUSE_AT_PICKUP',
    input: { refusalReason: 'INVALID_LICENSE' },
  },
  REFUSE_IDENTITY_NOT_VERIFIED: {
    action: 'REFUSE_AT_PICKUP',
    input: { refusalReason: 'IDENTITY_NOT_VERIFIED' },
  },
  REFUSE_OTHER_DRIVER_SENT: {
    action: 'REFUSE_AT_PICKUP',
    input: { refusalReason: 'OTHER_DRIVER_SENT' },
  },
} as const;
export type NoShowChoice = keyof typeof NO_SHOW_CHOICES;
export const NO_SHOW_CHOICE_LIST = Object.keys(NO_SHOW_CHOICES) as NoShowChoice[];

const CHOICE_KEYS: Readonly<Record<NoShowChoice, MessageKey>> = {
  NO_SHOW_GUEST: 'backoffice.noShow.choice.NO_SHOW_GUEST',
  NO_SHOW_HOST: 'backoffice.noShow.choice.NO_SHOW_HOST',
  NO_SHOW_REJECT_REPORT: 'backoffice.noShow.choice.NO_SHOW_REJECT_REPORT',
  REFUSE_CLEANLINESS: 'backoffice.noShow.choice.REFUSE_CLEANLINESS',
  REFUSE_SAFETY: 'backoffice.noShow.choice.REFUSE_SAFETY',
  REFUSE_INVALID_LICENSE: 'backoffice.noShow.choice.REFUSE_INVALID_LICENSE',
  REFUSE_IDENTITY_NOT_VERIFIED: 'backoffice.noShow.choice.REFUSE_IDENTITY_NOT_VERIFIED',
  REFUSE_OTHER_DRIVER_SENT: 'backoffice.noShow.choice.REFUSE_OTHER_DRIVER_SENT',
};

/** Refus des commandes liées expliqués (issue de la base, 0171). */
export const NO_SHOW_REFUSAL_KEYS: Readonly<Record<string, MessageKey>> = {
  NO_SHOW_TOO_EARLY: 'backoffice.noShow.refused.NO_SHOW_TOO_EARLY',
  NO_SHOW_WINDOW_CLOSED: 'backoffice.noShow.refused.NO_SHOW_WINDOW_CLOSED',
  NO_SHOW_PARTY_PRESENT: 'backoffice.noShow.refused.NO_SHOW_PARTY_PRESENT',
  NO_SHOW_PARTY_REQUIRED: 'backoffice.noShow.refused.NO_SHOW_PARTY_REQUIRED',
  REFUSAL_REASON_REQUIRED: 'backoffice.noShow.refused.REFUSAL_REASON_REQUIRED',
  REFUSAL_AFTER_CHECKIN: 'backoffice.noShow.refused.REFUSAL_AFTER_CHECKIN',
  CHECKIN_NOT_OPEN: 'backoffice.noShow.refused.CHECKIN_NOT_OPEN',
  TRIP_TRANSITION_FORBIDDEN: 'backoffice.noShow.refused.TRIP_TRANSITION_FORBIDDEN',
  CANCELLATION_PENDING: 'backoffice.noShow.refused.CANCELLATION_PENDING',
  SELF_FORBIDDEN: 'backoffice.noShow.refused.SELF_FORBIDDEN',
  NOT_FOUND: 'backoffice.noShow.refused.NOT_FOUND',
  NO_REPORT_PENDING: 'backoffice.noShow.refused.NO_REPORT_PENDING',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Saisie relue avant l'envoi (revue ux n° 1 : confirmation explicite, comme cancel-view.tsx). */
export interface NoShowDraft {
  readonly tripId: string;
  readonly choice: NoShowChoice;
  readonly reason: string;
  readonly evidence: readonly string[];
}

/** Récapitulatif à confirmer : trip, choix, conséquence irréversible ; envoyer ou corriger. */
export function NoShowConfirm({
  i18n,
  busy,
  draft,
  onSend,
  onBack,
}: {
  readonly i18n: Translator;
  readonly busy: boolean;
  readonly draft: NoShowDraft;
  readonly onSend: () => void;
  readonly onBack: () => void;
}) {
  return (
    <div className={styles['form']} role="group" aria-labelledby="no-show-confirm-title">
      <h3 id="no-show-confirm-title" className={styles['label']}>
        {i18n.t('backoffice.noShow.confirm.title')}
      </h3>
      <p data-testid="no-show-confirm-trip">
        {i18n.t('backoffice.noShow.confirm.trip', { trip: draft.tripId })}
      </p>
      <p className={styles['label']}>{i18n.t(CHOICE_KEYS[draft.choice])}</p>
      <p className={styles['muted']}>{i18n.t('backoffice.noShow.confirm.irreversible')}</p>
      <div className={styles['actions']}>
        <Button type="button" variant="primary" loading={busy} onClick={onSend}>
          {i18n.t('backoffice.noShow.confirm.send')}
        </Button>
        <Button type="button" variant="secondary" onClick={onBack}>
          {i18n.t('backoffice.noShow.confirm.back')}
        </Button>
      </div>
    </div>
  );
}

export type NoShowSubmit = (
  tripId: string,
  choice: NoShowChoice,
  reason: string,
  evidence: readonly string[],
) => void;

const fieldOf = (e: FormEvent<HTMLFormElement>, name: string): string => {
  const v = new FormData(e.currentTarget).get(name);
  return typeof v === 'string' ? v : '';
};
const evidenceOf = (raw: string): string[] => [
  ...new Set(
    raw
      .split(/[\s,]+/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean),
  ),
];

export function NoShowPanel({
  i18n,
  busy,
  onSubmit,
}: {
  readonly i18n: Translator;
  readonly busy: boolean;
  readonly onSubmit: NoShowSubmit;
}) {
  const [draft, setDraft] = useState<NoShowDraft | null>(null);
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const groups: readonly [MessageKey, readonly NoShowChoice[]][] = [
    [
      'backoffice.action.DECLARE_NO_SHOW',
      ['NO_SHOW_GUEST', 'NO_SHOW_HOST', 'NO_SHOW_REJECT_REPORT'],
    ],
    [
      'backoffice.action.REFUSE_AT_PICKUP',
      [
        'REFUSE_CLEANLINESS',
        'REFUSE_SAFETY',
        'REFUSE_INVALID_LICENSE',
        'REFUSE_IDENTITY_NOT_VERIFIED',
        'REFUSE_OTHER_DRIVER_SENT',
      ],
    ],
  ];
  return (
    <section className={styles['panel']} aria-labelledby="no-show-heading">
      <h2 id="no-show-heading" className={styles['heading']}>
        {i18n.t('backoffice.noShow.heading')}
      </h2>
      <p className={styles['muted']}>{i18n.t('backoffice.noShow.hint')}</p>
      {draft !== null ? (
        <NoShowConfirm
          i18n={i18n}
          busy={busy}
          draft={draft}
          onSend={() => {
            onSubmit(draft.tripId, draft.choice, draft.reason, draft.evidence);
            setDraft(null);
          }}
          onBack={() => setDraft(null)}
        />
      ) : (
        <form
          className={styles['form']}
          onSubmit={(e) => {
            e.preventDefault();
            const choice = new FormData(e.currentTarget).get('noShowChoice');
            const tripId = fieldOf(e, 'tripId').trim().toLowerCase();
            if (!UUID.test(tripId)) {
              setProblem('backoffice.noShow.tripInvalid');
              return;
            }
            if ((NO_SHOW_CHOICE_LIST as readonly unknown[]).includes(choice)) {
              setProblem(null);
              // aucun envoi ici : la saisie est relue puis confirmée (NoShowConfirm)
              setDraft({
                tripId,
                choice: choice as NoShowChoice,
                reason: fieldOf(e, 'reason'),
                evidence: evidenceOf(fieldOf(e, 'evidence')),
              });
            }
          }}
        >
          <TextField
            i18n={i18n}
            id="no-show-trip"
            name="tripId"
            autoComplete="off"
            spellCheck={false}
            label={i18n.t('backoffice.noShow.subject')}
            {...(problem === null ? {} : { error: i18n.t(problem) })}
          />
          {groups.map(([legend, choices]) => (
            <fieldset key={legend} className={styles['checks']}>
              <legend className={styles['label']}>{i18n.t(legend)}</legend>
              {choices.map((c) => (
                <label key={c} className={styles['choice']}>
                  <input
                    type="radio"
                    name="noShowChoice"
                    value={c}
                    required
                    className={styles['choiceInput']}
                  />
                  <span>{i18n.t(CHOICE_KEYS[c])}</span>
                </label>
              ))}
            </fieldset>
          ))}
          <TextField
            i18n={i18n}
            id="no-show-reason"
            name="reason"
            minLength={10}
            maxLength={1000}
            label={i18n.t('backoffice.action.reason')}
            hint={i18n.t('backoffice.action.reasonHint')}
          />
          <TextField
            i18n={i18n}
            id="no-show-evidence"
            name="evidence"
            autoComplete="off"
            spellCheck={false}
            optional
            label={i18n.t('backoffice.action.evidence')}
            hint={i18n.t('backoffice.noShow.evidenceHint')}
          />
          <p className={styles['muted']}>{i18n.t('backoffice.noShow.settleNote')}</p>
          <div className={styles['actions']}>
            <Button type="submit" variant="primary" loading={busy}>
              {i18n.t('backoffice.noShow.next')}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
