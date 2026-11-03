-- 0029 — PAY : détecteur de PAN sans faux positif sur les identifiants structurés (UUID), en
-- temps linéaire.
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
-- Nouvelle définition (identique à apps/api/src/modules/pay/internal/pan.ts ; vecteurs communs :
-- packages/db/test/support/pan-vectors.json) :
--   1. les UUID (8-4-4-4-12 hexadécimaux, non collés à une lettre ou un chiffre) sont écartés :
--      un UUID compte 32 chiffres hexadécimaux, aucun PAN n'a cette forme ;
--   2. suites maximales de groupes de chiffres séparés par UN espace ou UN tiret ;
--   3. fenêtre de groupes consécutifs, TOUT groupage (4-4-4-4, 4-6-5, 8-8, 6-6-4, 3-3-3-3-4…),
--      de 13 à 19 chiffres au total ;
--   4. zéros de tête retirés : encore 13 chiffres au moins, premier chiffre de 2 à 8 (Visa,
--      Mastercard dont la série 2, Mir 2200-2204, Amex, Diners dont 3095, JCB, Discover,
--      UnionPay, Maestro, RuPay, préfixe 7) ;
--   5. contrôle de Luhn valide.
-- Fail-closed : tout ce que 0028 refusait hors UUID reste refusé (y compris les groupages hors
-- carte, les PAN de 19 chiffres complétés par des zéros, les préfixes 7, Mir et Diners 3095), et
-- un PAN au milieu d'une suite plus longue (« 2031 4111 1111 1111 1111 ») est désormais refusé.
-- Limite (ADR-059) : préfixes 1 (UATP ; refuser 1 refuserait tous les horodatages en
-- millisecondes) et 9 non reconnus ; plages des réseaux locaux PA et PY à confirmer (QUESTIONS).
--
-- Complexité LINÉAIRE (revues sécurité et code 2026-11-03d : la première version de 0029 était
-- cubique) : chaque groupe reçoit une fois ses sommes de Luhn (dernier chiffre de rang pair ou
-- impair) ; pour chaque groupe, on remonte au plus 19 groupes en cumulant longueur et somme, et
-- l'on s'arrête dès que 19 chiffres sont dépassés. Tableaux d'entiers (accès en temps constant).
--
-- La contrainte est supprimée puis recréée (validée) : la validation relit les lignes existantes.
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
  v_run      text;
  v_group    text;
  v_len      integer[];
  v_even     integer[];
  v_odd      integer[];
  v_zeros    integer[];
  v_first    integer[];
  v_e        integer;
  v_k        integer;
  v_i        integer;
  v_floor    integer;
  v_digit    integer;
  v_twice    integer;
  v_sum_e    integer;
  v_sum_o    integer;
  v_total    integer;
  v_right    integer;
  v_sum      integer;
  v_lead     integer;
  v_stripped integer;
BEGIN
  IF p_text IS NULL THEN
    RETURN false;
  END IF;
  -- 1. UUID écartés (le caractère qui précède est conservé, l'UUID devient une espace)
  FOR v_run IN
    SELECT m[1]
      FROM regexp_matches(
             regexp_replace(
               p_text,
               '(^|[^0-9A-Za-z])[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}(?![0-9A-Za-z])',
               '\1 ', 'g'),
             -- 2. suites maximales de groupes séparés par un espace ou un tiret
             '([0-9]+(?:[ -][0-9]+)*)', 'g') AS m
  LOOP
    v_len := '{}';
    v_even := '{}';
    v_odd := '{}';
    v_zeros := '{}';
    v_first := '{}';
    v_e := 0;
    v_floor := 1;
    FOR v_group IN SELECT g FROM regexp_split_to_table(v_run, '[ -]') AS g LOOP
      v_e := v_e + 1;
      v_len[v_e] := length(v_group);
      v_even[v_e] := 0;
      v_odd[v_e] := 0;
      v_zeros[v_e] := 0;
      v_first[v_e] := 0;
      IF length(v_group) > 19 THEN
        v_floor := v_e + 1;  -- aucune fenêtre ne traverse un groupe de plus de 19 chiffres
        CONTINUE;
      END IF;
      -- sommes de Luhn du groupe : dernier chiffre de rang pair (non doublé) ou impair (doublé)
      v_sum_e := 0;
      v_sum_o := 0;
      FOR v_i IN 0..length(v_group) - 1 LOOP
        v_digit := ascii(substr(v_group, length(v_group) - v_i, 1)) - 48;
        v_twice := v_digit * 2;
        IF v_twice > 9 THEN
          v_twice := v_twice - 9;
        END IF;
        IF v_i % 2 = 0 THEN
          v_sum_e := v_sum_e + v_digit;
          v_sum_o := v_sum_o + v_twice;
        ELSE
          v_sum_e := v_sum_e + v_twice;
          v_sum_o := v_sum_o + v_digit;
        END IF;
      END LOOP;
      v_even[v_e] := v_sum_e;
      v_odd[v_e] := v_sum_o;
      v_zeros[v_e] := length(v_group) - length(ltrim(v_group, '0'));
      IF v_zeros[v_e] < length(v_group) THEN
        v_first[v_e] := ascii(substr(v_group, v_zeros[v_e] + 1, 1)) - 48;
      END IF;
      -- 3 à 5. fenêtres qui finissent en v_e : au plus 19 groupes, arrêt au-delà de 19 chiffres
      v_total := 0;
      v_sum := 0;
      v_lead := 0;
      v_stripped := 0;
      v_k := v_e;
      WHILE v_k >= v_floor AND v_k > v_e - 19 LOOP
        v_right := v_total;
        v_total := v_total + v_len[v_k];
        EXIT WHEN v_total > 19;
        v_sum := v_sum + CASE WHEN v_right % 2 = 0 THEN v_even[v_k] ELSE v_odd[v_k] END;
        IF v_first[v_k] <> 0 THEN
          v_lead := v_first[v_k];
          v_stripped := v_total - v_zeros[v_k];
        END IF;
        IF v_total >= 13 AND v_stripped >= 13 AND v_lead BETWEEN 2 AND 8 AND v_sum % 10 = 0 THEN
          RETURN true;
        END IF;
        v_k := v_k - 1;
      END LOOP;
    END LOOP;
  END LOOP;
  RETURN false;
END
$fn$;
-- droits de 0028 conservés par CREATE OR REPLACE (EXECUTE : app_worker, cmd_money_owner)
COMMENT ON FUNCTION core.payment_text_has_pan(text) IS
  'PAN (17 §1.6, §4.4 point 3) : UUID écartés, 13 à 19 chiffres tout groupage, premier chiffre non nul de 2 à 8, Luhn ; temps linéaire (0029, US-019). Même définition que pay/internal/pan.ts.';

ALTER TABLE core.payment_webhook_inbox
  ADD CONSTRAINT webhook_inbox_no_pan CHECK (
    NOT core.payment_text_has_pan(headers::text)
    AND NOT core.payment_text_has_pan(normalized_events::text)
    AND NOT core.payment_text_has_pan(provider_event_id));
