# Sorties lues par le pipeline de déploiement (variables de l'environnement GitHub, sans secret).
output "cluster" {
  value = aws_ecs_cluster.this.name
}

output "services" {
  value = { api = aws_ecs_service.api.name, worker = aws_ecs_service.worker.name }
}

output "task_families" {
  value = { for k, t in aws_ecs_task_definition.this : k => t.family }
}

output "repository_url" {
  value = aws_ecr_repository.api.repository_url
}

output "deploy_role_arn" {
  value = aws_iam_role.deploy.arn
}

# `sub` OIDC exigé par le rôle de déploiement (ADR-084) : le fondateur vérifie que la
# personnalisation du dépôt (DEPLOY.md §4 étape 2) produit exactement cette valeur.
output "deploy_oidc_subject" {
  value = local.github_deploy_sub
}

output "subnets" {
  value = aws_subnet.private[*].id
}

output "app_security_group" {
  value = aws_security_group.app.id
}

output "load_balancer_dns" {
  value = aws_lb.this.dns_name
}

output "buckets" {
  value = { for k, b in aws_s3_bucket.this : k => b.bucket }
}

output "secret_arns" {
  description = "Contenants à remplir par le fondateur (noms, jamais de valeur)."
  value       = { for k, s in aws_secretsmanager_secret.this : k => s.arn }
}

output "database_endpoint" {
  value = aws_db_instance.this.address
}

output "backup" {
  description = "Coffre et plan de sauvegarde de l'environnement ; coffre de copie hors compte (US-004)."
  value = {
    vault            = aws_backup_vault.this.name
    plan             = aws_backup_plan.daily.id
    copy_vault_arn   = var.backup_copy_vault_arn
    alerts_topic     = aws_sns_topic.alerts.arn
    metric_namespace = local.metric_namespace
  }
}
