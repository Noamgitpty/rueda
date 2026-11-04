# Moindre privilège (OPERATING_RULES §1) :
#   - un rôle d'EXÉCUTION par tâche (tirer l'image, écrire ses journaux, lire SES secrets seulement :
#     l'API ne peut pas lire le mot de passe d'administration de la base, réservé au job de base) ;
#   - un rôle d'APPLICATION pour l'API et le travailleur (compartiments S3 et clé « files ») ;
#   - le rôle de DÉPLOIEMENT, pris par le pipeline GitHub Actions par OIDC (aucune clé d'accès
#     longue durée), restreint au dépôt, au workflow deploy.yml sur `main` ET à l'environnement
#     GitHub protégé du même nom (ADR-084).
locals {
  admin_secret_arn = aws_db_instance.this.master_user_secret[0].secret_arn
  task_secrets = {
    api     = ["app_api_password", "rate_limit_key", "staff_mfa_proof_key"]
    worker  = ["app_worker_password"]
    migrate = ["migrator_password", "app_api_password", "app_worker_password", "app_anon_password"]
  }
}

locals {
  ecs_tasks_assume = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
  # Rôle de déploiement (ADR-078 §8, ADR-084) : assumable SEULEMENT par le job du workflow
  # `.github/workflows/deploy.yml`, lancé sur `refs/heads/main`, et lié à l'environnement GitHub du
  # même nom (accord du fondateur en production). Pour un fournisseur OIDC, AWS ne documente que les
  # clés `aud` et `sub` : le dépôt publie donc un `sub` PERSONNALISÉ qui porte les quatre affirmations
  # (`PUT /repos/<dépôt>/actions/oidc/customization/sub`, réglage du fondateur, DEPLOY.md §4) :
  #   repo:<dépôt>:environment:<env>:ref:refs/heads/main:job_workflow_ref:<dépôt>/.github/workflows/deploy.yml@refs/heads/main
  # Égalité EXACTE (StringEquals, aucun joker) : autre branche, autre workflow, autre environnement
  # ou `sub` par défaut (personnalisation absente) ⇒ refus (fail-closed). Preuve : tofu test
  # `oidc_*` (environment.tftest.hcl).
  github_deploy_ref      = "refs/heads/main"
  github_deploy_workflow = ".github/workflows/deploy.yml"
  github_deploy_sub = join(":", [
    "repo", var.github_repository,
    "environment", var.environment,
    "ref", local.github_deploy_ref,
    "job_workflow_ref", "${var.github_repository}/${local.github_deploy_workflow}@${local.github_deploy_ref}",
  ])
  deploy_assume = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRoleWithWebIdentity"
      Principal = { Federated = var.github_oidc_provider_arn }
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = local.github_deploy_sub
        }
      }
    }]
  })
}

resource "aws_iam_role" "execution" {
  for_each           = local.task_secrets
  name               = "${local.name}-${each.key}-execution"
  assume_role_policy = local.ecs_tasks_assume
  tags               = local.tags
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  for_each   = aws_iam_role.execution
  role       = each.value.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_secrets" {
  for_each = local.task_secrets
  name     = "secrets"
  role     = aws_iam_role.execution[each.key].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "OwnSecretsOnly"
        Effect = "Allow"
        Action = ["secretsmanager:GetSecretValue"]
        Resource = concat(
          [for s in each.value : aws_secretsmanager_secret.this[s].arn],
          each.key == "migrate" ? [local.admin_secret_arn] : [],
        )
      },
      {
        Sid      = "DecryptSecrets"
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = [aws_kms_key.data.arn]
      },
    ]
  })
}

resource "aws_iam_role" "app" {
  for_each           = toset(["api", "worker"])
  name               = "${local.name}-${each.key}-task"
  assume_role_policy = local.ecs_tasks_assume
  tags               = local.tags
}

resource "aws_iam_role_policy" "app_files" {
  for_each = aws_iam_role.app
  name     = "files"
  role     = each.value.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Objects"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = [for b in aws_s3_bucket.this : "${b.arn}/*"]
      },
      {
        Sid      = "FilesKey"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey"]
        Resource = [aws_kms_key.files.arn]
      },
    ]
  })
}

resource "aws_iam_role" "deploy" {
  name                 = "${local.name}-deploy"
  assume_role_policy   = local.deploy_assume
  max_session_duration = 3600
  tags                 = local.tags
}

resource "aws_iam_role_policy" "deploy" {
  name = "deploy"
  role = aws_iam_role.deploy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "RegistryLogin"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = ["*"]
      },
      {
        Sid    = "PushImage"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:CompleteLayerUpload",
          "ecr:DescribeImages", "ecr:GetDownloadUrlForLayer", "ecr:InitiateLayerUpload",
          "ecr:PutImage", "ecr:UploadLayerPart",
        ]
        Resource = [aws_ecr_repository.api.arn]
      },
      {
        # production : lecture seule du registre de préproduction (promotion de la même empreinte)
        Sid      = "PullPromotionSource"
        Effect   = "Allow"
        Action   = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:DescribeImages"]
        Resource = var.promotion_source_repository_arn == "" ? [aws_ecr_repository.api.arn] : [var.promotion_source_repository_arn]
      },
      {
        # RegisterTaskDefinition et Describe* n'acceptent pas de restriction par ressource (AWS)
        Sid      = "TaskDefinitions"
        Effect   = "Allow"
        Action   = ["ecs:RegisterTaskDefinition", "ecs:DescribeTaskDefinition", "ecs:DescribeTasks"]
        Resource = ["*"]
      },
      {
        Sid      = "Services"
        Effect   = "Allow"
        Action   = ["ecs:UpdateService", "ecs:DescribeServices"]
        Resource = [aws_ecs_service.api.id, aws_ecs_service.worker.id]
      },
      {
        Sid      = "DatabaseJob"
        Effect   = "Allow"
        Action   = ["ecs:RunTask"]
        Resource = ["arn:aws:ecs:*:*:task-definition/${local.task_migrate.family}:*"]
      },
      {
        Sid      = "PassTaskRoles"
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = concat([for r in aws_iam_role.execution : r.arn], [for r in aws_iam_role.app : r.arn])
      },
      {
        Sid      = "DeploymentJournal"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject", "s3:ListBucket"]
        Resource = [aws_s3_bucket.this["evidence"].arn, "${aws_s3_bucket.this["evidence"].arn}/ops/deployments/*"]
      },
      {
        Sid      = "JournalKey"
        Effect   = "Allow"
        Action   = ["kms:GenerateDataKey", "kms:Decrypt"]
        Resource = [aws_kms_key.files.arn]
      },
    ]
  })
}
