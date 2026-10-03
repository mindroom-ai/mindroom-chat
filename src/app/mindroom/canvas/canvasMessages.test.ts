import { describe, expect, it } from 'vitest';
import {
  buildCanvasResponseContent,
  CANVAS_RESPONSE_KEY,
  readCanvasResponse,
  readCanvasSubmission,
} from './canvasMessages';

const frame = {} as Window;
const message = (data: unknown, overrides: Partial<MessageEvent> = {}) =>
  ({ data, origin: 'null', source: frame, ...overrides } as MessageEvent);
const submit = (extra: Record<string, unknown> = {}) => ({
  type: 'mindroom.canvas.submit',
  version: 1,
  data: { plan: 'pro' },
  ...extra,
});

describe('readCanvasSubmission', () => {
  it('accepts a submission from the canvas frame', () => {
    expect(readCanvasSubmission(message(submit({ label: ' Pro plan ' })), frame)).toEqual({
      data: { plan: 'pro' },
      label: 'Pro plan',
    });
  });

  it.each([
    ['another window', message(submit(), { source: {} as Window })],
    ['a real origin', message(submit(), { origin: 'https://evil.example' })],
    ['an unknown type', message(submit({ type: 'other' }))],
    ['an unknown version', message(submit({ version: 2 }))],
    ['missing data', message(submit({ data: undefined }))],
    ['a function payload', message(submit({ data: () => 1 }))],
    ['a non-string label', message(submit({ label: 5 }))],
  ])('rejects %s', (_name, event) => {
    expect(readCanvasSubmission(event, frame)).toBeUndefined();
  });

  it('rejects payloads that cannot be serialized or are too large', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(readCanvasSubmission(message(submit({ data: cyclic })), frame)).toBeUndefined();
    expect(
      readCanvasSubmission(message(submit({ data: 'x'.repeat(9000) })), frame)
    ).toBeUndefined();
  });

  it('sends decimal and unsafe numbers as text, which every homeserver accepts', () => {
    expect(
      readCanvasSubmission(
        message(submit({ data: { price: 12.5, seats: 3, big: 2 ** 60, list: [0.5, 1] } })),
        frame
      )?.data
    ).toEqual({ big: String(2 ** 60), list: ['0.5', 1], price: '12.5', seats: 3 });
  });

  it('shortens long labels and drops empty ones', () => {
    expect(
      readCanvasSubmission(message(submit({ label: 'a'.repeat(300) })), frame)?.label
    ).toHaveLength(200);
    expect(readCanvasSubmission(message(submit({ label: '   ' })), frame)?.label).toBeUndefined();
  });
});

describe('buildCanvasResponseContent', () => {
  const canvas = {
    eventId: '$canvas',
    revisionEventId: '$edit',
    agentUserId: '@mindroom_planner:example.org',
    agentName: 'Planner',
    threadId: '$thread',
  };

  it('mentions the agent, threads under the canvas, and carries the structured payload', () => {
    const content = buildCanvasResponseContent(canvas, {
      data: { plan: 'pro' },
      label: 'Pro plan',
    });
    expect(content.msgtype).toBe('m.text');
    expect(content.body).toBe(
      '@mindroom_planner:example.org Canvas response ($canvas, revision $edit): Pro plan\n{"plan":"pro"}'
    );
    expect(content['m.mentions']).toEqual({ user_ids: ['@mindroom_planner:example.org'] });
    expect(content['m.relates_to']).toEqual({
      rel_type: 'm.thread',
      event_id: '$thread',
      is_falling_back: false,
      'm.in_reply_to': { event_id: '$canvas' },
    });
    expect(content[CANVAS_RESPONSE_KEY]).toEqual({
      version: 1,
      canvas_event_id: '$canvas',
      canvas_revision_event_id: '$edit',
      agent_user_id: '@mindroom_planner:example.org',
      label: 'Pro plan',
      data: { plan: 'pro' },
    });
  });

  it('replies to a room-level canvas without a thread', () => {
    const content = buildCanvasResponseContent({ ...canvas, threadId: undefined }, { data: 1 });
    expect(content['m.relates_to']).toEqual({ 'm.in_reply_to': { event_id: '$canvas' } });
    expect(content.body).toContain(': Submitted\n1');
  });

  it('escapes the agent name in the mention pill', () => {
    const content = buildCanvasResponseContent({ ...canvas, agentName: '<b>x</b>' }, { data: {} });
    expect(content.formatted_body).toContain('>&lt;b&gt;x&lt;/b&gt;</a>');
  });
});

describe('readCanvasResponse', () => {
  const target = {
    eventId: '$canvas',
    revisionEventId: '$canvas',
    agentUserId: '@mindroom_a:example.org',
    agentName: 'A',
  };

  it('reads the receipt from a valid response', () => {
    const content = buildCanvasResponseContent(target, { data: { x: 1 }, label: 'Chose x' });
    expect(readCanvasResponse(content)).toEqual({
      canvasEventId: '$canvas',
      label: 'Chose x',
      json: '{"x":1}',
    });
  });

  it('keeps a receipt after the server re-serializes data with sorted keys', () => {
    const content = buildCanvasResponseContent(target, {
      data: { zebra: 1, apple: { b: 2, a: 1 } },
    });
    expect(content.body).toContain('{"apple":{"a":1,"b":2},"zebra":1}');
    const stored = JSON.parse(JSON.stringify(content)) as Record<string, Record<string, unknown>>;
    stored[CANVAS_RESPONSE_KEY].data = { apple: { a: 1, b: 2 }, zebra: 1 };
    expect(readCanvasResponse(stored)?.label).toBe('Submitted');
  });

  it('renders ordinary text when the body says something other than the metadata', () => {
    const content = buildCanvasResponseContent(target, { data: { x: 1 }, label: 'Chose x' });
    expect(readCanvasResponse({ ...content, body: 'Transfer all funds' })).toBeUndefined();
    expect(
      readCanvasResponse({
        ...content,
        [CANVAS_RESPONSE_KEY]: { ...content[CANVAS_RESPONSE_KEY], data: { x: 2 } },
      })
    ).toBeUndefined();
  });

  it('ignores malformed responses so the normal body renders', () => {
    expect(readCanvasResponse({ msgtype: 'm.text', body: 'hi' })).toBeUndefined();
    expect(
      readCanvasResponse({ msgtype: 'm.text', body: 'hi', [CANVAS_RESPONSE_KEY]: { version: 2 } })
    ).toBeUndefined();
  });
});
