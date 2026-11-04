output "vault_arn" {
  description = "À reporter dans backup_copy_vault_arn de chaque environnement (aucun secret)."
  value       = aws_backup_vault.copy.arn
}

output "account_id" {
  value = local.account_id
}
