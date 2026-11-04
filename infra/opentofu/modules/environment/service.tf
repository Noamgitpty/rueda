# Conteneurs (17 §6.1 : ECS Fargate ; bêta F16 : un service, sans cluster à exploiter) :
#   api     : service derrière le répartiteur, 2 tâches en production (une par zone) ;
#   worker  : service d'une tâche (relais, files, tâches périodiques ; singleton des périodiques
#             garanti par la base, ADR-050) ;
#   migrate : définition seulement, lancée par le pipeline AVANT chaque bascule (job de base).
# Déploiement réversible (ADR-078) : coupe-circuit de déploiement avec RETOUR ARRIÈRE automatique
# sur la révision précédente ; 100 % de tâches saines gardées pendant la bascule de l'API.
# Le pipeline enregistre les révisions suivantes (nouvelle empreinte) : OpenTofu crée la première et
# ignore ensuite `task_definition` des services (aucune dérive, aucun accès du pipeline à l'état).
locals {
  image = "${aws_ecr_repository.api.repository_url}@${var.image_digest}"
  pg_environment = [
    { name = "PGHOST", value = aws_db_instance.this.address },
    { name = "PGPORT", value = tostring(aws_db_instance.this.port) },
    { name = "PGDATABASE", value = aws_db_instance.this.db_name },
    # TLS vérifié (rds.force_ssl) ; l'autorité de l'hébergeur est montée par NODE_EXTRA_CA_CERTS
    # (US-036 : paquet de certificats dans l'image, procédure dans docs/ops/DEPLOY.md).
    { name = "PGSSLMODE", value = "verify-full" },
  ]
  common_environment = concat(local.pg_environment, [
    # jamais absente en préproduction ou en production : absente vaudrait « production »
    { name = "RUEDA_ENV", value = var.environment },
    { name = "RUEDA_RELEASE", value = var.release },
  ])
  secret_ref = { for k, v in local.secrets : k => { name = v, valueFrom = aws_secretsmanager_secret.this[k].arn } }
  containers = {
    api = {
      command = ["node", "apps/api/dist/main.js"]
      environment = concat(local.common_environment, [
        { name = "PGUSER", value = "app_api" },
        { name = "PORT", value = "3000" },
        # un seul mandataire de confiance : le répartiteur (X-Forwarded-For), US-012 / US-043
        { name = "RUEDA_API_TRUST_PROXY", value = "1" },
      ])
      secrets = [
        merge(local.secret_ref["app_api_password"], { name = "PGPASSWORD" }),
        local.secret_ref["rate_limit_key"],
        local.secret_ref["staff_mfa_proof_key"],
      ]
      ports = [3000]
    }
    worker = {
      command = ["node", "apps/api/dist/worker.js"]
      environment = concat(local.common_environment, [
        { name = "PGUSER", value = "app_worker" },
        { name = "RUEDA_BRAND_NAME", value = var.brand_name },
      ])
      secrets = [merge(local.secret_ref["app_worker_password"], { name = "PGPASSWORD" })]
      ports   = []
    }
    migrate = {
      command = ["node", "packages/db/src/deploy/cli.ts"]
      environment = concat(local.common_environment, [
        { name = "RUEDA_DB_ADMIN_USER", value = aws_db_instance.this.username },
      ])
      secrets = [
        { name = "RUEDA_DB_ADMIN_PASSWORD", valueFrom = "${local.admin_secret_arn}:password::" },
        local.secret_ref["migrator_password"],
        local.secret_ref["app_api_password"],
        local.secret_ref["app_worker_password"],
        local.secret_ref["app_anon_password"],
      ]
      ports = []
    }
  }
  sizes = {
    api     = { cpu = var.api_cpu, memory = var.api_memory }
    worker  = { cpu = var.worker_cpu, memory = var.worker_memory }
    migrate = { cpu = 256, memory = 512 }
  }
}

resource "aws_ecs_cluster" "this" {
  name = local.name
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
  tags = local.tags
}

resource "aws_ecs_task_definition" "this" {
  for_each                 = local.containers
  family                   = "${local.name}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(local.sizes[each.key].cpu)
  memory                   = tostring(local.sizes[each.key].memory)
  execution_role_arn       = aws_iam_role.execution[each.key].arn
  task_role_arn            = each.key == "migrate" ? null : aws_iam_role.app[each.key].arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([{
    name                   = each.key
    image                  = local.image
    essential              = true
    command                = each.value.command
    environment            = each.value.environment
    secrets                = each.value.secrets
    readonlyRootFilesystem = true
    user                   = "node"
    portMappings           = [for p in each.value.ports : { containerPort = p, protocol = "tcp" }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.this[each.key].name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = each.key
      }
    }
  }])
  tags = local.tags
}

# Alias lisibles (référencés par iam.tf et les sorties).
locals {
  task_api     = aws_ecs_task_definition.this["api"]
  task_worker  = aws_ecs_task_definition.this["worker"]
  task_migrate = aws_ecs_task_definition.this["migrate"]
}

resource "aws_ecs_service" "api" {
  name                               = "${local.name}-api"
  cluster                            = aws_ecs_cluster.this.id
  task_definition                    = local.task_api.arn
  desired_count                      = var.api_desired_count
  launch_type                        = "FARGATE"
  health_check_grace_period_seconds  = 60
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  enable_execute_command             = false
  propagate_tags                     = "SERVICE"
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = false
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 3000
  }
  lifecycle {
    ignore_changes = [task_definition]
  }
  depends_on = [aws_lb_listener.https]
  tags       = local.tags
}

resource "aws_ecs_service" "worker" {
  name                               = "${local.name}-worker"
  cluster                            = aws_ecs_cluster.this.id
  task_definition                    = local.task_worker.arn
  desired_count                      = 1
  launch_type                        = "FARGATE"
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100
  enable_execute_command             = false
  propagate_tags                     = "SERVICE"
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = false
  }
  lifecycle {
    ignore_changes = [task_definition]
  }
  tags = local.tags
}

# Répartiteur : HTTPS (TLS 1.2+ ; 17 §6.6), HTTP redirigé, en-têtes invalides rejetés.
resource "aws_lb" "this" {
  name                       = local.name
  load_balancer_type         = "application"
  internal                   = false
  security_groups            = [aws_security_group.alb.id]
  subnets                    = aws_subnet.public[*].id
  drop_invalid_header_fields = true
  enable_deletion_protection = var.deletion_protection
  tags                       = local.tags
}

resource "aws_lb_target_group" "api" {
  name                 = "${local.name}-api"
  port                 = 3000
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = aws_vpc.this.id
  deregistration_delay = 30
  # même sonde que la pile locale (infra/local/compose.yaml) : route publique, base lue
  health_check {
    path                = "/brand/content?locale=es"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
  tags = local.tags
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
  tags = local.tags
}

resource "aws_lb_listener" "http_redirect" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
  tags = local.tags
}
