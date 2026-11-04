// Links a server hands the client (terms of service, account pages) are opened or rendered as
// `href`s. Only http and https are let through, so a server cannot make the page link a script.

/** `value` as a URL when it is an absolute http or https URL. */
export const parseHttpUrl = (value: unknown): URL | undefined => {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : undefined;
  } catch {
    return undefined;
  }
};

/** `value` itself when it is an absolute http or https URL. */
export const toHttpUrl = (value: unknown): string | undefined =>
  typeof value === 'string' && parseHttpUrl(value) ? value : undefined;
