import type { Translator } from '@rueda/i18n';
import { cx } from './internal/cx.ts';
import { VisuallyHidden } from './internal/visually-hidden.tsx';
import styles from './steps.module.css';

export interface StepsProps {
  readonly i18n: Translator;
  /** Noms des étapes, déjà traduits, dans l'ordre. */
  readonly steps: readonly string[];
  /** Index (à partir de 0) de l'étape courante. */
  readonly current: number;
  readonly label?: string | undefined;
}

/**
 * Indicateur d'étapes : « Paso 2 de 4 » écrit en clair, liste ordonnée, `aria-current="step"`
 * sur l'étape courante, état « completado » lu pour les étapes passées. La progression n'est
 * jamais portée par la couleur seule (texte et graisse changent aussi).
 */
export function Steps({ i18n, steps, current, label }: StepsProps) {
  const index = Math.min(Math.max(current, 0), Math.max(steps.length - 1, 0));
  return (
    <div className={styles['steps']} role="group" aria-label={label}>
      <p className={styles['progress']}>
        {i18n.t('common.ui.steps.progress', { current: index + 1, total: steps.length })}
      </p>
      <ol className={styles['list']}>
        {steps.map((name, i) => {
          const state = i < index ? 'done' : i === index ? 'current' : 'upcoming';
          return (
            <li
              key={name}
              className={cx(styles['step'], styles[state])}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              <span className={styles['bar']} aria-hidden="true" />
              <span className={styles['name']}>
                {name}
                {state === 'done' && (
                  <VisuallyHidden> ({i18n.t('common.ui.steps.done')})</VisuallyHidden>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
