/**
 * UUID v7 (RFC 9562 §5.7) : 48 bits d'horodatage Unix en millisecondes, version 7, variante
 * 10xx, 74 bits aléatoires. Clés primaires générées côté application (17 §3.1.1).
 *
 * Rappel de 17 §3.1.1 : un UUID v7 révèle son heure de création ; aucun accès par identifiant
 * sans contrôle d'appartenance.
 */
import { randomBytes } from 'node:crypto';

export function uuidV7(nowMs: number = Date.now(), random: Buffer = randomBytes(10)): string {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || nowMs >= 2 ** 48) {
    throw new RangeError('horodatage hors de la plage d’un UUID v7');
  }
  if (random.length < 10) throw new RangeError('10 octets aléatoires attendus');
  const b = Buffer.alloc(16);
  b.writeUIntBE(nowMs, 0, 6);
  b[6] = 0x70 | ((random[0] as number) & 0x0f);
  b[7] = random[1] as number;
  b[8] = 0x80 | ((random[2] as number) & 0x3f);
  random.copy(b, 9, 3, 10);
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
