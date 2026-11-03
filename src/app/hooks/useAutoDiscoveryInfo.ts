import { createContext, useContext } from 'react';
import type { AutoDiscoveryInfo } from '../cs-api';

const AutoDiscoveryInfoContext = createContext<AutoDiscoveryInfo | null>(null);

export const AutoDiscoveryInfoProvider = AutoDiscoveryInfoContext.Provider;

/** The homeserver's `/.well-known/matrix/client` document. */
export function useAutoDiscoveryInfo(): AutoDiscoveryInfo {
  const info = useContext(AutoDiscoveryInfoContext);
  if (!info) throw new Error('Auto discovery info is not provided!');
  return info;
}
