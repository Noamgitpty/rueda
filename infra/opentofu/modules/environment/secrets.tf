# Coffre des secrets (17 §6.6) : les CONTENANTS seulement, chiffrés par la clé « data ». Aucune
# valeur n'est écrite par ce module (ni dépôt, ni état OpenTofu) : le fondateur les saisit dans le
# coffre (runbook docs/ops/DEPLOY.md) — c'est la seule action manuelle d'une reconstruction
# (critère 2 d'US-003). L'orchestrateur de conteneurs les injecte en variables d'environnement
# (docs/ops/ENV_VARS.md). Le mot de passe d'administration de la base est géré par le service
# (database.tf), hors de cette liste.
locals {
  secrets = {
    migrator_password   = "RUEDA_DB_MIGRATOR_PASSWORD"
    app_api_password    = "RUEDA_DB_APP_API_PASSWORD"
    app_worker_password = "RUEDA_DB_APP_WORKER_PASSWORD"
    app_anon_password   = "RUEDA_DB_APP_ANON_PASSWORD"
    rate_limit_key      = "RUEDA_RATE_LIMIT_KEY"
    staff_mfa_proof_key = "RUEDA_STAFF_MFA_PROOF_KEY"
  }
}

resource "aws_secretsmanager_secret" "this" {
  for_each    = local.secrets
  name        = "${local.name}/${each.key}"
  description = "${each.value} (US-003) : valeur saisie par le fondateur, jamais par le code."
  kms_key_id  = aws_kms_key.data.arn
  # préproduction : nom réutilisable aussitôt après une destruction (critère 2) ; production : 30 j
  recovery_window_in_days = var.deletion_protection ? 30 : 0
  tags                    = local.tags
}
