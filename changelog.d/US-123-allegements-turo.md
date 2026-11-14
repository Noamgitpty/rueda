lot: L1
module: KYC de l'hôte

- Modifié : numéro fiscal de l'hôte (RUC au Paraguay) facultatif à l'activation par défaut en PA et en PY, paramètre `host_tax_id_required_for_activation` (absent ⇒ exigé) ; exigé avant l'activation seulement si le PSP ne sait pas verser sans lui ; premier numéro saisissable même après l'approbation (US-123, ADR-115)
- Ajouté : rappel de l'obligation fiscale de l'hôte sur l'écran A07, en es, en, fr et pt-BR (US-123)
  module: Paiements
- Ajouté : capacité PSP `SUPPORTS_PAYOUT_WITHOUT_HOST_TAX_ID`, non bloquante, inconnue ⇒ numéro fiscal exigé (US-123, ADR-115)
