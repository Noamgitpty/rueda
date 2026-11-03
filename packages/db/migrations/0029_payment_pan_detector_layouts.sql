-- 0029 — PAY : détecteur de PAN sans faux positif sur les identifiants structurés (UUID).
-- US-019 (correctif) ; 17 §1.6 (portée SAQ A), §4.4 point 3 (corrigé VERIF_14-F26) ; ADR-059.
-- Appliquée sous `migrator`.
--
-- Défaut corrigé : la définition de 0028 joignait toute suite de chiffres séparés par UN espace
-- ou UN tiret. Dans un identifiant `evt-<uuid>`, les chiffres de plusieurs groupes du UUID
-- (8-4-4-4-12, coupés par des lettres hexadécimales) formaient parfois 13 à 19 chiffres valides
-- au contrôle de Luhn : un identifiant d'événement légitime était refusé par
-- `webhook_inbox_no_pan` (environ 0,25 % des `evt-<uuid>` aléatoires ; échec aléatoire de
-- `l0-03-i-occ` en CI, run 41634917881).
--
-- Nouvelle définition (identique à apps/api/src/modules/pay/internal/pan.ts) :
--   1. les UUID (8-4-4-4-12 hexadécimaux, non collés à une lettre ou un chiffre) sont écartés :
--      un UUID compte 32 chiffres hexadécimaux, aucun PAN n'a cette forme, et ses groupes ne
--      portent jamais plus de 12 chiffres contigus ;
--   2. suites maximales de groupes de chiffres séparés par UN espace ou UN tiret ;
--   3. une fenêtre de groupes consécutifs est un PAN candidat si elle a la forme d'une carte :
--      un seul groupe de 13 à 19 chiffres CONTIGUS, ou des groupes de 4 avec un dernier groupe
--      de 1 à 4 (4-4-4-4, 4-4-4-4-3, 4-4-4-1), ou 4-6-5 (American Express) ou 4-6-4 (Diners),
--      13 à 19 chiffres au total ;
--   4. préfixe d'émetteur connu : Visa 4 ; Mastercard 51-55 et 2221-2720 ; Maestro 50, 56-69 ;
--      American Express 34, 37 ; Diners 300-305, 36, 38, 39 ; JCB 35 ; Discover et UnionPay 6 ;
--      RuPay 60, 65, 81, 82 (préfixes regroupés au plus large : 3[4-9], 5, 6) ;
--   5. contrôle de Luhn valide.
-- Fail-closed : un PAN réel de ces réseaux, collé à du texte ou séparé, reste refusé.
-- Limite (documentée) : un numéro d'un réseau hors de cette liste (UATP 1…, préfixes 0, 7, 9) ou
-- formaté autrement n'est pas reconnu ; aucun de ces réseaux n'est accepté par un PSP de
-- location (17 §1.6 : la carte ne transite jamais par Kmino, SAQ A).
--
-- La contrainte est supprimée puis recréée (validée) : la nouvelle définition reconnaît aussi
-- un PAN au milieu d'une suite plus longue (« 2031 4111 1111 1111 1111 »), que 0028 laissait
-- passer ; la validation relit donc les lignes existantes.
--
-- Retour arrière : réappliquer la section 6 de 0028 (fonction et contrainte).

ALTER TABLE core.payment_webhook_inbox DROP CONSTRAINT webhook_inbox_no_pan;

CREATE OR REPLACE FUNCTION core.payment_text_has_pan(p_text text)
  RETURNS boolean
  LANGUAGE plpgsql
  IMMUTABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_text   text;
  v_run    text;
  v_groups text[];
  v_n      integer;
  v_s      integer;
  v_e      integer;
  v_k      integer;
  v_total  integer;
  v_shape  boolean;
  v_digits text;
  v_sum    integer;
  v_digit  integer;
  v_double boolean;
BEGIN
  IF p_text IS NULL THEN
    RETURN false;
  END IF;
  -- 1. UUID écartés (remplacés par un espace : ils ne se collent pas aux chiffres voisins)
  v_text := regexp_replace(
    p_text,
    '(?<![0-9A-Za-z])[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}(?![0-9A-Za-z])',
    ' ', 'g');
  -- 2. suites maximales de groupes séparés par un espace ou un tiret
  FOR v_run IN SELECT m[1] FROM regexp_matches(v_text, '([0-9]+(?:[ -][0-9]+)*)', 'g') AS m LOOP
    v_groups := regexp_split_to_array(v_run, '[ -]');
    v_n := cardinality(v_groups);
    FOR v_s IN 1..v_n LOOP
      FOR v_e IN REVERSE v_n..v_s LOOP
        -- 3. forme d'une carte
        v_total := 0;
        FOR v_k IN v_s..v_e LOOP
          v_total := v_total + length(v_groups[v_k]);
        END LOOP;
        CONTINUE WHEN v_total NOT BETWEEN 13 AND 19;
        IF v_s = v_e THEN
          v_shape := true;
        ELSIF v_e - v_s = 2 AND length(v_groups[v_s]) = 4 AND length(v_groups[v_s + 1]) = 6
              AND length(v_groups[v_e]) IN (4, 5) THEN
          v_shape := true;
        ELSE
          v_shape := length(v_groups[v_e]) BETWEEN 1 AND 4;
          FOR v_k IN v_s..v_e - 1 LOOP
            v_shape := v_shape AND length(v_groups[v_k]) = 4;
          END LOOP;
        END IF;
        CONTINUE WHEN NOT v_shape;
        v_digits := array_to_string(v_groups[v_s:v_e], '');
        -- 4. préfixe d'émetteur connu
        CONTINUE WHEN v_digits !~
          '^(4|5|6|3(0[0-5]|[4-9])|2(22[1-9]|2[3-9][0-9]|[3-6][0-9]{2}|7[01][0-9]|720)|8[12])';
        -- 5. Luhn
        v_sum := 0;
        v_double := false;
        FOR v_k IN REVERSE length(v_digits)..1 LOOP
          v_digit := ascii(substr(v_digits, v_k, 1)) - 48;
          IF v_double THEN
            v_digit := v_digit * 2;
            IF v_digit > 9 THEN
              v_digit := v_digit - 9;
            END IF;
          END IF;
          v_sum := v_sum + v_digit;
          v_double := NOT v_double;
        END LOOP;
        IF v_sum % 10 = 0 THEN
          RETURN true;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  RETURN false;
END
$fn$;
-- droits de 0028 conservés par CREATE OR REPLACE (EXECUTE : app_worker, cmd_money_owner)
COMMENT ON FUNCTION core.payment_text_has_pan(text) IS
  'PAN (17 §1.6, §4.4 point 3) : forme de carte, préfixe d''émetteur, Luhn ; UUID écartés (0029, US-019). Même définition que pay/internal/pan.ts.';

ALTER TABLE core.payment_webhook_inbox
  ADD CONSTRAINT webhook_inbox_no_pan CHECK (
    NOT core.payment_text_has_pan(headers::text)
    AND NOT core.payment_text_has_pan(normalized_events::text)
    AND NOT core.payment_text_has_pan(provider_event_id));
