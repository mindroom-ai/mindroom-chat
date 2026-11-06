import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MatrixEvent, type Room } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRoomEvent } from './useRoomEvent';

vi.mock('../../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => ({}) }));
vi.mock('../../matrix/session/useSessionStore', () => ({ useActiveSession: () => undefined }));
vi.mock('./eventRepository', () => ({
  loadCachedRoomEvent: vi.fn(),
  loadCachedThreadEvent: vi.fn(),
}));

const ROOM_ID = '!harbor:example.org';

/** A thread reply the client holds, still encrypted: it arrived with the first sync. */
const encryptedReply = () =>
  new MatrixEvent({
    event_id: '$reply',
    room_id: ROOM_ID,
    sender: '@coordinator:example.org',
    origin_server_ts: 1,
    type: 'm.room.encrypted',
    content: {
      algorithm: 'm.megolm.v1.aes-sha2',
      ciphertext: 'sealed',
      'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
    },
  });

let renderer: ReturnType<typeof create> | undefined;
const client = new QueryClient();

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  client.clear();
});

describe('useRoomEvent with a copy the client holds', () => {
  it('shows the copy again once it is decrypted', async () => {
    const reply = encryptedReply();
    const room = { roomId: ROOM_ID, findEventById: () => reply } as unknown as Room;
    const seen: string[] = [];
    function Probe() {
      const event = useRoomEvent(room, '$reply');
      seen.push(event?.getType() ?? 'none');
      return null;
    }
    act(() => {
      renderer = create(
        React.createElement(QueryClientProvider, { client }, React.createElement(Probe))
      );
    });
    expect(seen.at(-1)).toBe('m.room.encrypted');

    const crypto = {
      decryptEvent: vi.fn().mockResolvedValue({
        clearEvent: {
          type: 'm.room.message',
          content: { msgtype: 'm.text', body: 'Straddle carrier 12 is back in service.' },
        },
      }),
    } as unknown as Parameters<MatrixEvent['attemptDecryption']>[0];
    await act(async () => {
      await reply.attemptDecryption(crypto);
    });

    expect(seen.at(-1)).toBe('m.room.message');
  });

  it('shows the copy again once its newest edit is decrypted', async () => {
    const reply = new MatrixEvent({
      event_id: '$reply',
      room_id: ROOM_ID,
      sender: '@coordinator:example.org',
      origin_server_ts: 1,
      type: 'm.room.message',
      content: { msgtype: 'm.text', body: 'Straddle carrier 12 has a hydraulic leak.' },
    });
    const edit = new MatrixEvent({
      event_id: '$edit',
      room_id: ROOM_ID,
      sender: '@coordinator:example.org',
      origin_server_ts: 2,
      type: 'm.room.encrypted',
      content: {
        algorithm: 'm.megolm.v1.aes-sha2',
        ciphertext: 'sealed',
        'm.relates_to': { rel_type: 'm.replace', event_id: '$reply' },
      },
    });
    reply.makeReplaced(edit);
    const room = { roomId: ROOM_ID, findEventById: () => reply } as unknown as Room;
    const seen: unknown[] = [];
    function Probe() {
      seen.push(useRoomEvent(room, '$reply')?.getContent().body);
      return null;
    }
    act(() => {
      renderer = create(
        React.createElement(QueryClientProvider, { client }, React.createElement(Probe))
      );
    });
    expect(seen.at(-1)).toBeUndefined();

    const crypto = {
      decryptEvent: vi.fn().mockResolvedValue({
        clearEvent: {
          type: 'm.room.message',
          content: {
            msgtype: 'm.text',
            body: '* Straddle carrier 12 is back in service.',
            'm.new_content': { msgtype: 'm.text', body: 'Straddle carrier 12 is back in service.' },
            'm.relates_to': { rel_type: 'm.replace', event_id: '$reply' },
          },
        },
      }),
    } as unknown as Parameters<MatrixEvent['attemptDecryption']>[0];
    await act(async () => {
      await edit.attemptDecryption(crypto);
    });

    expect(seen.at(-1)).toBe('Straddle carrier 12 is back in service.');
  });
});
