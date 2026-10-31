-- MAUVAIS : now() dans le SQL métier (doit faire échouer pnpm lint).
UPDATE avl_checkout_hold SET released_at = now() WHERE id = $1;
