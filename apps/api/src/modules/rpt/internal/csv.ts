/**
 * Export CSV des vues de la bêta et du rapprochement (US-311, ADR-194 ; 17 §2.2 « exports CSV »).
 *
 * - En-têtes = clés stables des lignes (jamais traduites : le fichier est relu par un tableur ou
 *   un script du comptable ; les libellés de l'écran sont dans le catalogue).
 * - RFC 4180 : séparateur virgule, fin de ligne CRLF, champ entre guillemets s'il contient une
 *   virgule, un guillemet, un retour à la ligne ; guillemet doublé.
 * - Injection de formule (OWASP « CSV injection ») : une cellule TEXTE qui commence par `=`, `+`,
 *   `-`, `@`, tabulation ou retour chariot est préfixée d'une apostrophe. Les montants sont des
 *   entiers en unités mineures (chaînes de chiffres), jamais des flottants, et ne sont pas
 *   préfixés (aucun montant négatif n'est exporté).
 * - Valeur absente (`null`, `undefined`) : champ vide ; booléen : `true` / `false` ; objet : JSON.
 */
const FORMULA = /^[=+\-@\t\r]/;
const QUOTE = /[",\r\n]/;

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text: string;
  if (typeof value === 'string') {
    text = FORMULA.test(value) ? `'${value}` : value;
  } else if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    text = String(value);
  } else {
    const json = JSON.stringify(value);
    text = FORMULA.test(json) ? `'${json}` : json;
  }
  return QUOTE.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Fichier CSV : colonnes dans l'ordre donné ; une colonne absente d'une ligne reste vide. */
export function toCsv(
  columns: readonly string[],
  rows: readonly Readonly<Record<string, unknown>>[],
): string {
  const lines = [columns.map(cell).join(',')];
  for (const row of rows) lines.push(columns.map((c) => cell(row[c])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

/** Colonnes de chaque export (ordre du fichier). Aucune donnée personnelle. */
export const CSV_COLUMNS = {
  HANDOVERS_TODAY: [
    'orgId',
    'tripRef',
    'tripId',
    'vehicleId',
    'kind',
    'plannedAt',
    'status',
    'hostValidated',
    'guestValidated',
    'keysAt',
  ],
  OVERDUE: [
    'tripRef',
    'tripId',
    'orgId',
    'vehicleId',
    'status',
    'stage',
    'scheduledEnd',
    'detectedAt',
    'minutesLate',
    'useUntil',
    'bounded',
    'nextTripId',
  ],
  EXIT_KPI: [
    'code',
    'measurable',
    'value',
    'threshold',
    'met',
    'doubleBookings',
    'keysWithoutPayment',
    'monthsClosed',
    'dailyReconciliationRequired',
  ],
  OPERATIONS: [
    'reference',
    'kind',
    'purpose',
    'amountMinor',
    'currency',
    'tripId',
    'tripRef',
    'createdAt',
  ],
  LEGS: [
    'tripId',
    'tripRef',
    'leg',
    'currency',
    'capturedMinor',
    'refundedMinor',
    'reallocatedInMinor',
    'reallocatedOutMinor',
    'releasedMinor',
    'frozen',
  ],
  RUN_ITEMS: [
    'itemId',
    'side',
    'ref',
    'leg',
    'component',
    'expectedMinor',
    'observedMinor',
    'deltaMinor',
    'status',
    'finding',
    'resolution',
    'resolvedAt',
  ],
} as const;
