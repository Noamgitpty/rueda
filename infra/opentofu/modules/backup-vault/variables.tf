variable "name_prefix" {
  description = "Préfixe des ressources (nom de code technique, jamais la marque)."
  type        = string
  default     = "rueda"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,20}$", var.name_prefix))
    error_message = "name_prefix : minuscules, chiffres, tirets (2 à 21)."
  }
}

variable "source_account_ids" {
  description = "Comptes des environnements autorisés à COPIER dans ce coffre (préproduction, production)."
  type        = list(string)
  validation {
    condition     = length(var.source_account_ids) >= 1 && alltrue([for a in var.source_account_ids : can(regex("^[0-9]{12}$", a))])
    error_message = "source_account_ids : au moins un compte de 12 chiffres."
  }
}

variable "min_retention_days" {
  description = "Durée minimale de conservation imposée par le verrou du coffre (PROPOSÉ : 7)."
  type        = number
  default     = 7
}

variable "max_retention_days" {
  description = "Durée maximale de conservation admise par le verrou du coffre (PROPOSÉ : 400, au-delà des 35 jours de copie)."
  type        = number
  default     = 400
  validation {
    condition     = var.max_retention_days >= var.min_retention_days
    error_message = "max_retention_days : supérieure ou égale à min_retention_days."
  }
}

variable "compliance_mode" {
  description = "Verrou en mode « conformité » : IRRÉVERSIBLE après 3 jours, même pour le compte racine. Décision du fondateur (QUESTIONS.md) ; PROPOSÉ : false (gouvernance)."
  type        = bool
  default     = false
}

variable "tags" {
  description = "Étiquettes communes."
  type        = map(string)
  default     = {}
}
