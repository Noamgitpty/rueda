-- Fixture fautive (US-013) : un commentaire qui cite PYG ne compte pas.
CREATE TABLE t (currency char(3) CHECK (currency IN ('USD', 'PYG')));
SELECT 1 WHERE 'America/Panama' IS NOT NULL;
