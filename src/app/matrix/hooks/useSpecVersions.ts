import { createContext, useContext } from 'react';
import type { SpecVersions } from '../cs-api';

/**
 * The homeserver's answer to `GET /_matrix/client/versions` (Matrix client-server API,
 * "Getting the versions of the specification supported by the server"), loaded once per session
 * by `SpecVersions` and shared with every hook that gates a feature on a spec version.
 */
const serverVersionsContext = createContext<SpecVersions | undefined>(undefined);

const NO_VERSIONS: SpecVersions = { versions: [] };

export const SpecVersionsProvider = serverVersionsContext.Provider;

/** Reads the loaded versions; a component outside `SpecVersionsProvider` sees no versions. */
export function useSpecVersions(): SpecVersions {
  return useContext(serverVersionsContext) ?? NO_VERSIONS;
}
