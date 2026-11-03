/**
 * Détecteur et masque de PAN (17 §1.6 portée SAQ A ; §4.4 point 3, corrigé VERIF_14-F26).
 *
 * Définition (identique à `core.payment_text_has_pan`, migration 0029, qui la vérifie en base par
 * la contrainte `webhook_inbox_no_pan`) :
 * 1. les UUID (8-4-4-4-12 hexadécimaux, non collés à une lettre ou un chiffre) sont écartés : un
 *    identifiant `evt-<uuid>` n'est jamais un PAN (faux positif de 0028, environ 0,25 %) ;
 * 2. suites maximales de groupes de chiffres séparés par UN espace ou UN tiret ;
 * 3. fenêtre de groupes consécutifs à la forme d'une carte : un groupe de 13 à 19 chiffres
 *    contigus, ou des groupes de 4 terminés par un groupe de 1 à 4 (4-4-4-4, 4-4-4-4-3), ou
 *    4-6-5 (Amex) ou 4-6-4 (Diners), 13 à 19 chiffres au total ;
 * 4. préfixe d'émetteur connu (Visa, Mastercard, Maestro, Amex, Diners, JCB, Discover, UnionPay,
 *    RuPay ; regroupés au plus large) ;
 * 5. contrôle de Luhn valide.
 * Le masque garde les 6 premiers et les 4 derniers chiffres (affichage admis par 17 §1.6) et
 * remplace les autres par `*` ; il est répété jusqu'à ce que `containsPan` soit faux.
 */

const UUID_SOURCE =
  '(?<![0-9A-Za-z])[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}(?![0-9A-Za-z])';
const UUID_ANY = new RegExp(UUID_SOURCE, 'g');
/** Découpe en conservant les UUID (indices impairs du résultat de `split`). */
const UUID_SPLIT = new RegExp(`(${UUID_SOURCE})`);
const RUN = /[0-9]+(?:[ -][0-9]+)*/g;
const ISSUER = /^(4|5|6|3(0[0-5]|[4-9])|2(22[1-9]|2[3-9][0-9]|[3-6][0-9]{2}|7[01][0-9]|720)|8[12])/;

export function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Forme d'une carte pour une fenêtre de groupes (longueurs). */
export function cardShape(lengths: readonly number[]): boolean {
  const total = lengths.reduce((a, b) => a + b, 0);
  if (total < 13 || total > 19) return false;
  if (lengths.length === 1) return true;
  if (
    lengths.length === 3 &&
    lengths[0] === 4 &&
    lengths[1] === 6 &&
    (lengths[2] === 4 || lengths[2] === 5)
  ) {
    return true;
  }
  const last = lengths[lengths.length - 1] ?? 0;
  return last >= 1 && last <= 4 && lengths.slice(0, -1).every((l) => l === 4);
}

function isPan(groups: readonly string[]): boolean {
  if (!cardShape(groups.map((g) => g.length))) return false;
  const digits = groups.join('');
  return ISSUER.test(digits) && luhnValid(digits);
}

/** Première fenêtre PAN d'une suite (la plus longue à chaque départ), ou null. */
function findPan(groups: readonly string[], from: number): { s: number; e: number } | null {
  for (let s = from; s < groups.length; s++) {
    for (let e = groups.length - 1; e >= s; e--) {
      if (isPan(groups.slice(s, e + 1))) return { s, e };
    }
  }
  return null;
}

export function containsPan(text: string): boolean {
  for (const m of text.replace(UUID_ANY, ' ').matchAll(RUN)) {
    if (findPan(m[0].split(/[ -]/), 0) !== null) return true;
  }
  return false;
}

/** Une passe de masque sur un texte sans UUID. */
function maskOnce(text: string): { text: string; masked: number } {
  let masked = 0;
  const out = text.replace(RUN, (run) => {
    const groups = run.split(/[ -]/);
    const seps = run.match(/[ -]/g) ?? [];
    let res = '';
    let i = 0;
    for (let w = findPan(groups, 0); w !== null; w = findPan(groups, i)) {
      for (let k = i; k < w.s; k++) res += (groups[k] ?? '') + (seps[k] ?? '');
      const digits = groups.slice(w.s, w.e + 1).join('');
      res += `${digits.slice(0, 6)}${'*'.repeat(digits.length - 10)}${digits.slice(-4)}`;
      res += seps[w.e] ?? '';
      masked += 1;
      i = w.e + 1;
    }
    for (let k = i; k < groups.length; k++) res += (groups[k] ?? '') + (seps[k] ?? '');
    return res;
  });
  return { text: out, masked };
}

/** Masque chaque PAN détecté (les UUID restent intacts) ; rend aussi le nombre de masques posés. */
export function maskPan(text: string): { readonly text: string; readonly masked: number } {
  let masked = 0;
  const parts = text.split(UUID_SPLIT).map((part, i) => {
    if (i % 2 === 1) return part; // UUID conservé tel quel
    let cur = part;
    // un masque peut accoler ses 4 derniers chiffres à des groupes voisins : on repasse
    for (let r = maskOnce(cur); r.masked > 0; r = maskOnce(cur)) {
      masked += r.masked;
      cur = r.text;
    }
    return cur;
  });
  return { text: parts.join(''), masked };
}

/** Masque les PAN de toutes les chaînes d'une valeur JSON (clés comprises). */
export function maskPanDeep<T>(value: T): { readonly value: T; readonly masked: number } {
  let masked = 0;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const r = maskPan(v);
      masked += r.masked;
      return r.text;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([k, x]) => [walk(k) as string, walk(x)]),
      );
    }
    return v;
  };
  const out = walk(value) as T;
  return { value: out, masked };
}
