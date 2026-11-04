# Registre d'images de l'environnement : étiquettes IMMUABLES, analyse à l'envoi, chiffrement par la
# clé « data ». Le pipeline pousse la même image (même empreinte) en préproduction puis en
# production ; les tâches la désignent par empreinte (`<dépôt>@sha256:…`), jamais par étiquette.
resource "aws_ecr_repository" "api" {
  name                 = "${local.name}/api"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = !var.deletion_protection
  image_scanning_configuration {
    scan_on_push = true
  }
  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.data.arn
  }
  tags = local.tags
}

# Garde les 50 dernières images : le retour arrière ressert une image encore présente.
resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "50 dernieres images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 50
      }
      action = { type = "expire" }
    }]
  })
}

# Journaux (17 §6.3) : JSON sur la sortie standard, 30 jours en ligne. Archivage 13 mois (OQ-BR-25,
# coût) : reporté, docs/team/QUESTIONS.md (US-004). Filtres de métrique et alarmes : monitoring.tf.
resource "aws_cloudwatch_log_group" "this" {
  for_each          = toset(["api", "worker", "migrate"])
  name              = "/${var.name_prefix}/${var.environment}/${each.key}"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}
