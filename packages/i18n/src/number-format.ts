import type { NumberProfile } from './locale-profile.ts';

/**
 * Groupe une partie entière (chaîne de chiffres ASCII) selon le profil. Pure manipulation de
 * chaîne : aucune arithmétique, aucun flottant.
 */
export function groupDigits(integerDigits: string, profile: NumberProfile): string {
  if (!/^\d+$/.test(integerDigits)) {
    throw new RangeError(`Chiffres attendus, reçu « ${integerDigits} ».`);
  }
  if (integerDigits.length - 3 < profile.minimumGroupingDigits) return integerDigits;
  const groups: string[] = [];
  let end = integerDigits.length;
  while (end > 0) {
    groups.unshift(integerDigits.slice(Math.max(0, end - 3), end));
    end -= 3;
  }
  return groups.join(profile.group);
}

/** Assemble « entier[décimale fraction] » ; `fraction` vide → pas de séparateur décimal. */
export function joinDecimal(
  integerDigits: string,
  fraction: string,
  profile: NumberProfile,
): string {
  const grouped = groupDigits(integerDigits, profile);
  return fraction.length > 0 ? `${grouped}${profile.decimal}${fraction}` : grouped;
}

// Locale technique servant seulement à obtenir des chiffres ASCII sans séparateur ; les
// séparateurs affichés sont ceux du profil (ce n'est pas une locale d'affichage).
const PLAIN_DIGITS_LOCALE = 'en-US-u-nu-latn';

export interface FormatNumberOptions {
  /** Nombre de décimales affichées (0 par défaut) ; l'arrondi d'affichage est celui d'Intl. */
  readonly fractionDigits?: number;
}

/**
 * Formate une quantité **non monétaire** (kilomètres, compteurs, jours) avec les séparateurs du
 * profil. Pour un montant, utiliser `formatMoney` (unités mineures, aucun arrondi).
 */
export function formatNumber(
  value: number | bigint,
  profile: NumberProfile,
  options: FormatNumberOptions = {},
): string {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new RangeError('Nombre fini attendu.');
  }
  const digits = options.fractionDigits ?? 0;
  const plain = new Intl.NumberFormat(PLAIN_DIGITS_LOCALE, {
    useGrouping: false,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
  const negative = plain.startsWith('-');
  const unsigned = negative ? plain.slice(1) : plain;
  const [integerPart = '0', fraction = ''] = unsigned.split('.');
  const body = joinDecimal(integerPart, fraction, profile);
  // « -0 » après arrondi d'affichage : on n'affiche pas de signe pour une valeur nulle.
  return negative && /[1-9]/.test(unsigned) ? `-${body}` : body;
}
