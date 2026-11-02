// PROPRE : dépendances autorisées par leur index (PRC explicite, CFG et BUS du socle implicite)
// et import interne au module AVL lui-même.
export { PrcModule } from '../../prc/index.js';
export { CfgModule } from '../../cfg/index.js';
export { BusModule } from '../../bus/index.js';
export { AvlModule } from '../avl.module.js';
export * from './bad-internal-import.js';
