// Tests de l'inventaire des comptes (US-037 ; node --test scripts/ci/).
// Le dépôt est public : docs/ops/ACCOUNTS.md décrit des rôles, jamais des données. Ces tests
// échouent si un compte n'a pas le fondateur pour titulaire, si une catégorie exigée par 19 US-037
// manque, ou si une donnée d'identification réelle y apparaît.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FILE = fileURLToPath(new URL('../../docs/ops/ACCOUNTS.md', import.meta.url));
const TEXT = readFileSync(FILE, 'utf8');

/** Lignes du tableau des comptes, en objets { colonne: valeur }. */
export function accountRows(markdown) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => /^\|\s*Compte\s*\|/.test(l));
  if (start < 0) return [];
  const cells = (l) =>
    l
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim());
  const header = cells(lines[start]);
  const rows = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.trim().startsWith('|')) break;
    const values = cells(line);
    rows.push(Object.fromEntries(header.map((h, i) => [h, values[i] ?? ''])));
  }
  return rows;
}

/** Motifs de données réelles interdites dans le dépôt public. */
export function leakedIdentifiers(markdown) {
  const patterns = [
    ['adresse e-mail', /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/g],
    ['numéro de compte AWS (12 chiffres)', /(?<!\d)\d{12}(?!\d)/g],
    ['ARN', /\barn:aws[a-z-]*:[^\s`|]+/g],
    ['numéro de téléphone', /\+\d[\d\s().-]{7,}\d/g],
    ['clé d’accès AWS', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
    ['jeton GitHub', /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g],
  ];
  const found = [];
  for (const [label, re] of patterns) {
    for (const m of markdown.matchAll(re)) found.push(`${label} : ${m[0]}`);
  }
  return found;
}

const rows = accountRows(TEXT);

test('inventaire des comptes : tableau lisible et non vide', () => {
  assert.ok(rows.length >= 10, `seulement ${rows.length} comptes`);
  for (const col of [
    'Compte',
    'Ce qu’il contrôle',
    'Titulaire attendu',
    'État',
    'Accès des agents',
  ]) {
    const key = col.replace('’', "'");
    assert.ok(key in rows[0], `colonne « ${key} » absente`);
  }
});

test('chaque compte a le fondateur pour titulaire, jamais un agent ni un prestataire', () => {
  for (const r of rows) {
    assert.match(r['Titulaire attendu'], /^fondateur\b/, `${r.Compte} : ${r['Titulaire attendu']}`);
    assert.doesNotMatch(r['Titulaire attendu'], /\b(agent|prestataire|bot)\b/i, r.Compte);
  }
});

test('chaque compte a un état et dit ce qu’il contrôle', () => {
  for (const r of rows) {
    assert.match(
      r['État'],
      /^(existe|à créer par le fondateur|à confirmer par le fondateur|plus tard)/,
      r.Compte,
    );
    assert.ok(r["Ce qu'il contrôle"].length > 10, r.Compte);
  }
});

test('catégories exigées par 19 US-037 présentes', () => {
  const all = rows.map((r) => r.Compte).join('\n');
  for (const [label, re] of [
    ['GitHub propriétaire', /GitHub, compte propriétaire `Noamgitpty`/],
    ['GitHub bot', /GitHub, compte bot `Projetapploccar`/],
    ['hébergement', /Hébergeur : compte de production/],
    ['sauvegarde', /Hébergeur : compte de sauvegarde/],
    ['domaine', /domaine/i],
    ['e-mail', /e-mail/i],
    ['SMS', /SMS/],
    ['KYC', /KYC/],
    ['cartes', /cartes/i],
    ['PSP', /PSP/],
  ]) {
    assert.match(all, re, `catégorie manquante : ${label}`);
  }
});

test('le bot appartient au fondateur et reste révocable par lui', () => {
  assert.match(TEXT, /## Le bot `Projetapploccar`/);
  assert.match(TEXT, /révocable par lui/);
});

test('aucune donnée d’identification réelle (dépôt public)', () => {
  assert.deepEqual(leakedIdentifiers(TEXT), []);
});

test('le détecteur de fuites attrape les vrais cas (échec volontaire)', () => {
  const sample = [
    'contact : someone@example.org',
    'compte 123456789012',
    'arn:aws:iam::123456789012:role/x',
    'tél. +507 6123 4567',
    'AKIAABCDEFGHIJKLMNOP',
  ].join('\n');
  assert.equal(leakedIdentifiers(sample).length, 6); // le numéro de compte est aussi dans l'ARN
  const bad = TEXT.replace('| fondateur (ou son entité)', '| prestataire');
  assert.ok(accountRows(bad).some((r) => !/^fondateur\b/.test(r['Titulaire attendu'])));
});
