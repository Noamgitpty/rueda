/**
 * Empreinte SHA-256 calculée sur l'appareil (TRP-057 : elle doit être identique à celle que le
 * serveur calcule à la réception). WebCrypto n'existe qu'en contexte sécurisé (HTTPS) : sans lui,
 * on échoue explicitement plutôt que de produire une empreinte « maison ».
 */
export class SubtleCryptoUnavailableError extends Error {
  constructor() {
    super('crypto.subtle indisponible (contexte non sécurisé ? HTTPS requis)');
    this.name = 'SubtleCryptoUnavailableError';
  }
}

export function getSubtle(
  subtle: SubtleCrypto | undefined = globalThis.crypto?.subtle,
): SubtleCrypto {
  if (subtle === undefined) throw new SubtleCryptoUnavailableError();
  return subtle;
}

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export async function sha256Hex(
  data: Uint8Array<ArrayBuffer>,
  subtle?: SubtleCrypto,
): Promise<string> {
  const digest = await getSubtle(subtle).digest('SHA-256', data);
  return toHex(new Uint8Array(digest));
}
