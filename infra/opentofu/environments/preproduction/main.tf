# Environnement « preproduction » (US-003, ADR-078). JAMAIS appliqué par un agent : le fondateur l'applique
# quand il a choisi l'hébergeur (docs/team/QUESTIONS.md), avec ses propres accès, en suivant
# docs/ops/DEPLOY.md. Valeurs PROPOSÉES ; les valeurs propres au compte (identifiant, certificat,
# suffixe des compartiments, fournisseur OIDC) viennent de preproduction.tfvars, rempli par le fondateur
# d'après preproduction.tfvars.example (aucun secret : les secrets vont au coffre).
terraform {
  required_version = ">= 1.13.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "= 6.66.0"
    }
  }
  # État distant chiffré et verrouillé, dans le compte du fondateur (à décommenter à la première
  # application ; compartiment créé à la main une fois, voir docs/ops/DEPLOY.md « Amorçage »).
  # backend "s3" {
  #   bucket       = "<compartiment d'état du fondateur>"
  #   key          = "rueda/preproduction.tfstate"
  #   region       = "us-east-1"
  #   encrypt      = true
  #   use_lockfile = true
  # }
}

provider "aws" {
  region              = var.region
  allowed_account_ids = [var.aws_account_id]
  default_tags {
    tags = { Project = "rueda", Environment = "preproduction", ManagedBy = "opentofu" }
  }
}

module "environment" {
  source = "../../modules/environment"

  environment              = "preproduction"
  region                   = var.region
  availability_zones       = var.availability_zones
  image_digest             = var.image_digest
  release                  = var.release
  brand_name               = var.brand_name
  certificate_arn          = var.certificate_arn
  bucket_suffix            = var.bucket_suffix
  db_instance_class        = "db.t4g.micro"
  db_multi_az              = false
  db_backup_retention_days = 1
  deletion_protection      = false
  evidence_lock_days       = 1
  api_desired_count        = 1
  github_repository        = var.github_repository
  github_oidc_provider_arn = var.github_oidc_provider_arn
}

output "environment" {
  value = module.environment
}
