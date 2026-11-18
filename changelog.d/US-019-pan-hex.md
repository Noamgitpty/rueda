lot: L0
module: Paiement

- Corrigé : la preuve d'un remboursement envoyée par le PSP n'est plus refusée à tort comme contenant un numéro de carte ; la clé d'idempotence réduite (empreinte hexadécimale de 64 caractères) est reconnue en base et dans l'API, et un vrai numéro de carte reste refusé (US-019, ADR-155)
