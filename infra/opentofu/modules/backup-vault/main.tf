data "aws_caller_identity" "current" {}

locals {
  name       = "${var.name_prefix}-backup-copy"
  account_id = data.aws_caller_identity.current.account_id
  tags = merge(var.tags, {
    Project   = var.name_prefix
    ManagedBy = "opentofu"
    Story     = "US-004"
  })
  key_admin = {
    Sid       = "AccountAdministration"
    Effect    = "Allow"
    Principal = { AWS = "arn:aws:iam::${local.account_id}:root" }
    Action    = "kms:*"
    Resource  = "*"
  }
  copy_from_sources = {
    Sid       = "CopyFromEnvironmentAccounts"
    Effect    = "Allow"
    Principal = { AWS = [for a in var.source_account_ids : "arn:aws:iam::${a}:root"] }
    Action    = "backup:CopyIntoBackupVault"
    Resource  = "*"
  }
  deny_deletion = {
    Sid       = "DenyRecoveryPointDeletion"
    Effect    = "Deny"
    Principal = { AWS = "*" }
    Action    = ["backup:DeleteRecoveryPoint", "backup:UpdateRecoveryPointLifecycle"]
    Resource  = "*"
  }
}

# Clé du coffre, propre au compte de sauvegarde (jamais partagée avec un environnement).
resource "aws_kms_key" "vault" {
  description             = "${local.name} : coffre de copie des sauvegardes"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [local.key_admin]
  })
  tags = local.tags
}

resource "aws_kms_alias" "vault" {
  name          = "alias/${local.name}"
  target_key_id = aws_kms_key.vault.key_id
}

resource "aws_backup_vault" "copy" {
  name        = local.name
  kms_key_arn = aws_kms_key.vault.arn
  tags        = local.tags

  lifecycle {
    precondition {
      condition     = !contains(var.source_account_ids, local.account_id)
      error_message = "le coffre de copie vit dans un compte DÉDIÉ, distinct de chaque environnement (17 §6.4)."
    }
  }
}

# Les environnements ne peuvent que copier ; personne (compte de sauvegarde compris) ne supprime ni
# ne raccourcit un point de restauration : il expire par son cycle de vie, sous le verrou.
resource "aws_backup_vault_policy" "copy" {
  backup_vault_name = aws_backup_vault.copy.name
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [local.copy_from_sources, local.deny_deletion]
  })
}

resource "aws_backup_vault_lock_configuration" "copy" {
  backup_vault_name   = aws_backup_vault.copy.name
  min_retention_days  = var.min_retention_days
  max_retention_days  = var.max_retention_days
  changeable_for_days = var.compliance_mode ? 3 : null
}
