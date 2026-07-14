import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthLayout } from './AuthLayout';

const mocks = vi.hoisted(() => ({
  allowCloudflareAccessForHomeserver: vi.fn(),
  authFlowsLoader: vi.fn(),
  autoDiscovery: vi.fn(),
  navigate: vi.fn(),
  probeCloudflareAccessHomeserver: vi.fn(),
  specVersionsLoader: vi.fn(),
}));

vi.mock('folds', () => {
  const PassThrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children);

  return {
    Box: PassThrough,
    Button: PassThrough,
    Header: PassThrough,
    Scroll: PassThrough,
    Spinner: () => React.createElement('span', null, 'loading'),
    Text: PassThrough,
    color: {
      Critical: {
        Main: 'red',
      },
    },
  };
});

vi.mock('react-router-dom', () => ({
  Outlet: () => React.createElement('span', null, 'login-loader-ready'),
  useLocation: () => ({ hash: '', pathname: '/login/private.example.test', search: '' }),
  useNavigate: () => mocks.navigate,
  useParams: () => ({ server: 'private.example.test' }),
}));

vi.mock('./AuthFooter', () => ({
  AuthFooter: () => null,
}));

vi.mock('./styles.css', () => ({
  AuthCard: 'auth-card',
  AuthCardContent: 'auth-card-content',
  AuthHeader: 'auth-header',
  AuthLayout: 'auth-layout',
  AuthLayoutPersistentParticle: 'auth-layout-persistent-particle',
  AuthLogo: 'auth-logo',
}));

vi.mock('./ServerPicker', () => ({
  ServerPicker: () => null,
}));

vi.mock('./authRouteUtils', () => ({
  buildAuthRoutePath: () => '/login/private.example.test',
}));

vi.mock('./addAccount', () => ({
  resolveAddAccountReturnPath: () => undefined,
}));

vi.mock('../../hooks/useClientConfig', () => ({
  clientAllowedServer: () => true,
  clientDefaultServer: () => 'private.example.test',
  useClientConfig: () => ({
    allowCustomHomeservers: true,
    homeserverList: ['private.example.test'],
  }),
}));

vi.mock('../../cs-api', () => ({
  AutoDiscoveryAction: {
    FAIL_ERROR: 'FAIL_ERROR',
    FAIL_INSECURE: 'FAIL_INSECURE',
    FAIL_PROMPT: 'FAIL_PROMPT',
  },
  autoDiscovery: mocks.autoDiscovery,
}));

vi.mock('../../components/SpecVersionsLoader', () => ({
  SpecVersionsLoader: ({
    baseUrl,
    children,
  }: {
    baseUrl: string;
    children: (versions: { versions: string[] }) => React.ReactNode;
  }) => {
    mocks.specVersionsLoader(baseUrl);
    return children({ versions: ['v1'] });
  },
}));

vi.mock('../../hooks/useSpecVersions', () => ({
  SpecVersionsProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../hooks/useAutoDiscoveryInfo', () => ({
  AutoDiscoveryInfoProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../components/AuthFlowsLoader', () => ({
  AuthFlowsLoader: ({ children }: { children: (flows: object) => React.ReactNode }) => {
    mocks.authFlowsLoader();
    return children({});
  },
}));

vi.mock('../../hooks/useAuthFlows', () => ({
  AuthFlowsProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../hooks/useAuthServer', () => ({
  AuthServerProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../hooks/useSessionStore', () => ({
  useActiveSession: () => undefined,
}));

vi.mock('../../mindroom/auth/authUi', () => ({
  MINDROOM_AUTH_BRANDING: {
    appName: 'Chat',
    logoAlt: 'Chat',
    logoSrc: '/logo.svg',
  },
}));

vi.mock('../../components/particle-background', () => ({
  ParticleBackgroundSurface: () => null,
  usePersistentParticleBackground: () => false,
}));

vi.mock('../../mindroom/native/cloudflareAccess', () => ({
  allowCloudflareAccessForHomeserver: mocks.allowCloudflareAccessForHomeserver,
  CLOUDFLARE_ACCESS_AUTHENTICATED_EVENT: 'cloudflare-access-authenticated',
  probeCloudflareAccessHomeserver: mocks.probeCloudflareAccessHomeserver,
}));

const flushAsyncState = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const hasText = (renderer: ReactTestRenderer, text: string): boolean =>
  JSON.stringify(renderer.toJSON()).includes(text);

describe('AuthLayout organization authentication recovery', () => {
  let renderer: ReactTestRenderer | undefined;
  let originalWindow: typeof globalThis.window | undefined;

  afterEach(async () => {
    if (renderer) {
      await act(async () => renderer?.unmount());
    }
    renderer = undefined;
    mocks.allowCloudflareAccessForHomeserver.mockReset();
    mocks.authFlowsLoader.mockReset();
    mocks.autoDiscovery.mockReset();
    mocks.navigate.mockReset();
    mocks.probeCloudflareAccessHomeserver.mockReset();
    mocks.specVersionsLoader.mockReset();

    if (originalWindow) {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: originalWindow,
      });
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  });

  const discoveryFailure = () => [
    {
      action: 'FAIL_PROMPT',
      host: 'https://private.example.test',
    },
    undefined,
  ];

  const renderLayout = async () => {
    originalWindow = globalThis.window;
    const eventTarget = new EventTarget();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: eventTarget,
    });

    await act(async () => {
      renderer = create(<AuthLayout />);
      await flushAsyncState();
    });
    return eventTarget;
  };

  it('uses the direct host when native probing confirms Access protection', async () => {
    mocks.autoDiscovery.mockResolvedValue(discoveryFailure());
    mocks.probeCloudflareAccessHomeserver.mockResolvedValue('https://private.example.test');

    await renderLayout();

    expect(mocks.probeCloudflareAccessHomeserver).toHaveBeenCalledWith('private.example.test');
    expect(mocks.specVersionsLoader).toHaveBeenCalledWith('https://private.example.test');
    expect(mocks.authFlowsLoader).toHaveBeenCalledTimes(1);
    expect(hasText(renderer!, 'login-loader-ready')).toBe(true);
  });

  it('preserves the ordinary discovery error when the direct host is not Access-protected', async () => {
    mocks.autoDiscovery.mockResolvedValue(discoveryFailure());
    mocks.probeCloudflareAccessHomeserver.mockResolvedValue(undefined);

    await renderLayout();

    expect(mocks.autoDiscovery).toHaveBeenCalledTimes(1);
    expect(mocks.specVersionsLoader).not.toHaveBeenCalled();
    expect(hasText(renderer!, 'Failed to connect. Server configuration found with')).toBe(true);
  });

  it('retries protected discovery after cancelled authentication later succeeds', async () => {
    mocks.autoDiscovery.mockResolvedValue(discoveryFailure());
    mocks.probeCloudflareAccessHomeserver
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('https://private.example.test');

    const eventTarget = await renderLayout();

    expect(mocks.autoDiscovery).toHaveBeenCalledTimes(1);
    expect(mocks.specVersionsLoader).not.toHaveBeenCalled();
    expect(hasText(renderer!, 'Failed to connect. Server configuration found with')).toBe(true);

    await act(async () => {
      eventTarget.dispatchEvent(new Event('cloudflare-access-authenticated'));
      await flushAsyncState();
    });

    expect(mocks.autoDiscovery).toHaveBeenCalledTimes(2);
    expect(mocks.probeCloudflareAccessHomeserver).toHaveBeenCalledTimes(2);
    expect(mocks.specVersionsLoader).toHaveBeenCalledWith('https://private.example.test');
    expect(mocks.authFlowsLoader).toHaveBeenCalledTimes(1);
    expect(hasText(renderer!, 'login-loader-ready')).toBe(true);
  });
});
