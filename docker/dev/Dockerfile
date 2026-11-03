# Image de DÉVELOPPEMENT LOCAL (US-035, ADR-070) : sources, dépendances de développement (dont
# @rueda/fake-adapters) et API compilée. Utilisée seulement par compose.yaml. JAMAIS une image de
# préproduction ou de production : celle-ci (US-003) n'embarque que les dépendances de production,
# sans FAKE (C19, US-020 critère 2).
FROM node:26.13.0-slim

# pnpm figé (packageManager de package.json) ; aucun script d'installation.
RUN npm install --global --ignore-scripts --no-audit --no-fund pnpm@10.34.9 \
  && mkdir /repo && chown node:node /repo

USER node
WORKDIR /repo

# Tout le contexte (filtré par .dockerignore) puis installation figée : robuste à l'ajout d'un
# paquet de l'espace de travail ; le cache de pnpm reste dans l'image.
COPY --chown=node:node . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @rueda/api build

# Pile locale : development explicite (les FAKE et la garde C19 l'exigent ; absent = production).
ENV RUEDA_ENV=development
