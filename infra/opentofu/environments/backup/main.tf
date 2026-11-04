# Compte de SAUVEGARDE (US-004, ADR-080 ; 17 §6.4, NN10) : le coffre qui reçoit la copie quotidienne
# de la préproduction et de la production, dans un compte dédié et une AUTRE région que les
# environnements. JAMAIS appliqué par un agent : le fondateur l'applique avec ses propres accès dans
# le compte de sauvegarde, AVANT les environnements (docs/ops/BACKUP_RESTORE.md « Amorçage »), puis
# reporte la sortie `vault_arn` dans backup_copy_vault_arn de chaque environnement.
terraform {
  required_version = ">= 1.13.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "= 6.66.0"
    }
  }
  # État distant chiffré et verrouillé, dans le compte de sauvegarde (à décommenter à la première
  # application ; voir docs/ops/BACKUP_RESTORE.md).
  # backend "s3" {
  #   bucket       = "<compartiment d'état du compte de sauvegarde>"
  #   key          = "rueda/backup.tfstate"
  #   region       = "us-west-2"
  #   encrypt      = true
  #   use_lockfile = true
  # }
}

provider "aws" {
  region              = var.region
  allowed_account_ids = [var.aws_account_id]
  default_tags {
    tags = { Project = "rueda", Environment = "backup", ManagedBy = "opentofu" }
  }
}

module "backup_vault" {
  source = "../../modules/backup-vault"

  source_account_ids = var.source_account_ids
  compliance_mode    = var.compliance_mode
}

output "vault_arn" {
  description = "À reporter dans backup_copy_vault_arn de la préproduction et de la production."
  value       = module.backup_vault.vault_arn
}
