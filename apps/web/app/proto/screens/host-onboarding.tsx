/**
 * Devenir hôte (10b §4.2.3) : A01 présentation et estimation, A07 liste de tâches, A10 inscription
 * d'une voiture, A11 règles, lieu de remise et plan, A13 profil public.
 *
 * Mise en service : un hôte n'est **jamais** activable tant que les interrupteurs du pays sont
 * fermés (`insurer_contract_active`… à `false`) ou qu'une capacité PSP bloquante est inconnue.
 * A07 le montre tel quel : « en attente d'ouverture dans ton pays ».
 */
import {
  Badge,
  Banner,
  ButtonLink,
  CarIllustration,
  Checkbox,
  EmptyState,
  HostCard,
  Icon,
  PhotoSlot,
  TextField,
} from '@rueda/ui';
import type { PhotoSlotState } from '@rueda/ui';
import { PHOTO_RULES, angleKeyOf } from '@rueda/design-tokens';
import type { MessageKey } from '@rueda/i18n';
import type { ScreenContext } from '../context.ts';
import type { CopyKey } from '../copy/index.ts';
import { hostActivatable, money } from '../data/scenario.ts';
import type { HostGates } from '../data/scenario.ts';
import { ActionBar, AppHeader, Camino, MiniMap, Row, cx, styles } from '../shell.tsx';
import { Estimator } from './estimator.tsx';
import { ErrorBlock, LoadingBlock, PlanCard, amount, hostCar } from './host-kit.tsx';

// ---------------------------------------------------------------- A01

export function A01({ ctx }: { readonly ctx: ScreenContext }) {
  const { t, i18n, market, state } = ctx;
  const car = hostCar(ctx);
  const perDay = money(market, car.perDayMinor);
  const steps = market.host.estimateMinor.map((minor, i) => ({
    days: i + 1,
    daysLabel: t('web.s01.owner.days', { count: i + 1 }),
    amount: amount(ctx, minor),
  }));
  return (
    <>
      <AppHeader ctx={ctx} back={ctx.href('s01')} onPrimary />
      <section className={styles['hero']} aria-labelledby="a01-title">
        <Camino className={styles['heroCamino']} />
        <p className={styles['kicker']}>{t('web.a01.kicker', { country: ctx.country })}</p>
        <h1 id="a01-title" className={styles['display']}>
          {t('web.a01.title')}
        </h1>
        <p className={styles['heroSubtitle']}>{t('web.a01.subtitle')}</p>
        {/* Sur la nuit Tinta, la silhouette prend la teinte claire (2) : la voiture reste lisible. */}
        <CarIllustration className={styles['heroCar']} tone={2} kind={car.kind} />
      </section>
      <main className={styles['content']}>
        {state === 'closed' && (
          <Banner
            tone="info"
            icon="lock"
            title={t('web.a01.closed.title', { country: ctx.country })}
          >
            {t('web.a01.closed', { brand: ctx.brand, country: ctx.country })}
          </Banner>
        )}
        <section className={cx(styles['card'], styles['floatCard'])} aria-labelledby="a01-estimate">
          <h2 id="a01-estimate" className={styles['h2']}>
            {t('web.a01.estimate.title')}
          </h2>
          {state === 'loading' && <LoadingBlock ctx={ctx} rows={2} />}
          {state === 'error' && (
            <ErrorBlock ctx={ctx} title={t('web.a01.error')} retry={ctx.href('a01')} />
          )}
          {state !== 'loading' && state !== 'error' && (
            <>
              <Estimator
                label={t('web.s01.owner.daysLabel')}
                perMonth={t('web.s01.owner.perMonth')}
                steps={steps}
                initialDays={10}
              />
              <p className={styles['muted']}>
                {t('web.a01.estimate.share', { brand: ctx.brand, pct: market.host.sharePct })}
              </p>
              <p className={styles['muted']}>
                {t('web.s01.owner.note', { amount: i18n.money(perDay) })}
              </p>
            </>
          )}
        </section>
        <section className={styles['section']} aria-labelledby="a01-brand">
          <h2 id="a01-brand" className={styles['h2']}>
            {t('web.a01.brandDoes.title', { brand: ctx.brand })}
          </h2>
          <ul className={styles['trust']}>
            <li className={styles['trustItem']}>
              <Icon name="shield" />
              {t('web.a01.brandDoes.protection', { insurer: market.insurerName })}
            </li>
            <li className={styles['trustItem']}>
              <Icon name="wallet" />
              {t('web.a01.brandDoes.payment', { brand: ctx.brand })}
            </li>
            <li className={styles['trustItem']}>
              <Icon name="user" />
              {t('web.a01.brandDoes.verify')}
            </li>
          </ul>
        </section>
        <section className={styles['section']} aria-labelledby="a01-you">
          <h2 id="a01-you" className={styles['h2']}>
            {t('web.a01.youDo.title')}
          </h2>
          <ol className={styles['steps']}>
            {([1, 2, 3] as const).map((n) => (
              <li key={n} className={styles['step']}>
                <span className={styles['strong']}>{t(`web.a01.youDo.${n}`)}</span>
                <span className={styles['muted']}>{t(`web.a01.youDo.${n}.body`)}</span>
              </li>
            ))}
          </ol>
        </section>
        <section className={styles['section']} aria-labelledby="a01-plans">
          <h2 id="a01-plans" className={styles['h2']}>
            {t('web.a01.plans.title')}
          </h2>
          <PlanCard ctx={ctx}>
            <p className={styles['muted']}>
              {t('web.a01.plans.more', { insurer: market.insurerName })}
            </p>
          </PlanCard>
        </section>
      </main>
      <ActionBar>
        <ButtonLink block href={ctx.href('a07')}>
          {t('web.a01.cta')}
        </ButtonLink>
      </ActionBar>
    </>
  );
}

// ---------------------------------------------------------------- A07

type TaskId = 'identity' | 'psp' | 'payout' | 'tax' | 'plan' | 'terms' | 'car';
type TaskStatus = 'done' | 'review' | 'todo' | 'refused';

const TASKS: ReadonlyArray<{
  readonly id: TaskId;
  readonly icon: 'user' | 'shield' | 'wallet' | 'document' | 'star' | 'check' | 'car';
  readonly owner: 'you' | 'ops';
}> = [
  { id: 'identity', icon: 'user', owner: 'ops' },
  { id: 'psp', icon: 'shield', owner: 'ops' },
  { id: 'payout', icon: 'wallet', owner: 'you' },
  { id: 'tax', icon: 'document', owner: 'you' },
  { id: 'plan', icon: 'star', owner: 'you' },
  { id: 'terms', icon: 'check', owner: 'you' },
  { id: 'car', icon: 'car', owner: 'you' },
];

function taskStatus(state: string, id: TaskId): TaskStatus {
  if (state === 'waiting') return 'done';
  if (state === 'error' && id === 'identity') return 'refused';
  const normal: Readonly<Record<TaskId, TaskStatus>> = {
    identity: 'done',
    psp: 'review',
    payout: 'done',
    tax: 'todo',
    plan: 'done',
    terms: 'todo',
    car: 'todo',
  };
  return normal[id];
}

const TASK_TONE = {
  done: 'success',
  review: 'warning',
  todo: 'neutral',
  refused: 'danger',
} as const;

type GateId = 'insurer' | 'hosts' | 'payouts' | 'psp';

function gateOpen(gates: HostGates, id: GateId): boolean {
  if (id === 'insurer') return gates.insurerContractActive;
  if (id === 'hosts') return gates.p2pPrivateHostsEnabled && gates.fundsHoldingEnabled;
  if (id === 'payouts') return gates.payoutsEnabled;
  return gates.pspPayoutCapability === 'yes';
}

/** Ouverture du pays : interrupteurs et capacité PSP, en lecture seule (données de `scenario.json`). */
function CountryGates({ ctx }: { readonly ctx: ScreenContext }) {
  const { t, market } = ctx;
  const gates = market.host.gates;
  const open = hostActivatable(gates);
  return (
    <section className={cx(styles['card'], styles['gateCard'])} aria-labelledby="a07-country">
      <h2 id="a07-country" className={styles['h3']}>
        <Icon name="globe" /> {t('web.a07.country.title', { country: ctx.country })}
      </h2>
      <p className={styles['muted']}>
        {t('web.a07.country.body', { brand: ctx.brand, country: ctx.country })}
      </p>
      <ul className={styles['rows']}>
        {(['insurer', 'hosts', 'payouts', 'psp'] as const).map((id) => (
          <Row
            key={id}
            icon={gateOpen(gates, id) ? 'check' : 'lock'}
            title={t(`web.a07.gate.${id}`, {
              insurer: market.insurerName,
              psp: market.pspName,
            })}
            end={
              <Badge tone={gateOpen(gates, id) ? 'success' : 'warning'}>
                {gateOpen(gates, id)
                  ? t('web.a07.status.done')
                  : id === 'psp' && gates.pspPayoutCapability === 'unknown'
                    ? t('web.a07.gate.checking')
                    : t('web.a07.gate.pending')}
              </Badge>
            }
          />
        ))}
      </ul>
      <p className={styles['activation']}>
        <Icon name={open ? 'check' : 'lock'} />
        <span>{t(open ? 'web.a07.activation.open' : 'web.a07.activation.locked')}</span>
      </p>
    </section>
  );
}

export function A07({ ctx }: { readonly ctx: ScreenContext }) {
  const { t, market, state } = ctx;
  const statuses = TASKS.map((task) => taskStatus(state, task.id));
  const done = statuses.filter((s) => s === 'done').length;
  return (
    <>
      <AppHeader ctx={ctx} back={ctx.href('a01')} title={t('web.a07.title')} />
      <main className={styles['content']}>
        {state === 'waiting' ? (
          <section className={styles['waitCard']} aria-labelledby="a07-wait">
            <Camino className={styles['joyCamino']} />
            <span className={styles['joyMark']} aria-hidden="true">
              <Icon name="check" />
            </span>
            <h1 id="a07-wait" className={styles['h2']}>
              {t('web.a07.waitingCountry', { brand: ctx.brand, country: ctx.country })}
            </h1>
            <p className={styles['text']}>{t('web.a07.waiting.meanwhile')}</p>
          </section>
        ) : (
          <header className={styles['stackTight']}>
            <h1 className={styles['h1']}>{t('web.a07.heading')}</h1>
            <p className={styles['muted']}>{t('web.a07.intro')}</p>
          </header>
        )}
        {state === 'error' && (
          <Banner tone="danger" live="assertive" title={t('web.a07.refused')}>
            {t('web.a07.refused.reason')}
          </Banner>
        )}
        {state === 'loading' ? (
          <LoadingBlock ctx={ctx} rows={5} />
        ) : (
          <>
            <div className={styles['stackTight']}>
              <label className={styles['strong']} htmlFor="a07-progress">
                {t('web.a07.progress', { done, total: TASKS.length })}
              </label>
              <progress
                id="a07-progress"
                className={styles['range']}
                max={TASKS.length}
                value={done}
              />
            </div>
            <ol className={styles['taskList']}>
              {TASKS.map((task, i) => {
                const status = statuses[i] ?? 'todo';
                return (
                  <li key={task.id} className={cx(styles['task'], styles[`task_${status}`])}>
                    <span className={styles['rowIcon']}>
                      <Icon name={status === 'done' ? 'check' : task.icon} />
                    </span>
                    <span className={styles['rowText']}>
                      <span className={styles['strong']}>{t(`web.a07.task.${task.id}`)}</span>
                      <span className={styles['muted']}>
                        {t(`web.a07.task.${task.id}.body`, {
                          psp: market.pspName,
                          pct: market.host.sharePct,
                          country: ctx.country,
                        })}
                      </span>
                      <span className={styles['muted']}>
                        {task.owner === 'you'
                          ? t('web.a07.owner.you')
                          : t('web.a07.owner.ops', { brand: ctx.brand })}
                      </span>
                    </span>
                    <Badge tone={TASK_TONE[status]}>{t(`web.a07.status.${status}`)}</Badge>
                  </li>
                );
              })}
            </ol>
            <CountryGates ctx={ctx} />
          </>
        )}
      </main>
      <ActionBar>
        {state === 'waiting' ? (
          <div className={styles['twoCols']}>
            <ButtonLink href={ctx.href('a13')}>{t('web.a07.waiting.profile')}</ButtonLink>
            <ButtonLink variant="secondary" href={ctx.href('a10', { state: 'closed' })}>
              {t('web.a07.waiting.listing')}
            </ButtonLink>
          </div>
        ) : state === 'error' ? (
          <ButtonLink block href={ctx.href('a07')}>
            <Icon name="camera" />
            {t('web.a07.refused.retry')}
          </ButtonLink>
        ) : (
          <ButtonLink block href={ctx.href('a10')}>
            {t('web.a07.next')}
          </ButtonLink>
        )}
      </ActionBar>
    </>
  );
}

// ---------------------------------------------------------------- A10

const A10_STEPS = [
  'vehicle',
  'documents',
  'photos',
  'price',
  'place',
  'rules',
  'plan',
  'review',
] as const;
type A10Step = (typeof A10_STEPS)[number];

function photoState(state: string, index: number): PhotoSlotState {
  if (state === 'closed') return 'uploaded';
  if (state === 'loading') return index < 4 ? 'uploaded' : index === 4 ? 'uploading' : 'empty';
  return index < 4 ? 'uploaded' : index === 4 ? 'saved' : 'empty';
}

function A10Body({ ctx, step }: { readonly ctx: ScreenContext; readonly step: A10Step }) {
  const { t, i18n, market, state } = ctx;
  const car = hostCar(ctx);
  const f = market.featured;
  if (step === 'vehicle') {
    return (
      <div className={styles['stack']}>
        <div className={styles['tripMediaWide']}>
          <CarIllustration tone={car.carTone} kind={car.kind} />
        </div>
        <TextField
          i18n={i18n}
          id="a10-model"
          label={t('web.a10.vehicle.model')}
          defaultValue={car.title}
        />
        <p className={styles['muted']}>{t('web.a10.vehicle.catalog')}</p>
        <fieldset className={styles['choices']}>
          <legend className={styles['strong']}>{t('web.a10.vehicle.gearbox')}</legend>
          {(['automatic', 'manual'] as const).map((g) => (
            <label key={g} className={styles['choice']}>
              <input
                type="radio"
                name="gearbox"
                value={g}
                defaultChecked={(g === 'manual') === car.manual}
              />
              <span className={styles['choiceBody']}>{t(`web.a10.vehicle.${g}`)}</span>
              <span />
            </label>
          ))}
        </fieldset>
      </div>
    );
  }
  if (step === 'documents') {
    return (
      <div className={styles['stack']}>
        <ul className={styles['rows']}>
          <Row
            icon="document"
            title={t('web.a10.docs.title')}
            detail={t('web.a10.docs.title.body')}
            end={<Badge tone="success">{t('web.a07.status.done')}</Badge>}
          />
          <Row
            icon="document"
            title={t('web.a10.docs.plate')}
            end={
              state === 'error' ? (
                <Badge tone="danger">{t('web.a07.status.refused')}</Badge>
              ) : (
                <Badge tone="success">{t('web.a07.status.done')}</Badge>
              )
            }
          />
          <Row
            icon="document"
            title={t('web.a10.docs.inspection')}
            end={<Badge tone="warning">{t('web.a07.status.review')}</Badge>}
          />
        </ul>
        <fieldset className={styles['choices']}>
          <legend className={styles['strong']}>{t('web.a10.docs.financed')}</legend>
          {(['no', 'yes'] as const).map((v) => (
            <label key={v} className={styles['choice']}>
              <input type="radio" name="financed" value={v} defaultChecked={v === 'no'} />
              <span className={styles['choiceBody']}>{t(`web.a10.docs.financed.${v}`)}</span>
              <span />
            </label>
          ))}
        </fieldset>
        <p className={styles['muted']}>{t('web.a10.docs.financedHint')}</p>
      </div>
    );
  }
  if (step === 'photos') {
    const shots = PHOTO_RULES.listing.shots;
    const done = shots.filter((_, i) => photoState(state, i) === 'uploaded').length;
    return (
      <div className={styles['stack']}>
        <p className={styles['text']}>
          {t('web.a10.photos.intro', {
            min: PHOTO_RULES.listing.minPhotos,
            recommended: PHOTO_RULES.listing.recommendedPhotos,
          })}
        </p>
        <div className={styles['stackTight']}>
          <label className={styles['strong']} htmlFor="a10-photos">
            {t('web.s09c.progress', { done, total: shots.length })}
          </label>
          <progress id="a10-photos" className={styles['range']} max={shots.length} value={done} />
        </div>
        <div className={styles['photoGrid']}>
          {shots.map((shot, i) => (
            <PhotoSlot
              key={shot.angle.code}
              i18n={i18n}
              angle={`${t(`web.photo.angle.${angleKeyOf(shot.angle.code)}.label` as MessageKey)}${shot.required ? ' *' : ''}`}
              state={photoState(state, i)}
            />
          ))}
        </div>
        <p className={styles['muted']}>{t('web.a10.photos.required')}</p>
      </div>
    );
  }
  if (step === 'price') {
    return (
      <div className={styles['stack']}>
        <TextField
          i18n={i18n}
          id="a10-price"
          label={t('web.a10.price.perDay', { currency: market.currency })}
          inputMode="decimal"
          defaultValue={i18n.money(money(market, car.perDayMinor))}
        />
        <Banner tone="success" icon="wallet">
          {t('web.a10.price.hint', {
            pct: market.host.sharePct,
            amount: amount(ctx, market.host.estimateMinor[0] ?? '0'),
          })}
        </Banner>
        <TextField
          i18n={i18n}
          id="a10-km"
          label={t('web.a10.price.km')}
          inputMode="numeric"
          defaultValue={String(f.kmPerDay)}
        />
      </div>
    );
  }
  if (step === 'place') {
    return (
      <div className={styles['stack']}>
        <MiniMap label={f.meetArea} zone />
        <Banner tone="info" icon="pin">
          {t('web.a10.meetPublic', { place: f.meetArea })}
        </Banner>
        <fieldset className={styles['choices']}>
          <legend className={styles['strong']}>{t('web.a10.place.legend')}</legend>
          {(['public', 'home'] as const).map((v) => (
            <label key={v} className={styles['choice']}>
              <input type="radio" name="place" value={v} defaultChecked={v === 'public'} />
              <span className={styles['choiceBody']}>
                <span className={styles['strong']}>{t(`web.a10.place.${v}`)}</span>
                <span className={styles['muted']}>{t(`web.a10.place.${v}.body`)}</span>
              </span>
              <span />
            </label>
          ))}
        </fieldset>
        <p className={styles['muted']}>{t('web.a11.safety')}</p>
      </div>
    );
  }
  if (step === 'rules') {
    return (
      <div className={styles['stack']}>
        <fieldset className={styles['choices']}>
          <legend className={styles['strong']}>{t('web.a10.rules.legend')}</legend>
          <Checkbox
            id="a10-smoking"
            defaultChecked
            label={t('web.s03.rules.smoking', { amount: amount(ctx, f.fees.smokingMinor) })}
          />
          <Checkbox
            id="a10-pets"
            defaultChecked
            label={t('web.s03.rules.pets', { amount: amount(ctx, f.fees.petsMinor) })}
          />
          <Checkbox
            id="a10-fuel"
            defaultChecked
            label={t('web.s03.rules.fuel', { amount: amount(ctx, f.fees.fuelMinor) })}
          />
        </fieldset>
        <fieldset className={styles['choices']}>
          <legend className={styles['strong']}>{t('web.a10.mode.legend')}</legend>
          <label className={styles['choice']}>
            <input type="radio" name="mode" value="instant" defaultChecked />
            <span className={styles['choiceBody']}>
              <span className={styles['strong']}>{t('web.s02f.instant')}</span>
              <span className={styles['muted']}>{t('web.a10.mode.instant.body')}</span>
            </span>
            <span />
          </label>
          <label className={styles['choice']}>
            <input type="radio" name="mode" value="request" />
            <span className={styles['choiceBody']}>
              <span className={styles['strong']}>{t('web.a10.mode.request')}</span>
              <span className={styles['muted']}>
                {t('web.a10.mode.request.body', { count: f.requestHours })}
              </span>
            </span>
            <span />
          </label>
        </fieldset>
      </div>
    );
  }
  if (step === 'plan') {
    return (
      <PlanCard ctx={ctx}>
        <p className={styles['muted']}>{t('web.a11.plan.effect', { pct: market.host.sharePct })}</p>
      </PlanCard>
    );
  }
  return (
    <div className={styles['stack']}>
      <ul className={styles['rows']}>
        {A10_STEPS.filter((s) => s !== 'review').map((s) => (
          <Row
            key={s}
            icon="check"
            title={t(`web.a10.step.${s}`)}
            end={
              <a className={styles['link']} href={ctx.href('a10', { sel: s })}>
                {t('web.a10.edit')}
              </a>
            }
          />
        ))}
      </ul>
      <p className={styles['muted']}>
        {t('web.a10.review.body', { brand: ctx.brand, count: market.host.ops.slaHours })}
      </p>
    </div>
  );
}

export function A10({ ctx }: { readonly ctx: ScreenContext }) {
  const { t, state } = ctx;
  const sel = ctx.options.sel;
  const step: A10Step =
    state === 'error' ? 'documents' : (A10_STEPS.find((s) => s === sel) ?? 'photos');
  const index = A10_STEPS.indexOf(step);
  const prev = A10_STEPS[index - 1];
  const next = A10_STEPS[index + 1];
  const car = hostCar(ctx);
  if (state === 'empty') {
    return (
      <>
        <AppHeader ctx={ctx} back={ctx.href('a02')} title={t('web.a10.title')} />
        <main className={styles['content']}>
          <EmptyState
            icon="car"
            title={t('web.a10.empty')}
            body={t('web.a10.empty.body')}
            action={
              <ButtonLink href={ctx.href('a10', { sel: 'vehicle' })}>
                {t('web.a10.start')}
              </ButtonLink>
            }
          />
        </main>
      </>
    );
  }
  return (
    <>
      <AppHeader ctx={ctx} back={ctx.href('a02')} title={t('web.a10.title')} />
      <main className={styles['content']}>
        <div className={styles['between']}>
          <span className={styles['strong']}>{car.title}</span>
          {state === 'closed' ? (
            <Badge tone="success">{t('web.a10.status.ready')}</Badge>
          ) : state === 'loading' ? (
            <span className={styles['muted']} role="status">
              {t('web.a10.saving')}
            </span>
          ) : (
            <Badge tone="neutral" icon="check">
              {t('web.a10.saved')}
            </Badge>
          )}
        </div>
        {state === 'closed' ? (
          <Banner tone="info" icon="lock" title={t('web.a10.closed.title')}>
            {t('web.a10.closed', { brand: ctx.brand, country: ctx.country })}
          </Banner>
        ) : (
          // Huit étapes : barre compacte (« Paso 3 de 8 ») plutôt que huit libellés à 360 px.
          <div className={styles['stackTight']}>
            <label className={styles['muted']} htmlFor="a10-steps">
              {t('common.ui.steps.progress', { current: index + 1, total: A10_STEPS.length })}
            </label>
            <progress
              id="a10-steps"
              className={styles['range']}
              max={A10_STEPS.length}
              value={index + 1}
            />
          </div>
        )}
        {state === 'error' && (
          <Banner tone="danger" live="assertive" title={t('web.a10.refused')}>
            {t('web.a10.refused.reason')}
          </Banner>
        )}
        {state !== 'closed' && <h1 className={styles['h2']}>{t(`web.a10.step.${step}`)}</h1>}
        {state === 'closed' ? (
          <A10Body ctx={ctx} step="photos" />
        ) : (
          <A10Body ctx={ctx} step={step} />
        )}
      </main>
      <ActionBar>
        {state === 'closed' ? (
          <ButtonLink block href={ctx.href('a02', { state: 'closed' })}>
            {t('web.common.continue')}
          </ButtonLink>
        ) : state === 'error' ? (
          <ButtonLink block href={ctx.href('a10', { sel: 'documents' })}>
            <Icon name="camera" />
            {t('web.a10.refused.fix')}
          </ButtonLink>
        ) : (
          <div className={styles['twoCols']}>
            <ButtonLink
              variant="secondary"
              href={prev ? ctx.href('a10', { sel: prev }) : ctx.href('a07')}
            >
              {t('web.a10.prev')}
            </ButtonLink>
            <ButtonLink
              href={next ? ctx.href('a10', { sel: next }) : ctx.href('a10', { state: 'closed' })}
            >
              {next ? t('web.a10.next') : t('web.a10.submit')}
            </ButtonLink>
          </div>
        )}
      </ActionBar>
    </>
  );
}

// ---------------------------------------------------------------- A11

export function A11({ ctx }: { readonly ctx: ScreenContext }) {
  const { t, market, state } = ctx;
  const f = market.featured;
  const car = hostCar(ctx);
  const host = car.host.name;
  const rules: ReadonlyArray<{ readonly key: CopyKey; readonly minor: string }> = [
    { key: 'web.s03.rules.smoking', minor: f.fees.smokingMinor },
    { key: 'web.s03.rules.pets', minor: f.fees.petsMinor },
    { key: 'web.s03.rules.fuel', minor: f.fees.fuelMinor },
  ];
  if (state === 'preview') {
    return (
      <>
        <AppHeader ctx={ctx} back={ctx.href('a11')} title={t('web.a11.preview')} />
        <main className={styles['content']}>
          <Banner tone="info" icon="user">
            {t('web.a11.preview.body')}
          </Banner>
          <section className={styles['section']} aria-labelledby="a11-prev-rules">
            <h2 id="a11-prev-rules" className={styles['h3']}>
              {t('web.s03.rules.title', { host_name: host })}
            </h2>
            <ul className={styles['rows']}>
              {rules.map((r) => (
                <Row key={r.key} icon="info" title={t(r.key, { amount: amount(ctx, r.minor) })} />
              ))}
            </ul>
          </section>
          <section className={styles['section']} aria-labelledby="a11-prev-meet">
            <h2 id="a11-prev-meet" className={styles['h3']}>
              {t('web.s03.meet.title')}
            </h2>
            <MiniMap label={f.meetArea} zone />
          </section>
        </main>
        <ActionBar>
          <ButtonLink block variant="secondary" href={ctx.href('a11')}>
            {t('web.a11.preview.back')}
          </ButtonLink>
        </ActionBar>
      </>
    );
  }
  return (
    <>
      <AppHeader ctx={ctx} back={ctx.href('a02')} title={t('web.a11.title')} />
      <main className={styles['content']}>
        <p className={styles['muted']}>
          {t('web.a11.version', {
            version: market.host.profile.rulesVersion,
            date: ctx.date('monthRef'),
          })}
        </p>
        {state === 'error' && (
          <ErrorBlock ctx={ctx} title={t('web.a11.error')} retry={ctx.href('a11')}>
            {t('web.a11.error.body')}
          </ErrorBlock>
        )}
        {state === 'loading' ? (
          <LoadingBlock ctx={ctx} rows={6} />
        ) : (
          <>
            <Banner tone="info" icon="calendar">
              {t('web.a11.effect')}
            </Banner>
            <section className={styles['section']} aria-labelledby="a11-rules">
              <h2 id="a11-rules" className={styles['h3']}>
                {t('web.a11.rules.title')}
              </h2>
              <ul className={styles['rows']}>
                {rules.map((r) => (
                  <Row
                    key={r.key}
                    icon="info"
                    title={t(r.key, { amount: amount(ctx, r.minor) })}
                    end={
                      <a className={styles['link']} href={ctx.href('a10', { sel: 'rules' })}>
                        {t('web.a10.edit')}
                      </a>
                    }
                  />
                ))}
              </ul>
            </section>
            <section className={styles['section']} aria-labelledby="a11-places">
              <h2 id="a11-places" className={styles['h3']}>
                {t('web.a11.places.title')}
              </h2>
              <ul className={styles['rows']}>
                <Row
                  icon="pin"
                  title={f.meetArea}
                  detail={t('web.a11.hours', {
                    from: ctx.time('hoursFrom'),
                    to: ctx.time('hoursTo'),
                  })}
                />
                <Row icon="route" title={t('web.a11.zones', { country: ctx.country })} />
              </ul>
              <p className={styles['muted']}>{t('web.a11.safety')}</p>
            </section>
            <section className={styles['section']} aria-labelledby="a11-plan">
              <h2 id="a11-plan" className={styles['h3']}>
                {t('web.a01.plans.title')}
              </h2>
              <PlanCard ctx={ctx}>
                <p className={styles['muted']}>
                  {t('web.a11.plan.effect', { pct: market.host.sharePct })}
                </p>
              </PlanCard>
            </section>
            <section className={styles['section']} aria-labelledby="a11-platform">
              <h2 id="a11-platform" className={styles['h3']}>
                {t('web.a11.platform.title', { brand: ctx.brand })}
              </h2>
              <ul className={styles['rows']}>
                <Row
                  icon="calendar"
                  title={t('web.a11.platform.cancel', { country: ctx.country })}
                  end={
                    <Badge tone="neutral" icon="lock">
                      {t('web.a11.readOnly')}
                    </Badge>
                  }
                />
                <Row
                  icon="key"
                  title={t('web.a11.platform.deposit', {
                    amount: amount(ctx, f.depositMinor),
                    brand: ctx.brand,
                  })}
                  end={
                    <Badge tone="neutral" icon="lock">
                      {t('web.a11.readOnly')}
                    </Badge>
                  }
                />
              </ul>
            </section>
          </>
        )}
      </main>
      <ActionBar>
        <div className={styles['twoCols']}>
          <ButtonLink variant="secondary" href={ctx.href('a11', { state: 'preview' })}>
            {t('web.a11.preview')}
          </ButtonLink>
          <ButtonLink href={ctx.href('a02')}>{t('web.a11.save')}</ButtonLink>
        </div>
      </ActionBar>
    </>
  );
}

// ---------------------------------------------------------------- A13

export function A13({ ctx }: { readonly ctx: ScreenContext }) {
  const { t, i18n, market, state } = ctx;
  const car = hostCar(ctx);
  const profile = market.host.profile;
  const lang = ctx.copy.language;
  const bio = profile.bio[lang];
  const promise = profile.promise[lang];
  const languages = new Intl.DisplayNames(i18n.profile.tag, { type: 'language' });
  const spoken = profile.languages.map((l) => languages.of(l) ?? l).join(' · ');
  if (state === 'preview') {
    return (
      <>
        <AppHeader ctx={ctx} back={ctx.href('a13')} title={t('web.a11.preview')} />
        <main className={styles['content']}>
          <HostCard
            i18n={i18n}
            id="a13-preview"
            name={car.host.name}
            titleForm={car.host.titleForm}
            tone={car.host.tone}
            rating={car.rating}
            trips={car.trips}
            memberSince={car.host.memberSince}
            verified
            responseRate={car.host.responseRate}
            responseHours={car.host.responseHours}
            quote={promise}
            headingLevel={2}
          />
          <p className={styles['text']}>{bio}</p>
        </main>
        <ActionBar>
          <ButtonLink block variant="secondary" href={ctx.href('a13')}>
            {t('web.a11.preview.back')}
          </ButtonLink>
        </ActionBar>
      </>
    );
  }
  return (
    <>
      <AppHeader ctx={ctx} back={ctx.href('a02')} title={t('web.a13.title')} />
      <main className={styles['content']}>
        <div className={styles['hostStrip']}>
          <span className={styles['hostAvatar']} aria-hidden="true">
            {car.host.name.charAt(0)}
          </span>
          <span className={styles['h3']}>{car.host.name}</span>
          <span className={styles['muted']}>
            {profile.city} ·{' '}
            {t('web.a13.memberSince', { brand: ctx.brand, year: String(car.host.memberSince) })}
          </span>
        </div>
        {state === 'loading' && <LoadingBlock ctx={ctx} rows={4} />}
        {state === 'empty' && (
          <EmptyState
            icon="user"
            title={t('web.a13.empty')}
            body={t('web.a13.empty.body')}
            action={<ButtonLink href={ctx.href('a13')}>{t('web.a13.write')}</ButtonLink>}
          />
        )}
        {(state === 'normal' || state === 'error') && (
          <form className={styles['stack']} action={ctx.href('a13').split('?')[0]} method="get">
            <TextField
              i18n={i18n}
              id="a13-languages"
              label={t('web.a13.languages')}
              defaultValue={spoken}
            />
            <div className={styles['stackTight']}>
              <label className={styles['strong']} htmlFor="a13-about">
                {t('web.a13.about')}
              </label>
              <textarea
                id="a13-about"
                className={styles['textarea']}
                rows={4}
                defaultValue={state === 'error' ? `${bio} WhatsApp ${market.phoneMasked}` : bio}
                aria-invalid={state === 'error' ? true : undefined}
                aria-describedby={state === 'error' ? 'a13-about-error' : undefined}
              />
              {state === 'error' && (
                <p id="a13-about-error" className={styles['fieldError']}>
                  <Icon name="alert" />
                  {t('web.a13.refusedContact', { brand: ctx.brand })}
                </p>
              )}
            </div>
            <TextField
              i18n={i18n}
              id="a13-promise"
              label={t('web.a13.promise')}
              defaultValue={promise}
            />
            <ul className={styles['rows']}>
              <Row
                icon="clock"
                title={t('web.a13.response', {
                  count: car.host.responseHours,
                  rate: car.host.responseRate,
                })}
                detail={t('web.a13.response.body')}
              />
            </ul>
          </form>
        )}
        {state !== 'loading' && (
          <section className={styles['section']} aria-labelledby="a13-reviews">
            <h2 id="a13-reviews" className={styles['h3']}>
              {t('web.a13.reviews')}
            </h2>
            <figure className={styles['card']}>
              <blockquote className={styles['quote']}>{profile.review.text[lang]}</blockquote>
              <figcaption className={styles['muted']}>
                {t('web.a13.review.by', {
                  name: profile.review.author,
                  count: profile.review.stars,
                })}
              </figcaption>
              <ButtonLink variant="quiet" href={ctx.href('a13')}>
                <Icon name="chat" />
                {t('web.a13.reply')}
              </ButtonLink>
            </figure>
          </section>
        )}
      </main>
      <ActionBar>
        <div className={styles['twoCols']}>
          <ButtonLink variant="secondary" href={ctx.href('a13', { state: 'preview' })}>
            {t('web.a11.preview')}
          </ButtonLink>
          <ButtonLink href={ctx.href('a02')}>{t('web.common.save')}</ButtonLink>
        </div>
      </ActionBar>
    </>
  );
}
