import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createTranslator, getProfile } from '@rueda/i18n';
import { LOCALE_CONFIG } from '../locale-config.ts';
import {
  ENTRY_FIELD,
  entryDayLabel,
  entryInputErrors,
  entryInputOf,
  entryRequestOf,
  isCalendarDay,
  RESIDENCY_STATUSES,
} from './entry-declaration.ts';

const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};

describe('déclaration d’entrée (US-209c ; 16 VER-007, règles de POST /identity/entry-declaration)', () => {
  it('touriste sans date ⇒ date obligatoire ; statut absent ⇒ choix obligatoire ; pays mal formé ⇒ erreur ; rien n’est envoyé', () => {
    expect(
      entryInputErrors(entryInputOf(form({ country: 'ZZ', residencyStatus: 'TOURIST' }))),
    ).toEqual([{ fieldId: ENTRY_FIELD.date, key: 'web.s04.entry.dateRequired' }]);
    expect(entryInputErrors(entryInputOf(form({ country: 'ZZ' })))).toEqual([
      { fieldId: ENTRY_FIELD.status, key: 'web.s04.entry.statusRequired' },
    ]);
    expect(
      entryInputErrors(entryInputOf(form({ country: 'zz1', residencyStatus: 'RESIDENT' }))),
    ).toEqual([{ fieldId: ENTRY_FIELD.country, key: 'common.legal.countryUnknown' }]);
    // statut hors énumération : jamais transmis tel quel
    expect(entryInputOf(form({ residencyStatus: 'VISA' })).residency).toBeNull();
  });

  it('jour réel du calendrier seulement (2031-02-31 refusé, comme l’API) ; résident sans date admis', () => {
    expect(isCalendarDay('2026-11-01')).toBe(true);
    expect(isCalendarDay('2031-02-31')).toBe(false);
    expect(isCalendarDay('2026-1-01')).toBe(false);
    expect(
      entryInputErrors(
        entryInputOf(form({ country: 'ZZ', residencyStatus: 'TOURIST', entryDate: '2031-02-31' })),
      ),
    ).toEqual([{ fieldId: ENTRY_FIELD.date, key: 'common.kyc.entryDateInvalid' }]);
    expect(
      entryInputErrors(entryInputOf(form({ country: 'ZZ', residencyStatus: 'RESIDENT' }))),
    ).toEqual([]);
  });

  it('corps envoyé : pays, statut, date seulement si saisie (champs du contrat OpenAPI)', () => {
    const tourist = entryRequestOf(
      entryInputOf(form({ country: 'ZZ', residencyStatus: 'TOURIST', entryDate: '2026-11-01' })),
    );
    expect(tourist).toEqual({ country: 'ZZ', residencyStatus: 'TOURIST', entryDate: '2026-11-01' });
    expect(
      entryRequestOf(entryInputOf(form({ country: 'ZZ', residencyStatus: 'RESIDENT' }))),
    ).toEqual({ country: 'ZZ', residencyStatus: 'RESIDENT' });
    const doc = JSON.parse(
      readFileSync(new URL('../../api/openapi/openapi.json', import.meta.url), 'utf8'),
    ) as {
      components: {
        schemas: {
          KycEntryDeclarationRequest: {
            properties: Record<string, { enum?: string[] }>;
            required: string[];
          };
        };
      };
    };
    const schema = doc.components.schemas.KycEntryDeclarationRequest;
    for (const key of Object.keys(tourist)) expect(Object.keys(schema.properties)).toContain(key);
    expect(schema.required.every((k) => k in tourist)).toBe(true);
    expect(schema.properties['residencyStatus']?.enum).toEqual([...RESIDENCY_STATUSES]);
  });

  it('date d’entrée mise en forme dans chaque langue déclarée, au jour exact (motif de la configuration, aucun décalage de fuseau)', () => {
    for (const locale of LOCALE_CONFIG.locales) {
      const i18n = createTranslator(getProfile(LOCALE_CONFIG, locale.tag));
      const expected = locale.date.datePattern
        .replace('{day}', '01')
        .replace('{month}', '11')
        .replace('{year}', '2026');
      expect(entryDayLabel(i18n, '2026-11-01'), locale.tag).toBe(expected);
    }
  });
});
