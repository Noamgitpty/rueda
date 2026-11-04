'use client';

/**
 * Choix du plan de protection de S05 (revue UX US-033) : le total, les lignes et le bouton de
 * paiement changent dès qu'on choisit un plan, sans bouton « appliquer ». Tous les montants sont
 * préparés côté serveur (oracle de 08) ; ici, on ne fait que choisir une vue. Sans JavaScript, le
 * plan de l'URL (`sel`) reste affiché.
 */
import { createContext, useContext, useState } from 'react';
import { ButtonLink } from '@rueda/ui';
import type { ReactNode } from 'react';
import styles from '../proto.module.css';
import { PriceLines } from './price-lines.tsx';
import type { PriceLineView } from './price-lines.tsx';

export interface PlanView {
  readonly id: string;
  readonly name: string;
  readonly deductible: string;
  /** Prix du plan (montant) ; « Obligatoria » est porté par `badge`. */
  readonly price: string;
  readonly badge?: string | undefined;
  readonly lines: readonly PriceLineView[];
  readonly total: string;
  readonly cta: string;
}

const PlanContext = createContext<{ plan: PlanView; set: (id: string) => void } | null>(null);

function usePlan() {
  const value = useContext(PlanContext);
  if (!value) throw new Error('PlanScope manquant');
  return value;
}

export function PlanScope({
  plans,
  initial,
  children,
}: {
  readonly plans: readonly PlanView[];
  readonly initial: string;
  readonly children: ReactNode;
}) {
  const [id, setId] = useState(initial);
  const plan = plans.find((p) => p.id === id) ?? plans[0];
  if (!plan) return null;
  return <PlanContext.Provider value={{ plan, set: setId }}>{children}</PlanContext.Provider>;
}

export function PlanChoices({
  legend,
  plans,
  note,
}: {
  readonly legend: string;
  readonly plans: readonly PlanView[];
  readonly note: string;
}) {
  const { plan, set } = usePlan();
  return (
    <fieldset className={styles['choices']}>
      <legend className={styles['h3']}>{legend}</legend>
      {plans.map((p) => (
        <label key={p.id} className={styles['choice']}>
          <input
            type="radio"
            name="plan"
            value={p.id}
            checked={p.id === plan.id}
            onChange={() => set(p.id)}
          />
          <span className={styles['choiceBody']}>
            <span className={styles['strong']}>
              {p.name}
              {p.badge && <span className={styles['tag']}>{p.badge}</span>}
            </span>
            <span className={styles['muted']}>{p.deductible}</span>
          </span>
          <span className={styles['strong']}>{p.price}</span>
        </label>
      ))}
      <p className={styles['muted']}>{note}</p>
    </fieldset>
  );
}

export function PlanLines({ totalLabel }: { readonly totalLabel: string }) {
  const { plan } = usePlan();
  return (
    <div aria-live="polite">
      <PriceLines
        lines={plan.lines}
        totalLabel={totalLabel}
        total={plan.total}
        totalKey={plan.id}
      />
    </div>
  );
}

export function PlanTotal({ caption }: { readonly caption: string }) {
  const { plan } = usePlan();
  return (
    <p className={styles['barPrice']}>
      <span key={plan.id} className={styles['priceTotalAmount']}>
        {plan.total}
      </span>
      <span className={styles['muted']}>{caption}</span>
    </p>
  );
}

export function PlanCta({ href }: { readonly href: string }) {
  const { plan } = usePlan();
  return <ButtonLink href={href}>{plan.cta}</ButtonLink>;
}
