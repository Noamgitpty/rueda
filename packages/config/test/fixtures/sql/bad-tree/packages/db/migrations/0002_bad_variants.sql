-- MAUVAIS : toutes les variantes interdites, une par ligne de code.
INSERT INTO avl_trip (created_at) VALUES (CURRENT_TIMESTAMP);
SELECT localtimestamp;
SELECT transaction_timestamp();
SELECT statement_timestamp ();
SELECT pg_catalog.now();
SELECT 'now'::timestamptz;
SELECT clock_timestamp();
CREATE FUNCTION avl.expire_holds() RETURNS void LANGUAGE sql AS $fn$
  UPDATE avl_checkout_hold SET status = 'EXPIRED' WHERE expires_at < current_timestamp;
$fn$;
SELECT current_date, current_time, localtime;
