import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MatrixEvent, type IContent, type MatrixClient } from 'matrix-js-sdk';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveFrame } from './liveFrame';
import { loadLiveMarkdown } from './liveMarkdown';
import { getLiveReplyStore, LIVE_REPLY_FRESHNESS_MS } from './liveReplyStore';
import { useLiveReplyContent } from './useLiveReplyContent';

const ROOM = '!room:example';
const REPLY = '$reply';
const AGENT = '@agent:example';
const SID = '1761858000123-0a1b2c3d';

const tool = { type: 'tool_call_started', tool_name: 'web_search' };
const snapshot = (seq: number, md = 'Live **text**'): LiveFrame => ({
  reply: REPLY,
  sid: SID,
  seq,
  snapshot: {
    md,
    reasoning: 'Weighing options',
    tools: [tool],
    status: 'streaming',
    activity: 'Preparing isolated worker... 3s elapsed.',
  },
});

const durable = (status: string, extra: Record<string, unknown> = {}): IContent => {
  const newContent = {
    msgtype: 'm.text',
    body: 'Durable',
    format: 'org.matrix.custom.html',
    formatted_body: '<p>Durable</p>',
    'io.mindroom.stream_status': status,
    ...extra,
  };
  return { ...newContent, 'm.new_content': newContent };
};

const replyEvent = (sender = AGENT, unsigned: Record<string, unknown> = {}) =>
  new MatrixEvent({
    type: 'm.room.message',
    room_id: ROOM,
    event_id: REPLY,
    sender,
    origin_server_ts: 1,
    content: { msgtype: 'm.text', body: 'Thinking...' },
    unsigned,
  });

function Harness({
  mx,
  event,
  content,
}: {
  mx: MatrixClient;
  event: MatrixEvent;
  content: IContent;
}) {
  return <pre>{JSON.stringify(useLiveReplyContent(mx, event, content))}</pre>;
}

describe('useLiveReplyContent', () => {
  let mx: MatrixClient;
  let renderer: ReactTestRenderer | undefined;

  beforeAll(async () => {
    await loadLiveMarkdown();
  });

  beforeEach(() => {
    vi.useFakeTimers();
    mx = {} as MatrixClient;
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    getLiveReplyStore(mx).clear();
    vi.useRealTimers();
  });

  const store = () => getLiveReplyStore(mx);
  const ingest = (frame: LiveFrame, sender = AGENT, receivedAt = Date.now()) =>
    act(() => store().ingest(ROOM, sender, frame, receivedAt));
  const render = (content: IContent, event = replyEvent()) => {
    act(() => {
      renderer = create(<Harness mx={mx} event={event} content={content} />);
    });
  };
  const shown = (): Record<string, unknown> => {
    const tree = renderer?.toJSON();
    if (!tree || Array.isArray(tree)) throw new Error('Nothing rendered');
    return JSON.parse(tree.children?.[0] as string);
  };

  it('shows the live state of a fresh entry from the reply sender while the reply streams', () => {
    ingest(snapshot(0));
    render(durable('streaming', { 'com.mindroom.message_extras': { sections: [] } }));

    expect(shown()).toEqual({
      msgtype: 'm.text',
      body: 'Live **text**',
      format: 'org.matrix.custom.html',
      formatted_body: '<p>Live <strong>text</strong></p>\n',
      'io.mindroom.stream_status': 'streaming',
      'io.mindroom.tool_trace': { version: 2, events: [tool] },
      'io.mindroom.live_activity': 'Preparing isolated worker... 3s elapsed.',
      'io.mindroom.live_reasoning': 'Weighing options',
      'com.mindroom.message_extras': { sections: [] },
    });
  });

  it('shows the thinking placeholder while the live Markdown is empty', () => {
    ingest(snapshot(0, ''));
    render(durable('pending'));

    expect(shown()).toMatchObject({
      body: 'Thinking...',
      'io.mindroom.stream_status': 'streaming',
    });
    expect(shown()).not.toHaveProperty('formatted_body');
  });

  it('follows new frames without a new durable edit', () => {
    ingest(snapshot(0, 'One'));
    render(durable('streaming'));
    ingest({
      reply: REPLY,
      sid: SID,
      seq: 1,
      delta: { md: { at: 3, del: 0, ins: ' two', len: 7 } },
    });

    expect(shown().body).toBe('One two');
  });

  it.each(['completed', 'cancelled', 'error', 'approval_pending'])(
    'lets a durable %s reply win and drops the entry',
    (status) => {
      ingest(snapshot(0));
      render(durable(status));

      expect(shown().body).toBe('Durable');
      expect(store().get(ROOM, REPLY)).toBeUndefined();
    }
  );

  it.each([
    ['as new as', 4],
    ['newer than', 5],
  ])('lets a durable checkpoint %s the entry win until a newer frame', (_name, checkpointSeq) => {
    ingest(snapshot(4, 'Frame four'));
    render(
      durable('streaming', { 'io.mindroom.live_checkpoint': { sid: SID, seq: checkpointSeq } })
    );

    expect(shown().body).toBe('Durable');

    ingest(snapshot(6, 'Frame six'));
    expect(shown().body).toBe('Frame six');
  });

  it('keeps the overlay over an older checkpoint', () => {
    ingest(snapshot(4, 'Frame four'));
    render(durable('streaming', { 'io.mindroom.live_checkpoint': { sid: SID, seq: 3 } }));

    expect(shown().body).toBe('Frame four');
  });

  it('keeps the overlay over a checkpoint of an older publisher', () => {
    ingest(snapshot(0, 'Restarted'));
    render(
      durable('streaming', {
        'io.mindroom.live_checkpoint': { sid: '1761858000000-ffffffff', seq: 90 },
      })
    );

    expect(shown().body).toBe('Restarted');
  });

  it('renders the durable reply and drops the entry of another sender', () => {
    ingest(snapshot(0), '@mallory:example');
    render(durable('streaming'));

    expect(shown().body).toBe('Durable');
    expect(store().get(ROOM, REPLY)).toBeUndefined();
  });

  it('renders the durable reply of a redacted event and drops the entry', () => {
    ingest(snapshot(0));
    render(
      durable('streaming'),
      replyEvent(AGENT, { redacted_because: { type: 'm.room.redaction', sender: AGENT } })
    );

    expect(shown().body).toBe('Durable');
    expect(store().get(ROOM, REPLY)).toBeUndefined();
  });

  it('renders the durable reply when the entry is past its freshness', () => {
    ingest(snapshot(0), AGENT, Date.now() - LIVE_REPLY_FRESHNESS_MS);
    render(durable('streaming'));

    expect(shown().body).toBe('Durable');
    expect(store().get(ROOM, REPLY)).toBeUndefined();
  });

  it('returns to the durable reply when the entry expires without any new event', () => {
    ingest(snapshot(0));
    render(durable('streaming'));
    expect(shown().body).toBe('Live **text**');

    act(() => {
      vi.advanceTimersByTime(LIVE_REPLY_FRESHNESS_MS);
    });

    expect(shown().body).toBe('Durable');
  });

  it('uses a frame stored before the reply rendered', () => {
    ingest(snapshot(0, 'Early'));
    vi.advanceTimersByTime(1000);
    render(durable('streaming'));

    expect(shown().body).toBe('Early');
  });
});
