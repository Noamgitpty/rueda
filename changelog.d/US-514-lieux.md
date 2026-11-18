lot: L2
module: Réservation

- Ajouté : au checkout, un lieu de retour différent du lieu de prise est refusé (`ONE_WAY_NOT_ALLOWED`, 422) sans poser de hold ; le retour au même lieu reste le défaut (US-514)
- Sécurité : l'adresse exacte du lieu de remise n'est plus rendue au voyageur au-delà de la fin prévue du trip + `review_window_days` du pays, même pour un trip resté en cours ou non rendu ; paramètre absent ⇒ jamais rendue (US-514)
- Ajouté : textes `common.checkout.oneWayNotAllowed` en es, en, fr et pt-BR (catalogue v83) (US-514)
