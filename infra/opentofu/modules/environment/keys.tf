# Clés KMS (17 §10 NN10 ; 17 §6.6 « clés distinctes par domaine ») :
#   data   : coffre des secrets (dont le mot de passe d'administration de la base), registre d'images ;
#   files  : compartiments S3 (photos, preuves, journal des déploiements) ;
#   backup : stockage de la base et coffre des sauvegardes (backup.tf, US-004) ;
#   alerts : sujet des alertes (monitoring.tf, US-004).
# Rotation annuelle automatique ; suppression différée de 30 jours (procédure de recréation : US-036).
# Politique de clé par défaut du compte (administrateurs du compte = fondateur) ; les rôles des
# tâches reçoivent kms:Decrypt par leur politique IAM (iam.tf), sur ces clés seulement.
#
# Politique de la clé « data » (US-004, ADR-080, revue sécurité) : administration par le compte
# SEULEMENT (déclaration de la politique par défaut). Le compte de copie des sauvegardes n'a AUCUN
# droit sur elle : seule la clé « backup » lui est partagée, sous conditions (backup.tf).
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
}

resource "aws_kms_key" "data" {
  description             = "${local.name} : coffre des secrets, registre"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [local.data_key_admin]
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
