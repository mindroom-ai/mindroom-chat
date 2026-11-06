import { ReactNode, useEffect, useState } from 'react';
import { Provider as JotaiProvider } from 'jotai';
import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClientConfigLoader } from '../config/ClientConfigLoader';
import { ClientConfigProvider, type ClientConfig } from '../config/useClientConfig';
import { ScreenSizeProvider, useScreenSize } from '../lib/hooks/useScreenSize';
import { useActiveSession } from '../matrix/session/useSessionStore';
import { ThemeContextProvider, useSystemDefaultTheme, useTheme } from '../theme/useTheme';
import { usePageZoom } from '../theme/usePageZoom';
import { useMobileKeyboardViewportFix } from '../native/useMobileKeyboardViewportFix';
import { appJotaiStore, setImperativeJotaiStore } from '../lib/state/jotaiStore';
import { applyThemeToDom } from '../theme/themeBootstrap';
import { NoticeLayout } from '../notifications/notices/NoticeBanners';
import { NewVersionNotice } from './NewVersionNotice';
import { AppErrorBoundary } from './AppErrorBoundary';
import { installOverlayFocus } from '../lib/overlayFocus';
import { useErrorReporting } from '../bug-reports/error-reporting/errorReporting';
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
  usePageZoom();

  useEffect(() => {
    applyThemeToDom(theme);
  }, [theme]);

  return <ThemeContextProvider value={theme}>{children}</ThemeContextProvider>;
}

function AppRouter({ clientConfig }: { clientConfig: ClientConfig }) {
  const screenSize = useScreenSize();
  // One router while the app is mounted: a refreshed configuration replaces this one only when it
  // routes the same (ClientConfigLoader), so pages keep their state. Screen size reaches pages by context.
  const [router] = useState(() => createRouter(clientConfig));
  // Error reports, when the configuration names a collector, follow the router's pages.
  useErrorReporting(clientConfig, router);
  return (
    <ScreenSizeProvider value={screenSize}>
      <RouterProvider router={router} />
    </ScreenSizeProvider>
  );
}

/** The app: client configuration, shared providers, and the router. */
function App() {
  // Phones that pan only the visual viewport for the keyboard get #root sized to what is visible.
  useMobileKeyboardViewportFix();
  // Menus and dialogs opened from the keyboard take focus, and give it back when they close.
  useEffect(() => installOverlayFocus(document), []);
  return (
    <JotaiProvider store={appJotaiStore}>
      <AppTheme>
        <QueryClientProvider client={queryClient}>
          {/* After a deployment, above every screen: a new version is available. */}
          <NewVersionNotice />
          {/* Operator notices sit above every screen, sign-in and config loading included. */}
          <NoticeLayout>
            {/* A screen that fails to render shows what happened and Reload, never a blank page. */}
            <AppErrorBoundary>
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
            </AppErrorBoundary>
          </NoticeLayout>
        </QueryClientProvider>
      </AppTheme>
    </JotaiProvider>
  );
}

export default App;
