// Fixture volontairement fautive (US-013) : constantes propres à un pays dans le code.
export const currency = 'PYG';
export const timeZone = `America/Asuncion`;
export const locale = { tag: 'es-PA' };
export const isPanama = (code: string): boolean => code === 'PA';
export const label = `Total ${String(1)} USD`;
export const tax = ['ITBMS', 'RUC'];
export const exponents = { PYG: 0, USD: 2 };
export enum Country {
  PA,
  py = 2,
}
export const isParaguay = /PY/;
export const lower = 'america/panama';
export class Rates {
  IVA = 10;
  ITBMS(): number {
    return 7;
  }
}
// Limite documentée (ADR-049) : un nombre n'est pas détecté.
export const rate = 0.07;
