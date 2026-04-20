import React, { ReactNode, createContext, useContext } from 'react';

type ClientStartupContextValue = {
  hasCompletedInitialSync: boolean;
};

const ClientStartupContext = createContext<ClientStartupContextValue>({
  hasCompletedInitialSync: false,
});

export const ClientStartupProvider = ({
  hasCompletedInitialSync,
  children,
}: ClientStartupContextValue & { children: ReactNode }) => (
  <ClientStartupContext.Provider value={{ hasCompletedInitialSync }}>
    {children}
  </ClientStartupContext.Provider>
);

export const useClientStartupContext = (): ClientStartupContextValue =>
  useContext(ClientStartupContext);
