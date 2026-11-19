'use client';
/**
 * Assistant photo guidé par angle (US-303 ; 10b UX-07, A03, A04, S09 · check-in / check-out ;
 * 16 TRP-004) : une case par angle du gabarit (extérieur, intérieur, jauges, facultatif), compteur
 * des photos obligatoires, caméra EN DIRECT de l'application (`CameraCapture`, getUserMedia et
 * canevas : aucun sélecteur de fichier, la galerie n'est jamais proposée), puis validation de la
 * série. Pour chaque photo : jeton de capture demandé au déclenchement, image encodée sous le
 * budget annoncé par l'API (grand côté et taille du pays), empreinte SHA-256 de l'appareil, envoi ;
 * l'heure et l'empreinte qui font foi sont celles du serveur.
 */
import { useActionState, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createTranslator, getProfile } from '@rueda/i18n';
import type { MessageKey } from '@rueda/i18n';
import { Banner, Button, PhotoSlot } from '@rueda/ui';
import type { PhotoSlotState } from '@rueda/ui';
import { createWebCameraCapture, DEFAULT_PHOTO_POLICY } from '../../../device/index.ts';
import type { CameraSession } from '../../../device/index.ts';
import { sectionOf, SECTIONS, slotLabel } from '../../../account/trip-inspection.ts';
import type { InspectionSlotView } from '../../../account/trip-inspection.ts';
import { LOCALE_CONFIG } from '../../../locale-config.ts';
import accountStyles from '../_account/account.module.css';
import styles from '../host/host.module.css';
import inspectionStyles from './inspection.module.css';
import { openCaptureAction, submitInspectionAction, uploadPhotoAction } from './actions.ts';
import type { SubmitState } from './actions.ts';

export interface InspectionCaptureProps {
  readonly localeTag: string;
  readonly tripId: string;
  readonly kind: 'checkin' | 'checkout';
  readonly role: 'HOST' | 'GUEST';
  readonly org: string | null;
  /** Fuseau du trip : l'heure serveur de réception y est affichée. */
  readonly timezone: string;
  readonly slots: readonly InspectionSlotView[];
  /** Angles déjà reçus (dernière photo de chaque angle) → heure de réception affichée. */
  readonly taken: Readonly<Record<string, string>>;
  /** Envoi possible (fenêtre, bornes du pays, ports branchés) et série non validée. */
  readonly editable: boolean;
  readonly maxBytes: number;
  readonly maxLongSidePx: number;
}

const INITIAL: SubmitState = { key: null, missing: 0 };

function base64Of(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function InspectionCapture(props: InspectionCaptureProps) {
  const i18n = createTranslator(getProfile(LOCALE_CONFIG, props.localeTag));
  const t = i18n.t.bind(i18n);
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const session = useRef<CameraSession | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<MessageKey | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [state, submit, pending] = useActionState(submitInspectionAction, INITIAL);

  const label = (code: string) => {
    const l = slotLabel(code);
    return t(l.key, l.values);
  };

  const closeCamera = () => {
    session.current?.stop();
    session.current = null;
    setSlot(null);
  };
  useEffect(() => () => session.current?.stop(), []);

  const openCamera = async (code: string) => {
    setError(null);
    setNotice(null);
    closeCamera();
    setSlot(code);
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
      return;
    }
    try {
      session.current = await camera.open(video.current);
    } catch {
      setError('web.inspection.camera.unavailable');
      setSlot(null);
    }
  };

  const shoot = async () => {
    const code = slot;
    const s = session.current;
    if (code === null || s === null || busy !== null) return;
    setBusy(code);
    setError(null);
    try {
      // jeton AVANT la prise de vue : la photo suit le déclenchement de la caméra
      const ticket = await openCaptureAction(props.tripId, props.kind, code);
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
        slot: code,
        captureId: ticket.captureId,
        sha256: photo.sha256Hex,
        dataBase64: base64Of(bytes),
        deviceCapturedAt: photo.deviceCapturedAt,
      });
      if (!sent.ok) {
        setFailed((f) => new Set([...f, code]));
        setError(sent.key);
        return;
      }
      setFailed((f) => new Set([...f].filter((x) => x !== code)));
      setNotice(t('web.inspection.sent', { slot: label(code) }));
      closeCamera();
      router.refresh();
    } catch {
      setError('common.inspection.photoInvalid');
    } finally {
      setBusy(null);
    }
  };

  const stateOf = (code: string): PhotoSlotState =>
    busy === code
      ? 'uploading'
      : failed.has(code)
        ? 'failed'
        : props.taken[code] !== undefined
          ? 'uploaded'
          : 'empty';

  return (
    <div className={accountStyles['stack']} data-testid="inspection-capture">
      {notice !== null && (
        <Banner tone="success" live="polite">
          {notice}
        </Banner>
      )}
      {error !== null && (
        <Banner tone="danger" live="assertive">
          {t(error)}
        </Banner>
      )}
      {props.editable && (
        <section
          className={slot === null ? inspectionStyles['closed'] : styles['card']}
          hidden={slot === null}
          aria-label={
            slot === null ? undefined : t('web.inspection.camera.for', { slot: label(slot) })
          }
          data-testid="inspection-camera"
        >
          {slot !== null && (
            <p className={styles['strong']}>
              {t('web.inspection.camera.for', { slot: label(slot) })}
            </p>
          )}
          <video ref={video} playsInline muted className={inspectionStyles['preview']} />
          <div className={styles['actions']}>
            <Button block loading={busy !== null} onClick={() => void shoot()}>
              {t('web.inspection.shoot')}
            </Button>
            <Button variant="secondary" block onClick={closeCamera}>
              {t('web.inspection.camera.close')}
            </Button>
          </div>
        </section>
      )}
      {SECTIONS.map((section) => {
        const list = props.slots.filter((s) => sectionOf(s) === section);
        if (list.length === 0) return null;
        return (
          <section key={section} className={styles['section']} aria-labelledby={`insp-${section}`}>
            <h2 id={`insp-${section}`} className={accountStyles['h2']}>
              {t(`web.inspection.group.${section}` as MessageKey)}
            </h2>
            <ul className={styles['rows']}>
              {list.map((s) => (
                <li key={s.code} data-testid={`inspection-slot-${s.code}`}>
                  <PhotoSlot
                    id={`slot-${s.code}`}
                    i18n={i18n}
                    angle={label(s.code)}
                    state={stateOf(s.code)}
                    disabled={!props.editable || busy !== null}
                    onClick={() => void openCamera(s.code)}
                  />
                  {props.taken[s.code] !== undefined && (
                    <p className={styles['hint']}>
                      {t('web.inspection.taken', {
                        time: i18n.dateTime(props.taken[s.code] as string, props.timezone),
                      })}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {props.editable && (
        <form action={submit} className={styles['actions']} noValidate>
          {state.key !== null && (
            <Banner tone="danger" live="assertive">
              {state.missing > 0
                ? t('web.inspection.missing', { count: state.missing })
                : t(state.key)}
            </Banner>
          )}
          <input type="hidden" name="trip" value={props.tripId} />
          <input type="hidden" name="kind" value={props.kind} />
          <input type="hidden" name="role" value={props.role} />
          <input type="hidden" name="org" value={props.org ?? ''} />
          <p className={accountStyles['muted']}>{t('web.inspection.submitHint')}</p>
          <Button type="submit" block loading={pending} data-testid="inspection-submit">
            {t('web.inspection.submit')}
          </Button>
        </form>
      )}
    </div>
  );
}
