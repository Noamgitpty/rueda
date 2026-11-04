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
      arn     = "arn:aws:rds:us-east-1:111111111111:db:rueda-test"
      address = "db.internal.invalid"
      master_user_secret = [{
        secret_arn    = "arn:aws:secretsmanager:us-east-1:111111111111:secret:rds-admin-000000"
        kms_key_id    = "arn:aws:kms:us-east-1:111111111111:key/00000000-0000-0000-0000-000000000000"
        secret_status = "active"
      }]
    }
  }
  mock_resource "aws_sns_topic" {
    defaults = {
      arn = "arn:aws:sns:us-east-1:111111111111:rueda-test-alerts"
    }
  }
  mock_resource "aws_backup_vault" {
    defaults = {
      arn = "arn:aws:backup:us-east-1:111111111111:backup-vault:rueda-test"
    }
  }
  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "111111111111"
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

# La clé « backup » (base et sauvegardes, US-004) distincte des autres.
override_resource {
  target = aws_kms_key.backup
  values = {
    arn    = "arn:aws:kms:us-east-1:111111111111:key/00000000-0000-0000-0000-00000000ba0c"
    key_id = "00000000-0000-0000-0000-00000000ba0c"
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
  backup_retention_days    = 7
  # coffre de copie : AUTRE compte (222222222222) et AUTRE région (us-west-2), jamais un vrai compte
  backup_copy_vault_arn = "arn:aws:backup:us-west-2:222222222222:backup-vault:rueda-backup-copy"
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
    backup_retention_days    = 35
  }

  assert {
    condition     = aws_db_instance.this.multi_az && aws_db_instance.this.deletion_protection && !aws_db_instance.this.skip_final_snapshot
    error_message = "production : Multi-AZ, protection, instantané final (17 §6.4, NN10)"
  }
  assert {
    condition     = aws_db_instance.this.storage_encrypted && aws_db_instance.this.kms_key_id == aws_kms_key.backup.arn && aws_db_instance.this.master_user_secret_kms_key_id == aws_kms_key.data.arn && !aws_db_instance.this.publicly_accessible
    error_message = "base chiffrée par la clé « backup » (son secret d'administration par « data »), jamais publique"
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

# --- Rôle de déploiement OIDC (ADR-084, revue sécurité US-003 constat 2) --------------------------
# Évaluation SIMULÉE de la politique de confiance : chaque jeton candidat est écrit À LA MAIN, tel
# que GitHub l'émet avec la personnalisation du `sub` (["repo", "context", "ref",
# "job_workflow_ref"], DEPLOY.md §4 étape 2), jamais recalculé par le module. Un jeton est accepté
# si et seulement si CHAQUE condition StringEquals égale l'affirmation du même nom ; la politique
# n'a qu'une instruction, qu'une action, et aucun autre opérateur (ni StringLike, ni joker).
run "oidc_production" {
  command = plan

  variables {
    environment              = "production"
    db_multi_az              = true
    deletion_protection      = true
    db_backup_retention_days = 14
  }

  assert {
    condition = (
      length(jsondecode(aws_iam_role.deploy.assume_role_policy).Statement) == 1
      && jsondecode(aws_iam_role.deploy.assume_role_policy).Statement[0].Effect == "Allow"
      && jsondecode(aws_iam_role.deploy.assume_role_policy).Statement[0].Action == "sts:AssumeRoleWithWebIdentity"
      && jsonencode(keys(jsondecode(aws_iam_role.deploy.assume_role_policy).Statement[0].Condition)) == jsonencode(["StringEquals"])
      && length(jsondecode(aws_iam_role.deploy.assume_role_policy).Statement[0].Condition.StringEquals) == 2
      && !strcontains(aws_iam_role.deploy.assume_role_policy, "*")
    )
    error_message = "une seule instruction Allow AssumeRoleWithWebIdentity, conditions StringEquals sur aud et sub seulement, aucun joker"
  }
  assert {
    # le jeton légitime : deploy.yml, sur main, environnement production
    condition = alltrue([
      for k, v in jsondecode(aws_iam_role.deploy.assume_role_policy).Statement[0].Condition.StringEquals :
      lookup(tomap({
        aud = "sts.amazonaws.com"
        sub = "repo:owner/repo:environment:production:ref:refs/heads/main:job_workflow_ref:owner/repo/.github/workflows/deploy.yml@refs/heads/main"
      }), trimprefix(k, "token.actions.githubusercontent.com:"), "") == v
    ])
    error_message = "deploy.yml sur refs/heads/main, environnement production : accepté"
  }
  assert {
    condition = !alltrue([
      for k, v in jsondecode(aws_iam_role.deploy.assume_role_policy).Statement[0].Condition.StringEquals :
      lookup(tomap({
        aud = "sts.amazonaws.com"
        sub = "repo:owner/repo:environment:production:ref:refs/heads/feature:job_workflow_ref:owner/repo/.github/workflows/deploy.yml@refs/heads/feature"
      }), trimprefix(k, "token.actions.githubusercontent.com:"), "") == v
    ])
    error_message = "AUTRE BRANCHE (deploy.yml lancé depuis refs/heads/feature) : refusé"
  }
  assert {
    condition = !alltrue([
      for k, v in jsondecode(aws_iam_role.deploy.assume_role_policy).Statement[0].Condition.StringEquals :
      lookup(tomap({
        aud = "sts.amazonaws.com"
        sub = "repo:owner/repo:environment:production:ref:refs/heads/main:job_workflow_ref:owner/repo/.github/workflows/ci.yml@refs/heads/main"
      }), trimprefix(k, "token.actions.githubusercontent.com:"), "") == v
    ])
    error_message = "AUTRE WORKFLOW (ci.yml sur main, environnement production) : refusé"
  }
  assert {
    condition = !alltrue([
      for k, v in jsondecode(aws_iam_role.deploy.assume_role_policy).Statement[0].Condition.StringEquals :
      lookup(tomap({
        aud = "sts.amazonaws.com"
        sub = "repo:owner/repo:environment:preproduction:ref:refs/heads/main:job_workflow_ref:owner/repo/.github/workflows/deploy.yml@refs/heads/main"
      }), trimprefix(k, "token.actions.githubusercontent.com:"), "") == v
    ])
    error_message = "AUTRE ENVIRONNEMENT (jeton de préproduction sur le rôle de production) : refusé"
  }
  assert {
    condition = !alltrue([
      for k, v in jsondecode(aws_iam_role.deploy.assume_role_policy).Statement[0].Condition.StringEquals :
      lookup(tomap({
        aud = "sts.amazonaws.com"
        sub = "repo:owner/repo:environment:production"
      }), trimprefix(k, "token.actions.githubusercontent.com:"), "") == v
    ])
    error_message = "`sub` par défaut (personnalisation du dépôt absente) : refusé (fail-closed)"
  }
  assert {
    condition = !alltrue([
      for k, v in jsondecode(aws_iam_role.deploy.assume_role_policy).Statement[0].Condition.StringEquals :
      lookup(tomap({
        aud = "sts.amazonaws.com"
        sub = "repo:other/repo:environment:production:ref:refs/heads/main:job_workflow_ref:other/repo/.github/workflows/deploy.yml@refs/heads/main"
      }), trimprefix(k, "token.actions.githubusercontent.com:"), "") == v
    ])
    error_message = "AUTRE DÉPÔT (fourche) : refusé"
  }
  assert {
    condition = !alltrue([
      for k, v in jsondecode(aws_iam_role.deploy.assume_role_policy).Statement[0].Condition.StringEquals :
      lookup(tomap({
        aud = "https://github.com/owner"
        sub = "repo:owner/repo:environment:production:ref:refs/heads/main:job_workflow_ref:owner/repo/.github/workflows/deploy.yml@refs/heads/main"
      }), trimprefix(k, "token.actions.githubusercontent.com:"), "") == v
    ])
    error_message = "AUTRE AUDIENCE : refusé"
  }
  assert {
    condition     = output.deploy_oidc_subject == "repo:owner/repo:environment:production:ref:refs/heads/main:job_workflow_ref:owner/repo/.github/workflows/deploy.yml@refs/heads/main"
    error_message = "la sortie deploy_oidc_subject publie le `sub` exigé (vérification du fondateur)"
  }
}

run "oidc_preproduction" {
  command = plan

  assert {
    condition = alltrue([
      for k, v in jsondecode(aws_iam_role.deploy.assume_role_policy).Statement[0].Condition.StringEquals :
      lookup(tomap({
        aud = "sts.amazonaws.com"
        sub = "repo:owner/repo:environment:preproduction:ref:refs/heads/main:job_workflow_ref:owner/repo/.github/workflows/deploy.yml@refs/heads/main"
      }), trimprefix(k, "token.actions.githubusercontent.com:"), "") == v
    ])
    error_message = "préproduction : deploy.yml sur main, environnement preproduction, accepté"
  }
  assert {
    condition = !alltrue([
      for k, v in jsondecode(aws_iam_role.deploy.assume_role_policy).Statement[0].Condition.StringEquals :
      lookup(tomap({
        aud = "sts.amazonaws.com"
        sub = "repo:owner/repo:environment:production:ref:refs/heads/main:job_workflow_ref:owner/repo/.github/workflows/deploy.yml@refs/heads/main"
      }), trimprefix(k, "token.actions.githubusercontent.com:"), "") == v
    ])
    error_message = "AUTRE ENVIRONNEMENT (jeton de production sur le rôle de préproduction) : refusé"
  }
  assert {
    condition = !alltrue([
      for k, v in jsondecode(aws_iam_role.deploy.assume_role_policy).Statement[0].Condition.StringEquals :
      lookup(tomap({
        aud = "sts.amazonaws.com"
        sub = "repo:owner/repo:environment:preproduction:ref:refs/pull/1/merge:job_workflow_ref:owner/repo/.github/workflows/deploy.yml@refs/pull/1/merge"
      }), trimprefix(k, "token.actions.githubusercontent.com:"), "") == v
    ])
    error_message = "AUTRE RÉFÉRENCE (demande de fusion) : refusé"
  }
}

run "depot_avec_deux_points_refuse" {
  command = plan

  variables {
    github_repository = "owner/repo:environment:production"
  }

  expect_failures = [var.github_repository]
}

# --- Sauvegardes et supervision (US-004, ADR-080) -------------------------------------------------
# Critère : « Given la sauvegarde quotidienne, When elle se termine, Then une copie existe dans un
# autre compte » : le plan quotidien copie chaque point de restauration dans le coffre d'un AUTRE
# compte et d'une AUTRE région ; en production, un plan sans copie hors compte est refusé.
run "sauvegardes_production" {
  command = apply

  variables {
    environment              = "production"
    db_instance_class        = "db.t4g.small"
    db_multi_az              = true
    db_backup_retention_days = 14
    deletion_protection      = true
    evidence_lock_days       = 400
    api_desired_count        = 2
    backup_retention_days    = 35
    alert_email              = "alertes@example.invalid"
  }

  assert {
    condition     = aws_db_instance.this.backup_retention_period >= 7 && !aws_db_instance.this.delete_automated_backups
    error_message = "restauration à un instant donné : 7 jours au moins, gardés après suppression de l'instance"
  }
  assert {
    condition     = one(aws_backup_plan.daily.rule).schedule == "cron(0 5 * * ? *)" && one(one(aws_backup_plan.daily.rule).lifecycle).delete_after == 35
    error_message = "sauvegarde quotidienne, conservée backup_retention_days"
  }
  assert {
    condition     = one(one(aws_backup_plan.daily.rule).copy_action).destination_vault_arn == var.backup_copy_vault_arn
    error_message = "chaque sauvegarde quotidienne est copiée dans le coffre de copie"
  }
  assert {
    condition     = split(":", one(one(aws_backup_plan.daily.rule).copy_action).destination_vault_arn)[4] != data.aws_caller_identity.current.account_id
    error_message = "la copie est dans un AUTRE compte"
  }
  assert {
    condition     = split(":", one(one(aws_backup_plan.daily.rule).copy_action).destination_vault_arn)[3] != var.region
    error_message = "la copie est dans une AUTRE région"
  }
  assert {
    condition     = one(one(one(aws_backup_plan.daily.rule).copy_action).lifecycle).delete_after == 35
    error_message = "copie conservée backup_copy_retention_days (PROPOSÉ : 35)"
  }
  assert {
    condition     = contains(aws_backup_selection.data.resources, aws_db_instance.this.arn) && alltrue([for b in aws_s3_bucket.this : contains(aws_backup_selection.data.resources, b.arn)])
    error_message = "la base et les deux compartiments sont sauvegardés"
  }
  assert {
    condition     = aws_backup_vault.this.kms_key_arn == aws_kms_key.backup.arn && !aws_backup_vault.this.force_destroy && length(aws_backup_vault_lock_configuration.this) == 1
    error_message = "coffre chiffré par la clé dédiée « backup », jamais détruit avec son contenu, verrouillé en production"
  }
  assert {
    condition     = !strcontains(aws_kms_key.data.policy, "222222222222") && !strcontains(aws_kms_key.files.policy == null ? "" : aws_kms_key.files.policy, "222222222222") && !strcontains(aws_kms_key.alerts.policy, "222222222222")
    error_message = "revue sécurité : la clé principale « data » (secrets, registre) et les autres clés n'accordent RIEN au compte de copie"
  }
  assert {
    condition     = strcontains(aws_kms_key.backup.policy, "arn:aws:iam::222222222222:root") && strcontains(aws_kms_key.backup.policy, "arn:aws:iam::111111111111:root")
    error_message = "clé « backup » : administrée par le compte, lisible par le compte de copie (copie entre comptes)"
  }
  assert {
    condition     = strcontains(aws_kms_key.backup.policy, "\"kms:CallerAccount\":\"222222222222\"") && strcontains(aws_kms_key.backup.policy, "backup.us-east-1.amazonaws.com") && strcontains(aws_kms_key.backup.policy, "kms:ViaService") && strcontains(aws_kms_key.backup.policy, "kms:GrantIsForAWSResource")
    error_message = "clé « backup » : droits du compte de copie conditionnés (kms:CallerAccount, kms:ViaService, subvention pour une ressource AWS)"
  }
  assert {
    condition     = !strcontains(aws_kms_key.backup.policy, "GenerateDataKey") && !strcontains(aws_kms_key.backup.policy, "ReEncrypt") && length(regexall("kms:\\*", aws_kms_key.backup.policy)) == 1
    error_message = "clé « backup » : ni GenerateDataKey ni ReEncrypt, et kms:* pour l'administration du compte seulement"
  }
  assert {
    condition     = aws_sns_topic.alerts.kms_master_key_id == aws_kms_key.alerts.arn && length(aws_sns_topic_subscription.email) == 1
    error_message = "sujet des alertes chiffré, adresse du fondateur abonnée"
  }
  assert {
    condition     = alltrue([for a in values(aws_cloudwatch_metric_alarm.ops_alert) : contains(a.alarm_actions, aws_sns_topic.alerts.arn)])
    error_message = "les alarmes des alertes de l'application notifient le sujet des alertes"
  }
  assert {
    condition     = alltrue([for a in [aws_cloudwatch_metric_alarm.worker_heartbeat, aws_cloudwatch_metric_alarm.api_healthy_hosts, aws_cloudwatch_metric_alarm.api_5xx, aws_cloudwatch_metric_alarm.api_latency_p95, aws_cloudwatch_metric_alarm.db_cpu, aws_cloudwatch_metric_alarm.db_free_storage] : contains(a.alarm_actions, aws_sns_topic.alerts.arn)])
    error_message = "les alarmes de santé (travailleur, API, base) notifient le sujet des alertes"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.worker_heartbeat.treat_missing_data == "breaching" && aws_cloudwatch_metric_alarm.api_healthy_hosts.treat_missing_data == "breaching"
    error_message = "un travailleur muet ou une API sans cible saine déclenche l'alarme (fail-closed)"
  }
  assert {
    condition     = strcontains(aws_cloudwatch_log_metric_filter.ops_alert["p1"].pattern, "ops.alert") && strcontains(aws_cloudwatch_log_metric_filter.ops_alert["p1"].pattern, "P1")
    error_message = "les alertes de l'application (port AlertChannel) deviennent une métrique par sévérité"
  }
  assert {
    condition     = contains(jsondecode(aws_cloudwatch_event_rule.backup_failed.event_pattern)["detail-type"], "Copy Job State Change") && aws_cloudwatch_event_target.backup_failed.arn == aws_sns_topic.alerts.arn
    error_message = "un échec de sauvegarde ou de copie hors compte alerte"
  }
}

run "preproduction_sans_copie_permise" {
  command = plan

  variables {
    backup_copy_vault_arn = ""
  }

  assert {
    condition     = length(one(aws_backup_plan.daily.rule).copy_action) == 0 && length(aws_backup_vault_lock_configuration.this) == 0 && !strcontains(aws_kms_key.backup.policy, "BackupCopyAccount")
    error_message = "préproduction : copie hors compte facultative (coût), coffre non verrouillé"
  }
}

run "production_sans_copie_hors_compte_refusee" {
  command = plan

  variables {
    environment              = "production"
    db_multi_az              = true
    deletion_protection      = true
    db_backup_retention_days = 14
    backup_copy_vault_arn    = ""
  }

  expect_failures = [aws_backup_plan.daily]
}

run "copie_dans_le_meme_compte_refusee" {
  command = plan

  variables {
    backup_copy_vault_arn = "arn:aws:backup:us-west-2:111111111111:backup-vault:rueda-backup-copy"
  }

  expect_failures = [aws_backup_plan.daily]
}

run "copie_dans_la_meme_region_refusee" {
  command = plan

  variables {
    backup_copy_vault_arn = "arn:aws:backup:us-east-1:222222222222:backup-vault:rueda-backup-copy"
  }

  expect_failures = [aws_backup_plan.daily]
}

run "production_retention_courte_refusee" {
  command = plan

  variables {
    environment              = "production"
    db_multi_az              = true
    deletion_protection      = true
    db_backup_retention_days = 14
    backup_retention_days    = 3
  }

  expect_failures = [aws_backup_plan.daily]
}

run "coffre_de_copie_mal_forme_refuse" {
  command = plan

  variables {
    backup_copy_vault_arn = "arn:aws:s3:::pas-un-coffre"
  }

  expect_failures = [var.backup_copy_vault_arn]
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
