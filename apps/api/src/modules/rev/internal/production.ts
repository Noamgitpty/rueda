/**
 * Adaptateurs de PRODUCTION des avis réciproques (US-317, ADR-190 ; ADR-007 ; C19) : fonctions
 * `core.review_*` de 0170 sous `app_api`. Aucune notification : l'invitation à noter et l'avis de
 * publication sont une suite (ADR-190).
 */
import { revConsoleLogger } from './rev-reviews.module.js';
import type { RevReviewsOptions } from './rev-reviews.module.js';
import { PgReviewStore } from './review-store.js';
import type { RevSqlExecutor } from './review-store.js';

export function postgresRevAdapters(db: RevSqlExecutor): RevReviewsOptions {
  return { store: new PgReviewStore(db), log: revConsoleLogger };
}
