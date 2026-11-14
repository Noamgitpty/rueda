lot: L1
module: Exploitation (portabilité)

- Ajouté : inventaire des services de l'hébergeur derrière des ports, avec adaptateur local et alternatives nommées, et contrôle automatique « aucun SDK ni constante de fournisseur cloud » dans `apps/` et `packages/` (US-036)
- Ajouté : adaptateurs locaux `LocalKeyWrapper` (refusé en production) et `FsFileStore` (US-036)
- Ajouté : export de portabilité (base logique sans clés, clés de sujet par le séquestre du fondateur, fichiers avec manifeste) et import sur un nouvel hébergeur, runbook `docs/ops/PORTABILITY.md` exécuté tel quel par le job « reprise » (US-036)
