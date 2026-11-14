/**
 * US-122 — red team du lot 1, axe véhicules, annonces et argent du catalogue (RT-L1-A01, A02,
 * A13, A14, A12 ; N-61 ; US-110, US-115, US-118, US-124). Rôles de production seulement
 * (assertion L0-05 par withRole), USD (PA) et PYG (PY). Rapport : docs/team/redteam/L1-rls-abus.md.
 *
 * Chaque test affirme que l'attaque est BLOQUÉE : un test rouge est une faille trouvée (jamais
 * `skip`). Exception ASSUMÉE et étiquetée « ACCEPTÉ PAR CONCEPTION » : le mode déclaratif de
 * DEC-FONDATEUR-22 (« jamais plus lourd que Turo » : aucune pièce par défaut, déclaration de
 * l'hôte), éprouvé en CARACTÉRISATION pour mesurer le risque, sans le classer comme faille.
 * Attendus : 08 BR-LIST-01 à BR-LIST-03, BR-PRICE-14 ; 16 HST-019, HST-033, PRC-001 (plafonds
 * PROPOSÉS : valeurs des données CFG), VER-028 ; 19 US-110, US-115, US-118, US-124 ; BOARD N-61,
 * N-62 ; pré-mortem L1-PM-14, L1-PM-19, L1-PM-29.
 */
import { randomBytes, randomInt } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { setSessionContext } from '../../../src/index.ts';
import {
  byCountry,
  countryRules,
  createLocation,
  declareAndSubmit,
  hostOf,
  listingOf,
  localYear,
  openSwitchInTx,
  paramValues,
  plate,
  rolledBack,
  uuid,
  vehicleOf,
  vin,
} from './support.ts';
import { first, outcomeOf } from './support-host.ts';

describe.each(byCountry)(
  'RT-L1-A01 — mode déclaratif (DEC-FONDATEUR-22) : mesure du risque (%s)',
  (country, _c, cc) => {
    it('ACCEPTÉ PAR CONCEPTION : titre déclaré d’un tiers sans autorisation, véhicule gagé avec accord déclaré, aucune pièce ⇒ ELIGIBLE sans revue (risque mesuré : seule la déclaration de l’hôte engage)', async () => {
      await rolledBack(async (tx) => {
        await countryRules(tx, country, false);
        const h = await hostOf(tx, country);
        const thirdParty = await vehicleOf(tx, h, cc);
        const pledged = await vehicleOf(tx, h, cc);
        const t1 = await declareAndSubmit(tx, h, thirdParty.id ?? '', { holder: 'THIRD_PARTY' });
        const t2 = await declareAndSubmit(tx, h, pledged.id ?? '', { lien: true, lienOk: true });
        // le défaut du fondateur : déclaration + contrôles automatiques
        expect([t1.submitted, t2.submitted]).toEqual(['ELIGIBLE', 'ELIGIBLE']);
      });
    });

    it('les contrôles qui existent tiennent : propriété non attestée, gage sans accord, véhicule trop ancien, compteur au plafond ⇒ jamais ELIGIBLE', async () => {
      await rolledBack(async (tx) => {
        await countryRules(tx, country, false);
        const h = await hostOf(tx, country);
        const ceilingKm = 200_000; // 08 BR-LIST-02 [NOUS] : < 200 000 km
        const maxAge = 10; // 08 BR-LIST-02 [NOUS] : ≤ 10 ans
        const cases: [string, { year?: number }, Parameters<typeof declareAndSubmit>[3]][] = [
          ['propriété non attestée', {}, { owner: false }],
          ['gage sans accord du créancier', {}, { lien: true, lienOk: false }],
          ['compteur au plafond', {}, { km: ceilingKm }],
          ['véhicule de 11 ans', { year: localYear(cc) - (maxAge + 1) }, {}],
        ];
        for (const [name, spec, decl] of cases) {
          const v = await vehicleOf(tx, h, cc, spec);
          const r = await declareAndSubmit(tx, h, v.id ?? '', decl);
          expect(r.submitted, name).not.toBe('ELIGIBLE');
        }
        // témoin : le même hôte, un véhicule conforme ⇒ ELIGIBLE
        const ok = await vehicleOf(tx, h, cc);
        expect((await declareAndSubmit(tx, h, ok.id ?? '')).submitted).toBe('ELIGIBLE');
      });
    });
  },
);

const ZW = String.fromCharCode(0x200b);
const fullwidth = (s: string): string =>
  [...s].map((ch) => String.fromCodePoint(ch.codePointAt(0)! + 0xfee0)).join('');
const CYR: Record<string, string> = {
  A: 'А',
  B: 'В',
  C: 'С',
  E: 'Е',
  H: 'Н',
  K: 'К',
  M: 'М',
  O: 'О',
  P: 'Р',
  T: 'Т',
  X: 'Х',
};

describe.each(byCountry)(
  'RT-L1-A01 — plaque et VIN d’autrui : doublon et normalisation (%s)',
  (country, _c, cc) => {
    it('un second hôte du même pays ne peut pas enregistrer la plaque d’un autre, sous aucune écriture voisine (casse, espaces, tirets, points, invisibles, pleine chasse, lettres cyrilliques)', async () => {
      await rolledBack(async (tx) => {
        const a = await hostOf(tx, country);
        const b = await hostOf(tx, country);
        const base = `RBC${randomInt(10_000, 99_999)}`;
        expect((await vehicleOf(tx, a, cc, { plate: base })).outcome).toBe('DONE');
        const variants: [string, string][] = [
          ['identique', base],
          ['minuscules', base.toLowerCase()],
          ['espaces autour', ` ${base} `],
          ['espace au milieu', `${base.slice(0, 3)} ${base.slice(3)}`],
          ['tiret', `${base.slice(0, 3)}-${base.slice(3)}`],
          ['point', `${base.slice(0, 3)}.${base.slice(3)}`],
          ['espace de largeur nulle', `${base.slice(0, 3)}${ZW}${base.slice(3)}`],
          ['pleine chasse', fullwidth(base)],
          ['lettres cyrilliques', [...base].map((ch) => CYR[ch] ?? ch).join('')],
        ];
        for (const [name, plateText] of variants) {
          const r = await vehicleOf(tx, b, cc, { plate: plateText });
          expect(r.outcome, `plaque ${name}`).not.toBe('DONE');
        }
      });
    });

    it('VIN d’autrui : mêmes écritures voisines refusées ; VIN avec I, O ou Q refusé', async () => {
      await rolledBack(async (tx) => {
        const a = await hostOf(tx, country);
        const b = await hostOf(tx, country);
        const base = vin();
        expect((await vehicleOf(tx, a, cc, { vin: base })).outcome).toBe('DONE');
        const variants: [string, string][] = [
          ['minuscules', base.toLowerCase()],
          ['espaces', `${base.slice(0, 9)} ${base.slice(9)}`],
          ['tirets', `${base.slice(0, 9)}-${base.slice(9)}`],
          ['invisible', `${base.slice(0, 9)}${ZW}${base.slice(9)}`],
          ['pleine chasse', fullwidth(base)],
          ['lettre interdite O', `${base.slice(0, 16)}O`],
          ['lettre interdite I', `${base.slice(0, 16)}I`],
        ];
        for (const [name, vinText] of variants) {
          const r = await vehicleOf(tx, b, cc, { vin: vinText });
          expect(r.outcome, `VIN ${name}`).not.toBe('DONE');
        }
      });
    });
  },
);

describe.each(byCountry)('RT-L1-A01 — contestation N-61 abusive (%s)', (country, _c, cc) => {
  const claim = (
    tx: Parameters<typeof first>[0],
    h: { hash: Buffer; org: string },
    plateText: string,
  ) =>
    first<{ outcome: string }>(
      tx,
      'SELECT * FROM core.catalog_cmd_open_vehicle_claim($1, $2, $3, NULL, $4, $5, $6, $7)',
      [h.hash, h.org, plateText, uuid(), 'application/pdf', 54_321, randomBytes(32)],
    );

  it('une contestation ne bouge rien chez la victime et ne lui apprend rien ; la contestation du demandeur ne montre que son propre dossier', async () => {
    await rolledBack(async (tx) => {
      const victim = await hostOf(tx, country);
      const attacker = await hostOf(tx, country);
      // clé de la personne, créée par le coffre de l'application avant le dépôt d'une pièce
      await tx.query('SELECT test_fixture.us109_subject_key($1)', [attacker.userId]);
      const plateText = plate();
      const v = await vehicleOf(tx, victim, cc, { plate: plateText });
      await declareAndSubmit(tx, victim, v.id ?? '');
      const watch = async () =>
        JSON.stringify([
          (
            await tx.query('SELECT * FROM core.catalog_host_vehicles($1, $2)', [
              victim.hash,
              victim.org,
            ])
          ).rows,
          (
            await tx.query('SELECT * FROM core.catalog_host_vehicle_eligibility($1, $2)', [
              victim.hash,
              victim.org,
            ])
          ).rows,
          (
            await tx.query('SELECT * FROM core.catalog_host_vehicle_claims($1, $2)', [
              victim.hash,
              victim.org,
            ])
          ).rows,
        ]);
      const before = await watch();
      expect((await claim(tx, attacker, plateText)).outcome).toBe('DONE');
      expect(await watch(), 'état de la victime après la contestation').toBe(before);
      const mine = await tx.query<{ plate: string }>(
        'SELECT * FROM core.catalog_host_vehicle_claims($1, $2)',
        [attacker.hash, attacker.org],
      );
      expect(mine.rows).toHaveLength(1);
      expect(Object.keys(mine.rows[0] ?? {}).sort()).toEqual(
        ['claim_id', 'created_at', 'decided_at', 'dismiss_reason', 'plate', 'status'].sort(),
      );
    });
  });

  it('PROPOSÉ : un même compte ne peut pas ouvrir une rafale de contestations contre des plaques d’autrui (au plus 10 acceptées en une minute) — frein d’abus de la file de l’ops', async () => {
    await rolledBack(async (tx) => {
      const victim = await hostOf(tx, country);
      const attacker = await hostOf(tx, country);
      await tx.query('SELECT test_fixture.us109_subject_key($1)', [attacker.userId]);
      const plates: string[] = [];
      for (let i = 0; i < 14; i += 1) {
        const p = plate();
        plates.push(p);
        expect((await vehicleOf(tx, victim, cc, { plate: p })).outcome).toBe('DONE');
      }
      let accepted = 0;
      for (const p of plates) {
        if (
          (await outcomeOf(
            tx,
            'SELECT * FROM core.catalog_cmd_open_vehicle_claim($1,$2,$3,NULL,$4,$5,$6,$7)',
            [attacker.hash, attacker.org, p, uuid(), 'application/pdf', 54_321, randomBytes(32)],
          )) === 'DONE'
        ) {
          accepted += 1;
        }
      }
      expect(
        accepted,
        'la première contestation est acceptée (le test n’est pas vide)',
      ).toBeGreaterThan(0);
      expect(accepted).toBeLessThanOrEqual(10);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Filtres d'adresse et de contact (US-118, N-62) : par la commande de création du lieu
// ---------------------------------------------------------------------------------------------
const IN_SCOPE = [
  ['numéro de téléphone', '0981 123 456'],
  ['numéro international', '+595 981 123456'],
  ['chiffres pleine chasse', '６０１２３４５６７'],
  ['chiffres séparés par des invisibles', `6${ZW}0${ZW}1${ZW}2${ZW}3${ZW}4${ZW}5${ZW}6`],
  ['messagerie nommée', 'escríbeme al WhatsApp'],
  ['lien wa.me', 'wa.me/50761234567'],
  ['identifiant @', 'Juan @juanperez'],
  ['courriel', 'juan@mail.com'],
  ['nom de domaine', 'mi sitio ejemplo.com'],
  ['voie suivie d’un numéro', 'Calle 50 #12-34'],
  ['logement numéroté', 'Casa 12B'],
  ['angle de rues', 'esq. Via España'],
  ['lien t.me', 't.me/juan'],
] as const;

// contournements simples, hors des séparateurs et des mots nommés par l'ADR-114 (le filtre
// « réduit le risque sans prétendre à l'exhaustivité ») : mesurés, pas exigés par la décision ;
// gravité PROPOSÉE faible (contournement de plateforme, P-08)
const BEYOND_SCOPE = [
  ['chiffres séparés par des barres', '6-0-1-2/3-4-5-6'],
  ['chiffres en toutes lettres', 'cero nueve ocho uno uno dos tres cuatro cinco seis'],
  ['arroba et punto en toutes lettres', 'juan arroba gmail punto com'],
  ['lettres espacées', 'w h a t s a p p'],
  ['messagerie non nommée', 'escríbeme por insta'],
] as const;

describe.each(byCountry)('RT-L1-A14 — filtre d’adresse exacte et de contact (%s)', (country) => {
  it.each(IN_SCOPE)(
    'dans le périmètre de l’ADR-114 — %s : la zone est refusée (jamais DONE)',
    async (_name, text) => {
      await rolledBack(async (tx) => {
        const h = await hostOf(tx, country);
        const r = await createLocation(tx, h, text);
        expect(r.outcome).not.toBe('DONE');
      });
    },
  );

  it.each(BEYOND_SCOPE)(
    'contournement simple — %s : la zone est refusée (jamais DONE)',
    async (_name, text) => {
      await rolledBack(async (tx) => {
        const h = await hostOf(tx, country);
        const r = await createLocation(tx, h, text);
        expect(r.outcome).not.toBe('DONE');
      });
    },
  );

  it('la ville porte le même filtre ; témoin : une zone honnête est acceptée', async () => {
    await rolledBack(async (tx) => {
      const h = await hostOf(tx, country);
      expect(
        (await createLocation(tx, h, 'Barrio Norte', 'Llama al 0981 123 456')).outcome,
      ).not.toBe('DONE');
      expect((await createLocation(tx, h, 'Costa del Este', 'Ciudad Uno')).outcome).toBe('DONE');
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Adresse exacte avant confirmation (RT-L1-A13)
// ---------------------------------------------------------------------------------------------
describe.each(byCountry)(
  'RT-L1-A13 — adresse exacte avant confirmation (%s)',
  (country, _c, cc) => {
    it('annonce LISTED vue d’un visiteur : ni adresse, ni plaque, ni VIN, ni identité ; point approximatif seulement', async () => {
      await rolledBack(async (tx) => {
        await countryRules(tx, country, false);
        await openSwitchInTx(tx, 'p2p_private_hosts_enabled', country);
        await openSwitchInTx(tx, 'insurer_contract_active', country);
        const h = await hostOf(tx, country);
        // lieu à point exact : 8,98749 ; -79,51849 (arrondis à 3 décimales : écart d'au moins 0,0004)
        const loc = await first<{ outcome: string; location_id: string | null }>(
          tx,
          `SELECT * FROM core.catalog_cmd_create_location($1, $2, 'HOME', 'Casa', 'Calle Ficticia 123',
                                                         'Ciudad Uno', 'Barrio Norte', 8.98749, -79.51849)`,
          [h.hash, h.org],
        );
        expect(loc.outcome).toBe('DONE');
        const secret = plate();
        const v = await vehicleOf(tx, { ...h, location: loc.location_id ?? '' }, cc, {
          plate: secret,
        });
        expect((await declareAndSubmit(tx, h, v.id ?? '')).submitted).toBe('ELIGIBLE');
        const listing = await listingOf(tx, h, cc, v.id ?? '', 6);
        const sub = await first<{ outcome: string }>(
          tx,
          'SELECT * FROM core.catalog_cmd_submit_listing($1, $2, $3)',
          [h.hash, h.org, listing],
        );
        expect(sub.outcome).toBe('LISTED');
        const pub = await first<Record<string, unknown>>(
          tx,
          'SELECT * FROM core.catalog_public_listing($1)',
          [listing],
        );
        expect(pub).toBeDefined();
        const text = JSON.stringify(pub);
        for (const leak of ['Calle Ficticia', secret, h.userId, h.org, 'Ana', 'Pérez']) {
          expect(text, `fuite : ${leak}`).not.toContain(leak);
        }
        expect(
          Object.keys(pub).filter((k) => /address|plate|^vin|holder|tax|org|user/i.test(k)),
        ).toEqual([]);
        expect(Math.abs(Number(pub['geo_public_lat']) - 8.98749)).toBeGreaterThan(0.0002);
        expect(Math.abs(Number(pub['geo_public_lng']) - -79.51849)).toBeGreaterThan(0.0002);
      });
    });
  },
);

// ---------------------------------------------------------------------------------------------
// Plafonds de prix et distance (US-110, US-115) — argent du catalogue
// ---------------------------------------------------------------------------------------------
describe.each(byCountry)(
  'RT-L1-A12 — prix et distance : plafonds du pays, pas, débordements (%s)',
  (country, _c, cc) => {
    const ceiling = BigInt(String(paramValues('price_ceiling_daily_minor')[country]));
    const kmCeiling = BigInt(String(paramValues('price_ceiling_extra_km_minor')[country]));
    const step = BigInt(cc.priceStepMinor);

    it('création : prix hors plafond, nul, négatif, hors pas, débordement du bigint, distance incohérente ⇒ jamais DONE ; témoin : le plafond lui-même passe', async () => {
      await rolledBack(async (tx) => {
        const h = await hostOf(tx, country);
        const v = await vehicleOf(tx, h, cc);
        const attempts: [string, bigint, string, number | null, bigint | null][] = [
          ['plafond + un pas', ceiling + step, 'UNLIMITED', null, null],
          ['plafond × 100', ceiling * 100n, 'UNLIMITED', null, null],
          ['zéro', 0n, 'UNLIMITED', null, null],
          ['négatif', -step, 'UNLIMITED', null, null],
          ['bigint maximal', 9_223_372_036_854_775_807n, 'UNLIMITED', null, null],
          ['distance : km illimité avec distance', step * 40n, 'UNLIMITED', 100, null],
          ['distance : mode inclus sans km', step * 40n, 'INCLUDED', null, 5n],
          ['distance : 10 001 km par jour', step * 40n, 'INCLUDED', 10_001, 5n],
          [
            'distance : prix du km au-dessus du plafond',
            step * 40n,
            'INCLUDED',
            100,
            kmCeiling + 1n,
          ],
          ['distance : prix du km négatif', step * 40n, 'INCLUDED', 100, -1n],
          ['mode inconnu', step * 40n, 'FLAT_RATE', null, null],
        ];
        if (cc.priceStepMinor > 1) {
          attempts.push(['hors pas du pays', step * 40n + 1n, 'UNLIMITED', null, null]);
        }
        for (const [name, price, mode, km, extra] of attempts) {
          const r = await outcomeOf(
            tx,
            'SELECT * FROM core.catalog_cmd_create_listing($1,$2,$3,$4,$5,$6,$7,NULL)',
            [
              h.hash,
              h.org,
              v.id,
              price.toString(),
              mode,
              km,
              extra === null ? null : extra.toString(),
            ],
          );
          expect(r, name).not.toBe('DONE');
          expect(r.startsWith('ERR:'), `${name} : refus par erreur SQL (${r})`).toBe(false);
        }
        const ok = await outcomeOf(
          tx,
          `SELECT * FROM core.catalog_cmd_create_listing($1,$2,$3,$4,'UNLIMITED',NULL,NULL,NULL)`,
          [h.hash, h.org, v.id, ceiling.toString()],
        );
        expect(ok).toBe('DONE');
      });
    });

    it('modification du tarif : mêmes bornes (le plafond ne se contourne pas par une mise à jour)', async () => {
      await rolledBack(async (tx) => {
        const h = await hostOf(tx, country);
        const v = await vehicleOf(tx, h, cc);
        const listing = await listingOf(tx, h, cc, v.id ?? '');
        for (const [name, price] of [
          ['plafond + un pas', ceiling + step],
          ['bigint maximal', 9_223_372_036_854_775_807n],
          ['négatif', -step],
        ] as const) {
          const r = await outcomeOf(
            tx,
            `SELECT * FROM core.catalog_cmd_update_listing_pricing($1,$2,$3,$4,'UNLIMITED',NULL,NULL)`,
            [h.hash, h.org, listing, price.toString()],
          );
          expect(r, name).not.toBe('DONE');
        }
        const priceNow = async () =>
          (
            await tx.query<{ daily_price_minor: string }>(
              'SELECT * FROM core.catalog_host_listings($1,$2)',
              [h.hash, h.org],
            )
          ).rows[0]?.daily_price_minor;
        expect(String(await priceNow())).toBe(String(40 * cc.priceStepMinor));
      });
    });

    it('contexte forgé : une écriture directe du paramètre de plafond ou du pas sous un rôle applicatif est refusée (42501)', async () => {
      await rolledBack(async (tx) => {
        const h = await hostOf(tx, country);
        await setSessionContext(tx, { kind: 'HOST', actorId: h.userId, orgId: h.org });
        for (const sql of [
          `UPDATE core.config_param_value SET value = '"9999999999999"'::jsonb WHERE key = 'price_ceiling_daily_minor'`,
          `INSERT INTO core.config_param_value (key, scope_type, country_code, value, valid_from)
           VALUES ('price_ceiling_daily_minor', 'COUNTRY', '${country}', '"9999999999999"'::jsonb, platform.now())`,
          `DELETE FROM core.config_param_value WHERE key = 'price_display_step_minor'`,
        ]) {
          await tx.query('SAVEPOINT p');
          await expect(tx.query(sql), sql).rejects.toMatchObject({ code: '42501' });
          await tx.query('ROLLBACK TO SAVEPOINT p');
        }
      });
    });
  },
);
