/**
 * Règle fail-closed du port `UploadScanner` (17 §5 : quarantaine avant usage ; US-020, revue code
 * constat 1) : seul un fichier analysé et sain est libéré ; tout autre résultat, y compris un
 * statut ou un verdict inconnu, garde la quarantaine. Attentes écrites à la main depuis 17 §5.
 */
import { FAKE_MALWARE_MARKER, FakeUploadScanner } from '@rueda/fake-adapters/files';
import { describe, expect, it } from 'vitest';
import { isReleasable } from './upload-scanner.ts';
import type { ScanReport, ScanResult, ScanVerdict, UploadScanner } from './upload-scanner.ts';

const scanned = (verdict: ScanVerdict | string): ScanResult => ({
  status: 'SCANNED',
  report: { verdict, detectedMime: 'image/png', threat: null } as ScanReport,
});

const cases: readonly [string, ScanResult, boolean][] = [
  ['SCANNED + CLEAN', scanned('CLEAN'), true],
  ['SCANNED + INFECTED', scanned('INFECTED'), false],
  ['SCANNED + MIME_MISMATCH', scanned('MIME_MISMATCH'), false],
  ['SCANNED + UNSUPPORTED_TYPE', scanned('UNSUPPORTED_TYPE'), false],
  ['SCANNED + verdict inconnu', scanned('SUSPICIOUS'), false],
  ['SCANNED + verdict en minuscules', scanned('clean'), false],
  ['UNAVAILABLE', { status: 'UNAVAILABLE' }, false],
  ['TIMEOUT', { status: 'TIMEOUT' }, false],
  ['statut inconnu (ERROR)', { status: 'ERROR' } as unknown as ScanResult, false],
  [
    'statut inconnu porteur d’un rapport CLEAN',
    { status: 'PARTIAL', report: { verdict: 'CLEAN' } } as unknown as ScanResult,
    false,
  ],
];

describe('isReleasable : seul SCANNED + CLEAN libère (fail-closed)', () => {
  it.each(cases)('%s ⇒ libéré = %s', (_name, result, expected) => {
    expect(isReleasable(result)).toBe(expected);
  });
});

describe('port UploadScanner ← FAKE (conformance, ADR-058)', () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);

  it('le FAKE se conforme au port ; ses résultats passent la règle de quarantaine', async () => {
    const fake = new FakeUploadScanner();
    const scanner: UploadScanner = fake;
    expect(isReleasable(await scanner.scan({ declaredMime: 'image/png', body: PNG }))).toBe(true);
    const infected = Buffer.concat([PNG, Buffer.from(FAKE_MALWARE_MARKER, 'latin1')]);
    expect(isReleasable(await scanner.scan({ declaredMime: 'image/png', body: infected }))).toBe(
      false,
    );
    fake.script.script('scan', { kind: 'TIMEOUT_AFTER' }, { kind: 'UNAVAILABLE' });
    expect(isReleasable(await scanner.scan({ declaredMime: 'image/png', body: PNG }))).toBe(false);
    expect(isReleasable(await scanner.scan({ declaredMime: 'image/png', body: PNG }))).toBe(false);
  });
});
