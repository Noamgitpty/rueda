-- 0131 — PAY : le détecteur de PAN écarte les empreintes hexadécimales de 64 caractères (clé
-- d'idempotence réduite que le PSP renvoie en `merchantReference`).
-- US-019 (correctif ; défaut signalé par la QA d'US-122, run 44110961214) ; 08 E4 et 17 §2.8
-- (`idem_sent` = `hex(sha256(idem_plain))` au-delà de la limite du PSP) ; 17 §1.6 (portée SAQ A),
-- §4.4 point 3 ; ADR-059 (0029), ADR-155 (cette migration). Appliquée sous `migrator`, en une
-- transaction.
--
-- Défaut corrigé : une clé d'idempotence de plus de 64 caractères (clés de remboursement
-- `trip:…:REFUND:…`) est transmise au PSP réduite à `hex(sha256(idem_plain))` (08 E4 ; 0028 en
-- garde la forme exacte). Le PSP la renvoie en `merchantReference` dans le webhook de preuve.
-- Environ 0,32 % de ces empreintes contiennent une suite de 13 à 19 chiffres, premier chiffre de
-- 2 à 8, valide au contrôle de Luhn : `webhook_inbox_no_pan` refusait la preuve (23514), et le
-- même refus revenait à chaque rejeu du PSP ; côté API, `maskPan` altérait la référence, que la
-- preuve ne retrouvait plus.
--
-- Nouvelle définition (identique à apps/api/src/modules/pay/internal/pan.ts ; vecteurs communs :
-- packages/db/test/support/pan-vectors.json) : l'étape 1 de 0029 écarte, en plus des UUID, tout
-- jeton d'EXACTEMENT 64 caractères `[0-9a-f]` (minuscules, la forme de `encode(sha256(…), 'hex')`
-- et de `digest('hex')`), non collé à une lettre ou un chiffre. Les étapes 2 à 5 sont
-- inchangées. Restent analysés (fail-closed) : capitales ou casse mêlée, 63 ou 65 caractères,
-- jeton collé à une lettre ou un chiffre. (Un jeton de 64 chiffres seuls est un groupe de plus de
-- 19 chiffres : 0029 ne l'analysait déjà pas.)
-- L'identifiant écarté devient une espace entre deux caractères non alphanumériques : il ne peut
-- pas joindre deux suites de chiffres (il faudrait UN séparateur, il en reste au moins trois).
-- Limite acceptée (ADR-155) : un PAN placé à dessein dans un tel jeton n'est plus vu. Le
-- détecteur n'est pas une frontière contre un auteur hostile (« 4111.1111.1111.1111 » passe déjà,
-- ADR-059) ; il arrête la fuite ACCIDENTELLE, qui ne prend pas la forme d'une empreinte de 64.
--
-- La nouvelle définition refuse un SOUS-ENSEMBLE de ce que refusait 0029 (elle retire des
-- chiffres sans jamais en joindre) : les lignes existantes la respectent, la contrainte
-- `webhook_inbox_no_pan` n'est ni supprimée ni recréée.
--
-- Retour arrière : réappliquer la fonction de 0029 (CREATE OR REPLACE) et son commentaire.

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
  -- 1. UUID et empreintes hex(sha256) (64 hexadécimaux minuscules) écartés (0131, ADR-155) :
  --    le caractère qui précède est conservé, l'identifiant devient une espace
  FOR v_run IN
    SELECT m[1]
      FROM regexp_matches(
             regexp_replace(
               p_text,
               '(^|[^0-9A-Za-z])(?:[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}|[0-9a-f]{64})(?![0-9A-Za-z])',
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
  'PAN (17 §1.6, §4.4 point 3) : UUID et empreintes hex(sha256) de 64 minuscules écartés, 13 à 19 chiffres tout groupage, premier chiffre non nul de 2 à 8, Luhn ; temps linéaire (0029, 0131, US-019, ADR-155). Même définition que pay/internal/pan.ts.';
