# Incident 2026-11-14 — coupure de courant, dépôt local corrompu

- **Quoi** : l'ordinateur s'est éteint brutalement. Des fichiers ont été remplis d'octets nuls :
  - `.git/config` ;
  - deux index : celui du dépôt principal et celui du worktree `rev-149` ;
  - 614 fichiers suivis de `rev-149` ;
  - un fichier non commité de la red team : `rt-l1-12-a03-a10.test.ts`.
- **Effet** :
  - aucun sur GitHub : `main`, les branches et les PR sont intacts ;
  - `git fsck` ne signale aucune erreur, et aucun commit n'est perdu ;
  - seul le fichier non commité de la red team est à réécrire.
- **Réparation** :
  - configuration minimale réécrite : format du dépôt, remote `origin`, identité du compte bot ;
  - index reconstruits par `git reset` ;
  - fichiers suivis restaurés par `git checkout` ;
  - fichiers corrompus gardés dans le scratchpad de l'orchestrateur.
- **Mesure** :
  - les agents commitent et poussent après chaque fichier ;
  - maintien en éveil redemandé.
