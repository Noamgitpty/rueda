import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PHOTO_POLICY,
  FRESH_FILE_MAX_AGE_MS,
  assessPickedFile,
  cameraAvailability,
  encodeUnderBudget,
  fitWithin,
} from './camera-capture';

describe('cameraAvailability', () => {
  const getUserMedia = async () => ({}) as MediaStream;

  it('refuse hors contexte sécurisé (HTTP sur le réseau local)', () => {
    expect(cameraAvailability({ isSecureContext: false, mediaDevices: { getUserMedia } })).toEqual({
      available: false,
      reason: 'insecure-context',
    });
  });

  it('refuse sans mediaDevices', () => {
    expect(cameraAvailability({ isSecureContext: true, mediaDevices: undefined })).toEqual({
      available: false,
      reason: 'no-media-devices',
    });
  });

  it('accepte en HTTPS avec getUserMedia', () => {
    expect(cameraAvailability({ isSecureContext: true, mediaDevices: { getUserMedia } })).toEqual({
      available: true,
    });
  });
});

describe('fitWithin', () => {
  it('réduit le grand côté à 1 600 px en gardant les proportions (paysage)', () => {
    expect(fitWithin(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 });
  });

  it('réduit aussi en portrait', () => {
    expect(fitWithin(1080, 1920, 1600)).toEqual({ width: 900, height: 1600 });
  });

  it("n'agrandit jamais", () => {
    expect(fitWithin(1280, 720, 1600)).toEqual({ width: 1280, height: 720 });
  });

  it('rejette des dimensions vides (vidéo pas encore prête)', () => {
    expect(() => fitWithin(0, 0, 1600)).toThrow(RangeError);
  });
});

describe('encodeUnderBudget', () => {
  const blobOf = (bytes: number) => new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });

  it('garde la première qualité sous 500 ko', async () => {
    const tried: number[] = [];
    const sizes = new Map([
      [0.85, 700_000],
      [0.75, 520_000],
      [0.65, 480_000],
    ]);
    const result = await encodeUnderBudget(async (q) => {
      tried.push(q);
      return blobOf(sizes.get(q) ?? 100_000);
    });
    expect(tried).toEqual([0.85, 0.75, 0.65]);
    expect(result.quality).toBe(0.65);
    expect(result.overBudget).toBe(false);
    expect(result.blob.size).toBe(480_000);
  });

  it('accepte exactement le budget', async () => {
    const result = await encodeUnderBudget(async () => blobOf(DEFAULT_PHOTO_POLICY.maxBytes));
    expect(result).toMatchObject({ quality: 0.85, overBudget: false });
  });

  it('signale le dépassement si aucune qualité ne passe', async () => {
    const result = await encodeUnderBudget(async () => blobOf(900_000));
    expect(result.quality).toBe(0.45);
    expect(result.overBudget).toBe(true);
  });

  it('rejette une politique sans qualité', async () => {
    await expect(
      encodeUnderBudget(async () => blobOf(1), { ...DEFAULT_PHOTO_POLICY, qualitySteps: [] }),
    ).rejects.toThrow(RangeError);
  });
});

describe('assessPickedFile', () => {
  const now = Date.parse('2026-10-31T12:00:00Z');

  it('photo prise à l’instant : pas suspecte', () => {
    const r = assessPickedFile({ lastModified: now - 5_000, size: 1, type: 'image/jpeg' }, now);
    expect(r).toEqual({ ageMs: 5_000, likelyFromLibrary: false });
  });

  it('photo ancienne de la photothèque : suspecte', () => {
    const r = assessPickedFile(
      { lastModified: Date.parse('2026-09-01T00:00:00Z'), size: 1, type: 'image/jpeg' },
      now,
    );
    expect(r.likelyFromLibrary).toBe(true);
  });

  it('borne : exactement le seuil reste « fraîche »', () => {
    const r = assessPickedFile(
      { lastModified: now - FRESH_FILE_MAX_AGE_MS, size: 1, type: 'image/jpeg' },
      now,
    );
    expect(r.likelyFromLibrary).toBe(false);
  });
});
