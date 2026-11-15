/**
 * Adaptateur du port `AvailabilityProbeLimiter` de CAT (recherche publique, US-201, BOARD N-78) :
 * la garde anti-abus compte une sonde de disponibilité par IP (`availability_probe_per_minute`
 * du pays, 17 §2.3 B7). RISK ne dépend pas de CAT : le port est satisfait par structure (comme
 * `ntfSmsBudget` pour NTF). `null` : sonde admise ; sinon délai de reprise en secondes ; toute
 * autre erreur remonte (l'appelant répond « indisponible »).
 */
import type { AbuseGuard } from './abuse-guard.js';
import { RiskHttpError } from './errors.js';

export function availabilityProbeLimiter(guard: Pick<AbuseGuard, 'checkAvailabilityProbe'>): {
  hit(ip: string, country: string): Promise<number | null>;
} {
  return {
    async hit(ip, country) {
      try {
        await guard.checkAvailabilityProbe(ip, country);
        return null;
      } catch (error) {
        if (error instanceof RiskHttpError && error.code === 'RATE_LIMITED') {
          return error.retryAfterS ?? 60;
        }
        throw error;
      }
    },
  };
}
