# Deux clés KMS (17 §10 NN10 ; 17 §6.6 « clés distinctes par domaine ») :
#   data  : base de données, coffre des secrets, registre d'images ;
#   files : compartiments S3 (photos, preuves, journal des déploiements).
# Rotation annuelle automatique ; suppression différée de 30 jours (procédure de recréation : US-036).
# Politique de clé par défaut du compte (administrateurs du compte = fondateur) ; les rôles des
# tâches reçoivent kms:Decrypt par leur politique IAM (iam.tf), sur ces clés seulement.
#
# Politique de la clé « data » (US-004, ADR-080) : l'administration reste au compte (déclaration
# de la politique par défaut, rien de plus) ; si une copie des sauvegardes vers un AUTRE compte est
# configurée (backup.tf), ce compte peut lire les points de restauration chiffrés par cette clé
# pour les recopier dans son coffre (condition d'AWS Backup pour une copie entre comptes).
data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  data_key_admin = {
    Sid       = "AccountAdministration"
    Effect    = "Allow"
    Principal = { AWS = "arn:aws:iam::${local.account_id}:root" }
    Action    = "kms:*"
    Resource  = "*"
  }
  data_key_backup_copy = {
    Sid       = "BackupCopyAccount"
    Effect    = "Allow"
    Principal = { AWS = "arn:aws:iam::${local.backup_copy_account}:root" }
    Action    = ["kms:Decrypt", "kms:DescribeKey", "kms:CreateGrant", "kms:ReEncrypt*", "kms:GenerateDataKey*"]
    Resource  = "*"
  }
}

resource "aws_kms_key" "data" {
  description             = "${local.name} : base, coffre, registre, sauvegardes"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = concat([local.data_key_admin], [for s in [local.data_key_backup_copy] : s if local.backup_copy_enabled])
  })
  tags = local.tags
}

resource "aws_kms_alias" "data" {
  name          = "alias/${local.name}-data"
  target_key_id = aws_kms_key.data.key_id
}

resource "aws_kms_key" "files" {
  description             = "${local.name} : compartiments S3"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  tags                    = local.tags
}

resource "aws_kms_alias" "files" {
  name          = "alias/${local.name}-files"
  target_key_id = aws_kms_key.files.key_id
}
