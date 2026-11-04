import { MatrixError } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { readableReason } from './errorReason';

describe('readableReason', () => {
  it("takes a Matrix server's explanation without the status and URL", () => {
    const failure = new MatrixError(
      { errcode: 'M_FORBIDDEN', error: 'Cannot kick a user who is not in the room.' },
      403,
      'http://127.0.0.1:8008/_matrix/client/v3/rooms/!r/kick'
    );
    expect(failure.message).toContain('http://');
    expect(readableReason(failure)).toBe('Cannot kick a user who is not in the room.');
  });

  it('falls back to the message, then to the value itself', () => {
    expect(readableReason(new MatrixError({ errcode: 'M_UNKNOWN' }, 500))).toContain('[500]');
    expect(readableReason(new Error('Connection lost'))).toBe('Connection lost');
    expect(readableReason('offline')).toBe('offline');
  });
});
