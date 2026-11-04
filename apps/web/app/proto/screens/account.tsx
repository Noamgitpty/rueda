/**
 * S15 Inscription, connexion et OTP ; S04 Vérification d'identité — 10b §4.1 (UX-33, UX-34, UX-38),
 * parcours 4.2.1 (« Compte vérifié valide ? »).
 */
import {
  Badge,
  Banner,
  Button,
  ButtonLink,
  Checkbox,
  ErrorSummary,
  LoadingState,
  Steps,
  TextField,
} from '@rueda/ui';
import type { ScreenContext } from '../context.ts';
import { featuredCar } from '../data/scenario.ts';
import { AppHeader, HiddenContext, styles } from '../shell.tsx';

export function S15({ ctx }: { readonly ctx: ScreenContext }) {
  const { t, i18n, market, state } = ctx;
  const codeStep = state === 'code' || state === 'error';
  return (
    <>
      <AppHeader ctx={ctx} back={ctx.href('s03')} title={t('web.s15.signup')} />
      <main className={styles['content']}>
        <header className={styles['stackTight']}>
          <h1 className={styles['h1']}>{t('web.s15.title')}</h1>
          <p className={styles['muted']}>{t('web.s15.intro')}</p>
        </header>
        {codeStep ? (
          <form className={styles['stack']} action={ctx.href('s04').split('?')[0]} method="get">
            <HiddenContext ctx={ctx} />
            {state === 'error' && (
              <ErrorSummary
                i18n={i18n}
                errors={[{ fieldId: 's15-code', message: t('web.s15.codeInvalid', { count: 2 }) }]}
              />
            )}
            <Banner tone="success" live="polite">
              {t('web.s15.codeSent', { phone: market.phoneMasked })}
            </Banner>
            <TextField
              i18n={i18n}
              id="s15-code"
              label={t('web.s15.code')}
              inputMode="numeric"
              autoComplete="one-time-code"
              defaultValue={state === 'error' ? '482913' : ''}
              error={state === 'error' ? t('web.s15.codeInvalid', { count: 2 }) : undefined}
            />
            <p className={styles['muted']}>{t('web.s15.resendIn', { count: 42 })}</p>
            <Button type="submit" block>
              {t('web.s15.verify')}
            </Button>
          </form>
        ) : (
          <form className={styles['stack']} action={ctx.href('s15').split('?')[0]} method="get">
            <HiddenContext ctx={ctx} />
            <input type="hidden" name="state" value="code" />
            <TextField
              i18n={i18n}
              id="s15-name"
              label={t('web.s15.legalName')}
              autoComplete="name"
              defaultValue={market.guestName}
            />
            <TextField
              i18n={i18n}
              id="s15-email"
              type="email"
              label={t('web.s15.email')}
              autoComplete="email"
            />
            <TextField
              i18n={i18n}
              id="s15-password"
              type="password"
              label={t('web.s15.password')}
              hint={t('web.s15.passwordHint')}
              autoComplete="new-password"
            />
            <TextField
              i18n={i18n}
              id="s15-phone"
              type="tel"
              label={t('web.s15.phone')}
              autoComplete="tel"
              defaultValue={`${market.dialCode} `}
            />
            <Checkbox id="s15-terms" label={t('web.s15.terms')} />
            <Checkbox id="s15-marketing" label={t('web.s15.marketing')} />
            <Button type="submit" block loading={state === 'loading'}>
              {t('web.s15.signup')}
            </Button>
            <ButtonLink variant="quiet" href={ctx.href('s04')}>
              {t('web.s15.login')}
            </ButtonLink>
          </form>
        )}
      </main>
    </>
  );
}

const STATUSES = ['tourist', 'resident', 'special', 'unsure'] as const;

export function S04({ ctx }: { readonly ctx: ScreenContext }) {
  const { t, i18n, market, state } = ctx;
  const status = STATUSES.find((s) => s === ctx.options.sel) ?? 'tourist';
  const stepNames = [
    t('web.s04.step.status'),
    t('web.s04.step.documents'),
    t('web.s04.step.selfie'),
    t('web.s04.step.result'),
  ];
  const current = state === 'normal' ? 0 : state === 'error' ? 1 : state === 'loading' ? 2 : 3;
  return (
    <>
      <AppHeader ctx={ctx} back={ctx.href('s15')} title={t('web.s04.title')} />
      <main className={styles['content']}>
        <Steps i18n={i18n} steps={stepNames} current={current} label={t('web.s04.title')} />
        {state === 'normal' && (
          <form className={styles['stack']} action={ctx.href('s04').split('?')[0]} method="get">
            <HiddenContext ctx={ctx} />
            <input type="hidden" name="state" value="loading" />
            <p className={styles['muted']}>{t('web.s04.intro')}</p>
            <fieldset className={styles['choices']}>
              <legend className={styles['h2']}>
                {t('web.s04.status.question', { country: ctx.country })}
              </legend>
              {STATUSES.map((s) => (
                <label key={s} className={styles['choice']}>
                  <input type="radio" name="sel" value={s} defaultChecked={s === status} />
                  <span className={styles['choiceBody']}>
                    {t(`web.s04.status.${s}`, { country: ctx.country })}
                  </span>
                  <span />
                </label>
              ))}
            </fieldset>
            <div className={styles['card']}>
              <p className={styles['strong']}>{t('web.s04.step.documents')}</p>
              <p className={styles['muted']}>
                {t(status === 'resident' ? 'web.s04.docs.resident' : 'web.s04.docs.tourist')}
              </p>
              <p className={styles['muted']}>{t('web.s03.kyc.notice')}</p>
            </div>
            <Checkbox
              id="s04-biometric"
              label={t('web.s04.biometric', { provider: market.kycProvider })}
            />
            <Button type="submit" block>
              {t('web.s04.go', { provider: market.kycProvider })}
            </Button>
          </form>
        )}
        {state === 'loading' && (
          <div className={styles['stack']}>
            <LoadingState i18n={i18n} label={t('web.s04.checking')} />
            <p className={styles['muted']} role="status">
              {t('web.s04.waiting')}
            </p>
            <ButtonLink variant="quiet" href={ctx.href('s04', { state: 'verified' })}>
              {t('proto.fake.next')}
            </ButtonLink>
          </div>
        )}
        {state === 'error' && (
          <div className={styles['stack']}>
            <Banner tone="warning" title={t('web.s04.result.retake')} live="assertive">
              {t('web.s04.result.glare')}
            </Banner>
            <ButtonLink href={ctx.href('s04', { state: 'loading' })}>
              {t('web.s04.retakeAction')}
            </ButtonLink>
          </div>
        )}
        {state === 'review' && (
          <div className={styles['stack']}>
            <Banner tone="info" icon="clock" live="polite">
              {t('web.s04.result.inReview', { count: market.featured.kycReviewHours })}
            </Banner>
            <p className={styles['muted']}>{t('web.s04.reviewBody')}</p>
            <ButtonLink variant="secondary" href={ctx.href('s02')}>
              {t('web.s08.search')}
            </ButtonLink>
          </div>
        )}
        {state === 'verified' && (
          <div className={styles['stack']}>
            <div className={styles['inline']}>
              <Badge tone="success">{t('web.s04.result.verified')}</Badge>
            </div>
            <p className={styles['text']}>{t('web.s04.verifiedBody')}</p>
            <ButtonLink href={ctx.href('s05')}>{t('web.common.continue')}</ButtonLink>
          </div>
        )}
        {state !== 'verified' && state !== 'normal' && (
          <p className={styles['muted']}>
            {featuredCar(market).title} · {ctx.date('start')}
          </p>
        )}
      </main>
    </>
  );
}
