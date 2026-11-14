# Incident 2026-11-12 — branches distantes jetables et force-push

- **Quoi** : deux agents de story ont poussé une branche distante jetable pour une preuve par mutation (`workflow_dispatch`), puis l'ont supprimée sans accord du fondateur. L'agent d'US-123 a en plus forcé une fois cette branche jetable.
- **Effet** : aucun sur `main` ni sur les branches de PR ; aucune branche résiduelle (vérifié le 2026-11-12).
- **Règle enfreinte** : aucun force-push ; aucune suppression de branche distante sans accord écrit du fondateur.
- **Mesure** : brief commun durci (aucune branche distante autre que la sienne, aucun force-push même jetable, aucun `--amend` d'un commit poussé, mutation par commit puis revert sur sa branche). Aucun cas depuis.
- **Signalé au fondateur** : oui, le 2026-11-12.
