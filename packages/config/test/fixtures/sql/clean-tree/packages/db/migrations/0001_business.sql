-- PROPRE : seul platform.now() lit l'horloge.
-- Les commentaires peuvent citer now(), current_timestamp ou CURRENT_TIMESTAMP sans erreur.
/* Bloc : localtimestamp, transaction_timestamp(), statement_timestamp(), clock_timestamp()
   /* imbriqué : now() */ toujours dans le commentaire : current_date */
WITH t AS (SELECT platform.now() AS ts)
UPDATE avl_checkout_hold h
   SET status = 'EXPIRED', released_at = t.ts
  FROM t
 WHERE h.expires_at < t.ts;

INSERT INTO ntf_notification_template (body, "now")
VALUES ('Il est now() : texte, pas du SQL', 'current_timestamp en texte');

SELECT e.current_date_label, h.snowfall FROM cfg_holiday_calendar h, cfg_event e; -- now()
SELECT PLATFORM . now ();
SELECT "platform"."now"();
SELECT "now", "timeofday" FROM t;
