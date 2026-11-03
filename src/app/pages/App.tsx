import React, { ReactNode, useEffect, useMemo } from 'react';
import { Provider as JotaiProvider } from 'jotai';
import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClientConfigLoader } from '../components/ClientConfigLoader';
import { ClientConfigProvider, type ClientConfig } from '../hooks/useClientConfig';
import { ScreenSizeProvider, useScreenSize } from '../hooks/useScreenSize';
import { useActiveSession } from '../hooks/useSessionStore';
import { ThemeContextProvider, useSystemDefaultTheme, useTheme } from '../hooks/useTheme';
import { appJotaiStore, setImperativeJotaiStore } from '../state/jotaiStore';
import { applyThemeToDom } from '../theme/themeBootstrap';
import { ConfigConfigError, ConfigConfigLoading } from './ConfigConfig';
import { createRouter } from './Router';

const queryClient = new QueryClient();
setImperativeJotaiStore(appJotaiStore);

/**
 * Applies the theme to the document whenever it changes (a new setting, the system switching
 * between light and dark, signing in or out) and provides it to the app. Signed out, the app
 * follows the system as the startup theme does; signed in, it uses the theme settings.
 */
export function AppTheme({ children }: { children: ReactNode }) {
  const signedIn = !!useActiveSession();
  const settingsTheme = useTheme();
  const systemTheme = useSystemDefaultTheme();
  const theme = signedIn ? settingsTheme : systemTheme;

  useEffect(() => {
    applyThemeToDom(theme);
  }, [theme]);

  return <ThemeContextProvider value={theme}>{children}</ThemeContextProvider>;
}

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
      <AppTheme>
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
      </AppTheme>
    </JotaiProvider>
  );
}

export default App;
