import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import {
  Avatar,
  Badge,
  Banner,
  Button,
  CarCard,
  Checkbox,
  DataTable,
  DepositBlock,
  ErrorState,
  ErrorSummary,
  HostCard,
  IconButton,
  LoadingState,
  PhotoSlot,
  Rating,
  Steps,
  TextField,
  monogram,
  toneOf,
} from '../src/index.ts';
import samples from '../src/catalog/samples.json' with { type: 'json' };
import fixture from './fixtures/amounts.json' with { type: 'json' };
import { LOCALES, axeViolations, describeViolations, page, render, textOf } from './helpers.tsx';

const [, , es] = LOCALES[0]!;
const first = fixture.cases[0]!;
const amount = {
  amountMinor: BigInt(first.amountMinor),
  currency: first.currency,
  exponent: first.exponent,
};
const doc = (html: string) => new JSDOM(html).window.document;
// Fuseau d'exemple lu dans les données de la vitrine (aucun fuseau écrit dans le code).
const TZ = samples.timeZone;

describe('Button', () => {
  it('type="button" par défaut, jamais un envoi par surprise', () => {
    expect(render(<Button>Ok</Button>)).toContain('type="button"');
    expect(render(<Button type="submit">Ok</Button>)).toContain('type="submit"');
  });

  it('chargement : aria-busy, libellé conservé, indicateur décoratif', () => {
    const html = render(<Button loading>{es.t('web.common.save')}</Button>);
    expect(html).toContain('aria-busy="true"');
    expect(textOf(html)).toContain(es.t('web.common.save'));
    expect(html).toContain('aria-hidden="true"');
  });

  it('désactivé : attribut natif', () => {
    expect(render(<Button disabled>x</Button>)).toContain('disabled=""');
  });
});

describe('IconButton', () => {
  it('nom accessible obligatoire et état de bascule', () => {
    const html = render(<IconButton icon="heart" label="Guardar" pressed />);
    const button = doc(html).querySelector('button')!;
    expect(button.getAttribute('aria-label')).toBe('Guardar');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('TextField et Checkbox', () => {
  it('erreur liée au champ (aria-invalid, aria-describedby), aide conservée', () => {
    const html = render(
      <TextField i18n={es} id="email" label="Correo" hint="Ayuda" error="Error de prueba" />,
    );
    const input = doc(html).querySelector('input')!;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('email-error email-hint');
    expect(input.hasAttribute('required')).toBe(true);
    expect(doc(html).querySelector('label')!.getAttribute('for')).toBe('email');
  });

  it.each(LOCALES)('%s : champ facultatif annoncé dans le libellé', (_t, _p, i18n) => {
    const html = render(<TextField i18n={i18n} id="n" label="X" optional />);
    expect(textOf(html)).toContain(i18n.t('common.ui.optional'));
    expect(doc(html).querySelector('input')!.hasAttribute('required')).toBe(false);
  });

  it('case à cocher jamais pré-cochée par défaut', () => {
    const html = render(<Checkbox id="c" label="Acepto" />);
    expect(doc(html).querySelector('input')!.hasAttribute('checked')).toBe(false);
  });

  it.each(LOCALES)('%s : récapitulatif d’erreurs assertif, un lien par champ', (_t, _p, i18n) => {
    const html = render(
      <ErrorSummary
        i18n={i18n}
        errors={[
          { fieldId: 'a', message: 'A' },
          { fieldId: 'b', message: 'B' },
        ]}
      />,
    );
    const d = doc(html);
    expect(d.querySelector('[role="alert"]')).not.toBeNull();
    expect([...d.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['#a', '#b']);
    expect(textOf(html)).toContain(i18n.t('common.ui.errorSummary.title', { count: 2 }));
    expect(render(<ErrorSummary i18n={i18n} errors={[]} />)).toBe('');
  });
});

describe('Avatar, Badge, Rating', () => {
  it('monogramme et ton stable', () => {
    expect(monogram('María José')).toBe('MJ');
    expect(monogram('  ana  ')).toBe('A');
    expect(toneOf('María José')).toBe(toneOf('María José'));
    expect([1, 2, 3, 4]).toContain(toneOf('Luis'));
  });

  it('avatar décoratif par défaut, sinon image nommée', () => {
    expect(render(<Avatar name="Ana" />)).toContain('aria-hidden="true"');
    const html = render(<Avatar name="Ana" decorative={false} />);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Ana"');
  });

  it('pastille d’état : icône + texte, jamais la couleur seule', () => {
    expect(render(<Badge tone="success">Ok</Badge>)).toContain('<svg');
    expect(render(<Badge tone="danger">Ko</Badge>)).toContain('<svg');
  });

  it.each(LOCALES)('%s : note lue « sur 5 », voiture sans avis = « Nuevo »', (_t, _p, i18n) => {
    const rated = textOf(render(<Rating i18n={i18n} value={4.9} trips={23} />));
    expect(rated).toContain(
      i18n.t('common.ui.rating.label', { rating: i18n.number(4.9, { fractionDigits: 1 }) }),
    );
    expect(rated).toContain(i18n.t('common.ui.rating.trips', { count: 23 }));
    expect(textOf(render(<Rating i18n={i18n} trips={0} />))).toContain(i18n.t('web.s02.new'));
  });
});

describe('CarCard', () => {
  it.each(LOCALES)(
    '%s : un seul lien vers la fiche, prix final, hôte, distance',
    async (tag, _p, i18n) => {
      const html = render(
        <CarCard
          i18n={i18n}
          href="/car/1"
          title="Toyota Yaris 2021"
          host={{ name: 'María José' }}
          rating={4.9}
          trips={23}
          place="Barrio"
          distanceKm={1.2}
          total={amount}
          perDay={amount}
          days={3}
          saveAction={
            <IconButton
              icon="heart"
              label={i18n.t('common.ui.car.save', { car: 'Toyota Yaris 2021' })}
            />
          }
        />,
      );
      const d = doc(html);
      expect([...d.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['/car/1']);
      expect(d.querySelector('h3 a')!.textContent).toBe('Toyota Yaris 2021');
      const text = textOf(html);
      expect(text).toContain(i18n.money(amount));
      expect(text).toContain(
        i18n.t('common.ui.distance', { distance: i18n.number(1.2, { fractionDigits: 1 }) }),
      );
      expect(text).toContain('María José');
      expect(describeViolations(await axeViolations(page(html, tag)))).toEqual([]);
    },
  );
});

describe('HostCard', () => {
  it.each([
    ['masc', 'web.s03.host.titleMasc'],
    ['fem', 'web.s03.host.titleFem'],
    ['neutral', 'web.s03.host.titleNeutral'],
  ] as const)('forme %s : clé %s', (form, key) => {
    const html = render(
      <HostCard
        i18n={es}
        id="h"
        name="Ana"
        titleForm={form}
        trips={2}
        memberSince={2024}
        verified
      />,
    );
    expect(textOf(html)).toContain(es.t(key));
    expect(textOf(html)).toContain(es.t('web.host.guest.verified'));
    // L'année n'a pas de séparateur de milliers.
    expect(textOf(html)).toContain('2024');
  });
});

describe('DepositBlock', () => {
  const instant = '2027-01-18T15:00:00Z';
  it.each(LOCALES)('%s : les six réponses de 10b UX-21', (_t, _p, i18n) => {
    const text = textOf(
      render(
        <DepositBlock
          i18n={i18n}
          id="d"
          rail="preauth"
          amount={amount}
          merchantName="Marchand"
          hostName="Ana"
          releaseBy={{ instant, timeZone: TZ }}
        />,
      ),
    );
    expect(text).toContain(i18n.money(amount));
    expect(text).toContain(
      i18n.t('web.deposit.holder', { merchant_name: 'Marchand', host_name: 'Ana' }),
    );
    expect(text).toContain(i18n.t('web.deposit.how.preauth'));
    expect(text).toContain(i18n.t('web.deposit.covers'));
    expect(text).toContain(i18n.t('web.deposit.notCovers'));
    expect(text).toContain(i18n.t('web.deposit.releaseBy', { date: i18n.date(instant, TZ) }));
    expect(text).not.toContain(i18n.t('web.deposit.how.chargeRefund'));
  });

  it('débit puis remboursement : avertissement avec la date d’émission (UX-23)', () => {
    const text = textOf(
      render(
        <DepositBlock
          i18n={es}
          id="d"
          rail="chargeRefund"
          amount={amount}
          merchantName="M"
          hostName="Ana"
          releaseBy={{ instant, timeZone: TZ }}
          refundIssuedOn={{ instant, timeZone: TZ }}
        />,
      ),
    );
    expect(text).toContain(es.t('web.deposit.how.chargeRefund'));
    expect(text).toContain(es.t('web.deposit.debitWarning', { date: es.date(instant, TZ) }));
  });
});

describe('États et bandeaux', () => {
  it('chargement annoncé une fois, en région polie', () => {
    const html = render(<LoadingState i18n={es} />);
    expect(html).toContain('role="status"');
    expect(textOf(html)).toContain(es.t('common.ui.loading'));
  });

  it('erreur : région assertive, code de support', () => {
    const html = render(<ErrorState i18n={es} message="Algo falló" code="X1" />);
    expect(html).toContain('role="alert"');
    expect(textOf(html)).toContain(es.t('common.ui.error.code', { code: 'X1' }));
  });

  it('bandeau : rôle selon l’urgence', () => {
    expect(render(<Banner live="polite">a</Banner>)).toContain('role="status"');
    expect(render(<Banner live="assertive">a</Banner>)).toContain('role="alert"');
    expect(render(<Banner>a</Banner>)).not.toContain('role=');
  });
});

describe('Steps', () => {
  it.each(LOCALES)('%s : étape courante marquée, progression écrite', (_t, _p, i18n) => {
    const html = render(<Steps i18n={i18n} steps={['A', 'B', 'C']} current={1} />);
    const items = [...doc(html).querySelectorAll('li')];
    expect(items.map((li) => li.getAttribute('aria-current'))).toEqual([null, 'step', null]);
    expect(textOf(html)).toContain(i18n.t('common.ui.steps.progress', { current: 2, total: 3 }));
    expect(items[0]!.textContent).toContain(i18n.t('common.ui.steps.done'));
  });
});

describe('PhotoSlot', () => {
  it.each(LOCALES)('%s : action et angle dans le nom, état écrit', (_t, _p, i18n) => {
    const empty = textOf(render(<PhotoSlot i18n={i18n} id="p" angle="X" state="empty" />));
    expect(empty).toContain(i18n.t('common.ui.photo.take', { angle: 'X' }));
    const failed = textOf(render(<PhotoSlot i18n={i18n} id="p" angle="X" state="failed" />));
    expect(failed).toContain(i18n.t('common.ui.photo.retake', { angle: 'X' }));
    expect(failed).toContain(i18n.t('common.ui.photo.failed'));
    expect(render(<PhotoSlot i18n={i18n} id="p" angle="X" state="uploading" />)).toContain(
      'disabled=""',
    );
  });
});

describe('DataTable', () => {
  it('légende, en-têtes de colonnes et de lignes, région focalisable', () => {
    const html = render(
      <DataTable
        id="t"
        caption="Tabla"
        columns={[
          { key: 'a', header: 'A' },
          { key: 'b', header: 'B', align: 'end' },
        ]}
        rows={[{ id: '1', cells: { a: 'x', b: 'y' } }]}
      />,
    );
    const d = doc(html);
    expect(d.querySelector('caption')!.textContent).toBe('Tabla');
    expect(d.querySelectorAll('th[scope="col"]').length).toBe(2);
    expect(d.querySelectorAll('th[scope="row"]').length).toBe(1);
    expect(d.querySelector('[role="region"]')!.getAttribute('tabindex')).toBe('0');
  });
});
