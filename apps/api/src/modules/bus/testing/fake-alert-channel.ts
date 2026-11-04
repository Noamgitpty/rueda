/**
 * Canal d'alerte `FAKE` (US-004) : garde chaque alerte pour les assertions, après le même contrôle
 * que la production (`assertSafeAlert` : comptes et codes seulement). `failing` simule un canal en
 * panne. Tests seulement : `testing/` est exclu de la compilation et de l'image (C19).
 */
import { assertSafeAlert } from '../internal/alert-channel.js';
import type { AlertChannel, OpsAlert } from '../internal/alert-channel.js';

export class FakeAlertChannel implements AlertChannel {
  readonly sent: OpsAlert[] = [];
  failing = false;

  send(alert: OpsAlert): Promise<void> {
    assertSafeAlert(alert);
    if (this.failing) return Promise.reject(new Error('canal d’alerte indisponible (FAKE)'));
    this.sent.push(alert);
    return Promise.resolve();
  }
}
