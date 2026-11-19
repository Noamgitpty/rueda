# TRP — Trip operations (`apps/api/src/modules/trp`)

**TRP — Trip operations** : check-in, check-out, inspections, hors ligne, retards et non-restitution. Dépendances autorisées : AVL, KYC, PAY, AUD (socle implicite : CFG, AUD, BUS ; source : 17 §2.2 ; §2.1 TRP --> AVL, AUD).

## Responsabilité

TRP gère la remise et le retour du véhicule entre particuliers (17 §2.2, §2.11) :

- ouverture du check-in à T−24 h, bloqué tant que la preuve de paiement n'est pas reçue ;
- check-in et check-out par l'hôte et le voyageur : photos guidées, compteur, carburant, clés, signature ;
- mode hors ligne : file locale, horodatage appareil et serveur, écart de plus de 2 h signalé ;
- retard (`OVERDUE` 30 min après la fin) et escalade de non-restitution ;
- refus du véhicule et liste des remises du jour de l'hôte.

TRP ne change pas lui-même l'état du trip : il demande les transitions SM-1 à AVL. La table du trip (`core.booking_trip`, migration 0004) appartient à AVL.

État réel du code : **photos guidées de l'état du véhicule** (US-303, ADR-179, migration 0158). Le reste arrive avec US-315 (remise et retour entre particuliers, passage IN_PROGRESS), US-305 et US-306 (retards et escalade) et US-524 (hors ligne).

### Photos d'état (US-303)

- Routes (`internal/inspection/inspection.controller.ts`, `SessionGuard` puis `TermsGuard`) : `GET /trips/{tripId}/inspections/{kind}` (gabarit, bornes du pays, les deux séries), `POST …/captures` (jeton de capture d'un angle, 120 s, usage unique), `POST …/photos` (photo de la caméra de l'application, base64 dans le corps JSON borné), `POST …/submit` (validation : gabarit complet, sinon 422 `PHOTO_TEMPLATE_INCOMPLETE` et `missing`). `kind` : `checkin` ou `checkout`.
- Envoi, fail-closed : source `CAMERA` et jeton valide (sinon `PHOTO_GALLERY_FORBIDDEN`), jugés par la base AVANT tout traitement ; ports branchés (sinon 503) ; taille ≤ `photo_max_kb` et limite JSON, type réel JPEG / WebP, côté ≤ `photo_max_px` (contrôles d'AUD) ; empreinte reçue = empreinte de l'appareil ; antivirus `CLEAN` ; puis une transaction : clé USER de la personne (coffre), commande d'ajout (`file_asset` PRIVATE_EVIDENCE C2, photo, heure serveur), chiffrement, dépôt en création seule.
- Base (0158, `cmd_hold_owner`, EXECUTE `app_api`) : `core.trip_inspection_view`, `core.trip_cmd_open_photo_capture`, `core.trip_photo_capture_check`, `core.trip_cmd_add_inspection_photo`, `core.trip_cmd_submit_inspection` ; tables sans aucun droit applicatif.
- Ports (`internal/inspection/ports.ts`) : `EvidenceScanner` (forme `UploadScanner`), `EvidenceVault`, `EvidenceFileStore` ; production : indisponibles (ClamAV DEC-FONDATEUR-20, KMS et stockage à verrou objet US-003, Q-007) ⇒ envoi 503. Adaptateurs : `postgresTrpAdapters(pool)`.
- Hors périmètre (suites) : lecture du contenu des photos (dossier de preuve, US-308), comparaison côte à côte (A04, US-315), co-hôte, file hors ligne (US-524), URL de dépôt signée (lot C).

## Entités

| Entité (17 §3.2.10) | État                                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `trip_inspection`   | `core.trip_ops_inspection` (0158, US-303) ; jetons `core.trip_ops_photo_capture` ; gabarit `core.trip_ops_photo_slot` |
| `inspection_photo`  | `core.trip_ops_inspection_photo` (0158, US-303)                                                                       |
| `overdue_case`      | cible 17, pas encore créée                                                                                            |
| `key_handover`      | cible 17, pas encore créée                                                                                            |

## Événements

Aucun événement n'est encore émis par le code (US-303 n'en émet pas : la validation des deux séries et `trip.checkin.validated` arrivent avec US-315).

Cible (17 §4.5) :

- émis : `trip.checkin.validated`, `trip.checkout.completed`, `trip.overdue.detected` / `.escalated`, `trip.offline.clock_skew_detected`. NTF est déjà abonné à `trip.overdue.detected` (`apps/api/src/modules/ntf/internal/catalog.ts`) ; aucun producteur n'existe encore ;
- consommés : `payment.received` (PAY, déblocage du check-in), `trip.status_changed` (AVL, minuteries).

## Ports

`index.ts` expose `TrpModule`, `TrpInspectionModule` et `postgresTrpAdapters`, les ports des photos (`EvidenceScanner`, `EvidenceVault`, `EvidenceFileStore` et leurs adaptateurs indisponibles), le magasin (`InspectionStore`, `PgInspectionStore`) et le catalogue des réponses (`INSPECTION_MESSAGES`). Les photos passent par le magasin de preuves d'AUD (`core.audit_file_asset`, bucket PRIVATE_EVIDENCE). Dépendances ajoutées : IAM (`SessionGuard`) et CTR (`TermsGuard`), écart assumé de 17 §2.2 (ADR-179).

## Commandes de test

Contrat des routes (FAKE du magasin et des ports, sans base) :

```bash
pnpm --filter @rueda/api exec vitest run src/modules/trp
```

Preuves L0 sous les rôles de production, PA / USD et PY / PYG : `packages/db/test/l0/l0-us303-inspection-photos.test.ts` (`pnpm --filter @rueda/db test:l0`, PostgreSQL requis : `docs/ops/INSTALL.md` ou `RUEDA_PG_TESTCONTAINERS=1`).
