// Platform checks from the browser's own navigator fields; no user agent database.

type NavigatorLike = Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> & {
  userAgentData?: { platform?: string; mobile?: boolean };
};

const getNavigator = (): NavigatorLike | undefined =>
  typeof navigator === 'undefined' ? undefined : (navigator as NavigatorLike);

const platformName = (nav: NavigatorLike): string =>
  nav.userAgentData?.platform || nav.platform || '';

/** iPhone, iPod and iPad, including iPadOS, which reports itself as a Mac with a touch screen. */
export const isIOS = (): boolean => {
  const nav = getNavigator();
  if (!nav) return false;
  if (/iPhone|iPad|iPod/i.test(nav.userAgent) || /iPhone|iPad|iPod/i.test(platformName(nav))) {
    return true;
  }
  return /Mac/i.test(platformName(nav)) && (nav.maxTouchPoints ?? 0) > 1;
};

export const isMacOS = (): boolean => {
  const nav = getNavigator();
  if (!nav || isIOS()) return false;
  return /Mac/i.test(platformName(nav)) || /Macintosh|Mac OS X/i.test(nav.userAgent);
};

export const isAndroid = (): boolean => {
  const nav = getNavigator();
  return !!nav && /Android/i.test(nav.userAgent);
};

/** Phones and tablets, where an on-screen keyboard and touch input are expected. */
export const mobileOrTablet = (): boolean => {
  const nav = getNavigator();
  if (!nav) return false;
  if (nav.userAgentData?.mobile) return true;
  return isIOS() || isAndroid() || /Mobi|Tablet|Silk|Kindle/i.test(nav.userAgent);
};

export const isSafari = (): boolean => {
  const nav = getNavigator();
  return !!nav && /AppleWebKit\//.test(nav.userAgent) && !/Chrome\/|Chromium\//.test(nav.userAgent);
};

export const isFirefox = (): boolean => {
  const nav = getNavigator();
  return !!nav && /Firefox\//.test(nav.userAgent);
};
