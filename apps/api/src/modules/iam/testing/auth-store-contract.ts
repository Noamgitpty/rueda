/**
 * Contrat commun du port de persistance `AuthStore` — TESTS SEULEMENT. Exécuté sur le FAKE
 * (`fake-auth-store.test.ts`, test:unit) et sur PostgreSQL sous app_api
 * (`pg-auth-store.int.test.ts`, test:int) : le FAKE ne peut pas diverger silencieusement.
 * Valeurs attendues : 17 §3.2.1, 16 ACC-001, ADR-052 (pas le code testé).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AuthStore } from '../internal/auth-store.js';
import { newOpaqueToken, tokenHash } from '../internal/session-token.js';
import { CountryConfigService } from '../../cfg/index.js';

/** Pays configurés (données de configuration, jamais une constante du code). */
const COUNTRIES = [...new CountryConfigService().config.countries.keys()].sort();

export interface ContractHarness {
  readonly store: AuthStore;
  release(): Promise<void>;
}

const phc = (): string => {
  const b64 = (n: number) => randomBytes(n).toString('base64').replace(/=+$/, '');
  return `$argon2id$v=19$m=65536,t=3,p=1$${b64(16)}$${b64(32)}`;
};

async function register(store: AuthStore, email = `c-${randomUUID()}@example.test`) {
  const userId = randomUUID();
  const verificationToken = newOpaqueToken();
  const created = await store.registerAccount({
    userId,
    email,
    passwordHash: phc(),
    legalFirstName: 'Ana',
    legalLastName: 'Pérez',
    preferredLocale: 'fr',
    verificationId: randomUUID(),
    verificationTokenHash: tokenHash(verificationToken),
    verificationTtlS: 86_400,
    ip: '198.51.100.4',
    documents: [
      { kind: 'TOS_GUEST', version: 1 },
      { kind: 'PRIVACY', version: 1 },
    ],
  });
  return { created, userId, email, verificationToken };
}

async function open(store: AuthStore, userId: string, ttlS = 1_209_600) {
  const token = newOpaqueToken();
  const expiresAt = await store.openSession({
    sessionId: randomUUID(),
    userId,
    tokenHash: tokenHash(token),
    ttlS,
    mfaLevel: 'NONE',
    ip: null,
    userAgent: 'contract',
  });
  return { token, expiresAt };
}

export function authStoreContract(name: string, harness: () => Promise<ContractHarness>): void {
  const withStore = async (fn: (store: AuthStore) => Promise<void>) => {
    const h = await harness();
    try {
      await fn(h.store);
    } finally {
      await h.release();
    }
  };

  describe(`contrat AuthStore — ${name}`, () => {
    it('inscription : email libre => true, déjà pris => false ; lecture des éléments de connexion', () =>
      withStore(async (store) => {
        const a = await register(store);
        expect(a.created).toBe(true);
        expect((await register(store, a.email)).created).toBe(false);
        const c = await store.findCredentials(a.email);
        expect(c).toMatchObject({ userId: a.userId, status: 'PENDING_EMAIL' });
        expect(c?.passwordHash).toMatch(/^\$argon2id\$v=19\$/);
        expect(await store.findCredentials(`absent-${randomUUID()}@example.test`)).toBeNull();
      }));

    it('critère 1 : un mot de passe en clair à la place du hachage est refusé', () =>
      withStore(async (store) => {
        await expect(
          store.registerAccount({
            userId: randomUUID(),
            email: `p-${randomUUID()}@example.test`,
            passwordHash: 'Correct-Horse-9',
            legalFirstName: 'A',
            legalLastName: 'B',
            preferredLocale: 'en',
            verificationId: randomUUID(),
            verificationTokenHash: tokenHash(newOpaqueToken()),
            verificationTtlS: 86_400,
            ip: null,
            documents: [
              { kind: 'TOS_GUEST', version: 1 },
              { kind: 'PRIVACY', version: 1 },
            ],
          }),
        ).rejects.toThrow();
      }));

    it('critère 2 : session révoquée => plus résolue ; seconde révocation sans effet', () =>
      withStore(async (store) => {
        const a = await register(store);
        const s = await open(store, a.userId);
        expect(s.expiresAt).toBeInstanceOf(Date);
        expect(await store.resolveSession(tokenHash(s.token))).toMatchObject({
          userId: a.userId,
          mfaLevel: 'NONE',
        });
        expect(await store.revokeSession(tokenHash(s.token), 'LOGOUT')).toBe(true);
        expect(await store.resolveSession(tokenHash(s.token))).toBeNull();
        expect(await store.revokeSession(tokenHash(s.token), 'LOGOUT')).toBe(false);
        expect(await store.resolveSession(tokenHash(newOpaqueToken()))).toBeNull();
      }));

    it('« se déconnecter partout » : toutes les sessions du titulaire, aucune d’un autre', () =>
      withStore(async (store) => {
        const a = await register(store);
        const b = await register(store);
        const a1 = await open(store, a.userId);
        const a2 = await open(store, a.userId);
        const b1 = await open(store, b.userId);
        expect(await store.revokeAllSessions(tokenHash(a2.token))).toBe(2);
        expect(await store.resolveSession(tokenHash(a1.token))).toBeNull();
        expect(await store.resolveSession(tokenHash(b1.token))).not.toBeNull();
        expect(await store.revokeAllSessions(tokenHash(a1.token))).toBe(0);
      }));

    it('compte inconnu : aucune session ; durée hors bornes : refusée', () =>
      withStore(async (store) => {
        expect((await open(store, randomUUID())).expiresAt).toBeNull();
        const a = await register(store);
        await expect(open(store, a.userId, 299)).rejects.toThrow();
      }));

    it('lien de vérification : usage unique, PENDING_EMAIL -> ACTIVE, sessions antérieures révoquées', () =>
      withStore(async (store) => {
        const a = await register(store);
        const before = await open(store, a.userId);
        expect((await store.resolveSession(tokenHash(before.token)))?.emailVerified).toBe(false);
        expect(await store.verifyEmail(tokenHash(a.verificationToken))).toBe(true);
        expect(await store.resolveSession(tokenHash(before.token))).toBeNull();
        const after = await open(store, a.userId);
        expect((await store.resolveSession(tokenHash(after.token)))?.emailVerified).toBe(true);
        expect(await store.verifyEmail(tokenHash(a.verificationToken))).toBe(false);
        expect((await store.findCredentials(a.email))?.status).toBe('ACTIVE');
      }));

    // US-107 : compte d'hôte d'une personne physique, un par pays (19 US-107, 17 §2.3, §3.2.1)
    it.each(COUNTRIES)(
      'compte d’hôte (%s) : personne vérifiée => DONE, titulaire P2P_HOST, nom affiché = prénom ; seconde demande => HOST_ACCOUNT_EXISTS ; personne morale => HOST_ENTITY_NOT_ALLOWED',
      (country) =>
        withStore(async (store) => {
          const a = await register(store);
          const b = await register(store);
          await store.verifyEmail(tokenHash(a.verificationToken));
          await store.verifyEmail(tokenHash(b.verificationToken));
          const sa = tokenHash((await open(store, a.userId)).token);
          const sb = tokenHash((await open(store, b.userId)).token);
          expect(await store.hostAccounts(sa)).toEqual([]);
          expect(await store.openHostAccount(sa, country, 'LEGAL_ENTITY')).toEqual({
            outcome: 'HOST_ENTITY_NOT_ALLOWED',
            orgId: null,
          });
          const r = await store.openHostAccount(sa, country, 'INDIVIDUAL');
          expect(r.outcome).toBe('DONE');
          expect(r.orgId).toMatch(/^[0-9a-f-]{36}$/);
          expect(await store.openHostAccount(sa, country, 'INDIVIDUAL')).toEqual({
            outcome: 'HOST_ACCOUNT_EXISTS',
            orgId: null,
          });
          // reconnexion : nouvelle session, le compte d'hôte est porté ; jamais celui d'un autre
          const again = tokenHash((await open(store, a.userId)).token);
          expect(await store.hostAccounts(again)).toEqual([
            { orgId: r.orgId, country, role: 'P2P_HOST', status: 'ONBOARDING', displayName: 'Ana' },
          ]);
          expect(await store.hostAccounts(sb)).toEqual([]);
        }),
    );

    it('compte d’hôte : session invalide => AUTH_REQUIRED ; e-mail non vérifié => HOST_ACCOUNT_NOT_ELIGIBLE ; pays non configuré => COUNTRY_UNKNOWN', () =>
      withStore(async (store) => {
        const country = COUNTRIES[0] ?? '';
        expect(
          await store.openHostAccount(tokenHash(newOpaqueToken()), country, 'INDIVIDUAL'),
        ).toEqual({ outcome: 'AUTH_REQUIRED', orgId: null });
        const a = await register(store);
        const s = tokenHash((await open(store, a.userId)).token);
        expect(await store.openHostAccount(s, country, 'INDIVIDUAL')).toEqual({
          outcome: 'HOST_ACCOUNT_NOT_ELIGIBLE',
          orgId: null,
        });
        expect(await store.openHostAccount(s, 'ZZ', 'INDIVIDUAL')).toEqual({
          outcome: 'COUNTRY_UNKNOWN',
          orgId: null,
        });
        expect(await store.hostAccounts(s)).toEqual([]);
      }));
  });
}
