/**
 * Horloge virtuelle des FAKE (US-020). Aucun FAKE ne lit l'heure système : le test fixe l'instant
 * de départ et l'avance. Un délai simulé (`sleep`) avance l'horloge sans attendre réellement :
 * la suite reste rapide et déterministe.
 */
export class FakeClock {
  #ms: number;

  constructor(start: Date | string) {
    const ms = new Date(start).getTime();
    if (!Number.isFinite(ms)) throw new RangeError('FakeClock : instant de départ invalide');
    this.#ms = ms;
  }

  now(): Date {
    return new Date(this.#ms);
  }

  nowMs(): number {
    return this.#ms;
  }

  advance(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0)
      throw new RangeError('FakeClock : avance négative ou invalide');
    this.#ms += ms;
  }

  /** Délai simulé : avance l'horloge puis rend la main (une microtâche, aucune attente réelle). */
  async sleep(ms: number): Promise<void> {
    this.advance(ms);
    await Promise.resolve();
  }
}
