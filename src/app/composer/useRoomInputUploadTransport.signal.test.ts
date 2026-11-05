import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createStore } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRoomInputUploadTransport } from './useRoomInputUploadTransport';

// The composer extensions pull in editor styles; a room-level voice message has no relation.
vi.mock('./RoomInputExtensions', () => ({
  getMindroomRoomInputVoiceUploadRelation: () => undefined,
}));

let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

const sendVoice = async (signalBridgedRoom: boolean) => {
  const mx = {
    makeTxnId: () => 'txn-voice',
    sendMessage: vi.fn(async () => ({ event_id: '$voice' })),
  };
  const room = { roomId: '!room:example.org' };
  let transport!: ReturnType<typeof useRoomInputUploadTransport>;
  const Harness = () => {
    transport = useRoomInputUploadTransport(mx as never, createStore(), room as never);
    return null;
  };
  act(() => {
    renderer = create(React.createElement(Harness));
  });
  const file = new File(['voice'], 'voice.webm', { type: 'audio/webm' });
  await transport.sendVoiceItem(
    {
      ownerSessionId: '@alice:example.org',
      roomId: room.roomId,
      room: room as never,
      threadId: undefined,
      replyDraft: undefined,
      threadingEnabled: true,
      signalBridgedRoom,
    },
    {
      file,
      originalFile: file,
      encInfo: undefined,
      metadata: { markedAsSpoiler: false, voiceMessage: { duration: 1200 } },
    },
    'mxc://example.org/voice'
  );
  return (mx.sendMessage.mock.calls[0] as unknown[])[1] as { info: { mimetype: string } };
};

describe('useRoomInputUploadTransport voice codec', () => {
  it('labels a voice message for a Signal-bridged room as the bridge expects', async () => {
    expect((await sendVoice(true)).info.mimetype).toBe('audio/aac');
  });

  it('keeps the recorded type elsewhere', async () => {
    expect((await sendVoice(false)).info.mimetype).toBe('audio/webm');
  });
});
