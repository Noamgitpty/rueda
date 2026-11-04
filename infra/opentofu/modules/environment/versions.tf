# Module « environnement » (US-003, ADR-078) : UN environnement complet (préproduction ou
# production) sur AWS, région unique (ADR-006 PROPOSÉ, OQ-MK-09). Décrit en code, jamais appliqué
# par un agent : le fondateur l'applique quand il a choisi l'hébergeur (docs/team/QUESTIONS.md).
#
# Portabilité (ADR-037, US-036) : rien de ce module n'entre dans le code de l'application. Chaque
# service du fournisseur est derrière un port (base PostgreSQL standard, stockage objet compatible S3,
# coffre lu par l'orchestrateur et passé en variables d'environnement, journaux sur la sortie
# standard). Changer d'hébergeur = réécrire ce module, pas l'application.
terraform {
  required_version = ">= 1.13.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "= 6.66.0"
    }
  }
}
