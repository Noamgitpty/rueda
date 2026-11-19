# ADR-179 — Photos guidées de l'état du véhicule : gabarit versionné, jeton de capture, empreinte à la réception, bucket de preuves

- **Statut** : PROPOSÉ (US-303, agent de story, rôle back-end et front-end, claude-opus-5-5, 2026-11-19). Revues exigées : celles de `node scripts/ci/check-story-reviews.mjs` (code, architecture, sécurité, ux, qa) ; RLS / rôles et `SECURITY DEFINER` sur un autre modèle que l'auteur.
- **Complète** : ADR-051 (magasin de preuves, `file_asset`, empreinte à la réception), ADR-099 (contrôles des photos d'annonce), ADR-005 / ADR-039 (`CameraCapture`, PWA en ligne), ADR-143 / ADR-149 (parties d'un trip jugées en base).
- **Sources** : 19 US-303 ; 16 TRP-004 (gabarit, « la série de l'un ne remplace pas celle de l'autre », `PHOTO_TEMPLATE_INCOMPLETE`, `PHOTO_GALLERY_FORBIDDEN`, M8) ; 08 BR-PICKUP-03, BR-RETURN-01, BR-DAMAGE-02 ; 17 §3.2.10, §3.2.13, §3.1.3 points 1 et 6, §5 (antivirus, verrou objet), §7.2 (`photo_max_kb`, `photo_max_px`, `clock_skew_flag_h`) ; 10b UX-07, S09 · check-in / check-out, A03, A04 ; DEC-FONDATEUR-20 (ClamAV fail-closed) ; Q-007 (aucune préproduction) ; BOARD N-120.

## Contexte

Les photos de remise et de retour sont la preuve de l'état du véhicule entre l'hôte et le voyageur (litiges, assureur partenaire). Elles doivent être prises dans l'application, horodatées par le serveur, protégées par une empreinte, et chaque partie a sa série. Le module TRP était vide ; le stockage objet réel, le coffre KMS et l'antivirus ne sont pas livrés (US-003, lot C).

## Décision

1. **Gabarit** (`core.trip_ops_photo_slot`, classe C, migration 0158) : liste fermée et versionnée, commune aux pays ; version 1 : `EXT_01`–`EXT_15`, `INT_01`–`INT_08`, `FUEL`, `ODOMETER` obligatoires (25) ; `KEY`, `DAMAGE_01`–`DAMAGE_10` facultatifs. Une série garde sa version.
2. **Une série par côté** (`core.trip_ops_inspection`, UNIQUE (trip, kind, rôle)) : HOST = titulaire du compte d'hôte du trip, GUEST = voyageur du trip, jugés par l'empreinte du jeton de session ; toute autre personne ⇒ NOT_FOUND (404, même réponse qu'un trip inconnu). Fenêtre : `CHECKIN` quand le trip est `CHECKIN_OPEN`, `CHECKOUT` quand il est `IN_PROGRESS` ou `OVERDUE`. DRAFT puis SUBMITTED (gabarit complet, heure serveur, idempotent) ; le passage du trip à IN_PROGRESS et l'état VALIDATED restent à US-315.
3. **Capture dans l'application** : l'écran n'a aucun sélecteur de fichier (caméra en direct, `CameraCapture`) ; chaque photo consomme un **jeton de capture** émis par la base au déclenchement (`core.trip_ops_photo_capture` : angle, personne, 120 s, usage unique, verrouillé avant consommation). Source déclarée autre que `CAMERA`, jeton absent, expiré, consommé, d'un autre angle ou d'une autre personne ⇒ `PHOTO_GALLERY_FORBIDDEN`, rien n'est reçu. Limite assumée (16 TRP-004) : un client modifié peut présenter une autre image avec un jeton frais ; le jeton prouve le parcours et l'heure, l'empreinte prouve l'intégrité depuis la réception.
4. **Fichier** : octets REÇUS stockés tels quels (aucun retrait de métadonnées sur une preuve) ; empreinte SHA-256 calculée par l'API sur ces octets et comparée à celle de l'appareil (transport) ; ligne `file_asset` écrite par la commande (PRIVATE_EVIDENCE, C2, IN_APP_CAMERA, rétention `TRIP_INSPECTION`, chiffrée par la clé USER de la personne) ; dépôt en création seule dans la même transaction. Le recalcul par `verifyFileAsset` (US-009) redonne l'empreinte enregistrée.
5. **Bornes** : taille ≤ `photo_max_kb` du pays et ≤ la limite du corps JSON (≈ 74 Kio en base64 dans 100 Kio) ; type réel JPEG ou WebP ; côté ≤ `photo_max_px` ; plusieurs tailles annoncées ⇒ la plus grande (règle F2-U-01 étendue au WebP : un VP8 démesuré derrière un petit VP8X est refusé, N-120) ; antivirus : seul `CLEAN` libère. Paramètre absent ⇒ refus (fail-closed). L'écran réduit le grand côté (1 600 → 640 px) jusqu'à tenir dans le budget annoncé.
6. **Contrôles partagés** : les contrôles des photos d'annonce (US-115) passent dans le socle AUD (`aud/internal/photo-checks.ts`) ; CAT les réexporte sans changement ; TRP les lit par l'index d'AUD.
7. **Graphe des modules** : TRP dépend de IAM (`SessionGuard`) et de CTR (`TermsGuard`) pour ses routes, écart assumé de 17 §2.2 (comme AVL → IAM, CAT → CTR), à reporter par une demande de fusion revue.
8. **Production** : antivirus (ClamAV), coffre KMS et stockage à verrou objet indisponibles (`Unavailable*`) : lecture, jetons et validation répondent, l'envoi d'une photo répond 503 `PHOTO_UPLOAD_UNAVAILABLE` et l'écran l'annonce. Aucun vrai bucket, aucun FAKE en production (Q-007).

## Options écartées

- Corps binaire `image/*` hors JSON : demande d'assouplir la parade CSRF (JSON exigé) et le durcissement HTTP ; remplacé au lot C par l'URL de dépôt signée du stockage réel.
- Retirer EXIF / GPS des photos d'état : changerait les octets et l'empreinte de la preuve ; ces photos ne sont jamais publiques.
- Refuser une photo dont l'heure d'appareil s'écarte : l'heure serveur fait foi ; l'écart (> `clock_skew_flag_h`) est seulement signalé (`clock_skew_flag`).
- Rôle propriétaire dédié à TRP : demande de modifier l'amorçage des rôles d'instance ; `cmd_hold_owner` porte déjà les commandes du trip, avec des politiques limitées au bucket, à la classe et à la source.

## Conséquences

- Un trip a jusqu'à quatre séries (départ et retour, hôte et voyageur) ; l'indicateur M8 se mesure sur les séries SUBMITTED (US-313 / RPT).
- Suites : lecture du contenu des photos par les parties et l'ops (dossier de preuve, US-308), comparaison côte à côte (A04), file hors ligne (US-524), co-hôte, URL de dépôt signée et 500 ko au lot C.
- Retour arrière : voir l'en-tête de la migration 0158 ; remettre `photo-ingest.ts` dans CAT.
