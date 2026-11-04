/** The text to show for a caught error: its message, or the value itself when it has none. */
export const errorMessage = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : String(error);
