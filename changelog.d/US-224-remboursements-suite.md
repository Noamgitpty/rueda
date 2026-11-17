lot: L2
module: Paiement

- Ajouté : chaque remboursement d'un règlement est une instance suivie (planifiée, envoyée, remplacée) ; Kmino seul l'ordonne au PSP, avec le montant de chaque jambe ; un rejeu ne crée ni second remboursement ni seconde avance ; une nouvelle version du règlement remplace les remboursements pas encore envoyés (US-224)
- Ajouté : quand la part de l'hôte a déjà été versée, Kmino avance cette part au voyageur sans réduire son remboursement ; l'avance devient une créance de l'hôte et n'est accordée qu'après une décision FINANCE prise par deux personnes distinctes (US-224)
- Modifié : le crédit cash et le virement ne sont pas proposés comme moyen de remboursement en bêta ; le remboursement passe par le moyen de paiement d'origine (US-224)
- Modifié : un versement à l'hôte est borné dès son enregistrement par ce que sa jambe a encore, remboursements en cours compris, et par la part retenue par le règlement (US-224)

lot: L2
module: Console

- Sécurité : l'approbation d'une décision FINANCE rejuge le lien du demandeur avec le compte concerné (titulaire, co-hôte, compte lié) ; refus unifié `STAFF_SELF_FORBIDDEN` (US-224)
