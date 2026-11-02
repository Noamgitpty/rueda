-- PROPRE (liste blanche) : la définition de platform.now() a droit à clock_timestamp().
CREATE SCHEMA IF NOT EXISTS platform;
CREATE OR REPLACE FUNCTION platform.now() RETURNS timestamptz
  LANGUAGE sql VOLATILE
AS $$ SELECT clock_timestamp() $$;
