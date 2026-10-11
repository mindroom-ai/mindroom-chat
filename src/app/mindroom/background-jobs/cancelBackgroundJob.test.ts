import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import { MINDROOM_BACKGROUND_JOB_CANCEL_EVENT } from './backgroundJobsContract';
import { cancelBackgroundJob } from './cancelBackgroundJob';

const client = () => {
  const sendEvent = vi.fn().mockResolvedValue({ event_id: '$sent' });
  return { mx: { sendEvent } as unknown as MatrixClient, sendEvent };
};

describe('cancelBackgroundJob', () => {
  it('sends one cancel event for a job in its thread', async () => {
    const { mx, sendEvent } = client();
    await cancelBackgroundJob(mx, '!room:example.org', '$thread', { jobId: 'a' });
    expect(sendEvent).toHaveBeenCalledWith(
      '!room:example.org',
      MINDROOM_BACKGROUND_JOB_CANCEL_EVENT,
      {
        job_id: 'a',
        'm.relates_to': { rel_type: 'm.thread', event_id: '$thread' },
      }
    );
  });

  it('stops every job of the room from the main timeline with one event', async () => {
    const { mx, sendEvent } = client();
    await cancelBackgroundJob(mx, '!room:example.org', null, { all: true });
    expect(sendEvent).toHaveBeenCalledTimes(1);
    expect(sendEvent).toHaveBeenCalledWith(
      '!room:example.org',
      MINDROOM_BACKGROUND_JOB_CANCEL_EVENT,
      {
        all: true,
      }
    );
  });
});
