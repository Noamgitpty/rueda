#!/bin/sh
# Secrets de la pile de DÉVELOPPEMENT LOCAL (US-035, ADR-070) — service `secrets-init` de compose.yaml.
#
# Tire au hasard, au PREMIER lancement seulement, le mot de passe de chaque rôle PostgreSQL de la
# pile locale, dans un volume Docker par rôle (jamais dans le dépôt, jamais affiché, jamais dans
# une variable de compose). Un fichier existant est conservé : relancer la pile ne change rien.
# `docker compose down -v` supprime les volumes, donc les secrets et la base.
#
# Propriétaires (images officielles) : postgres = uid 999 ; node = uid 1000, gid 1000.
# - postgres/password : 999:1000, 0440 (lu par PostgreSQL et par db-setup / tests, groupe node) ;
# - <rôle>/password   : 1000:1000, 0400 (lu par les services node qui montent ce seul volume).
set -eu

umask 077
for role in postgres migrator app_api app_worker app_anon; do
  dir="/run/rueda-secrets/$role"
  file="$dir/password"
  if [ ! -s "$file" ]; then
    # 32 octets aléatoires en hexadécimal (64 caractères, aucun caractère spécial)
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$file.tmp"
    mv "$file.tmp" "$file"
    echo "secrets-init : mot de passe tiré pour $role"
  else
    echo "secrets-init : mot de passe existant conservé pour $role"
  fi
  if [ "$role" = postgres ]; then
    chown 999:1000 "$file" && chmod 0440 "$file"
  else
    chown 1000:1000 "$file" && chmod 0400 "$file"
  fi
done
