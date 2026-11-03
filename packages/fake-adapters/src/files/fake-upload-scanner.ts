/**
 * FAKE du port `UploadScanner` (module AUD ; port défini dans `@rueda/db/audit` ; 17 §5
 * « Antivirus et contrôle des téléversements » ; US-020). Rend un verdict déterministe :
 *
 * - type réel détecté par signature d'octets (JPEG, PNG, WebP, PDF) ; inconnu ⇒
 *   `UNSUPPORTED_TYPE` ; type réel ≠ type déclaré ⇒ `MIME_MISMATCH` ;
 * - marqueur ASCII `FAKE-MALWARE-SIGNATURE` dans le contenu ⇒ `INFECTED` (aucune vraie signature
 *   virale dans le dépôt, pas même EICAR) ;
 * - sinon `CLEAN`.
 *
 * Seul `CLEAN` libère le fichier ; tout le reste le laisse en quarantaine (fail-closed, règle de
 * l'appelant). Cas difficiles (scénario `scan`) : panne, délai, issue inconnue ; `REFUSE` force
 * `INFECTED` avec le motif scripté comme menace ; `DUPLICATE` rend le même verdict (lecture pure).
 */
import { assertFakeAllowed } from '../guard.ts';
import type { EnvironmentVariables } from '../guard.ts';
import { FakeClock } from '../core/clock.ts';
import { Script } from '../core/script.ts';

export type ScanVerdict = 'CLEAN' | 'INFECTED' | 'MIME_MISMATCH' | 'UNSUPPORTED_TYPE';

export interface ScanRequest {
  readonly declaredMime: string;
  readonly body: Buffer;
}

export interface ScanReport {
  readonly verdict: ScanVerdict;
  readonly detectedMime: string | null;
  readonly threat: string | null;
}

export type ScanResult =
  | { readonly status: 'SCANNED'; readonly report: ScanReport }
  | { readonly status: 'UNAVAILABLE' }
  | { readonly status: 'TIMEOUT' };

export interface FakeUploadScannerOptions {
  readonly clock?: FakeClock;
  readonly env?: EnvironmentVariables;
}

export const FAKE_MALWARE_MARKER = 'FAKE-MALWARE-SIGNATURE';

const SIGNATURES: readonly { readonly mime: string; readonly test: (b: Buffer) => boolean }[] = [
  {
    mime: 'image/jpeg',
    test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/png',
    test: (b) =>
      b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mime: 'image/webp',
    test: (b) =>
      b.subarray(0, 4).toString('latin1') === 'RIFF' &&
      b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
  { mime: 'application/pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
];

export function sniffMime(body: Buffer): string | null {
  return SIGNATURES.find((s) => s.test(body))?.mime ?? null;
}

export class FakeUploadScanner {
  readonly script = new Script<'scan'>();
  readonly clock: FakeClock;

  constructor(options: FakeUploadScannerOptions = {}) {
    assertFakeAllowed('FakeUploadScanner', options.env);
    this.clock = options.clock ?? new FakeClock('2000-01-01T00:00:00Z');
  }

  async scan(request: ScanRequest): Promise<ScanResult> {
    const step = this.script.next('scan');
    if (step.kind === 'UNAVAILABLE') return { status: 'UNAVAILABLE' };
    if (step.kind === 'TIMEOUT_BEFORE' || step.kind === 'TIMEOUT_AFTER')
      return { status: 'TIMEOUT' };
    if (step.kind === 'DELAY') await this.clock.sleep(step.ms);
    const detectedMime = sniffMime(request.body);
    if (step.kind === 'REFUSE') {
      return {
        status: 'SCANNED',
        report: { verdict: 'INFECTED', detectedMime, threat: step.reason },
      };
    }
    if (request.body.includes(FAKE_MALWARE_MARKER, 0, 'latin1')) {
      return {
        status: 'SCANNED',
        report: { verdict: 'INFECTED', detectedMime, threat: FAKE_MALWARE_MARKER },
      };
    }
    const verdict: ScanVerdict =
      detectedMime === null
        ? 'UNSUPPORTED_TYPE'
        : detectedMime !== request.declaredMime.toLowerCase()
          ? 'MIME_MISMATCH'
          : 'CLEAN';
    return { status: 'SCANNED', report: { verdict, detectedMime, threat: null } };
  }
}
