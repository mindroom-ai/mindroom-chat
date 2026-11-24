import { ReactNode, createContext, useContext, useMemo } from 'react';

type ClientStartupContextValue = {
  hasCompletedInitialSync: boolean;
};

const ClientStartupContext = createContext<ClientStartupContextValue>({
  hasCompletedInitialSync: false,
});

export const ClientStartupProvider = ({
  hasCompletedInitialSync,
  children,
}: ClientStartupContextValue & { children: ReactNode }) => {
  const value = useMemo(() => ({ hasCompletedInitialSync }), [hasCompletedInitialSync]);

  return <ClientStartupContext value={value}>{children}</ClientStartupContext>;
};

export const useClientStartupContext = (): ClientStartupContextValue =>
  useContext(ClientStartupContext);
