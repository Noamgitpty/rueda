import type { Translator } from '@rueda/i18n';
import { Avatar } from './avatar.tsx';
import type { AvatarTone } from './avatar.tsx';
import { Badge } from './badge.tsx';
import styles from './card.module.css';
import { Rating } from './rating.tsx';

export type HostTitleForm = 'masc' | 'fem' | 'neutral';

const TITLE_KEY = {
  masc: 'web.s03.host.titleMasc',
  fem: 'web.s03.host.titleFem',
  neutral: 'web.s03.host.titleNeutral',
} as const;

export interface HostCardProps {
  readonly i18n: Translator;
  /** Identifiant du bloc (relie le titre à la section). */
  readonly id: string;
  readonly name: string;
  /**
   * Forme du titre, choisie par le profil de l'hôte (10b UX-65 : deux clés affichables, pas de
   * texte à variante) ; inconnue : forme neutre.
   */
  readonly titleForm?: HostTitleForm | undefined;
  readonly tone?: AvatarTone | undefined;
  readonly rating?: number | undefined;
  readonly trips: number;
  /** Année d'inscription (« Miembro desde 2024 »). */
  readonly memberSince: number;
  readonly verified: boolean;
  /** Taux de réponse, en pour cent entier. */
  readonly responseRate?: number | undefined;
  /** Délai de réponse habituel, en heures entières. */
  readonly responseHours?: number | undefined;
  /** Promesse de l'hôte, citée entre guillemets. */
  readonly quote?: string | undefined;
  readonly headingLevel?: 2 | 3 | 4 | undefined;
}

/**
 * Bloc « Tu anfitrión » de la fiche (S03, 10b UX-65) : monogramme, prénom, note, ancienneté,
 * identité vérifiée, réponse, promesse. Aucun badge de statut d'hôte ni nom de programme.
 */
export function HostCard({
  i18n,
  id,
  name,
  titleForm = 'neutral',
  tone,
  rating,
  trips,
  memberSince,
  verified,
  responseRate,
  responseHours,
  quote,
  headingLevel = 2,
}: HostCardProps) {
  const Heading = `h${headingLevel}` as const;
  const titleId = `${id}-title`;
  return (
    <section id={id} className={styles['card']} aria-labelledby={titleId}>
      <div className={styles['section']}>
        <div className={styles['hostHead']}>
          <Avatar name={name} size="lg" tone={tone} />
          <div className={styles['hostIdentity']}>
            <Heading id={titleId} className={styles['heading']}>
              <span className={styles['kicker']}>{i18n.t(TITLE_KEY[titleForm])}</span>{' '}
              <span>{name}</span>
            </Heading>
            <Rating i18n={i18n} value={rating} trips={trips} />
          </div>
        </div>
        <ul className={styles['facts']}>
          {verified && (
            <li>
              <Badge tone="success">{i18n.t('web.host.guest.verified')}</Badge>
            </li>
          )}
          {/* Année en chaîne brute : jamais de séparateur de milliers (« 2024 », pas « 2.024 »). */}
          <li>{i18n.t('common.ui.host.since', { year: String(memberSince) })}</li>
          {responseRate !== undefined && (
            <li>{i18n.t('common.ui.host.responseRate', { rate: responseRate })}</li>
          )}
          {responseHours !== undefined && (
            <li>{i18n.t('common.ui.host.responseTime', { count: responseHours })}</li>
          )}
        </ul>
        {quote && (
          <blockquote className={styles['quote']}>
            <p>
              <q>{quote}</q>
            </p>
          </blockquote>
        )}
      </div>
    </section>
  );
}
