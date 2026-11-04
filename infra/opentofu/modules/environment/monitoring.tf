# Supervision et alertes (US-004, ADR-080 ; 17 §6.3, §6.4 « alerte au fondateur » ; 16 ADM-032,
# NFR-15). Toutes les alertes vont à UN sujet de notification chiffré (clé « alerts ») ; le
# fondateur y abonne son adresse (alert_email, hors dépôt) à la première application.
#
# Les alertes ne contiennent que des comptes et des codes, jamais de donnée personnelle :
#   - l'application émet `{"event":"ops.alert","severity":"P1"|"P2",…}` (port AlertChannel,
#     adaptateur LogAlertChannel) : un filtre de métrique par sévérité en fait une métrique,
#     une alarme la notifie ;
#   - santé : battement du travailleur (`bus.metrics` toutes les 60 s ; absent = alarme), cibles
#     saines de l'API, erreurs 5xx et latence p95 (17 §6.7), processeur et espace de la base ;
#   - sauvegardes : tout échec de sauvegarde, de copie ou de restauration (EventBridge).
# Valeurs des seuils : PROPOSÉES, ADR-080.
locals {
  metric_namespace = "${var.name_prefix}/${var.environment}"
  ops_alert_severities = {
    p1 = "P1"
    p2 = "P2"
  }
  alert_publishers = ["cloudwatch.amazonaws.com", "events.amazonaws.com"]
  alerts_key_publishers = {
    Sid       = "AlertPublishers"
    Effect    = "Allow"
    Principal = { Service = local.alert_publishers }
    Action    = ["kms:Decrypt", "kms:GenerateDataKey*"]
    Resource  = "*"
  }
}

resource "aws_kms_key" "alerts" {
  description             = "${local.name} : sujet des alertes"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [local.data_key_admin, local.alerts_key_publishers]
  })
  tags = local.tags
}

resource "aws_kms_alias" "alerts" {
  name          = "alias/${local.name}-alerts"
  target_key_id = aws_kms_key.alerts.key_id
}

resource "aws_sns_topic" "alerts" {
  name              = "${local.name}-alerts"
  kms_master_key_id = aws_kms_key.alerts.arn
  tags              = local.tags
}

resource "aws_sns_topic_policy" "alerts" {
  arn = aws_sns_topic.alerts.arn
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AlarmsAndEventsOfThisAccount"
      Effect    = "Allow"
      Principal = { Service = local.alert_publishers }
      Action    = "sns:Publish"
      Resource  = aws_sns_topic.alerts.arn
      Condition = { StringEquals = { "aws:SourceAccount" = local.account_id } }
    }]
  })
}

resource "aws_sns_topic_subscription" "email" {
  count     = var.alert_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# Alertes de l'application (port AlertChannel) : une métrique par sévérité.
resource "aws_cloudwatch_log_metric_filter" "ops_alert" {
  for_each       = local.ops_alert_severities
  name           = "${local.name}-ops-alert-${each.key}"
  log_group_name = aws_cloudwatch_log_group.this["worker"].name
  pattern        = "{ ($.event = \"ops.alert\") && ($.severity = \"${each.value}\") }"
  metric_transformation {
    name          = "OpsAlerts${each.value}"
    namespace     = local.metric_namespace
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "ops_alert" {
  for_each            = local.ops_alert_severities
  alarm_name          = "${local.name}-ops-alert-${each.key}"
  alarm_description   = "Alerte ${each.value} de l'application (ops.alert, comptes seulement ; runbook docs/ops/MONITORING.md)."
  namespace           = local.metric_namespace
  metric_name         = "OpsAlerts${each.value}"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = local.tags
}

# Santé du travailleur : la ligne `bus.metrics` (toutes les 60 s) fait office de battement.
resource "aws_cloudwatch_log_metric_filter" "worker_heartbeat" {
  name           = "${local.name}-worker-heartbeat"
  log_group_name = aws_cloudwatch_log_group.this["worker"].name
  pattern        = "{ $.metric = \"bus.metrics\" }"
  metric_transformation {
    name          = "WorkerHeartbeat"
    namespace     = local.metric_namespace
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "worker_heartbeat" {
  alarm_name          = "${local.name}-worker-heartbeat"
  alarm_description   = "Travailleur muet depuis 5 min (aucune ligne bus.metrics)."
  namespace           = local.metric_namespace
  metric_name         = "WorkerHeartbeat"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  tags                = local.tags
}

# Santé de l'API (répartiteur) : aucune cible saine, erreurs 5xx, latence p95 (17 §6.7).
resource "aws_cloudwatch_metric_alarm" "api_healthy_hosts" {
  alarm_name          = "${local.name}-api-healthy-hosts"
  alarm_description   = "Aucune tâche de l'API saine derrière le répartiteur depuis 3 min."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HealthyHostCount"
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  dimensions = {
    LoadBalancer = aws_lb.this.arn_suffix
    TargetGroup  = aws_lb_target_group.api.arn_suffix
  }
  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
  tags          = local.tags
}

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "${local.name}-api-5xx"
  alarm_description   = "Erreurs 5xx de l'API au-delà du seuil sur 5 min."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = var.api_5xx_threshold
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  dimensions = {
    LoadBalancer = aws_lb.this.arn_suffix
    TargetGroup  = aws_lb_target_group.api.arn_suffix
  }
  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
  tags          = local.tags
}

resource "aws_cloudwatch_metric_alarm" "api_latency_p95" {
  alarm_name          = "${local.name}-api-latency-p95"
  alarm_description   = "Latence p95 de l'API au-delà de l'objectif de 17 §6.7 pendant 15 min."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "TargetResponseTime"
  extended_statistic  = "p95"
  period              = 300
  evaluation_periods  = 3
  threshold           = var.api_p95_latency_seconds
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  dimensions = {
    LoadBalancer = aws_lb.this.arn_suffix
    TargetGroup  = aws_lb_target_group.api.arn_suffix
  }
  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
  tags          = local.tags
}

# Santé de la base : processeur et espace libre.
resource "aws_cloudwatch_metric_alarm" "db_cpu" {
  alarm_name          = "${local.name}-db-cpu"
  alarm_description   = "Processeur de la base au-delà de 80 % pendant 15 min."
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "breaching"
  dimensions = {
    DBInstanceIdentifier = aws_db_instance.this.identifier
  }
  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
  tags          = local.tags
}

resource "aws_cloudwatch_metric_alarm" "db_free_storage" {
  alarm_name          = "${local.name}-db-free-storage"
  alarm_description   = "Espace libre de la base sous 2 Gio."
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 2147483648
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  dimensions = {
    DBInstanceIdentifier = aws_db_instance.this.identifier
  }
  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
  tags          = local.tags
}

# Sauvegardes : tout échec de sauvegarde, de copie ou de restauration (16 ADM-032 « échec de
# sauvegarde → alerte immédiate »).
resource "aws_cloudwatch_event_rule" "backup_failed" {
  name        = "${local.name}-backup-failed"
  description = "Échec d'une sauvegarde, d'une copie hors compte ou d'une restauration."
  event_pattern = jsonencode({
    source        = ["aws.backup"]
    "detail-type" = ["Backup Job State Change", "Copy Job State Change", "Restore Job State Change"]
    detail        = { state = ["FAILED", "ABORTED", "EXPIRED"] }
  })
  tags = local.tags
}

resource "aws_cloudwatch_event_target" "backup_failed" {
  rule      = aws_cloudwatch_event_rule.backup_failed.name
  target_id = "alerts"
  arn       = aws_sns_topic.alerts.arn
}
