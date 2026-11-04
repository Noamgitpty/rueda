variable "aws_account_id" {
  description = "Compte AWS du fondateur pour cet environnement (le fournisseur refuse tout autre compte)."
  type        = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "aws_account_id : 12 chiffres."
  }
}

variable "region" {
  description = "Région unique (ADR-006 PROPOSÉ : us-east-1 ; à confirmer par le fondateur, OQ-MK-09)."
  type        = string
  default     = "us-east-1"
}

variable "availability_zones" {
  type    = list(string)
  default = ["us-east-1a", "us-east-1b"]
}

variable "image_digest" {
  description = "Empreinte de l'image du premier déploiement (ensuite : pipeline)."
  type        = string
}

variable "release" {
  type = string
}

variable "brand_name" {
  description = "Nom de marque (donnée de thème, DEC-MARQUE)."
  type        = string
}

variable "certificate_arn" {
  type = string
}

variable "bucket_suffix" {
  type = string
}

variable "github_repository" {
  type    = string
  default = "Noamgitpty/rueda"
}

variable "github_oidc_provider_arn" {
  type = string
}

variable "promotion_source_repository_arn" {
  description = "Registre d'images de la préproduction (sortie de l'environnement preproduction)."
  type        = string
}

variable "backup_copy_vault_arn" {
  description = "Coffre de copie du compte de sauvegarde (sortie vault_arn de environments/backup)."
  type        = string
}

variable "alert_email" {
  description = "Adresse du fondateur abonnée aux alertes (renseignée dans le .tfvars non suivi)."
  type        = string
  default     = ""
}
