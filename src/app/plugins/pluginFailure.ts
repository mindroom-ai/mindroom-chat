/** What a plugin threw, as an Error: it may throw anything, even a value with no text form. */
const asError = (thrown: unknown): Error => {
  if (thrown instanceof Error) return thrown;
  try {
    return new Error(String(thrown));
  } catch {
    return new Error('a value that cannot be shown as text');
  }
};

/** The error report of a plugin's failure caught by an error boundary, named with its tag. */
export const pluginFailure = (tag: string, thrown: unknown) => {
  const error = asError(thrown);
  return { name: error.name, message: `[plugin ${tag}] ${error.message}`, stack: error.stack };
};
