/**
 * The shortest password a room key export takes. The file holds every room key of the session and
 * ends up in Downloads; key stretching cannot save a password short enough to try them all.
 */
export const MIN_EXPORT_PASSWORD_LENGTH = 12;

/** Spaces of any kind and invisible format characters (zero-width spaces and joiners, marks). */
const BLANK = /[\s\p{Cf}]/u;

/**
 * Whether `password` is long enough to protect a key export: counted in characters, leaving out
 * spaces and invisible characters, so twelve spaces are not a password.
 */
export const isExportPasswordLongEnough = (password: string): boolean =>
  [...password].filter((character) => !BLANK.test(character)).length >= MIN_EXPORT_PASSWORD_LENGTH;
