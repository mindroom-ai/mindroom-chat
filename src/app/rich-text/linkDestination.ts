/**
 * Bidirectional embedding, override and isolate controls (U+202A to U+202E, U+2066 to U+2069).
 * In a link's text they can reverse what a reader sees, so that text holding
 * `https://` U+202E `gro.elpmaxe` reads as `https://example.org`. The marks U+200E and U+200F
 * stay: they cannot reverse a run of letters, and right-to-left text uses them.
 */
const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/g;

/** The text without bidirectional embedding, override and isolate controls. */
export const stripBidiControls = (text: string): string => text.replace(BIDI_CONTROLS, '');

/**
 * Endings that make bare text such as `example.com` read as a web address. Other bare names
 * (`notes.md`, `config.yaml`) read as file names, which agents often use as link text.
 */
const WEB_ENDINGS = new Set([
  'com',
  'net',
  'org',
  'io',
  'ai',
  'app',
  'dev',
  'co',
  'me',
  'info',
  'edu',
  'gov',
]);

/** A host without a leading `www.`, so `www.example.org` and `example.org` count as one site. */
const siteOf = (host: string): string => host.replace(/^www\./, '');

/**
 * The site that a link's visible text names, when the text reads as a web address: any
 * `scheme://...`, or a bare host (`www.example.org`, `example.org/path`, `example.com`).
 */
const claimedSite = (text: string): string | undefined => {
  const shown = stripBidiControls(text).trim();
  if (shown === '' || /\s/.test(shown)) return undefined;
  let address = shown;
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(shown)) {
    const bare = /^([a-z\d-]+(?:\.[a-z\d-]+)+)([/:?#].*)?$/i.exec(shown);
    if (!bare) return undefined;
    const [, host = '', rest = ''] = bare;
    const ending = host.slice(host.lastIndexOf('.') + 1).toLowerCase();
    if (!/^www\./i.test(host) && !rest.startsWith('/') && !WEB_ENDINGS.has(ending)) {
      return undefined;
    }
    address = `https://${shown}`;
  }
  try {
    return siteOf(new URL(address).host);
  } catch {
    return undefined;
  }
};

/**
 * Whether a link's visible text reads as a web address on another site than the one the link
 * opens, as in `<a href="https://evil.example/">https://example.org</a>`. Text that does not read
 * as an address ("the docs") does not count: the link's title names its address instead.
 */
export const linkTextMisleads = (text: string, href: string): boolean => {
  const claimed = claimedSite(text);
  if (claimed === undefined) return false;
  try {
    return siteOf(new URL(href).host) !== claimed;
  } catch {
    return true;
  }
};
