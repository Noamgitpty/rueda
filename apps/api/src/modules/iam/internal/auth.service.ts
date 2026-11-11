/**
 * Adaptateur interne du port d'authentification (ADR-021, défaut : implémentation interne
 * derrière le port ; ADR-052). Inscription (16 ACC-001), connexion par mot de passe, sessions
 * serveur, déconnexion, vérification d'email. Les autres modules ne voient que
 * `AuthenticationPort` (résolution d'un jeton en principal) et `SessionGuard`.
 *
 * Sécurité :
 * - mot de passe : argon2id seulement (critère 1) ; réponses identiques et coût identique pour un
 *   email inconnu, un mauvais mot de passe ou un compte fermé (vérification factice) ;
 * - session : jeton neuf à chaque connexion ; le jeton présenté avant la connexion est révoqué
 *   (`ROTATED`) et jamais réutilisé (fixation de session) ; expiration et révocation jugées par
 *   la base (`platform.now()`) ;
 * - aucun jeton, mot de passe ou email dans un journal ou une erreur.
 */
import { Inject, Injectable } from '@nestjs/common';
import { CountryConfigService } from '../../cfg/index.js';
import type { AcceptedDocument, AuthStore, HostAccount, MfaLevel } from './auth-store.js';
import { SignupDocumentsError } from './auth-store.js';
import { AuthHttpError } from './errors.js';
import type { IdentityNotifier } from './notifier.js';
import type { Argon2idPasswordHasher } from './password-hasher.js';
import type { AuthPolicy } from './policy.js';
import { isWellFormedToken, newOpaqueToken, tokenHash } from './session-token.js';
import { FixedWindowLimiter } from './throttle.js';
import {
  IAM_AUTH_STORE,
  IAM_CLOCK,
  IAM_NOTIFIER,
  IAM_PASSWORD_HASHER,
  IAM_POLICY,
} from './tokens.js';
import type { Clock } from './tokens.js';
import { uuidV7 } from './uuid-v7.js';

/** Principal authentifié d'une requête. */
export interface AuthenticatedPrincipal {
  readonly userId: string;
  readonly sessionId: string;
  readonly mfaLevel: MfaLevel;
  readonly expiresAt: Date;
  /** À exiger par les modules avant une action sensible (réserver, publier une annonce). */
  readonly emailVerified: boolean;
}

/**
 * Port d'authentification vu par les autres modules : remplacer l'implémentation (service géré,
 * ADR-021) ne touche qu'à l'adaptateur.
 */
export interface AuthenticationPort {
  /** Principal d'un jeton de session valide, sinon `null` (l'appelant répond 401). */
  resolveSession(token: string | null): Promise<AuthenticatedPrincipal | null>;
}

export interface RequestContext {
  readonly ip: string | null;
  readonly userAgent: string | null;
}

export interface SignupInput {
  readonly email: unknown;
  readonly password: unknown;
  readonly legalFirstName: unknown;
  readonly legalLastName: unknown;
  readonly locale: unknown;
  readonly termsAccepted: unknown;
  /** US-102 : versions affichées `[{ kind, version }]`, OBLIGATOIRES (absentes : 409). */
  readonly acceptedDocuments?: unknown;
  /** US-102 : opt-in des communications commerciales (absent : non). */
  readonly marketingOptIn?: unknown;
  /** US-102 : pays du parcours (portée des documents ; absent : documents communs). */
  readonly country?: unknown;
}

export interface LoginInput {
  readonly email: unknown;
  readonly password: unknown;
}

export interface OpenedSession {
  readonly token: string;
  readonly expiresAt: Date;
}

const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COUNTRY_FORMAT = /^[A-Z]{2}$/;
/** Pays déclarés par la configuration (CFG) : un pays inconnu est refusé avant toute écriture. */
const KNOWN_COUNTRIES: ReadonlySet<string> = new Set(
  new CountryConfigService().config.countries.keys(),
);
const DOCUMENT_KINDS = new Set(['TOS_GUEST', 'PRIVACY']);
/** Corps de l'ouverture d'un compte d'hôte (US-107) : ces deux champs seulement. */
const HOST_ACCOUNT_FIELDS = new Set(['country', 'holderKind']);
const HOLDER_KINDS = new Set(['INDIVIDUAL', 'LEGAL_ENTITY']);
/**
 * Champs qui désignent une personne morale (raison sociale, nom commercial, numéro fiscal
 * d'entreprise) : leur seule présence est un refus `HOST_ENTITY_NOT_ALLOWED` (DEC-FONDATEUR-13).
 */
const LEGAL_ENTITY_FIELDS = new Set([
  'legalName',
  'tradeName',
  'companyName',
  'businessName',
  'companyTaxId',
  'legalEntity',
]);

/** Versions affichées (US-102) : `null` si absentes, `undefined` si mal formées. */
function acceptedDocuments(value: unknown): readonly AcceptedDocument[] | null | undefined {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) return undefined;
  const out: AcceptedDocument[] = [];
  for (const item of value as unknown[]) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return undefined;
    const { kind, version } = item as { kind?: unknown; version?: unknown };
    if (typeof kind !== 'string' || !DOCUMENT_KINDS.has(kind)) return undefined;
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return undefined;
    if (out.some((d) => d.kind === kind)) return undefined;
    out.push({ kind: kind as AcceptedDocument['kind'], version });
  }
  return out;
}
const LOCALE_FORMAT = /^[a-z]{2}(-[A-Z]{2})?$/;

/** Email normalisé (trim, minuscules, NFC), ou `null` s'il est mal formé. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.normalize('NFC').trim().toLowerCase();
  if (email.length < 3 || email.length > 254 || !EMAIL_FORMAT.test(email)) return null;
  return email;
}

function legalName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.normalize('NFC').trim();
  return name.length >= 1 && name.length <= 100 ? name : null;
}

@Injectable()
export class AuthService implements AuthenticationPort {
  readonly #loginByEmail: FixedWindowLimiter;
  readonly #loginByIp: FixedWindowLimiter;
  readonly #signupByIp: FixedWindowLimiter;
  #dummyHash: Promise<string> | undefined;

  constructor(
    @Inject(IAM_AUTH_STORE) private readonly store: AuthStore,
    @Inject(IAM_NOTIFIER) private readonly notifier: IdentityNotifier,
    @Inject(IAM_PASSWORD_HASHER) private readonly hasher: Argon2idPasswordHasher,
    @Inject(IAM_POLICY) private readonly policy: AuthPolicy,
    @Inject(IAM_CLOCK) private readonly clock: Clock,
  ) {
    this.#loginByEmail = new FixedWindowLimiter(
      policy.loginFailuresPerEmail,
      policy.loginWindowMs,
      clock,
    );
    this.#loginByIp = new FixedWindowLimiter(
      policy.loginFailuresPerIp,
      policy.loginWindowMs,
      clock,
    );
    this.#signupByIp = new FixedWindowLimiter(policy.signupsPerIp, policy.signupWindowMs, clock);
  }

  /** Hachage d'un mot de passe aléatoire : vérification factice à coût égal (anti-énumération). */
  #dummy(): Promise<string> {
    this.#dummyHash ??= this.hasher.hash(newOpaqueToken());
    return this.#dummyHash;
  }

  #checkPassword(value: unknown): string {
    if (typeof value !== 'string') throw new AuthHttpError('REQUEST_INVALID');
    const min = this.policy.passwordMinLength;
    if ([...value].length < min) throw new AuthHttpError('AUTH_PASSWORD_WEAK', { min });
    if (Buffer.byteLength(value, 'utf8') > this.policy.passwordMaxBytes) {
      throw new AuthHttpError('REQUEST_INVALID');
    }
    return value;
  }

  /**
   * Inscription (16 ACC-001). Même issue, que l'email soit libre ou déjà pris : l'appelant
   * répond toujours `SIGNUP_ACCEPTED` ; seul le message envoyé par email diffère.
   */
  async signup(input: SignupInput, ctx: RequestContext): Promise<void> {
    if (!this.#signupByIp.hit(FixedWindowLimiter.key('signup', ctx.ip ?? '-'))) {
      throw new AuthHttpError('RATE_LIMITED');
    }
    if (input.termsAccepted !== true) throw new AuthHttpError('AUTH_TERMS_NOT_ACCEPTED');
    const email = normalizeEmail(input.email);
    if (email === null) throw new AuthHttpError('AUTH_EMAIL_INVALID');
    const password = this.#checkPassword(input.password);
    const first = legalName(input.legalFirstName);
    const last = legalName(input.legalLastName);
    const locale =
      typeof input.locale === 'string' && LOCALE_FORMAT.test(input.locale) ? input.locale : null;
    if (first === null || last === null || locale === null)
      throw new AuthHttpError('REQUEST_INVALID');
    const documents = acceptedDocuments(input.acceptedDocuments);
    const marketing = input.marketingOptIn ?? false;
    const country = input.country ?? null;
    if (
      documents === undefined ||
      typeof marketing !== 'boolean' ||
      (country !== null && (typeof country !== 'string' || !COUNTRY_FORMAT.test(country)))
    ) {
      throw new AuthHttpError('REQUEST_INVALID');
    }
    // pays inconnu : même refus que l'email soit libre ou pris (contrôlé aussi par la base)
    if (country !== null && !KNOWN_COUNTRIES.has(country as string)) {
      throw new AuthHttpError('COUNTRY_UNKNOWN');
    }
    // un client direct de l'API ne consent jamais « à l'aveugle » : la version affichée est exigée
    if (documents === null) throw new AuthHttpError('TERMS_VERSION_CHANGED');

    const passwordHash = await this.hasher.hash(password); // toujours calculé : coût égal
    const verificationToken = newOpaqueToken();
    const userId = uuidV7(this.clock());
    let created: boolean;
    try {
      created = await this.store.registerAccount({
        userId,
        email,
        passwordHash,
        legalFirstName: first,
        legalLastName: last,
        preferredLocale: locale,
        verificationId: uuidV7(this.clock()),
        verificationTokenHash: tokenHash(verificationToken),
        verificationTtlS: this.policy.emailVerificationTtlS,
        ip: ctx.ip,
        country,
        documents,
        marketingOptIn: marketing,
      });
    } catch (error) {
      if (!(error instanceof SignupDocumentsError)) throw error;
      // même issue que l'email soit libre ou pris : contrôlé par la base AVANT le compte
      throw new AuthHttpError(
        error.reason === 'VERSION_CHANGED'
          ? 'TERMS_VERSION_CHANGED'
          : error.reason === 'UNAVAILABLE'
            ? 'LEGAL_DOCUMENT_UNAVAILABLE'
            : error.reason === 'COUNTRY_UNKNOWN'
              ? 'COUNTRY_UNKNOWN'
              : 'REQUEST_INVALID',
      );
    }
    if (created) {
      await this.notifier.sendEmailVerification({
        userId,
        email,
        locale,
        token: verificationToken,
      });
    } else {
      await this.notifier.sendAccountExists({ email, locale });
    }
  }

  /**
   * Connexion par mot de passe. `presentedToken` = jeton déjà porté par le navigateur : il est
   * révoqué, et un jeton NEUF est toujours émis (parade à la fixation de session).
   */
  async login(
    input: LoginInput,
    ctx: RequestContext,
    presentedToken: string | null,
  ): Promise<OpenedSession> {
    const email = normalizeEmail(input.email);
    const password = typeof input.password === 'string' ? input.password : null;
    if (password === null || Buffer.byteLength(password, 'utf8') > this.policy.passwordMaxBytes) {
      throw new AuthHttpError('REQUEST_INVALID');
    }
    const emailKey = FixedWindowLimiter.key('login-email', email ?? '-');
    const ipKey = FixedWindowLimiter.key('login-ip', ctx.ip ?? '-');
    if (this.#loginByEmail.isBlocked(emailKey) || this.#loginByIp.isBlocked(ipKey)) {
      throw new AuthHttpError('RATE_LIMITED');
    }

    const credentials = email === null ? null : await this.store.findCredentials(email);
    const stored = credentials?.passwordHash ?? null;
    // vérification toujours faite (hachage réel ou factice) : coût égal pour un email inconnu
    const verified = await this.hasher.verify(stored ?? (await this.#dummy()), password);
    const loginable =
      credentials !== null &&
      stored !== null &&
      verified &&
      credentials.status !== 'CLOSED' &&
      credentials.status !== 'BANNED';

    if (!loginable || credentials === null) {
      this.#loginByEmail.hit(emailKey);
      this.#loginByIp.hit(ipKey);
      throw new AuthHttpError('AUTH_INVALID_CREDENTIALS');
    }

    if (presentedToken !== null && isWellFormedToken(presentedToken)) {
      await this.store.revokeSession(tokenHash(presentedToken), 'ROTATED');
    }
    const token = newOpaqueToken();
    const expiresAt = await this.store.openSession({
      sessionId: uuidV7(this.clock()),
      userId: credentials.userId,
      tokenHash: tokenHash(token),
      ttlS: this.policy.sessionTtlS,
      mfaLevel: 'NONE',
      ip: ctx.ip,
      userAgent: ctx.userAgent === null ? null : ctx.userAgent.slice(0, 512),
    });
    if (expiresAt === null) {
      this.#loginByEmail.hit(emailKey);
      this.#loginByIp.hit(ipKey);
      throw new AuthHttpError('AUTH_INVALID_CREDENTIALS');
    }
    this.#loginByEmail.reset(emailKey);
    return { token, expiresAt };
  }

  async resolveSession(token: string | null): Promise<AuthenticatedPrincipal | null> {
    if (!isWellFormedToken(token)) return null;
    const record = await this.store.resolveSession(tokenHash(token));
    if (record === null) return null;
    return {
      userId: record.userId,
      sessionId: record.sessionId,
      mfaLevel: record.mfaLevel,
      expiresAt: record.expiresAt,
      emailVerified: record.emailVerified,
    };
  }

  /** Déconnexion : révocation définitive de la session présentée (idempotente). */
  async logout(token: string | null): Promise<void> {
    if (isWellFormedToken(token)) await this.store.revokeSession(tokenHash(token), 'LOGOUT');
  }

  /** « Se déconnecter partout » ; exige une session valide. */
  async logoutAll(token: string | null): Promise<number> {
    if (!isWellFormedToken(token)) throw new AuthHttpError('AUTH_REQUIRED');
    const n = await this.store.revokeAllSessions(tokenHash(token));
    if (n === 0) throw new AuthHttpError('AUTH_REQUIRED');
    return n;
  }

  /**
   * Ouverture du compte d'hôte de la personne de la session (US-107 ; 19 US-107, 08 BR-ACC-06,
   * DEC-FONDATEUR-13). Corps : `{ country, holderKind }` seulement. Toute donnée de personne
   * morale (raison sociale, nom commercial, numéro fiscal d'entreprise) ou `holderKind` autre
   * qu'`INDIVIDUAL` : `HOST_ENTITY_NOT_ALLOWED`. Aucun nom n'est reçu : le nom affiché est le
   * prénom légal du titulaire, recopié par la base. Rend l'identifiant du compte ouvert.
   */
  async openHostAccount(proof: Buffer | null, body: Record<string, unknown>): Promise<string> {
    if (proof === null) throw new AuthHttpError('AUTH_REQUIRED');
    if (Object.keys(body).some((k) => LEGAL_ENTITY_FIELDS.has(k))) {
      throw new AuthHttpError('HOST_ENTITY_NOT_ALLOWED');
    }
    if (Object.keys(body).some((k) => !HOST_ACCOUNT_FIELDS.has(k))) {
      throw new AuthHttpError('REQUEST_INVALID');
    }
    const { country, holderKind } = body;
    if (typeof holderKind !== 'string' || !HOLDER_KINDS.has(holderKind)) {
      throw new AuthHttpError('REQUEST_INVALID');
    }
    if (holderKind !== 'INDIVIDUAL') throw new AuthHttpError('HOST_ENTITY_NOT_ALLOWED');
    if (typeof country !== 'string' || !COUNTRY_FORMAT.test(country)) {
      throw new AuthHttpError('REQUEST_INVALID');
    }
    if (!KNOWN_COUNTRIES.has(country)) throw new AuthHttpError('COUNTRY_UNKNOWN');
    const r = await this.store.openHostAccount(proof, country, 'INDIVIDUAL');
    switch (r.outcome) {
      case 'DONE':
        if (r.orgId === null) throw new Error('IAM : compte d’hôte ouvert sans identifiant');
        return r.orgId;
      case 'AUTH_REQUIRED':
      case 'HOST_ENTITY_NOT_ALLOWED':
      case 'COUNTRY_UNKNOWN':
      case 'HOST_ACCOUNT_NOT_ELIGIBLE':
      case 'HOST_UNDER_AGE':
      case 'HOST_ACCOUNT_EXISTS':
        throw new AuthHttpError(r.outcome);
      case 'PARAM_MISSING':
        // paramètre du pays absent (fail-closed, 17 §7.1) : service indisponible, sans détail
        throw new AuthHttpError('HOST_ACCOUNT_UNAVAILABLE');
    }
  }

  /** Rôles et comptes d'hôte de la personne de la session (rôle P2P_HOST à la reconnexion). */
  async hostAccounts(proof: Buffer | null): Promise<HostAccount[]> {
    return proof === null ? [] : this.store.hostAccounts(proof);
  }

  /** Lien de vérification d'email (usage unique) ; inconnu, consommé ou expiré : même erreur. */
  async verifyEmail(token: unknown): Promise<void> {
    if (typeof token !== 'string' || !isWellFormedToken(token)) {
      throw new AuthHttpError('AUTH_LINK_EXPIRED');
    }
    if (!(await this.store.verifyEmail(tokenHash(token)))) {
      throw new AuthHttpError('AUTH_LINK_EXPIRED');
    }
  }
}
