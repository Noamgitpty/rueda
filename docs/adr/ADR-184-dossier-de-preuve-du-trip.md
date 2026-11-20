# ADR-184 — Dossier de preuve d'un trip : manifeste scellé par la base, archive du travailleur, export réservé à l'ops

- **Statut** : PROPOSÉ (US-308, agent de story, rôle back-end, claude-opus-5-5, 2026-11-19). Revues exigées : celles de `node scripts/ci/check-story-reviews.mjs` (code, architecture, sécurité, qa) ; RLS / rôles et `SECURITY DEFINER` sur un autre modèle que l'auteur.
- **Complète** : ADR-051 (magasin de preuves, `file_asset`, empreinte), ADR-080 (journal d'accès du staff), ADR-122 (séparation des tâches), ADR-143 (contrat et signature), ADR-162 (constancia), ADR-179 (photos d'état), ADR-181 (messagerie).
- **Sources** : 19 US-308 ; 16 CLM-034 (bêta SIMPLIFIÉ), BKG-018 (« horodatage, IP et empreinte » au dossier) ; 17 §2.3 (`data.export` OPS « lim. : C2 de sa file »), §3.2.11 (`evidence_bundle`), §3.2.13 (`file_asset`, `data_access_log`), §3.1.3 ; pré-mortem du lot 3 : L3-PM-04, L3-PM-06, L3-PM-47, L3-PM-50 (RT-L3-D03, RT-L3-P04, RT-L3-P06) ; Q-007 (aucune préproduction, aucun vrai stockage).

## Contexte

Un litige, une plainte ACODECO ou SEDECO, un chargeback ou une déclaration à l'assureur partenaire demandent toutes les preuves d'un trip en un fichier, avec leurs empreintes. Les pièces existent déjà : contrat et signature (US-211), séries de photos chiffrées (US-303), fil de messages (US-525), journal d'état du trip (US-207), consentements versionnés (US-102). Le stockage objet réel, le coffre KMS et le verrou objet ne sont pas livrés (US-003, lot C).

## Décision

1. **Qui** : l'OPS seulement (bêta SIMPLIFIÉ de CLM-034). Permission `evidence.export` (OPS_AGENT, ADMIN, PROPOSÉ), jugée dans le pays du **dossier de support** qui justifie l'export : dossier OUVERT ou PENDING, rattaché à CE trip, assigné à l'agent (ADMIN : tout dossier de son pays) ; session élevée par TOTP ; garde ADR-122 (un agent partie du trip : `SELF_FORBIDDEN`). Aucune route pour l'hôte, le voyageur ni le co-hôte : l'export par un autre hôte (RT-L3-D03) n'a pas de chemin. Chaque demande, chaque ouverture et chaque refus sont journalisés (`data_access_log` BULK_EXPORT avec le motif, audit chaîné ; refus `STAFF_FORBIDDEN`).
2. **Manifeste** construit **par la base** à la demande (migration 0164, `core.claim_evidence_manifest`), à partir des seuls registres : trip ; contrat (chaque version, SHA-256 du PDF, gabarit BROUILLON, signature : heure serveur, méthode, empreinte présentée, sceau, IP et user-agent « NOT_RECORDED » en bêta) ; dernières versions des CGU acceptées par chaque partie avant la réservation ; séries de photos des deux côtés (angle, `file_asset.sha256`, taille, type, heure de réception serveur, heure d'appareil indicative, écart d'horloge, reprises comprises, `current`) ; journal d'état (heure, transition, motif, rôle) ; fil de messages (empreinte et comptes) ; liste des fichiers de l'archive (`path`, `kind`, `ref`, `sha256`) ; pièces absentes (`absent` : contrat non généré, texte pseudonymisé, série non validée, aucun fil, constancia rendue à la demande). Aucune donnée nominative (identifiants techniques, codes, empreintes, heures : C1).
3. **Scellé** : `manifest_sha256` = SHA-256 du texte UTF-8 de `manifest::text` (forme canonique de jsonb) ; ce texte est écrit à l'octet dans `manifest.json`. La table `core.claim_evidence_bundle` est immuable (garde `claim_evidence_sealed`) : seules REQUESTED → READY et REQUESTED → FAILED, jamais DELETE ni TRUNCATE ; EXPIRED est calculé à la lecture.
4. **Archive** par le travailleur `evidence_verifier` (seul nom qui lit les clés de sujet et le registre des fichiers, 0021 / 0057) : relecture de chaque photo, déchiffrement, recalcul de l'empreinte (`readFileAsset`, nouveau dans `@rueda/db/audit`) comparée au manifeste ; PDF du contrat rendu de nouveau (port `EvidenceContractRenderer`, adaptateur CTR dans SUP) et comparé à l'empreinte enregistrée ; document du fil relu par la base (`core.messaging_evidence_messages`, propriétaire `messaging_cmd_owner`). Tout écart, objet absent, clé indisponible ou rendu impossible ⇒ **constat** FAILED (`failure_code`, `findings` : codes et identifiants). Sinon ZIP déterministe (STORE, sans dépendance), chiffré par la clé USER du **demandeur**, déposé en création seule (`file_asset` PRIVATE_EVIDENCE, C2, GENERATED, rétention `EVIDENCE_EXPORT`), READY.
5. **Lien** : 168 h (7 j, seuil PROPOSÉ de 19, commun aux pays) depuis la génération ; ouverture par le seul demandeur, permission et dossier de support toujours valides ; l'API déchiffre par la clé du demandeur et recalcule le SHA-256 de l'archive avant de la servir (sinon `EVIDENCE_EXPORT_FAILED`, rien n'est servi, journal annulé). Le « lien signé » de 16 est, en bêta, la route de la console sous session élevée ; l'URL signée du stockage réel viendra au lot C.
6. **Contenu sensible** : jamais de pièce, de permis, de selfie ni de position. Les photos sont les originaux reçus (l'ops seul les lit ; retirer l'EXIF changerait l'empreinte de la preuve). Le fil contient le texte reçu (preuve, jamais servi aux parties, ADR-181) : l'archive est réservée à l'ops.
7. **Production** : coffre et stockage indisponibles (`Unavailable*`) : les routes répondent 503 `EVIDENCE_EXPORT_UNAVAILABLE` avant toute écriture ; le travailleur n'est pas déclaré dans `worker-tasks.ts` (aucun stockage réel) ; aucun FAKE en production.

## Options écartées

- Archive régénérée à chaque téléchargement, sans copie : l'API (app_api) ne lit pas les clés des parties ; seul `evidence_verifier` les lit.
- Accès direct de l'hôte et du voyageur (16 CLM-034 « Permissions ») : demande un manifeste par partie (minimisation `host_guest_v`) ; suite.
- Paramètre de pays pour la durée du lien : le seuil est commun et PROPOSÉ par 19 ; un paramètre au besoin.
- Rôle propriétaire dédié à CLM : `cmd_hold_owner` lit déjà les registres du trip ; politiques limitées au bucket, à la classe et à la source.
- Constancia dans l'archive : rendue à la demande avec la langue du lecteur (US-212) ; ses faits sont ceux du contrat, déjà au dossier ; listée absente.

## Conséquences

- Écarts de graphe : aucun (CLM → BUS, AUD ; SUP lit CLM et CTR).
- Suites : accès des parties à leur propre dossier ; alerte P1 d'un constat (US-313 / RPT) ; purge de l'archive à l'échéance et suspension par un litige (US-316, L3-PM-50) ; verrou objet et URL signée (lot C) ; écran A09 de la console (US-309) ; constancia dans l'archive.
- Retour arrière : voir l'en-tête de la migration 0164.
