'use client';

import { useId, useState } from 'react';
import styles from '../proto.module.css';

export interface EstimatorStep {
  readonly days: number;
  readonly daysLabel: string;
  readonly amount: string;
}

/**
 * Estimateur « Gana dinero con tu auto » (10b S01) : curseur doublé d'un champ numérique
 * (WCAG 2.5.7, alternative au glissement). Les montants sont préparés côté serveur et formatés
 * par `@rueda/i18n` ; ici, on ne fait que choisir une ligne. Aucune animation.
 */
export function Estimator({
  label,
  perMonth,
  steps,
  initialDays,
}: {
  readonly label: string;
  readonly perMonth: string;
  readonly steps: readonly EstimatorStep[];
  readonly initialDays: number;
}) {
  const id = useId();
  const [days, setDays] = useState(initialDays);
  const min = steps[0]?.days ?? 1;
  const max = steps[steps.length - 1]?.days ?? 1;
  const step = steps.find((s) => s.days === days) ?? steps[0];
  const set = (value: number) => {
    if (Number.isInteger(value)) setDays(Math.min(Math.max(value, min), max));
  };
  return (
    <div className={styles['stackTight']}>
      <p className={styles['text']} aria-live="polite">
        <span className={styles['display']}>{step?.amount}</span> {perMonth}
      </p>
      <label className={styles['muted']} htmlFor={`${id}-range`}>
        {label} · {step?.daysLabel}
      </label>
      <div className={styles['searchRow']}>
        <input
          id={`${id}-range`}
          className={styles['range']}
          type="range"
          min={min}
          max={max}
          value={days}
          onChange={(e) => set(Number(e.currentTarget.value))}
        />
        <input
          className={styles['numberInput']}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={days}
          aria-label={label}
          onChange={(e) => set(Number(e.currentTarget.value))}
        />
      </div>
    </div>
  );
}
