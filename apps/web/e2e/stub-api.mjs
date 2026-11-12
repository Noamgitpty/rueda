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

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const path = url.pathname;
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
    if (!(kind in VERSIONS))
      return err(res, 404, 'LEGAL_DOCUMENT_NOT_FOUND', 'common.legal.notFound');
    return json(res, 200, { ...doc(kind, lang), bodyMd: `**${MARK[lang]}**\n\n${kind} ${lang}` });
  }
  if (req.method === 'GET' && path === '/legal/consents') {
    const s = sessionOf(req);
    if (!s) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
    return json(res, 200, { ...statusOf(s.email), history: [] });
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
  if (path === '/auth/login') {
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
