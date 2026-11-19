/**
 * Rendu du contrat pour le dossier de preuve (US-308, ADR-184) : adaptateur du port
 * `EvidenceContractRenderer` de CLM sur le PDF déterministe de CTR (US-211, ADR-143). Il vit dans
 * SUP, qui lit tous les modules (17 §2.2), pour que CLM ne dépende pas de CTR. Le PDF rendu est
 * celui que le voyageur a lu (sans bloc de signature) : son SHA-256 doit égaler l'empreinte
 * enregistrée, ce que le travailleur contrôle avant de l'ajouter à l'archive.
 */
import type { EvidenceContractRenderer } from '../../clm/index.js';
import {
  contractFooter,
  parseContractBody,
  parseContractTerms,
  renderContractPdf,
} from '../../ctr/index.js';

export function ctrEvidenceContractRenderer(): EvidenceContractRenderer {
  return {
    render(source) {
      const body = parseContractBody(source.body);
      const terms = parseContractTerms(source.terms);
      return renderContractPdf(
        body,
        contractFooter(terms.tripRef, source.version),
        source.renderer,
      );
    },
  };
}
