/**
 * Supervision et canal d'alerte (US-004, ADR-080). Attendus écrits à la main d'après 17 §6.3
 * (outbox > 2 min, UNKNOWN > 30 min, webhooks en échec, alertes P1) et 16 ADM-032 (« Given un
 * webhook PSP en échec 3 fois, When il échoue, Then une alerte part »), jamais lus du code testé.
 */
import { describe, expect, it } from 'vitest';
import { FakeAlertChannel } from '../testing/index.js';
import {
  alertLogLine,
  assertSafeAlert,
  ChannelAlerter,
  LogAlertChannel,
  UnsafeAlertError,
} from './alert-channel.js';
import type { OpsAlert } from './alert-channel.js';
import { BusRegistry } from './registry.js';
import {
  OPS_MONITOR_DEFAULTS,
  OPS_MONITOR_WORKER,
  OpsMonitor,
  OpsMonitorContractError,
  registerOpsMonitor,
} from './ops-monitor.js';
import type { OpsMetricRow } from './ops-monitor.js';
import type { SqlClient } from './sql.js';

const T0 = new Date('2026-11-04T12:00:00.000Z');
const at = (seconds: number): Date => new Date(T0.getTime() + seconds * 1000);
const row = (
  metric: string,
  value: number | string,
  label: string | null = null,
  country: string | null = null,
): OpsMetricRow => ({ metric, label, country_code: country, value });

describe('canal d’alerte : comptes et codes seulement (17 §6.3)', () => {
  const ok: OpsAlert = {
    code: 'OPS_WEBHOOK_FAILING',
    severity: 'P1',
    counts: { value: 2 },
    labels: { provider: 'ACME_PSP', country: 'XA' },
  };

  it('une alerte conforme passe et donne la ligne lue par le filtre de métrique de l’IaC', () => {
    expect(() => {
      assertSafeAlert(ok);
    }).not.toThrow();
    expect(JSON.parse(alertLogLine(ok))).toEqual({
      level: 'error',
      event: 'ops.alert',
      code: 'OPS_WEBHOOK_FAILING',
      severity: 'P1',
      counts: { value: 2 },
      labels: { provider: 'ACME_PSP', country: 'XA' },
    });
  });

  it.each([
    ['courriel', { ...ok, labels: { provider: 'ana@example.test' } }],
    ['téléphone', { ...ok, labels: { provider: '50761234567' } }],
    ['texte libre', { ...ok, labels: { provider: 'Ana Pérez' } }],
    ['UUID', { ...ok, labels: { consumer: 'x-0b6a6f2e-1c1f-4b55-9a52-6b1f2f9d1a10' } }],
    ['clé d’étiquette hors liste', { ...ok, labels: { user: 'abc' } }],
    ['compte négatif', { ...ok, counts: { value: -1 } }],
    ['compte non entier', { ...ok, counts: { value: 1.5 } }],
    ['aucun compte', { ...ok, counts: {} }],
    ['code inconnu', { ...ok, code: 'FREE_TEXT' }],
    ['sévérité inconnue', { ...ok, severity: 'P0' }],
  ])('refusée : %s', (_name, alert) => {
    expect(() => {
      assertSafeAlert(alert as OpsAlert);
    }).toThrow(UnsafeAlertError);
  });

  it('LogAlertChannel écrit une ligne ; une alerte non conforme n’écrit rien', async () => {
    const lines: string[] = [];
    const channel = new LogAlertChannel((l) => lines.push(l));
    await channel.send(ok);
    expect(() => channel.send({ ...ok, labels: { provider: 'a b' } })).toThrow(UnsafeAlertError);
    expect(lines).toHaveLength(1);
  });

  it('FakeAlertChannel applique le même contrôle et simule une panne', async () => {
    const fake = new FakeAlertChannel();
    await fake.send(ok);
    expect(fake.sent).toEqual([ok]);
    expect(() => fake.send({ ...ok, counts: { value: -2 } })).toThrow(UnsafeAlertError);
    fake.failing = true;
    await expect(fake.send(ok)).rejects.toThrow();
  });

  it('lettre morte relayée : consommateur et code, jamais l’identifiant de l’événement', async () => {
    const fake = new FakeAlertChannel();
    await new ChannelAlerter(fake).deadLetter({
      consumer: 'ntf_dispatcher',
      eventId: '0b6a6f2e-1c1f-4b55-9a52-6b1f2f9d1a10',
      jobId: '1b6a6f2e-1c1f-4b55-9a52-6b1f2f9d1a10',
      attempts: 5,
      errorCode: 'PAYLOAD_INVALID',
    });
    expect(fake.sent).toEqual([
      {
        code: 'BUS_DEAD_LETTER',
        severity: 'P1',
        counts: { attempts: 5, dead_letters: 1 },
        labels: { consumer: 'ntf_dispatcher', error_code: 'PAYLOAD_INVALID' },
      },
    ]);
    expect(JSON.stringify(fake.sent)).not.toContain('0b6a6f2e');
  });
});

describe('moniteur : seuils de 17 §6.3 et d’ADM-032', () => {
  it('valeurs PROPOSÉES', () => {
    expect(OPS_MONITOR_DEFAULTS).toEqual({
      periodSeconds: 60,
      outboxStaleSeconds: 120,
      webhookFailures: 3,
      realertSeconds: 1_800,
    });
  });

  it('tout à zéro (ou outbox à 120 s pile) : aucune alerte', () => {
    const m = new OpsMonitor(new FakeAlertChannel());
    expect(m.evaluate([row('outbox_oldest_age_s', 120)], T0)).toEqual([]);
  });

  it('chaque métrique au-delà du seuil donne son alerte, sévérité et étiquettes', () => {
    const m = new OpsMonitor(new FakeAlertChannel());
    expect(
      m.evaluate(
        [
          row('outbox_oldest_age_s', '121'),
          row('webhook_failing', '1', 'ACME_PSP'),
          row('payment_unknown_30m', 2, null, 'XB'),
          row('webhook_signature_rejected', 4, 'ACME_PSP'),
          row('p1_event', 1, 'booking.alert.production_oracle'),
          row('p1_event', 3, 'notification.sms_cap.reached', 'XA'),
        ],
        T0,
      ),
    ).toEqual([
      { code: 'OPS_OUTBOX_STALE', severity: 'P1', counts: { value: 121 }, labels: {} },
      {
        code: 'OPS_WEBHOOK_FAILING',
        severity: 'P1',
        counts: { value: 1 },
        labels: { provider: 'ACME_PSP' },
      },
      {
        code: 'OPS_PAYMENT_UNKNOWN',
        severity: 'P1',
        counts: { value: 2 },
        labels: { country: 'XB' },
      },
      {
        code: 'OPS_WEBHOOK_SIGNATURE',
        severity: 'P2',
        counts: { value: 4 },
        labels: { provider: 'ACME_PSP' },
      },
      {
        code: 'OPS_P1_EVENT',
        severity: 'P1',
        counts: { value: 1 },
        labels: { event_type: 'booking.alert.production_oracle' },
      },
      {
        code: 'OPS_P1_EVENT',
        severity: 'P1',
        counts: { value: 3 },
        labels: { event_type: 'notification.sms_cap.reached', country: 'XA' },
      },
    ]);
  });

  it('jauge : une alerte au dépassement, puis si elle monte ou toutes les 30 min ; oubliée sous le seuil', () => {
    const m = new OpsMonitor(new FakeAlertChannel());
    const failing = (n: number) => [row('webhook_failing', n, 'ACME_PSP')];
    expect(m.evaluate(failing(1), at(0))).toHaveLength(1);
    expect(m.evaluate(failing(1), at(60))).toHaveLength(0);
    expect(m.evaluate(failing(2), at(120))).toHaveLength(1); // monte
    expect(m.evaluate(failing(2), at(120 + 1_799))).toHaveLength(0);
    expect(m.evaluate(failing(2), at(120 + 1_800))).toHaveLength(1); // rappel
    expect(m.evaluate([], at(2_000))).toHaveLength(0); // revenue à zéro
    expect(m.evaluate(failing(1), at(2_060))).toHaveLength(1); // nouveau dépassement
  });

  it('compteurs : une alerte par passe non nulle, sans état', () => {
    const m = new OpsMonitor(new FakeAlertChannel());
    const p1 = [row('p1_event', 1, 'booking.alert.invariant_violation', 'XA')];
    expect(m.evaluate(p1, at(0))).toHaveLength(1);
    expect(m.evaluate(p1, at(60))).toHaveLength(1);
  });

  it.each([
    [row('metrique_inconnue', 1)],
    [row('webhook_failing', -1, 'ACME_PSP')],
    [row('webhook_failing', 'abc', 'ACME_PSP')],
  ])('contrat rompu (%j) : erreur, jamais ignoré', (r) => {
    const m = new OpsMonitor(new FakeAlertChannel());
    expect(() => m.evaluate([r], T0)).toThrow(OpsMonitorContractError);
  });
});

describe('passe du travailleur ops_monitor', () => {
  function tx(metrics: OpsMetricRow[][], clock: Date[]): { tx: SqlClient; params: unknown[][] } {
    const params: unknown[][] = [];
    return {
      params,
      tx: {
        query: <R>(text: string, p?: readonly unknown[]) => {
          if (text.includes('platform.now()')) {
            return Promise.resolve({ rows: [{ at: clock.shift() }] as R[], rowCount: 1 });
          }
          params.push([...(p ?? [])]);
          const rows = (metrics.shift() ?? []) as R[];
          return Promise.resolve({ rows, rowCount: rows.length });
        },
      },
    };
  }

  it('ADM-032 : un webhook en échec 3 fois => une alerte part ; fenêtre = horloge de la base', async () => {
    const fake = new FakeAlertChannel();
    const logs: string[] = [];
    const registry = new BusRegistry();
    registerOpsMonitor(registry, fake, (l) => logs.push(l));
    const h = registry.handlerOf(OPS_MONITOR_WORKER);
    if (h?.kind !== 'timer') throw new Error('minuterie attendue');
    const t = tx([[row('webhook_failing', 1, 'ACME_PSP')], []], [at(0), at(60)]);
    await h.handle({}, t.tx);
    await h.handle({}, t.tx);
    // première passe : depuis une période ; ensuite : depuis l'horloge lue à la passe précédente
    expect(t.params).toEqual([
      [at(-60), 3],
      [at(0), 3],
    ]);
    expect(fake.sent).toEqual([
      {
        code: 'OPS_WEBHOOK_FAILING',
        severity: 'P1',
        counts: { value: 1 },
        labels: { provider: 'ACME_PSP' },
      },
    ]);
    expect(logs.map((l) => JSON.parse(l) as unknown)).toEqual([
      { level: 'info', worker: 'ops_monitor', metrics: 1, alerts: 1, rejected: 0 },
      { level: 'info', worker: 'ops_monitor', metrics: 0, alerts: 0, rejected: 0 },
    ]);
    expect(registry.periodicTasks()).toEqual([
      { name: 'ops_monitor', spec: { periodSeconds: 60, maxAttempts: 5 } },
    ]);
  });

  it('canal en panne : la passe échoue (le bus la rejoue), la fenêtre n’avance pas', async () => {
    const fake = new FakeAlertChannel();
    fake.failing = true;
    const m = new OpsMonitor(fake);
    const t = tx([[row('p1_event', 1, 'booking.alert.production_oracle')], []], [at(0), at(60)]);
    await expect(m.run(t.tx)).rejects.toThrow();
    fake.failing = false;
    await m.run(t.tx);
    expect(t.params).toEqual([
      [at(-60), 3],
      [at(0), 3],
    ]);
  });

  it('revue sécurité : envoi en échec => la jauge n\u2019avance pas, l\u2019alerte repart à la passe suivante', async () => {
    const fake = new FakeAlertChannel();
    const m = new OpsMonitor(fake);
    const failing = [row('webhook_failing', 1, 'ACME_PSP')];
    const t = tx([failing, failing], [at(0), at(60)]);
    fake.failing = true;
    await expect(m.run(t.tx)).rejects.toThrow();
    expect(fake.sent).toEqual([]);
    fake.failing = false;
    // même valeur, avant le rappel de 30 min : sans la correction, elle serait perdue
    expect(await m.run(t.tx)).toEqual({ metrics: 1, alerts: 1, rejected: 0 });
    expect(fake.sent.map((a) => a.code)).toEqual(['OPS_WEBHOOK_FAILING']);
  });

  it('revue sécurité : alerte non conforme écartée et comptée, les autres partent, la passe réussit', async () => {
    const fake = new FakeAlertChannel();
    const m = new OpsMonitor(fake);
    const t = tx(
      [
        [
          row('webhook_failing', 2, 'fournisseur avec espace'),
          row('p1_event', 1, 'booking.alert.production_oracle'),
        ],
      ],
      [at(0)],
    );
    expect(await m.run(t.tx)).toEqual({ metrics: 2, alerts: 1, rejected: 1 });
    expect(fake.sent.map((a) => a.code)).toEqual(['OPS_P1_EVENT']);
  });

  it('horloge illisible : erreur de contrat', async () => {
    const m = new OpsMonitor(new FakeAlertChannel());
    await expect(m.run(tx([], [undefined as unknown as Date]).tx)).rejects.toThrow(
      OpsMonitorContractError,
    );
  });
});
