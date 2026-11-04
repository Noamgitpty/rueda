#!/bin/sh
# Secrets de la PRÉPRODUCTION LOCALE (US-003, ADR-078) — service `secrets-init` de
# infra/local/compose.yaml. Joue le rôle du coffre de l'hébergeur : en préproduction et en
# production réelles, ces valeurs sont saisies par le fondateur dans le gestionnaire de secrets (la
# SEULE action manuelle d'une reconstruction, critère 2 d'US-003) et injectées par l'orchestrateur.
#
# Tire au hasard, au premier lancement seulement, un secret par fichier, dans un volume Docker par
# usage (jamais dans le dépôt, jamais affiché). `docker compose down -v` les supprime avec la base.
# Propriétaires : postgres = uid 999 ; node (image de production) = uid 1000, gid 1000.
set -eu

umask 077
for name in postgres migrator app_api app_worker app_anon rate_limit_key; do
  dir="/run/rueda-secrets/$name"
  file="$dir/value"
  if [ ! -s "$file" ]; then
    # 32 octets aléatoires en hexadécimal (64 caractères) : mot de passe ou clé HMAC (32 octets)
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$file.tmp"
    mv "$file.tmp" "$file"
    echo "secrets-init : secret tiré pour $name"
  else
    echo "secrets-init : secret existant conservé pour $name"
  fi
  if [ "$name" = postgres ]; then
    chown 999:1000 "$file" && chmod 0440 "$file"
  else
    chown 1000:1000 "$file" && chmod 0400 "$file"
  fi
done
