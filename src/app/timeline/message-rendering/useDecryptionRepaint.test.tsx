import { useRef } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MatrixEvent } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
