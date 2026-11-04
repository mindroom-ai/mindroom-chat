import { MatrixEvent, MatrixEventEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDecryptionWaits, isAwaitingDecryption } from './decryptionWaits';

/** An encrypted event whose decryption attempts the test decides. */
const encryptedEvent = () => {
  const event = new MatrixEvent({
    type: 'm.room.encrypted',
    room_id: '!room:example.org',
    sender: '@agent:example.org',
    event_id: '$encrypted',
    content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'secret' },
  });
  let failed = false;
  vi.spyOn(event, 'isDecryptionFailure').mockImplementation(() => failed);
  const attempt = (outcome: 'fails' | 'works') => {
    failed = outcome === 'fails';
    event.emit(MatrixEventEvent.Decrypted, event);
  };
  return { event, attempt };
};

describe('createDecryptionWaits', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits past a failed attempt until one works, then stops listening', () => {
    const { event, attempt } = encryptedEvent();
    const onDecrypted = vi.fn();
    createDecryptionWaits().wait(event, 60_000, onDecrypted);

    attempt('fails');
    expect(onDecrypted).not.toHaveBeenCalled();

    attempt('works');
    attempt('works');
    expect(onDecrypted).toHaveBeenCalledTimes(1);
    expect(event.listenerCount(MatrixEventEvent.Decrypted)).toBe(0);
  });

  it('gives up when the time runs out', () => {
    const { event, attempt } = encryptedEvent();
    const onDecrypted = vi.fn();
    createDecryptionWaits().wait(event, 1_000, onDecrypted);

    vi.advanceTimersByTime(1_000);
    attempt('works');

    expect(onDecrypted).not.toHaveBeenCalled();
    expect(event.listenerCount(MatrixEventEvent.Decrypted)).toBe(0);
  });

  it('waits once per event, and not at all without time left', () => {
    const { event, attempt } = encryptedEvent();
    const first = vi.fn();
    const second = vi.fn();
    const waits = createDecryptionWaits();
    waits.wait(event, 0, first);
    expect(event.listenerCount(MatrixEventEvent.Decrypted)).toBe(0);

    waits.wait(event, 60_000, first);
    waits.wait(event, 60_000, second);
    expect(event.listenerCount(MatrixEventEvent.Decrypted)).toBe(1);

    attempt('works');
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it('ends every wait on stop, and starts no new one after it', () => {
    const { event, attempt } = encryptedEvent();
    const later = encryptedEvent();
    const onDecrypted = vi.fn();
    const waits = createDecryptionWaits();
    waits.wait(event, 60_000, onDecrypted);

    waits.stop();
    waits.wait(later.event, 60_000, onDecrypted);
    attempt('works');
    later.attempt('works');

    expect(onDecrypted).not.toHaveBeenCalled();
    expect(event.listenerCount(MatrixEventEvent.Decrypted)).toBe(0);
    expect(later.event.listenerCount(MatrixEventEvent.Decrypted)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('isAwaitingDecryption', () => {
  it('is true while encrypted content is not readable: not tried, running, or failed', () => {
    const { event } = encryptedEvent();
    expect(isAwaitingDecryption(event)).toBe(true);

    vi.spyOn(event, 'shouldAttemptDecryption').mockReturnValue(false);
    vi.spyOn(event, 'isBeingDecrypted').mockReturnValue(true);
    expect(isAwaitingDecryption(event)).toBe(true);

    vi.spyOn(event, 'isBeingDecrypted').mockReturnValue(false);
    vi.spyOn(event, 'isDecryptionFailure').mockReturnValue(true);
    expect(isAwaitingDecryption(event)).toBe(true);
  });

  it('is false for a plain event', () => {
    const plain = new MatrixEvent({
      type: 'm.room.message',
      room_id: '!room:example.org',
      sender: '@agent:example.org',
      event_id: '$plain',
      content: { msgtype: 'm.text', body: 'Hello' },
    });
    expect(isAwaitingDecryption(plain)).toBe(false);
  });
});
