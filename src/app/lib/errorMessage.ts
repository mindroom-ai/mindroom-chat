/**
 * A caught error's own text, untranslated: its message, or the value itself when it has none.
 * For matching an error this client threw itself; to show a failure to people, use
 * `describeError` and `ErrorDetail`.
 */
export const errorMessage = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : String(error);
