import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getProfile } from '@rueda/i18n';
import { Banner, ButtonLink } from '@rueda/ui';
import { callApi } from '../../../account/api-client.ts';
import type { ApiResult } from '../../../account/api-client.ts';
import { clientContext, journeyCountry } from '../../../account/request.ts';
import { getRequestI18n, getRequestLocaleTag } from '../../../i18n.ts';
import { LOCALE_CONFIG } from '../../../locale-config.ts';
import styles from '../_account/account.module.css';
import { MAIN_ID } from '../_shell/main-id.ts';
import { CodeForm } from './code-form.tsx';
import { PhoneForm } from './phone-form.tsx';
import type { PhoneCountryOption } from './phone-form.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.s15.phoneTitle'), robots: { index: false, follow: false } };
}

interface PhoneStateView {
  readonly verified: boolean;
  readonly phone: string | null;
  readonly pending: {
    readonly phone: string;
    readonly resendAfterS: number;
    readonly expiresInS: number;
    readonly attemptsLeft: number | null;
  } | null;
  readonly lockedForS: number | null;
  readonly countries: readonly {
    readonly code: string;
    readonly names: Readonly<Record<string, string>>;
    readonly callingCode: string;
    readonly example: string;
  }[];
}

const int = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const str = (v: unknown): v is string => typeof v === 'string' && v.length <= 64;

/** État `GET /phone` (lecture défensive : forme inattendue ⇒ `null`, l'écran le dit). */
function stateOf(reply: ApiResult): PhoneStateView | null {
  if (reply.status !== 200) return null;
  const j = reply.json as Record<string, unknown> | null;
  if (j === null || typeof j['verified'] !== 'boolean' || !Array.isArray(j['countries'])) {
    return null;
  }
  const pending = j['pending'] as Record<string, unknown> | null;
  if (
    pending !== null &&
    (typeof pending !== 'object' ||
      !str(pending['phone']) ||
      !int(pending['resendAfterS']) ||
      !int(pending['expiresInS']))
  ) {
    return null;
  }
  const countries = (j['countries'] as Record<string, unknown>[]).filter(
    (c) =>
      typeof c['code'] === 'string' &&
      /^[A-Z]{2}$/.test(c['code']) &&
      str(c['callingCode']) &&
      str(c['example']) &&
      typeof c['names'] === 'object' &&
      c['names'] !== null,
  ) as unknown as PhoneStateView['countries'];
  return {
    verified: j['verified'],
    phone: str(j['phone']) ? j['phone'] : null,
    pending:
      pending === null
        ? null
        : {
            phone: pending['phone'] as string,
            resendAfterS: pending['resendAfterS'] as number,
            expiresInS: pending['expiresInS'] as number,
            attemptsLeft: int(pending['attemptsLeft']) ? pending['attemptsLeft'] : null,
          },
    lockedForS: int(j['lockedForS']) ? j['lockedForS'] : null,
    countries,
  };
}

/**
 * S15 — étape OTP (US-104 ; 16 VER-013 ; 10b §4.1 S15, UX-38 ; maquette US-033) : vérifier son
 * téléphone par un code reçu par SMS. Selon l'état lu à l'API : numéro vérifié ; blocage en cours
 * (`common.otp.locked`) ; code en attente (saisie, renvoi après le délai) ; sinon saisie du
 * numéro, indicatif pré-rempli selon le pays de la locale et modifiable. Sans session : connexion.
 * API injoignable : aucun formulaire (fail-closed), un message dans la langue de la vue.
 */
export default async function VerifyPhonePage({
  searchParams,
}: {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const [i18n, tag, query, ctx] = await Promise.all([
    getRequestI18n(),
    getRequestLocaleTag(),
    searchParams,
    clientContext(),
  ]);
  const t = i18n.t.bind(i18n);
  const reply = await callApi('GET', '/phone', ctx);
  if (reply.status === 401) redirect('/login');
  const state = stateOf(reply);
  const language = getProfile(LOCALE_CONFIG, tag).language;
  const countries: PhoneCountryOption[] = (state?.countries ?? []).map((c) => ({
    code: c.code,
    label: `${c.names[language] ?? c.code} (+${c.callingCode})`,
    example: c.example,
  }));
  const wanted = journeyCountry(query['country'], tag);
  const defaultCountry = countries.find((c) => c.code === wanted)?.code ?? countries[0]?.code ?? '';
  const change = query['change'] === '1';

  let body: ReactNode;
  if (state === null || countries.length === 0) {
    body = (
      <Banner tone="danger" live="polite">
        {t('common.otp.unavailable')}
      </Banner>
    );
  } else if (state.verified && state.phone !== null && !change) {
    body = (
      <>
        <Banner tone="success" live="polite">
          {t('web.s15.phoneVerified', { phone: state.phone })}
        </Banner>
        <ButtonLink variant="quiet" href="/verify-phone?change=1">
          {t('web.s15.changePhone')}
        </ButtonLink>
      </>
    );
  } else if (state.lockedForS !== null) {
    body = (
      <Banner tone="danger" live="polite">
        {t('common.otp.locked', { minutes: Math.max(1, Math.ceil(state.lockedForS / 60)) })}
      </Banner>
    );
  } else if (state.pending !== null && !change) {
    body = (
      <CodeForm
        localeTag={tag}
        phone={state.pending.phone}
        resendAfterS={state.pending.resendAfterS}
        attemptsLeft={state.pending.attemptsLeft}
      />
    );
  } else {
    body = <PhoneForm localeTag={tag} countries={countries} defaultCountry={defaultCountry} />;
  }

  return (
    <main id={MAIN_ID} tabIndex={-1} className={styles['content']}>
      <header className={styles['stackTight']}>
        <h1 className={styles['h1']}>{t('web.s15.phoneTitle')}</h1>
        <p className={styles['muted']}>{t('web.s15.phoneIntro')}</p>
      </header>
      {body}
    </main>
  );
}
