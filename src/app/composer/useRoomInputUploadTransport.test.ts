import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createStore } from 'jotai';
import { EventStatus } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRoomInputUploadTransport } from './useRoomInputUploadTransport';

// The composer extensions pull in editor styles; a room-level voice message has no relation.
vi.mock('./RoomInputExtensions', () => ({
  getRoomInputVoiceUploadRelation: () => undefined,
}));

let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

describe('useRoomInputUploadTransport voice sends', () => {
  it('drops the unsent echo of a failed voice message that the recorder keeps', async () => {
    const localEvents = new Map<string, { status: EventStatus }>();
    const failure = new Error('voice send failed');
    const mx = {
      makeTxnId: () => 'txn-voice',
      sendMessage: vi.fn(async (_roomId: string, _content: unknown, txnId: string) => {
        localEvents.set(txnId, { status: EventStatus.NOT_SENT });
        throw failure;
      }),
      cancelPendingEvent: vi.fn(),
    };
    const room = {
      roomId: '!room:example.org',
      getEventForTxnId: (txnId: string) => localEvents.get(txnId),
    };
    let transport!: ReturnType<typeof useRoomInputUploadTransport>;
    const Harness = () => {
      transport = useRoomInputUploadTransport(mx as never, createStore(), room as never);
      return null;
    };
    act(() => {
      renderer = create(React.createElement(Harness));
    });
    const file = new File(['voice'], 'voice.txt', { type: 'text/plain' });

    await expect(
      transport.sendVoiceItem(
        {
          ownerSessionId: '@alice:example.org',
          roomId: room.roomId,
          room: room as never,
          threadId: undefined,
          replyDraft: undefined,
          threadingEnabled: true,
          signalBridgedRoom: false,
        },
        { file, originalFile: file, encInfo: undefined, metadata: { markedAsSpoiler: false } },
        'mxc://example.org/voice'
      )
    ).rejects.toBe(failure);

    expect(mx.sendMessage.mock.calls[0]![2]).toBe('txn-voice');
    expect(mx.cancelPendingEvent).toHaveBeenCalledWith(localEvents.get('txn-voice'));
  });

  it("sends every attempt under the recording's transaction ID, and takes only an event ID for sent", async () => {
    const localEvents = new Map<string, { status: EventStatus }>();
    const responses: Array<() => { event_id?: string }> = [
      () => {
        throw new Error('offline');
      },
      // What the SDK resolves with when the echo was cancelled while it was encrypted.
      () => ({}),
      () => ({ event_id: '$voice' }),
    ];
    const mx = {
      makeTxnId: () => 'txn-fresh',
      sendMessage: vi.fn(async (_roomId: string, _content: unknown, txnId: string) => {
        localEvents.set(txnId, { status: EventStatus.NOT_SENT });
        return responses.shift()!();
      }),
      cancelPendingEvent: vi.fn((echo: unknown) => {
        localEvents.forEach((event, txnId) => {
          if (event === echo) localEvents.delete(txnId);
        });
      }),
    };
    const room = {
      roomId: '!room:example.org',
      getEventForTxnId: (txnId: string) => localEvents.get(txnId),
      hasEncryptionStateEvent: () => false,
    };
    let transport!: ReturnType<typeof useRoomInputUploadTransport>;
    const Harness = () => {
      transport = useRoomInputUploadTransport(mx as never, createStore(), room as never);
      return null;
    };
    act(() => {
      renderer = create(React.createElement(Harness));
    });
    const [item] = await transport.createVoiceUploadItems(
      new File(['voice'], 'voice.ogg', { type: 'audio/ogg' }),
      900,
      [1, 2],
      room as never,
      'txn-kept'
    );
    expect(item!.metadata.voiceMessage).toEqual({
      duration: 900,
      waveform: [1, 2],
      txnId: 'txn-kept',
    });
    const context = {
      ownerSessionId: '@alice:example.org',
      roomId: room.roomId,
      room: room as never,
      threadId: undefined,
      replyDraft: undefined,
      threadingEnabled: true,
      signalBridgedRoom: false,
    };

    await expect(
      transport.sendVoiceItem(context, item!, 'mxc://example.org/voice')
    ).rejects.toThrow('offline');
    // The failed echo is gone, and with it the room's hold on the ID.
    expect(localEvents.size).toBe(0);
    // Not acknowledged: the recording is not sent.
    await expect(
      transport.sendVoiceItem(context, item!, 'mxc://example.org/voice')
    ).rejects.toThrow('Failed to send voice message.');
    expect(await transport.sendVoiceItem(context, item!, 'mxc://example.org/voice')).toBe('$voice');
    // To the server every attempt is the same event, so it posts it once.
    expect(mx.sendMessage.mock.calls.map((call) => call[2])).toEqual([
      'txn-kept',
      'txn-kept',
      'txn-kept',
    ]);
    // The transaction ID is not part of the message.
    expect(JSON.stringify(mx.sendMessage.mock.calls[0]![1])).not.toContain('txn-kept');
  });
});
