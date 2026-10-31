// MAUVAIS : AVL importe directement le fichier .module.ts de PAY (privé), par import statique.
import { PayModule } from '../../pay/pay.module.js';

export const used = PayModule;
