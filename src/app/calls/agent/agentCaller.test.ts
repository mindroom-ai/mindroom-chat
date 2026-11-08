import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomStateEvent, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import type { StartCallOptions } from '../callStore';
import { cleanupMindroomAgentCall, prepareAgentCallRoom } from './agentCall';
import { startAgentCall } from './agentCaller';

vi.mock('./agentCall', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./agentCall')>()),
  prepareAgentCallRoom: vi.fn(async () => undefined),
  cleanupMindroomAgentCall: vi.fn(async () => undefined),
}));

const mx = { getRoom: () => null } as unknown as MatrixClient;
const room = { roomId: '!callroom:calls.test' } as Room;
const target = {
  room,
  agentUserId: '@mindroom_helper:calls.test',
  origin: { roomId: '!planning:calls.test', threadId: '$thread' },
};

describe('startAgentCall', () => {
  it('writes the call room origin only when the call may start', async () => {
    // Another tab of this session is in a call: the start answers busy before preparing.
    const startCall = vi.fn(async () => 'busy' as const);

    await expect(startAgentCall(mx, startCall, target)).resolves.toBe('busy');

    expect(prepareAgentCallRoom).not.toHaveBeenCalled();
  });

  it('prepares the call room with the origin and clears it again when the call ends', async () => {
    const startCall = vi.fn(async (options: StartCallOptions) => {
      await options.prepare?.();
      await options.onEnded?.();
      return 'started' as const;
    });

    await expect(startAgentCall(mx, startCall, target)).resolves.toBe('started');

    expect(startCall).toHaveBeenCalledWith(
      expect.objectContaining({
        room,
        kind: 'agent',
        agentUserId: target.agentUserId,
        origin: target.origin,
        video: false,
      })
    );
    expect(prepareAgentCallRoom).toHaveBeenCalledWith(mx, room, target.agentUserId, {
      room_id: '!planning:calls.test',
      thread_id: '$thread',
    });
    expect(cleanupMindroomAgentCall).toHaveBeenCalledWith(mx, room);
  });

  it('starts with the camera on when asked, as a call taken up after a reload', async () => {
    const startCall = vi.fn(async () => 'started' as const);

    await startAgentCall(mx, startCall, { ...target, video: true });

    expect(startCall).toHaveBeenCalledWith(expect.objectContaining({ video: true }));
  });
});

describe('startAgentCall in an encrypted conversation', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * A client whose conversation is encrypted or not and whose call room starts out unencrypted;
   * the call room's encryption arrives through sync when `syncEncryption` runs.
   */
  const clientWith = ({ conversationEncrypted }: { conversationEncrypted: boolean }) => {
    const emitter = new EventEmitter();
    let callRoomEncrypted = false;
    const callRoom = {
      roomId: '!callroom:calls.test',
      hasEncryptionStateEvent: () => callRoomEncrypted,
    } as unknown as Room;
    const conversation = {
      roomId: '!planning:calls.test',
      hasEncryptionStateEvent: () => conversationEncrypted,
    } as unknown as Room;
    const client = {
      getRoom: (roomId: string) => (roomId === conversation.roomId ? conversation : null),
      sendStateEvent: vi.fn(async () => ({ event_id: '$encryption' })),
      on: (name: string, listener: (...args: unknown[]) => void) => emitter.on(name, listener),
      off: (name: string, listener: (...args: unknown[]) => void) => emitter.off(name, listener),
    } as unknown as MatrixClient;
    const syncEncryption = () => {
      callRoomEncrypted = true;
      const event = { getRoomId: () => callRoom.roomId } as MatrixEvent;
      emitter.emit(RoomStateEvent.Events, event);
    };
    return { client, callRoom, syncEncryption };
  };

  const startWith = (client: MatrixClient, callRoom: Room) => {
    let prepared: Promise<void> | undefined;
    const startCall = vi.fn(async (options: StartCallOptions) => {
      prepared = options.prepare?.();
      await prepared;
      return 'started' as const;
    });
    const started = startAgentCall(client, startCall, { ...target, room: callRoom });
    return { started, prepared: () => prepared };
  };

  it('turns encryption on in a call room an unencrypted conversation made, and waits until sync shows it', async () => {
    const { client, callRoom, syncEncryption } = clientWith({ conversationEncrypted: true });
    vi.mocked(prepareAgentCallRoom).mockClear();

    const { started } = startWith(client, callRoom);
    await vi.waitFor(() => expect(client.sendStateEvent).toHaveBeenCalled());

    expect(client.sendStateEvent).toHaveBeenCalledWith(
      callRoom.roomId,
      'm.room.encryption',
      { algorithm: 'm.megolm.v1.aes-sha2' },
      ''
    );
    // The call and the agent read the room's encryption when they join: nothing goes on before it is there.
    expect(prepareAgentCallRoom).not.toHaveBeenCalled();
    syncEncryption();
    await expect(started).resolves.toBe('started');
    expect(prepareAgentCallRoom).toHaveBeenCalledTimes(1);
  });

  it('leaves the call room as it is for a call about an unencrypted conversation', async () => {
    const { client, callRoom } = clientWith({ conversationEncrypted: false });

    await expect(startWith(client, callRoom).started).resolves.toBe('started');

    expect(client.sendStateEvent).not.toHaveBeenCalled();
  });

  it('gives the start up when the encryption does not come back through sync in time', async () => {
    vi.useFakeTimers();
    const { client, callRoom } = clientWith({ conversationEncrypted: true });

    const { started, prepared } = startWith(client, callRoom);
    const outcome = started.catch((error: unknown) => error);
    await vi.waitFor(() => expect(prepared()).toBeDefined());
    await vi.advanceTimersByTimeAsync(20_000);

    expect(await outcome).toBeInstanceOf(Error);
  });
});
