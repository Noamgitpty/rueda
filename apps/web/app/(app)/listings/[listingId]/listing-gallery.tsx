'use client';

import { useEffect, useRef, useState } from 'react';
import { CarIllustration } from '@rueda/ui';
import styles from './listing.module.css';

export interface GallerySlide {
  readonly id: string;
  /** Chemin du site (`/media/listing/…`), même origine (CSP `img-src 'self'`). */
  readonly src: string;
  /** Texte alternatif déjà traduit (voiture, rang). */
  readonly alt: string;
  /** Légende déjà traduite (`web.s03.photos`). */
  readonly caption: string;
}

/**
 * Galerie de la fiche S03 (US-204 ; 16 LST-002) : photos dans l'ordre de l'hôte, bord à bord,
 * au balayage (défilement accroché, clavier : flèches dans la bande focalisable). Une photo
 * indisponible est remplacée par une vignette (illustration et texte), les autres restent
 * affichées (19 US-204 critère 1). Composant client pour la seule détection de l'erreur de
 * chargement : sans JavaScript, la page reste lisible (images et légendes rendues par le serveur).
 */
export function ListingGallery({
  slides,
  title,
  brokenLabel,
  headingId,
  headingClassName,
}: {
  readonly slides: readonly GallerySlide[];
  readonly title: string;
  readonly brokenLabel: string;
  readonly headingId: string;
  /** Classe du titre de section (styles de la page). */
  readonly headingClassName?: string | undefined;
}) {
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const list = useRef<HTMLUListElement>(null);
  const fail = (id: string) => setFailed((prev) => (prev.has(id) ? prev : new Set([...prev, id])));
  // erreur survenue avant l'hydratation (rendu serveur) : relue sur l'image déjà chargée
  useEffect(() => {
    for (const img of list.current?.querySelectorAll('img') ?? []) {
      if (img.complete && img.naturalWidth === 0) fail(img.dataset['photo'] ?? '');
    }
  }, []);
  return (
    <section className={styles['gallery']} aria-labelledby={headingId}>
      <h2 id={headingId} className={headingClassName}>
        {title}
      </h2>
      <ul ref={list} className={styles['strip']} tabIndex={0} aria-labelledby={headingId}>
        {slides.map((s, i) => (
          <li key={s.id} className={styles['slide']}>
            <figure className={styles['figure']} data-testid="gallery-photo" data-photo={s.id}>
              <div className={styles['frame']}>
                {failed.has(s.id) ? (
                  <div
                    className={styles['broken']}
                    role="img"
                    aria-label={`${s.alt} · ${brokenLabel}`}
                  >
                    <CarIllustration />
                    <span aria-hidden="true">{brokenLabel}</span>
                  </div>
                ) : (
                  // photo de l'hôte, dimensions inconnues : pas d'optimiseur d'image (même origine)
                  <img
                    className={styles['photo']}
                    src={s.src}
                    alt={s.alt}
                    data-photo={s.id}
                    loading={i < 3 ? 'eager' : 'lazy'}
                    decoding="async"
                    onError={() => fail(s.id)}
                  />
                )}
              </div>
              <figcaption className={styles['caption']}>{s.caption}</figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </section>
  );
}
