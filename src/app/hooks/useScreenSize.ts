import { createContext, useContext, useEffect, useState } from 'react';

/** Layout classes the app switches between; the values are what tests and logs see. */
export type ScreenSize = 'Desktop' | 'Mobile' | 'Tablet';

// Each member is typed as the whole union, so a variable initialized with one member (a default
// parameter, say) still accepts the others.
export const ScreenSize: Readonly<Record<ScreenSize, ScreenSize>> = {
  Desktop: 'Desktop',
  Mobile: 'Mobile',
  Tablet: 'Tablet',
};

const MOBILE_MAX_WIDTH = 750;
const TABLET_MAX_WIDTH = 1124;

/** Mobile up to 750px wide, Tablet up to 1124px, Desktop beyond. */
export const getScreenSize = (width: number): ScreenSize => {
  if (width > TABLET_MAX_WIDTH) return ScreenSize.Desktop;
  if (width > MOBILE_MAX_WIDTH) return ScreenSize.Tablet;
  return ScreenSize.Mobile;
};

const readScreenSize = (): ScreenSize =>
  getScreenSize(typeof window === 'undefined' ? TABLET_MAX_WIDTH + 1 : window.innerWidth);

/** The size class of the window, following resizes. */
export const useScreenSize = (): ScreenSize => {
  const [screenSize, setScreenSize] = useState(readScreenSize);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleResize = () => setScreenSize(readScreenSize());
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return screenSize;
};

// The app root measures once with `useScreenSize` and hands the result down, so components read
// it from context instead of each adding a resize listener. Without a provider they get Desktop.
const ScreenSizeContext = createContext<ScreenSize>(ScreenSize.Desktop);

export const ScreenSizeProvider = ScreenSizeContext.Provider;

/** The size class provided by the nearest `ScreenSizeProvider`. */
export const useScreenSizeContext = (): ScreenSize => useContext(ScreenSizeContext);
