/**
 * Contrôle de contraste d'un thème (US-030, 10b UX-49 et UX-68) : chaque paire texte / fond et
 * composant / fond réellement utilisée par les composants doit atteindre WCAG 2.2 AA, en clair
 * et en sombre. Les paires sont écrites contre les jetons sémantiques : elles valent pour toute
 * palette, présente ou future (US-034 et US-120 appliqueront le même contrôle à la publication).
 */
import { MODES } from './build.ts';
import type { Mode, SemanticColor, Theme } from './build.ts';
import { AA_NON_TEXT, AA_TEXT, blend, contrastRatio } from './wcag.ts';

export interface ContrastRule {
  readonly fg: SemanticColor;
  readonly bg: SemanticColor;
  readonly min: number;
  readonly why: string;
}

const BACKGROUNDS = ['surface', 'surface-raised', 'surface-sunken'] as const;
const text = (fg: SemanticColor, why: string): ContrastRule[] =>
  BACKGROUNDS.map((bg) => ({ fg, bg, min: AA_TEXT, why }));

/** Paires contrôlées (le premier élément est posé sur le second). */
export const CONTRAST_RULES: readonly ContrastRule[] = [
  ...text('text', 'texte principal'),
  ...text('text-muted', 'texte secondaire'),
  ...text('primary', 'lien et action en texte'),
  { fg: 'on-primary', bg: 'primary', min: AA_TEXT, why: 'texte du bouton principal' },
  { fg: 'on-accent', bg: 'accent', min: AA_TEXT, why: 'texte de pastille' },
  { fg: 'success', bg: 'surface-raised', min: AA_TEXT, why: 'statut positif sur carte' },
  { fg: 'danger', bg: 'surface-raised', min: AA_TEXT, why: 'erreur sur carte' },
  { fg: 'warning', bg: 'surface-raised', min: AA_TEXT, why: 'attention sur carte' },
  { fg: 'success', bg: 'success-soft', min: AA_TEXT, why: 'pastille succès' },
  { fg: 'danger', bg: 'danger-soft', min: AA_TEXT, why: 'pastille danger' },
  { fg: 'warning', bg: 'warning-soft', min: AA_TEXT, why: 'pastille attention' },
  { fg: 'on-avatar-1', bg: 'avatar-1', min: AA_TEXT, why: 'monogramme, ton 1' },
  { fg: 'on-avatar-2', bg: 'avatar-2', min: AA_TEXT, why: 'monogramme, ton 2' },
  { fg: 'on-avatar-3', bg: 'avatar-3', min: AA_TEXT, why: 'monogramme, ton 3' },
  { fg: 'on-avatar-4', bg: 'avatar-4', min: AA_TEXT, why: 'monogramme, ton 4' },
  { fg: 'border-strong', bg: 'surface', min: AA_NON_TEXT, why: 'contour de champ (1.4.11)' },
  { fg: 'border-strong', bg: 'surface-raised', min: AA_NON_TEXT, why: 'contour de champ (1.4.11)' },
  ...BACKGROUNDS.map((bg) => ({
    fg: 'focus' as const,
    bg,
    min: AA_NON_TEXT,
    why: 'anneau de focus (2.4.13)',
  })),
  { fg: 'primary', bg: 'surface', min: AA_NON_TEXT, why: 'bouton principal (1.4.11)' },
];

/**
 * Textes posés sur le verre (valeur et indication de la recherche collante, liens et onglets de la
 * barre d'action), contrôlés au pire cas pour **toutes** les palettes. `primary` en fait partie
 * (revue code et UX US-030) : une palette dont le lien échoue sur le verre est refusée, au lieu
 * de compter sur une consigne d'usage.
 */
export const GLASS_TEXT: readonly SemanticColor[] = ['text', 'text-muted', 'primary'];

export interface ContrastFailure {
  readonly mode: Mode;
  readonly pair: string;
  readonly fg: string;
  readonly bg: string;
  readonly ratio: number;
  readonly min: number;
  readonly why: string;
}

const round2 = (x: number): number => Math.floor(x * 100) / 100;

/**
 * Toutes les paires sous le seuil, en clair et en sombre. Liste vide = thème conforme.
 * Le verre est évalué sur le pire contenu possible dessous : chaque couleur du thème, le noir et
 * le blanc (photo d'hôte), mélangés à `surface-raised` selon `glass.opacity` (UX-49).
 */
export function checkContrast(theme: Theme): ContrastFailure[] {
  const failures: ContrastFailure[] = [];
  for (const mode of MODES) {
    const c = theme.colors[mode];
    for (const rule of CONTRAST_RULES) {
      const ratio = contrastRatio(c[rule.fg], c[rule.bg]);
      if (ratio < rule.min) {
        failures.push({
          mode,
          pair: `${rule.fg} / ${rule.bg}`,
          fg: c[rule.fg],
          bg: c[rule.bg],
          ratio: round2(ratio),
          min: rule.min,
          why: rule.why,
        });
      }
    }
    const under = new Set([...Object.values(c), '#000000', '#FFFFFF']);
    for (const fg of GLASS_TEXT) {
      let worst: { bg: string; ratio: number } | undefined;
      for (const u of under) {
        const bg = blend(c['surface-raised'], theme.glassOpacity, u);
        const ratio = contrastRatio(c[fg], bg);
        if (!worst || ratio < worst.ratio) worst = { bg, ratio };
      }
      if (worst && worst.ratio < AA_TEXT) {
        failures.push({
          mode,
          pair: `${fg} / glass`,
          fg: c[fg],
          bg: worst.bg,
          ratio: round2(worst.ratio),
          min: AA_TEXT,
          why: 'texte sur verre, pire contenu dessous',
        });
      }
    }
  }
  return failures;
}

export class ThemeContrastError extends Error {
  readonly themeId: string;
  readonly failures: readonly ContrastFailure[];
  constructor(themeId: string, failures: readonly ContrastFailure[]) {
    super(
      `thème « ${themeId} » refusé : contraste WCAG 2.2 AA insuffisant\n` +
        failures
          .map(
            (f) =>
              `- [${f.mode}] ${f.pair} (${f.why}) : ${f.fg} sur ${f.bg} = ${f.ratio}:1 < ${f.min}:1`,
          )
          .join('\n'),
    );
    this.themeId = themeId;
    this.failures = failures;
    this.name = 'ThemeContrastError';
  }
}
