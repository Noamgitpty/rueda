# Preuves du module « environnement » SANS compte ni identifiant (US-003, ADR-078) : `tofu test`
# avec un fournisseur AWS simulé (mock_provider). Rien n'est créé chez un fournisseur. Les attendus
# viennent de 17 §6.4 à §6.6 (Multi-AZ et protection en production, chiffrement, TLS), de C19 (aucun
# FAKE) et de CLAUDE.md point 7 (interrupteurs de mise en service hors de l'IaC).
# Le fournisseur valide le FORMAT des ARN passés en argument : les doubles rendent donc des ARN
# plausibles (compte 111111111111, jamais un vrai compte).
mock_provider "aws" {
  mock_resource "aws_kms_key" {
    defaults = {
      arn    = "arn:aws:kms:us-east-1:111111111111:key/00000000-0000-0000-0000-00000000da7a"
      key_id = "00000000-0000-0000-0000-00000000da7a"
    }
  }
  mock_resource "aws_lb" {
    defaults = {
      arn      = "arn:aws:elasticloadbalancing:us-east-1:111111111111:loadbalancer/app/rueda/0000000000000000"
      dns_name = "rueda.elb.invalid"
    }
  }
  mock_resource "aws_lb_target_group" {
    defaults = {
      arn = "arn:aws:elasticloadbalancing:us-east-1:111111111111:targetgroup/rueda-api/0000000000000000"
    }
  }
  mock_resource "aws_iam_role" {
    defaults = {
      arn = "arn:aws:iam::111111111111:role/rueda-test"
    }
  }
  mock_resource "aws_secretsmanager_secret" {
    defaults = {
      arn = "arn:aws:secretsmanager:us-east-1:111111111111:secret:rueda-test-000000"
    }
  }
  mock_resource "aws_s3_bucket" {
    defaults = {
      arn = "arn:aws:s3:::rueda-test"
    }
  }
  mock_resource "aws_ecs_cluster" {
    defaults = {
      arn = "arn:aws:ecs:us-east-1:111111111111:cluster/rueda-test"
      id  = "arn:aws:ecs:us-east-1:111111111111:cluster/rueda-test"
    }
  }
  mock_resource "aws_ecs_task_definition" {
    defaults = {
      arn = "arn:aws:ecs:us-east-1:111111111111:task-definition/rueda-test:1"
    }
  }
  mock_resource "aws_ecs_service" {
    defaults = {
      id = "arn:aws:ecs:us-east-1:111111111111:service/rueda-test/rueda-test"
    }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = {
      arn = "arn:aws:logs:us-east-1:111111111111:log-group:/rueda/test"
    }
  }
  mock_resource "aws_db_instance" {
    defaults = {
      address = "db.internal.invalid"
      master_user_secret = [{
        secret_arn    = "arn:aws:secretsmanager:us-east-1:111111111111:secret:rds-admin-000000"
        kms_key_id    = "arn:aws:kms:us-east-1:111111111111:key/00000000-0000-0000-0000-000000000000"
        secret_status = "active"
      }]
    }
  }
  mock_resource "aws_ecr_repository" {
    defaults = {
      arn            = "arn:aws:ecr:us-east-1:111111111111:repository/rueda/api"
      repository_url = "111111111111.dkr.ecr.us-east-1.amazonaws.com/rueda/api"
    }
  }
}

# La clé « files » distincte de la clé « data » (les assertions de chiffrement les distinguent).
override_resource {
  target = aws_kms_key.files
  values = {
    arn    = "arn:aws:kms:us-east-1:111111111111:key/00000000-0000-0000-0000-0000000f11e5"
    key_id = "00000000-0000-0000-0000-0000000f11e5"
  }
}

variables {
  environment              = "preproduction"
  region                   = "us-east-1"
  availability_zones       = ["us-east-1a", "us-east-1b"]
  image_digest             = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  release                  = "abc123def456"
  brand_name               = "Marque de test"
  certificate_arn          = "arn:aws:acm:us-east-1:111111111111:certificate/test"
  bucket_suffix            = "test-suffix"
  db_instance_class        = "db.t4g.micro"
  db_multi_az              = false
  db_backup_retention_days = 1
  deletion_protection      = false
  evidence_lock_days       = 1
  api_desired_count        = 1
  github_repository        = "owner/repo"
  github_oidc_provider_arn = "arn:aws:iam::111111111111:oidc-provider/token.actions.githubusercontent.com"
}

run "preproduction" {
  command = apply

  assert {
    condition = alltrue([
      for t in aws_ecs_task_definition.this :
      contains([for e in jsondecode(t.container_definitions)[0].environment : "${e.name}=${e.value}"], "RUEDA_ENV=preproduction")
    ])
    error_message = "chaque tâche pose RUEDA_ENV=preproduction (absente vaudrait production)"
  }
  assert {
    condition = alltrue([
      for t in aws_ecs_task_definition.this :
      jsondecode(t.container_definitions)[0].image == "111111111111.dkr.ecr.us-east-1.amazonaws.com/rueda/api@${var.image_digest}"
    ])
    error_message = "l'image est désignée par son empreinte, jamais par une étiquette"
  }
  assert {
    condition     = aws_ecs_service.api.deployment_circuit_breaker[0].rollback && aws_ecs_service.worker.deployment_circuit_breaker[0].rollback
    error_message = "coupe-circuit avec retour arrière automatique sur l'API et le travailleur"
  }
  assert {
    condition     = aws_ecs_service.api.deployment_minimum_healthy_percent == 100
    error_message = "l'API garde toutes ses tâches saines pendant la bascule"
  }
  assert {
    condition     = alltrue([for b in aws_s3_bucket.this : b.force_destroy])
    error_message = "préproduction : compartiments détruits et recréés depuis le dépôt (critère 2)"
  }
  assert {
    condition     = alltrue([for s in aws_secretsmanager_secret.this : s.recovery_window_in_days == 0])
    error_message = "préproduction : noms de secrets réutilisables aussitôt après destruction"
  }
}

run "production" {
  command = apply

  variables {
    environment              = "production"
    db_instance_class        = "db.t4g.small"
    db_multi_az              = true
    db_backup_retention_days = 14
    deletion_protection      = true
    evidence_lock_days       = 400
    api_desired_count        = 2
  }

  assert {
    condition     = aws_db_instance.this.multi_az && aws_db_instance.this.deletion_protection && !aws_db_instance.this.skip_final_snapshot
    error_message = "production : Multi-AZ, protection, instantané final (17 §6.4, NN10)"
  }
  assert {
    condition     = aws_db_instance.this.storage_encrypted && aws_db_instance.this.kms_key_id == aws_kms_key.data.arn && !aws_db_instance.this.publicly_accessible
    error_message = "base chiffrée par la clé « data », jamais publique"
  }
  assert {
    condition     = aws_db_instance.this.manage_master_user_password
    error_message = "mot de passe d'administration géré par le service (ni dépôt, ni état)"
  }
  assert {
    condition     = aws_kms_key.data.arn != aws_kms_key.files.arn && aws_kms_key.data.enable_key_rotation && aws_kms_key.files.enable_key_rotation
    error_message = "deux clés KMS distinctes avec rotation (NN10)"
  }
  assert {
    condition     = length(aws_s3_bucket.this) == 2 && alltrue([for b in aws_s3_bucket.this : !b.force_destroy])
    error_message = "deux compartiments, jamais détruits avec leur contenu en production"
  }
  assert {
    condition     = alltrue([for c in aws_s3_bucket_server_side_encryption_configuration.this : one(one(c.rule).apply_server_side_encryption_by_default).kms_master_key_id == aws_kms_key.files.arn])
    error_message = "compartiments chiffrés par la clé « files »"
  }
  assert {
    condition     = alltrue([for p in aws_s3_bucket_public_access_block.this : p.block_public_acls && p.block_public_policy && p.ignore_public_acls && p.restrict_public_buckets])
    error_message = "aucun accès public aux compartiments"
  }
  assert {
    condition     = aws_s3_bucket.this["evidence"].object_lock_enabled
    error_message = "preuves et journal des déploiements sous verrouillage d'objet"
  }
  assert {
    condition     = aws_lb_listener.https.ssl_policy == "ELBSecurityPolicy-TLS13-1-2-2021-06" && aws_lb.this.drop_invalid_header_fields
    error_message = "TLS 1.2+ (17 §6.6), en-têtes invalides rejetés"
  }
  assert {
    condition     = aws_ecr_repository.api.image_tag_mutability == "IMMUTABLE"
    error_message = "étiquettes d'images immuables"
  }
  assert {
    condition     = contains([for e in jsondecode(aws_ecs_task_definition.this["api"].container_definitions)[0].environment : "${e.name}=${e.value}"], "RUEDA_API_TRUST_PROXY=1")
    error_message = "API derrière un seul mandataire de confiance (répartiteur) : RUEDA_API_TRUST_PROXY=1"
  }
  assert {
    condition     = !contains([for s in jsondecode(aws_ecs_task_definition.this["api"].container_definitions)[0].secrets : s.name], "RUEDA_DB_ADMIN_PASSWORD")
    error_message = "l'API ne reçoit jamais le mot de passe d'administration de la base"
  }
  assert {
    condition = alltrue([
      for t in aws_ecs_task_definition.this : jsondecode(t.container_definitions)[0].readonlyRootFilesystem && jsondecode(t.container_definitions)[0].user == "node"
    ])
    error_message = "conteneurs non root, système de fichiers en lecture seule"
  }
}

run "aucun_fake_ni_interrupteur_dans_l_iac" {
  command = apply

  assert {
    condition = alltrue([
      for t in aws_ecs_task_definition.this : !strcontains(upper(t.container_definitions), "FAKE")
    ])
    error_message = "aucun adaptateur ni variable FAKE dans une tâche (C19)"
  }
  assert {
    condition = alltrue([
      for t in aws_ecs_task_definition.this : length(regexall("(?i)(p2p_private_hosts_enabled|insurer_contract_active|funds_holding_enabled|payouts_enabled)", t.container_definitions)) == 0
    ])
    error_message = "les interrupteurs de mise en service ne sont jamais posés par l'IaC (CLAUDE.md point 7)"
  }
  assert {
    condition = alltrue([
      for t in aws_ecs_task_definition.this : alltrue([for e in jsondecode(t.container_definitions)[0].environment : length(regexall("(?i)(PASSWORD|SECRET|_KEY$|TOKEN)", e.name)) == 0])
    ])
    error_message = "aucun secret en variable en clair : uniquement des références au coffre"
  }
}

run "production_sans_multi_az_refusee" {
  command = plan

  variables {
    environment              = "production"
    db_multi_az              = false
    deletion_protection      = true
    db_backup_retention_days = 14
  }

  expect_failures = [aws_db_instance.this]
}

run "production_sans_protection_refusee" {
  command = plan

  variables {
    environment              = "production"
    db_multi_az              = true
    deletion_protection      = false
    db_backup_retention_days = 14
  }

  expect_failures = [aws_db_instance.this]
}

run "etiquette_mobile_refusee" {
  command = plan

  variables {
    image_digest = "latest"
  }

  expect_failures = [var.image_digest]
}

run "environnement_inconnu_refuse" {
  command = plan

  variables {
    environment = "staging"
  }

  expect_failures = [var.environment]
}
