// MAUVAIS : un fichier hors module (ex. app.module.ts) n'importe pas non plus l'intérieur d'un module.
export { secret } from './modules/kyc/internal/secret.js';
