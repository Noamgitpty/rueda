variable "aws_account_id" {
  description = "Compte AWS DÉDIÉ aux sauvegardes (le fournisseur refuse tout autre compte)."
  type        = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "aws_account_id : 12 chiffres."
  }
}

variable "region" {
  description = "Région de la copie, différente de celle des environnements (PROPOSÉ : us-west-2 ; décision d'argent du fondateur, QUESTIONS.md)."
  type        = string
  default     = "us-west-2"
}

variable "source_account_ids" {
  description = "Comptes de la préproduction et de la production."
  type        = list(string)
}

variable "compliance_mode" {
  description = "Verrou irréversible du coffre (mode conformité) : décision du fondateur (QUESTIONS.md) ; PROPOSÉ : false."
  type        = bool
  default     = false
}
