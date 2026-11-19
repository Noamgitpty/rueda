lot: L3
module: Remise et retour

- Ajouté : l'hôte et le voyageur prennent leurs photos de départ et de retour dans l'application, angle par angle (15 extérieures, 8 intérieures, carburant, compteur, plus clés et dommages existants en option), avec le compteur des photos obligatoires et l'avancement de l'autre partie (US-303)
- Ajouté : la validation d'une série incomplète est refusée (`PHOTO_TEMPLATE_INCOMPLETE`, angles manquants annoncés) ; la série de l'un ne remplace pas celle de l'autre (US-303)
- Ajouté : routes `/trips/{id}/inspections/{kind}` (lecture, jeton de capture, photo, validation) ; heure du serveur et empreinte SHA-256 des octets reçus ; fichier au bucket de preuves privé, chiffré par la clé de la personne (US-303)
- Sécurité : une photo sans jeton de capture valide de l'application (galerie, jeton expiré, consommé, d'un autre angle ou d'une autre personne) est refusée (`PHOTO_GALLERY_FORBIDDEN`) ; type réel, taille et dimensions du pays contrôlés ; antivirus fail-closed : en production, l'envoi répond 503 tant que ClamAV, le coffre et le stockage ne sont pas branchés (US-303)
- Sécurité : un WebP dont l'image annonce une taille plus grande que son en-tête VP8X est refusé, aussi pour les photos d'annonce (N-120) (US-303)
