-- MAUVAIS : contournements par identifiants entre guillemets et timeofday() (revue code US-001 #4).
SELECT "now"();
SELECT "pg_catalog"."now"();
SELECT timeofday();
