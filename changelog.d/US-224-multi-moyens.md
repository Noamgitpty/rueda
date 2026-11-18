lot: L2
module: Règlement et finance

- Ajouté : un trip payé en plusieurs fois est remboursé sur chacun de ses moyens d'origine, du montant que donne la règle d'imputation (la part retenue est prise d'abord sur les crédits et les moyens sans remboursement partiel, la carte est remboursée en priorité), chaque remboursement portant le montant exact de chaque jambe, jamais un prorata (US-224)
- Ajouté : après un refus confirmé du prestataire, le remboursement attend un autre moyen de remboursement (nouvelle tentative numérotée) ; en bêta, aucun autre moyen n'est ouvert : l'équipe s'en occupe et le voyageur voit « en cours de vérification » (US-224)
- Sécurité : la base refuse tout remboursement d'un moyen au-delà de ce qu'il a payé (remboursements en échec compris), un remboursement par carte sur un autre moyen, et ne recrée jamais de crédit tant que la détention de fonds est fermée ; une annulation qui l'exigerait est garée pour FINANCE, rien n'est écrit (US-224)
