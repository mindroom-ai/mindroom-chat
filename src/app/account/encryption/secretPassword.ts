/**
 * The shortest password that protects secrets kept off the device: a room key export (the file
 * holds every room key of the session and ends up in Downloads) or the recovery password of the
 * encryption keys. Key stretching cannot save a password short enough to try them all.
 */
export const MIN_SECRET_PASSWORD_LENGTH = 12;

/** Spaces of any kind and invisible format characters (zero-width spaces and joiners, marks). */
const BLANK = /[\s\p{Cf}]/u;

/**
 * Whether `password` is long enough to protect those secrets: counted in characters, leaving out
 * spaces and invisible characters, so twelve spaces are not a password.
 */
export const isSecretPasswordLongEnough = (password: string): boolean =>
  [...password].filter((character) => !BLANK.test(character)).length >= MIN_SECRET_PASSWORD_LENGTH;
