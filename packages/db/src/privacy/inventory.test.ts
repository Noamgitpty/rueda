/**
 * US-046 — inventaire des données personnelles (17 §3.1.3, §3.1.4), sans base : complétude contre
 * `docs/architecture/schema.md` (généré depuis le catalogue de production et comparé par la CI,
 * ADR-079), règles de classement et cohérence avec la matrice d'autorisations d'US-043. La même
 * complétude est prouvée contre le catalogue réel par test/l0/l0-us046-personal-data.test.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PACKAGE_ROOT } from '../paths.ts';
import {
  checkInventoryCoverage,
  checkInventoryRules,
  checkMatrixCoherence,
  classOf,
  loadAuthorizationMatrix,
  loadPersonalDataInventory,
  parseSchemaDocColumns,
} from './inventory.ts';
import type { AuthorizationMatrix, PersonalDataInventory } from './inventory.ts';

const inventory = loadPersonalDataInventory();
const matrix = loadAuthorizationMatrix();
const schemaDoc = readFileSync(join(PACKAGE_ROOT, '../../docs/architecture/schema.md'), 'utf8');

const clone = (i: PersonalDataInventory): PersonalDataInventory =>
  JSON.parse(JSON.stringify(i)) as PersonalDataInventory;
type Mutable = {
  tables: Record<string, { columns: Record<string, unknown> } & Record<string, unknown>>;
};

describe('US-046 — inventaire des données personnelles', () => {
  it('chaque colonne de chaque table de production est classée, sans entrée orpheline', () => {
    const actual = parseSchemaDocColumns(schemaDoc);
    expect(actual.size).toBeGreaterThan(50);
    expect(checkInventoryCoverage(inventory, actual)).toEqual([]);
  });

  it('une colonne nouvelle non classée, une table nouvelle ou une entrée sans colonne échouent', () => {
    const actual = new Map(parseSchemaDocColumns(schemaDoc));
    actual.set('core.iam_user_account', [
      ...(actual.get('core.iam_user_account') ?? []),
      'nickname',
    ]);
    actual.set('core.kyc_document', ['id', 'number_enc']);
    actual.delete('core.risk_rate_counter');
    expect(checkInventoryCoverage(inventory, actual)).toEqual([
      'core.iam_user_account.nickname : colonne non classée',
      "core.kyc_document : table absente de l'inventaire (classer chacune de ses colonnes)",
      'core.risk_rate_counter : entrée sans table',
    ]);
  });

  it('les règles de classement sont tenues (effacement de chaque C2 / C3, secrets jamais en clair)', () => {
    expect(checkInventoryRules(inventory)).toEqual([]);
  });

  it('les règles refusent : C2 sans effacement, pseudonymisation d’un registre A, C4 en clair, nom personnel en C1', () => {
    const bad = clone(inventory) as unknown as Mutable;
    const user = bad.tables['core.iam_user_account'];
    const audit = bad.tables['core.audit_audit_log'];
    if (!user || !audit) throw new Error('tables attendues');
    user.columns['email'] = { class: 'C2' };
    user.columns['phone_e164'] = 'C1';
    user.columns['password_hash'] = { class: 'C4' };
    user.columns['recovery_code'] = { class: 'C4' };
    audit.columns['ip_enc'] = { class: 'C2', erasure: 'pseudonymisation' };
    audit.columns['reason'] = { class: 'C2', erasure: 'derogation', justification: 'court' };
    expect(checkInventoryRules(bad as unknown as PersonalDataInventory)).toEqual([
      'core.audit_audit_log.reason : dérogation sans justification (≥ 40 caractères)',
      'core.audit_audit_log.reason : dérogation sans story de report (US-xxx)',
      'core.audit_audit_log.ip_enc : pseudonymisation impossible dans un registre immuable (A)',
      "core.iam_user_account.email : C2 sans méthode d'effacement",
      'core.iam_user_account.phone_e164 : nom de donnée personnelle classé C1 dans une table de sujet',
      'core.iam_user_account.recovery_code : C4 ni haché, ni enveloppé, ni référence (nom *_hash, *_ref, *dek)',
    ]);
  });

  it('la matrice d’US-043 est cohérente : aucune C3 / C4 lue par app_api, export self = lecture personnelle', () => {
    expect(checkMatrixCoherence(inventory, matrix)).toEqual([]);
  });

  it('la cohérence échoue sur une C2 ouverte à app_anon, une C3 ou une C4 lue par app_api, un export manquant', () => {
    const bad = JSON.parse(JSON.stringify(matrix)) as {
      relations: Record<
        string,
        { droits: Record<string, Record<string, unknown>>; lecture?: Record<string, string> }
      >;
    };
    const user = bad.relations['core.iam_user_account'];
    const fact = bad.relations['core.iam_auth_factor'];
    const org = bad.relations['core.iam_organization'];
    if (!user || !fact || !org) throw new Error('relations attendues');
    user.droits['app_anon'] = { SELECT: ['email'] };
    user.droits['app_api'] = { SELECT: ['id', 'email', 'password_hash'] };
    fact.lecture = { ...(fact.lecture ?? {}), voyageur: 'user_id = :acteur' };
    org.lecture = { ...(org.lecture ?? {}), voyageur: 'tout' };
    const inv = clone(inventory) as unknown as Mutable;
    const orgInv = inv.tables['core.iam_organization'];
    if (!orgInv) throw new Error('organisation attendue');
    orgInv.columns['tax_id'] = { class: 'C3', erasure: 'pseudonymisation' };
    expect(
      checkMatrixCoherence(
        inv as unknown as PersonalDataInventory,
        bad as unknown as AuthorizationMatrix,
      ),
    ).toEqual([
      'core.iam_auth_factor : lisible par la personne (matrice) mais export controller',
      'core.iam_organization.tax_id : C3 lisible par app_api',
      "core.iam_organization : données C2 lisibles « tout » par l'acteur voyageur",
      'core.iam_user_account.email : C2 lisible par app_anon',
      'core.iam_user_account.password_hash : C4 lisible par app_api sans justification (apiRead)',
    ]);
  });

  it('revue sécurité : un motif libre C2 relu par app_api en « tout » échoue (0052 l’a retiré)', () => {
    const bad = JSON.parse(JSON.stringify(matrix)) as {
      relations: Record<string, { droits: Record<string, Record<string, string[] | string>> }>;
    };
    const param = bad.relations['core.config_param_value'];
    if (!param) throw new Error('relation attendue');
    param.droits['app_api'] = { SELECT: ['id', 'key', 'change_reason'] };
    expect(
      checkMatrixCoherence(inventory, bad as unknown as AuthorizationMatrix).filter((e) =>
        e.startsWith('core.config_param_value'),
      ),
    ).toEqual(
      ['sans_contexte', 'voyageur', 'hote', 'cohote', 'hote_org_forgee'].map(
        (a) => `core.config_param_value : données C2 lisibles « tout » par l'acteur ${a}`,
      ),
    );
    // motifs du trip : C2, lus du seul voyageur et du seul hôte du trip (prédicats personnels)
    const trip = matrix.relations['core.booking_trip'];
    expect(trip?.lecture?.['voyageur']).toBe('guest_user_id = :acteur');
    expect(trip?.lecture?.['sans_contexte']).toBe('aucune');
    for (const col of ['cancellation_reason', 'termination_reason']) {
      expect(classOf(inventory.tables['core.booking_trip']?.columns[col] ?? 'C1')).toBe('C2');
    }
  });

  it('C2 / C3 inventoriées : identité, contact, IP, motifs, et C4 jamais exportables', () => {
    const personal = Object.entries(inventory.tables).flatMap(([t, e]) =>
      Object.entries(e.columns)
        .filter(([, c]) => ['C2', 'C3'].includes(classOf(c)))
        .map(([c]) => `${t}.${c}`),
    );
    // attentes de 17 §3.2 et des annotations [C2] des migrations, pas de l'inventaire lui-même
    for (const expected of [
      'core.iam_user_account.email',
      'core.iam_user_account.legal_first_name',
      'core.iam_user_account.date_of_birth',
      'core.iam_session.ip',
      'core.iam_session.user_agent',
      'core.audit_audit_log.ip_enc',
      'core.iam_organization.tax_id',
      'core.payment_webhook_inbox.raw_body_enc',
    ]) {
      expect(personal).toContain(expected);
    }
  });
});
