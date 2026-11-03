/**
 * TOTP et base32 : vecteurs des RFC (valeurs attendues de RFC 4226 annexe D, RFC 6238 annexe B,
 * RFC 4648 §10), jamais calculées par le code testé.
 */
import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  hotp,
  matchTotp,
  normalizeTotpCode,
  otpauthUri,
  totpStep,
} from './totp.js';

const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');

describe('base32 (RFC 4648 §10, sans remplissage)', () => {
  it.each([
    ['', ''],
    ['f', 'MY'],
    ['fo', 'MZXQ'],
    ['foo', 'MZXW6'],
    ['foob', 'MZXW6YQ'],
    ['fooba', 'MZXW6YTB'],
    ['foobar', 'MZXW6YTBOI'],
  ])('%j <-> %s', (plain, encoded) => {
    expect(base32Encode(Buffer.from(plain))).toBe(encoded);
    expect(base32Decode(encoded)?.toString()).toBe(plain);
  });

  it('décodage tolérant (casse, espaces, =) ; caractère hors alphabet => null', () => {
    expect(base32Decode('mzxw 6ytb oi======')?.toString()).toBe('foobar');
    expect(base32Decode('MZXW1')).toBeNull();
  });
});

describe('HOTP (RFC 4226 annexe D)', () => {
  it('compteurs 0 à 9', () => {
    const expected = [
      '755224',
      '287082',
      '359152',
      '969429',
      '338314',
      '254676',
      '287922',
      '162583',
      '399871',
      '520489',
    ];
    expect(expected.map((_, i) => hotp(RFC_SECRET, i))).toEqual(expected);
  });
});

describe('TOTP (RFC 6238 annexe B, SHA-1)', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('T = %i s : %s (8 chiffres) ; 6 derniers chiffres pour 6', (t, code) => {
    expect(hotp(RFC_SECRET, totpStep(t * 1000), 8)).toBe(code);
    expect(hotp(RFC_SECRET, totpStep(t * 1000))).toBe(code.slice(2));
  });

  it('fenêtre ±1 pas, pas reconnu rendu ; hors fenêtre ou déjà consommé => null', () => {
    const now = 1111111111 * 1000;
    const step = totpStep(now);
    expect(matchTotp(RFC_SECRET, hotp(RFC_SECRET, step), now)).toBe(step);
    expect(matchTotp(RFC_SECRET, hotp(RFC_SECRET, step - 1), now)).toBe(step - 1);
    expect(matchTotp(RFC_SECRET, hotp(RFC_SECRET, step + 1), now)).toBe(step + 1);
    expect(matchTotp(RFC_SECRET, hotp(RFC_SECRET, step - 2), now)).toBeNull();
    expect(matchTotp(RFC_SECRET, hotp(RFC_SECRET, step + 2), now)).toBeNull();
    // anti-rejeu : un pas déjà utilisé (ou antérieur) n'est jamais rendu
    expect(matchTotp(RFC_SECRET, hotp(RFC_SECRET, step), now, step)).toBeNull();
    expect(matchTotp(RFC_SECRET, hotp(RFC_SECRET, step + 1), now, step)).toBe(step + 1);
    expect(matchTotp(Buffer.from('autre secret'), hotp(RFC_SECRET, step), now)).toBeNull();
  });

  it('code saisi : 6 chiffres, espaces tolérés', () => {
    expect(normalizeTotpCode(' 123 456 ')).toBe('123456');
    for (const bad of ['12345', '1234567', 'abcdef', 123456, null]) {
      expect(normalizeTotpCode(bad), String(bad)).toBeNull();
    }
  });

  it('URI otpauth : secret base32, SHA1, 6 chiffres, 30 s', () => {
    const uri = new URL(otpauthUri({ issuer: 'Console', account: 'staff', secret: RFC_SECRET }));
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.searchParams.get('secret')).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(uri.searchParams.get('algorithm')).toBe('SHA1');
    expect(uri.searchParams.get('digits')).toBe('6');
    expect(uri.searchParams.get('period')).toBe('30');
  });
});
