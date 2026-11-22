// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { EventStatus, type MatrixClient, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { MINDROOM_BACKGROUND_JOB_CANCEL_EVENT } from '../protocol/backgroundJobsContract';
import { renderHook } from '@testing-library/react';
import { useSentCancels } from '../state/sentCancels';
import { cancelBackgroundJob, stopBackgroundJobs } from './cancelBackgroundJob';

const failedEcho = { status: EventStatus.NOT_SENT } as MatrixEvent;

const client = () => {
  const sendEvent = vi.fn().mockResolvedValue({ event_id: '$sent' });
  const cancelPendingEvent = vi.fn();
  const mx = { sendEvent, cancelPendingEvent, makeTxnId: () => 'txn' } as unknown as MatrixClient;
  const room = {
    roomId: '!room:example.org',
    getEventForTxnId: (txnId: string) => (txnId === 'txn' ? failedEcho : undefined),
  } as unknown as Room;
  return { mx, room, sendEvent, cancelPendingEvent };
};

describe('cancelBackgroundJob', () => {
  it('sends one cancel event for a job in its thread', async () => {
    const { mx, room, sendEvent } = client();
    await cancelBackgroundJob(mx, room, '$thread', { jobId: 'a' });
    expect(sendEvent).toHaveBeenCalledWith(
      '!room:example.org',
      MINDROOM_BACKGROUND_JOB_CANCEL_EVENT,
      {
        job_id: 'a',
        'm.relates_to': { rel_type: 'm.thread', event_id: '$thread' },
      },
      'txn'
    );
  });

  it('stops every job of the room from the main timeline with one event', async () => {
    const { mx, room, sendEvent } = client();
    await cancelBackgroundJob(mx, room, null, { all: true });
    expect(sendEvent).toHaveBeenCalledTimes(1);
    expect(sendEvent).toHaveBeenCalledWith(
      '!room:example.org',
      MINDROOM_BACKGROUND_JOB_CANCEL_EVENT,
      { all: true },
      'txn'
    );
  });

  it('drops the local echo of a cancel that failed to send, so it is never resent', async () => {
    const { mx, room, sendEvent, cancelPendingEvent } = client();
    sendEvent.mockRejectedValue(new Error('offline'));
    await expect(cancelBackgroundJob(mx, room, null, { jobId: 'a' })).rejects.toThrow('offline');
    expect(cancelPendingEvent).toHaveBeenCalledWith(failedEcho);
  });
});

describe('stopBackgroundJobs', () => {
  const sent = () => renderHook(() => useSentCancels('!room:example.org')).result.current;

  it('marks the jobs stopping while the cancel goes out, and keeps them so once it went', async () => {
    const { mx, room, sendEvent } = client();
    let send!: (value: unknown) => void;
    sendEvent.mockReturnValueOnce(new Promise((resolve) => (send = resolve)));
    const stopping = stopBackgroundJobs(mx, room, '$thread', { jobId: 'a' }, ['a']);
    expect(sent().has('a')).toBe(true);
    send({ event_id: '$sent' });
    await expect(stopping).resolves.toBe(true);
    expect(sent().has('a')).toBe(true);
  });

  it('unmarks the jobs of a cancel that failed to send, and says it failed', async () => {
    const { mx, room, sendEvent } = client();
    sendEvent.mockRejectedValueOnce(new Error('offline'));
    await expect(stopBackgroundJobs(mx, room, null, { all: true }, ['b', 'c'])).resolves.toBe(
      false
    );
    expect(sent().has('b')).toBe(false);
    expect(sent().has('c')).toBe(false);
  });
});
