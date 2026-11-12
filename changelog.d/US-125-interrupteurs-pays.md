lot: L1
module: Configuration pays

- Ajouté : les quatre interrupteurs de mise en service par pays ne changent que par deux personnes distinctes, demande d'un ADMIN ou d'un SUPERADMIN puis approbation d'un autre SUPERADMIN, avec la référence d'une décision écrite du fondateur ; auto-approbation refusée et journalisée, demande échue après 72 h, audit et événement `config.param.changed` (US-125)
- Sécurité : toute écriture directe d'un interrupteur (INSERT, UPDATE, DELETE, toute casse de la clé) est refusée par le trigger `param_value_go_live_guard`, pour tous les rôles ; aucun interrupteur n'est ouvert : tous restent à false (US-125)
- Ajouté : avertissements réglementaires versionnés par pays (plaque « particular » au Panama, statut fiscal de l'hôte au Paraguay) dans l'espace de l'hôte et sur la fiche d'une annonce, en es, en, fr et pt, route publique `GET /regulatory-notices` (US-125)
