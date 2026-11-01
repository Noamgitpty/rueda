/**
 * Encodeur PNG minimal (une couleur unie) pour les icônes provisoires du manifeste : iOS exige une
 * `apple-touch-icon` PNG et Android Chrome des icônes 192 / 512 px pour proposer l'installation.
 * Les vraies icônes seront générées depuis la version de marque publiée (ADR-039, US-048).
 */
import { crc32, deflateSync } from 'node:zlib';

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  const typeAndData = new Uint8Array(4 + data.length);
  for (let i = 0; i < 4; i++) typeAndData[i] = type.charCodeAt(i);
  typeAndData.set(data, 4);
  out.set(typeAndData, 4);
  view.setUint32(8 + data.length, crc32(typeAndData) >>> 0);
  return out;
}

export function solidPng(size: number, rgb: readonly [number, number, number]): Uint8Array {
  if (!Number.isInteger(size) || size < 1 || size > 1024) throw new RangeError('taille invalide');
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, size);
  hv.setUint32(4, size);
  header[8] = 8; // profondeur
  header[9] = 2; // RVB
  const row = 1 + size * 3;
  const raw = new Uint8Array(row * size);
  for (let y = 0; y < size; y++) {
    raw[y * row] = 0; // filtre « aucun »
    for (let x = 0; x < size; x++) raw.set(rgb, y * row + 1 + x * 3);
  }
  const parts = [
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export const LAB_ICON_SIZES = [180, 192, 512] as const;
