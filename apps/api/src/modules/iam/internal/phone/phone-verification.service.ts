/**
 * Vérification du téléphone par OTP, côté API (US-104, ADR-098 ; 16 VER-013 ; 19 US-104).
 *
 * Demande (`request`) :
 *   1. session (empreinte du jeton) et clé OTP présentes, sinon 401 / 503 ;
 *   2. pays du parcours connu de la configuration ; numéro normalisé en E.164 d'après le plan de
 *      numérotation du pays (`phone-number.ts`), sinon `PHONE_INVALID` (chiffres et exemple du
 *      pays dans `values`) ;
 *   3. état en base : blocage en cours ⇒ `OTP_LOCKED` ; code déjà parti vers ce numéro il y a
 *      moins de `otp_sms_fallback_s` ⇒ même réponse `OTP_SENT`, rien ne part ; numéro déjà vérifié
 *      sur ce compte ⇒ `PHONE_ALREADY_VERIFIED` ;
 *   4. plafonds anti-abus AVANT l'écriture (`OtpSendGuard` = `AbuseGuard.checkCostlySend` de
 *      RISK, injecté par la racine de composition : IAM ne dépend pas de RISK) : par numéro, par
 *      IP, par compte, par indicatif pays, puis plafond SMS journalier du pays ; refus ⇒ 429
 *      `RATE_LIMITED` (ou 503 si le compteur manque), aucun défi, aucun SMS ;
 *   5. commande en base : défi SANS code et `iam.otp.requested` ; le travailleur tire et envoie le
 *      code (asynchrone). Réponse `OTP_SENT` identique que le numéro soit libre ou déjà vérifié
 *      par un autre compte (aucune énumération).
 * Saisie (`verify`) : empreinte HMAC du code saisi (clé `RUEDA_OTP_KEY`), jugée par la base
 * (temps constant, essais bornés, blocage, unicité du numéro vérifié).
 *
 * Journaux : aucun ici (ni numéro, ni code, ni empreinte).
 */
import { HttpException } from '@nestjs/common';
import type { PhoneNumberingConfig } from '../../../cfg/index.js';
import { AuthHttpError } from '../errors.js';
import { AuthStoreError } from '../pg-auth-store.js';
import type { OtpCodeHasher } from './otp-code.js';
import { isOtpCode } from './otp-code.js';
import { maskPhone, normalizePhone } from './phone-number.js';
import type { PhoneOtpStore } from './phone-otp-store.js';

/** Envoi coûteux soumis aux plafonds (forme de `CostlySendRequest` de RISK, US-052). */
export interface OtpSendRequest {
  readonly channel: 'SMS_OTP';
  readonly country: string;
  readonly recipient: string;
  readonly ip: string | null;
  readonly account: string;
  readonly prefix: string;
}

/** Port des plafonds anti-abus (implémenté par `AbuseGuard` de RISK) ; lève une erreur HTTP. */
export interface OtpSendGuard {
  checkCostlySend(request: OtpSendRequest): Promise<void>;
}

/** Aucun garde fourni : aucun envoi (fail-closed). */
export const UNAVAILABLE_SEND_GUARD: OtpSendGuard = {
  checkCostlySend: () => Promise.reject(new AuthHttpError('OTP_UNAVAILABLE')),
};

export interface PhoneVerificationDeps {
  readonly store: PhoneOtpStore;
  /** `null` : `RUEDA_OTP_KEY` absente, OTP indisponible. */
  readonly hasher: OtpCodeHasher | null;
  readonly sendGuard: OtpSendGuard;
  /** Plan de numérotation d'un pays configuré (CFG), sinon `undefined`. */
  readonly numbering: (country: string) => PhoneNumberingConfig | undefined;
  /** Pays configurés : noms et plans (masquage d'un numéro normalisé, choix du pays à l'écran). */
  readonly countries: readonly PhoneCountry[];
}

/** Pays proposé à la saisie : code, noms par langue et plan de numérotation (CFG). */
export interface PhoneCountry {
  readonly code: string;
  readonly names: Readonly<Record<string, string>>;
  readonly phone: PhoneNumberingConfig;
}

export interface PhoneCountryView {
  readonly code: string;
  readonly names: Readonly<Record<string, string>>;
  readonly callingCode: string;
  readonly nationalLength: number;
  readonly example: string;
}

export interface PendingView {
  readonly phone: string;
  readonly resendAfterS: number;
  readonly expiresInS: number;
  readonly attemptsLeft: number | null;
}

export interface PhoneStateView {
  readonly verified: boolean;
  /** Numéro vérifié, masqué (indicatif et deux derniers chiffres). */
  readonly phone: string | null;
  readonly pending: PendingView | null;
  readonly lockedForS: number | null;
  /** Pays proposés à la saisie (indicatif et exemple affichés : 10b W3). */
  readonly countries: readonly PhoneCountryView[];
}

export interface SentView {
  readonly phone: string;
  readonly resendAfterS: number;
  readonly expiresInS: number;
}

const COUNTRY_FORMAT = /^[A-Z]{2}$/;
const REQUEST_FIELDS = new Set(['phone', 'country']);
const VERIFY_FIELDS = new Set(['code']);

const minutes = (seconds: number | null): number => Math.max(1, Math.ceil((seconds ?? 0) / 60));

export class PhoneVerificationService {
  readonly #deps: PhoneVerificationDeps;

  constructor(deps: PhoneVerificationDeps) {
    this.#deps = deps;
  }

  /** Numéro E.164 masqué d'après le plan de son indicatif, parmi les pays configurés. */
  #mask(e164: string): string {
    return maskPhone(
      e164,
      this.#deps.countries.map((c) => c.phone).find((p) => e164.startsWith(`+${p.callingCode}`)),
    );
  }

  async #guarded<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof AuthStoreError) throw new AuthHttpError('OTP_UNAVAILABLE');
      throw error;
    }
  }

  async state(proof: Buffer | null): Promise<PhoneStateView> {
    if (proof === null) throw new AuthHttpError('AUTH_REQUIRED');
    const s = await this.#guarded(() => this.#deps.store.state(proof));
    if (s === null) throw new AuthHttpError('AUTH_REQUIRED');
    const pending =
      s.pendingPhone !== null && s.expiresInS !== null
        ? {
            phone: this.#mask(s.pendingPhone),
            resendAfterS: s.resendAfterS ?? 0,
            expiresInS: s.expiresInS,
            attemptsLeft: s.attemptsLeft,
          }
        : null;
    return {
      verified: s.verifiedPhone !== null,
      phone: s.verifiedPhone === null ? null : this.#mask(s.verifiedPhone),
      pending,
      lockedForS: s.lockedForS,
      countries: this.#deps.countries.map((c) => ({
        code: c.code,
        names: c.names,
        callingCode: c.phone.callingCode,
        nationalLength: c.phone.nationalLength,
        example: c.phone.example,
      })),
    };
  }

  /** Le numéro de la personne de la session est vérifié (contrôle bloquant du paiement, US-209). */
  async isVerified(proof: Buffer | null): Promise<boolean> {
    if (proof === null) return false;
    const s = await this.#guarded(() => this.#deps.store.state(proof));
    return s !== null && s.verifiedPhone !== null;
  }

  async request(
    proof: Buffer | null,
    principal: { readonly userId: string; readonly emailVerified: boolean },
    body: Record<string, unknown>,
    ip: string | null,
  ): Promise<SentView> {
    if (proof === null) throw new AuthHttpError('AUTH_REQUIRED');
    if (Object.keys(body).some((k) => !REQUEST_FIELDS.has(k))) {
      throw new AuthHttpError('REQUEST_INVALID');
    }
    const { phone, country } = body;
    if (typeof country !== 'string' || !COUNTRY_FORMAT.test(country)) {
      throw new AuthHttpError('REQUEST_INVALID');
    }
    const plan = this.#deps.numbering(country);
    if (plan === undefined) throw new AuthHttpError('COUNTRY_UNKNOWN');
    const parsed = normalizePhone(phone, plan);
    if (!parsed.ok) {
      throw new AuthHttpError('PHONE_INVALID', {
        digits: plan.nationalLength,
        example: plan.example,
      });
    }
    // e-mail non vérifié : refus avant tout plafond (la base le refuse aussi, NOT_ELIGIBLE)
    if (!principal.emailVerified) throw new AuthHttpError('PHONE_NOT_ELIGIBLE');
    if (this.#deps.hasher === null) throw new AuthHttpError('OTP_UNAVAILABLE');
    const masked = maskPhone(parsed.e164, plan);

    const state = await this.#guarded(() => this.#deps.store.state(proof));
    if (state === null) throw new AuthHttpError('AUTH_REQUIRED');
    if (state.lockedForS !== null) {
      throw new AuthHttpError('OTP_LOCKED', { minutes: minutes(state.lockedForS) });
    }
    if (state.verifiedPhone === parsed.e164) throw new AuthHttpError('PHONE_ALREADY_VERIFIED');
    if (
      state.pendingPhone === parsed.e164 &&
      state.resendAfterS !== null &&
      state.resendAfterS > 0 &&
      state.expiresInS !== null
    ) {
      // code déjà parti vers ce numéro : même réponse, rien ne part, aucun plafond consommé
      return { phone: masked, resendAfterS: state.resendAfterS, expiresInS: state.expiresInS };
    }

    await this.#deps.sendGuard.checkCostlySend({
      channel: 'SMS_OTP',
      country,
      recipient: parsed.e164,
      ip,
      account: principal.userId,
      prefix: parsed.prefix,
    });

    const r = await this.#guarded(() => this.#deps.store.request(proof, parsed.e164, country));
    switch (r.outcome) {
      case 'SENT':
      case 'RESEND_WAIT':
        return {
          phone: masked,
          resendAfterS: r.resendAfterS ?? 0,
          expiresInS: r.expiresInS ?? 0,
        };
      case 'AUTH_REQUIRED':
      case 'REQUEST_INVALID':
      case 'COUNTRY_UNKNOWN':
        throw new AuthHttpError(r.outcome);
      case 'NOT_ELIGIBLE':
        throw new AuthHttpError('PHONE_NOT_ELIGIBLE');
      case 'ALREADY_VERIFIED':
        throw new AuthHttpError('PHONE_ALREADY_VERIFIED');
      case 'LOCKED':
        throw new AuthHttpError('OTP_LOCKED', { minutes: minutes(r.lockedForS) });
      case 'PARAM_MISSING':
        // paramètre du pays absent (fail-closed, 17 §7.1) : service indisponible, sans détail
        throw new AuthHttpError('OTP_UNAVAILABLE');
    }
  }

  async verify(proof: Buffer | null, body: Record<string, unknown>): Promise<void> {
    if (proof === null) throw new AuthHttpError('AUTH_REQUIRED');
    if (Object.keys(body).some((k) => !VERIFY_FIELDS.has(k))) {
      throw new AuthHttpError('REQUEST_INVALID');
    }
    const code = typeof body['code'] === 'string' ? body['code'].trim() : body['code'];
    if (!isOtpCode(code)) throw new AuthHttpError('REQUEST_INVALID');
    const hasher = this.#deps.hasher;
    if (hasher === null) throw new AuthHttpError('OTP_UNAVAILABLE');
    const r = await this.#guarded(() => this.#deps.store.verify(proof, [hasher.hash(code)]));
    switch (r.outcome) {
      case 'PHONE_VERIFIED':
        return;
      case 'AUTH_REQUIRED':
      case 'OTP_EXPIRED':
      case 'ACCOUNT_DUPLICATE_PHONE':
        throw new AuthHttpError(r.outcome);
      case 'OTP_INVALID':
        throw new AuthHttpError('OTP_INVALID', { attempts: r.attemptsLeft ?? 0 });
      case 'OTP_LOCKED':
        throw new AuthHttpError('OTP_LOCKED', { minutes: minutes(r.lockedForS) });
      case 'PARAM_MISSING':
        throw new AuthHttpError('OTP_UNAVAILABLE');
    }
  }
}
