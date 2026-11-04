# PostgreSQL 16 géré (17 §6.1) : chiffré par la clé dédiée « backup » (US-004), TLS obligatoire, privé, restauration à
# un instant donné (sauvegardes automatiques), Multi-AZ en production (NN10). Le mot de passe
# d'administration est GÉRÉ par le service (secret du coffre chiffré par la clé « data ») : il
# n'apparaît ni dans le dépôt, ni dans l'état OpenTofu. Le job de base (packages/db/src/deploy/) le
# lit pour l'amorçage des rôles ; les rôles applicatifs ont leurs propres secrets (secrets.tf).
# Sauvegardes (US-004, ADR-080) : restauration à un instant donné par les sauvegardes automatiques
# du service (rétention db_backup_retention_days), plus le plan quotidien d'AWS Backup avec copie
# dans un AUTRE compte et une AUTRE région (backup.tf, 17 §6.4). En production, les sauvegardes
# automatiques survivent à la suppression de l'instance.
resource "aws_db_subnet_group" "this" {
  name       = local.name
  subnet_ids = aws_subnet.private[*].id
  tags       = local.tags
}

resource "aws_db_parameter_group" "this" {
  name   = "${local.name}-pg16"
  family = "postgres16"
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  # 17 §1.3 : horodatage en UTC, l'horloge fait foi côté base (platform.now())
  parameter {
    name  = "timezone"
    value = "UTC"
  }
  tags = local.tags
}

resource "aws_db_instance" "this" {
  identifier     = local.name
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class
  db_name        = "rueda"
  # rôle d'administration de l'instance : amorçage seulement (jamais un rôle applicatif)
  username                            = "rueda_admin"
  manage_master_user_password         = true
  master_user_secret_kms_key_id       = aws_kms_key.data.arn
  allocated_storage                   = 20
  max_allocated_storage               = 100
  storage_type                        = "gp3"
  storage_encrypted                   = true
  kms_key_id                          = aws_kms_key.backup.arn
  multi_az                            = var.db_multi_az
  db_subnet_group_name                = aws_db_subnet_group.this.name
  vpc_security_group_ids              = [aws_security_group.db.id]
  parameter_group_name                = aws_db_parameter_group.this.name
  publicly_accessible                 = false
  iam_database_authentication_enabled = false
  backup_retention_period             = var.db_backup_retention_days
  delete_automated_backups            = !local.production
  copy_tags_to_snapshot               = true
  auto_minor_version_upgrade          = true
  apply_immediately                   = false
  deletion_protection                 = var.deletion_protection
  skip_final_snapshot                 = !var.deletion_protection
  final_snapshot_identifier           = var.deletion_protection ? "${local.name}-final" : null
  tags                                = local.tags

  lifecycle {
    # Invariants de production (fail-closed) : refus du plan, pas d'une revue.
    precondition {
      condition     = !local.production || (var.db_multi_az && var.deletion_protection && var.db_backup_retention_days >= 7)
      error_message = "production : Multi-AZ, protection contre la suppression et 7 jours de sauvegardes au moins (17 §6.4, NN10)."
    }
  }
}
