/** Concatène des noms de classe ; ignore `false`, `undefined` et les chaînes vides. */
export function cx(...names: ReadonlyArray<string | false | null | undefined>): string {
  return names.filter((n): n is string => typeof n === 'string' && n !== '').join(' ');
}
