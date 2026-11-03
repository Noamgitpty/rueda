/**
 * FAKE du port `MapTiles` (module CAT ; 17 §5 « Cartes / géocodage », §10, corrigé VERIF_16-M11 ;
 * US-020). Fonds de carte seuls : aucun géocodage, aucune autocomplétion. Chaque tuile est une
 * petite image PNG fixe (1 × 1 pixel), identique pour une même demande : la réponse est
 * déterministe et un doublon de requête rend les mêmes octets.
 *
 * Contrôles : `z` entier dans [0, maxZoom], `x` et `y` entiers dans [0, 2^z) ⇒ sinon
 * `OUT_OF_RANGE`. Cas difficiles (scénario `tile`) : panne, délai, délai dépassé, refus
 * (`REFUSE` avec `QUOTA_EXCEEDED` : quota du fournisseur épuisé).
 */
import { assertFakeAllowed } from '../guard.ts';
import type { EnvironmentVariables } from '../guard.ts';
import type { FakeClock } from '../core/clock.ts';
import type { Outcome } from '../core/outcome.ts';
import { FakeRuntime } from '../core/runtime.ts';

export interface TileRequest {
  readonly z: number;
  readonly x: number;
  readonly y: number;
}

export interface Tile {
  readonly contentType: 'image/png';
  readonly body: Buffer;
  readonly attribution: string;
  readonly cacheTtlSeconds: number;
}

export type MapTilesRefusal = 'OUT_OF_RANGE' | 'QUOTA_EXCEEDED';

export interface FakeMapTilesOptions {
  readonly clock: FakeClock;
  readonly maxZoom: number;
  readonly env?: EnvironmentVariables;
}

/** PNG 1 × 1 pixel (gris), fixe. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8+P9/PQAI8wOE6g5jlwAAAABJRU5ErkJggg==',
  'base64',
);

export class FakeMapTiles {
  readonly maxZoom: number;
  readonly runtime: FakeRuntime<'tile', MapTilesRefusal>;

  constructor(options: FakeMapTilesOptions) {
    assertFakeAllowed('FakeMapTiles', options.env);
    if (!Number.isInteger(options.maxZoom) || options.maxZoom < 0 || options.maxZoom > 22) {
      throw new RangeError('maxZoom doit être un entier dans [0, 22]');
    }
    this.maxZoom = options.maxZoom;
    this.runtime = new FakeRuntime(options.clock);
  }

  async tile(request: TileRequest): Promise<Outcome<Tile, MapTilesRefusal>> {
    return this.runtime.execute('tile', { content: request }, () => {
      const { z, x, y } = request;
      const span = 2 ** z;
      if (
        !Number.isInteger(z) ||
        z < 0 ||
        z > this.maxZoom ||
        !Number.isInteger(x) ||
        !Number.isInteger(y) ||
        x < 0 ||
        y < 0 ||
        x >= span ||
        y >= span
      ) {
        return { ok: false, reason: 'OUT_OF_RANGE' as const };
      }
      return {
        ok: true,
        value: {
          contentType: 'image/png' as const,
          body: Buffer.from(PIXEL),
          attribution: 'FAKE tiles (tests)',
          cacheTtlSeconds: 86_400,
        },
      };
    });
  }
}
