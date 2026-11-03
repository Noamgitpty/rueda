/**
 * `@rueda/money/golden-vectors` — harnais des vecteurs dorés (US-016), réservé aux tests.
 * Les attendus viennent de `docs/specs/tools/golden_vectors.json`, exporté par les oracles Python ;
 * ils ne sont jamais recalculés par le code produit. Voir README.md.
 */
export {
  GoldenVectorsError,
  decodeValue,
  parseGoldenVectors,
  type GoldenVectorsErrorCode,
} from './parse.ts';
export {
  GOLDEN_VECTORS_PATH,
  checksFor,
  legVector,
  legVectors,
  loadGoldenVectors,
  settlementVector,
  settlementVectors,
  type VectorFilter,
} from './load.ts';
export {
  SETTLEMENT_COLUMNS_08,
  compareAmounts,
  compareLegs,
  compareSettlement,
  replay,
  type LegObservation,
  type Mismatch,
  type ReplayReport,
  type SettlementObservation,
} from './compare.ts';
export {
  LEG_NAMES,
  LINE_NAMES,
  SETTLEMENT_AMOUNT_FIELDS,
  type GoldenAcceptance,
  type GoldenCheck,
  type GoldenCurrency,
  type GoldenEvent,
  type GoldenLegVector,
  type GoldenRatio,
  type GoldenSettlementExpected,
  type GoldenSettlementVector,
  type GoldenTaxGroup,
  type GoldenTrip,
  type GoldenValue,
  type GoldenVectorSet,
  type LegName,
  type LegVectorKind,
  type LineName,
} from './types.ts';
