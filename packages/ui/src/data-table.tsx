import type { ReactNode } from 'react';
import styles from './data-table.module.css';
import { cx } from './internal/cx.ts';

export interface DataTableColumn {
  readonly key: string;
  readonly header: string;
  /** `end` pour les montants et les nombres. */
  readonly align?: 'start' | 'end' | undefined;
}

export interface DataTableRow {
  readonly id: string;
  readonly cells: Readonly<Record<string, ReactNode>>;
}

export interface DataTableProps {
  /** Identifiant : relie la légende à la région défilante. */
  readonly id: string;
  /** Légende visible (nom du tableau, lu en premier). */
  readonly caption: string;
  readonly columns: readonly DataTableColumn[];
  readonly rows: readonly DataTableRow[];
  /** Contenu affiché sans ligne (un `EmptyState`). */
  readonly empty?: ReactNode;
}

/**
 * Tableau de données (console de l'hôte : remises à venir, versements). La première colonne
 * porte l'en-tête de ligne. Sur mobile, la région défile horizontalement et se focalise au clavier.
 */
export function DataTable({ id, caption, columns, rows, empty }: DataTableProps) {
  const captionId = `${id}-caption`;
  if (rows.length === 0 && empty) {
    return (
      <section className={styles['region']} aria-labelledby={captionId}>
        <h3 id={captionId} className={styles['caption']}>
          {caption}
        </h3>
        <div className={styles['empty']}>{empty}</div>
      </section>
    );
  }
  return (
    <div
      className={styles['region']}
      role="region"
      aria-labelledby={captionId}
      // Région défilante : focalisable pour défiler au clavier (WCAG 2.1.1).
      tabIndex={0}
    >
      <table id={id} className={styles['table']}>
        <caption id={captionId} className={styles['caption']}>
          {caption}
        </caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cx(c.align === 'end' && styles['end'])}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((c, i) => {
                const cls = cx(c.align === 'end' && styles['end']) || undefined;
                return i === 0 ? (
                  <th key={c.key} scope="row" className={cls}>
                    {row.cells[c.key]}
                  </th>
                ) : (
                  <td key={c.key} className={cls}>
                    {row.cells[c.key]}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
