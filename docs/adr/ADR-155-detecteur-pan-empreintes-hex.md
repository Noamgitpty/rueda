# ADR-155 — Le détecteur de PAN écarte les empreintes hexadécimales de 64 caractères

- **Statut** : PROPOSÉ (US-019, correctif ; agent sécurité / back-end, claude-opus-5-5, 2026-11-17). Revues exigées (`check-story-reviews.mjs`) : sécurité et argent, sur un autre modèle que l'auteur.
- **Complète** ADR-059 (port de paiement, idempotence, détecteur de PAN de 0028 / 0029).
- **Sources** : 08 E4 (`idem_sent` = `idem_plain`, sinon `hex(sha256(idem_plain))`, 64 caractères) ; 17 v6 §1.6 (portée SAQ A : aucun PAN stocké), §2.8 et paramètre `IDEMPOTENCY_KEY_MAX_LEN`, §4.4 point 3 (contrainte sans PAN sur la boîte de réception) ; passation US-122, section « Signalé, non corrigé » (run 44110961214, `refund-scheduler.int.test.ts`).

## Contexte

Une clé d'idempotence plus longue que la limite du PSP est transmise réduite à `hex(sha256(idem_plain))`. C'est le cas de toutes les clés de remboursement (`{trip}:{segment}:v{n}:REFUND:{tender}:i{n}:a{m}`, 126 caractères avec des UUID, limite de 64). Le PSP renvoie cette clé en `merchantReference` dans le webhook de preuve. Or le détecteur de PAN (`core.payment_text_has_pan`, 0029, et `pay/internal/pan.ts`) écartait les UUID mais pas les empreintes. Une empreinte de 64 hexadécimaux contient des suites de chiffres coupées par des lettres. Dans environ **0,32 %** des cas, l'une d'elles compte 13 à 19 chiffres, commence par 2 à 8 et passe le contrôle de Luhn. Mesures : 638 sur 200 000 (QA d'US-122) ; 661 sur 200 000 et 0,33 % sur le corpus à graine fixe des tests.

Conséquences en production, à chaque occurrence :

- **en base**, `webhook_inbox_no_pan` refuse la ligne (23514). Le PSP rejoue le webhook et reçoit le même refus : le remboursement n'a **jamais** de preuve ;
- **côté API**, `WebhookIngestService` masque d'abord les PAN (`maskPanDeep`). La référence masquée (`594ce7…******…`) ne désigne plus l'opération, et la preuve ne la retrouve pas.

## Options étudiées

**(a) Changer l'encodage de la clé réduite** (base32 sans chiffres, hex à séparateurs…) pour qu'elle ne contienne jamais 13 chiffres de suite. Le détecteur resterait inchangé. **Écartée ici**, pour deux raisons :

1. 08 E4 et 17 (§2.8, paramètre `IDEMPOTENCY_KEY_MAX_LEN`) fixent la valeur à `hex(sha256(idem_plain))`, et la base le vérifie (0028, `payment_cmd_*` : `p_idem_sent` doit valoir `idem_plain` ou `encode(sha256(…), 'hex')`). Changer l'encodage, c'est modifier `docs/specs/`, ce qu'une story ne fait pas seule (CLAUDE.md), et toucher la garde d'argent de 0028.
2. L'option ne corrige que NOS clés. Un PSP réel renverra d'autres empreintes SHA-256 de 64 hexadécimaux (identifiants d'événement, signatures HMAC-SHA256 dans les en-têtes conservés). Elles tomberaient dans le même faux positif.

Elle reste possible plus tard : la clé est déterministe (même `idem_plain` ⇒ même clé), et aucune clé n'est encore partie vers un vrai PSP (FAKE seulement jusqu'au lot C). Le changement coûterait une demande de fusion de specs (08 E4, 17) et une migration de la garde de 0028.

**(b) Écarter du détecteur les jetons hexadécimaux de 64 caractères**, comme 0029 écarte les UUID. **Retenue**, avec une forme étroite.

**(c) Les deux** : écartée, puisque (a) l'est.

## Décision

1. L'étape 1 du détecteur écarte, en plus des UUID, tout jeton qui remplit toutes ces conditions :
   - **exactement 64** caractères `[0-9a-f]` ;
   - **en minuscules** (la sortie de `encode(sha256(…), 'hex')` et de `digest('hex')`) ;
   - **non collé** à une lettre ou à un chiffre, de chaque côté.

   On utilise la même définition en base (migration **0131**, `CREATE OR REPLACE` de `core.payment_text_has_pan`, droits et contrainte inchangés) et dans l'API (`pay/internal/pan.ts` : `containsPan`, et `maskPan`, qui laisse l'empreinte intacte comme un UUID).

2. Les cas suivants restent analysés (**fail-closed**) : capitales ou casse mêlée, 63 ou 65 caractères, jeton collé à une lettre ou à un chiffre. Un PAN voisin d'une empreinte, séparé par une espace, un tiret, un guillemet ou une virgule, reste refusé. Un jeton de 64 chiffres seuls n'était déjà pas analysé : c'est un groupe de plus de 19 chiffres (0029).
3. L'identifiant écarté est remplacé par une espace, entre deux caractères qui ne sont ni des lettres ni des chiffres. Le résultat ne peut pas joindre deux suites de chiffres : il faudrait UN séparateur, et il en reste au moins trois. La nouvelle définition refuse donc un **sous-ensemble** de ce que refusait 0029. Les lignes existantes la respectent, et la contrainte n'est ni supprimée ni recréée.
4. Les vecteurs sont communs à la base et à l'API (`packages/db/test/support/pan-vectors.json`, 41 PAN et 20 non-PAN). On y trouve la reproduction fixe `HEX_FALSE_POSITIVE` : `hex(sha256)` d'une clé de remboursement réelle, vérifiée par `test/support/pan.test.ts`.

## Analyse de sécurité : peut-on cacher un PAN dans une empreinte ?

Oui : `4111111111111111` suivi de 48 lettres `a` forme un jeton accepté. Ce cas figure dans les vecteurs comme **limite documentée**. On l'accepte pour les raisons suivantes.

- **Le détecteur n'est pas une frontière contre un auteur hostile.** Il ne l'était pas avant cette décision. `4111.1111.1111.1111`, `4111_1111_1111_1111`, un PAN en base64 ou un PAN chiffré passent tous déjà (ADR-059 : seuls l'espace et le tiret séparent des groupes). Son rôle, défini par 17 §4.4 point 3, est d'arrêter la **fuite accidentelle**. Exemple : un PSP ou un intégrateur qui renvoie un numéro de carte dans un champ, un en-tête ou un message d'erreur.
- **Une fuite accidentelle n'a pas cette forme.** Un PAN affiché ou journalisé est entouré de séparateurs, de guillemets ou de texte. Pour être écarté, il faudrait qu'il soit collé de part et d'autre à des hexadécimaux minuscules, et que le tout fasse exactement 64 caractères. Les variantes proches restent refusées : 63 ou 65 caractères, capitales, jeton collé.
- **Qui écrit dans la boîte de réception ?** Les événements normalisés ne sont stockés que pour un webhook à signature valide (`WebhookIngestService`), donc venu du PSP. Un voyageur ne choisit ni la `merchantReference` (c'est notre clé) ni ces événements. Un appel forgé, sans signature valide, garde ses en-têtes et son identifiant d'événement. Son auteur peut y glisser un jeton de 64 hexadécimaux qui contient un PAN, mais c'est sa propre carte et un choix délibéré : il pouvait déjà écrire `4111.1111.1111.1111`.
- **Un précédent existe.** 0029 a fait le même compromis pour les UUID. `41111111-1111-1111-…` est écarté, et la revue sécurité d'US-019 l'a accepté.
- **Le coût du statu quo est réel et certain.** Environ un remboursement sur 300 ne recevrait jamais de preuve. L'opération resterait sans issue jusqu'à une intervention manuelle.

Le risque résiduel est le stockage d'un PAN dissimulé à dessein dans un jeton de 64 hexadécimaux, par le PSP lui-même ou par quelqu'un qui contrôle son contenu signé. Il ne relève pas d'un détecteur heuristique. Il relève du contrat du PSP (SAQ A : le PSP ne renvoie jamais de PAN) et de la revue de l'adaptateur réel au lot C.

## Compatibilité

- **Clés d'idempotence** : inchangées (08 E4). Aucune clé envoyée ne change, et l'idempotence du PSP au rejeu n'est pas touchée.
- **Base** : la définition est relâchée et la contrainte n'est pas revalidée. Retour arrière : réappliquer la fonction de 0029. Les lignes acceptées entre-temps contiennent alors peut-être une empreinte que 0029 refuserait, et un `VALIDATE` éventuel les signalerait.
- **API** : `maskPan` ne modifie plus une empreinte de 64. Une référence est désormais stockée telle que le PSP l'a envoyée.

## Preuves

- `apps/api/src/modules/pay/internal/pan.test.ts` : **200 000** clés de remboursement réduites par `idempotencyKeyToSend` (UUID à graine fixe). Aucune n'est détectée, seule ou dans l'événement normalisé, et aucune n'est masquée. Le mutant « définition de 0029 » (une lettre collée retire l'exclusion) en refuse plus de 300. Un vrai PAN voisin d'une empreinte reste refusé et masqué, et l'empreinte reste intacte. Les jetons hors forme exacte restent analysés.
- `packages/db/test/l0/l0-pay-pan.test.ts`, sous `app_worker` (assertion L0-05) :
  - les vecteurs ;
  - **20 000** clés réduites acceptées, et le mutant en refuse ;
  - pour **PA (USD)** et **PY (PYG)** : un webhook de preuve dont l'événement porte l'empreinte en `merchantReference` est accepté, comme un `provider_event_id` égal à l'empreinte ;
  - un PAN voisin, une empreinte collée ou en capitales : 23514 `webhook_inbox_no_pan`.
- `stl/internal/refund-scheduler.int.test.ts` n'est pas modifié. Son échec aléatoire (23514 dans `test_fixture.us049_signed_webhook`) disparaît, puisque la cause est corrigée.

## Conséquences

- 17 §4.4 point 3 décrit le détecteur sans le détail des identifiants écartés. Le report « UUID et empreintes `hex(sha256)` de 64 minuscules écartés ; un PAN dissimulé à dessein n'est pas visé » est à faire par la story des reports de specs (architecture et sécurité).
- Si l'option (a) est reprise un jour (encodage sans suite de chiffres), il faudra une demande de fusion de specs (08 E4, 17 §2.8) et une migration de la garde de 0028. L'exclusion de 64 hexadécimaux resterait utile pour les empreintes produites par le PSP.
