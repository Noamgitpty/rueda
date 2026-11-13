// Double de l'API des comptes et des consentements pour les parcours e2e (US-102) — TESTS
// SEULEMENT, démarré par Playwright (playwright.config.ts) sur 127.0.0.1. Il répond comme le
// contrat apps/api/openapi/openapi.json (codes stables, corps { code, messageKey }, cookie
// __Host-session) pour les routes que le site appelle CÔTÉ SERVEUR : le navigateur ne le voit
// jamais. La vraie API est prouvée par ses propres tests (contrat, intégration, L0).
//
// État : documents en vigueur (CGU v2 majeure, confidentialité v1, communications v1, BROUILLON),
// comptes inscrits, sessions. Un compte `reaccept-<nom>@example.test` (créé à sa première
// connexion, un par parcours) a accepté les CGU v1 : l'API exige la réacceptation (critère 3). `GET /__e2e/signups` rend les inscriptions
// reçues (sans mot de passe) au test, jamais au navigateur.
//
// Téléphone par OTP (US-104) : un compte `phone-<nom>@example.test` (créé à sa première connexion,
// documents à jour) parcourt l'étape OTP de S15. Pays et plans de numérotation : données de
// configuration du dépôt (countries.json), jamais une constante. Le « SMS » du double porte
// toujours le code `OTP_CODE` ; 5 codes faux bloquent (16 VER-013).
//
// Vérification d'identité (US-105) : un compte `identity-<nom>@example.test` (créé à sa première
// connexion, documents à jour, téléphone vérifié) parcourt S04 : consentement biométrique v1
// (texte BROUILLON), ouverture du parcours hébergé (adresse `https://identity.fake.invalid/…`,
// jamais résolue : le test l'intercepte), décision posée par `GET /__e2e/identity/approve`.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const PORT = Number(process.env.RUEDA_E2E_API_PORT ?? 3199);
const VERSIONS = { TOS_GUEST: 2, PRIVACY: 1, MARKETING: 1 };
const MAJOR = { TOS_GUEST: true, PRIVACY: true, MARKETING: true };
const LANGS = ['es', 'en', 'fr', 'pt'];
const MARK = {
  es: 'BORRADOR — pendiente de validación jurídica',
  en: 'DRAFT — pending legal review',
  fr: 'BROUILLON — à valider par le juridique',
  pt: 'RASCUNHO — pendente de validação jurídica',
};
const REACCEPT = /^reaccept-[a-z0-9-]+@example\.test$/;
const PASSWORD_MIN = 10;
// pays inconnu de la configuration (jeton fictif, jamais un vrai pays) : 400 COUNTRY_UNKNOWN
const UNKNOWN_COUNTRY = 'ZZ';

const PHONE_ACCOUNT = /^phone-[a-z0-9-]+@example\.test$/;
const OTP_CODE = '246810';
const OTP_MAX_ATTEMPTS = 5;
const COUNTRIES = JSON.parse(
  readFileSync(new URL('../../api/src/modules/cfg/data/countries.json', import.meta.url), 'utf8'),
).countries.map((c) => ({
  code: c.code,
  names: c.names,
  callingCode: c.phone.callingCode,
  nationalLength: c.phone.nationalLength,
  example: c.phone.example,
  trunkPrefix: c.phone.trunkPrefix,
  mobilePrefixes: c.phone.mobilePrefixes,
}));
const phones = new Map();

const IDENTITY_ACCOUNT = /^identity-[a-z0-9-]+@example\.test$/;
const BIOMETRIC_TITLE = {
  es: 'Consentimiento para la verificación biométrica (BORRADOR)',
  en: 'Consent to biometric verification (DRAFT)',
  fr: 'Consentement à la vérification biométrique (BROUILLON)',
  pt: 'Consentimento para a checagem biométrica (RASCUNHO)',
};
const identities = new Map();
let identitySessions = 0;
const identityOf = (email) => {
  const i = identities.get(email) ?? {
    consent: null,
    status: 'NOT_STARTED',
    session: null,
    reason: null,
  };
  identities.set(email, i);
  return i;
};
const identityView = (i, lang) => ({
  code: 'KYC_STATE',
  status: i.status,
  country: i.session?.country ?? null,
  reasonCode: i.reason ?? null,
  licenseExpiresOn: i.status === 'APPROVED' ? '2031-06-30' : null,
  sessionLive: i.status === 'DOCS_SUBMITTED',
  phoneVerified: true,
  available: true,
  consent: {
    version: 1,
    accepted: i.consent === 1,
    locale: lang,
    title: BIOMETRIC_TITLE[lang],
    bodyMd: `**${MARK[lang]}**

BIOMETRIC_CONSENT ${lang}`,
  },
  countries: COUNTRIES.map((c) => ({ code: c.code, names: c.names })),
});

/** Même règle que l'API (plan du pays) : forme nationale ou internationale, mobiles seulement. */
const normalize = (raw, country) => {
  const c = COUNTRIES.find((x) => x.code === country);
  if (!c || typeof raw !== 'string') return null;
  let d = raw.replace(/[\s.\-()]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else
    d = `${c.callingCode}${c.trunkPrefix && d.length === c.nationalLength + c.trunkPrefix.length && d.startsWith(c.trunkPrefix) ? d.slice(c.trunkPrefix.length) : d}`;
  if (!/^[0-9]+$/.test(d) || !d.startsWith(c.callingCode)) return null;
  const n = d.slice(c.callingCode.length);
  if (n.length !== c.nationalLength || !c.mobilePrefixes.some((p) => n.startsWith(p))) return null;
  return { e164: `+${d}`, country: c };
};
const mask = (e164, c) => {
  const n = e164.slice(c.callingCode.length + 1);
  return `+${c.callingCode} ${'•'.repeat(n.length - 2)}${n.slice(-2)}`;
};
const phoneState = (email) => {
  const p = phones.get(email) ?? { verified: null, pending: null, locked: false };
  phones.set(email, p);
  return p;
};
const phoneView = (p) => ({
  verified: p.verified !== null,
  phone: p.verified,
  pending:
    p.pending === null || p.locked
      ? null
      : {
          phone: p.pending.masked,
          resendAfterS: Math.max(0, Math.ceil((p.pending.resendAt - Date.now()) / 1000)),
          expiresInS: 600,
          attemptsLeft: OTP_MAX_ATTEMPTS - p.pending.attempts,
        },
  lockedForS: p.locked ? 3600 : null,
  countries: COUNTRIES.map(({ code, names, callingCode, nationalLength, example }) => ({
    code,
    names,
    callingCode,
    nationalLength,
    example,
  })),
});

const signups = [];
const accounts = new Map();
const sessions = new Map();

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(body === undefined ? '' : JSON.stringify(body));
};
const err = (res, status, code, messageKey, values) =>
  json(res, status, { code, messageKey, ...(values ? { values } : {}) });

const languageOf = (url) => {
  const l = (url.searchParams.get('locale') ?? '').slice(0, 2);
  return LANGS.includes(l) ? l : null;
};
const doc = (kind, lang) => ({
  kind,
  version: VERSIONS[kind],
  isMajor: MAJOR[kind],
  locale: lang,
  title: `${kind} (${lang})`,
  contentHash: '0'.repeat(64),
  draft: true,
  validFrom: '2026-01-01T00:00:00.000Z',
});

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(null);
      }
    });
  });

const sessionOf = (req) => {
  const m = /__Host-session=([A-Za-z0-9_-]{43})/.exec(req.headers.cookie ?? '');
  return m ? sessions.get(m[1]) : undefined;
};

const statusOf = (email) => {
  const a = accounts.get(email);
  const rows = ['MARKETING', 'PRIVACY', 'TOS_GUEST'].map((kind) => {
    const required = kind !== 'MARKETING';
    const acc = a?.accepted[kind] ?? null;
    return {
      kind,
      required,
      currentVersion: VERSIONS[kind],
      requiredVersion: VERSIONS[kind],
      acceptedVersion: acc,
      accepted: acc !== null,
      reacceptRequired: required && (acc === null || acc < VERSIONS[kind]),
    };
  });
  const pending = rows.some((r) => r.reacceptRequired);
  return {
    code: pending ? 'TERMS_REACCEPT_REQUIRED' : 'TERMS_CURRENT',
    messageKey: pending ? 'common.legal.reacceptRequired' : 'common.legal.current',
    documents: rows,
    marketingOptIn: false,
  };
};

// ---- Espace de l'hôte et fiche publique (US-115) --------------------------------------------
// Session `H0st…` (43 caractères) inconnue : deux comptes d'hôte neufs lui sont créés (un par
// parcours, aucun partage d'état entre tests parallèles) : le premier dans un marché à deux
// décimales (XTS) où le dépôt des photos est FERMÉ comme en production (antivirus et stockage pas
// encore branchés : 503), le second dans un marché SANS décimale (XXX, exposant 0, comme le PYG)
// où le dépôt est ouvert avec une petite taille maximale (413 au-delà) ; `N0ho…` : session sans
// compte d'hôte. Fiches publiques : `PUBLIC_ID` publiée, `DOWN_ID` en panne (503), le reste 404.
// Données fictives ; la fiche publique ne porte que des colonnes C0 (aucune adresse exacte).
const HOST_TOKEN = /^H0st[A-Za-z0-9_-]{39}$/;
const NOHOST_TOKEN = /^N0ho[A-Za-z0-9_-]{39}$/;
const PUBLIC_ID = '11500000-0000-4000-8000-00000000f001';
const DOWN_ID = '11500000-0000-4000-8000-00000000f503';
const hosts = new Map();
const uuid = () => {
  const h = randomBytes(16).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const tokenOf = (req) => /__Host-session=([A-Za-z0-9_-]{43})/.exec(req.headers.cookie ?? '')?.[1];
const hostOf = (req) => {
  const token = tokenOf(req);
  if (token === undefined) return undefined;
  if (NOHOST_TOKEN.test(token)) return null;
  if (!HOST_TOKEN.test(token)) return undefined;
  if (!hosts.has(token)) {
    const account = (market, photoUploads) => ({
      orgId: uuid(),
      market,
      photoUploads,
      locations: [],
      vehicles: [],
      listings: [],
      // CGU de l'hôte (US-126) : jamais acceptées à l'ouverture
      terms: { acceptedVersion: null, acceptedAt: null },
    });
    hosts.set(token, {
      accounts: [
        account(MARKET, { open: false, maxBytes: 75_000 }),
        account(MARKET_NO_DECIMALS, { open: true, maxBytes: 2_000 }),
      ],
    });
  }
  return hosts.get(token);
};
// devises de test ISO 4217 (XTS, XXX) et pays réservés : aucune vraie devise ni aucun vrai pays
// écrits ici (ADR-024)
const MARKET = { country: 'ZZ', currency: 'XTS', currencyExponent: 2 };
const HOST_TERMS_VERSION = 1;
const hostTermsDoc = (lang) => ({
  kind: 'TOS_HOST',
  version: HOST_TERMS_VERSION,
  isMajor: true,
  locale: lang,
  title: `TOS_HOST (${lang})`,
  contentHash: '0'.repeat(64),
  draft: true,
  validFrom: '2026-01-01T00:00:00.000Z',
});
const MARKET_NO_DECIMALS = { country: 'QZ', currency: 'XXX', currencyExponent: 0 };

// ---- Vérification de l'hôte (US-123) : liste de tâches A07 -----------------------------------
// Double : identité et âge déjà vérifiés ; un type de numéro fiscal NEUTRE (données fictives, aucun
// type propre à un pays) ; envoi ⇒ filtrage fait, dossier en revue si les CGU sont acceptées (numéro
// fiscal facultatif, ADR-115) ;
// `GET /__e2e/host-verification/approve?token=` ⇒ dossier approuvé, compte en attente
// d'activation, pays pas encore ouvert (interrupteurs fermés, comme la production).
const TAX_KINDS = ['TAX_NUMBER'];
const verificationOf = (h) => {
  h.verification ??= { status: null, orgStatus: 'ONBOARDING', taxKind: null, screening: false };
  return h.verification;
};
const verificationView = (h, code, messageKey) => {
  const v = verificationOf(h);
  const terms = h.terms.acceptedVersion !== null;
  const missing = [
    ...(v.screening ? [] : ['HOST_SCREENING_MISSING']),
    // numéro fiscal facultatif (graine false en PA et en PY, ADR-115) : jamais une pièce manquante
    ...(terms ? [] : ['TERMS_REACCEPT_REQUIRED']),
  ];
  return {
    code,
    messageKey,
    country: h.market.country,
    orgStatus: v.orgStatus,
    verificationStatus: v.status,
    missing: v.status === null || v.status === 'APPROVED' ? [] : missing,
    kycApproved: true,
    ageStatus: 'OK',
    residenceStatus: 'VERIFIED',
    taxRequired: false,
    taxSaved: v.taxKind !== null,
    taxKind: v.taxKind,
    taxKinds: TAX_KINDS,
    termsAccepted: terms,
    screeningDone: v.screening,
    blockers:
      v.status === 'APPROVED'
        ? ['SUBMERCHANT_NOT_ACTIVE', 'P2P_HOSTS_DISABLED', 'INSURER_CONTRACT_INACTIVE']
        : [
            ...(terms ? [] : ['TERMS_REACCEPT_REQUIRED']),
            'HOST_VERIFICATION_NOT_APPROVED',
            'SUBMERCHANT_NOT_ACTIVE',
            'P2P_HOSTS_DISABLED',
            'INSURER_CONTRACT_INACTIVE',
          ],
  };
};

async function verificationRoute(req, res, path) {
  const m = /^\/host\/accounts\/([0-9a-f-]{36})\/verification(\/tax-profile)?$/.exec(path);
  if (m === null) return false;
  const owner = hostOf(req);
  if (owner === undefined) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
  const h = owner === null ? undefined : owner.accounts.find((a) => a.orgId === m[1]);
  if (h === undefined)
    return err(res, 404, 'HOST_ACCOUNT_NOT_FOUND', 'common.listing.hostNotFound');
  const v = verificationOf(h);
  if (req.method === 'GET' && m[2] === undefined) {
    return json(
      res,
      200,
      verificationView(h, 'HOST_VERIFICATION_STATE', 'common.hostVerification.state'),
    );
  }
  if (req.method !== 'POST') return err(res, 404, 'NOT_FOUND', 'common.error.notFound');
  if (!/^application\/json/.test(req.headers['content-type'] ?? '')) {
    return err(res, 415, 'REQUEST_INVALID', 'common.auth.requestInvalid');
  }
  const body = (await readBody(req)) ?? {};
  const locked = v.status !== null && !['OPEN', 'DOCS_PENDING'].includes(v.status);
  // en revue ou approuvé : un PREMIER numéro reste admis (ADR-115)
  const taxLocked = locked && !(['IN_REVIEW', 'APPROVED'].includes(v.status) && v.taxKind === null);
  if (m[2] !== undefined) {
    if (!TAX_KINDS.includes(body.kind)) {
      return err(res, 422, 'HOST_TAX_ID_KIND_INVALID', 'common.hostVerification.taxKindInvalid');
    }
    const taxId = String(body.taxId ?? '')
      .replace(/[\s.]/g, '')
      .toUpperCase();
    if (!/^[0-9A-Z][0-9A-Z-]{3,19}$/.test(taxId)) {
      return err(res, 422, 'HOST_TAX_ID_INVALID', 'common.hostVerification.taxIdInvalid');
    }
    if (taxLocked) {
      return err(res, 409, 'HOST_VERIFICATION_LOCKED', 'common.hostVerification.locked');
    }
    // le numéro n'est jamais gardé par le double (le vrai magasin ne reçoit que son enveloppe)
    v.taxKind = body.kind;
    return json(
      res,
      200,
      verificationView(h, 'HOST_TAX_PROFILE_SAVED', 'common.hostVerification.taxSaved'),
    );
  }
  if (!locked) {
    v.screening = true;
    v.status = h.terms.acceptedVersion !== null ? 'IN_REVIEW' : 'DOCS_PENDING';
  }
  return json(
    res,
    200,
    verificationView(h, 'HOST_VERIFICATION_SUBMITTED', 'common.hostVerification.submitted'),
  );
}

async function hostRoute(req, res, url) {
  const path = url.pathname;
  if ((await verificationRoute(req, res, path)) !== false) return true;
  if (req.method === 'GET' && path === '/__e2e/host-verification/approve') {
    const h = hosts.get(url.searchParams.get('token') ?? '');
    if (h === undefined) return err(res, 404, 'NOT_FOUND', 'common.error.notFound');
    for (const a of h.accounts) {
      const v = verificationOf(a);
      v.status = 'APPROVED';
      v.orgStatus = 'PENDING_ACTIVATION';
      v.screening = true;
    }
    return json(res, 200, { status: 'APPROVED' });
  }
  if (req.method === 'GET' && path === '/auth/session') {
    const h = hostOf(req);
    if (h === undefined) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
    return json(res, 200, {
      userId: uuid(),
      mfaLevel: 'NONE',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      emailVerified: true,
      roles: h === null ? ['GUEST'] : ['GUEST', 'P2P_HOST'],
      hostAccounts:
        h === null
          ? []
          : h.accounts.map((a) => ({
              orgId: a.orgId,
              country: a.market.country,
              role: 'P2P_HOST',
              status: 'ONBOARDING',
              displayName: 'Ana',
            })),
    });
  }
  const pub = /^\/listings\/([0-9a-f-]{36})$/.exec(path)?.[1];
  if (req.method === 'GET' && pub !== undefined) {
    if (pub === DOWN_ID) return err(res, 503, 'LISTING_UNAVAILABLE', 'common.listing.unavailable');
    if (pub !== PUBLIC_ID) return err(res, 404, 'LISTING_NOT_FOUND', 'common.listing.notFound');
    return json(res, 200, {
      listing: {
        id: PUBLIC_ID,
        country: 'ZZ',
        dailyPriceMinor: '4000',
        currency: 'XTS',
        currencyExponent: 2,
        mileageMode: 'INCLUDED',
        includedKmPerDay: 250,
        extraKmPriceMinor: '20',
        instantBook: true,
        variantId: null,
        makeName: 'Toyota',
        modelName: 'Yaris',
        year: 2021,
        transmission: 'AUTOMATIC',
        seats: 5,
        fuelType: 'GASOLINE',
        locationKind: 'POI',
        city: 'Ciudad Ficticia',
        areaLabel: 'Barrio Norte',
        approximatePoint: { lat: 8.98, lng: -79.52 },
        timezone: 'UTC',
      },
    });
  }
  // ---- Calendrier d'un véhicule (US-119) : occupations, blocages, préavis du lieu -------------
  // Double : un véhicule qui a une annonce vaut « publié » (le double ne publie jamais, US-118) ;
  // heures locales comparées comme des chaînes (fuseau UTC du double) ; préavis du pays : 180 min.
  const cal =
    /^\/host\/accounts\/([0-9a-f-]{36})\/(?:vehicles\/([0-9a-f-]{36})\/(calendar|blocks)(?:\/([0-9a-f-]{36}))?|locations\/([0-9a-f-]{36})\/notice)$/.exec(
      path,
    );
  if (cal !== null) {
    const owner = hostOf(req);
    if (owner === undefined) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
    const h = owner === null ? undefined : owner.accounts.find((a) => a.orgId === cal[1]);
    if (h === undefined) {
      return err(res, 404, 'HOST_ACCOUNT_NOT_FOUND', 'common.listing.hostNotFound');
    }
    h.blocks ??= [];
    const [, , vehicleId, what, blockId, locationId] = cal;
    if (locationId !== undefined) {
      if (req.method !== 'PUT') return err(res, 404, 'NOT_FOUND', 'common.error.notFound');
      if (!/^application\/json/.test(req.headers['content-type'] ?? '')) {
        return err(res, 415, 'REQUEST_INVALID', 'common.auth.requestInvalid');
      }
      const loc = h.locations.find((x) => x.id === locationId);
      if (!loc) return err(res, 404, 'LOCATION_NOT_FOUND', 'common.listing.locationNotFound');
      const body = (await readBody(req)) ?? {};
      const m = body.minutes;
      if (m !== null && !(Number.isInteger(m) && m >= 60 && m <= 10_080 && m % 30 === 0)) {
        return json(res, 400, {
          code: 'REQUEST_INVALID',
          messageKey: 'common.auth.requestInvalid',
          fields: [{ field: 'minutes', reason: 'INVALID' }],
        });
      }
      loc.notice = m;
      return err(res, 200, 'NOTICE_SAVED', 'common.calendar.noticeSaved');
    }
    const v = h.vehicles.find((x) => x.id === vehicleId);
    if (!v) return err(res, 404, 'VEHICLE_NOT_FOUND', 'common.listing.vehicleNotFound');
    const listed = v.listingId !== null;
    if (req.method === 'GET' && what === 'calendar' && blockId === undefined) {
      const loc = h.locations.find((x) => x.id === v.locationId);
      const notice = loc?.notice ?? null;
      return json(res, 200, {
        vehicle: {
          id: v.id,
          timezone: 'UTC',
          listed,
          locationId: v.locationId,
          noticeMinutes: notice,
          effectiveNoticeMinutes: notice ?? 180,
        },
        entries: h.blocks
          .filter((b) => b.vehicleId === v.id && b.active)
          .sort((a, b) => (a.startLocal < b.startLocal ? -1 : 1))
          .map((b) => ({
            id: b.id,
            kind: 'HOST_BLOCK',
            startsAt: `${b.startLocal}:00.000Z`,
            endsAt: `${b.endLocal}:00.000Z`,
            startLocal: b.startLocal,
            endLocal: b.endLocal,
            removable: true,
          })),
      });
    }
    if (what !== 'blocks') return err(res, 404, 'NOT_FOUND', 'common.error.notFound');
    if (!/^application\/json/.test(req.headers['content-type'] ?? '')) {
      return err(res, 415, 'REQUEST_INVALID', 'common.auth.requestInvalid');
    }
    const body = (await readBody(req)) ?? {};
    if (req.method === 'DELETE' && blockId !== undefined) {
      const b = h.blocks.find((x) => x.id === blockId && x.vehicleId === v.id && x.active);
      if (!b) return err(res, 404, 'BLOCK_NOT_FOUND', 'common.calendar.blockNotFound');
      b.active = false;
      return err(res, 200, 'BLOCK_REMOVED', 'common.calendar.blockRemoved');
    }
    if (req.method !== 'POST' || blockId !== undefined) {
      return err(res, 404, 'NOT_FOUND', 'common.error.notFound');
    }
    let startLocal;
    let endLocal;
    const day = /^\d{4}-\d{2}-\d{2}$/;
    const time = /^\d{4}-\d{2}-\d{2}T\d{2}:(00|30)$/;
    if (day.test(String(body.from)) && day.test(String(body.to)) && body.to >= body.from) {
      const next = new Date(`${body.to}T00:00:00.000Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      startLocal = `${body.from}T00:00`;
      endLocal = `${next.toISOString().slice(0, 10)}T00:00`;
    } else if (
      time.test(String(body.start)) &&
      time.test(String(body.end)) &&
      body.end > body.start
    ) {
      startLocal = body.start;
      endLocal = body.end;
    } else {
      return json(res, 400, {
        code: 'REQUEST_INVALID',
        messageKey: 'common.auth.requestInvalid',
        fields: [{ field: 'from', reason: 'INVALID' }],
      });
    }
    if (!listed) return err(res, 409, 'VEHICLE_NOT_LISTED', 'common.calendar.notListed');
    if (
      h.blocks.some(
        (b) =>
          b.vehicleId === v.id && b.active && b.startLocal < endLocal && startLocal < b.endLocal,
      )
    ) {
      return err(res, 409, 'VEHICLE_UNAVAILABLE', 'common.calendar.vehicleUnavailable');
    }
    const id = uuid();
    h.blocks.push({ id, vehicleId: v.id, startLocal, endLocal, active: true });
    return json(res, 201, {
      code: 'BLOCK_CREATED',
      messageKey: 'common.calendar.blockCreated',
      blockId: id,
    });
  }
  // CGU de l'hôte (US-126) : version 1 BROUILLON ; acceptation de la version affichée
  const terms = /^\/host\/accounts\/([0-9a-f-]{36})\/terms(\/accept)?$/.exec(path);
  if (terms !== null) {
    const owner = hostOf(req);
    if (owner === undefined) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
    const h = owner === null ? undefined : owner.accounts.find((a) => a.orgId === terms[1]);
    if (h === undefined) {
      return err(res, 404, 'HOST_ACCOUNT_NOT_FOUND', 'common.listing.hostNotFound');
    }
    let lang = languageOf(url);
    if (req.method === 'POST' && terms[2] !== undefined) {
      if (!/^application\/json/.test(req.headers['content-type'] ?? '')) {
        return err(res, 415, 'REQUEST_INVALID', 'common.auth.requestInvalid');
      }
      const body = (await readBody(req)) ?? {};
      lang = LANGS.includes(String(body.locale).slice(0, 2))
        ? String(body.locale).slice(0, 2)
        : null;
      if (lang === null || !Number.isInteger(body.version)) {
        return err(res, 400, 'REQUEST_INVALID', 'common.auth.requestInvalid');
      }
      if (body.version !== HOST_TERMS_VERSION) {
        return err(res, 409, 'TERMS_VERSION_CHANGED', 'common.legal.versionChanged');
      }
      h.terms = { acceptedVersion: HOST_TERMS_VERSION, acceptedAt: new Date().toISOString() };
    } else if (req.method !== 'GET' || terms[2] !== undefined) {
      return err(res, 404, 'NOT_FOUND', 'common.error.notFound');
    }
    if (lang === null) return err(res, 400, 'REQUEST_INVALID', 'common.auth.requestInvalid');
    const pending = h.terms.acceptedVersion !== HOST_TERMS_VERSION;
    return json(res, 200, {
      code: pending ? 'TERMS_REACCEPT_REQUIRED' : 'TERMS_CURRENT',
      messageKey: pending ? 'common.legal.reacceptRequired' : 'common.legal.current',
      country: h.market.country,
      timeZone: 'UTC',
      document: hostTermsDoc(lang),
      requiredVersion: HOST_TERMS_VERSION,
      acceptedVersion: h.terms.acceptedVersion,
      acceptedAt: h.terms.acceptedAt,
      reacceptRequired: pending,
    });
  }
  const m =
    /^\/host\/accounts\/([0-9a-f-]{36})\/(locations|vehicles|listings)(?:\/([0-9a-f-]{36})(?:\/(pricing|submit|photos))?)?$/.exec(
      path,
    );
  if (m === null) return false;
  const owner = hostOf(req);
  if (owner === undefined) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
  const h = owner === null ? undefined : owner.accounts.find((a) => a.orgId === m[1]);
  if (h === undefined) {
    return err(res, 404, 'HOST_ACCOUNT_NOT_FOUND', 'common.listing.hostNotFound');
  }
  const [, , kind, id, step] = m;
  if (req.method === 'GET') {
    if (kind === 'locations') return json(res, 200, { locations: h.locations });
    if (kind === 'vehicles') return json(res, 200, { vehicles: h.vehicles });
    return json(res, 200, {
      listings: h.listings.filter((l) => l.status !== 'DELETED'),
      market: h.market,
      photoUploads: h.photoUploads,
    });
  }
  if (!/^application\/json/.test(req.headers['content-type'] ?? '')) {
    return err(res, 415, 'REQUEST_INVALID', 'common.auth.requestInvalid');
  }
  const body = (await readBody(req)) ?? {};
  const missing = (names) =>
    names.filter((n) => typeof body[n] !== 'string' || body[n].trim() === '');
  if (req.method === 'POST' && kind === 'locations' && id === undefined) {
    const fields = missing(['label', 'addressLine', 'city']);
    if (fields.length > 0) {
      return json(res, 400, {
        code: 'REQUEST_INVALID',
        messageKey: 'common.auth.requestInvalid',
        fields: fields.map((field) => ({ field, reason: 'REQUIRED' })),
      });
    }
    const loc = {
      id: uuid(),
      kind: body.kind,
      label: body.label,
      addressLine: body.addressLine,
      city: body.city,
      areaLabel: body.areaLabel ?? null,
      lat: null,
      lng: null,
      timezone: 'UTC',
    };
    h.locations.push(loc);
    return json(res, 201, {
      code: 'LOCATION_CREATED',
      messageKey: 'common.listing.locationCreated',
      locationId: loc.id,
    });
  }
  if (req.method === 'POST' && kind === 'vehicles' && id === undefined) {
    const plate = String(body.plate ?? '')
      .replace(/[ .-]/g, '')
      .toUpperCase();
    if (!/^[A-Z0-9]{2,12}$/.test(plate)) {
      return json(res, 400, {
        code: 'REQUEST_INVALID',
        messageKey: 'common.auth.requestInvalid',
        fields: [{ field: 'plate', reason: 'INVALID' }],
      });
    }
    if (
      [...hosts.values()].some((x) =>
        x.accounts.some((a) => a.vehicles.some((v) => v.plate === plate)),
      )
    ) {
      return err(res, 409, 'VEHICLE_PLATE_DUPLICATE', 'common.listing.plateDuplicate');
    }
    const v = {
      id: uuid(),
      locationId: body.locationId,
      plate,
      vin: body.vin ?? null,
      variantId: null,
      makeText: body.makeText,
      modelText: body.modelText,
      year: body.year,
      trim: null,
      valueClass: null,
      transmission: body.transmission,
      seats: body.seats,
      fuelType: body.fuelType,
      odometerKm: null,
      gpsInstalled: false,
      lienDeclared: false,
      eligibilityStatus: 'PENDING',
      listingId: null,
      listingStatus: null,
    };
    h.vehicles.push(v);
    return json(res, 201, {
      code: 'VEHICLE_CREATED',
      messageKey: 'common.listing.vehicleCreated',
      vehicleId: v.id,
    });
  }
  if (req.method === 'POST' && kind === 'listings' && id === undefined) {
    const v = h.vehicles.find((x) => x.id === body.vehicleId);
    if (!v) return err(res, 404, 'VEHICLE_NOT_FOUND', 'common.listing.vehicleNotFound');
    if (!/^[1-9][0-9]*$/.test(String(body.dailyPriceMinor))) {
      return err(res, 422, 'PRICE_INVALID', 'common.listing.priceInvalid');
    }
    const l = {
      id: uuid(),
      vehicleId: v.id,
      status: 'DRAFT',
      dailyPriceMinor: body.dailyPriceMinor,
      currency: h.market.currency,
      mileageMode: body.mileageMode,
      includedKmPerDay: body.includedKmPerDay ?? null,
      extraKmPriceMinor: body.extraKmPriceMinor ?? null,
      instantBook: true,
      photos: 0,
      submittedAt: null,
    };
    h.listings.push(l);
    v.listingId = l.id;
    v.listingStatus = 'DRAFT';
    return json(res, 201, {
      code: 'LISTING_CREATED',
      messageKey: 'common.listing.created',
      listingId: l.id,
    });
  }
  const l = h.listings.find((x) => x.id === id);
  if (!l) return err(res, 404, 'LISTING_NOT_FOUND', 'common.listing.notFound');
  if (req.method === 'PUT' && step === 'pricing') {
    if (!/^[1-9][0-9]*$/.test(String(body.dailyPriceMinor))) {
      return err(res, 422, 'PRICE_INVALID', 'common.listing.priceInvalid');
    }
    if (
      body.mileageMode === 'INCLUDED' &&
      !/^(0|[1-9][0-9]*)$/.test(String(body.extraKmPriceMinor))
    ) {
      return err(res, 422, 'MILEAGE_CONFIG_INVALID', 'common.listing.mileageInvalid');
    }
    l.dailyPriceMinor = body.dailyPriceMinor;
    l.mileageMode = body.mileageMode;
    l.includedKmPerDay = body.includedKmPerDay ?? null;
    l.extraKmPriceMinor = body.extraKmPriceMinor ?? null;
    return err(res, 200, 'LISTING_SAVED', 'common.listing.saved');
  }
  if (req.method === 'POST' && step === 'photos') {
    if (!h.photoUploads.open) {
      return err(res, 503, 'PHOTO_UPLOAD_UNAVAILABLE', 'common.listing.photoUnavailable');
    }
    if (Buffer.from(String(body.dataBase64 ?? ''), 'base64').length > h.photoUploads.maxBytes) {
      return err(res, 413, 'REQUEST_TOO_LARGE', 'common.error.server');
    }
    l.photos += 1;
    return err(res, 201, 'PHOTO_ADDED', 'common.listing.photoAdded');
  }
  if (req.method === 'POST' && step === 'submit') {
    if (l.photos < 6) return err(res, 422, 'PHOTO_MIN_COUNT', 'common.listing.photoMinCount');
    if (h.terms.acceptedVersion !== HOST_TERMS_VERSION) {
      return err(res, 409, 'TERMS_REACCEPT_REQUIRED', 'common.listing.hostTermsRequired');
    }
    return err(res, 422, 'HOST_NOT_ACTIVATED', 'common.listing.hostNotActivated');
  }
  if (req.method === 'DELETE' && step === undefined) {
    l.status = 'DELETED';
    // l'annonce supprimée libère son véhicule (index unique partiel de 0067)
    const freed = h.vehicles.find((x) => x.id === l.vehicleId);
    if (freed) {
      freed.listingId = null;
      freed.listingStatus = null;
    }
    return json(res, 200, {
      code: 'LISTING_DELETED',
      messageKey: 'common.listing.deleted',
      status: 'DELETED',
    });
  }
  return err(res, 404, 'NOT_FOUND', 'common.error.notFound');
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const path = url.pathname;
  if ((await hostRoute(req, res, url)) !== false) return;
  if (req.method === 'GET' && path === '/__e2e/signups') return json(res, 200, signups);
  if (req.method === 'GET' && path === '/legal/documents') {
    const lang = languageOf(url);
    if (lang === null) return err(res, 400, 'REQUEST_INVALID', 'common.auth.requestInvalid');
    if (url.searchParams.get('country') === UNKNOWN_COUNTRY) {
      return err(res, 400, 'COUNTRY_UNKNOWN', 'common.legal.countryUnknown');
    }
    return json(res, 200, {
      documents: ['MARKETING', 'PRIVACY', 'TOS_GUEST'].map((k) => doc(k, lang)),
    });
  }
  const kind = /^\/legal\/documents\/([A-Z_]+)$/.exec(path)?.[1];
  if (req.method === 'GET' && kind !== undefined) {
    const lang = languageOf(url);
    if (lang === null) return err(res, 400, 'REQUEST_INVALID', 'common.auth.requestInvalid');
    if (kind === 'TOS_HOST') {
      return json(res, 200, {
        ...hostTermsDoc(lang),
        bodyMd: `**${MARK[lang]}**

${kind} ${lang}`,
      });
    }
    if (!(kind in VERSIONS))
      return err(res, 404, 'LEGAL_DOCUMENT_NOT_FOUND', 'common.legal.notFound');
    return json(res, 200, { ...doc(kind, lang), bodyMd: `**${MARK[lang]}**\n\n${kind} ${lang}` });
  }
  if (req.method === 'GET' && path === '/legal/consents') {
    const s = sessionOf(req);
    if (!s) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
    return json(res, 200, { ...statusOf(s.email), history: [] });
  }
  if (req.method === 'GET' && path === '/__e2e/identity/approve') {
    const i = identities.get(url.searchParams.get('email') ?? '');
    if (!i || i.status !== 'DOCS_SUBMITTED')
      return err(res, 404, 'NOT_FOUND', 'common.error.notFound');
    i.status = 'APPROVED';
    return json(res, 200, { status: i.status });
  }
  // décision de l'ops (US-106) : état et motif posés comme par KYC_DECISION (dossier en revue)
  if (req.method === 'GET' && path === '/__e2e/identity/ops') {
    const i = identityOf(url.searchParams.get('email') ?? '');
    const status = url.searchParams.get('status');
    const reason = url.searchParams.get('reason');
    if (!['MANUAL_REVIEW', 'REJECTED', 'MORE_INFO_REQUIRED'].includes(status ?? ''))
      return err(res, 400, 'REQUEST_INVALID', 'common.auth.requestInvalid');
    i.status = status;
    i.reason = reason !== null && /^[A-Z_]{2,40}$/.test(reason) ? reason : null;
    return json(res, 200, { status: i.status });
  }
  if (req.method === 'GET' && path === '/identity') {
    const s = sessionOf(req);
    if (!s) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
    // langue préférée du compte : celle du parcours (identity-<langue>-<nom>@example.test)
    const lang = LANGS.find((l) => s.email.startsWith('identity-' + l + '-')) ?? 'es';
    return json(res, 200, identityView(identityOf(s.email), lang));
  }
  if (req.method === 'GET' && path === '/phone') {
    const s = sessionOf(req);
    if (!s) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
    return json(res, 200, phoneView(phoneState(s.email)));
  }
  if (req.method !== 'POST') return err(res, 404, 'NOT_FOUND', 'common.error.notFound');
  if (!/^application\/json/.test(req.headers['content-type'] ?? '')) {
    return err(res, 415, 'REQUEST_INVALID', 'common.auth.requestInvalid');
  }
  const body = await readBody(req);
  if (body === null || typeof body !== 'object') {
    return err(res, 400, 'REQUEST_INVALID', 'common.auth.requestInvalid');
  }
  if (path === '/auth/signup') {
    if (body.country === UNKNOWN_COUNTRY) {
      return err(res, 400, 'COUNTRY_UNKNOWN', 'common.legal.countryUnknown');
    }
    if (body.termsAccepted !== true) {
      return err(res, 400, 'AUTH_TERMS_NOT_ACCEPTED', 'common.auth.termsNotAccepted');
    }
    if (typeof body.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      return err(res, 400, 'AUTH_EMAIL_INVALID', 'common.auth.emailInvalid');
    }
    if (typeof body.password !== 'string' || [...body.password].length < PASSWORD_MIN) {
      return err(res, 400, 'AUTH_PASSWORD_WEAK', 'common.auth.passwordWeak', { min: PASSWORD_MIN });
    }
    if (!body.legalFirstName || !body.legalLastName) {
      return err(res, 400, 'REQUEST_INVALID', 'common.auth.requestInvalid');
    }
    const shown = body.acceptedDocuments ?? [];
    for (const k of ['TOS_GUEST', 'PRIVACY']) {
      const v = shown.find((d) => d.kind === k)?.version;
      if (shown.length > 0 && v !== VERSIONS[k]) {
        return err(res, 409, 'TERMS_VERSION_CHANGED', 'common.legal.versionChanged');
      }
    }
    const recorded = { ...body };
    delete recorded.password; // jamais conservé
    signups.push(recorded);
    if (!accounts.has(body.email)) {
      accounts.set(body.email, {
        password: body.password,
        accepted: { TOS_GUEST: VERSIONS.TOS_GUEST, PRIVACY: VERSIONS.PRIVACY },
      });
    }
    // même réponse que l'email soit libre ou pris (16 ACC-001)
    return err(res, 202, 'SIGNUP_ACCEPTED', 'common.auth.signupAccepted');
  }
  if (path === '/phone/otp') {
    const s = sessionOf(req);
    if (!s) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
    const c = COUNTRIES.find((x) => x.code === body.country);
    if (!c) return err(res, 400, 'COUNTRY_UNKNOWN', 'common.legal.countryUnknown');
    const n = normalize(body.phone, body.country);
    if (n === null) {
      return err(res, 400, 'PHONE_INVALID', 'common.error.phoneDigits', {
        digits: c.nationalLength,
        example: c.example,
      });
    }
    const p = phoneState(s.email);
    if (p.locked) return err(res, 429, 'OTP_LOCKED', 'common.otp.locked', { minutes: 60 });
    const masked = mask(n.e164, c);
    p.pending = { e164: n.e164, masked, resendAt: Date.now() + 60_000, attempts: 0 };
    return err(res, 202, 'OTP_SENT', 'common.otp.sent', {
      phone: masked,
      resendAfterS: 60,
      expiresInS: 600,
    });
  }
  if (path === '/phone/verify') {
    const s = sessionOf(req);
    if (!s) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
    if (typeof body.code !== 'string' || !/^[0-9]{6}$/.test(body.code)) {
      return err(res, 400, 'REQUEST_INVALID', 'common.auth.requestInvalid');
    }
    const p = phoneState(s.email);
    if (p.locked) return err(res, 429, 'OTP_LOCKED', 'common.otp.locked', { minutes: 60 });
    if (p.pending === null) return err(res, 400, 'OTP_EXPIRED', 'common.otp.expired');
    if (body.code !== OTP_CODE) {
      p.pending.attempts += 1;
      if (p.pending.attempts >= OTP_MAX_ATTEMPTS) {
        p.locked = true;
        return err(res, 429, 'OTP_LOCKED', 'common.otp.locked', { minutes: 60 });
      }
      return err(res, 400, 'OTP_INVALID', 'common.otp.invalid', {
        attempts: OTP_MAX_ATTEMPTS - p.pending.attempts,
      });
    }
    p.verified = p.pending.masked;
    p.pending = null;
    return err(res, 200, 'PHONE_VERIFIED', 'common.otp.verified');
  }
  if (path === '/identity/consent') {
    const s = sessionOf(req);
    if (!s) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
    if (typeof body.accepted !== 'boolean') {
      return err(res, 400, 'REQUEST_INVALID', 'common.auth.requestInvalid');
    }
    if (body.accepted && body.version !== 1) {
      return err(res, 409, 'KYC_CONSENT_VERSION_CHANGED', 'common.kyc.consentVersionChanged');
    }
    const i = identityOf(s.email);
    i.consent = body.accepted ? 1 : null;
    // retrait : session effacée, dossier en RECHECK (ADR-102)
    if (!body.accepted && i.status !== 'NOT_STARTED') {
      i.status = 'RECHECK';
      i.session = null;
    }
    return json(res, 200, {
      code: 'KYC_CONSENT_RECORDED',
      messageKey: 'common.kyc.consentRecorded',
      version: 1,
    });
  }
  if (path === '/identity/verification') {
    const s = sessionOf(req);
    if (!s) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
    const i = identityOf(s.email);
    if (i.consent !== 1) {
      return err(res, 403, 'KYC_BIOMETRIC_CONSENT_MISSING', 'common.kyc.consentMissing');
    }
    if (!COUNTRIES.some((c) => c.code === body.country)) {
      return err(res, 400, 'COUNTRY_UNKNOWN', 'common.legal.countryUnknown');
    }
    if (i.status === 'APPROVED') {
      return err(res, 409, 'KYC_ALREADY_APPROVED', 'common.kyc.alreadyApproved');
    }
    const resumed = i.session !== null;
    if (!resumed) {
      identitySessions += 1;
      i.session = {
        country: body.country,
        url: `https://identity.fake.invalid/session/fk_idv_${String(identitySessions).padStart(6, '0')}`,
      };
    }
    i.status = 'DOCS_SUBMITTED';
    return json(res, resumed ? 200 : 201, {
      code: resumed ? 'KYC_SESSION_IN_PROGRESS' : 'KYC_SESSION_STARTED',
      messageKey: resumed ? 'common.kyc.sessionInProgress' : 'common.kyc.sessionStarted',
      hostedUrl: i.session.url,
      expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
    });
  }
  if (path === '/auth/login') {
    if (
      typeof body.email === 'string' &&
      IDENTITY_ACCOUNT.test(body.email) &&
      !accounts.has(body.email)
    ) {
      accounts.set(body.email, {
        password: 'Correct-Horse-9',
        accepted: { TOS_GUEST: VERSIONS.TOS_GUEST, PRIVACY: VERSIONS.PRIVACY },
      });
    }
    if (
      typeof body.email === 'string' &&
      PHONE_ACCOUNT.test(body.email) &&
      !accounts.has(body.email)
    ) {
      accounts.set(body.email, {
        password: 'Correct-Horse-9',
        accepted: { TOS_GUEST: VERSIONS.TOS_GUEST, PRIVACY: VERSIONS.PRIVACY },
      });
    }
    if (typeof body.email === 'string' && REACCEPT.test(body.email) && !accounts.has(body.email)) {
      accounts.set(body.email, {
        password: 'Correct-Horse-9',
        accepted: { TOS_GUEST: 1, PRIVACY: 1 },
      });
    }
    const a = accounts.get(body.email);
    if (!a || a.password !== body.password) {
      return err(res, 401, 'AUTH_INVALID_CREDENTIALS', 'common.auth.invalidCredentials');
    }
    const token = randomBytes(32).toString('base64url');
    sessions.set(token, { email: body.email });
    return json(
      res,
      200,
      { expiresAt: new Date(Date.now() + 1_209_600_000).toISOString() },
      {
        'set-cookie': `__Host-session=${token}; Max-Age=1209600; Path=/; HttpOnly; Secure; SameSite=Lax`,
      },
    );
  }
  if (path === '/auth/verify-email') {
    if (typeof body.token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(body.token)) {
      return err(res, 200, 'EMAIL_VERIFIED', 'common.auth.emailVerified');
    }
    return err(res, 400, 'AUTH_LINK_EXPIRED', 'common.auth.linkExpired');
  }
  if (path === '/legal/consents/accept') {
    const s = sessionOf(req);
    if (!s) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
    const docs = Array.isArray(body.documents) ? body.documents : [];
    if (docs.length === 0) return err(res, 400, 'REQUEST_INVALID', 'common.auth.requestInvalid');
    for (const d of docs) {
      if (d.version !== VERSIONS[d.kind]) {
        return err(res, 409, 'TERMS_VERSION_CHANGED', 'common.legal.versionChanged');
      }
    }
    const a = accounts.get(s.email);
    for (const d of docs) a.accepted[d.kind] = d.version;
    const { documents, ...rest } = statusOf(s.email);
    return json(res, 200, { ...rest, documents });
  }
  return err(res, 404, 'NOT_FOUND', 'common.error.notFound');
}).listen(PORT, '127.0.0.1');
