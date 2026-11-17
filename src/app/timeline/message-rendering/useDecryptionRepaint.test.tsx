import { useRef } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import {
  createClient,
  FeatureSupport,
  MatrixEvent,
  MatrixEventEvent,
  Room,
  Thread,
} from 'matrix-js-sdk';
import { DecryptionError } from 'matrix-js-sdk/lib/common-crypto/CryptoBackend';
import { DecryptionFailureCode } from 'matrix-js-sdk/lib/crypto-api';
import { setReplacementRetentionPolicy } from 'matrix-js-sdk/lib/models/relations';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getEditedEvent,
  getLatestMessageContent,
  getPendingEdits,
  getReleasableEdits,
} from '../../matrix/room';
import { useDecryptionRepaint } from './useDecryptionRepaint';

// Regression (L5-F009): a row repainted when its own event decrypted, but not when the edit the
// SDK had put on it decrypted, so a reply kept the text it had before that edit until a reload.

const ROOM = '!room:example.org';
const AGENT = '@mindroom_helper:example.org';

const encrypted = (id: string, ts: number, relatesTo?: Record<string, unknown>): MatrixEvent =>
  new MatrixEvent({
    type: 'm.room.encrypted',
    event_id: id,
    room_id: ROOM,
    sender: AGENT,
    origin_server_ts: ts,
    content: {
      algorithm: 'm.megolm.v1.aes-sha2',
      ciphertext: 'opaque',
      ...(relatesTo ? { 'm.relates_to': relatesTo } : {}),
    },
  });

const decryptsTo = (content: Record<string, unknown>) => ({
  decryptEvent: vi.fn().mockResolvedValue({ clearEvent: { type: 'm.room.message', content } }),
});

function Host({ events, onRender }: { events: MatrixEvent[]; onRender: (n: number) => void }) {
  const renderedRef = useRef<MatrixEvent[]>(events);
  onRender(useDecryptionRepaint(renderedRef));
  return null;
}

describe('useDecryptionRepaint', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it("repaints when the edit on a row's event decrypts", async () => {
    const reply = encrypted('$reply', 1);
    await reply.attemptDecryption(decryptsTo({ msgtype: 'm.text', body: 'Thinking...' }) as never);
    const edit = encrypted('$edit', 2, { rel_type: 'm.replace', event_id: '$reply' });
    reply.makeReplaced(edit);
    const renders: number[] = [];
    act(() => {
      renderer = create(<Host events={[reply]} onRender={(n) => renders.push(n)} />);
    });

    await act(async () => {
      await edit.attemptDecryption(
        decryptsTo({
          msgtype: 'm.text',
          body: '* word1',
          'm.new_content': { msgtype: 'm.text', body: 'word1' },
          'm.relates_to': { rel_type: 'm.replace', event_id: '$reply' },
        }) as never
      );
    });
    expect(renders.at(-1)).toBeGreaterThan(0);
  });
});

// An older edit that could not be decrypted can lend the shown edit its tool trace once its key
// arrives. The shown edit stays the same, so nothing replaces the row's event: the row repaints
// because it listens to that edit too.
describe('a row whose older edit could not be decrypted', () => {
  const TOOL_TRACE = 'io.mindroom.tool_trace';
  const trace = { version: 2, events: [{ tool_name: 'search' }] };
  const editContent = (id: string, metadata: Record<string, unknown> = {}) => ({
    msgtype: 'm.text',
    body: `* ${id}`,
    'm.new_content': { msgtype: 'm.text', body: id, ...metadata },
    'm.relates_to': { rel_type: 'm.replace', event_id: '$reply' },
  });
  let renderer: ReactTestRenderer | undefined;
  const support = Thread.hasServerSideSupport;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    setReplacementRetentionPolicy(undefined);
    Thread.hasServerSideSupport = support;
  });

  it('repaints with the tool trace that edit lends once its key arrives', async () => {
    Thread.hasServerSideSupport = FeatureSupport.None;
    setReplacementRetentionPolicy(getReleasableEdits);
    const fetchFn = () => Promise.reject(new Error('offline'));
    const client = createClient({
      baseUrl: 'https://example.org',
      userId: '@me:example.org',
      fetchFn,
    });
    const room = new Room(ROOM, client, '@me:example.org', { timelineSupport: true });
    const reply = new MatrixEvent({
      type: 'm.room.message',
      event_id: '$reply',
      room_id: ROOM,
      sender: AGENT,
      origin_server_ts: 1,
      content: { msgtype: 'm.text', body: 'Thinking...' },
    });
    const readable = new MatrixEvent({
      type: 'm.room.message',
      event_id: '$readable',
      room_id: ROOM,
      sender: AGENT,
      origin_server_ts: 20,
      content: editContent('$readable'),
    });
    const older = encrypted('$older', 10, { rel_type: 'm.replace', event_id: '$reply' });
    let keyed = false;
    const crypto = {
      decryptEvent: vi.fn(async () => {
        if (!keyed) {
          throw new DecryptionError(
            DecryptionFailureCode.MEGOLM_UNKNOWN_INBOUND_SESSION_ID,
            'no key'
          );
        }
        return {
          clearEvent: {
            type: 'm.room.message',
            content: editContent('$older', { [TOOL_TRACE]: trace }),
          },
        };
      }),
    };
    await older.attemptDecryption(crypto as never);
    await room.addLiveEvents([reply, readable, older], { addToState: false });
    const timelineSet = room.getUnfilteredTimelineSet();

    const traces: unknown[] = [];
    // What a message row does (useTimelineMessageFeature): listen to the events it showed.
    function Row() {
      const renderedRef = useRef<MatrixEvent[]>([]);
      renderedRef.current = [];
      useDecryptionRepaint(renderedRef);
      renderedRef.current.push(...getPendingEdits('$reply', reply, timelineSet), reply);
      const content = getLatestMessageContent(reply, getEditedEvent('$reply', reply, timelineSet));
      traces.push(content[TOOL_TRACE]);
      return null;
    }
    const listeners = older.listenerCount(MatrixEventEvent.Decrypted);
    act(() => {
      renderer = create(<Row />);
    });
    expect(older.listenerCount(MatrixEventEvent.Decrypted)).toBe(listeners + 1);
    expect(traces.at(-1)).toBeUndefined();

    await act(async () => {
      keyed = true;
      await older.attemptDecryption(crypto as never, { isRetry: true });
    });

    expect(traces.at(-1)).toEqual(trace);
  });
});
