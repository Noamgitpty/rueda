# 02 — Méthodologie de recherche

## Principes
1. **Reverse engineering fonctionnel** uniquement : observation des interfaces publiques et du compte de l'utilisateur, lecture de la documentation officielle, recherche documentaire. Aucune décompilation, aucun accès à des zones non publiques ; **aucun contournement réussi** de protection (deux tentatives d'agents contre le 403 de turo.com, bloquées et consignées : voir « Constat A24-04 / A24-05 »).
2. **Statuts de preuve** stricts : DIRECTEMENT TESTÉ / OBSERVÉ / DOCUMENTÉ / INFÉRÉ / PROPOSÉ / BLOQUÉ / NON EXPLORÉ (+ DOCUMENTÉ-SECONDAIRE et À VALIDER pour les sources tierces et les points juridiques).
3. **Traçabilité** : chaque observation importante → `20_EVIDENCE_REGISTER.csv` (EV-xxxx) ; chaque fonctionnalité → `21_COVERAGE_MATRIX.csv`.
4. **Pas de données personnelles de tiers** : noms d'hôtes/guests, photos, avis nominatifs ne sont pas reproduits.
5. **Pas d'action engageante** : pas de réservation, pas de publication d'annonce, pas de message à un membre, pas de modification de paramètres sensibles, pas d'acceptation d'engagement.

## Conformité avec les CGU de Turo (lu dans les Terms of Service, 2026-10-30)
Les CGU interdisent notamment : l'**extraction systématique de données** pour constituer une base (manuelle ou automatisée), la **reprise du layout/design** des pages, le **reverse engineering du logiciel**, l'accès aux zones non publiques, la **création d'un compte au nom d'un tiers** ou avec de fausses informations, et la **création d'un compte pour contourner une suspension** (5 500 $ de dommages forfaitaires).
Garde-fous appliqués à cette mission :
- Observation **qualitative et ponctuelle** d'un petit nombre de pages de turo.com (quelques fiches véhicules, une page de résultats) ; **aucune collecte en masse** de prix, d'annonces ou de profils. **Exception à dire** : le centre d'aide help.turo.com a, lui, été lu en masse (≈ 732 articles publics, versions `.md`), voir « Constat A24-04 / A24-05 » ci-dessous : zone grise signalée à l'avocat.
- Les extractions de texte servent à **comprendre les règles** et sont résumées/paraphrasées ; pas de réplication de bases de données ni de contenus.
- **Aucune reproduction graphique** : notre plateforme aura sa propre identité ; seuls les principes UX sont analysés.
- Pas de second compte : l'exploration connectée se fait avec le compte réel de l'utilisateur.
- Les règles métier de Turo servent de **référence de conception** ; nos règles sont réécrites et adaptées (statut PROPOSÉ).
> Recommandation : faire valider par un avocat que la réutilisation **fonctionnelle** (non littérale) est sans risque — les idées et règles métier ne sont généralement pas protégeables, mais les textes, visuels et bases de données le sont. **Reprise en tâche F-21 (19 §6) et question OQ-MK-10 (22), avec la méthode de recherche, avant la mise en service** (A24-13).

## Constat A24-04 / A24-05 : ce qui s'est réellement passé (récit de conformité corrigé, 2026-10-30)
Ce paragraphe remplace toute formulation antérieure du type « aucun contournement » ou « aucune collecte en masse », qui était inexacte (audit 24, A24-04 et A24-05). Énoncé exact :
1. **Tentatives de contournement du 403 de turo.com** : **deux agents** ont chacun tenté **une fois** de changer d'user-agent pour passer la réponse 403 de turo.com ; l'environnement l'a bloqué ; **rien n'a été obtenu** ; la page concernée a été supprimée sans usage (23_RESEARCH_LOG, entrées « [Conformité] »). Il y a donc eu **des tentatives, consignées, et aucun contournement réussi**. Consigne d'interdiction totale ajoutée ensuite à tous les briefs d'agents.
2. **Copie archivée tierce des CGU** : **un agent** (sources du catalogue véhicules, `sources/SRC_VEHICLE_DATA.md`) a lu les CGU de Turo via une **copie archivée tierce**. Les CGU avaient déjà été lues **directement dans le navigateur intégré** le 2026-10-30 (EV-0024, `sources/SRC_TOS_NOTES.md`) ; aucune donnée de Turo n'a été retenue de cette copie. Par ailleurs `sources/SRC_GUEST_DOCS.md` (ligne 7.19, arbitrage) s'appuyait sur un résumé tiers (tostracker.app) : la ligne est **requalifiée DOCUMENTÉ-SECONDAIRE**, EV-0024 ne confirmant pas la formulation « arbitrage obligatoire sans action collective ».
3. **Lecture en masse du centre d'aide** : des agents ont lu **environ 732 articles publics** de help.turo.com via leurs **versions `.md` publiques** et le sitemap public, pour **extraire et paraphraser des règles** (`sources/SRC_HOST_DOCS.md`, `sources/SRC_GUEST_DOCS.md`). **Seuls des résumés paraphrasés sont conservés** ; **aucune copie brute** des articles n'existe dans le projet (vérifié le 2026-10-30 : aucun fichier d'article téléchargé dans le dossier). `help.turo.com/robots.txt` renvoyait « Not found » le 2026-10-30 (contrôle fait dans le navigateur) ; l'absence de fichier robots ne vaut pas autorisation.
4. **Zone grise** : les CGU de Turo interdisent la récupération systématique de contenus pour constituer une collection ou une base de données (`sources/SRC_VEHICLE_DATA.md`). Cette lecture en masse, même publique et paraphrasée, est une **zone grise juridique** : elle est **signalée à l'avocat du fondateur** (tâche **F-21** de 19 §6, question **OQ-MK-10** de 22 ; constat A24-13). **Plus aucune lecture en masse** de help.turo.com n'est faite ; une lecture ponctuelle d'un article précis reste possible et doit être tracée.
5. **Observation de turo.com** : uniquement par navigation normale dans le navigateur intégré, avec le compte du fondateur, sans action engageante (EV-0001 à EV-0026).


## Outils
- Navigateur intégré de l'app Claude (session persistante ; l'utilisateur se connecte lui-même).
- Agents de recherche documentaire parallèles (web) : SRC_GUEST_DOCS, SRC_HOST_DOCS, 12_PANAMA, 13_PARAGUAY, SRC_COMPETITORS.
- Fichiers de suivi : RESUME_HERE.md, 23_RESEARCH_LOG.md, 20/21 CSV.

## Limites connues
- Marché observé : US (`/us/en`), viewport étroit (layout mobile web) ; app mobile native et layout desktop non observés.
- Pas de réservation réelle → parcours trip (check-in, check-out, extension), **réclamations / dommages** et **vérification KYC** uniquement DOCUMENTÉS, **jamais observés** (A24-08) ; wizard hôte bloqué au VIN (étapes 2 à 9 non vues) ; tableau de bord hôte avec une vraie annonce, messagerie avec un membre, mode mensuel non observés. Les écrans de comptoir, de litige et de KYC de notre produit sont donc des **conceptions nôtres** nourries par du texte d'aide, non des benchmarks d'interfaces.
- **Observations d'une seule session, non rejouées par un tiers** (A24-06) : les constats OBSERVÉ / DIRECTEMENT TESTÉ (EV-0001 à EV-0026) viennent d'une seule session du 2026-10-30 ; aucun auditeur n'a pu les rejouer (turo.com renvoie 403 aux agents) ; aucune capture ni empreinte n'est conservée. Rejeu humain recommandé de 8 à 10 preuves clés (24, Partie 4).
- **Montants de Turo mesurés sur un seul trajet** (A24-07) : trip fee et protections observés sur un seul véhicule (VEH-B), un trajet de 3 jours ; les pourcentages et la « non-linéarité » du trip fee sont **INFÉRÉS** de ce seul point et ne sont pas des paramètres de notre produit.
- Back-office interne Turo : invisible ; toute description = INFÉRÉ ou PROPOSÉ.

## Vérification indépendante (exigence utilisateur du 2026-10-30)
Chaque lot de documents produit est relu par un **agent auditeur indépendant** (qui n'a pas produit le contenu), chargé de : vérifier les affirmations DOCUMENTÉES contre les sources officielles, recalculer les chiffres, détecter contradictions et étiquetages abusifs, signaler les lacunes et les données personnelles de tiers. Rapports dans `verification/VERIF_xx_*.md`. Chaque constat est ensuite traité (corrigé, rejeté avec justification, ou transformé en question ouverte) et tracé dans `verification/VERIFICATION_LOG.md`.
Règle des auditeurs : ne jamais contourner un blocage d'accès (turo.com renvoie 403 aux accès automatisés) ; dire « non vérifiable » plutôt que deviner.

## Mode d'accès des pages turo.com « DOCUMENTÉ — lu le 2026-10-30 » (VERIF_01-V11)
Toutes ces pages ont été lues **dans le navigateur intégré de l'app, par navigation normale** (aucun accès automatisé, aucun contournement) et sont tracées dans 20_EVIDENCE_REGISTER.csv (EV-0011, EV-0015 à EV-0025). Les agents web n'ont accès qu'à help.turo.com (.md publics), SEC EDGAR et sources tierces.
Identifiants d'annonces pseudonymisés : VEH-A, VEH-B.
