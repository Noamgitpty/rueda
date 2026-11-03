import styles from './avatar.module.css';
import { cx } from './internal/cx.ts';

export type AvatarTone = 1 | 2 | 3 | 4;
export type AvatarSize = 'sm' | 'md' | 'lg';

/** Initiales d'un nom : première lettre des deux premiers mots (« María José » → « MJ »). */
export function monogram(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  return words
    .slice(0, 2)
    .map((w) => Array.from(w)[0] ?? '')
    .join('')
    .toLocaleUpperCase();
}

/** Ton stable dérivé du nom : le même hôte garde la même couleur partout. */
export function toneOf(name: string): AvatarTone {
  let sum = 0;
  for (const ch of name) sum = (sum + (ch.codePointAt(0) ?? 0)) % 4;
  return (sum + 1) as AvatarTone;
}

export interface AvatarProps {
  readonly name: string;
  readonly size?: AvatarSize | undefined;
  readonly tone?: AvatarTone | undefined;
  /**
   * Vrai (défaut) quand le nom est écrit à côté : l'avatar est masqué aux lecteurs d'écran.
   * Faux : l'avatar porte le nom (`role="img"`).
   */
  readonly decorative?: boolean | undefined;
}

/** Monogramme de l'hôte ou du voyageur (pas de photo de personne dans les maquettes, UX-70). */
export function Avatar({ name, size = 'md', tone, decorative = true }: AvatarProps) {
  const t = tone ?? toneOf(name);
  return (
    <span
      className={cx(styles['avatar'], styles[size], styles[`tone${t}`])}
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': name })}
    >
      {monogram(name)}
    </span>
  );
}
