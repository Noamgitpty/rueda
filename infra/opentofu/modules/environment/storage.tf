# Deux compartiments S3 (17 §6.1, NN10), chiffrés par la clé « files », versionnés, sans accès public,
# TLS exigé :
#   assets   : photos d'annonces et actifs de marque (servis plus tard par un CDN, US-036) ;
#   evidence : preuves (photos de remise et de retour, PDF de contrats) et journal des déploiements
#              (`ops/deployments/`), avec verrouillage d'objet (GOVERNANCE) par défaut.
# Port de l'application : `FileStore` (US-009, US-020) ; adaptateur S3 réel : US-036.
locals {
  buckets = {
    assets   = "${local.name}-assets-${var.bucket_suffix}"
    evidence = "${local.name}-evidence-${var.bucket_suffix}"
  }
}

resource "aws_s3_bucket" "this" {
  for_each            = local.buckets
  bucket              = each.value
  object_lock_enabled = each.key == "evidence"
  # Préproduction : détruite et recréée depuis le dépôt (critère 2) ; production : jamais.
  force_destroy = !var.deletion_protection
  tags          = merge(local.tags, { Purpose = each.key })
}

resource "aws_s3_bucket_ownership_controls" "this" {
  for_each = aws_s3_bucket.this
  bucket   = each.value.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "this" {
  for_each                = aws_s3_bucket.this
  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "this" {
  for_each = aws_s3_bucket.this
  bucket   = each.value.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  for_each = aws_s3_bucket.this
  bucket   = each.value.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.files.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_object_lock_configuration" "evidence" {
  bucket = aws_s3_bucket.this["evidence"].id
  rule {
    default_retention {
      mode = "GOVERNANCE"
      days = var.evidence_lock_days
    }
  }
  depends_on = [aws_s3_bucket_versioning.this]
}

resource "aws_s3_bucket_policy" "tls_only" {
  for_each = aws_s3_bucket.this
  bucket   = each.value.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "TlsOnly"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [each.value.arn, "${each.value.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
  depends_on = [aws_s3_bucket_public_access_block.this]
}
