import styles from './car-illustration.module.css';
import { cx } from './internal/cx.ts';

/** Silhouettes maison (10b UX-70, rien de Turo) : une par grande famille de véhicule (US-033). */
export type CarKind = 'hatch' | 'sedan' | 'suv' | 'pickup' | 'van';

export const CAR_KINDS: readonly CarKind[] = ['hatch', 'sedan', 'suv', 'pickup', 'van'];

interface Shape {
  readonly body: string;
  readonly windows: readonly string[];
  /** Feu arrière : x, y. */
  readonly light: readonly [number, number];
  /** Centres des roues (x) et rayon. */
  readonly wheels: readonly [number, number];
  readonly r: number;
  /** Détail en creux (benne, porte coulissante) : tracé au trait. */
  readonly detail?: string;
}

const SHAPES: Readonly<Record<CarKind, Shape>> = {
  // Citadine : capot court, hayon presque vertical.
  hatch: {
    body: 'M22 72c0-9 5-13 14-15l24-5c11-13 25-21 44-21h30c15 0 26 7 34 19l4 6 18 3c8 2 11 6 11 13v6c0 3-2 4-5 4H25c-2 0-3-1-3-3z',
    windows: ['M74 50c8-10 18-14 30-14h12v14z', 'M122 36h12c10 0 18 5 24 14h-36z'],
    light: [190, 58],
    wheels: [62, 172],
    r: 15,
  },
  // Berline : trois volumes, coffre marqué.
  sedan: {
    body: 'M14 70c0-10 6-14 16-16l32-4c12-14 28-22 50-22h38c18 0 32 8 46 22l18 4c10 2 14 8 14 16v4c0 3-2 4-5 4H18c-3 0-4-2-4-4z',
    windows: ['M78 50c9-11 20-16 34-16h16v16z', 'M134 34h16c14 0 24 6 35 16h-51z'],
    light: [214, 58],
    wheels: [62, 184],
    r: 16,
  },
  // SUV : haut sur roues, toit plat, porte-à-faux courts.
  suv: {
    body: 'M14 74V60c0-6 4-9 10-10l22-3 18-17c4-4 9-6 15-6h86c8 0 14 3 19 9l15 17 15 3c8 2 12 6 12 13v8c0 3-2 4-4 4H18c-3 0-4-1-4-4z',
    windows: ['M70 46l14-14c2-2 5-3 8-3h28v17z', 'M128 29h26c5 0 9 2 12 6l10 11h-48z'],
    light: [212, 54],
    wheels: [60, 184],
    r: 18,
  },
  // Pick-up : cabine double et benne ouverte.
  pickup: {
    body: 'M12 74V62c0-6 4-9 10-10l26-4 16-18c3-3 7-5 12-5h46c5 0 8 3 8 8v19h88c4 0 6 2 6 6v16c0 3-2 4-4 4H16c-3 0-4-1-4-4z',
    windows: ['M72 46l12-14c1-2 3-3 5-3h25v17z'],
    light: [218, 56],
    wheels: [58, 188],
    r: 17,
    detail: 'M136 52h82',
  },
  // Monospace : long toit, trois vitres, porte coulissante.
  van: {
    body: 'M14 74V58c0-5 3-8 8-9l18-4 20-18c5-4 11-6 18-6h104c10 0 16 5 19 13l9 22 8 2c6 2 8 6 8 11v9c0 3-2 4-4 4H18c-3 0-4-1-4-4z',
    windows: [
      'M66 44l14-13c3-2 6-3 10-3h22v16z',
      'M118 28h34v16h-34z',
      'M158 28h22c4 0 7 2 8 6l4 10h-34z',
    ],
    light: [214, 54],
    wheels: [58, 186],
    r: 16,
    detail: 'M116 50v22',
  },
};

export interface CarIllustrationProps {
  /** Ton de carrosserie (1 à 4, couleurs des avatars du thème). */
  readonly tone?: 1 | 2 | 3 | 4 | undefined;
  /** Famille de véhicule (silhouette) ; berline par défaut. */
  readonly kind?: CarKind | undefined;
  readonly className?: string | undefined;
}

/**
 * Illustration de voiture, vue de profil, en attendant les photos de l'hôte (10b UX-65, UX-70).
 * Décorative : le modèle et l'année sont écrits à côté. Couleurs : jetons seulement.
 */
export function CarIllustration({ tone = 1, kind = 'sedan', className }: CarIllustrationProps) {
  const s = SHAPES[kind];
  const [lx, ly] = s.light;
  return (
    <svg
      className={cx(styles['car'], styles[`tone${tone}`], className)}
      viewBox="0 0 240 100"
      aria-hidden="true"
      focusable="false"
      data-kind={kind}
    >
      <ellipse className={styles['shadow']} cx="120" cy="94" rx="104" ry="4" />
      <path fill="currentColor" d={s.body} />
      {s.windows.map((d) => (
        <path key={d} className={styles['window']} d={d} />
      ))}
      {s.detail && <path className={styles['detail']} d={s.detail} />}
      <rect className={styles['light']} x={lx} y={ly} width="10" height="5" rx="2" />
      {s.wheels.map((cx) => (
        <g key={cx}>
          <circle className={styles['tyre']} cx={cx} cy={94 - s.r} r={s.r} />
          <circle className={styles['hub']} cx={cx} cy={94 - s.r} r={Math.round(s.r * 0.45)} />
        </g>
      ))}
    </svg>
  );
}
