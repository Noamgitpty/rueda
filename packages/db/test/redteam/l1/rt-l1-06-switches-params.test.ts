/**
 * US-122 — red team du lot 1, axe interrupteurs de mise en service à deux personnes (US-125),
 * paramètres par pays (US-110) et activation fail-closed (RT-L1-A08, A09, A12, A18). Rôles de
 * production seulement (assertion L0-05 par withRole), USD (PA) et PYG (PY). Aucun interrupteur
 * ne passe à `true` hors d'une transaction ANNULÉE et par la procédure à deux personnes
 * d'US-125 (support/golive.ts). Rapport : docs/team/redteam/L1-rls-abus.md.
 *
 * Chaque test affirme que l'attaque est BLOQUÉE : un test rouge est une faille trouvée (jamais
 * `skip`). Exception ASSUMÉE et étiquetée « ACCEPTÉ PAR CONCEPTION » : une fermeture remplace une
 * demande d'ouverture en attente (jamais retardée, ADR-103) et la référence de décision n'est
 * contrôlée que dans sa forme. Attendus : CLAUDE.md point 7, 17 §0.1, §2.3 (RLS-27, « jamais les
 * deux »), 16 HST-016, 19 US-118, US-125 ; pré-mortem L1-PM-21, L1-PM-25, L1-PM-44.
 */
import { describe, expect, it } from 'vitest';
import { withRole } from '../../../src/testing/index.ts';
import {
  approveSwitch,
  asStaff,
  cancelSwitch,
  freshSession,
  goLive,
  requestSwitch,
} from '../../support/golive.ts';
import { createStaff, login } from '../../support/staff.ts';
import {
  byCountry,
  countryRules,
  declareAndSubmit,
  hostOf,
  listingOf,
  openSwitchInTx,
  ops,
  otherOf,
  rolledBack,
  switchActor,
  vehicleOf,
} from './support.ts';
import { act, hostState, outcomeOf, readyHost } from './support-host.ts';
import { installTestProofKey } from '../../support/staff.ts';

const KEYS = [
  'p2p_private_hosts_enabled',
  'insurer_contract_active',
  'funds_holding_enabled',
  'payouts_enabled',
] as const;

describe.each(byCountry)(
  'RT-L1-A08 — interrupteur ouvert par une seule personne (%s)',
  (country, _c, cc) => {
    it.each(KEYS)(
      '%s : même personne deux fois (même session, session neuve), identité forgée dans le contexte : jamais APPLIED, valeur inchangée',
      async (key) => {
        await rolledBack(async (tx) => {
          const a = await switchActor(tx, 'SUPERADMIN', [country]);
          const b = await switchActor(tx, 'SUPERADMIN', [country]);
          const r = await requestSwitch(tx, a, key, country, true);
          expect(r.outcome).toBe('REQUESTED');
          const id = r.request_id ?? '';
          // (a) même session
          expect((await approveSwitch(tx, a, id)).outcome).toBe('SELF_APPROVAL');
          // (b) session neuve de la même personne
          const again = await freshSession(tx, a);
          expect((await approveSwitch(tx, again, id)).outcome).toBe('SELF_APPROVAL');
          // (c) contexte forgé : la session de A, l'identité d'un autre SUPERADMIN dans le contexte
          expect((await approveSwitch(tx, a, id, b.userId)).outcome).not.toBe('APPLIED');
          expect(await goLive(tx, key, country), 'valeur après les tentatives').toBe(false);
          // témoin : la seconde personne (B, session élevée neuve) est servie
          const second = await freshSession(tx, b);
          expect((await approveSwitch(tx, second, id)).outcome).toBe('APPLIED');
          expect(await goLive(tx, key, country)).toBe(true);
        });
      },
    );

    it('demande avec une identité forgée dans le contexte : la demande est attribuée à la SESSION, jamais au contexte (la même personne ne s’approuve pas par ce détour)', async () => {
      await rolledBack(async (tx) => {
        const a = await switchActor(tx, 'SUPERADMIN', [country]);
        const b = await switchActor(tx, 'SUPERADMIN', [country]);
        const r = await requestSwitch(tx, a, 'p2p_private_hosts_enabled', country, true, {
          actorId: b.userId,
        });
        if (r.outcome === 'REQUESTED') {
          const approved = await approveSwitch(tx, await freshSession(tx, a), r.request_id ?? '');
          expect(approved.outcome).not.toBe('APPLIED');
        }
        expect(await goLive(tx, 'p2p_private_hosts_enabled', country)).toBe(false);
      });
    });

    it('écriture directe des interrupteurs sous chaque rôle applicatif (insertion, modification, suppression) : refusée, valeur inchangée', async () => {
      const statements = [
        `UPDATE core.config_param_value SET value = 'true'::jsonb WHERE key = 'payouts_enabled'`,
        `INSERT INTO core.config_param_value (key, scope_type, country_code, value, valid_from)
         VALUES ('payouts_enabled', 'COUNTRY', '${country}', 'true'::jsonb, platform.now())`,
        `DELETE FROM core.config_param_value WHERE key = 'p2p_private_hosts_enabled'`,
        `UPDATE core.config_param_definition SET go_live_switch = false WHERE key = 'funds_holding_enabled'`,
      ];
      for (const role of ['app_api', 'app_worker', 'app_anon'] as const) {
        // transaction manuelle annulée : app_anon n'a pas USAGE sur le schéma platform (horloge du banc)
        await withRole(role, async (client) => {
          await client.query('BEGIN');
          try {
            for (const sql of statements) {
              await client.query('SAVEPOINT w');
              await expect(client.query(sql), `${role} ${sql}`).rejects.toBeTruthy();
              await client.query('ROLLBACK TO SAVEPOINT w');
            }
          } finally {
            await client.query('ROLLBACK');
          }
        });
      }
      // contexte STAFF d'un SUPERADMIN élevé, sous app_api : toujours refusé
      await rolledBack(async (tx) => {
        const a = await switchActor(tx, 'SUPERADMIN', [country]);
        await asStaff(tx, a);
        for (const sql of statements) {
          await tx.query('SAVEPOINT w');
          await expect(tx.query(sql), sql).rejects.toBeTruthy();
          await tx.query('ROLLBACK TO SAVEPOINT w');
        }
        expect(await goLive(tx, 'payouts_enabled', country)).toBe(false);
      });
    });

    it('rôles et pays : OPS, SUPPORT, FINANCE, ADMIN d’un autre pays, session sans TOTP : refusés (FORBIDDEN, MFA_REQUIRED)', async () => {
      await rolledBack(async (tx) => {
        for (const role of ['OPS_AGENT', 'SUPPORT_AGENT', 'FINANCE'] as const) {
          const who = await switchActor(tx, role, [country]);
          expect(
            (await requestSwitch(tx, who, 'payouts_enabled', country, true)).outcome,
            role,
          ).toBe('FORBIDDEN');
        }
        const foreign = await switchActor(tx, 'ADMIN', [otherOf(cc).country]);
        expect((await requestSwitch(tx, foreign, 'payouts_enabled', country, true)).outcome).toBe(
          'FORBIDDEN',
        );
        await installTestProofKey(tx);
        const low = await createStaff(tx, 'SUPERADMIN', [country]);
        const noMfa = { userId: low.userId, hash: await login(tx, low.userId), scope: [country] };
        expect((await requestSwitch(tx, noMfa, 'payouts_enabled', country, true)).outcome).toBe(
          'MFA_REQUIRED',
        );
        expect(await goLive(tx, 'payouts_enabled', country)).toBe(false);
      });
    });

    it('annulation et remplacement abusifs : un ADMIN non demandeur ne peut pas annuler la demande d’un autre ; un SUPERADMIN d’un autre pays non plus ; la demande reste approuvable', async () => {
      await rolledBack(async (tx) => {
        const requester = await switchActor(tx, 'ADMIN', [country]);
        const meddler = await switchActor(tx, 'ADMIN', [country]);
        const foreignSuper = await switchActor(tx, 'SUPERADMIN', [otherOf(cc).country]);
        const r = await requestSwitch(tx, requester, 'insurer_contract_active', country, true);
        expect(r.outcome).toBe('REQUESTED');
        const id = r.request_id ?? '';
        expect((await cancelSwitch(tx, meddler, id)).outcome).toBe('FORBIDDEN');
        expect((await cancelSwitch(tx, foreignSuper, id)).outcome).toBe('FORBIDDEN');
        // une seconde ouverture ne remplace pas la première
        const dup = await requestSwitch(tx, meddler, 'insurer_contract_active', country, true);
        expect(dup.outcome).toBe('ALREADY_PENDING');
        // la demande d'origine reste en attente : une seconde personne habilitée l'approuve
        const approver = await freshSession(tx, await switchActor(tx, 'SUPERADMIN', [country]));
        expect((await approveSwitch(tx, approver, id)).outcome).toBe('APPLIED');
      });
    });

    it('ACCEPTÉ PAR CONCEPTION (ADR-103, jamais retardée) : une demande de FERMETURE par n’importe quel ADMIN remplace une ouverture en attente ; la référence de décision n’est contrôlée que dans sa forme (mesure)', async () => {
      await rolledBack(async (tx) => {
        const requester = await switchActor(tx, 'ADMIN', [country]);
        const closer = await switchActor(tx, 'ADMIN', [country]);
        const open = await requestSwitch(tx, requester, 'funds_holding_enabled', country, true, {
          decision: 'DEC-FONDATEUR-9999', // jamais décidée : seule la forme est contrôlée
        });
        expect(open.outcome).toBe('REQUESTED');
        const close = await requestSwitch(tx, closer, 'funds_holding_enabled', country, false);
        expect(close.outcome).toBe('SUPERSEDED');
        const approver = await freshSession(tx, await switchActor(tx, 'SUPERADMIN', [country]));
        expect((await approveSwitch(tx, approver, open.request_id ?? '')).outcome).toBe(
          'NOT_PENDING',
        );
        expect(await goLive(tx, 'funds_holding_enabled', country)).toBe(false);
      });
    });
  },
);

describe.each(byCountry)(
  'RT-L1-A18 — aucune annonce ni hôte actif tant que les interrupteurs sont fermés (%s)',
  (country, _c, cc) => {
    it('p2p_private_hosts_enabled et insurer_contract_active : fermés, un seul ouvert ou les deux ouverts — seule l’ouverture des deux publie', async () => {
      const attempt = async (
        open: readonly ('p2p_private_hosts_enabled' | 'insurer_contract_active')[],
      ) =>
        rolledBack(async (tx) => {
          await countryRules(tx, country, false);
          for (const key of open) await openSwitchInTx(tx, key, country);
          const h = await hostOf(tx, country);
          const v = await vehicleOf(tx, h, cc);
          expect((await declareAndSubmit(tx, h, v.id ?? '')).submitted).toBe('ELIGIBLE');
          const listing = await listingOf(tx, h, cc, v.id ?? '', 6);
          return outcomeOf(tx, 'SELECT * FROM core.catalog_cmd_submit_listing($1,$2,$3)', [
            h.hash,
            h.org,
            listing,
          ]);
        });
      expect(await attempt([]), 'aucun interrupteur').not.toBe('LISTED');
      expect(await attempt(['p2p_private_hosts_enabled']), 'contrat d’assureur fermé').not.toBe(
        'LISTED',
      );
      expect(await attempt(['insurer_contract_active']), 'hôtes particuliers fermés').not.toBe(
        'LISTED',
      );
      expect(await attempt(['p2p_private_hosts_enabled', 'insurer_contract_active'])).toBe(
        'LISTED',
      );
    });

    it('activation du compte d’hôte : l’approbation par un tiers de l’ops sans contrat d’assureur actif n’active pas le compte (CLAUDE.md point 7)', async () => {
      await rolledBack(async (tx) => {
        await installTestProofKey(tx);
        const h = await readyHost(tx, country, 'CLEAR');
        const agent = await ops(tx, 'OPS_AGENT', [country]);
        const r = await act(tx, agent, 'HOST_VERIFICATION_DECISION', h.org, {
          input: { decision: 'APPROVED' },
        });
        const state = await hostState(tx, h);
        expect(state['org_status'], `décision ${r.outcome}`).not.toBe('ACTIVE');
        expect(await goLive(tx, 'insurer_contract_active', country)).toBe(false);
      });
    });
  },
);
