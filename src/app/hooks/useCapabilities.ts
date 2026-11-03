import { createContext, useContext } from 'react';
import type { Capabilities } from 'matrix-js-sdk';

/**
 * The homeserver's `GET /_matrix/client/v3/capabilities` answer (Matrix client-server API,
 * "Capabilities negotiation"), loaded with the other server configuration by `ClientRoot`.
 */
const serverCapabilitiesContext = createContext<Capabilities | undefined>(undefined);

const NO_CAPABILITIES: Capabilities = {};

export const CapabilitiesProvider = serverCapabilitiesContext.Provider;

/** The loaded capabilities; outside `CapabilitiesProvider`, none are known. */
export function useCapabilities(): Capabilities {
  return useContext(serverCapabilitiesContext) ?? NO_CAPABILITIES;
}
