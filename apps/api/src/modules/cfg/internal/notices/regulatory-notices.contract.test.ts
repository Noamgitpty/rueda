/**
 * US-125 — avertissements réglementaires versionnés (critères 4 et 5 de 19 US-125 ; 16 LEG-021) :
 * chaque réponse HTTP réelle (Nest sur 127.0.0.1, sans base) est confrontée à
 * `apps/api/openapi/openapi.json` par `ContractClient`. Pays lus dans les données CFG, jamais en
 * constantes.
 *
 * Attendus : 19 US-125 (« un pays où le partage entre particuliers a une limite légale connue :
 * plaque particular, statut fiscal de l'hôte ⇒ avertissement versionné » ; « l'hôte ne voit aucun
 * interrupteur ni sa valeur ») ; quatre langues (DEC-FONDATEUR-17, 18).
 */
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CATALOGS } from '@rueda/i18n';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContractClient, repositoryContract } from '../../../../testing/openapi-contract.js';
import { CountryConfigService } from '../country-config.service.js';
import { NOTICE_AUDIENCES } from '../model.js';
import { RegulatoryNoticesModule } from './regulatory-notices.module.js';
import { noticeMessageKey } from './regulatory-notices.controller.js';

const config = new CountryConfigService().config;
const COUNTRIES = [...config.countries.keys()];
const SWITCH_KEYS = [...config.definitions.values()]
  .filter((d) => d.goLiveSwitch)
  .map((d) => d.key);

describe('contrat HTTP — GET /regulatory-notices (US-125)', () => {
  const contract = repositoryContract();
  let app: INestApplication;
  let api: ContractClient;

  beforeAll(async () => {
    app = await NestFactory.create(RegulatoryNoticesModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    api = new ContractClient(contract, (await app.getUrl()).replace('[::1]', '127.0.0.1'));
  });
  afterAll(async () => {
    await app.close();
  });

  it.each(COUNTRIES)(
    'pays %s : chaque pays configuré déclare au moins une limite connue, servie à l’hôte et au voyageur, versionnée',
    async (country) => {
      const declared = config.countries.get(country)?.regulatoryNotices ?? [];
      expect(declared.length).toBeGreaterThan(0);
      for (const audience of NOTICE_AUDIENCES) {
        const r = await api.request(
          'GET',
          `/regulatory-notices?country=${country}&audience=${audience}`,
        );
        expect(r.status).toBe(200);
        expect(r.headers.get('cache-control')).toMatch(/^public, max-age=\d+$/);
        const body = r.json as {
          country: string;
          audience: string;
          notices: { id: string; version: number; since: string; messageKey: string }[];
        };
        expect(body.country).toBe(country);
        expect(body.audience).toBe(audience);
        expect(body.notices).toEqual(
          declared
            .filter((n) => n.audiences.includes(audience))
            .map((n) => ({
              id: n.id,
              version: n.version,
              since: n.since,
              messageKey: noticeMessageKey(n.id, n.version, audience),
            })),
        );
        expect(body.notices.length).toBeGreaterThan(0);
      }
    },
  );

  it('critère 5 : la réponse n’expose aucun interrupteur de mise en service ni sa valeur', async () => {
    expect(SWITCH_KEYS.length).toBe(4);
    for (const country of COUNTRIES) {
      for (const audience of NOTICE_AUDIENCES) {
        const r = await api.request(
          'GET',
          `/regulatory-notices?country=${country}&audience=${audience}`,
        );
        const text = JSON.stringify(r.json);
        for (const key of SWITCH_KEYS) expect(text, `${country} ${audience}`).not.toContain(key);
        expect(text).not.toMatch(/enabled|go_?live|switch|insurer_contract/i);
      }
    }
  });

  it('400 REQUEST_INVALID : pays absent, mal formé ou non configuré ; public absent ou inconnu', async () => {
    const first = COUNTRIES[0] as string;
    for (const query of [
      '',
      '?audience=HOST',
      `?country=${first}`,
      `?country=${first}&audience=host`,
      `?country=${first}&audience=STAFF`,
      '?country=ZZ&audience=GUEST',
      '?country=x1&audience=GUEST',
    ]) {
      const r = await api.request('GET', `/regulatory-notices${query}`);
      expect(r.status, query).toBe(400);
      expect(r.json).toMatchObject({ code: 'REQUEST_INVALID' });
    }
  });

  it('couverture : chaque statut déclaré pour /regulatory-notices est exercé', () => {
    const declared = Object.keys(
      contract.document.paths['/regulatory-notices']?.['get']?.responses ?? {},
    ).map((s) => `GET /regulatory-notices ${s}`);
    expect(declared.length).toBeGreaterThan(0);
    expect(declared.filter((d) => !api.covered.has(d))).toEqual([]);
  });
});

describe('textes des avertissements (catalogue @rueda/i18n, quatre langues)', () => {
  it('chaque avertissement déclaré a un titre et un corps non vides, par public, en es, en, fr et pt', () => {
    for (const entry of config.countries.values()) {
      for (const n of entry.regulatoryNotices) {
        for (const audience of n.audiences) {
          const prefix = noticeMessageKey(n.id, n.version, audience);
          for (const language of ['es', 'en', 'fr', 'pt'] as const) {
            const messages = CATALOGS[language].messages as Readonly<Record<string, unknown>>;
            for (const part of ['title', 'body']) {
              const m = messages[`${prefix}.${part}`];
              expect(
                typeof m === 'string' && m.trim().length > 0,
                `${language} ${prefix}.${part}`,
              ).toBe(true);
            }
          }
        }
      }
    }
  });

  it('aucune clé common.regulatory.* orpheline : chaque texte appartient à un avertissement déclaré', () => {
    const expected = new Set<string>([
      'common.regulatory.heading',
      'common.regulatory.version',
      'common.regulatory.unavailable',
    ]);
    for (const entry of config.countries.values()) {
      for (const n of entry.regulatoryNotices) {
        for (const audience of n.audiences) {
          const prefix = noticeMessageKey(n.id, n.version, audience);
          expected.add(`${prefix}.title`);
          expected.add(`${prefix}.body`);
        }
      }
    }
    const present = Object.keys(CATALOGS.es.messages).filter((k) =>
      k.startsWith('common.regulatory.'),
    );
    expect(present.sort()).toEqual([...expected].sort());
  });
});
