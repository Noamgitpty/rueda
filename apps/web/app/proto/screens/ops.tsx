/**
 * O01 Console ops : files de revue (10b §4.1) — KYC des voyageurs et des hôtes, annonces et pièces
 * de véhicule, réservations signalées, dommages et litiges, retards ; fiche 360°, décision motivée
 * par gabarit, journal. Textes de l'espace `backoffice` (même conventions que l'existant).
 *
 * Approuver une annonce ou un KYC **n'active pas** l'hôte : l'activation dépend des interrupteurs
 * du pays, que la fiche montre en lecture seule (aucune décision du fondateur prise ici).
 */
import {
  Avatar,
  Badge,
  Banner,
  ButtonLink,
  CarIllustration,
  DataTable,
  EmptyState,
} from '@rueda/ui';
import type { ScreenContext } from '../context.ts';
import { OPS_QUEUES, hostActivatable, hostTrip } from '../data/scenario.ts';
import type { OpsQueue } from '../data/scenario.ts';
import { ActionBar, Row, Wordmark, cx, styles } from '../shell.tsx';
import { ErrorBlock, LoadingBlock, firstName, hostCar } from './host-kit.tsx';

function OpsHeader({ ctx }: { readonly ctx: ScreenContext }) {
  return (
    <header className={cx(styles['header'], styles['opsHeader'])}>
      <a className={styles['wordmark']} href={ctx.href('o01')}>
        <Wordmark brand={ctx.brand} />
      </a>
      <Badge tone="neutral" icon="user">
        {ctx.t('backoffice.role.OPS_AGENT')}
      </Badge>
    </header>
  );
}

export function O01({ ctx }: { readonly ctx: ScreenContext }) {
  const { t, market, state } = ctx;
  const queues = market.host.ops.queues;
  const current: OpsQueue = OPS_QUEUES.find((q) => q === ctx.options.sel) ?? 'listing';
  const car = hostCar(ctx);
  const other = market.host.otherCar;
  const hold = hostTrip(market, 'hold');
  const items = [
    {
      id: 'l1',
      title: other.title,
      subject: car.host.name,
      what: t('backoffice.o01.item.firstListing'),
      age: 3,
    },
    {
      id: 'l2',
      title: car.title,
      subject: car.host.name,
      what: t('backoffice.o01.item.inspection'),
      age: 7,
    },
    {
      id: 'l3',
      title: market.host.damageCode,
      subject: firstName(hold.guest),
      what: t('backoffice.o01.item.claim'),
      age: 20,
    },
  ];
  const empty = state === 'empty';
  return (
    <>
      <OpsHeader ctx={ctx} />
      <main className={styles['content']}>
        <header className={styles['stackTight']}>
          <h1 className={styles['h1']}>{t('backoffice.o01.title')}</h1>
          <p className={styles['muted']}>
            {t('backoffice.o01.sla', { count: market.host.ops.slaHours })}
          </p>
        </header>
        <nav aria-label={t('backoffice.o01.queues')}>
          <ul className={styles['chips']}>
            {OPS_QUEUES.map((q) => (
              <li key={q}>
                <a
                  className={styles['chip']}
                  href={ctx.href('o01', { sel: q })}
                  aria-current={q === current ? 'true' : undefined}
                >
                  {t(`backoffice.o01.queue.${q}`)} · {empty ? 0 : queues[q]}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        {state === 'loading' && <LoadingBlock ctx={ctx} rows={4} />}
        {state === 'error' && (
          <ErrorBlock ctx={ctx} title={t('backoffice.o01.error')} retry={ctx.href('o01')} />
        )}
        {(empty || (state === 'normal' && queues[current] === 0)) && (
          <EmptyState
            icon="check"
            title={t('backoffice.o01.empty')}
            body={t('backoffice.o01.empty.body')}
          />
        )}
        {state === 'normal' && queues[current] > 0 && (
          <ul className={styles['stack']}>
            {items.map((item) => (
              <li key={item.id} className={styles['card']}>
                <div className={styles['between']}>
                  <span className={styles['strong']}>{item.title}</span>
                  <Badge
                    tone={item.age > market.host.ops.slaHours * 0.75 ? 'warning' : 'neutral'}
                    icon="clock"
                  >
                    {t('backoffice.o01.age', { count: item.age })}
                  </Badge>
                </div>
                <span className={styles['muted']}>
                  {item.subject} · {item.what}
                </span>
                <ButtonLink variant="secondary" size="sm" href={ctx.href('o01', { state: 'item' })}>
                  {t('backoffice.o01.open')}
                </ButtonLink>
              </li>
            ))}
          </ul>
        )}
        {state === 'item' && (
          <>
            <section className={styles['card']} aria-labelledby="o01-360">
              <p className={styles['kicker']}>{t('backoffice.o01.queue.listing')}</p>
              <h2 id="o01-360" className={styles['h2']}>
                {other.title}
              </h2>
              <div className={styles['tripMediaWide']}>
                <CarIllustration tone={other.tone} kind={other.kind} />
              </div>
              <div className={styles['guestLine']}>
                <Avatar name={car.host.name} tone={car.host.tone} />
                <span className={styles['rowText']}>
                  <span className={styles['strong']}>{car.host.name}</span>
                  <span className={styles['muted']}>
                    {t('backoffice.o01.host.summary', {
                      year: String(car.host.memberSince),
                      count: car.trips,
                    })}
                  </span>
                </span>
                <span />
              </div>
              <span className={styles['inline']}>
                <Badge tone="success">{t('web.host.guest.verified')}</Badge>
              </span>
              <ul className={styles['rows']}>
                <Row
                  icon="document"
                  title={t('backoffice.o01.doc.title')}
                  end={<Badge tone="success">{t('backoffice.o01.check.ok')}</Badge>}
                />
                <Row
                  icon="document"
                  title={t('backoffice.o01.doc.plate')}
                  end={<Badge tone="danger">{t('backoffice.o01.check.mismatch')}</Badge>}
                />
                <Row
                  icon="document"
                  title={t('backoffice.o01.doc.inspection')}
                  end={<Badge tone="success">{t('backoffice.o01.check.ok')}</Badge>}
                />
                <Row
                  icon="key"
                  title={t('backoffice.o01.financed')}
                  end={<Badge tone="success">{t('backoffice.o01.check.ok')}</Badge>}
                />
              </ul>
            </section>
            <Banner
              tone="info"
              icon="lock"
              title={t('backoffice.o01.gates.title', { country: ctx.country })}
            >
              {hostActivatable(market.host.gates)
                ? t('backoffice.o01.gates.open')
                : t('backoffice.o01.gates.closed', { insurer: market.insurerName })}
            </Banner>
            <form className={styles['stack']} action={ctx.href('o01').split('?')[0]} method="get">
              <fieldset className={styles['choices']}>
                <legend className={styles['h3']}>{t('backoffice.o01.decision')}</legend>
                {(['approve', 'reject'] as const).map((d) => (
                  <label key={d} className={styles['choice']}>
                    <input type="radio" name="decision" value={d} defaultChecked={d === 'reject'} />
                    <span className={styles['choiceBody']}>
                      {t(`backoffice.o01.decision.${d}`)}
                    </span>
                    <span />
                  </label>
                ))}
              </fieldset>
              <label className={styles['strong']} htmlFor="o01-reason">
                {t('backoffice.o01.reason')}
              </label>
              <select id="o01-reason" className={styles['select']} defaultValue="plate">
                {(['plate', 'blurry', 'owner'] as const).map((r) => (
                  <option key={r} value={r}>
                    {t(`backoffice.o01.reason.${r}`)}
                  </option>
                ))}
              </select>
              <p className={styles['muted']}>{t('backoffice.o01.reason.sent')}</p>
            </form>
            <DataTable
              id="o01-journal"
              caption={t('backoffice.journal.caption')}
              columns={[
                { key: 'when', header: t('backoffice.journal.when') },
                { key: 'who', header: t('backoffice.journal.who') },
                { key: 'action', header: t('backoffice.journal.action') },
              ]}
              rows={[
                {
                  id: 'j1',
                  cells: {
                    when: ctx.date('claimFiled'),
                    who: car.host.name,
                    action: t('backoffice.o01.journal.submitted'),
                  },
                },
                {
                  id: 'j2',
                  cells: {
                    when: ctx.date('evidenceUntil'),
                    who: t('backoffice.role.OPS_AGENT'),
                    action: t('backoffice.o01.journal.opened'),
                  },
                },
              ]}
            />
          </>
        )}
      </main>
      {state === 'item' && (
        <ActionBar>
          <div className={styles['twoCols']}>
            <ButtonLink variant="secondary" href={ctx.href('o01')}>
              {t('backoffice.o01.back')}
            </ButtonLink>
            <ButtonLink href={ctx.href('o01')}>{t('backoffice.o01.submit')}</ButtonLink>
          </div>
        </ActionBar>
      )}
    </>
  );
}
