/**
 * Codes d'erreur du moteur de règlement (US-017). Stables, SCREAMING_SNAKE_CASE, sans préfixe.
 * `REJECTED_TOO_EARLY` vient de 08 (`qualify`, règle 3) ; les autres sont PROPOSÉS (à reporter
 * au catalogue de 16 A.8 par une demande de fusion sur `docs/specs/`).
 */
export const SETTLEMENT_ERROR_CODES = [
  /** PROPOSÉ : motif hors du sous-ensemble bêta (moteur complet : US-518). */
  'SETTLEMENT_REASON_NOT_SUPPORTED',
  /** PROPOSÉ : entrée incomplète ou incohérente (drapeau requis absent, horodatage, total payé). */
  'SETTLEMENT_INPUT_INVALID',
  /** PROPOSÉ : paramètre requis absent ou invalide (barème de pénalité, part assureur). */
  'SETTLEMENT_CONFIG_INVALID',
  /** 08 `qualify` règle 3 : no-show déclaré avant `noShowAt` hors sous-motif de retrait. */
  'REJECTED_TOO_EARLY',
  /** PROPOSÉ : invariant d'équilibre violé (`remboursement + retenu + taxe retenue ≠ total`). */
  'SETTLEMENT_UNBALANCED',
] as const;

export type SettlementErrorCode = (typeof SETTLEMENT_ERROR_CODES)[number];

export class SettlementError extends Error {
  readonly code: SettlementErrorCode;

  constructor(code: SettlementErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'SettlementError';
    this.code = code;
  }
}

export function isSettlementError(
  error: unknown,
  code?: SettlementErrorCode,
): error is SettlementError {
  return error instanceof SettlementError && (code === undefined || error.code === code);
}
