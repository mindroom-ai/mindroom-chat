/**
 * ISSUE-207 P3.1: React context wrapper for SyncEngine.
 *
 * The engine itself is framework-agnostic. This module exposes it to
 * the React tree so consumers (Commit 5 rewires the fetch controllers
 * onto engine.persist through this hook) don't have to prop-drill.
 * ClientRoot.tsx creates the engine, calls start(), then wraps the
 * ready content with `<SyncEngineProvider>` next to the
 * MatrixClientProvider.
 */

import React, { createContext, useContext } from 'react';
import type { SyncEngine } from './types';

const SyncEngineContext = createContext<SyncEngine | undefined>(undefined);

export type SyncEngineProviderProps = {
  engine: SyncEngine;
  children: React.ReactNode;
};

export const SyncEngineProvider = ({
  engine,
  children,
}: SyncEngineProviderProps): React.ReactElement => {
  return (
    <SyncEngineContext.Provider value={engine}>
      {children}
    </SyncEngineContext.Provider>
  );
};

export const useSyncEngine = (): SyncEngine => {
  const engine = useContext(SyncEngineContext);
  if (!engine) {
    throw new Error(
      'useSyncEngine must be used within a SyncEngineProvider (see ClientRoot.tsx)'
    );
  }
  return engine;
};
