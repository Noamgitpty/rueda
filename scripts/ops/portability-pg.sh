#!/usr/bin/env bash
# Base de l'EXPORT DE PORTABILITÉ (US-036, ADR-120 ; runbook docs/ops/PORTABILITY.md).
#
#   bash scripts/ops/portability-pg.sh dump    <dossier-export>
#   bash scripts/ops/portability-pg.sh restore <dossier-export> <pre-data|data|post-data>
#
# `dump` : copie LOGIQUE de la base (pg_dump, format custom, lisible par n'importe quel
# PostgreSQL 16 : aucun format propre à un hébergeur), SANS les données de
# core.audit_subject_key (les clés de sujet sortent par le séquestre du fondateur, jamais dans la
# copie de la base) ; contrôle que la copie n'en contient aucune ligne ; somme SHA-256.
# `restore` : vérifie la somme, puis restaure UNE section dans la base visée (PGHOST, PGPORT,
# PGDATABASE). L'ordre est imposé par le runbook : pre-data, data, import des clés, post-data
# (les triggers de garde et les clés étrangères arrivent avec post-data).
#
# Variables : PGHOST, PGPORT, PGDATABASE, RUEDA_DB_ADMIN_USER, RUEDA_DB_ADMIN_PASSWORD (jamais
# affiché ; passé aux outils par PGPASSWORD) ; PGSSLMODE (facultatif) ; RUEDA_PG_CLIENT
# (`docker`, défaut : outils de l'image RUEDA_PG_CLIENT_IMAGE, défaut postgres:16, réseau de
# l'hôte ; `local` : pg_dump / pg_restore du poste, version 16 ou plus).
set -euo pipefail

mode="${1:?usage : portability-pg.sh dump|restore <dossier> [section]}"
dir="$(cd "${2:?dossier d'export attendu}" && pwd)"
: "${PGHOST:?PGHOST absente}" "${PGDATABASE:?PGDATABASE absente}"
: "${RUEDA_DB_ADMIN_USER:?RUEDA_DB_ADMIN_USER absente}"
: "${RUEDA_DB_ADMIN_PASSWORD:?RUEDA_DB_ADMIN_PASSWORD absente}"
port="${PGPORT:-5432}"
client="${RUEDA_PG_CLIENT:-docker}"
image="${RUEDA_PG_CLIENT_IMAGE:-postgres:16}"
export PGPASSWORD="$RUEDA_DB_ADMIN_PASSWORD"

say() { printf '[portabilite] %s\n' "$*"; }

# Outil PostgreSQL : chemins de l'export vus comme /export dans le conteneur.
pgtool() {
  local tool="$1"
  shift
  case "$client" in
    local) "$tool" "${@//\/export/$dir}" ;;
    docker)
      docker run --rm --network host --user "$(id -u):$(id -g)" -v "$dir:/export" \
        -e PGPASSWORD -e PGSSLMODE "$image" "$tool" "$@"
      ;;
    *)
      echo "RUEDA_PG_CLIENT inconnu : $client (docker ou local)" >&2
      return 2
      ;;
  esac
}

conn=(-h "$PGHOST" -p "$port" -U "$RUEDA_DB_ADMIN_USER" -d "$PGDATABASE" --no-password)

case "$mode" in
  dump)
    [ ! -e "$dir/base.dump" ] || {
      echo "$dir/base.dump existe déjà : un export ne s'écrase pas" >&2
      exit 1
    }
    pgtool pg_dump "${conn[@]}" --format=custom --compress=6 \
      --exclude-table-data=core.audit_subject_key --file=/export/base.dump
    chmod 600 "$dir/base.dump"
    # contrôle fail-closed : aucune donnée de clé de sujet dans la copie de la base
    if pgtool pg_restore --list /export/base.dump | grep -E 'TABLE DATA core audit_subject_key' >/dev/null; then
      echo "la copie de la base contient core.audit_subject_key : export refusé" >&2
      rm -f "$dir/base.dump"
      exit 1
    fi
    (cd "$dir" && sha256sum base.dump >base.dump.sha256 && chmod 600 base.dump.sha256)
    say "base exportée ($(wc -c <"$dir/base.dump") octets, sans données de clés de sujet)"
    ;;
  restore)
    section="${3:?section attendue : pre-data, data ou post-data}"
    case "$section" in pre-data | data | post-data) ;; *)
      echo "section inconnue : $section" >&2
      exit 2
      ;;
    esac
    (cd "$dir" && sha256sum --check --quiet base.dump.sha256)
    pgtool pg_restore "${conn[@]}" --section="$section" --exit-on-error /export/base.dump
    say "section $section restaurée"
    ;;
  *)
    echo "mode inconnu : $mode (dump ou restore)" >&2
    exit 2
    ;;
esac
