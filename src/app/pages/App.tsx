import React from 'react';
import { Provider as JotaiProvider } from 'jotai';
import { OverlayContainerProvider, PopOutContainerProvider, TooltipContainerProvider } from 'folds';
import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ClientConfigLoader } from '../components/ClientConfigLoader';
import { ClientConfigProvider } from '../hooks/useClientConfig';
import { ConfigConfigError, ConfigConfigLoading } from './ConfigConfig';
import { FeatureCheck } from './FeatureCheck';
import { createRouter } from './Router';
import { ScreenSizeProvider, useScreenSize } from '../hooks/useScreenSize';
import { useCompositionEndTracking } from '../hooks/useComposingCheck';
import { appJotaiStore, setImperativeJotaiStore } from '../state/jotaiStore';
import { ReactQueryDevtoolsToggle } from '../components/ReactQueryDevtoolsToggle';
import { PersistentParticleBackgroundProvider } from '../components/particle-background';
import { CloudflareAccessReauthentication } from '../mindroom/native/CloudflareAccessReauthentication';

const queryClient = new QueryClient();

function App() {
  const screenSize = useScreenSize();
  useCompositionEndTracking();

  React.useEffect(() => setImperativeJotaiStore(appJotaiStore), []);

  const portalContainer = document.getElementById('portalContainer') ?? undefined;

  return (
    <PersistentParticleBackgroundProvider>
      <TooltipContainerProvider value={portalContainer}>
        <PopOutContainerProvider value={portalContainer}>
          <OverlayContainerProvider value={portalContainer}>
            <CloudflareAccessReauthentication />
            <ScreenSizeProvider value={screenSize}>
              <FeatureCheck>
                <ClientConfigLoader
                  fallback={() => <ConfigConfigLoading />}
                  error={(err, retry, ignore) => (
                    <ConfigConfigError error={err} retry={retry} ignore={ignore} />
                  )}
                >
                  {(clientConfig) => (
                    <ClientConfigProvider value={clientConfig}>
                      <QueryClientProvider client={queryClient}>
                        <JotaiProvider store={appJotaiStore}>
                          <RouterProvider
                            router={createRouter(clientConfig, screenSize)}
                            fallbackElement={<ConfigConfigLoading />}
                          />
                        </JotaiProvider>
                        <ReactQueryDevtoolsToggle />
                      </QueryClientProvider>
                    </ClientConfigProvider>
                  )}
                </ClientConfigLoader>
              </FeatureCheck>
            </ScreenSizeProvider>
          </OverlayContainerProvider>
        </PopOutContainerProvider>
      </TooltipContainerProvider>
    </PersistentParticleBackgroundProvider>
  );
}

export default App;
