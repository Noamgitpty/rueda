/**
 * Détecteur et masque de PAN (17 §1.6 portée SAQ A ; §4.4 point 3, corrigé VERIF_14-F26).
 *
 * Définition (identique à `core.payment_text_has_pan`, migration 0027, qui la vérifie en base par
 * contrainte) : une suite de chiffres, avec au plus un espace ou un tiret entre deux chiffres, dont
 * la version sans séparateur compte de 13 à 19 chiffres et passe le contrôle de Luhn.
 * Le masque garde les 6 premiers et les 4 derniers chiffres (affichage admis par 17 §1.6) et
 * remplace les autres par `*` : le résultat ne contient plus de suite de 13 chiffres.
 */

const RUN = /[0-9](?:[ -]?[0-9])*/g;

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

function isPanRun(run: string): boolean {
  const digits = run.replace(/[ -]/g, '');
  return digits.length >= 13 && digits.length <= 19 && luhnValid(digits);
}

export function containsPan(text: string): boolean {
  for (const m of text.matchAll(RUN)) if (isPanRun(m[0])) return true;
  return false;
}

/** Masque chaque PAN détecté ; rend aussi le nombre de masques posés (alerte F26). */
export function maskPan(text: string): { readonly text: string; readonly masked: number } {
  let masked = 0;
  const out = text.replace(RUN, (run) => {
    if (!isPanRun(run)) return run;
    masked += 1;
    const digits = run.replace(/[ -]/g, '');
    return `${digits.slice(0, 6)}${'*'.repeat(digits.length - 10)}${digits.slice(-4)}`;
  });
  return { text: out, masked };
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
