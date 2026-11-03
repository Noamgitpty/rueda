/**
 * FAKE du port `SignatureService` (module CTR ; 17 §2.7, §5 « Signature électronique », §10 ;
 * ADR-017 ; US-020). Signature électronique simple : acceptation par clic après authentification
 * et OTP récent ; le service enregistre l'empreinte SHA-256 du document présenté, le signataire,
 * l'heure (horloge du FAKE ; en production, heure serveur), la référence OTP et le contexte, puis
 * rend l'empreinte du document re-scellé (bloc de signature visible). Les deux empreintes sont
 * conservées.
 *
 * Contrôles : empreinte mal formée ⇒ `INVALID_DOCUMENT_HASH` ; OTP plus ancien que `maxOtpAgeMs`
 * (fourni par la configuration du test : 17 §2.7 le fixe à 10 min, valeur portée par CTR) ⇒
 * `OTP_TOO_OLD`. `verify` compare une empreinte à celles enregistrées.
 *
 * Cas difficiles : scénarios `sign` / `verify` (panne, délai, issue inconnue, refus, doublon :
 * deux enregistrements de signature pour la même demande).
 */
import { createHash } from 'node:crypto';
import { assertFakeAllowed } from '../guard.ts';
import type { EnvironmentVariables } from '../guard.ts';
import type { FakeClock } from '../core/clock.ts';
import type { Outcome } from '../core/outcome.ts';
import { FakeRuntime, Sequence } from '../core/runtime.ts';

export interface SignRequest {
  readonly idempotencyKey: string;
  /** SHA-256 (hexadécimal minuscule) du PDF exact présenté. */
  readonly documentSha256: string;
  /** Référence opaque du signataire. */
  readonly signerRef: string;
  readonly otpRef: string;
  readonly otpVerifiedAt: Date;
  readonly ip: string;
  readonly userAgent: string;
  readonly context: string;
}

export interface SignatureRecord {
  readonly signatureId: string;
  readonly documentSha256: string;
  readonly signedDocumentSha256: string;
  readonly signerRef: string;
  readonly otpRef: string;
  readonly signedAt: Date;
}

export interface SignatureCheckResult {
  readonly valid: boolean;
  readonly record: SignatureRecord;
}

export type SignatureRefusal = 'INVALID_DOCUMENT_HASH' | 'OTP_TOO_OLD' | 'UNKNOWN_SIGNATURE';

export interface FakeSignatureServiceOptions {
  readonly clock: FakeClock;
  readonly maxOtpAgeMs: number;
  readonly env?: EnvironmentVariables;
}

type SignatureOp = 'sign' | 'verify';

const SHA256_HEX = /^[0-9a-f]{64}$/;

export class FakeSignatureService {
  readonly runtime: FakeRuntime<SignatureOp, SignatureRefusal>;
  readonly #maxOtpAgeMs: number;
  readonly #records = new Map<string, SignatureRecord>();
  readonly #journal: SignatureRecord[] = [];
  readonly #ids = new Sequence('fk_sig');

  constructor(options: FakeSignatureServiceOptions) {
    assertFakeAllowed('FakeSignatureService', options.env);
    if (!Number.isInteger(options.maxOtpAgeMs) || options.maxOtpAgeMs <= 0) {
      throw new RangeError('maxOtpAgeMs doit être un entier positif');
    }
    this.#maxOtpAgeMs = options.maxOtpAgeMs;
    this.runtime = new FakeRuntime(options.clock);
  }

  async sign(
    request: SignRequest,
  ): Promise<Outcome<SignatureRecord, 'INVALID_DOCUMENT_HASH' | 'OTP_TOO_OLD'>> {
    return this.runtime.execute(
      'sign',
      { idempotencyKey: request.idempotencyKey, content: request },
      (times) => {
        if (!SHA256_HEX.test(request.documentSha256)) {
          return { ok: false, reason: 'INVALID_DOCUMENT_HASH' as const };
        }
        const age = this.runtime.clock.nowMs() - request.otpVerifiedAt.getTime();
        if (!(age >= 0 && age <= this.#maxOtpAgeMs)) {
          return { ok: false, reason: 'OTP_TOO_OLD' as const };
        }
        let first: SignatureRecord | undefined;
        for (let i = 0; i < times; i++) {
          const signatureId = this.#ids.next();
          const record: SignatureRecord = {
            signatureId,
            documentSha256: request.documentSha256,
            signedDocumentSha256: createHash('sha256')
              .update(`${request.documentSha256}|${signatureId}`)
              .digest('hex'),
            signerRef: request.signerRef,
            otpRef: request.otpRef,
            signedAt: this.runtime.clock.now(),
          };
          this.#records.set(signatureId, record);
          this.#journal.push(record);
          first ??= record;
        }
        return { ok: true, value: first as SignatureRecord };
      },
    );
  }

  /** Vrai si `sha256` est l'empreinte du document présenté ou celle du document signé. */
  async verify(
    signatureId: string,
    sha256: string,
  ): Promise<Outcome<SignatureCheckResult, 'UNKNOWN_SIGNATURE'>> {
    return this.runtime.execute('verify', { content: [signatureId, sha256] }, () => {
      const record = this.#records.get(signatureId);
      if (record === undefined) return { ok: false, reason: 'UNKNOWN_SIGNATURE' as const };
      const valid = sha256 === record.documentSha256 || sha256 === record.signedDocumentSha256;
      return { ok: true, value: { valid, record } };
    });
  }

  /** Journal des signatures enregistrées (un doublon y figure deux fois). */
  journal(): readonly SignatureRecord[] {
    return [...this.#journal];
  }
}
