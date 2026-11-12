/**
 * Rappel de décision du fournisseur d'identité (US-105, ADR-102 ; 16 VER-001 ; 17 §4.4) :
 * `POST /kyc/webhooks/{provider}`, public. Le corps BRUT est lu (`rawBody`, activé dans main.ts) :
 * la signature porte sur les octets reçus, jamais sur un JSON ré-sérialisé. Réponse sans corps ;
 * le statut seul porte le résultat (200 décision appliquée, rejouée ou ignorée ; 401 rejet
 * journalisé ; 404 fournisseur inconnu, rien n'est écrit ; 503 base indisponible).
 */
import { Controller, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import type { IdentityVerificationService } from './identity.service.js';
import { KYC_IDENTITY_SERVICE } from './tokens.js';

/** En-tête de signature des rappels (nom générique ; l'adaptateur en lit le format). */
export const KYC_SIGNATURE_HEADER = 'x-identity-signature';

interface RawRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  /** Octets du corps (option `rawBody` de Nest) ; absent si aucun analyseur ne l'a lu. */
  readonly rawBody?: Buffer | undefined;
}

interface StatusResponse {
  status(code: number): unknown;
  setHeader(name: string, value: string): unknown;
}

function signatureOf(request: RawRequest): string | undefined {
  const v = request.headers[KYC_SIGNATURE_HEADER];
  return Array.isArray(v) ? v[0] : v;
}

@Controller('kyc/webhooks')
export class KycWebhookController {
  constructor(
    @Inject(KYC_IDENTITY_SERVICE) private readonly identity: IdentityVerificationService,
  ) {}

  @Post(':provider')
  @HttpCode(200)
  async receive(
    @Param('provider') provider: string,
    @Req() request: RawRequest,
    @Res({ passthrough: true }) response: StatusResponse,
  ): Promise<void> {
    const status = await this.identity.webhook(
      provider,
      new Uint8Array(request.rawBody ?? Buffer.alloc(0)),
      signatureOf(request),
    );
    response.setHeader('Cache-Control', 'no-store');
    response.status(status);
  }
}
