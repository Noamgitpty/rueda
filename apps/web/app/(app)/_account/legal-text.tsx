import type { ReactNode } from 'react';

/**
 * Markdown RESTREINT des textes juridiques (US-102) : paragraphes (ligne vide) et gras (`**…**`)
 * seulement. Aucun HTML interprété (texte rendu par React, échappé), aucun lien, aucune image :
 * un texte publié par la console ne peut pas injecter de contenu actif.
 */
export function renderLegalText(body: string): ReactNode[] {
  return body
    .split(/\n{2,}/)
    .map((paragraph, i) => (
      <p key={i}>
        {paragraph
          .split(/\*\*([^*]+)\*\*/g)
          .map((part, j) => (j % 2 === 1 ? <strong key={j}>{part}</strong> : part))}
      </p>
    ));
}
