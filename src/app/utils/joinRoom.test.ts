import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixError } from 'matrix-js-sdk';
import { ConnectionError } from 'matrix-js-sdk/lib/http-api/errors';

import {
  JOIN_ROOM_TIMEOUT_MESSAGE,
  JoinRoomTimeoutError,
  canRetryJoinRoom,
  getJoinRoomErrorMessage,
  isRecoverableJoinRoomError,
  waitForJoinRoom,
  waitForJoinRoomCompletion,
} from './joinRoom';

describe('room join recovery', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('turns a join that never settles into a recoverable timeout', async () => {
    vi.useFakeTimers();
    const result = waitForJoinRoom(
      new Promise<never>(() => {
        // Deliberately never settles.
      }),
      30_000
    );
    const rejection = expect(result).rejects.toMatchObject({
      name: 'JoinRoomTimeoutError',
      message: JOIN_ROOM_TIMEOUT_MESSAGE,
    });

    await vi.advanceTimersByTimeAsync(30_000);

    await rejection;
  });

  it('does not let the timeout replace a completed join', async () => {
    vi.useFakeTimers();
    const room = { roomId: '!joined:example.org' };

    await expect(waitForJoinRoom(Promise.resolve(room), 30_000)).resolves.toBe(room);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('runs required completion work when a join succeeds after the timeout', async () => {
    vi.useFakeTimers();
    let resolveJoin: ((roomId: string) => void) | undefined;
    const join = new Promise<string>((resolve) => {
      resolveJoin = resolve;
    });
    const onJoined = vi.fn();
    const result = waitForJoinRoomCompletion(join, onJoined, 30_000);
    const rejection = expect(result).rejects.toMatchObject({
      name: 'JoinRoomTimeoutError',
    });

    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
    expect(onJoined).not.toHaveBeenCalled();

    resolveJoin?.('!joined:example.org');
    await Promise.resolve();
    await Promise.resolve();

    expect(onJoined).toHaveBeenCalledWith('!joined:example.org');
  });

  it.each([
    new ConnectionError(
      'fetch failed',
      Object.assign(new Error('The operation failed'), { name: 'NetworkError' })
    ),
    Object.assign(new Error('The operation failed'), { name: 'NetworkError' }),
  ])('offers recovery for browser-level connectivity failures', (error) => {
    expect(isRecoverableJoinRoomError(error)).toBe(true);
    expect(getJoinRoomErrorMessage(error)).toBe(
      'Could not reach the server. Reload the app to restore the connection, then try again.'
    );
  });

  it('preserves actionable Matrix errors without offering session recovery', () => {
    const error = new MatrixError({
      errcode: 'M_FORBIDDEN',
      error: 'You are not invited to this room.',
    });

    expect(isRecoverableJoinRoomError(error)).toBe(false);
    expect(getJoinRoomErrorMessage(error)).toBe('You are not invited to this room.');
  });

  it('does not misclassify unrelated TypeErrors as connectivity failures', () => {
    const error = new TypeError(
      'Cannot read properties of undefined at https://private.example/internal'
    );

    expect(isRecoverableJoinRoomError(error)).toBe(false);
    expect(getJoinRoomErrorMessage(error)).toBe('Failed to join the room. Try again.');
  });

  it('does not mistake Matrix rejection text for a browser connectivity failure', () => {
    const error = new MatrixError({
      errcode: 'M_FORBIDDEN',
      error: 'Your policy failed to fetch; contact the room administrator.',
    });

    expect(isRecoverableJoinRoomError(error)).toBe(false);
    expect(getJoinRoomErrorMessage(error)).toBe(
      'Your policy failed to fetch; contact the room administrator.'
    );
  });

  it('offers retry only after failures whose join request has settled', () => {
    expect(canRetryJoinRoom(new JoinRoomTimeoutError())).toBe(false);
    expect(canRetryJoinRoom(new ConnectionError('fetch failed'))).toBe(false);
    expect(
      canRetryJoinRoom(
        new MatrixError({
          errcode: 'M_FORBIDDEN',
          error: 'You are not invited to this room.',
        })
      )
    ).toBe(true);
  });
});
