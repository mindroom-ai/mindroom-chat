import { ReactNode, useEffect, useMemo } from 'react';
import { Provider as JotaiProvider } from 'jotai';
import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClientConfigLoader } from '../components/ClientConfigLoader';
import { ClientConfigProvider, type ClientConfig } from '../hooks/useClientConfig';
import { ScreenSizeProvider, useScreenSize } from '../hooks/useScreenSize';
import { useActiveSession } from '../hooks/useSessionStore';
import { ThemeContextProvider, useSystemDefaultTheme, useTheme } from '../hooks/useTheme';
import { usePageZoom } from '../hooks/usePageZoom';
import { useMobileKeyboardViewportFix } from '../hooks/useMobileKeyboardViewportFix';
import { appJotaiStore, setImperativeJotaiStore } from '../state/jotaiStore';
import { applyThemeToDom } from '../theme/themeBootstrap';
import { NoticeLayout } from '../mindroom/notices/NoticeBanners';
import { NewVersionNotice } from '../components/app-update/NewVersionNotice';
import { AppErrorBoundary } from '../components/app-error/AppErrorBoundary';
import { installOverlayFocus } from '../utils/overlayFocus';
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
  // The router is created once per configuration; screen size changes reach pages by context.
  const router = useMemo(() => createRouter(clientConfig), [clientConfig]);
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
