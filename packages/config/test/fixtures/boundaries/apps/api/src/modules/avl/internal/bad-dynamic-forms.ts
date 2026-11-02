// MAUVAIS : contournements par createRequire et par import() avec gabarit sans expression.
import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);

export const viaCreateRequire: unknown = req('../../pay/internal/x.js');
export const viaTemplate: unknown = await import(`../../prc/internal/q.js`);
