lot: L3
module: No-show et refus du véhicule

- Ajouté : l'hôte déclare que le voyageur ne s'est pas présenté, à partir de la fin de la grâce du pays (60 min) et jusqu'à 72 h après le début, à l'heure du serveur ; avec son message et 15 min d'attente tracés dans les messages du trip, il garde sa part de la retenue ; sans eux, le voyageur reçoit le même remboursement et toute la retenue revient à Kmino (US-307)
- Ajouté : le voyageur signale que l’hôte ne s’est pas présenté 30 min après le début, preuve d’attente exigée dans les messages du trip ; l’hôte est prévenu et l’ops valide (remboursement intégral, pénalité de l’hôte retenue sur ses gains) ou rejette le signalement (US-307)
- Ajouté : la console déclare un no-show ou valide un refus du véhicule (propreté, sécurité, permis non conforme, identité non vérifiée, autre conducteur), à saisie fermée ; refus pour propreté ou sécurité : remboursement intégral et pénalité de l'hôte ; refus pour permis : no-show du voyageur avec pièce, annulation de l'hôte sans (US-307)
- Ajouté : écrans de l'hôte et du voyageur en quatre langues, avec un lien depuis le détail du trip quand la remise est ouverte (US-307)
- Modifié : moteur de règlement cxl-beta/2 (le refus du véhicule validé entre dans le sous-ensemble bêta ; montants inchangés pour les autres motifs) (US-307)
- Sécurité : une réaffectation de jambes exige la capacité de réajustement du PSP validée, sinon revue FINANCE ; aucune déclaration ne se rejoue ; aucune heure ni aucun montant n'est reçu de l'appareil (US-307)
- Un signalement du no-show de l'hôte ne reste jamais sans issue : la validation de l'ops rejoue les obstacles d'état et refuse net (`NO_SHOW_REPORT_INVALIDATED`) ; un signalement en attente depuis `no_show_report_review_alert_minutes` (PROPOSÉ 120 min) ou devenu inapplicable lève une fois l'alerte `TRIP_NO_SHOW_REPORT_UNRESOLVED` ; « Corriger » garde la saisie de la console (ADR-191).
