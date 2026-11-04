variable "environment" {
  description = "preproduction ou production (RUEDA_ENV des conteneurs, déclaration de la base)."
  type        = string
  validation {
    condition     = contains(["preproduction", "production"], var.environment)
    error_message = "environment : preproduction ou production."
  }
}

variable "region" {
  description = "Région de l'environnement (ADR-006 PROPOSÉ : us-east-1 ; décision du fondateur, OQ-MK-09)."
  type        = string
  validation {
    condition     = can(regex("^[a-z]{2}-[a-z]+-[0-9]$", var.region))
    error_message = "region : identifiant de région AWS (ex. us-east-1)."
  }
}

variable "name_prefix" {
  description = "Préfixe des ressources (nom de code technique, jamais la marque)."
  type        = string
  default     = "rueda"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,20}$", var.name_prefix))
    error_message = "name_prefix : minuscules, chiffres, tirets (2 à 21)."
  }
}

variable "availability_zones" {
  description = "Deux zones de disponibilité de la région (base Multi-AZ, sous-réseaux)."
  type        = list(string)
  validation {
    condition     = length(var.availability_zones) == 2
    error_message = "availability_zones : exactement deux zones."
  }
}

variable "vpc_cidr" {
  description = "Plage du réseau privé de l'environnement."
  type        = string
  default     = "10.40.0.0/16"
}

variable "image_digest" {
  description = "Empreinte (sha256:…) de l'image de production du PREMIER déploiement ; ensuite, le pipeline enregistre les révisions."
  type        = string
  validation {
    condition     = can(regex("^sha256:[0-9a-f]{64}$", var.image_digest))
    error_message = "image_digest : empreinte sha256:<64 hexadécimaux>, jamais une étiquette."
  }
}

variable "release" {
  description = "Version (sha git) de l'image initiale, pour RUEDA_RELEASE."
  type        = string
  validation {
    condition     = can(regex("^[A-Za-z0-9._-]{1,80}$", var.release))
    error_message = "release : 1 à 80 caractères [A-Za-z0-9._-]."
  }
}

variable "brand_name" {
  description = "Nom de marque des messages (donnée de thème, DEC-MARQUE) : RUEDA_BRAND_NAME du travailleur."
  type        = string
}

variable "certificate_arn" {
  description = "Certificat TLS (ACM) du domaine de l'environnement (F-03 : sous-domaine technique du fondateur)."
  type        = string
}

variable "bucket_suffix" {
  description = "Suffixe unique des compartiments S3 (noms globaux) ; choisi par le fondateur."
  type        = string
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{2,30}$", var.bucket_suffix))
    error_message = "bucket_suffix : minuscules, chiffres, tirets (3 à 31)."
  }
}

variable "db_instance_class" {
  description = "Classe de l'instance PostgreSQL gérée (PROPOSÉ : db.t4g.micro en préproduction, db.t4g.small en production)."
  type        = string
}

variable "db_multi_az" {
  description = "Base Multi-AZ (17 §6.4, NN10 : obligatoire en production)."
  type        = bool
}

variable "db_backup_retention_days" {
  description = "Rétention des sauvegardes automatiques (restauration à un instant donné)."
  type        = number
}

variable "deletion_protection" {
  description = "Protection contre la suppression de la base, du répartiteur et des compartiments (production : obligatoire)."
  type        = bool
}

variable "evidence_lock_days" {
  description = "Verrouillage d'objet (GOVERNANCE) par défaut du compartiment des preuves et du journal des déploiements."
  type        = number
}

variable "api_desired_count" {
  description = "Nombre de tâches de l'API (2 en production : une par zone)."
  type        = number
}

variable "api_cpu" {
  type    = number
  default = 512
}

variable "api_memory" {
  type    = number
  default = 1024
}

variable "worker_cpu" {
  type    = number
  default = 256
}

variable "worker_memory" {
  type    = number
  default = 512
}

variable "log_retention_days" {
  description = "Rétention des journaux en ligne (17 §6.3 : 30 jours)."
  type        = number
  default     = 30
}

variable "github_repository" {
  description = "Dépôt autorisé à déployer par OIDC (propriétaire/nom)."
  type        = string
}

variable "github_oidc_provider_arn" {
  description = "Fournisseur OIDC GitHub du compte (créé une fois par compte, hors module)."
  type        = string
}

variable "tags" {
  description = "Étiquettes communes."
  type        = map(string)
  default     = {}
}

variable "promotion_source_repository_arn" {
  description = "Production : registre de préproduction d'où l'image est copiée (même empreinte) ; vide en préproduction."
  type        = string
  default     = ""
}

# --- Sauvegardes et supervision (US-004, ADR-080) -------------------------------------------------

variable "backup_retention_days" {
  description = "Rétention des sauvegardes quotidiennes dans le coffre de l'environnement (production : 7 au moins)."
  type        = number
  validation {
    condition     = var.backup_retention_days >= 1 && floor(var.backup_retention_days) == var.backup_retention_days
    error_message = "backup_retention_days : entier ≥ 1."
  }
}

variable "backup_copy_vault_arn" {
  description = "Coffre de copie dans un AUTRE compte et une AUTRE région (sortie de la racine environments/backup) ; vide = aucune copie (refusé en production)."
  type        = string
  default     = ""
  validation {
    condition     = var.backup_copy_vault_arn == "" || can(regex("^arn:aws:backup:[a-z]{2}-[a-z]+-[0-9]:[0-9]{12}:backup-vault:[A-Za-z0-9_.-]{2,50}$", var.backup_copy_vault_arn))
    error_message = "backup_copy_vault_arn : arn:aws:backup:<région>:<compte>:backup-vault:<nom>, ou vide."
  }
}

variable "backup_copy_retention_days" {
  description = "Rétention des copies hors compte (décision d'argent du fondateur, QUESTIONS.md ; PROPOSÉ : 35)."
  type        = number
  default     = 35
  validation {
    condition     = var.backup_copy_retention_days >= 1 && floor(var.backup_copy_retention_days) == var.backup_copy_retention_days
    error_message = "backup_copy_retention_days : entier ≥ 1."
  }
}

variable "alert_email" {
  description = "Adresse abonnée au sujet des alertes (fondateur ; renseignée dans le .tfvars non suivi, jamais dans le dépôt). Vide : aucun abonnement."
  type        = string
  default     = ""
}

variable "api_5xx_threshold" {
  description = "Erreurs 5xx de l'API sur 5 min qui déclenchent l'alarme (PROPOSÉ)."
  type        = number
  default     = 10
}

variable "api_p95_latency_seconds" {
  description = "Latence p95 de l'API (s) au-delà de laquelle l'alarme part après 15 min (17 §6.7 : 0,8 s pour la recherche, PROPOSÉ)."
  type        = number
  default     = 0.8
}
