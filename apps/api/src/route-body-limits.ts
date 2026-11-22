/**
 * Limites de corps PROPRES à une route (US-311, ADR-194), posées par `applyHttpHardening` AVANT
 * l'analyseur JSON global (`API_BODY_LIMIT_BYTES`, 100 Kio, inchangé pour toutes les autres
 * routes). Une seule route en dispose : le dépôt d'un relevé du PSP
 * (`POST /console/reconciliation/runs`), dont 400 lignes `LEGS` au pire cas (références de 128
 * caractères, montants de 18 chiffres) pèsent environ 117 Ko : limite de 128 Kio.
 *
 * L'intergiciel lit le corps lui-même (JSON UTF-8, `application/json`, sans compression), borné à
 * la limite de la route, puis le pose sur `request.body` et marque la requête lue (`_body`) :
 * l'analyseur global ne la relit pas. Au-delà de la limite : 413 au code explicite
 * `RECON_STATEMENT_TOO_LARGE` (aucun écho du corps) ; corps illisible : 400 `REQUEST_INVALID`
 * (même forme que l'hygiène des erreurs) ; autre type de contenu ou corps compressé : la requête
 * passe à l'analyseur global, qui la traite comme toute autre route (415 de la parade CSRF, 413 à
 * 100 Kio). Les en-têtes de sécurité sont déjà posés (premier intergiciel).
 */
/** Limite du dépôt d'un relevé du PSP (octets) : 400 lignes LEGS au pire cas (≈ 117 Ko). */
export const RECON_STATEMENT_BODY_LIMIT_BYTES = 128 * 1024;

interface RouteBodyLimit {
  readonly method: 'POST';
  readonly path: string;
  readonly limitBytes: number;
  readonly tooLarge: { readonly code: string; readonly messageKey: string };
}

export const ROUTE_BODY_LIMITS: readonly RouteBodyLimit[] = [
  {
    method: 'POST',
    path: '/console/reconciliation/runs',
    limitBytes: RECON_STATEMENT_BODY_LIMIT_BYTES,
    tooLarge: {
      code: 'RECON_STATEMENT_TOO_LARGE',
      // même code et même clé que REPORT_MESSAGES (RPT) ; parité vérifiée par route-body-limits.test.ts
      messageKey: 'common.reconciliation.statementTooLarge',
    },
  },
];

interface BodyRequest {
  readonly method?: string;
  readonly originalUrl?: string;
  readonly url?: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  body?: unknown;
  _body?: boolean;
  on(event: 'data', listener: (chunk: Buffer) => void): unknown;
  on(event: 'end' | 'error', listener: (error?: unknown) => void): unknown;
  pause(): unknown;
  resume(): unknown;
}

interface BodyResponse {
  status(code: number): BodyResponse;
  json(body: unknown): unknown;
}

const HYGIENIC_INVALID = { code: 'REQUEST_INVALID', messageKey: 'common.auth.requestInvalid' };

const pathOf = (r: BodyRequest): string => (r.originalUrl ?? r.url ?? '').split('?')[0] ?? '';

/** Intergiciel Express : corps JSON des routes de `ROUTE_BODY_LIMITS`, à leur propre limite. */
export function routeBodyLimitMiddleware(
  limits: readonly RouteBodyLimit[] = ROUTE_BODY_LIMITS,
): (request: BodyRequest, response: BodyResponse, next: () => void) => void {
  return (request, response, next) => {
    const route = limits.find((l) => l.method === request.method && l.path === pathOf(request));
    const type = String(request.headers['content-type'] ?? '').toLowerCase();
    const encoding = String(request.headers['content-encoding'] ?? 'identity').toLowerCase();
    if (
      route === undefined ||
      request._body === true ||
      !/^application\/json(\s*;|$)/.test(type) ||
      encoding !== 'identity'
    ) {
      next();
      return;
    }
    const declared = Number(request.headers['content-length'] ?? NaN);
    if (Number.isFinite(declared) && declared > route.limitBytes) {
      response.status(413).json(route.tooLarge);
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    request.on('data', (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > route.limitBytes) {
        done = true;
        request.pause();
        response.status(413).json(route.tooLarge);
        return;
      }
      chunks.push(chunk);
    });
    request.on('error', () => {
      if (done) return;
      done = true;
      response.status(400).json(HYGIENIC_INVALID);
    });
    request.on('end', () => {
      if (done) return;
      done = true;
      let body: unknown;
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        body = text.length === 0 ? {} : JSON.parse(text);
      } catch {
        response.status(400).json(HYGIENIC_INVALID);
        return;
      }
      request.body = body;
      request._body = true;
      next();
    });
  };
}
