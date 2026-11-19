lot: L2
module: Configuration pays

- Ajouté : changement d'une valeur datée de paramètre pays par une commande revue à deux personnes distinctes (demande, approbation, annulation), avec motif, décision écrite du fondateur, événement `config.param.changed` et journal, dans une seule transaction (US-535)
- Ajouté : validation de la valeur (type, devise du pays, bornes par clé et par pays, absentes = refus d'une clé numérique ; clé JSON refusée) ; jamais rétroactive ; la version précédente se ferme à la date d'effet, un devis figé garde l'ancienne valeur (US-535)
- Sécurité : les interrupteurs de mise en service sont refusés par cette commande et restent sous la procédure de US-125 ; demandeur, seconde session et personne liée ne peuvent pas approuver ; aucun droit d'écriture des rôles applicatifs ; aucune valeur réelle changée (US-535)
