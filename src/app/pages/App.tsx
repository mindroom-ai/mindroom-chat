import React, { useMemo } from 'react';
import { Provider as JotaiProvider } from 'jotai';
import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClientConfigLoader } from '../components/ClientConfigLoader';
import { ClientConfigProvider, type ClientConfig } from '../hooks/useClientConfig';
import { ScreenSizeProvider, useScreenSize } from '../hooks/useScreenSize';
import { appJotaiStore, setImperativeJotaiStore } from '../state/jotaiStore';
import { ConfigConfigError, ConfigConfigLoading } from './ConfigConfig';
import { createRouter } from './Router';

const queryClient = new QueryClient();
setImperativeJotaiStore(appJotaiStore);

function AppRouter({ clientConfig }: { clientConfig: ClientConfig }) {
  const screenSize = useScreenSize();
  // The router is created once per configuration; screen size changes reach pages by context.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const router = useMemo(() => createRouter(clientConfig, screenSize), [clientConfig]);
  return (
    <ScreenSizeProvider value={screenSize}>
      <RouterProvider router={router} />
    </ScreenSizeProvider>
  );
}

/** The app: client configuration, shared providers, and the router. */
function App() {
  return (
    <JotaiProvider store={appJotaiStore}>
      <QueryClientProvider client={queryClient}>
        <ClientConfigLoader
          fallback={() => <ConfigConfigLoading />}
          error={(error, retry, ignore, authenticate) => (
            <ConfigConfigError
              error={error}
              retry={retry}
              ignore={ignore}
              authenticate={authenticate}
            />
          )}
        >
          {(clientConfig) => (
            <ClientConfigProvider value={clientConfig}>
              <AppRouter clientConfig={clientConfig} />
            </ClientConfigProvider>
          )}
        </ClientConfigLoader>
      </QueryClientProvider>
    </JotaiProvider>
  );
}

export default App;
