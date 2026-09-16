import { MatrixEvent, MatrixEventEvent, RoomEvent, SyncState } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listenForChatUiActions } from './chatUiController';
import { agentId, makeUiEvent, makeUiRoom, roomId } from './testUtils';

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.restoreAllMocks();
});

const setup = (threadId: string | undefined = '$thread') => {
  const { mx, room } = makeUiRoom();
  let now = 100_000;
  let foreground = true;
  const onAction = vi.fn();
  vi.spyOn(mx, 'isInitialSyncComplete').mockReturnValue(true);
  vi.spyOn(mx, 'getSyncState').mockReturnValue(SyncState.Syncing);
  const options = { mx, room, threadId, onAction, now: () => now, isForeground: () => foreground };
  const stop = listenForChatUiActions(options);
  cleanups.push(stop);
  const emit = (event = makeUiEvent(), liveEvent = true, toStart = false, removed = false) =>
    mx.emit(RoomEvent.Timeline, event, room, toStart, removed, {
      liveEvent,
      timeline: room.getLiveTimeline(),
    });
  return {
    ...options,
    stop,
    emit,
    setTime: (value: number) => {
      now = value;
    },
    setForeground: (value: boolean) => {
      foreground = value;
    },
  };
};

describe('live Chat UI action delivery', () => {
  it('delivers one new request in the foreground conversation exactly once', () => {
    const fixture = setup();
    fixture.emit();
    fixture.emit();
    expect(fixture.onAction.mock.calls.map(([action]) => action.action)).toEqual(['show_computer']);
  });

  it('does not replay a consumed event after the room listener remounts', () => {
    const fixture = setup();
    fixture.emit();
    fixture.stop();
    cleanups.push(listenForChatUiActions(fixture));
    fixture.emit();
    expect(fixture.onAction).toHaveBeenCalledTimes(1);
  });

  it('keeps another thread passive, including when its event is redelivered after navigation', () => {
    const fixture = setup('$other');
    fixture.emit();
    fixture.stop();
    cleanups.push(listenForChatUiActions({ ...fixture, threadId: '$thread' }));
    fixture.emit();
    expect(fixture.onAction).not.toHaveBeenCalled();
  });

  it('does not confuse a thread with the room overview', () => {
    const fixture = setup();
    const event = makeUiEvent({ thread_id: null });
    delete event.event.content!['m.relates_to'];
    fixture.emit(event);
    expect(fixture.onAction).not.toHaveBeenCalled();
  });

  it('never executes history, removals, initial sync, old events, or future timestamps', () => {
    const fixture = setup();
    fixture.emit(makeUiEvent({}, { event_id: '$history' }), false);
    fixture.emit(makeUiEvent({}, { event_id: '$backfill' }), true, true);
    fixture.emit(makeUiEvent({}, { event_id: '$removed' }), true, false, true);
    fixture.emit(makeUiEvent({}, { event_id: '$old', origin_server_ts: 99_999 }));
    fixture.emit(makeUiEvent({}, { event_id: '$future', origin_server_ts: 200_000 }));
    vi.mocked(fixture.mx.isInitialSyncComplete).mockReturnValue(false);
    fixture.emit(makeUiEvent({}, { event_id: '$initial' }));
    vi.mocked(fixture.mx.isInitialSyncComplete).mockReturnValue(true);
    vi.mocked(fixture.mx.getSyncState).mockReturnValue(SyncState.Prepared);
    fixture.emit(makeUiEvent({}, { event_id: '$catchup' }));
    expect(fixture.onAction).not.toHaveBeenCalled();
  });

  it('does not replay a request first received in a hidden client after focus returns', () => {
    const fixture = setup();
    fixture.setForeground(false);
    fixture.emit();
    fixture.setForeground(true);
    fixture.emit();
    expect(fixture.onAction).not.toHaveBeenCalled();
  });

  it('admits late decryption only for a fresh live candidate in this view', async () => {
    const fixture = setup();
    const encrypted = new MatrixEvent({
      event_id: '$encrypted',
      room_id: roomId,
      sender: agentId,
      type: 'm.room.encrypted',
      origin_server_ts: 100_000,
      content: {},
    });
    vi.spyOn(fixture.mx, 'decryptEventIfNeeded').mockResolvedValue();
    fixture.emit(encrypted);
    await Promise.resolve();
    encrypted.setClearData({
      clearEvent: { type: 'm.room.message', content: makeUiEvent().getContent() },
    });
    fixture.mx.emit(MatrixEventEvent.Decrypted, encrypted);
    fixture.mx.emit(MatrixEventEvent.Decrypted, encrypted);
    const historical = makeUiEvent({}, { event_id: '$historical' });
    fixture.mx.emit(MatrixEventEvent.Decrypted, historical);
    expect(fixture.onAction.mock.calls.map(([action]) => action.eventId)).toEqual(['$encrypted']);
  });

  it('abandons delayed decryption after navigation or expiry', async () => {
    const fixture = setup();
    const event = makeUiEvent();
    vi.spyOn(event, 'getType').mockReturnValue('m.room.encrypted');
    vi.spyOn(fixture.mx, 'decryptEventIfNeeded').mockResolvedValue();
    fixture.emit(event);
    await Promise.resolve();
    vi.mocked(event.getType).mockReturnValue('m.room.message');
    fixture.setTime(160_001);
    fixture.mx.emit(MatrixEventEvent.Decrypted, event);
    fixture.stop();
    fixture.mx.emit(MatrixEventEvent.Decrypted, event);
    expect(fixture.onAction).not.toHaveBeenCalled();
  });
});
