# Deux clés KMS (17 §10 NN10 ; 17 §6.6 « clés distinctes par domaine ») :
#   data  : base de données, coffre des secrets, registre d'images ;
#   files : compartiments S3 (photos, preuves, journal des déploiements).
# Rotation annuelle automatique ; suppression différée de 30 jours (procédure de recréation : US-036).
# Politique de clé par défaut du compte (administrateurs du compte = fondateur) ; les rôles des
# tâches reçoivent kms:Decrypt par leur politique IAM (iam.tf), sur ces clés seulement.
resource "aws_kms_key" "data" {
  description             = "${local.name} : base, coffre, registre"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  tags                    = local.tags
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
