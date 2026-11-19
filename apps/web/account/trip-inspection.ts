/**
 * Photos d'état du véhicule côté site (US-303, ADR-179 ; 16 TRP-004 ; 10b A03, A04, S09 · check-in,
 * S09 · check-out, UX-07) : lecture DÉFENSIVE de `GET /trips/{id}/inspections/{kind}` (toute forme
 * inattendue ⇒ `null`, l'écran dit l'erreur, jamais une série partielle) et regroupement des angles
 * du gabarit pour l'écran. Jamais de donnée personnelle dans une URL ni dans un journal.
 */
import type { MessageKey } from '@rueda/i18n';
import type { ApiResult } from './api-client.ts';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const SLOT = /^(EXT_[0-9]{2}|INT_[0-9]{2}|FUEL|ODOMETER|KEY|DAMAGE_[0-9]{2})$/;
const HEX64 = /^[0-9a-f]{64}$/;
const GROUPS = ['EXTERIOR', 'INTERIOR', 'FUEL', 'ODOMETER', 'KEY', 'DAMAGE'] as const;

export type InspectionKindSegment = 'checkin' | 'checkout';
export type InspectionRole = 'HOST' | 'GUEST';

export interface InspectionSlotView {
  readonly code: string;
  readonly group: (typeof GROUPS)[number];
  readonly required: boolean;
}

export interface InspectionPhotoView {
  readonly slot: string;
  readonly fileId: string;
  readonly sha256: string;
  readonly receivedAt: string;
}

export interface InspectionSideView {
  readonly role: InspectionRole;
  readonly status: 'NONE' | 'DRAFT' | 'SUBMITTED';
  readonly submittedAt: string | null;
  readonly photos: readonly InspectionPhotoView[];
}

export interface TripInspectionView {
  readonly tripId: string;
  readonly kind: InspectionKindSegment;
  readonly viewerRole: InspectionRole;
  /** Fuseau IANA du pays du trip (heure serveur affichée). */
  readonly timezone: string;
  readonly open: boolean;
  readonly uploads: {
    readonly open: boolean;
    readonly maxBytes: number;
    readonly maxLongSidePx: number;
    readonly mimeTypes: readonly string[];
  };
  readonly slots: readonly InspectionSlotView[];
  readonly mine: InspectionSideView;
  readonly other: InspectionSideView;
}

type Obj = Readonly<Record<string, unknown>>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const isTime = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));

export function kindSegmentOf(raw: string): InspectionKindSegment | null {
  return raw === 'checkin' || raw === 'checkout' ? raw : null;
}

function sideOf(v: unknown): InspectionSideView | null {
  if (!isObj(v) || (v['role'] !== 'HOST' && v['role'] !== 'GUEST')) return null;
  const status = v['status'];
  if (status !== 'NONE' && status !== 'DRAFT' && status !== 'SUBMITTED') return null;
  if (v['submittedAt'] !== null && !isTime(v['submittedAt'])) return null;
  if (!Array.isArray(v['photos'])) return null;
  const photos: InspectionPhotoView[] = [];
  for (const p of v['photos'] as unknown[]) {
    if (
      !isObj(p) ||
      typeof p['slot'] !== 'string' ||
      !SLOT.test(p['slot']) ||
      typeof p['fileId'] !== 'string' ||
      !UUID.test(p['fileId']) ||
      typeof p['sha256'] !== 'string' ||
      !HEX64.test(p['sha256']) ||
      !isTime(p['receivedAt'])
    ) {
      return null;
    }
    photos.push({
      slot: p['slot'],
      fileId: p['fileId'],
      sha256: p['sha256'],
      receivedAt: p['receivedAt'],
    });
  }
  return {
    role: v['role'],
    status,
    submittedAt: v['submittedAt'] as string | null,
    photos,
  };
}

/** Série d'une réponse 200 de `GET /trips/{id}/inspections/{kind}`, sinon `null`. */
export function tripInspectionOf(reply: ApiResult): TripInspectionView | null {
  if (reply.status !== 200 || !isObj(reply.json)) return null;
  const j = reply.json;
  const role = j['viewerRole'];
  const kind = typeof j['kind'] === 'string' ? kindSegmentOf(j['kind']) : null;
  const uploads = j['uploads'];
  if (
    typeof j['tripId'] !== 'string' ||
    !UUID.test(j['tripId']) ||
    kind === null ||
    (role !== 'HOST' && role !== 'GUEST') ||
    typeof j['timezone'] !== 'string' ||
    j['timezone'].length === 0 ||
    typeof j['open'] !== 'boolean' ||
    !isObj(uploads) ||
    typeof uploads['open'] !== 'boolean' ||
    !isInt(uploads['maxBytes']) ||
    !isInt(uploads['maxLongSidePx']) ||
    !Array.isArray(uploads['mimeTypes']) ||
    !Array.isArray(j['slots']) ||
    !Array.isArray(j['sides'])
  ) {
    return null;
  }
  const slots: InspectionSlotView[] = [];
  for (const s of j['slots'] as unknown[]) {
    if (
      !isObj(s) ||
      typeof s['code'] !== 'string' ||
      !SLOT.test(s['code']) ||
      !(GROUPS as readonly unknown[]).includes(s['group']) ||
      typeof s['required'] !== 'boolean'
    ) {
      return null;
    }
    slots.push({
      code: s['code'],
      group: s['group'] as InspectionSlotView['group'],
      required: s['required'],
    });
  }
  const sides = (j['sides'] as unknown[]).map(sideOf);
  const mine = sides.find((s) => s?.role === role);
  const other = sides.find((s) => s !== null && s.role !== role);
  if (sides.some((s) => s === null) || mine === undefined || mine === null || !other) return null;
  return {
    tripId: j['tripId'],
    kind,
    viewerRole: role,
    timezone: j['timezone'],
    open: j['open'],
    uploads: {
      open: uploads['open'],
      maxBytes: uploads['maxBytes'],
      maxLongSidePx: uploads['maxLongSidePx'],
      mimeTypes: (uploads['mimeTypes'] as unknown[]).filter(
        (m): m is string => m === 'image/jpeg' || m === 'image/webp',
      ),
    },
    slots,
    mine,
    other,
  };
}

/** Sections de l'écran (UX-07) : extérieur, intérieur, jauges, puis le facultatif. */
export type InspectionSection = 'EXTERIOR' | 'INTERIOR' | 'GAUGES' | 'OPTIONAL';
export const SECTIONS: readonly InspectionSection[] = [
  'EXTERIOR',
  'INTERIOR',
  'GAUGES',
  'OPTIONAL',
];

export function sectionOf(slot: InspectionSlotView): InspectionSection {
  if (!slot.required) return 'OPTIONAL';
  if (slot.group === 'EXTERIOR' || slot.group === 'INTERIOR') return slot.group;
  return 'GAUGES';
}

/** Libellé d'un angle : clé du catalogue et valeurs (dommage n : `{n}`). */
export function slotLabel(code: string): { key: MessageKey; values?: Record<string, string> } {
  const damage = /^DAMAGE_([0-9]{2})$/.exec(code);
  if (damage !== null) {
    return { key: 'web.inspection.slot.DAMAGE', values: { n: String(Number(damage[1])) } };
  }
  return { key: `web.inspection.slot.${code}` as MessageKey };
}

/** Angles obligatoires pris par une série (la dernière photo de l'angle compte). */
export function requiredProgress(
  slots: readonly InspectionSlotView[],
  side: InspectionSideView,
): { done: number; total: number } {
  const taken = new Set(side.photos.map((p) => p.slot));
  const required = slots.filter((s) => s.required);
  return { done: required.filter((s) => taken.has(s.code)).length, total: required.length };
}
