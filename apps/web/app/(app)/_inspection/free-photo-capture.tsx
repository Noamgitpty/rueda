'use client';
/**
 * Photos d'une série LIBRE (US-318, ADR-198) : incident du voyageur (S17 · incidente) et pièces
 * d'une amende, d'un péage ou d'une fourrière de l'hôte. Même chaîne que les photos guidées
 * d'US-303, sans la dupliquer : caméra EN DIRECT de l'application (`createWebCameraCapture`, aucun
 * sélecteur de fichier), jeton de capture demandé au déclenchement (`openCaptureAction`), envoi avec
 * l'empreinte de l'appareil (`uploadPhotoAction`) ; l'heure et l'empreinte qui font foi sont celles
 * du serveur, affichées dans le fuseau du trip. Angles `DAMAGE_01` à `DAMAGE_10`, pris dans l'ordre.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createTranslator, getProfile } from '@rueda/i18n';
import type { MessageKey } from '@rueda/i18n';
import { Banner, Button } from '@rueda/ui';
import { nextFreeSlot } from '../../../account/trip-claims.ts';
import { createWebCameraCapture, DEFAULT_PHOTO_POLICY } from '../../../device/index.ts';
import type { CameraSession } from '../../../device/index.ts';
import { LOCALE_CONFIG } from '../../../locale-config.ts';
import accountStyles from '../_account/account.module.css';
import styles from '../host/host.module.css';
import inspectionStyles from './inspection.module.css';
import { openCaptureAction, uploadPhotoAction } from './actions.ts';

export interface FreePhotoCaptureProps {
  readonly localeTag: string;
  readonly tripId: string;
  readonly kind: 'incident' | 'traffic';
  /** Fuseau du trip : l'heure serveur de réception y est affichée. */
  readonly timezone: string;
  /** Photos déjà reçues (angle et heure serveur). */
  readonly taken: readonly { readonly slot: string; readonly receivedAt: string }[];
  /** Envoi possible (fenêtre, bornes du pays, ports branchés). */
  readonly editable: boolean;
  readonly maxBytes: number;
  readonly maxLongSidePx: number;
  readonly testId: string;
}

function base64Of(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function FreePhotoCapture(props: FreePhotoCaptureProps) {
  const i18n = createTranslator(getProfile(LOCALE_CONFIG, props.localeTag));
  const t = i18n.t.bind(i18n);
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const session = useRef<CameraSession | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [notice, setNotice] = useState(false);
  const slot = nextFreeSlot(props.taken.map((p) => p.slot));

  const close = () => {
    session.current?.stop();
    session.current = null;
    setOpen(false);
  };
  useEffect(() => () => session.current?.stop(), []);

  const openCamera = async () => {
    setError(null);
    setNotice(false);
    close();
    setOpen(true);
    const camera = createWebCameraCapture(
      { isSecureContext: window.isSecureContext, mediaDevices: navigator.mediaDevices },
      {
        policy: {
          ...DEFAULT_PHOTO_POLICY,
          maxLongSidePx: Math.min(DEFAULT_PHOTO_POLICY.maxLongSidePx, props.maxLongSidePx),
          maxBytes: props.maxBytes,
          longSideSteps: [1280, 1024, 800, 640].filter((s) => s < props.maxLongSidePx),
        },
      },
    );
    if (!camera.availability().available || video.current === null) {
      setError('web.inspection.camera.unavailable');
      setOpen(false);
      return;
    }
    try {
      session.current = await camera.open(video.current);
    } catch {
      setError('web.inspection.camera.unavailable');
      setOpen(false);
    }
  };

  const shoot = async () => {
    const s = session.current;
    if (slot === null || s === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      // jeton AVANT la prise de vue : la photo suit le déclenchement de la caméra
      const ticket = await openCaptureAction(props.tripId, props.kind, slot);
      if (!ticket.ok || ticket.captureId === undefined) {
        setError(ticket.ok ? 'common.error.server' : ticket.key);
        return;
      }
      const photo = await s.capture();
      if (photo.overBudget) {
        setError('common.inspection.photoInvalid');
        return;
      }
      const bytes = new Uint8Array(await photo.blob.arrayBuffer());
      const sent = await uploadPhotoAction({
        tripId: props.tripId,
        kind: props.kind,
        slot,
        captureId: ticket.captureId,
        sha256: photo.sha256Hex,
        dataBase64: base64Of(bytes),
        deviceCapturedAt: photo.deviceCapturedAt,
      });
      if (!sent.ok) {
        setError(sent.key);
        return;
      }
      setNotice(true);
      close();
      router.refresh();
    } catch {
      setError('common.inspection.photoInvalid');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={accountStyles['stack']} data-testid={`${props.testId}-photos`}>
      {notice && (
        <Banner tone="success" live="polite">
          {t('web.freePhotos.sent')}
        </Banner>
      )}
      {error !== null && (
        <Banner tone="danger" live="assertive">
          {t(error)}
        </Banner>
      )}
      {props.taken.length === 0 ? (
        <p className={accountStyles['muted']} data-testid={`${props.testId}-photos-none`}>
          {t('web.freePhotos.none')}
        </p>
      ) : (
        <ol className={styles['rows']} aria-label={t('web.freePhotos.list')}>
          {props.taken.map((p, i) => (
            <li key={p.slot} className={styles['card']}>
              {t('web.freePhotos.item', {
                n: String(i + 1),
                time: i18n.dateTime(p.receivedAt, props.timezone),
              })}
            </li>
          ))}
        </ol>
      )}
      {props.editable && (
        <section
          className={open ? styles['card'] : inspectionStyles['closed']}
          hidden={!open}
          aria-label={t('web.freePhotos.camera')}
        >
          <video ref={video} playsInline muted className={inspectionStyles['preview']} />
          <div className={styles['actions']}>
            <Button block loading={busy} onClick={() => void shoot()}>
              {t('web.inspection.shoot')}
            </Button>
            <Button variant="secondary" block onClick={close}>
              {t('web.inspection.camera.close')}
            </Button>
          </div>
        </section>
      )}
      {props.editable && !open && slot !== null && (
        <Button
          variant="secondary"
          block
          onClick={() => void openCamera()}
          data-testid={`${props.testId}-take`}
        >
          {t('web.freePhotos.take')}
        </Button>
      )}
      {props.editable && slot === null && (
        <p className={accountStyles['muted']}>{t('web.freePhotos.full')}</p>
      )}
      <p className={accountStyles['muted']}>{t('web.freePhotos.cameraOnly')}</p>
    </div>
  );
}
