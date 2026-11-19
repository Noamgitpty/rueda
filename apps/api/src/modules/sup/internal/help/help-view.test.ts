/**
 * US-310 — vue de l'aide d'un pays (`helpViewOf`) : numéros et plage lus de la configuration pays
 * (ADR-174, ADR-182), jamais en dur. Le dépôt ne porte pas encore les numéros (donnée du fondateur) :
 * une configuration DÉRIVÉE du dépôt porte ici des numéros de test (indicatif du pays suivi de zéros,
 * jamais un vrai numéro) et une plage de test, pour prouver qu'ils sont servis tels quels, et que la
 * référence du planning de présence (SUP-020) reste interne. PA et PY.
 */
import { describe, expect, it } from 'vitest';
import { CountryConfigService } from '../../../cfg/index.js';
import { authorityMessageKey, helpViewOf } from './help.controller.js';

const repo = new CountryConfigService().config;

/** Configuration du dépôt dont chaque pays reçoit des numéros et une plage de test. */
function withTestData(): CountryConfigService {
  const countries = new Map(
    [...repo.countries].map(([code, entry]) => {
      const national = (last: string) => '0'.repeat(entry.phone.nationalLength - 1) + last;
      return [
        code,
        {
          ...entry,
          assistanceContacts: {
            supportPhone: `+${entry.phone.callingCode}${national('1')}`,
            insurerAssistancePhone: `+${entry.phone.callingCode}${national('2')}`,
          },
          help: {
            ...entry.help,
            supportHours: { from: '08:00', to: '20:00', staffingPlanRef: 'PLANNING-TEST' },
          },
        },
      ] as const;
    }),
  );
  return { config: { ...repo, countries } } as unknown as CountryConfigService;
}

describe.each([...repo.countries.keys()])('US-310 — aide du pays %s', (code) => {
  it('dépôt : numéros absents (null), aucune plage publiée ; urgence et autorité du pays', () => {
    const entry = repo.countries.get(code)!;
    const v = helpViewOf(new CountryConfigService(), code)!;
    expect(v.supportPhone).toBeNull();
    expect(v.insurerAssistancePhone).toBeNull();
    expect(v.supportHours).toBeNull();
    expect(v.emergencyNumber).toBe(entry.help.emergencyNumber);
    expect(v.trafficAuthority).toEqual({
      id: entry.help.trafficAuthority,
      messageKey: authorityMessageKey(entry.help.trafficAuthority),
    });
  });

  it('numéros et plage fournis : servis tels quels ; la référence du planning reste interne', () => {
    const cfg = withTestData();
    const entry = cfg.config.countries.get(code)!;
    const v = helpViewOf(cfg, code)!;
    expect(v.supportPhone).toBe(entry.assistanceContacts!.supportPhone);
    expect(v.insurerAssistancePhone).toBe(entry.assistanceContacts!.insurerAssistancePhone);
    expect(v.supportPhone!.startsWith(`+${entry.phone.callingCode}`)).toBe(true);
    expect(v.supportHours).toEqual({ from: '08:00', to: '20:00' });
    expect(JSON.stringify(v)).not.toContain('PLANNING-TEST');
  });
});

it('pays inconnu : aucune vue', () => {
  expect(helpViewOf(new CountryConfigService(), 'ZZ')).toBeNull();
});
