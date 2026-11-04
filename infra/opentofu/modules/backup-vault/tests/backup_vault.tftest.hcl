# Preuves du coffre de copie SANS compte ni identifiant (US-004, ADR-080) : `tofu test` avec un
# fournisseur AWS simulé. Le compte de sauvegarde simulé est 333333333333 ; les environnements
# simulés 111111111111 et 222222222222 (jamais de vrais comptes). Attendus : 17 §6.4 (copie dans un
# autre compte), NN10.
mock_provider "aws" {
  mock_resource "aws_kms_key" {
    defaults = {
      arn    = "arn:aws:kms:us-west-2:333333333333:key/00000000-0000-0000-0000-0000000bac0b"
      key_id = "00000000-0000-0000-0000-0000000bac0b"
    }
  }
  mock_resource "aws_backup_vault" {
    defaults = {
      arn = "arn:aws:backup:us-west-2:333333333333:backup-vault:rueda-backup-copy"
    }
  }
  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "333333333333"
    }
  }
}

variables {
  source_account_ids = ["111111111111", "222222222222"]
}

run "coffre_de_copie" {
  command = apply

  assert {
    condition     = aws_backup_vault.copy.kms_key_arn == aws_kms_key.vault.arn && aws_kms_key.vault.enable_key_rotation
    error_message = "coffre chiffré par la clé propre au compte de sauvegarde, avec rotation"
  }
  assert {
    condition = alltrue([
      for a in ["111111111111", "222222222222"] :
      strcontains(aws_backup_vault_policy.copy.policy, "arn:aws:iam::${a}:root")
    ]) && strcontains(aws_backup_vault_policy.copy.policy, "backup:CopyIntoBackupVault")
    error_message = "chaque environnement peut copier dans le coffre"
  }
  assert {
    condition     = strcontains(aws_backup_vault_policy.copy.policy, "backup:DeleteRecoveryPoint") && strcontains(aws_backup_vault_policy.copy.policy, "\"Deny\"")
    error_message = "suppression des points de restauration refusée à tous"
  }
  assert {
    condition     = !strcontains(aws_kms_key.vault.policy, "111111111111") && !strcontains(aws_kms_key.vault.policy, "222222222222")
    error_message = "la clé du coffre n'est jamais partagée avec un environnement"
  }
  assert {
    condition     = aws_backup_vault_lock_configuration.copy.min_retention_days == 7 && aws_backup_vault_lock_configuration.copy.changeable_for_days == null
    error_message = "verrou de 7 jours, mode gouvernance par défaut (le mode conformité est une décision du fondateur)"
  }
  assert {
    condition     = output.vault_arn == "arn:aws:backup:us-west-2:333333333333:backup-vault:rueda-backup-copy"
    error_message = "l'ARN du coffre est la sortie à reporter dans chaque environnement"
  }
}

run "mode_conformite_sur_decision" {
  command = plan

  variables {
    compliance_mode = true
  }

  assert {
    condition     = aws_backup_vault_lock_configuration.copy.changeable_for_days == 3
    error_message = "mode conformité : verrou irréversible après 3 jours"
  }
}

run "coffre_dans_un_compte_d_environnement_refuse" {
  command = plan

  variables {
    source_account_ids = ["333333333333"]
  }

  expect_failures = [aws_backup_vault.copy]
}

run "compte_mal_forme_refuse" {
  command = plan

  variables {
    source_account_ids = ["12345"]
  }

  expect_failures = [var.source_account_ids]
}

run "retention_incoherente_refusee" {
  command = plan

  variables {
    min_retention_days = 30
    max_retention_days = 7
  }

  expect_failures = [var.max_retention_days]
}
