import { describe, expect, it, vi } from 'vitest';
import { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import frames from '../../messages/live/__fixtures__/workflow-frames-v1.json';
import {
  parseWorkflowAnswerRejection,
  parseWorkflowRunCard,
  parseWorkflowRunQuestion,
  sendWorkflowRunAnswer,
  sendWorkflowRunResume,
  WORKFLOW_ANSWER_EVENT_TYPE,
  WORKFLOW_ANSWER_REJECTED_EVENT_TYPE,
  WORKFLOW_CONTROL_EVENT_TYPE,
  WORKFLOW_QUESTION_CONTENT_KEY,
  WORKFLOW_RUN_CONTENT_KEY,
} from './workflowRunContent';

const RUN = frames[0]!.run;
const firstFrame = frames[0]!;
const AGENT = '@mindroom_panels:example.org';
const VIEWER = '@alex:example.org';

const cardPayload = {
  run: RUN,
  job_id: 'job-run-1',
  requester: VIEWER,
  title: 'Audit the sample module',
  name: 'audit-module',
  status: 'completed',
  counts: {
    queued: 0,
    running: 0,
    waiting: 0,
    completed: 2,
    failed: 0,
    indeterminate: 0,
    cached: 0,
  },
  usage: {
    input_tokens: 17678,
    output_tokens: 280,
    tool_calls: 6,
    cost_usd: '0.019183',
    attempt_cost_usd: '0.019183',
    projected_cost_usd: '0.019183',
    cost_unknown: false,
  },
  phases: ['Audit'],
  attempt: 1,
  started_at: 1795389735,
  ended_at: 1795389811,
  error: null,
  large: true,
  graph: {
    ...firstFrame.snapshot,
    nodes: [
      {
        ...firstFrame.snapshot!.nodes[0],
        status: 'completed',
        usage: { input_tokens: 8839, output_tokens: 140, tool_calls: 3, cost_usd: '0.009591' },
      },
    ],
  },
};

describe('workflowRunContent', () => {
  it('parses a run card including decimal string costs and embedded graph', () => {
    const parsed = parseWorkflowRunCard({ [WORKFLOW_RUN_CONTENT_KEY]: cardPayload });
    expect(parsed).not.toBeNull();
    expect(parsed).toMatchObject({
      run: RUN,
      jobId: 'job-run-1',
      requester: VIEWER,
      title: 'Audit the sample module',
      name: 'audit-module',
      status: 'completed',
      large: true,
      attempt: 1,
      phases: ['Audit'],
    });
    expect(parsed?.usage.costUsd).toBeCloseTo(0.019183, 6);
    expect(parsed?.graph?.nodes[0]?.usage?.costUsd).toBeCloseTo(0.009591, 6);
  });

  it('reads an edited card from m.new_content', () => {
    const parsed = parseWorkflowRunCard({
      [WORKFLOW_RUN_CONTENT_KEY]: { ...cardPayload, status: 'running' },
      'm.new_content': {
        [WORKFLOW_RUN_CONTENT_KEY]: {
          ...cardPayload,
          status: 'interrupted',
          error: 'Stopped at the cost limit ($1.00 of $1.00).',
        },
      },
    });
    expect(parsed?.status).toBe('interrupted');
    expect(parsed?.error).toBe('Stopped at the cost limit ($1.00 of $1.00).');
  });

  it('reads a question and its answered edit, defaulting missing options to freeText', () => {
    const open = parseWorkflowRunQuestion({
      [WORKFLOW_QUESTION_CONTENT_KEY]: {
        run: RUN,
        node: 'n5',
        question_id: 'q3fa91c',
        requester: VIEWER,
        text: 'Which module first?',
        status: 'open',
        answer: null,
      },
    });
    expect(open).toEqual({
      run: RUN,
      node: 'n5',
      questionId: 'q3fa91c',
      requester: VIEWER,
      text: 'Which module first?',
      options: [],
      freeText: true,
      status: 'open',
      answer: null,
    });

    const answered = parseWorkflowRunQuestion({
      'm.new_content': {
        [WORKFLOW_QUESTION_CONTENT_KEY]: {
          run: RUN,
          node: 'n5',
          question_id: 'q3fa91c',
          requester: VIEWER,
          text: 'Deploy?',
          options: ['Yes', 'No'],
          free_text: false,
          status: 'answered',
          answer: 'Yes',
        },
      },
    });
    expect(answered).toMatchObject({
      status: 'answered',
      answer: 'Yes',
      freeText: false,
      options: ['Yes', 'No'],
    });
  });

  it('sends an answer related to the card in its thread and returns the event id', async () => {
    const sendEvent = vi.fn(async () => ({ event_id: '$ans-1' }));
    const mx = {
      makeTxnId: () => 'txn-1',
      sendEvent,
    } as unknown as MatrixClient;
    const room = {
      roomId: '!room:example.org',
      getEventForTxnId: () => undefined,
    } as unknown as Room;
    const question = {
      run: RUN,
      node: 'n5',
      questionId: 'q3fa91c',
      requester: VIEWER,
      text: 'Deploy?',
      options: ['Yes', 'No'],
      freeText: false,
      status: 'open' as const,
      answer: null,
    };

    const id = await sendWorkflowRunAnswer(mx, room, '$thread-1', '$card-1', question, {
      option: 'Yes',
    });
    expect(id).toBe('$ans-1');
    expect(sendEvent).toHaveBeenCalledWith(
      '!room:example.org',
      WORKFLOW_ANSWER_EVENT_TYPE,
      {
        run: RUN,
        node: 'n5',
        option: 'Yes',
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: '$thread-1',
          'm.in_reply_to': { event_id: '$card-1' },
        },
      },
      'txn-1'
    );
  });

  it('sends a resume control event with optional max_cost_usd', async () => {
    const sendEvent = vi.fn(async () => ({ event_id: '$ctrl-1' }));
    const mx = {
      makeTxnId: () => 'txn-2',
      sendEvent,
    } as unknown as MatrixClient;
    const room = {
      roomId: '!room:example.org',
      getEventForTxnId: () => undefined,
    } as unknown as Room;

    await sendWorkflowRunResume(mx, room, '$thread-1', RUN);
    expect(sendEvent).toHaveBeenCalledWith(
      '!room:example.org',
      WORKFLOW_CONTROL_EVENT_TYPE,
      {
        run: RUN,
        action: 'resume',
        'm.relates_to': { rel_type: 'm.thread', event_id: '$thread-1' },
      },
      'txn-2'
    );

    await sendWorkflowRunResume(mx, room, null, RUN, { maxCostUsd: 5 });
    expect(sendEvent).toHaveBeenLastCalledWith(
      '!room:example.org',
      WORKFLOW_CONTROL_EVENT_TYPE,
      {
        run: RUN,
        action: 'resume',
        max_cost_usd: 5,
      },
      'txn-2'
    );
  });

  it('reads a rejection only from a MindRoom agent on the viewer homeserver', () => {
    const rejectionFrom = (sender: string) =>
      new MatrixEvent({
        type: WORKFLOW_ANSWER_REJECTED_EVENT_TYPE,
        event_id: '$rej-1',
        room_id: '!room:example.org',
        sender,
        origin_server_ts: 1,
        content: {
          run: RUN,
          node: 'n5',
          reason: 'already_answered',
          'm.relates_to': {
            rel_type: 'm.thread',
            event_id: '$thread-1',
            'm.in_reply_to': { event_id: '$ans-1' },
          },
        },
      });

    expect(parseWorkflowAnswerRejection(rejectionFrom(AGENT), VIEWER)).toEqual({
      answerEventId: '$ans-1',
      reason: 'already_answered',
    });
    // Encrypted events may keep m.relates_to on the wire envelope rather than inside clear content.
    const wireRelEvent = new MatrixEvent({
      type: 'm.room.encrypted',
      event_id: '$rej-enc',
      room_id: '!room:example.org',
      sender: AGENT,
      origin_server_ts: 2,
      content: {
        'm.relates_to': { 'm.in_reply_to': { event_id: '$ans-enc' } },
      },
    });
    wireRelEvent.makeEncrypted('m.room.encrypted', wireRelEvent.getWireContent(), '', '');
    (wireRelEvent as unknown as { clearEvent: Record<string, unknown> }).clearEvent = {
      type: WORKFLOW_ANSWER_REJECTED_EVENT_TYPE,
      content: { reason: 'no_longer_open' },
    };
    expect(parseWorkflowAnswerRejection(wireRelEvent, VIEWER)).toEqual({
      answerEventId: '$ans-enc',
      reason: 'no_longer_open',
    });
    expect(parseWorkflowAnswerRejection(rejectionFrom('@mallory:example.org'), VIEWER)).toBeNull();
    expect(
      parseWorkflowAnswerRejection(rejectionFrom('@mindroom_panels:other.org'), VIEWER)
    ).toBeNull();
  });
});
