#!/bin/sh
# Gestes de ROTATION des secrets de la PRÉPRODUCTION LOCALE (US-051, ADR-082) — service
# `secrets-rotate` de infra/local/compose.yaml (profil `rotation`). Joue le rôle des étiquettes de
# version du coffre de l'hébergeur (AWSPENDING / AWSCURRENT / AWSPREVIOUS) : runbook
# docs/ops/SECRET_ROTATION.md. Aucune valeur n'est affichée ; seuls les noms et les issues le sont.
#
#   stage db               tire une valeur SUIVANTE (`next`) pour migrator, app_api, app_worker, app_anon
#   promote db             la suivante devient courante (`value`) ; l'ancienne est gardée (`previous`)
#                          le seul temps du contrôle `verify db`
#   verify db              pour chaque rôle : ancienne valeur REFUSÉE par la base, courante acceptée ;
#                          puis l'ancienne est effacée
#   stage rate-limit-key   nouvelle clé courante ; l'ancienne devient `previous` (comptée en double)
#   retire rate-limit-key  efface `previous` (après la plus longue fenêtre de comptage, 24 h)
#   stage mfa              tire une clé de preuve MFA SUIVANTE (`next`)
#   promote mfa            la suivante devient courante ; l'ancienne est effacée
#
# Propriétaires : node (image de production) = uid 1000, gid 1000 ; fichiers 0400.
set -eu

umask 077
ROLES='migrator app_api app_worker app_anon'
dir() { printf '/run/rueda-secrets/%s' "$1"; }

draw() {
  # 32 octets aléatoires en hexadécimal (64 caractères), écrits de façon atomique
  head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' >"$1.tmp"
  chown 1000:1000 "$1.tmp"
  chmod 0400 "$1.tmp"
  mv "$1.tmp" "$1"
}

stage_next() {
  if [ -s "$(dir "$1")/next" ]; then
    echo "secrets-rotate : $1 : valeur suivante déjà posée (rotation en cours)"
  else
    draw "$(dir "$1")/next"
    echo "secrets-rotate : $1 : valeur suivante tirée"
  fi
}

promote_next() {
  d="$(dir "$1")"
  [ -s "$d/next" ] || {
    echo "secrets-rotate : $1 : aucune valeur suivante à promouvoir" >&2
    exit 1
  }
  if [ "${2:-}" = keep ]; then mv "$d/value" "$d/previous"; else rm -f "$d/value"; fi
  mv "$d/next" "$d/value"
  echo "secrets-rotate : $1 : valeur suivante promue"
}

login() {
  # $1 rôle, $2 fichier du mot de passe ; code 0 si la connexion est acceptée
  PGPASSWORD="$(cat "$2")" psql -h "${PGHOST:-postgres}" -p "${PGPORT:-5432}" -U "$1" \
    -d "${PGDATABASE:-rueda}" -w -Atc 'SELECT 1' >/dev/null 2>&1
}

case "${1:-} ${2:-}" in
  'stage db')
    for r in $ROLES; do stage_next "$r"; done
    ;;
  'promote db')
    for r in $ROLES; do promote_next "$r" keep; done
    ;;
  'verify db')
    for r in $ROLES; do
      d="$(dir "$r")"
      [ -s "$d/previous" ] || {
        echo "secrets-rotate : $r : aucune ancienne valeur à éprouver" >&2
        exit 1
      }
      if login "$r" "$d/previous"; then
        echo "secrets-rotate : ÉCHEC : $r : l'ancienne valeur est encore acceptée" >&2
        exit 1
      fi
      login "$r" "$d/value" || {
        echo "secrets-rotate : ÉCHEC : $r : la valeur courante est refusée" >&2
        exit 1
      }
      rm -f "$d/previous"
      echo "secrets-rotate : $r : ancienne valeur refusée, courante acceptée ; ancienne effacée"
    done
    ;;
  'stage rate-limit-key')
    d="$(dir rate_limit_key)"
    [ ! -s "$d/previous" ] || {
      echo "secrets-rotate : rate_limit_key : rotation déjà en cours (previous présente)" >&2
      exit 1
    }
    mv "$d/value" "$d/previous"
    draw "$d/value"
    echo "secrets-rotate : rate_limit_key : nouvelle clé courante, l'ancienne comptée en double"
    ;;
  'retire rate-limit-key')
    rm -f "$(dir rate_limit_key)/previous"
    echo "secrets-rotate : rate_limit_key : ancienne clé retirée"
    ;;
  'stage mfa')
    stage_next staff_mfa_proof_key
    ;;
  'promote mfa')
    promote_next staff_mfa_proof_key
    ;;
  *)
    echo 'usage : rotate-secrets.sh stage|promote|verify db | stage|retire rate-limit-key | stage|promote mfa' >&2
    exit 2
    ;;
esac
