import type { ClientConfig } from '../../hooks/useClientConfig';
import {
  MINDROOM_APP_NAME,
  MINDROOM_DEFAULT_POWERED_BY,
  MINDROOM_DOCS_URL,
  MINDROOM_LOGO_ALT,
  MINDROOM_LOGO_SRC,
  MINDROOM_SOURCE_URL,
} from './branding';

export const MINDROOM_CLIENT_BRANDING = {
  appName: MINDROOM_APP_NAME,
  docsUrl: MINDROOM_DOCS_URL,
  logoAlt: MINDROOM_LOGO_ALT,
  logoSrc: MINDROOM_LOGO_SRC,
  poweredBy: MINDROOM_DEFAULT_POWERED_BY,
  sourceUrl: MINDROOM_SOURCE_URL,
} as const;

export const getMindroomWelcomePageContent = (
  welcome: ClientConfig['welcome'] | undefined
) => ({
  docsLabel: welcome?.docsLabel ?? 'Docs',
  docsUrl: welcome?.docsUrl ?? MINDROOM_CLIENT_BRANDING.docsUrl,
  poweredBy: welcome?.poweredBy ?? MINDROOM_CLIENT_BRANDING.poweredBy,
  sourceLabel: welcome?.sourceLabel ?? 'Source Code',
  sourceUrl: welcome?.sourceUrl ?? MINDROOM_CLIENT_BRANDING.sourceUrl,
  subtitle: welcome?.subtitle ?? 'Yet another matrix client.',
  title: welcome?.title ?? `Welcome to ${MINDROOM_CLIENT_BRANDING.appName}`,
});
