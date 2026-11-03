/**
 * Point d'entrée des webhooks PSP (17 §4.4) : `POST /webhooks/{provider}/{public_webhook_id}`.
 * Un identifiant par compte PSP. Le corps BRUT est lu (`rawBody`, activé dans main.ts) : la
 * signature porte sur les octets reçus, jamais sur un JSON ré-sérialisé. Réponse sans corps ;
 * le statut seul porte le résultat (200, 401, 404, 413, 503).
 */
import { Controller, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { PAY_WEBHOOK_INGEST } from './tokens.js';
import { WebhookIngestService } from './webhook-ingest.js';

export interface RawHttpRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  /** Octets du corps (option `rawBody` de Nest) ; absent si aucun analyseur ne l'a lu. */
  readonly rawBody?: Buffer | undefined;
}

export interface StatusResponse {
  status(code: number): unknown;
  setHeader(name: string, value: string): unknown;
}

function flatHeaders(request: RawHttpRequest): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(request.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  );
}

@Controller('webhooks')
export class WebhookController {
  constructor(@Inject(PAY_WEBHOOK_INGEST) private readonly ingest: WebhookIngestService) {}

  @Post(':provider/:publicWebhookId')
  @HttpCode(200)
  async receive(
    @Param('provider') provider: string,
    @Param('publicWebhookId') publicWebhookId: string,
    @Req() request: RawHttpRequest,
    @Res({ passthrough: true }) response: StatusResponse,
  ): Promise<void> {
    const result = await this.ingest.receive({
      provider,
      publicWebhookId,
      headers: flatHeaders(request),
      rawBody: new Uint8Array(request.rawBody ?? Buffer.alloc(0)),
    });
    response.setHeader('Cache-Control', 'no-store');
    response.status(result.status);
  }
}
