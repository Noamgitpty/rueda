/**
 * FAKE du magasin des photos d'état du véhicule (US-303) — TESTS SEULEMENT (répertoire `testing`,
 * absent de la compilation de production). Mémoire du processus ; reprend les règles de la base
 * (migration 0158) que les routes exposent : partie de la session (empreinte du jeton), fenêtre de
 * la série, jeton de capture d'un angle (usage unique, échéance), dernière photo de chaque angle,
 * gabarit complet pour valider. Les règles elles-mêmes sont prouvées sur PostgreSQL
 * (`packages/db/test/l0/l0-us303-inspection-photos.test.ts`) ; ce FAKE ne fait pas foi.
 */
import { randomUUID } from 'node:crypto';
import type { InspectionKind, InspectionRole } from '../internal/inspection/model.js';
import type { SqlExecutor } from '../internal/inspection/ports.js';
import type {
  DepositFn,
  InspectionStore,
  InspectionViewRow,
  PhotoRecord,
} from '../internal/inspection/store.js';

/** Gabarit de la version 1 (migration 0158) : 25 angles obligatoires, clés et dommages facultatifs. */
export const TEMPLATE_V1: readonly { code: string; group: string; required: boolean }[] = [
  ...Array.from({ length: 15 }, (_, i) => ({
    code: `EXT_${String(i + 1).padStart(2, '0')}`,
    group: 'EXTERIOR',
    required: true,
  })),
  ...Array.from({ length: 8 }, (_, i) => ({
    code: `INT_${String(i + 1).padStart(2, '0')}`,
    group: 'INTERIOR',
    required: true,
  })),
  { code: 'FUEL', group: 'FUEL', required: true },
  { code: 'ODOMETER', group: 'ODOMETER', required: true },
  { code: 'KEY', group: 'KEY', required: false },
  ...Array.from({ length: 10 }, (_, i) => ({
    code: `DAMAGE_${String(i + 1).padStart(2, '0')}`,
    group: 'DAMAGE',
    required: false,
  })),
];

export interface FakeTrip {
  readonly hostProof: string;
  readonly guestProof: string;
  /** Série ouverte par type (CHECKIN_OPEN ; IN_PROGRESS ou OVERDUE). */
  open: Record<InspectionKind, boolean>;
  maxKb: number | null;
  maxPx: number | null;
}

interface Series {
  status: 'DRAFT' | 'SUBMITTED';
  submittedAt: Date | null;
  photos: { slot: string; fileId: string; sha256: string; bytes: number; receivedAt: Date }[];
}

interface Capture {
  readonly tripId: string;
  readonly kind: InspectionKind;
  readonly role: InspectionRole;
  readonly slot: string;
  readonly expiresAt: Date;
  used: boolean;
}

export class FakeInspectionStore implements InspectionStore {
  readonly trips = new Map<string, FakeTrip>();
  readonly series = new Map<string, Series>();
  readonly captures = new Map<string, Capture>();
  now: () => Date = () => new Date();

  #role(proof: Buffer, tripId: string): InspectionRole | null {
    const t = this.trips.get(tripId);
    const hex = proof.toString('hex');
    if (t === undefined) return null;
    if (hex === t.guestProof) return 'GUEST';
    if (hex === t.hostProof) return 'HOST';
    return null;
  }

  #key(tripId: string, kind: InspectionKind, role: InspectionRole): string {
    return `${tripId}:${kind}:${role}`;
  }

  view(proof: Buffer, tripId: string, kind: InspectionKind): Promise<InspectionViewRow | null> {
    const role = this.#role(proof, tripId);
    const t = this.trips.get(tripId);
    if (role === null || t === undefined) return Promise.resolve(null);
    const sides = (['HOST', 'GUEST'] as const).map((r) => {
      const s = this.series.get(this.#key(tripId, kind, r));
      const latest = new Map<string, Series['photos'][number]>();
      for (const p of s?.photos ?? []) latest.set(p.slot, p);
      return {
        role: r,
        status: s?.status ?? ('NONE' as const),
        submittedAt: s?.submittedAt?.toISOString() ?? null,
        photos: [...latest.values()]
          .sort((a, b) => a.slot.localeCompare(b.slot))
          .map((p) => ({
            slot: p.slot,
            fileId: p.fileId,
            sha256: p.sha256,
            bytes: p.bytes,
            receivedAt: p.receivedAt.toISOString(),
            clockSkew: false,
          })),
      };
    });
    return Promise.resolve({
      viewerRole: role,
      timezone: 'UTC',
      open: t.open[kind],
      maxKb: t.maxKb,
      maxPx: t.maxPx,
      slots: TEMPLATE_V1,
      sides,
    });
  }

  openCapture(proof: Buffer, tripId: string, kind: InspectionKind, slot: string) {
    const fail = (outcome: string) =>
      Promise.resolve({ outcome, captureId: null, expiresAt: null });
    const role = this.#role(proof, tripId);
    if (role === null) return fail('NOT_FOUND');
    if (!this.trips.get(tripId)!.open[kind]) return fail('INSPECTION_NOT_OPEN');
    if (!TEMPLATE_V1.some((s) => s.code === slot)) return fail('REQUEST_INVALID');
    const key = this.#key(tripId, kind, role);
    const s = this.series.get(key) ?? { status: 'DRAFT', submittedAt: null, photos: [] };
    this.series.set(key, s);
    if (s.status !== 'DRAFT') return fail('INSPECTION_SUBMITTED');
    if (s.photos.length >= 100) return fail('PHOTO_LIMIT_REACHED');
    const id = randomUUID();
    const expiresAt = new Date(this.now().getTime() + 120_000);
    this.captures.set(id, { tripId, kind, role, slot, expiresAt, used: false });
    return Promise.resolve({ outcome: 'DONE', captureId: id, expiresAt });
  }

  #ticket(proof: Buffer, tripId: string, kind: InspectionKind, captureId: string, slot: string) {
    const role = this.#role(proof, tripId);
    if (role === null) return 'NOT_FOUND';
    if (!this.trips.get(tripId)!.open[kind]) return 'INSPECTION_NOT_OPEN';
    const c = this.captures.get(captureId);
    if (
      c === undefined ||
      c.tripId !== tripId ||
      c.kind !== kind ||
      c.role !== role ||
      c.slot !== slot ||
      c.used ||
      c.expiresAt <= this.now()
    ) {
      return 'PHOTO_GALLERY_FORBIDDEN';
    }
    if (this.series.get(this.#key(tripId, kind, role))?.status !== 'DRAFT') {
      return 'INSPECTION_SUBMITTED';
    }
    return 'OK';
  }

  captureCheck(
    proof: Buffer,
    tripId: string,
    kind: InspectionKind,
    captureId: string,
    slot: string,
  ) {
    const outcome = this.#ticket(proof, tripId, kind, captureId, slot);
    const t = this.trips.get(tripId);
    return Promise.resolve({
      outcome,
      maxKb: outcome === 'OK' ? (t?.maxKb ?? null) : null,
      maxPx: outcome === 'OK' ? (t?.maxPx ?? null) : null,
    });
  }

  async addPhoto(
    proof: Buffer,
    tripId: string,
    kind: InspectionKind,
    photo: PhotoRecord,
    prepare: (tx: SqlExecutor) => Promise<void>,
    deposit: DepositFn,
  ) {
    const tx: SqlExecutor = { query: () => Promise.resolve({ rows: [] }) };
    const outcome = this.#ticket(proof, tripId, kind, photo.captureId, photo.slot);
    if (outcome !== 'OK') return { outcome, receivedAt: null };
    const role = this.#role(proof, tripId)!;
    // comme la base (0176, ADR-196) : empreinte déjà vue, tous trips ⇒ rien n'est écrit
    const hex = photo.sha256.toString('hex');
    for (const s of this.series.values()) {
      if (s.photos.some((p) => p.sha256 === hex))
        return { outcome: 'PHOTO_DUPLICATE', receivedAt: null };
    }
    await prepare(tx);
    const key = `trips/${tripId}/inspections/${kind}-${role}/${photo.fileId}`;
    await deposit(tx, key);
    const receivedAt = this.now();
    this.captures.get(photo.captureId)!.used = true;
    this.series.get(this.#key(tripId, kind, role))!.photos.push({
      slot: photo.slot,
      fileId: photo.fileId,
      sha256: photo.sha256.toString('hex'),
      bytes: photo.bytes,
      receivedAt,
    });
    return { outcome: 'DONE', receivedAt };
  }

  submit(proof: Buffer, tripId: string, kind: InspectionKind) {
    const role = this.#role(proof, tripId);
    const done = (outcome: string, submittedAt: Date | null, missing: readonly string[] = []) =>
      Promise.resolve({ outcome, submittedAt, missing });
    if (role === null) return done('NOT_FOUND', null);
    const s = this.series.get(this.#key(tripId, kind, role));
    if (s?.status === 'SUBMITTED') return done('ALREADY_SUBMITTED', s.submittedAt);
    if (!this.trips.get(tripId)!.open[kind]) return done('INSPECTION_NOT_OPEN', null);
    const have = new Set((s?.photos ?? []).map((p) => p.slot));
    const missing = TEMPLATE_V1.filter((x) => x.required && !have.has(x.code)).map((x) => x.code);
    if (s === undefined || missing.length > 0) {
      return done('PHOTO_TEMPLATE_INCOMPLETE', null, missing);
    }
    s.status = 'SUBMITTED';
    s.submittedAt = this.now();
    return done('DONE', s.submittedAt);
  }
}
