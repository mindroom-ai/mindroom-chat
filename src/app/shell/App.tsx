import { ReactNode, useEffect, useLayoutEffect, useState } from 'react';
import { Provider as JotaiProvider, useSetAtom } from 'jotai';
import { RouterProvider } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClientConfigLoader } from '../config/ClientConfigLoader';
import { ClientConfigProvider, type ClientConfig } from '../config/useClientConfig';
import { ScreenSizeProvider, useScreenSize } from '../lib/hooks/useScreenSize';
import { useActiveSession } from '../matrix/session/useSessionStore';
import {
  ThemeContextProvider,
  deploymentDefaultTheme,
  deploymentThemeAtom,
  useSignedOutTheme,
  useTheme,
} from '../theme/useTheme';
import { usePageZoom } from '../theme/usePageZoom';
import { useMobileKeyboardViewportFix } from '../native/useMobileKeyboardViewportFix';
import { appJotaiStore, setImperativeJotaiStore } from '../lib/state/jotaiStore';
import { applyAppTheme } from '../theme/appliedTheme';
import { NoticeLayout } from '../notifications/notices/NoticeBanners';
import { NewVersionNotice } from './NewVersionNotice';
import { AppErrorBoundary } from './AppErrorBoundary';
import { installOverlayFocus } from '../lib/overlayFocus';
import { useErrorReporting } from '../bug-reports/error-reporting/errorReporting';
import { ConfigConfigError, ConfigConfigLoading } from './ConfigConfig';
import { createRouter } from './Router';
import { PersistentParticleBackgroundProvider } from '../ui/particle-background/PersistentParticleBackground';
import { deploymentBranding } from '../ui/branding/deploymentBranding';
import '../ui/particle-background/particleCanvasReveal.css';

const queryClient = new QueryClient();
setImperativeJotaiStore(appJotaiStore);

/**
 * Applies the theme to the document whenever it changes (a new setting, the system switching
 * between light and dark, signing in or out) and provides it to the app. Signed out, the app
 * shows the deployment's default theme or follows the system, as the startup theme does; signed
 * in, it uses the theme settings.
 */
export function AppTheme({ children }: { children: ReactNode }) {
  const signedIn = !!useActiveSession();
  const settingsTheme = useTheme();
  const signedOutTheme = useSignedOutTheme();
  const theme = signedIn ? settingsTheme : signedOutTheme;
  usePageZoom();

  useEffect(() => {
    applyAppTheme(theme);
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
  // A configured brand names the browser tab too. A layout effect, so the unread count's title
  // (UnreadTitle, a passive effect) starts from it.
  const { pageTitle } = deploymentBranding(clientConfig);
  useLayoutEffect(() => {
    if (pageTitle !== undefined) document.title = pageTitle;
  }, [pageTitle]);
  // The configured default theme, which the theme above had from the configuration loaded last.
  const setDeploymentTheme = useSetAtom(deploymentThemeAtom);
  const deploymentTheme = deploymentDefaultTheme(clientConfig);
  useLayoutEffect(() => {
    setDeploymentTheme(deploymentTheme);
  }, [setDeploymentTheme, deploymentTheme]);
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
          {/* One particle renderer for the sign-in pages and every splash in turn: a new one per
              screen would start black each time and restart its animation. */}
          <PersistentParticleBackgroundProvider>
            {/* Operator notices sit above every screen, sign-in and config loading included. */}
            <NoticeLayout>
              {/* After a deployment, over every screen: a new version is available. A broken notice
                  must never take the app down with it. */}
              <ErrorBoundary fallback={null}>
                <NewVersionNotice />
              </ErrorBoundary>
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
          </PersistentParticleBackgroundProvider>
        </QueryClientProvider>
      </AppTheme>
    </JotaiProvider>
  );
}

export default App;
