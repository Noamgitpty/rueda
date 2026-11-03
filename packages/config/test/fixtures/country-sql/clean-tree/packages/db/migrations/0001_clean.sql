-- Fixture propre (US-013) : PA, PY, USD, PYG cités en commentaire seulement.
CREATE TABLE t (currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'), kind text CHECK (kind IN ('PAYMENT')));
