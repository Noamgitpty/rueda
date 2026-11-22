/** Jetons d'injection du module TRP (US-303, US-315, US-307). */
export const TRP_INSPECTION_STORE = Symbol('TRP_INSPECTION_STORE');
export const TRP_EVIDENCE_PIPELINE = Symbol('TRP_EVIDENCE_PIPELINE');
/** Remise et retour entre particuliers (US-315). */
export const TRP_HANDOVER_STORE = Symbol('TRP_HANDOVER_STORE');
/** Rappel du consentement MIT à la remise (US-703, port de PAY). */
export const TRP_MIT_REMINDERS = Symbol('TRP_MIT_REMINDERS');
/** No-show déclaré par une partie du trip (US-307). */
export const TRP_NO_SHOW_STORE = Symbol('TRP_NO_SHOW_STORE');
