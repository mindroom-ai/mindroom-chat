// @vitest-environment jsdom

import { MatrixClient, Room } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { installElementCallDiscoveryBridge } from '../../../../scripts/element-call-background.mjs';
import { CallEmbed } from './CallEmbed';
import { ElementCallIntent } from './types';

describe('Element Call background', () => {
  it('layers the transparent iframe above the host animation', () => {
    const iframe = CallEmbed.getIframe('https://example.org/call');

    expect(iframe.style.backgroundColor).toBe('transparent');
    expect(iframe.style.position).toBe('relative');
    expect(iframe.style.zIndex).toBe('1');
  });

  it('keeps the configured call endpoint in the iframe fragment', () => {
    const mx = {
      baseUrl: 'https://matrix.example.com',
      getSafeUserId: () => '@alice:example.com',
      getDeviceId: () => 'DEVICE',
    } as unknown as MatrixClient;
    const room = {
      roomId: '!room:example.com',
      hasEncryptionStateEvent: () => true,
      isCallRoom: () => true,
    } as unknown as Room;

    const widget = CallEmbed.getWidget(
      mx,
      room,
      ElementCallIntent.JoinExisting,
      'dark',
      'https://rtc.example.com/jwt'
    );
    const widgetUrl = new URL(widget.templateUrl);
    const fragment = new URLSearchParams(widgetUrl.hash.slice(1));

    expect(widgetUrl.searchParams.has('livekitServiceUrl')).toBe(false);
    expect(fragment.get('livekitServiceUrl')).toBe('https://rtc.example.com/jwt');
  });

  it('serves configured discovery to Element Call without a network request', async () => {
    const networkResponse = new Response('{}');
    const originalFetch = vi.fn(async () => networkResponse);
    const bridgeWindow = {
      location: {
        href:
          'https://app.example.com/public/element-call/index.html' +
          '?baseUrl=https%3A%2F%2Fmatrix.example.com&userId=%40alice%3Aexample.com' +
          '#livekitServiceUrl=https%3A%2F%2Frtc.example.com%2Fjwt',
      },
      fetch: originalFetch,
    };
    installElementCallDiscoveryBridge(bridgeWindow, URL, URLSearchParams, Response);

    const response = await bridgeWindow.fetch('https://example.com/.well-known/matrix/client');
    expect(await response.json()).toEqual({
      'm.homeserver': { base_url: 'https://matrix.example.com' },
      'org.matrix.msc4143.rtc_foci': [
        {
          type: 'livekit',
          livekit_service_url: 'https://rtc.example.com/jwt',
        },
      ],
    });
    expect(originalFetch).not.toHaveBeenCalled();

    await bridgeWindow.fetch('https://matrix.example.com/_matrix/client/versions');
    expect(originalFetch).toHaveBeenCalledOnce();
  });
});
