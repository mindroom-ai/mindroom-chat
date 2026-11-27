import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createStore } from 'jotai';
import { EventStatus, RelationType } from 'matrix-js-sdk';
import { makeResolvedThreadRoom } from '../../test/utils/resolvedThreadRoom';
import { resetPendingThreadTagsForTests } from '../event-store/threads/threadTagPending';
import {
  buildPerTagStateKey,
  MINDROOM_THREAD_TAGS_EVENT,
  RESOLVED_TAG,
} from '../event-store/threads/threadTags';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MID_TURN_MODE_KEY } from '../matrix/protocol/midTurn';
import { useRoomInputUploadTransport } from './useRoomInputUploadTransport';

// The composer extensions pull in editor styles; a room-level voice message has no relation.
const voiceRelationMock = vi.hoisted(() =>
  vi.fn<() => Record<string, unknown> | undefined>(() => undefined)
);

vi.mock('./RoomInputExtensions', () => ({
  getRoomInputVoiceUploadRelation: voiceRelationMock,
}));

let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  voiceRelationMock.mockReset();
  voiceRelationMock.mockReturnValue(undefined);
  resetPendingThreadTagsForTests();
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

  it('attaches io.mindroom.mid_turn to standalone voice messages', async () => {
    const mx = {
      makeTxnId: () => 'txn-voice-mid-turn',
      sendMessage: vi.fn(async () => ({ event_id: '$voice-1' })),
      cancelPendingEvent: vi.fn(),
    };
    const room = {
      roomId: '!room:example.org',
      getEventForTxnId: () => undefined,
    };
    let transport!: ReturnType<typeof useRoomInputUploadTransport>;
    const Harness = () => {
      transport = useRoomInputUploadTransport(mx as never, createStore(), room as never);
      return null;
    };
    act(() => {
      renderer = create(React.createElement(Harness));
    });
    const file = new File(['voice'], 'voice.ogg', { type: 'audio/ogg' });

    const eventId = await transport.sendVoiceItem(
      {
        ownerSessionId: '@alice:example.org',
        roomId: room.roomId,
        room: room as never,
        threadId: '$root:example.org',
        replyDraft: undefined,
        threadingEnabled: true,
        signalBridgedRoom: false,
      },
      {
        file,
        originalFile: file,
        encInfo: undefined,
        metadata: { markedAsSpoiler: false, voiceMessage: { duration: 1200, waveform: [100] } },
      },
      'mxc://example.org/voice',
      undefined,
      'steer'
    );

    expect(eventId).toBe('$voice-1');
    const sentContent = (mx.sendMessage.mock.calls[0] as unknown[] | undefined)?.[1] as Record<
      string,
      unknown
    >;
    expect(sentContent).toMatchObject({
      msgtype: 'm.audio',
      url: 'mxc://example.org/voice',
      [MID_TURN_MODE_KEY]: 'steer',
    });
  });

  it('uses application/octet-stream and hides filename for encrypted uploads, while keeping original type for plaintext uploads', async () => {
    const mx = {
      uploadContent: vi.fn(async () => ({ content_uri: 'mxc://example.org/file' })),
    };
    const room = {
      roomId: '!room:example.org',
      getEventForTxnId: () => undefined,
    };
    let transport!: ReturnType<typeof useRoomInputUploadTransport>;
    const Harness = () => {
      transport = useRoomInputUploadTransport(mx as never, createStore(), room as never);
      return null;
    };
    act(() => {
      renderer = create(React.createElement(Harness));
    });

    const originalPdf = new File(['secret pdf'], 'report.pdf', { type: 'application/pdf' });
    const encryptedFile = new File(['ciphertext'], 'report.pdf', { type: '' });
    await transport.uploadItem({
      file: encryptedFile,
      originalFile: originalPdf,
      encInfo: { v: 'v2' } as never,
      metadata: { markedAsSpoiler: false },
    });
    expect(mx.uploadContent).toHaveBeenNthCalledWith(
      1,
      encryptedFile,
      expect.objectContaining({
        type: 'application/octet-stream',
        includeFilename: false,
      })
    );

    await transport.uploadItem({
      file: originalPdf,
      originalFile: originalPdf,
      encInfo: undefined,
      metadata: { markedAsSpoiler: false },
    });
    expect(mx.uploadContent).toHaveBeenNthCalledWith(
      2,
      originalPdf,
      expect.objectContaining({
        type: 'application/pdf',
        includeFilename: true,
        name: 'report.pdf',
      })
    );
  });

  it('reopens a resolved thread after a voice reply succeeds, and skips failed sends', async () => {
    const { room: baseRoom } = makeResolvedThreadRoom();
    const room = { ...baseRoom, getEventForTxnId: () => undefined };
    const mx = {
      getUserId: () => '@alice:example.org',
      getSafeUserId: () => '@alice:example.org',
      makeTxnId: () => 'txn-voice-reopen',
      sendMessage: vi
        .fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce({ event_id: '$voice-2' }),
      sendStateEvent: vi.fn(async () => ({ event_id: '$tag' })),
      cancelPendingEvent: vi.fn(),
    };
    voiceRelationMock.mockReturnValue({ rel_type: RelationType.Thread, event_id: '$root' });
    let transport!: ReturnType<typeof useRoomInputUploadTransport>;
    act(() => {
      renderer = create(
        React.createElement(
          () => (
            (transport = useRoomInputUploadTransport(mx as never, createStore(), room as never)),
            null
          )
        )
      );
    });
    const file = new File(['voice'], 'voice.ogg', { type: 'audio/ogg' });
    const ctx = {
      ownerSessionId: '@alice:example.org',
      roomId: room.roomId,
      room: room as never,
      threadId: '$root',
      replyDraft: undefined,
      threadingEnabled: true,
      signalBridgedRoom: false,
    };
    const item = {
      file,
      originalFile: file,
      encInfo: undefined,
      metadata: { markedAsSpoiler: false },
    };

    await expect(transport.sendVoiceItem(ctx, item, 'mxc://example.org/v1')).rejects.toThrow(
      'offline'
    );
    expect(mx.sendStateEvent).not.toHaveBeenCalled();

    await expect(transport.sendVoiceItem(ctx, item, 'mxc://example.org/v2')).resolves.toBe(
      '$voice-2'
    );
    expect(mx.sendStateEvent).toHaveBeenCalledWith(
      room.roomId,
      MINDROOM_THREAD_TAGS_EVENT,
      {},
      buildPerTagStateKey('$root', RESOLVED_TAG)
    );
  });
});
