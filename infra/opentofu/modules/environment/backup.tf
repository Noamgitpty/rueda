# Sauvegardes (US-004, ADR-080 ; 17 §6.4 ; 16 ADM-032, ADM-035 ; NN10). Décrites en code, JAMAIS
# appliquées par un agent : le fondateur applique (docs/ops/BACKUP_RESTORE.md).
#
#   1. Restauration à un instant donné de la base : sauvegardes automatiques du service
#      (database.tf, db_backup_retention_days ; RPO de quelques minutes).
#   2. Plan quotidien AWS Backup : base ET compartiments, dans le coffre de l'environnement chiffré
#      par la clé dédiée « backup », conservés backup_retention_days ; puis COPIE dans le coffre d'un AUTRE
#      compte et d'une AUTRE région (module backup-vault, racine environments/backup), conservée
#      backup_copy_retention_days. Critère US-004 : « Given la sauvegarde quotidienne, When elle se
#      termine, Then une copie existe dans un autre compte » ; en production, le plan est REFUSÉ
#      sans cette copie (précondition), et une copie dans le même compte ou la même région aussi.
#   3. Tout échec (sauvegarde, copie, restauration) déclenche une alerte (monitoring.tf).
#
# Aucun secret ici. La région et la durée de la copie sont des décisions d'argent du fondateur
# (docs/team/QUESTIONS.md) : défauts PROPOSÉS dans les racines.
locals {
  backup_copy_enabled = var.backup_copy_vault_arn != ""
  # arn:aws:backup:<région>:<compte>:backup-vault:<nom> (format vérifié par la variable)
  backup_copy_parts   = local.backup_copy_enabled ? split(":", var.backup_copy_vault_arn) : ["", "", "", "", ""]
  backup_copy_region  = local.backup_copy_parts[3]
  backup_copy_account = local.backup_copy_parts[4]
}

# Clé DÉDIÉE (revue sécurité US-004) : stockage de la base et coffre des sauvegardes. Un instantané
# de la base garde la clé de l'instance : c'est donc elle, et elle seule, que le compte de copie doit
# pouvoir lire. Il ne reçoit que Decrypt, DescribeKey et CreateGrant (pour une ressource AWS),
# appelés depuis SON compte et par les services de sauvegarde ou de base de cette région
# (kms:CallerAccount, kms:ViaService) ; rien sur les clés « data » (secrets, registre) et « files ».
# Point à vérifier avant la première application : docs/ops/BACKUP_RESTORE.md.
locals {
  backup_copy_conditions = {
    "kms:CallerAccount" = local.backup_copy_account
    "kms:ViaService"    = ["backup.${var.region}.amazonaws.com", "rds.${var.region}.amazonaws.com"]
  }
  backup_key_copy_read = {
    Sid       = "BackupCopyAccountRead"
    Effect    = "Allow"
    Principal = { AWS = "arn:aws:iam::${local.backup_copy_account}:root" }
    Action    = ["kms:Decrypt", "kms:DescribeKey"]
    Resource  = "*"
    Condition = { StringEquals = local.backup_copy_conditions }
  }
  backup_key_copy_grant = {
    Sid       = "BackupCopyAccountGrant"
    Effect    = "Allow"
    Principal = { AWS = "arn:aws:iam::${local.backup_copy_account}:root" }
    Action    = "kms:CreateGrant"
    Resource  = "*"
    Condition = {
      StringEquals = local.backup_copy_conditions
      Bool         = { "kms:GrantIsForAWSResource" = "true" }
    }
  }
}

resource "aws_kms_key" "backup" {
  description             = "${local.name} : base de données et sauvegardes"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = concat([local.data_key_admin], [for s in [local.backup_key_copy_read, local.backup_key_copy_grant] : s if local.backup_copy_enabled])
  })
  tags = local.tags
}

resource "aws_kms_alias" "backup" {
  name          = "alias/${local.name}-backup"
  target_key_id = aws_kms_key.backup.key_id
}

resource "aws_backup_vault" "this" {
  name          = local.name
  kms_key_arn   = aws_kms_key.backup.arn
  force_destroy = !var.deletion_protection
  tags          = local.tags
}

# Production : les points de restauration du coffre local ne peuvent pas être supprimés avant 7
# jours, même par un administrateur (mode « gouvernance », réversible ; le mode « conformité »,
# irréversible, est réservé au coffre de copie et à la décision du fondateur).
resource "aws_backup_vault_lock_configuration" "this" {
  count              = local.production ? 1 : 0
  backup_vault_name  = aws_backup_vault.this.name
  min_retention_days = 7
}

resource "aws_backup_plan" "daily" {
  name = "${local.name}-daily"
  rule {
    rule_name         = "daily"
    target_vault_name = aws_backup_vault.this.name
    # 05:00 UTC : nuit dans les deux pays de premier rang (aucune constante de pays : plage commune)
    schedule            = "cron(0 5 * * ? *)"
    start_window        = 60
    completion_window   = 360
    recovery_point_tags = local.tags
    lifecycle {
      delete_after = var.backup_retention_days
    }
    dynamic "copy_action" {
      for_each = local.backup_copy_enabled ? [var.backup_copy_vault_arn] : []
      content {
        destination_vault_arn = copy_action.value
        lifecycle {
          delete_after = var.backup_copy_retention_days
        }
      }
    }
  }
  tags = local.tags

  lifecycle {
    # Invariants (fail-closed) : refus du plan, pas d'une revue.
    precondition {
      condition     = !local.production || local.backup_copy_enabled
      error_message = "production : copie quotidienne des sauvegardes dans un autre compte obligatoire (backup_copy_vault_arn ; 17 §6.4, NN10)."
    }
    precondition {
      condition     = !local.backup_copy_enabled || (local.backup_copy_account != local.account_id && local.backup_copy_region != var.region)
      error_message = "copie des sauvegardes : coffre d'un AUTRE compte et d'une AUTRE région que l'environnement (17 §6.4)."
    }
    precondition {
      condition     = !local.production || (var.backup_retention_days >= 7 && var.backup_copy_retention_days >= 7)
      error_message = "production : 7 jours de sauvegardes au moins, localement et en copie (17 §6.4)."
    }
  }
}

# Rôle du service de sauvegarde : politiques gérées du service, plus la lecture des deux clés.
resource "aws_iam_role" "backup" {
  name = "${local.name}-backup"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "backup.amazonaws.com" }
    }]
  })
  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "backup" {
  for_each = toset([
    "service-role/AWSBackupServiceRolePolicyForBackup",
    "service-role/AWSBackupServiceRolePolicyForRestores",
    "AWSBackupServiceRolePolicyForS3Backup",
    "AWSBackupServiceRolePolicyForS3Restore",
  ])
  role       = aws_iam_role.backup.name
  policy_arn = "arn:aws:iam::aws:policy/${each.value}"
}

resource "aws_iam_role_policy" "backup_keys" {
  name = "keys"
  role = aws_iam_role.backup.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["kms:Decrypt", "kms:DescribeKey", "kms:GenerateDataKey*", "kms:CreateGrant"]
      Resource = [aws_kms_key.backup.arn, aws_kms_key.files.arn]
    }]
  })
}

resource "aws_backup_selection" "data" {
  name         = "${local.name}-data"
  plan_id      = aws_backup_plan.daily.id
  iam_role_arn = aws_iam_role.backup.arn
  resources    = concat([aws_db_instance.this.arn], [for b in aws_s3_bucket.this : b.arn])
}
