import type { Translator } from '@rueda/i18n';
import { Icon } from '@rueda/ui';
import { mapLayout } from '../../../account/search-map.ts';
import styles from './search.module.css';

export interface MapResult {
  readonly id: string;
  readonly title: string;
  /** Total TTC déjà formaté (même chaîne que la carte de la liste). */
  readonly total: string;
  readonly href: string;
  readonly point: { readonly lat: number; readonly lng: number } | null;
}

/**
 * Carte des résultats (US-203 ; 16 SRC-008 ; 10b S02 « mini-carte, liste équivalente ») : un
 * marqueur de prix par annonce, à la position APPROXIMATIVE de sa zone de remise ; une annonce sans
 * point est listée sous la carte, jamais omise. Les marqueurs portent le même total que la liste
 * (même tableau, même formatage). Fond schématique aux jetons du thème, sans tuile ni tiers
 * (aucun fournisseur retenu, ADR-131). La liste qui suit est l'équivalent accessible
 * (WCAG 2.5.7 : aucun glissement requis).
 */
export function ResultsMap({
  i18n,
  results,
  id,
}: {
  readonly i18n: Translator;
  readonly results: readonly MapResult[];
  readonly id: string;
}) {
  const t = i18n.t.bind(i18n);
  const layout = mapLayout(results);
  const byId = new Map(results.map((r) => [r.id, r]));
  const marker = (r: MapResult) => t('web.search.map.marker', { car: r.title, total: r.total });
  return (
    <figure className={styles['mapFigure']} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className={styles['mapTitle']}>
        {t('web.search.map.title')}
      </h2>
      {layout.placed.length > 0 && (
        <div className={styles['map']} data-testid="search-map">
          <svg
            className={styles['mapGround']}
            viewBox="0 0 320 180"
            aria-hidden="true"
            focusable="false"
            preserveAspectRatio="none"
          >
            <path className={styles['mapStreet']} d="M-10 140 L330 60" />
            <path className={styles['mapStreet']} d="M60 -10 L140 200" />
            <path className={styles['mapStreet']} d="M200 -10 L250 200" />
            <path className={styles['mapStreet']} d="M-10 40 L330 100" />
          </svg>
          <ul className={styles['markers']}>
            {layout.placed.map((p) => {
              const r = byId.get(p.id);
              if (r === undefined) return null;
              return (
                <li
                  key={p.id}
                  className={styles['marker']}
                  style={{ left: `${p.xPct}%`, top: `${p.yPct}%` }}
                >
                  <a
                    className={styles['markerLink']}
                    href={r.href}
                    aria-label={marker(r)}
                    data-testid="search-map-marker"
                  >
                    {r.total}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {layout.unplaced.length > 0 && (
        <div className={styles['unplaced']}>
          <p className={styles['muted']}>{t('web.search.map.noPoint')}</p>
          <ul className={styles['chips']}>
            {layout.unplaced.map((rid) => {
              const r = byId.get(rid);
              if (r === undefined) return null;
              return (
                <li key={rid}>
                  <a
                    className={styles['chip']}
                    href={r.href}
                    aria-label={marker(r)}
                    data-testid="search-map-marker"
                  >
                    {r.total}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <figcaption className={styles['muted']}>
        <Icon name="pin" /> {t('web.search.map.sameAsList')}
      </figcaption>
    </figure>
  );
}
