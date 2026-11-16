/**
 * Plans de gains de l'hôte (US-226 partie 226b) : lecture défensive de la route de l'API et nom
 * lisible d'un plan. Attendus : 16 PRT-007 (plan par défaut `ESTÁNDAR`, part de 75 % = 3/4,
 * OQ-P2P-11) et « aucun plan PRO proposé » ; jamais tirés du code testé.
 */
import { describe, expect, it } from 'vitest';
import { createTranslator, getProfile } from '@rueda/i18n';
import { LOCALE_CONFIG } from '../locale-config.ts';
import { earningsPlansOf, planName, planSummary, sharePercentOf } from './earnings-plans.ts';

const V = '00000000-0000-4000-8000-0000000226b1';
const reply = (status: number, json: unknown) => ({ status, json, session: null }) as const;
const body = (extra: Record<string, unknown> = {}) => ({
  plans: {
    defaultPlan: 'ESTÁNDAR',
    offered: [{ planCode: 'ESTÁNDAR', hostShare: '3/4' }],
    vehicles: [{ vehicleId: V, planCode: 'ESTÁNDAR', chosen: false, chosenAt: null }],
    ...extra,
  },
});

describe('part de l’hôte affichée', () => {
  it('fraction « n/d » ⇒ pourcentage exact (3/4 ⇒ 75 ; 17/20 ⇒ 85 ; 7/8 ⇒ 87,5) ; illisible ⇒ null', () => {
    expect(sharePercentOf('3/4')).toBe(75);
    expect(sharePercentOf('17/20')).toBe(85);
    expect(sharePercentOf('7/8')).toBe(87.5);
    expect(sharePercentOf('1/1')).toBe(100);
    for (const v of ['5/4', '0/4', '2/3', '3/0', '0.75', 0.75, null]) {
      expect(sharePercentOf(v), String(v)).toBeNull();
    }
  });
});

describe('plans de gains du compte', () => {
  it('plan par défaut ESTÁNDAR 75 % attribué au véhicule (16 PRT-007, critère 1)', () => {
    expect(earningsPlansOf(reply(200, body()))).toEqual({
      defaultPlan: 'ESTÁNDAR',
      offered: [{ planCode: 'ESTÁNDAR', sharePercent: 75 }],
      vehicles: [{ vehicleId: V, planCode: 'ESTÁNDAR', chosen: false, chosenAt: null }],
    });
  });

  it('PRO jamais proposé, même rendu par l’API (16 PRT-007, critère 4)', () => {
    const plans = earningsPlansOf(
      reply(
        200,
        body({
          offered: [
            { planCode: 'PRO', hostShare: '9/10' },
            { planCode: 'ESTÁNDAR', hostShare: '3/4' },
          ],
        }),
      ),
    );
    expect(plans?.offered.map((o) => o.planCode)).toEqual(['ESTÁNDAR']);
  });

  it('réponse mal formée ⇒ null (aucun plan deviné)', () => {
    for (const extra of [
      { offered: 'ESTÁNDAR' },
      { offered: [{ planCode: 'estandar', hostShare: '3/4' }] },
      { offered: [{ planCode: 'ESTÁNDAR', hostShare: '0.75' }] },
      {
        offered: [
          { planCode: 'ESTÁNDAR', hostShare: '3/4' },
          { planCode: 'ESTÁNDAR', hostShare: '3/4' },
        ],
      },
      { vehicles: [{ vehicleId: 'x', planCode: 'ESTÁNDAR', chosen: false, chosenAt: null }] },
      { vehicles: [{ vehicleId: V, planCode: 'ESTÁNDAR', chosen: 'no', chosenAt: null }] },
      { vehicles: [{ vehicleId: V, planCode: 'ESTÁNDAR', chosen: true, chosenAt: 'hier' }] },
      { defaultPlan: 3 },
    ]) {
      expect(earningsPlansOf(reply(200, body(extra))), JSON.stringify(extra)).toBeNull();
    }
    expect(earningsPlansOf(reply(404, { code: 'HOST_ACCOUNT_NOT_FOUND' }))).toBeNull();
    expect(earningsPlansOf({ status: 'unavailable' })).toBeNull();
  });

  it('nom lisible dans les quatre langues ; plan inconnu nommé par sa part, jamais par son code', () => {
    const plans = earningsPlansOf(
      reply(
        200,
        body({
          offered: [
            { planCode: 'ESTÁNDAR', hostShare: '3/4' },
            { planCode: 'ALTO', hostShare: '17/20' },
          ],
        }),
      ),
    );
    if (plans === null) throw new Error('plans illisibles');
    const expected: Record<string, [string, string]> = {
      es: ['Estándar · recibes el 75 % del precio', 'Plan del 85 %'],
      en: ['Standard · you receive 75% of the price', '85% plan'],
      fr: ['Standard · tu reçois 75 % du prix', 'Plan à 85 %'],
      pt: ['Padrão · você recebe 75% do preço', 'Plano de 85%'],
    };
    // chaque locale déclarée, par sa langue (aucune locale de pays écrite ici, ADR-024)
    for (const { tag } of LOCALE_CONFIG.locales) {
      const pair = expected[tag.slice(0, 2)];
      if (pair === undefined) throw new Error(`langue sans attendu : ${tag}`);
      const [summary, other] = pair;
      const i18n = createTranslator(getProfile(LOCALE_CONFIG, tag));
      expect(planSummary(i18n, plans, 'ESTÁNDAR'), tag).toBe(summary);
      expect(planName(i18n, plans.offered[1]!), tag).toBe(other);
      expect(planSummary(i18n, plans, 'PRO'), tag).toBeNull();
    }
  });
});
