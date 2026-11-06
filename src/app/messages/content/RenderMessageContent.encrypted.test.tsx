import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MatrixEvent, type MatrixClient } from 'matrix-js-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import { ClientConfigProvider } from '../../config/useClientConfig';
import { RenderMessageContent } from './RenderMessageContent';

// Regression (L5-F009): a message the client had not decrypted yet read "Unsupported message", as
// if its type were unknown; it is waiting for its key.

describe('RenderMessageContent for an encrypted message', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it('says it is not decrypted yet, not that it is unsupported', () => {
    const content = { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'opaque' };
    const mEvent = new MatrixEvent({
      type: 'm.room.encrypted',
      room_id: '!room:example.org',
      event_id: '$reply',
      sender: '@mindroom_helper:example.org',
      origin_server_ts: 1,
      content,
    });
    const mx = { getUserId: () => '@reader:example.org' } as unknown as MatrixClient;
    act(() => {
      renderer = create(
        <MatrixClientProvider value={mx}>
          <ClientConfigProvider value={{}}>
            <RenderMessageContent
              mEvent={mEvent}
              displayName="Helper"
              msgType=""
              eventType="m.room.encrypted"
              ts={1}
              getContent={(() => content) as never}
              urlPreview={false}
              htmlReactParserOptions={{}}
              linkifyOpts={{}}
            />
          </ClientConfigProvider>
        </MatrixClientProvider>
      );
    });
    const text = JSON.stringify(renderer!.toJSON());
    expect(text).toContain('This message is not decrypted yet');
    expect(text).not.toContain('Unsupported message');
  });
});
