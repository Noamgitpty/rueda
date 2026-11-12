/**
 * Type réel et verdict de l'antivirus des pièces du véhicule (US-124 ; pré-mortem L1-PM-41,
 * L1-PM-43 ; ADR-107). Attendus : liste blanche JPEG, PNG, HEIC (marques ISO-BMFF de la liste),
 * PDF ; tout le reste refusé ; seul un verdict CLEAN dont le type détecté égale le type lu libère.
 */
import { describe, expect, it } from 'vitest';
import {
  documentsOpen,
  isCleanDocument,
  sniffDocumentMime,
  UNAVAILABLE_DOCUMENTS,
  UnavailableDocumentScanner,
} from './ports.js';
import type { DocumentScanResult } from './ports.js';

const hex = (h: string) => Buffer.from(h.replace(/ /g, ''), 'hex');
const ftyp = (brand: string) =>
  Buffer.concat([hex('00000018'), Buffer.from('ftyp', 'latin1'), Buffer.from(brand, 'latin1')]);

describe('sniffDocumentMime', () => {
  it('liste blanche lue sur les octets', () => {
    expect(sniffDocumentMime(hex('ffd8ffe0 0010'))).toBe('image/jpeg');
    expect(sniffDocumentMime(hex('89504e470d0a1a0a 0000'))).toBe('image/png');
    expect(sniffDocumentMime(Buffer.from('%PDF-1.7\n', 'latin1'))).toBe('application/pdf');
    for (const brand of ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']) {
      expect(sniffDocumentMime(ftyp(brand)), brand).toBe('image/heic');
    }
  });

  it('refus : SVG, HTML, texte, archive, marque ISO-BMFF inconnue, fichier tronqué ou vide', () => {
    for (const body of [
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>', 'utf8'),
      Buffer.from('<!doctype html><script>x</script>', 'utf8'),
      Buffer.from('titre en clair', 'utf8'),
      hex('504b0304'),
      ftyp('isom'),
      ftyp('mp42'),
      hex('ffd8'),
      hex('89504e47'),
      Buffer.from('%PDF', 'latin1'),
      Buffer.alloc(0),
      // préfixe d'image en fin de fichier seulement : refusé (seul le début compte)
      Buffer.concat([Buffer.from('<html>', 'utf8'), hex('ffd8ff')]),
    ]) {
      expect(sniffDocumentMime(body), body.toString('hex').slice(0, 24)).toBeNull();
    }
  });
});

describe('isCleanDocument', () => {
  const scanned = (verdict: string, detectedMime: string | null): DocumentScanResult => ({
    status: 'SCANNED',
    report: { verdict, detectedMime },
  });

  it('seul CLEAN du type lu libère', () => {
    expect(isCleanDocument(scanned('CLEAN', 'application/pdf'), 'application/pdf')).toBe(true);
  });

  it('type détecté différent, absent, ou tout autre verdict : refusé', () => {
    for (const detected of ['image/png', 'application/x-pdf', 'text/html', null]) {
      expect(isCleanDocument(scanned('CLEAN', detected), 'application/pdf'), String(detected)).toBe(
        false,
      );
    }
    for (const verdict of [
      'INFECTED',
      'MIME_MISMATCH',
      'UNSUPPORTED_TYPE',
      'ENCRYPTED',
      'clean',
      '',
    ]) {
      expect(isCleanDocument(scanned(verdict, 'image/jpeg'), 'image/jpeg'), verdict).toBe(false);
    }
    expect(isCleanDocument({ status: 'UNAVAILABLE' }, 'image/jpeg')).toBe(false);
    expect(isCleanDocument({ status: 'TIMEOUT' }, 'image/jpeg')).toBe(false);
  });

  it('production : adaptateurs indisponibles, dépôt fermé', async () => {
    expect(documentsOpen(UNAVAILABLE_DOCUMENTS)).toBe(false);
    expect(await new UnavailableDocumentScanner().scan()).toEqual({ status: 'UNAVAILABLE' });
  });
});
