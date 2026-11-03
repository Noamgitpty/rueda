// Fixture volontairement fautive (US-013) : constantes propres à un pays dans le code.
export const currency = 'PYG';
export const timeZone = `America/Asuncion`;
export const locale = { tag: 'es-PA' };
export const isPanama = (code: string): boolean => code === 'PA';
export const label = `Total ${String(1)} USD`;
export const tax = ['ITBMS', 'RUC'];
