/**
 * Registre des blocs de contenu éditables (US-121, ADR-095) : **liste blanche** des textes que le
 * fondateur peut changer sans déploiement (`content_block`, US-034). Chaque bloc remplace un
 * texte du catalogue livré (`catalogKey`) : si le bloc n'est pas publié dans la langue de la page,
 * le site affiche ce texte du catalogue, dans la même langue (jamais un bloc vide, jamais deux
 * langues dans une vue : UX-58, US-014). Une clé absente d'ici est refusée à l'enregistrement
 * (`CONTENT_KEY_NOT_EDITABLE`) et n'est jamais servie.
 *
 * Exclus par construction : textes juridiques (CGU, contrat, politique d'annulation,
 * confidentialité, assurance : `document_template` versionnés, 17 §3.2.13), montants et règles.
 * `LEGAL_BLOCK_KEY` les reconnaît ; la base applique le même motif (migration 0062).
 */
import type { MessageKey } from './catalogs/index.ts';
import type { RichFormat } from './rich-text.ts';

export interface EditableBlock {
  /** Texte du catalogue remplacé (sans variable ni pluriel : test du registre). */
  readonly catalogKey: MessageKey;
  readonly format: RichFormat;
  /** Longueur maximale du corps, en caractères (PROPOSÉ, d'après la place à l'écran). */
  readonly maxLength: number;
}

/** Clé de bloc : `espace.élément[.sous-élément]`, minuscules (même motif que la base, 0042). */
export const BLOCK_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}(\.[a-z][a-z0-9_]{0,39}){1,5}$/;

/**
 * Textes juridiques et contractuels : jamais des blocs (refus `CONTENT_KEY_FORBIDDEN`). Deux
 * alternatives, en es, en, fr et pt :
 * 1. **sigles et mots courts, par segment entier** (séparé par `.` ou `_`) : tos, tyc, t_c,
 *    tandc, rgpd, lgpd, gdpr, dpa, lopd, aviso, mentions, impressum, imprint, license, licencia,
 *    licenca, cgu, cgv, cookies. En sous-chaîne, ils refuseraient `autos`, `fotos`, `photos` ;
 * 2. **racines, par sous-chaîne** (n'importe où : `help.terminos_uso`, `footer.avisolegal`,
 *    `page.mentions_legales`) : CGU (terms, terminos, termos, conditions, condiciones,
 *    condições), contrat, accord, confidentialité, politique d'annulation (cancellation,
 *    cancelación, cancelamento, annulation), remboursement, assurance (insurance, seguros,
 *    seguro_, segurador, assurance, protection, franchise, garantie, responsabilité,
 *    renonciation), politiques (policy, política, politique), consentement.
 * Racines resserrées pour éviter les faux positifs courants (`airport_terminal`,
 * `vehicle_condition`, `free_cancel`, `viaja_seguro`, `cookie_banner` restent permises). Faux
 * positifs gardés, au profit du refus : `illegal`, `political`, `host_protection`,
 * `responsable` (renommer la clé suffit). Faux négatif accepté : un segment `seguro` seul
 * (« sûr » en espagnol) n'est pas refusé ; l'assurance reste refusée par insurance, seguros,
 * seguro_, assurance, deductible, franqui. Motif recopié À L'IDENTIQUE dans
 * `core.cfg_content_key_not_legal` (0062) : la preuve L0 compare les deux.
 */
export const LEGAL_BLOCK_KEY =
  /(^|[._])(tos|tyc|t_c|tandc|rgpd|lgpd|gdpr|dpa|lopd|aviso|mentions|impressum|imprint|license|licencia|licenca|cgu|cgv|cookies)([._]|$)|(legal|terms|terminos|termino_|termos|condiciones|condicoes|conditions|contract|contrat|agreement|acuerdo|acordo|privac|confidential|cancellation|cancelacion|cancelamento|annulation|refund|reembols|rembours|insurance|seguros|seguro_|segurador|assurance|protection|policy|politic|consent|eula|disclaimer|waiver|deductible|franqui|warrant|garanti|liabil|responsab)/;

export const EDITABLE_BLOCKS = {
  'home.hero.title': { catalogKey: 'web.s01.title', format: 'plain', maxLength: 80 },
  'home.hero.subtitle': { catalogKey: 'web.s01.subtitle', format: 'plain', maxLength: 200 },
  'home.hero.tagline': { catalogKey: 'web.home.tagline', format: 'plain', maxLength: 120 },
  'home.how.title': { catalogKey: 'web.s01.how.title', format: 'plain', maxLength: 60 },
  'home.how.step1.title': { catalogKey: 'web.s01.how.1', format: 'plain', maxLength: 60 },
  'home.how.step1.body': { catalogKey: 'web.s01.how.1.body', format: 'plain', maxLength: 200 },
  'home.how.step2.title': { catalogKey: 'web.s01.how.2', format: 'plain', maxLength: 60 },
  'home.how.step2.body': { catalogKey: 'web.s01.how.2.body', format: 'plain', maxLength: 200 },
  'home.how.step3.title': { catalogKey: 'web.s01.how.3', format: 'plain', maxLength: 60 },
  'home.how.step3.body': { catalogKey: 'web.s01.how.3.body', format: 'plain', maxLength: 200 },
  'home.owner.title': { catalogKey: 'web.s01.owner.title', format: 'plain', maxLength: 80 },
  'home.owner.body': { catalogKey: 'web.s01.owner.body', format: 'rich', maxLength: 600 },
} as const satisfies Readonly<Record<string, EditableBlock>>;

export type EditableBlockKey = keyof typeof EDITABLE_BLOCKS;

/** Registre consulté (injectable dans les tests de l'API). */
export type EditableBlocks = Readonly<Record<string, EditableBlock>>;

export function isLegalBlockKey(key: string): boolean {
  return LEGAL_BLOCK_KEY.test(key);
}

/** Bloc du registre, ou `undefined` (clé non éditable). */
export function editableBlock(
  key: string,
  registry: EditableBlocks = EDITABLE_BLOCKS,
): EditableBlock | undefined {
  return Object.prototype.hasOwnProperty.call(registry, key) ? registry[key] : undefined;
}

/** Clé de bloc qui remplace un texte du catalogue, ou `undefined`. */
export function blockKeyOf(
  catalogKey: MessageKey,
  registry: EditableBlocks = EDITABLE_BLOCKS,
): string | undefined {
  return Object.entries(registry).find(([, b]) => b.catalogKey === catalogKey)?.[0];
}
