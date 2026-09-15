import { createContext, useContext } from 'react';

const SurfaceContext = createContext(false);

export const SurfaceProvider = SurfaceContext.Provider;

/** Whether layout children should reveal an enclosing material. */
export const useSurfaceContext = (): boolean => useContext(SurfaceContext);
