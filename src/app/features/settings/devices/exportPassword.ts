/**
 * The shortest password a room key export takes. The file holds every room key of the session and
 * ends up in Downloads; key stretching cannot save a password short enough to try them all.
 */
export const MIN_EXPORT_PASSWORD_LENGTH = 12;

/** Whether `password` is long enough to protect a key export, counted in characters. */
export const isExportPasswordLongEnough = (password: string): boolean =>
  [...password].length >= MIN_EXPORT_PASSWORD_LENGTH;
