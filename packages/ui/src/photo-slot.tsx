import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { MessageKey, Translator } from '@rueda/i18n';
import { Icon } from './icon.tsx';
import type { IconName } from './icon.tsx';
import { cx } from './internal/cx.ts';
import styles from './photo-slot.module.css';

/**
 * État d'une photo de remise ou de retour : à prendre, enregistrée sur le téléphone (file hors
 * ligne chiffrée, US-026), en envoi, envoyée, ou envoi en échec (nouvelle tentative automatique).
 */
export type PhotoSlotState = 'empty' | 'saved' | 'uploading' | 'uploaded' | 'failed';

const STATUS: Readonly<
  Record<
    PhotoSlotState,
    { readonly key: MessageKey; readonly icon: IconName; readonly tone?: string }
  >
> = {
  empty: { key: 'common.ui.photo.empty', icon: 'camera' },
  saved: { key: 'common.ui.photo.saved', icon: 'check' },
  uploading: { key: 'common.ui.photo.uploading', icon: 'info' },
  uploaded: { key: 'common.ui.photo.uploaded', icon: 'check', tone: 'statusOk' },
  failed: { key: 'common.ui.photo.failed', icon: 'alert', tone: 'statusFailed' },
};

export interface PhotoSlotProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'aria-label'
> {
  readonly i18n: Translator;
  /** Angle demandé, déjà traduit (« Frente », « Lado del conductor »). */
  readonly angle: string;
  readonly state: PhotoSlotState;
  /** Aperçu de la photo prise (vignette), décoratif. */
  readonly preview?: ReactNode;
}

/**
 * Case de capture : un bouton qui ouvre la caméra (capture en direct, jamais la galerie, 17 §6.2).
 * Son nom dit l'action et l'angle (« Tomar foto: Frente ») ; l'état est écrit dessous.
 */
export function PhotoSlot({
  i18n,
  angle,
  state,
  preview,
  className,
  type = 'button',
  ...rest
}: PhotoSlotProps) {
  const status = STATUS[state];
  const action = state === 'empty' ? 'common.ui.photo.take' : 'common.ui.photo.retake';
  const statusId = rest.id ? `${rest.id}-status` : undefined;
  return (
    <button
      {...rest}
      type={type}
      disabled={rest.disabled ?? state === 'uploading'}
      aria-describedby={statusId}
      className={cx(
        styles['slot'],
        state !== 'empty' && styles['filled'],
        state === 'failed' && styles['failed'],
        className,
      )}
    >
      <span className={styles['media']} aria-hidden="true">
        {preview ?? <Icon name="camera" />}
      </span>
      <span className={styles['angle']}>{i18n.t(action, { angle })}</span>
      <span id={statusId} className={cx(styles['status'], status.tone && styles[status.tone])}>
        <Icon name={status.icon} />
        {i18n.t(status.key)}
      </span>
    </button>
  );
}
