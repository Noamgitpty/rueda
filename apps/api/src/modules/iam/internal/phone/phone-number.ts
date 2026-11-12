/**
 * Numéro de téléphone de l'OTP (US-104, ADR-098 ; 16 VER-013 « saisie E.164 » ; 10b W3 « indicatif
 * pré-rempli selon le pays, format local du numéro ») : normalisation E.164 d'après le plan de
 * numérotation du PAYS du parcours (`countries.json`, champ `phone`), jamais une constante du code.
 *
 * Saisies acceptées (espaces, tirets, points et parenthèses ignorés) :
 *   - forme internationale `+<indicatif><numéro national>` ou `00<indicatif><numéro national>` ;
 *   - forme nationale, avec ou sans le préfixe interurbain du pays (ex. `0` au Paraguay).
 * Le numéro national doit avoir la longueur d'un MOBILE du pays et commencer par l'un de ses
 * premiers chiffres : seuls les mobiles du pays reçoivent un OTP par SMS (parade au SMS pumping
 * vers des lignes fixes, surtaxées ou d'un autre pays, PROPOSÉ). Un indicatif d'un autre pays est
 * refusé : le voyageur choisit le pays du numéro dans le formulaire.
 */
import type { PhoneNumberingConfig } from '../../../cfg/index.js';

export type PhoneParse =
  { readonly ok: true; readonly e164: string; readonly prefix: string } | { readonly ok: false };

// espaces (insécables compris : \s les couvre), points, tirets, parenthèses
const SEPARATORS = /[\s.\-()]/g;
const MAX_INPUT = 32;

export function normalizePhone(input: unknown, plan: PhoneNumberingConfig): PhoneParse {
  if (typeof input !== 'string' || input.length > MAX_INPUT) return { ok: false };
  const compact = input.trim().replace(SEPARATORS, '');
  let national: string;
  if (compact.startsWith('+') || compact.startsWith('00')) {
    const digits = compact.startsWith('+') ? compact.slice(1) : compact.slice(2);
    if (!/^[0-9]+$/.test(digits) || !digits.startsWith(plan.callingCode)) return { ok: false };
    national = digits.slice(plan.callingCode.length);
  } else {
    if (!/^[0-9]+$/.test(compact)) return { ok: false };
    national = compact;
    const trunk = plan.trunkPrefix;
    if (
      trunk !== null &&
      national.length === trunk.length + plan.nationalLength &&
      national.startsWith(trunk)
    ) {
      national = national.slice(trunk.length);
    }
  }
  if (
    national.length !== plan.nationalLength ||
    !plan.mobilePrefixes.some((p) => national.startsWith(p))
  ) {
    return { ok: false };
  }
  return { ok: true, e164: `+${plan.callingCode}${national}`, prefix: `+${plan.callingCode}` };
}

/**
 * Numéro masqué pour l'affichage (10b S15 `web.s15.codeSent` « Código enviado a {phone} ») :
 * indicatif et deux derniers chiffres seulement (minimisation, C2).
 */
export function maskPhone(e164: string, plan: PhoneNumberingConfig | undefined): string {
  const digits = e164.replace(/^\+/, '');
  const code =
    plan !== undefined && digits.startsWith(plan.callingCode)
      ? plan.callingCode
      : digits.slice(0, 3);
  const national = digits.slice(code.length);
  const hidden = Math.max(0, national.length - 2);
  return `+${code} ${'•'.repeat(hidden)}${national.slice(hidden)}`;
}
