// Point d'entrée public du module CAT. Les autres modules n'importent que ce fichier ;
// tout le reste (internal/, cat.module.ts) est privé (règle rueda/module-boundaries).
export { CatModule } from './cat.module.js';

// Port MapTiles (US-020, ADR-057) : types seulement ; l'adaptateur est injecté.
export type { MapTiles, MapTilesOutcome, Tile, TileRequest } from './internal/map-tiles.port.js';
