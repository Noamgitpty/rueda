# Notes de version — Kmino

Ce document s'adresse au **fondateur**. Il dit, sans jargon, ce que chaque étape apporte au produit. Le détail technique, PR par PR, est dans [`CHANGELOG.md`](../CHANGELOG.md).

**Règle (US-040)** : avant chaque mise en production, l'orchestrateur ajoute ici une section `## x.y.z — date`, en français. Sans elle, la commande de versement du CHANGELOG refuse de s'exécuter. Chaque section répond à trois questions : qu'est-ce qui change pour un voyageur ou un hôte ? qu'est-ce qui est plus sûr ? qu'est-ce que le fondateur doit vérifier ou décider ?

## Où en est le produit (non publié) — point au 4 novembre 2026

**Rien n'est encore en production.** Aucun voyageur ni aucun hôte réel ne peut utiliser Kmino : les interrupteurs de mise en service du Panama et du Paraguay sont fermés, aucun paiement réel n'est branché (les prestataires sont simulés, « FAKE ») et aucun assureur n'est sous contrat. Ce qui suit a été construit pendant le **lot 0**, le socle, entre le 1er et le 4 novembre 2026 (74 demandes de fusion).

### Ce que le produit sait déjà faire, sur un poste de test

- **Réserver une voiture sans double réservation.** Deux voyageurs qui cliquent au même moment sur la même voiture ne peuvent pas l'obtenir tous les deux : la base de données l'interdit elle-même, et des milliers de scénarios de concurrence le vérifient à chaque modification.
- **Calculer l'argent au centime près.** Le prix du voyage, les frais de service, la part de l'hôte, la part de l'assureur et les taxes sont calculés par un moteur unique. Chaque montant est comparé à un second calcul, écrit séparément à partir des règles métier. Les dollars (Panama) et les guaranis sans décimale (Paraguay) sont traités de la même façon.
- **Gérer les annulations** selon les règles bêta, avec un historique de chaque version du calcul.
- **Simuler les paiements** auprès d'une place de marché de paiement factice, qui sait aussi se comporter de façon hostile (pannes, doublons, retards) pour tester les cas difficiles.
- **Créer un compte, se connecter, recevoir des e-mails et des SMS** (simulés), avec des protections contre les abus : codes à usage unique limités, recherche publique bridée.
- **Afficher le site en espagnol, anglais, français et portugais du Brésil**, sur mobile d'abord, installable comme une application (PWA).
- **Montrer les écrans clés** dans un prototype cliquable : le parcours du voyageur et l'espace de l'hôte.

### Ce qui protège les clients et l'entreprise

- Chaque personne ne voit que ses propres données : un hôte ne voit pas les voyageurs d'un autre hôte, un pays ne voit pas l'autre. Les données du voyageur montrées à l'hôte sont réduites au strict nécessaire.
- Le personnel interne se connecte avec un second facteur, et chacune de ses actions est inscrite dans un journal infalsifiable.
- Les sauvegardes sont copiées hors du compte principal, et chaque accès à des données personnelles est journalisé.

### Comment l'équipe travaille

- Aucune modification n'entre dans le produit sans revues indépendantes. Les revues d'argent et de sécurité sont faites par un autre modèle que l'auteur.
- La spécification a été entièrement révisée pour le modèle **de particulier à particulier**, comme Turo : aucune agence ni loueur professionnel.
- **Nouveau (US-040)** : chaque modification du produit doit désormais être consignée dans le CHANGELOG, sinon elle est refusée automatiquement. Ce document est tenu à chaque mise en production.

### Ce qui reste à décider ou à faire par le fondateur

- Choisir le premier pays, le prestataire de paiement réel et l'assureur partenaire (lot C). D'ici là, tout reste simulé.
- Les mises en service par pays ne s'ouvrent que sur décision écrite du fondateur, par la commande à deux personnes.
