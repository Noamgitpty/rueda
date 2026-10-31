// MAUVAIS : SQL métier écrit en TypeScript qui lit l'horloge.
declare function sql(strings: TemplateStringsArray, ...values: unknown[]): string;

export const tagged = sql`UPDATE avl_checkout_hold SET released_at = now() WHERE id = ${1}`;
export const plain = 'SELECT id FROM avl_trip WHERE starts_at > CURRENT_TIMESTAMP';
