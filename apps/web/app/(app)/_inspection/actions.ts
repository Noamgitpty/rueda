'use server';
/**
 * Actions serveur des photos d'état du véhicule (US-303, ADR-179 ; 16 TRP-004) :
 *   - `openCaptureAction` : jeton de capture d'un angle, demandé au déclenchement de la caméra de
 *     l'application (`POST /trips/{id}/inspections/{kind}/captures`) ;
 *   - `uploadPhotoAction` : photo prise par la caméra, son empreinte et le jeton
 *     (`POST …/photos`, source `CAMERA`) ;
 *   - `submitInspectionAction` : validation de sa série (formulaire, `POST …/submit`).
 * Entrées revérifiées ici (identifiants, angle, type, empreinte, base64) puis par l'API et la
 * base. Aucune donnée personnelle dans une URL ni dans un journal.
 */
import { redirect } from 'next/navigation';
import type { MessageKey } from '@rueda/i18n';
import { callApi, codeOf } from '../../../account/api-client.ts';
import type { ApiResult } from '../../../account/api-client.ts';
import { messageKeyOf } from '../../../account/host-listings.ts';
import { clientContext } from '../../../account/request.ts';
import { kindSegmentOf, photoSeriesOf, SLOT, UUID } from '../../../account/trip-inspection.ts';

export type InspectionActionResult =
  | { readonly ok: true; readonly captureId?: string }
  | { readonly ok: false; readonly key: MessageKey };

const HEX64 = /^[0-9a-f]{64}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
/** Borne du corps : la photo tient dans le corps JSON de l'API (100 Kio). */
const MAX_BASE64 = 100 * 1024;

function failure(reply: ApiResult): InspectionActionResult {
  if (reply.status === 401) redirect('/login');
  if (codeOf(reply) === 'TERMS_REACCEPT_REQUIRED') redirect('/terms/update');
  return {
    ok: false,
    key:
      reply.status === 'unavailable'
        ? 'common.inspection.unavailable'
        : (messageKeyOf(reply) ?? 'common.error.server'),
  };
}

const valid = (tripId: string, kind: string, slot: string): boolean =>
  // US-318 : aussi les séries libres `incident` et `traffic` (même chaîne, jamais validées)
  UUID.test(tripId) && photoSeriesOf(kind) !== null && SLOT.test(slot);

export async function openCaptureAction(
  tripId: string,
  kind: string,
  slot: string,
): Promise<InspectionActionResult> {
  if (!valid(tripId, kind, slot)) return { ok: false, key: 'common.inspection.notFound' };
  const reply = await callApi(
    'POST',
    `/trips/${tripId}/inspections/${kind}/captures`,
    await clientContext(),
    { slot },
  );
  if (reply.status !== 201) return failure(reply);
  const id = (reply.json as { captureId?: unknown } | null)?.captureId;
  if (typeof id !== 'string' || !UUID.test(id)) return { ok: false, key: 'common.error.server' };
  return { ok: true, captureId: id };
}

export interface PhotoInput {
  readonly tripId: string;
  readonly kind: string;
  readonly slot: string;
  readonly captureId: string;
  readonly sha256: string;
  readonly dataBase64: string;
  readonly deviceCapturedAt: string;
}

export async function uploadPhotoAction(input: PhotoInput): Promise<InspectionActionResult> {
  if (
    !valid(input.tripId, input.kind, input.slot) ||
    !UUID.test(input.captureId) ||
    !HEX64.test(input.sha256) ||
    input.dataBase64.length === 0 ||
    input.dataBase64.length > MAX_BASE64 ||
    !BASE64.test(input.dataBase64) ||
    !Number.isFinite(Date.parse(input.deviceCapturedAt))
  ) {
    return { ok: false, key: 'common.inspection.photoInvalid' };
  }
  const reply = await callApi(
    'POST',
    `/trips/${input.tripId}/inspections/${input.kind}/photos`,
    await clientContext(),
    {
      captureId: input.captureId,
      slot: input.slot,
      source: 'CAMERA',
      deviceCapturedAt: input.deviceCapturedAt,
      sha256: input.sha256,
      dataBase64: input.dataBase64,
    },
  );
  return reply.status === 201 ? { ok: true } : failure(reply);
}

export interface SubmitState {
  readonly key: MessageKey | null;
  readonly missing: number;
}

/** Page de la série, reconstruite (jamais une adresse reçue du formulaire). */
function pageOf(role: string, tripId: string, kind: string, org: string): string {
  const base =
    role === 'HOST'
      ? `/host/trips/${tripId}/inspection/${kind}`
      : `/trips/${tripId}/inspection/${kind}`;
  return role === 'HOST' && UUID.test(org) ? `${base}?org=${org}&` : `${base}?`;
}

export async function submitInspectionAction(
  _prev: SubmitState,
  form: FormData,
): Promise<SubmitState> {
  const field = (name: string) => {
    const v = form.get(name);
    return typeof v === 'string' ? v.trim().slice(0, 40) : '';
  };
  const tripId = field('trip');
  const kind = field('kind');
  if (!UUID.test(tripId) || kindSegmentOf(kind) === null) {
    return { key: 'common.inspection.notFound', missing: 0 };
  }
  const reply = await callApi(
    'POST',
    `/trips/${tripId}/inspections/${kind}/submit`,
    await clientContext(),
    {},
  );
  if (reply.status !== 200) {
    const r = failure(reply);
    const missing =
      reply.status !== 'unavailable' &&
      Array.isArray((reply.json as { missing?: unknown })?.missing)
        ? ((reply.json as { missing: unknown[] }).missing.length ?? 0)
        : 0;
    return { key: r.ok ? null : r.key, missing };
  }
  redirect(`${pageOf(field('role'), tripId, kind, field('org'))}done=1`);
}
