lot: L4
module: Identité et accès

- Sécurité : une session ne s'ouvre plus que sur une preuve signée (HMAC) par l'API sous une clé que la base garde hors de portée des rôles applicatifs ; du SQL arbitraire sous `app_api` ne peut plus ouvrir une session pour un compte de son choix (F-RLS-03 fermé, EXC-003) (US-410)
- Sécurité : la preuve est fraîche (60 s, horloge de la base), à usage unique (rejeu refusé, même concurrent) et liée à la session, au compte, au jeton et à la durée ; sans clé installée, aucune session ne s'ouvre (fail-closed) (US-410)
- Ajouté : provisionnement et rotation sans coupure de la clé (`RUEDA_SESSION_OPEN_KEY`, `cli.ts session-open-key INSTALL|STAGE|PROMOTE|ABORT`, deux clés acceptées 24 h au plus), répétés par le job de rotation des secrets (US-410)
