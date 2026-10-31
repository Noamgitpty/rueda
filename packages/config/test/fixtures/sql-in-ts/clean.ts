// PROPRE : platform.now() seulement ; un texte qui n'est pas du SQL peut contenir « now ».
declare function sql(strings: TemplateStringsArray, ...values: unknown[]): string;

export const tagged = sql`UPDATE avl_checkout_hold SET released_at = platform.now() WHERE id = ${1}`;
export const label = 'now() is not SQL here';
