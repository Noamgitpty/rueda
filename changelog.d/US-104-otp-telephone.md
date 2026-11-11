lot: L1
module: Identité et accès

- Ajouté : vérification du téléphone par OTP (`GET /phone`, `POST /phone/otp`, `POST /phone/verify`) : code à 6 chiffres par SMS, valable 10 min, 5 essais puis blocage 1 h (paramètres du pays), numéro normalisé en E.164 d'après le plan de numérotation du pays, mobiles seulement (US-104)
- Ajouté : envoi asynchrone par le travailleur `iam_otp_sender` : le code est tiré dans le travailleur, seule son empreinte HMAC (`RUEDA_OTP_KEY`) va en base ; aucun canal SMS réel avant le lot C (`FAKE` seulement) ; purge des défis à 30 jours (`iam_otp_pruner`) (US-104)
- Ajouté : plafonds d'envoi d'OTP par compte et par indicatif pays (`otp_rate_per_account_hour`, `otp_rate_per_prefix_hour`), en plus du numéro, de l'IP et du plafond SMS du pays (US-104)
- Ajouté : réponse identique que le numéro soit libre ou déjà vérifié ailleurs ; `ACCOUNT_DUPLICATE_PHONE` seulement après le bon code (US-104)
- Ajouté : contrôle bloquant `PhoneVerifiedGuard` pour le paiement (US-209) (US-104)
- Ajouté : écran de l'étape OTP de S15 (`/verify-phone`) et textes `common.otp.*`, `common.error.phoneDigits`, `web.s15.*` en es, en, fr et pt-BR, catalogue v16 (US-104)
