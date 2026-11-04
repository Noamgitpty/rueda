// Données personnelles (US-046, ADR-081) : inventaire classé, cohérence avec la matrice d'US-043,
// export en libre-service.
export {
  checkInventoryCoverage,
  checkInventoryRules,
  checkMatrixCoherence,
  classOf,
  columnsOfClass,
  DATA_CLASSES,
  DEFAULT_INVENTORY_PATH,
  DEFAULT_MATRIX_PATH,
  ERASURES,
  EXPORT_CHANNELS,
  grantedColumns,
  isPersonalPredicate,
  LIFECYCLES,
  loadAuthorizationMatrix,
  loadPersonalDataInventory,
  parseSchemaDocColumns,
  PERSONAL_NAME_PATTERN,
  SELF_ACTORS,
} from './inventory.ts';
export type {
  AuthorizationMatrix,
  CatalogColumns,
  ColumnEntry,
  DataClass,
  Erasure,
  ExportChannel,
  InventoryTable,
  Lifecycle,
  PersonalColumn,
  PersonalDataInventory,
  SelfActor,
  SubjectType,
} from './inventory.ts';
export { exportColumns, exportOwnPersonalData } from './export.ts';
export type { PersonalExport } from './export.ts';
