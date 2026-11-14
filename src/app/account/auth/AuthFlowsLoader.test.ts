import React, { type ComponentProps, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import { Text } from 'folds';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { AuthFlowsLoader } from './AuthFlowsLoader';
import { AutoDiscoveryInfoProvider } from '../../matrix/hooks/useAutoDiscoveryInfo';
import { createMatrixClient } from '../../matrix/client/matrixClientFactory';

// createElement types children as ReactNode and wants `children` in props, so the loader's
// element is built here, with its render function passed through one cast.
const loaderElement = (
  props: Omit<ComponentProps<typeof AuthFlowsLoader>, 'children'> | null,
  render: ComponentProps<typeof AuthFlowsLoader>['children']
) =>
  React.createElement(
    AuthFlowsLoader,
    props as ComponentProps<typeof AuthFlowsLoader>,
    render as unknown as ReactNode
  );

vi.mock('../../matrix/client/matrixClientFactory', () => ({
  createMatrixClient: vi.fn(),
}));

const flushPromises = () =>
  new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

describe('AuthFlowsLoader', () => {
  it('updates the failed authentication screen when language changes without retrying', async () => {
    const language = createInstance();
    await language.init({
      lng: 'en',
      fallbackLng: 'en',
      react: { useSuspense: false },
      resources: {
        en: { translation: { sharedUi: { authFlowsLoader: { retry: 'Retry' } } } },
        de: { translation: { sharedUi: { authFlowsLoader: { retry: 'Erneut versuchen' } } } },
      },
    });
    const loginFlows = vi.fn().mockResolvedValue(undefined);
    vi.mocked(createMatrixClient).mockReturnValue({
      loginFlows,
      registerRequest: vi.fn().mockRejectedValue({ httpStatus: 400 }),
    } as unknown as ReturnType<typeof createMatrixClient>);
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        React.createElement(
          I18nextProvider,
          { i18n: language },
          React.createElement(
            AutoDiscoveryInfoProvider,
            { value: { 'm.homeserver': { base_url: 'https://example.com' } } },
            loaderElement(null, () => null)
          )
        )
      );
      await flushPromises();
    });
    expect(JSON.stringify(renderer!.toJSON())).toContain('Retry');
    await act(async () => {
      await language.changeLanguage('de');
    });
    expect(JSON.stringify(renderer!.toJSON())).toContain('Erneut versuchen');
    expect(loginFlows).toHaveBeenCalledTimes(1);
    act(() => renderer!.unmount());
  });

  it('renders a retry state and retries without throwing', async () => {
    const loginFlows = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ flows: [] });
    const registerRequest = vi.fn().mockRejectedValue({ httpStatus: 400 });

    const createMatrixClientMock = vi.mocked(createMatrixClient);
    createMatrixClientMock.mockReturnValue({
      loginFlows,
      registerRequest,
    } as unknown as ReturnType<typeof createMatrixClient>);

    // Inside act, the mount effects run before the test goes on. After a bare create() React's
    // scheduler ran them in a later task, and on a busy machine that came after the act below.
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        React.createElement(
          AutoDiscoveryInfoProvider,
          { value: { 'm.homeserver': { base_url: 'https://example.com' } } },
          loaderElement(
            {
              fallback: () => React.createElement(Text, null, 'Loading'),
              error: () => React.createElement(Text, null, 'Error'),
            },
            () => React.createElement(Text, null, 'Loaded')
          )
        )
      );
      await flushPromises();
    });

    expect(loginFlows).toHaveBeenCalledTimes(1);

    const retryButton = renderer.root.find(
      (node) => node.props?.onClick && node.props?.children === 'Retry'
    );

    await act(async () => {
      retryButton.props.onClick();
      await flushPromises();
    });

    expect(loginFlows).toHaveBeenCalledTimes(2);
    expect(renderer.root.findByProps({ children: 'Loaded' })).toBeTruthy();
  });
});
