/**
 * Reprise gardée après une restauration (US-402, ADR-206 PROPOSÉ ; L4-PM-19, L4-PM-20 ; 17 §6.4).
 *
 * - `recoveryStatus` : état de la garde de la migration 0185 (active, lignes de temps attendue et
 *   courante, gardes explicites ouvertes), lu sous `app_worker` comme le verrait un travailleur ;
 * - `inFlightInventory` : ce qui ATTEND d'être émis sur la base restaurée et qui sera repris à la
 *   levée (événements non publiés, tâches en file, commandes d'argent non finales par type,
 *   versements engagés, avis en file) ; lecture seule sous l'administration, comptes seulement
 *   (aucune donnée personnelle, aucun montant) ;
 * - `controlStateLines` : tables de l'état de contrôle à relire après restauration (L4-PM-20) :
 *   interrupteurs, demandes de bascule, accès du staff ; jamais modifiées ici (contrainte 7) ;
 * - `releaseDecision` : décision PURE de levée. La levée exige que le rapprochement avec le PSP
 *   soit attesté (FAKE en bêta ; lecture réelle des opérations du PSP au lot C, N-420), ET que la
 *   fenêtre d'idempotence du PSP couvre encore les commandes perdues (hypothèse H-IDEM ci-dessous),
 *   sinon un relevé complet des opérations du PSP depuis l'instant restauré.
 *
 * Hypothèse H-IDEM (PROPOSÉE, à valider à la porte go / no-go du PSP, lot C) : le PSP déduplique
 * une même clé d'idempotence pendant au moins W secondes après son premier usage (capacité à
 * déclarer, inconnue = 0 = aucune garantie). Une commande exécutée au PSP APRÈS l'instant restauré
 * T et absente de la base est, à la reprise, recréée par son processus avec la MÊME clé (clés
 * déterministes : trip, segment, version, type, moyen, rang d'instance, rang de tentative ; 08 E4).
 * Son premier usage date d'au moins T ; elle est réémise au plus tôt à la levée. Tant que
 * (levée − T) + marge < W, le PSP rend l'opération existante : aucun second effet. Au-delà, seule
 * une lecture complète des opérations du PSP depuis T le garantit : sans elle, la levée est refusée.
 */
import type pg from 'pg';
import type { RestoreCheck } from './verify.ts';

export interface RecoveryStatus {
  readonly active: boolean;
  readonly expectedTimeline: number | null;
  readonly currentTimeline: number | null;
  readonly openHolds: number;
}

/** État de la garde, tel que le voit `app_worker` (fonction de 0185). */
export async function recoveryStatus(worker: pg.ClientBase): Promise<RecoveryStatus> {
  const { rows } = await worker.query<{
    active: boolean;
    expected_timeline: number | null;
    current_timeline: number | null;
    open_holds: number;
  }>(
    'SELECT active, expected_timeline, current_timeline, open_holds FROM platform.recovery_status()',
  );
  const r = rows[0];
  if (r === undefined) throw new Error('platform.recovery_status() sans résultat');
  return {
    active: r.active,
    expectedTimeline: r.expected_timeline,
    currentTimeline: r.current_timeline,
    openHolds: r.open_holds,
  };
}

/** Contrôle informatif du rapport de vérification : la garde est-elle levée ? (jamais bloquant). */
export function recoveryCheck(s: RecoveryStatus): RestoreCheck {
  return {
    name: 'garde de reprise (US-402)',
    ok: true,
    detail: s.active
      ? `ACTIVE (ligne de temps attendue ${String(s.expectedTimeline)}, courante ${String(s.currentTimeline)}, gardes ouvertes ${String(s.openHolds)}) : aucune tâche réclamée jusqu'à la levée après rapprochement`
      : 'inactive (aucune restauration détectée, aucune garde ouverte)',
  };
}

export interface InFlightLine {
  readonly category: 'outbox' | 'job' | 'money' | 'payout' | 'notification';
  readonly key: string;
  readonly count: number;
}

/**
 * Ce qui attend d'être émis. Sous l'administration, transaction en lecture seule ; comptes
 * groupés seulement. Commandes d'argent non finales : `PENDING` (enregistrée, peut-être envoyée
 * après T), `SUBMITTED` et `UNKNOWN` (en vol) ; versements engagés : lots `READY`, `INITIATED`,
 * `IN_TRANSIT` ; avis : `QUEUED`.
 */
export const IN_FLIGHT_SQL = `
  SELECT 'outbox' AS category, 'non publiés' AS key, count(*)::integer AS count
    FROM core.outbox_outbox_event WHERE published_at IS NULL
  UNION ALL
  SELECT 'job', name || ':' || state, count(*)::integer
    FROM core.outbox_scheduled_job WHERE state IN ('CREATED', 'ACTIVE') GROUP BY name, state
  UNION ALL
  SELECT 'money', kind || ':' || status, count(*)::integer
    FROM core.payment_payment_operation WHERE status IN ('PENDING', 'SUBMITTED', 'UNKNOWN')
   GROUP BY kind, status
  UNION ALL
  SELECT 'payout', status, count(*)::integer
    FROM core.payout_payout_batch WHERE status IN ('READY', 'INITIATED', 'IN_TRANSIT')
   GROUP BY status
  UNION ALL
  SELECT 'notification', status, count(*)::integer
    FROM core.ntf_notification_dispatch WHERE status = 'QUEUED' GROUP BY status
  ORDER BY 1, 2`;

export async function inFlightInventory(admin: pg.ClientBase): Promise<InFlightLine[]> {
  await admin.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const { rows } = await admin.query<InFlightLine>(IN_FLIGHT_SQL);
    return rows.filter((r) => r.count > 0);
  } finally {
    await admin.query('ROLLBACK');
  }
}

export interface ReleaseInput {
  /** Instant restauré T (cible de la restauration, ou dernière écriture rendue). */
  readonly restoredToMs: number;
  /** Heure de la levée (horloge de la base). */
  readonly nowMs: number;
  /** Fenêtre d'idempotence W du PSP (s) ; `null` ou 0 = inconnue = aucune garantie. */
  readonly idempotencyWindowS: number | null;
  /** Rapprochement attesté : chaque commande en vol lue au PSP (FAKE en bêta ; N-420 au lot C). */
  readonly reconciledWithPsp: boolean;
  /** Relevé complet des opérations du PSP depuis T, rapproché (lot C) : couvre les commandes perdues. */
  readonly pspListingSinceRestore: boolean;
}

export type ReleaseDecision =
  | { readonly allowed: true; readonly basis: 'IDEMPOTENCY_WINDOW' | 'PSP_LISTING' }
  | {
      readonly allowed: false;
      readonly reason:
        'NOT_RECONCILED' | 'IDEMPOTENCY_WINDOW_UNKNOWN' | 'IDEMPOTENCY_WINDOW_ELAPSED';
    };

/** Marge de sûreté sur W (horloges, délai entre la levée et la première réémission). PROPOSÉ. */
export const RELEASE_MARGIN_S = 3600;

export function releaseDecision(i: ReleaseInput): ReleaseDecision {
  if (!i.reconciledWithPsp) return { allowed: false, reason: 'NOT_RECONCILED' };
  if (i.pspListingSinceRestore) return { allowed: true, basis: 'PSP_LISTING' };
  const w = i.idempotencyWindowS;
  if (w === null || !Number.isFinite(w) || w <= 0) {
    return { allowed: false, reason: 'IDEMPOTENCY_WINDOW_UNKNOWN' };
  }
  const elapsedS = (i.nowMs - i.restoredToMs) / 1000;
  if (!(elapsedS >= 0) || elapsedS + RELEASE_MARGIN_S >= w) {
    return { allowed: false, reason: 'IDEMPOTENCY_WINDOW_ELAPSED' };
  }
  return { allowed: true, basis: 'IDEMPOTENCY_WINDOW' };
}

/**
 * Tables de l'état de contrôle à RELIRE après restauration (L4-PM-20) : interrupteurs et demandes de
 * bascule, accès du staff. Liste de contrôle de l'opérateur (noms seulement) ; rien n'est modifié.
 */
export async function controlStateLines(admin: pg.ClientBase): Promise<string[]> {
  await admin.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const { rows } = await admin.query<{ line: string }>(
      `SELECT n.nspname || '.' || c.relname AS line
         FROM pg_catalog.pg_class AS c JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND n.nspname IN ('core', 'platform')
          AND (c.relname LIKE '%go_live%' OR c.relname LIKE '%switch%'
               OR c.relname LIKE 'iam_staff%')
        ORDER BY 1`,
    );
    return rows.map((r) => r.line);
  } finally {
    await admin.query('ROLLBACK');
  }
}
