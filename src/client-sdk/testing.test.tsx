// @vitest-environment jsdom
// `renderPluginComponent`'s stand-in client and side panel frame, as a plugin's test meets them:
// through the SDK only.
import { fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePanelFrame } from '@mindroom/client-sdk/core';
import { mxcUrlToHttp, useMatrixClient, useMediaAuthentication } from '@mindroom/client-sdk/matrix';
import { renderPluginComponent } from '@mindroom/client-sdk/testing';

/** An avatar as a plugin draws one: authenticated as the app asks, unless the test says. */
function Avatar({ authenticated }: { authenticated?: boolean }) {
  const client = useMatrixClient();
  const appAuthenticated = useMediaAuthentication();
  const src = mxcUrlToHttp(
    client,
    'mxc://example.org/avatar',
    authenticated ?? appAuthenticated,
    32,
    32,
    'crop'
  );
  return <img alt="Avatar" src={src ?? undefined} />;
}

/** A panel that draws its own frame, as a plugin draws one: a button that fills it. */
function Card() {
  const frame = usePanelFrame();
  if (!frame) return <p>No frame</p>;
  return (
    <button type="button" onClick={() => frame.setLayout('filled')}>
      {`Fill ${frame.label}, ${frame.layout}`}
    </button>
  );
}

describe('renderPluginComponent', () => {
  it("builds media URLs with the stand-in client, as the app's answer on authentication asks", async () => {
    // A test knows neither the homeserver's versions nor a service worker, so its media is the
    // unauthenticated kind.
    const view = await renderPluginComponent(<Avatar />, { id: 'media', plugin: {} });
    expect(view.getByRole('img', { name: 'Avatar' })).toHaveProperty(
      'src',
      'https://example.org/_matrix/media/v3/thumbnail/example.org/avatar?width=32&height=32&method=crop'
    );
  });

  it('builds authenticated media URLs with the stand-in client', async () => {
    const view = await renderPluginComponent(<Avatar authenticated />, {
      id: 'media',
      plugin: {},
    });
    expect(view.getByRole('img', { name: 'Avatar' })).toHaveProperty(
      'src',
      'https://example.org/_matrix/client/v1/media/thumbnail/example.org/avatar?width=32&height=32&method=crop&allow_redirect=true'
    );
  });

  it('gives a component the side panel frame the test gives, as the app gives a panel that draws its own', async () => {
    const setLayout = vi.fn();
    const view = await renderPluginComponent(<Card />, {
      id: 'card',
      plugin: {},
      frame: { label: 'Card', layout: 'beside', setLayout },
    });
    fireEvent.click(view.getByRole('button', { name: 'Fill Card, beside' }));
    expect(setLayout).toHaveBeenCalledWith('filled');
  });

  it('gives a component no side panel frame unless the test gives one', async () => {
    const view = await renderPluginComponent(<Card />, { id: 'card', plugin: {} });
    expect(view.container.textContent).toBe('No frame');
  });
});
