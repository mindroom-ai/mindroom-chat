// @vitest-environment jsdom
// `renderPluginComponent`'s stand-in client, as a plugin's test meets it: through the SDK only.
import { describe, expect, it } from 'vitest';
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

describe('renderPluginComponent', () => {
  it("builds media URLs with the stand-in client, as the app's answer on authentication asks", async () => {
    // jsdom has no service worker to add the access token, so the app asks the legacy endpoints.
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
});
