/**
 * Rendu d'un bloc de contenu éditable (US-121, ADR-095). Entrée : l'arbre FERMÉ de
 * `@rueda/i18n` (`RichDoc`), revalidé par `content-source.ts`. Sortie : des éléments React
 * créés un à un (texte échappé par React) ; aucun `dangerouslySetInnerHTML`, aucun attribut tiré
 * du contenu autre que `href`, et ce lien est un chemin interne (revérifié ici, fail-closed :
 * un lien douteux devient du texte). Styles : jetons seulement.
 */
import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { isInternalHref } from '@rueda/i18n';
import type { RichBlock, RichDoc, RichInline } from '@rueda/i18n';
import styles from './rich-text.module.css';

function inline(node: RichInline, i: number): ReactNode {
  switch (node.t) {
    case 'strong':
      return <strong key={i}>{node.v}</strong>;
    case 'em':
      return <em key={i}>{node.v}</em>;
    case 'link':
      return isInternalHref(node.href) ? (
        <a key={i} className={styles['link']} href={node.href}>
          {node.v}
        </a>
      ) : (
        <Fragment key={i}>{node.v}</Fragment>
      );
    default:
      return <Fragment key={i}>{node.v}</Fragment>;
  }
}

const line = (nodes: readonly RichInline[]): ReactNode[] => nodes.map(inline);

function block(b: RichBlock, i: number, className: string | undefined): ReactNode {
  if (b.t === 'p') {
    return (
      <p key={i} className={className}>
        {line(b.c)}
      </p>
    );
  }
  const items = b.items.map((item, j) => <li key={j}>{line(item)}</li>);
  return b.t === 'ul' ? (
    <ul key={i} className={styles['list']}>
      {items}
    </ul>
  ) : (
    <ol key={i} className={styles['list']}>
      {items}
    </ol>
  );
}

/** Texte d'un bloc `plain` (une ligne) : à placer dans l'élément du catalogue (h1, p…). */
export function plainText(doc: RichDoc): string | undefined {
  return doc.format === 'plain' ? doc.text : undefined;
}

/**
 * Bloc `rich` : suite de paragraphes et de listes, dans un conteneur neutre ; `paragraphClass`
 * reprend le style du texte du catalogue remplacé.
 */
export function RichText({
  doc,
  className,
  paragraphClass,
}: {
  readonly doc: RichDoc;
  readonly className?: string | undefined;
  readonly paragraphClass?: string | undefined;
}) {
  if (doc.format === 'plain') return <p className={paragraphClass}>{doc.text}</p>;
  return (
    <div className={[styles['rich'], className].filter(Boolean).join(' ')}>
      {doc.blocks.map((b, i) => block(b, i, paragraphClass))}
    </div>
  );
}
