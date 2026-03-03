const NATIVE_SSO_SCHEME = 'mindroom';
const NATIVE_SSO_HOST = 'auth';

export const buildNativeSsoRedirectUrl = (webRedirectUrl: string): string => {
  const parsed = new URL(webRedirectUrl);
  return `${NATIVE_SSO_SCHEME}://${NATIVE_SSO_HOST}${parsed.pathname}${parsed.search}${parsed.hash}`;
};

export const getAppPathFromNativeSsoUrl = (incomingUrl: string): string | undefined => {
  try {
    const parsed = new URL(incomingUrl);

    if (parsed.protocol !== `${NATIVE_SSO_SCHEME}:`) return undefined;
    if (parsed.host !== NATIVE_SSO_HOST) return undefined;

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return undefined;
  }
};
