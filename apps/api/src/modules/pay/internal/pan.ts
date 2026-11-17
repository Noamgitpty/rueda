/**
 * Détecteur et masque de PAN (17 §1.6 portée SAQ A ; §4.4 point 3, corrigé VERIF_14-F26).
 *
 * Définition (identique à `core.payment_text_has_pan`, migrations 0029 et 0130, qui la vérifie en
 * base par la contrainte `webhook_inbox_no_pan`) :
 * 1. les UUID (8-4-4-4-12 hexadécimaux, non collés à une lettre ou un chiffre) sont écartés : un
 *    identifiant `evt-<uuid>` n'est jamais un PAN (faux positif de 0028, environ 0,25 %) ;
 *    les empreintes `hex(sha256(…))` sont écartées aussi (0130, ADR-155) : jeton d'EXACTEMENT 64
 *    caractères `[0-9a-f]` en minuscules, non collé à une lettre ou un chiffre. C'est la clé
 *    d'idempotence réduite (08 E4, `idempotencyKeyToSend`) que le PSP renvoie en
 *    `merchantReference` ; environ 0,32 % de ces clés contenaient 13 à 19 chiffres valides au
 *    contrôle de Luhn (faux positif signalé par US-122). Capitales ou casse mêlée, 63 ou 65
 *    caractères, jeton collé : toujours analysés (fail-closed). Limite acceptée (ADR-155) : un PAN
 *    placé à dessein dans un tel jeton n'est plus vu ;
 * 2. suites maximales de groupes de chiffres séparés par UN espace ou UN tiret ;
 * 3. fenêtre de groupes consécutifs (tout groupage : 4-4-4-4, 4-6-5, 8-8, 3-3-3-3-4…) de 13 à 19
 *    chiffres au total ;
 * 4. une fois les zéros de tête retirés : encore 13 chiffres au moins, premier chiffre de 2 à 8
 *    (Visa, Mastercard dont la série 2, Mir, Amex, Diners, JCB, Discover, UnionPay, Maestro,
 *    RuPay, préfixe 7) ;
 * 5. contrôle de Luhn valide.
 * Complexité LINÉAIRE (revues sécurité et code du 2026-11-03d) : pour chaque groupe, on remonte au
 * plus 19 groupes en cumulant longueur et somme de Luhn, et l'on s'arrête dès 19 chiffres dépassés.
 * Le masque garde les 6 premiers et les 4 derniers chiffres (affichage admis par 17 §1.6) et
 * remplace les autres par `*` ; au plus trois passes, puis tous les chiffres du segment sont
 * masqués (fail-closed, temps borné).
 */

const UUID_SOURCE =
  '(?<![0-9A-Za-z])[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}(?![0-9A-Za-z])';
/** Empreinte `hex(sha256(…))` : exactement 64 hexadécimaux minuscules, isolés. */
const HEX64_SOURCE = '(?<![0-9A-Za-z])[0-9a-f]{64}(?![0-9A-Za-z])';
/** Identifiants structurés écartés du détecteur : UUID et empreintes hexadécimales de 64. */
const ID_SOURCE = `(?:${UUID_SOURCE}|${HEX64_SOURCE})`;
const ID_ANY = new RegExp(ID_SOURCE, 'g');
/** Découpe en conservant ces identifiants (indices impairs du résultat de `split`). */
const ID_SPLIT = new RegExp(`(${ID_SOURCE})`);
const RUN = /[0-9]+(?:[ -][0-9]+)*/g;
const MAX_PAN = 19;
const MIN_PAN = 13;
const MASK_PASSES = 3;

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

/** Contribution d'un groupe (au plus 19 chiffres) à une fenêtre qui se termine à sa droite. */
interface GroupInfo {
  readonly len: number;
  /** Somme de Luhn si le dernier chiffre du groupe est à un rang pair depuis la droite. */
  readonly even: number;
  /** Somme de Luhn si le dernier chiffre du groupe est à un rang impair (doublé). */
  readonly odd: number;
  readonly leadingZeros: number;
  /** Premier chiffre non nul, 0 si le groupe n'a que des zéros. */
  readonly first: number;
}

function groupInfo(g: string): GroupInfo | null {
  if (g.length > MAX_PAN) return null;
  let even = 0;
  let odd = 0;
  for (let i = 0; i < g.length; i++) {
    const d = g.charCodeAt(g.length - 1 - i) - 48;
    const twice = d * 2 > 9 ? d * 2 - 9 : d * 2;
    if (i % 2 === 0) {
      even += d;
      odd += twice;
    } else {
      even += twice;
      odd += d;
    }
  }
  let leadingZeros = 0;
  while (leadingZeros < g.length && g.charCodeAt(leadingZeros) === 48) leadingZeros++;
  const first = leadingZeros < g.length ? g.charCodeAt(leadingZeros) - 48 : 0;
  return { len: g.length, even, odd, leadingZeros, first };
}

/** Compteur d'étapes (preuve de linéarité par les tests). */
export interface PanScanStats {
  groups: number;
  steps: number;
}

/**
 * Pour chaque groupe e d'une suite, début de la plus longue fenêtre PAN qui finit en e (ou null).
 * Les fenêtres ne descendent jamais sous `floor` (groupe trop long, ou fenêtre déjà masquée).
 */
function scanRun(
  groups: readonly string[],
  onPan: (start: number, end: number) => 'stop' | 'mask' | 'continue',
  stats?: PanScanStats,
): void {
  const info = groups.map(groupInfo);
  let floor = 0;
  for (let e = 0; e < groups.length; e++) {
    if (stats !== undefined) stats.groups += 1;
    if (info[e] === null) {
      floor = e + 1;
      continue;
    }
    let total = 0;
    let sum = 0;
    let lead = 0;
    let stripped = 0;
    let best = -1;
    for (let k = e; k >= floor && k > e - MAX_PAN; k--) {
      if (stats !== undefined) stats.steps += 1;
      const g = info[k] as GroupInfo;
      const right = total;
      total += g.len;
      if (total > MAX_PAN) break;
      sum += right % 2 === 0 ? g.even : g.odd;
      if (g.first !== 0) {
        lead = g.first;
        stripped = total - g.leadingZeros;
      }
      if (total >= MIN_PAN && stripped >= MIN_PAN && lead >= 2 && lead <= 8 && sum % 10 === 0) {
        best = k;
      }
    }
    if (best < 0) continue;
    const action = onPan(best, e);
    if (action === 'stop') return;
    if (action === 'mask') floor = e + 1;
  }
}

const withoutIds = (text: string): string => text.replace(ID_ANY, ' ');

export function containsPan(text: string): boolean {
  for (const m of withoutIds(text).matchAll(RUN)) {
    let found = false;
    scanRun(m[0].split(/[ -]/), () => {
      found = true;
      return 'stop';
    });
    if (found) return true;
  }
  return false;
}

/** Étapes de la détection sur `text` (tests de complexité seulement). */
export function panScanStats(text: string): PanScanStats {
  const stats: PanScanStats = { groups: 0, steps: 0 };
  for (const m of withoutIds(text).matchAll(RUN)) {
    scanRun(m[0].split(/[ -]/), () => 'continue', stats);
  }
  return stats;
}

/** Une passe de masque sur un texte sans identifiant écarté. */
function maskOnce(text: string): { text: string; masked: number } {
  let masked = 0;
  const out = text.replace(RUN, (run) => {
    const groups = run.split(/[ -]/);
    const seps = run.match(/[ -]/g) ?? [];
    const windows: [number, number][] = [];
    scanRun(groups, (s, e) => {
      windows.push([s, e]);
      return 'mask';
    });
    if (windows.length === 0) return run;
    masked += windows.length;
    let res = '';
    let i = 0;
    for (const [s, e] of windows) {
      for (let k = i; k < s; k++) res += (groups[k] ?? '') + (seps[k] ?? '');
      const digits = groups.slice(s, e + 1).join('');
      res += `${digits.slice(0, 6)}${'*'.repeat(digits.length - 10)}${digits.slice(-4)}`;
      res += seps[e] ?? '';
      i = e + 1;
    }
    for (let k = i; k < groups.length; k++) res += (groups[k] ?? '') + (seps[k] ?? '');
    return res;
  });
  return { text: out, masked };
}

/**
 * Masque chaque PAN détecté (UUID et empreintes hexadécimales de 64 restent intacts) ; rend aussi
 * le nombre de masques posés.
 */
export function maskPan(text: string): { readonly text: string; readonly masked: number } {
  let masked = 0;
  const parts = text.split(ID_SPLIT).map((part, i) => {
    if (i % 2 === 1) return part; // UUID ou empreinte conservé tel quel
    let cur = part;
    // un masque peut accoler ses 4 derniers chiffres à des groupes voisins : on repasse, au plus
    // MASK_PASSES fois, puis on masque tous les chiffres du segment (fail-closed, temps borné)
    for (let pass = 0; pass < MASK_PASSES; pass++) {
      const r = maskOnce(cur);
      if (r.masked === 0) return cur;
      masked += r.masked;
      cur = r.text;
    }
    if (containsPan(cur)) {
      masked += 1;
      cur = cur.replace(/[0-9]/g, '*');
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
