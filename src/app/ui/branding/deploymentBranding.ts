import { useOptionalClientConfig, type ClientConfig } from '../../config/useClientConfig';
import {
  MINDROOM_APP_NAME,
  MINDROOM_DEFAULT_POWERED_BY,
  MINDROOM_LOGO_ALT,
  MINDROOM_LOGO_SRC,
  type PoweredByLink,
} from './branding';

// The deployment's own look on the signed-out pages (`branding` in config.json, plus the credits
// and policy pages of `auth`). Every value comes from an operator's file and ends up in the page,
// so each is checked here once: text stays text, images load only over https or from the app's own
// origin, links open only http, https or mailto addresses. A value that fails keeps its default and
// logs one warning, so a typo never leaves the sign-in page blank or broken.

/** A piece of the footer's line: plain text, or a link inside it. */
export type FooterTextPart = string | PoweredByLink;

/** What the signed-out pages show, after the configured values are checked. */
export type DeploymentBranding = {
  /**
   * The name in the sign-in card's header, on the pairing page and on the loading screens. For an
   * empty `branding.title` it is the configured logo's alt text, as a wordmark logo shows it.
   */
  title: string;
  /** False for an empty `branding.title`: the card's header shows the logo alone, as its heading. */
  showTitle: boolean;
  /** The configured name, which the browser tab shows too; undefined leaves the tab as it is. */
  pageTitle: string | undefined;
  logo: {
    src: string;
    /** The logo for dark themes; `src` when none is configured. */
    srcDark: string;
    alt: string;
    /** A configured logo rather than MindRoom's own. */
    custom: boolean;
  };
  /** The line before the credits, read in order; undefined shows none. */
  footerText: readonly FooterTextPart[] | undefined;
  footerLinks: PoweredByLink[];
  /** The "Powered by" credits; an empty list hides the line. */
  poweredBy: readonly PoweredByLink[];
  supportUrl: string | undefined;
  privacyUrl: string | undefined;
  termsUrl: string | undefined;
};

type Warn = (message: string) => void;

const DEFAULT_LOGO: DeploymentBranding['logo'] = {
  src: MINDROOM_LOGO_SRC,
  srcDark: MINDROOM_LOGO_SRC,
  alt: MINDROOM_LOGO_ALT,
  custom: false,
};

const LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The string without its outer spaces, when some text is left; undefined for anything else. */
const textOf = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

/**
 * An image address the page may load: any https URL, or one on the app's own origin (http there
 * only for local development). A relative address is resolved against that origin.
 */
const imageAddress = (value: unknown, origin: string): string | undefined => {
  const written = textOf(value);
  if (written === undefined) return undefined;
  try {
    const url = new URL(written, origin ? `${origin}/` : undefined);
    const ownOrigin = url.origin === origin && url.protocol === 'http:';
    return url.protocol === 'https:' || ownOrigin ? url.href : undefined;
  } catch {
    return undefined;
  }
};

/** An absolute http, https or mailto address, as written. */
const linkAddress = (value: unknown): string | undefined => {
  const written = textOf(value);
  if (written === undefined) return undefined;
  try {
    return LINK_PROTOCOLS.has(new URL(written).protocol) ? written : undefined;
  } catch {
    return undefined;
  }
};

/** The usable `{label, url}` entries of a configured list; undefined when it is no list at all. */
const linkList = (value: unknown, key: string, warn: Warn): PoweredByLink[] | undefined => {
  if (!Array.isArray(value)) {
    warn(`${key} must be a list of {"label", "url"} links; ignoring it.`);
    return undefined;
  }
  return value.flatMap((entry: unknown, index) => {
    const label = isRecord(entry) ? textOf(entry.label) : undefined;
    const url = isRecord(entry) ? linkAddress(entry.url) : undefined;
    if (label !== undefined && url !== undefined) return [{ label, url }];
    warn(`${key}[${index}] needs a label and an http, https or mailto url; leaving it out.`);
    return [];
  });
};

/**
 * The footer's line: a text, or a list of texts and `{label, url}` links read as one line. A link
 * that cannot open safely keeps its label as text, so the line still reads.
 */
const footerTextParts = (value: unknown, warn: Warn): FooterTextPart[] | undefined => {
  if (value === undefined) return undefined;
  if (typeof value === 'string') {
    const text = textOf(value);
    return text === undefined ? undefined : [text];
  }
  if (!Array.isArray(value)) {
    warn('branding.footer.text must be text or a list of texts and links; ignoring it.');
    return undefined;
  }
  const parts = value.flatMap((entry: unknown, index): FooterTextPart[] => {
    if (typeof entry === 'string') return entry === '' ? [] : [entry];
    const label = isRecord(entry) ? textOf(entry.label) : undefined;
    const url = isRecord(entry) ? linkAddress(entry.url) : undefined;
    if (label !== undefined && url !== undefined) return [{ label, url }];
    if (label !== undefined) {
      warn(
        `branding.footer.text[${index}] needs an http, https or mailto url; showing its label as text.`
      );
      return [label];
    }
    warn(`branding.footer.text[${index}] must be text or a {"label", "url"} link; leaving it out.`);
    return [];
  });
  return parts.some((part) => typeof part !== 'string' || part.trim() !== '') ? parts : undefined;
};

/** A support or policy page; an empty value means none, as it always did. */
const pageAddress = (value: unknown, key: string, warn: Warn): string | undefined => {
  if (value === undefined || value === '') return undefined;
  const url = linkAddress(value);
  if (url === undefined) warn(`${key} must be an http, https or mailto address; leaving it out.`);
  return url;
};

const resolveLogo = (value: unknown, origin: string, warn: Warn): DeploymentBranding['logo'] => {
  if (value === undefined) return DEFAULT_LOGO;
  const logo = isRecord(value) ? value : {};
  const src = imageAddress(logo.src, origin);
  const alt = textOf(logo.alt);
  if (src === undefined || alt === undefined) {
    warn(
      'branding.logo needs an https or same-origin "src" and an "alt" text; keeping the default logo.'
    );
    return DEFAULT_LOGO;
  }
  if (logo.srcDark === undefined) return { src, srcDark: src, alt, custom: true };
  const srcDark = imageAddress(logo.srcDark, origin);
  if (srcDark === undefined) {
    warn('branding.logo.srcDark must be an https or same-origin image; dark themes show "src".');
  }
  return { src, srcDark: srcDark ?? src, alt, custom: true };
};

/**
 * The signed-out pages' look for `config`, served at `origin`. `warn` hears about each value that
 * was refused and replaced by its default.
 */
export const resolveDeploymentBranding = (
  config: ClientConfig | undefined,
  origin: string,
  warn: Warn
): DeploymentBranding => {
  const authValue: unknown = config?.auth;
  const auth = isRecord(authValue) ? authValue : {};
  const brandingValue: unknown = config?.branding;
  const branding = isRecord(brandingValue) ? brandingValue : {};
  if (brandingValue !== undefined && !isRecord(brandingValue)) {
    warn('branding must be an object; keeping the default look.');
  }

  const configuredTitle = textOf(branding.title);
  // An empty title shows none beside the logo; a wordmark logo already shows the name.
  const showTitle = typeof branding.title !== 'string' || configuredTitle !== undefined;
  if (branding.title !== undefined && typeof branding.title !== 'string') {
    warn('branding.title must be a text; keeping the default title.');
  }
  const logo = resolveLogo(branding.logo, origin, warn);
  const pageTitle = configuredTitle ?? (!showTitle && logo.custom ? logo.alt : undefined);

  let footerText: FooterTextPart[] | undefined;
  let footerLinks: PoweredByLink[] = [];
  const { footer } = branding;
  if (isRecord(footer)) {
    footerText = footerTextParts(footer.text, warn);
    if (footer.links !== undefined) {
      footerLinks = linkList(footer.links, 'branding.footer.links', warn) ?? [];
    }
  } else if (footer !== undefined) {
    warn('branding.footer must be an object with "text" and "links"; ignoring it.');
  }

  const poweredBy =
    auth.poweredBy === undefined
      ? MINDROOM_DEFAULT_POWERED_BY
      : linkList(auth.poweredBy, 'auth.poweredBy', warn) ?? MINDROOM_DEFAULT_POWERED_BY;

  return {
    title: pageTitle ?? MINDROOM_APP_NAME,
    showTitle,
    pageTitle,
    logo,
    footerText,
    footerLinks,
    poweredBy,
    supportUrl: pageAddress(auth.supportUrl, 'auth.supportUrl', warn),
    privacyUrl: pageAddress(auth.privacyUrl, 'auth.privacyUrl', warn),
    termsUrl: pageAddress(auth.termsUrl, 'auth.termsUrl', warn),
  };
};

const DEFAULT_BRANDING = resolveDeploymentBranding(undefined, '', () => undefined);

// One check per loaded configuration, so its warnings appear once rather than at every render.
const checked = new WeakMap<ClientConfig, DeploymentBranding>();

const warnInConsole: Warn = (message) => console.warn(`[branding] ${message}`);

/** The look for `config`, checked once per configuration object; the default without one. */
export const deploymentBranding = (config: ClientConfig | undefined): DeploymentBranding => {
  if (!config) return DEFAULT_BRANDING;
  let branding = checked.get(config);
  if (!branding) {
    const origin = typeof window === 'undefined' ? '' : window.location.origin;
    branding = resolveDeploymentBranding(config, origin, warnInConsole);
    checked.set(config, branding);
  }
  return branding;
};

/** The deployment's look; MindRoom's own before the configuration has loaded. */
export const useDeploymentBranding = (): DeploymentBranding =>
  deploymentBranding(useOptionalClientConfig());
