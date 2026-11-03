import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FakeSignatureService } from '../src/signature/index.ts';
import type { SignRequest } from '../src/signature/index.ts';
import { clock } from './support.ts';

const TEN_MINUTES = 10 * 60_000; // 17 §2.7 : OTP récent (≤ 10 min), valeur portée par CTR
const PDF_SHA = createHash('sha256').update('contrat de location v1').digest('hex');

function setup() {
  const c = clock();
  const ctr = new FakeSignatureService({ clock: c, maxOtpAgeMs: TEN_MINUTES });
  const request = (over: Partial<SignRequest> = {}): SignRequest => ({
    idempotencyKey: 'ctr:trip-1:sign',
    documentSha256: PDF_SHA,
    signerRef: 'usr_0001',
    otpRef: 'otp_0001',
    otpVerifiedAt: new Date(c.nowMs() - 60_000),
    ip: '192.0.2.10',
    userAgent: 'vitest',
    context: 'RENTAL_CONTRACT',
    ...over,
  });
  return { ctr, request, c };
}

describe('FakeSignatureService (signature simple, ADR-017)', () => {
  it('réussite : deux empreintes conservées, vérifiables ; autre document refusé', async () => {
    const { ctr, request } = setup();
    const out = await ctr.sign(request());
    if (out.status !== 'OK') throw new Error('signature attendue');
    expect(out.value).toMatchObject({
      signatureId: 'fk_sig_000001',
      documentSha256: PDF_SHA,
      signedAt: new Date('2026-11-03T12:00:00Z'),
    });
    expect(out.value.signedDocumentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(out.value.signedDocumentSha256).not.toBe(PDF_SHA);
    expect(await ctr.verify('fk_sig_000001', PDF_SHA)).toMatchObject({ value: { valid: true } });
    expect(await ctr.verify('fk_sig_000001', out.value.signedDocumentSha256)).toMatchObject({
      value: { valid: true },
    });
    const other = createHash('sha256').update('autre').digest('hex');
    expect(await ctr.verify('fk_sig_000001', other)).toMatchObject({ value: { valid: false } });
    expect(await ctr.verify('fk_sig_999999', PDF_SHA)).toEqual({
      status: 'REFUSED',
      reason: 'UNKNOWN_SIGNATURE',
    });
  });

  it('refus : OTP trop ancien (borne incluse), OTP daté du futur, empreinte mal formée', async () => {
    const { ctr, request, c } = setup();
    expect(
      (
        await ctr.sign(
          request({ idempotencyKey: 'a', otpVerifiedAt: new Date(c.nowMs() - TEN_MINUTES) }),
        )
      ).status,
    ).toBe('OK');
    expect(
      await ctr.sign(
        request({ idempotencyKey: 'b', otpVerifiedAt: new Date(c.nowMs() - TEN_MINUTES - 1) }),
      ),
    ).toEqual({ status: 'REFUSED', reason: 'OTP_TOO_OLD' });
    expect(
      await ctr.sign(request({ idempotencyKey: 'c', otpVerifiedAt: new Date(c.nowMs() + 1) })),
    ).toEqual({ status: 'REFUSED', reason: 'OTP_TOO_OLD' });
    expect(
      await ctr.sign(request({ idempotencyKey: 'd', documentSha256: PDF_SHA.toUpperCase() })),
    ).toEqual({ status: 'REFUSED', reason: 'INVALID_DOCUMENT_HASH' });
  });

  it('échec : panne puis issue inconnue ; le rejeu rend la même signature, sans second enregistrement', async () => {
    const { ctr, request } = setup();
    ctr.runtime.script.script('sign', { kind: 'UNAVAILABLE' }, { kind: 'TIMEOUT_AFTER' });
    expect(await ctr.sign(request())).toEqual({ status: 'UNAVAILABLE' });
    expect(await ctr.sign(request())).toEqual({ status: 'TIMEOUT' });
    expect(await ctr.sign(request())).toMatchObject({
      status: 'OK',
      replayed: true,
      value: { signatureId: 'fk_sig_000001' },
    });
    expect(ctr.journal()).toHaveLength(1);
    expect(
      await ctr.sign(request({ documentSha256: createHash('sha256').update('v2').digest('hex') })),
    ).toEqual({ status: 'REFUSED', reason: 'IDEMPOTENCY_CONFLICT' });
  });

  it('doublon : deux enregistrements pour une demande ; délai simulé', async () => {
    const { ctr, request, c } = setup();
    ctr.runtime.script.script('sign', { kind: 'DUPLICATE' }, { kind: 'DELAY', ms: 5_000 });
    await ctr.sign(request());
    expect(ctr.journal().map((r) => r.signatureId)).toEqual(['fk_sig_000001', 'fk_sig_000002']);
    expect((await ctr.sign(request({ idempotencyKey: 'x' }))).status).toBe('OK');
    expect(c.now().toISOString()).toBe('2026-11-03T12:00:05.000Z');
  });
});
