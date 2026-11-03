import { createContext, useContext, useEffect, useState } from 'react';





}

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
