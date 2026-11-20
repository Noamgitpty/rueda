/**
 * Archive ZIP déterministe du dossier de preuve (US-308, ADR-184 ; 16 CLM-034 bêta SIMPLIFIÉ :
 * « export ZIP (photos, contrat, messages, journal) »).
 *
 * Méthode STORE (aucune compression : les photos JPEG / WebP et les PDF sont déjà compressés, et
 * chaque fichier de l'archive garde à l'octet près les octets dont le manifeste porte l'empreinte),
 * noms UTF-8 (bit 11), une seule heure (celle du scellé du manifeste, en UTC) pour toutes les
 * entrées : mêmes entrées ⇒ mêmes octets. Sans ZIP64 : au plus 65 535 entrées et 4 Gio, bornes
 * bien au-delà du plafond du dossier (`EVIDENCE_ZIP_MAX_BYTES`). Aucune dépendance : `crc32` de
 * `node:zlib`.
 */
import { crc32 } from 'node:zlib';

export interface ZipEntry {
  /** Chemin relatif (`photos/CHECKIN/HOST/01-EXT_01-….jpg`) : ni `/` initial, ni `..`. */
  readonly path: string;
  readonly data: Buffer;
}

export class ZipInputError extends Error {
  override readonly name = 'ZipInputError';
}

/** Chemin admis : segments `[A-Za-z0-9._-]`, séparés par `/`, jamais `.` ni `..`. */
const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,159}$/;

export function isSafeZipPath(path: string): boolean {
  if (path.length === 0 || path.length > 400) return false;
  return path.split('/').every((s) => SEGMENT.test(s) && s !== '.' && s !== '..');
}

/** Date et heure MS-DOS (UTC, 2 s), années 1980 à 2107. */
function dosDateTime(at: Date): { readonly date: number; readonly time: number } {
  const year = at.getUTCFullYear();
  if (!Number.isFinite(year) || year < 1980 || year > 2107) {
    throw new ZipInputError('date hors des bornes du format ZIP');
  }
  return {
    date: ((year - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
    time: (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | Math.floor(at.getUTCSeconds() / 2),
  };
}

const UTF8_FLAG = 0x0800;
const VERSION = 20;

export function buildZip(entries: readonly ZipEntry[], at: Date): Buffer {
  if (entries.length === 0 || entries.length > 0xffff) {
    throw new ZipInputError('nombre d’entrées hors des bornes');
  }
  const { date, time } = dosDateTime(at);
  const seen = new Set<string>();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    if (!isSafeZipPath(entry.path)) throw new ZipInputError('chemin refusé');
    if (seen.has(entry.path)) throw new ZipInputError('chemin en double');
    seen.add(entry.path);
    const name = Buffer.from(entry.path, 'utf8');
    const size = entry.data.length;
    const crc = crc32(entry.data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(0, 8); // STORE
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(VERSION, 4);
    central.writeUInt16LE(VERSION, 6);
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    // extra, commentaire, disque, attributs internes et externes : 0
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, entry.data);
    centrals.push(central, name);
    offset += local.length + name.length + size;
    if (offset > 0xffffffff) throw new ZipInputError('archive trop grande pour ZIP sans ZIP64');
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
