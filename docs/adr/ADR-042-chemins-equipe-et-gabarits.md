# ADR-042 — Chemins des artefacts d'équipe, gabarits et identité des agents

- **Statut** : DÉCIDÉ (orchestrateur, 2026-10-31) ; revu par l'agent architecture avec US-029. À reporter dans 17 §8.1.
- **Story** : US-029. **Sources** : handoff §4.4, §4.9, §4.10 (PROPOSÉ (handoff)) ; 19 §1.5, §1.9.

## Contexte

Les agents n'ont pas de mémoire d'une session à l'autre. Le seul canal entre eux est le dépôt. Le handoff propose des chemins et des gabarits, que l'orchestrateur doit figer par un ADR dès la première session. Le compte machine des agents (F-01, option B) n'existe pas encore.

## Décision

1. Les chemins du handoff §4.4 sont adoptés **tels quels**, sous `docs/team/` :
   - `RESUME_HERE.md`, `OPERATING_RULES.md`, `BOARD.md`, `DECISIONS.md`, `RISKS.md`, `QUESTIONS.md` ;
   - `handoffs/US-xxx.md`, `reviews/US-xxx/<rôle>-<date>.md`, `health/AAAA-MM-JJ-<session>.md`, `sessions/AAAA-MM-JJ-<agent>.md` ;
   - `gates/<lot>/{premortem,redteam,postmortem}.md`, `incidents/`, `weekly/AAAA-Wnn.md`, `roles/<rôle>.md`.

   Les ADR du dépôt vont dans `docs/adr/ADR-NNN-<titre>.md`. Leur numérotation **prolonge** celle de 17 §8.1 (ADR-001 à ADR-040). Les nouveaux ADR commencent donc à ADR-041.

2. Les gabarits du handoff §4.4 sont copiés dans les fichiers ci-dessus. Les gabarits de revue et de passation se trouvent dans `reviews/TEMPLATE.md` et `handoffs/TEMPLATE.md`.
3. `CLAUDE.md` à la racine (≤ 2 pages) et `docs/team/roles/<rôle>.md` (13 rôles) sont les consignes lues par chaque agent. Une consigne de lancement d'agent cite ces fichiers au lieu de les recopier.
4. Contrôle « revues présentes, relecteur ≠ auteur » : `scripts/team/check-reviews.mjs`, testé par `node --test scripts/team/`. Il est branché en CI par US-002 et rendu obligatoire par US-050.
5. **Identité (F-01, option A, provisoire)** : les commits des agents sont faits sous l'identité git du fondateur. Chaque commit porte les pieds `Agent-Role` et `Agent-Model`. Aucune fusion vers `main` sans l'accord explicite du fondateur. La première fusion (US-001 avec US-029) est l'exception EXC-001. Elle est revue par un vérificateur indépendant et approuvée par le fondateur dans la demande de fusion.

## Conséquences

- Une session neuve reprend le travail en lisant `CLAUDE.md`, `docs/team/RESUME_HERE.md`, `BOARD.md` et les passations.
- Tant que l'option A reste en place, GitHub ne peut pas démontrer que le relecteur diffère de l'auteur (risque L0-PM-07). Ce sont les rapports versionnés et le contrôle de script qui le prouvent.
- Passer à l'option B (compte machine) ne change aucun chemin.

## Alternatives écartées

- Un outil de suivi externe (Issues, Projects) comme source de vérité : écarté, car aucune information de projet ne doit vivre hors du dépôt (handoff §11).
- Une numérotation d'ADR propre au dépôt, repartant de 1 : écartée, car elle entrerait en collision avec les ADR de 17.
