import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';

/**
 * Vérificateur SCRAM-SHA-256 au format stocké par PostgreSQL (RFC 5802, RFC 7677) :
 * `SCRAM-SHA-256$<itérations>:<sel>$<StoredKey>:<ServerKey>` (base64).
 *
 * `ALTER ROLE … PASSWORD` n'accepte pas de paramètre lié : envoyer le vérificateur plutôt que
 * le mot de passe évite que le mot de passe en clair transite dans le texte d'une instruction
 * (journal `log_statement`, `pg_stat_activity`).
 *
 * Limite : la normalisation SASLprep n'est pas faite ; les mots de passe doivent être en ASCII
 * imprimable (c'est le cas des mots de passe aléatoires du harnais).
 */
export function scramSha256Verifier(
  password: string,
  options: { readonly salt?: Buffer; readonly iterations?: number } = {},
): string {
  if (!/^[\x21-\x7e]+$/.test(password)) {
    throw new Error('scramSha256Verifier : mot de passe ASCII imprimable attendu');
  }
  const salt = options.salt ?? randomBytes(16);
  const iterations = options.iterations ?? 4096;
  const salted = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return (
    `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}` +
    `$${storedKey.toString('base64')}:${serverKey.toString('base64')}`
  );
}

/** Mot de passe aléatoire (256 bits, hexadécimal). */
export function randomPassword(): string {
  return randomBytes(32).toString('hex');
}
