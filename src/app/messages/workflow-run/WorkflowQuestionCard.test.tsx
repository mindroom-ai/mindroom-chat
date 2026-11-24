// @vitest-environment jsdom
import { EventEmitter } from 'node:events';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ClientEvent, MatrixEvent, type MatrixClient, type Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatrixClientProvider } from '../../matrix/hooks/useMatrixClient';
import {
  WORKFLOW_ANSWER_EVENT_TYPE,
  WORKFLOW_ANSWER_REJECTED_EVENT_TYPE,
  type WorkflowRunQuestion,
} from '../../matrix/protocol/workflowRunContent';
import frames from '../live/__fixtures__/workflow-frames-v1.json';
import { WorkflowQuestionCard } from './WorkflowQuestionCard';

const ROOM_ID = '!room:example.org';
const THREAD_ID = '$thread-sample-1';
const CARD_EVENT_ID = '$card-q-1';
const VIEWER = '@alex:example.org';
const OTHER = '@sam:example.org';
const AGENT = '@mindroom_panels:example.org';
const RUN = frames[0]!.run;

const makeQuestion = (overrides: Partial<WorkflowRunQuestion> = {}): WorkflowRunQuestion => ({
  run: RUN,
  node: 'n5',
  questionId: 'q3fa91c',
  requester: VIEWER,
  text: 'Deploy to staging?',
  options: ['Yes', 'No'],
  freeText: false,
  status: 'open',
  answer: null,
  ...overrides,
});

const makeClient = (sendEvent = vi.fn(async () => ({ event_id: '$ans-1' }))) => {
  const emitter = new EventEmitter();
  const room = {
    roomId: ROOM_ID,
    getMember: (id: string) => ({
      userId: id,
      name: id === OTHER ? 'Sam' : 'Alex',
      rawDisplayName: id === OTHER ? 'Sam' : 'Alex',
      membership: 'join',
    }),
    getEventForTxnId: () => undefined,
  } as unknown as Room;
  const mx = Object.assign(emitter, {
    getUserId: () => VIEWER,
    getSafeUserId: () => VIEWER,
    getRoom: (id: string) => (id === ROOM_ID ? room : null),
    makeTxnId: () => 'txn-q-1',
    sendEvent,
  }) as unknown as MatrixClient;
  return { mx, emitter, sendEvent };
};

describe('WorkflowQuestionCard', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('lets only the requester answer', () => {
    const { mx } = makeClient();
    render(
      <MatrixClientProvider value={mx}>
        <WorkflowQuestionCard
          question={makeQuestion({ requester: OTHER, options: ['Yes', 'No'] })}
          roomId={ROOM_ID}
          threadId={THREAD_ID}
          eventId={CARD_EVENT_ID}
        />
      </MatrixClientProvider>
    );
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Yes' }).disabled).toBe(true);
    expect(screen.getByText('Only Sam can answer.')).toBeTruthy();
  });

  it('sends the chosen option and disables controls while waiting for the edit', async () => {
    const sendEvent = vi.fn(async () => ({ event_id: '$ans-1' }));
    const { mx } = makeClient(sendEvent);
    render(
      <MatrixClientProvider value={mx}>
        <WorkflowQuestionCard
          question={makeQuestion()}
          roomId={ROOM_ID}
          threadId={THREAD_ID}
          eventId={CARD_EVENT_ID}
        />
      </MatrixClientProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    });
    expect(sendEvent).toHaveBeenCalledWith(
      ROOM_ID,
      WORKFLOW_ANSWER_EVENT_TYPE,
      {
        run: RUN,
        node: 'n5',
        option: 'Yes',
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: THREAD_ID,
          'm.in_reply_to': { event_id: CARD_EVENT_ID },
        },
      },
      'txn-q-1'
    );
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Yes' }).disabled).toBe(true);
  });

  it('sends free text answers', async () => {
    const sendEvent = vi.fn(async () => ({ event_id: '$ans-2' }));
    const { mx } = makeClient(sendEvent);
    render(
      <MatrixClientProvider value={mx}>
        <WorkflowQuestionCard
          question={makeQuestion({ options: [], freeText: true })}
          roomId={ROOM_ID}
          threadId={THREAD_ID}
          eventId={CARD_EVENT_ID}
        />
      </MatrixClientProvider>
    );

    fireEvent.change(screen.getByPlaceholderText('Type your answer'), {
      target: { value: 'after lunch' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });
    expect(sendEvent).toHaveBeenCalledWith(
      ROOM_ID,
      WORKFLOW_ANSWER_EVENT_TYPE,
      {
        run: RUN,
        node: 'n5',
        text: 'after lunch',
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: THREAD_ID,
          'm.in_reply_to': { event_id: CARD_EVENT_ID },
        },
      },
      'txn-q-1'
    );
  });

  it('shows an answered or cancelled question without controls', () => {
    const { mx } = makeClient();
    const { rerender } = render(
      <MatrixClientProvider value={mx}>
        <WorkflowQuestionCard
          question={makeQuestion({ status: 'answered', answer: 'Yes' })}
          roomId={ROOM_ID}
          threadId={THREAD_ID}
          eventId={CARD_EVENT_ID}
        />
      </MatrixClientProvider>
    );
    expect(screen.getByText('Answered: Yes')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);

    rerender(
      <MatrixClientProvider value={mx}>
        <WorkflowQuestionCard
          question={makeQuestion({ status: 'cancelled' })}
          roomId={ROOM_ID}
          threadId={THREAD_ID}
          eventId={CARD_EVENT_ID}
        />
      </MatrixClientProvider>
    );
    expect(screen.getByText('Cancelled')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('enables the card again with the reason when the answer is rejected', async () => {
    const sendEvent = vi.fn(async () => ({ event_id: '$ans-rej' }));
    const { mx, emitter } = makeClient(sendEvent);
    render(
      <MatrixClientProvider value={mx}>
        <WorkflowQuestionCard
          question={makeQuestion()}
          roomId={ROOM_ID}
          threadId={THREAD_ID}
          eventId={CARD_EVENT_ID}
        />
      </MatrixClientProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Yes' }).disabled).toBe(true);

    act(() => {
      emitter.emit(
        ClientEvent.Event,
        new MatrixEvent({
          type: WORKFLOW_ANSWER_REJECTED_EVENT_TYPE,
          event_id: '$rej-1',
          room_id: ROOM_ID,
          sender: AGENT,
          origin_server_ts: 2,
          content: {
            run: RUN,
            node: 'n5',
            reason: 'already_answered',
            'm.relates_to': {
              rel_type: 'm.thread',
              event_id: THREAD_ID,
              'm.in_reply_to': { event_id: '$ans-rej' },
            },
          },
        })
      );
    });

    expect(screen.getByText('Already answered.')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Yes' }).disabled).toBe(false);
  });

  it('enables the card again after 15 seconds with no reply', async () => {
    vi.useFakeTimers();
    const sendEvent = vi.fn(async () => ({ event_id: '$ans-slow' }));
    const { mx } = makeClient(sendEvent);
    render(
      <MatrixClientProvider value={mx}>
        <WorkflowQuestionCard
          question={makeQuestion()}
          roomId={ROOM_ID}
          threadId={THREAD_ID}
          eventId={CARD_EVENT_ID}
        />
      </MatrixClientProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Yes' }).disabled).toBe(true);

    act(() => {
      vi.advanceTimersByTime(15_000);
    });

    expect(screen.getByText('No reply yet. Try again.')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Yes' }).disabled).toBe(false);
  });
});
