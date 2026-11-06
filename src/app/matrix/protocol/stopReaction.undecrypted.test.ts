import { MatrixEvent } from 'matrix-js-sdk';
import type { Relations } from 'matrix-js-sdk/lib/models/relations';
import { describe, expect, it } from 'vitest';
import { getRenderableAnnotationsByKey, isAgentStopButton } from './stopReaction';

// Regression (L5-F009): in an encrypted room the agent's 🛑 under its streaming reply showed as a
// plain "🛑 1" chip, not the Stop button, while the reply or its newest edit waited for its key.

const ROOM = '!room:example.org';
const AGENT = '@mindroom_helper:example.org';

const streamingReply = (): MatrixEvent =>
  new MatrixEvent({
    type: 'm.room.message',
    event_id: '$reply',
    room_id: ROOM,
    sender: AGENT,
    origin_server_ts: 1,
    content: { msgtype: 'm.text', body: 'word1', 'io.mindroom.stream_status': 'streaming' },
  });

const encrypted = (id: string, relatesTo?: Record<string, unknown>): MatrixEvent =>
  new MatrixEvent({
    type: 'm.room.encrypted',
    event_id: id,
    room_id: ROOM,
    sender: AGENT,
    origin_server_ts: 2,
    content: {
      algorithm: 'm.megolm.v1.aes-sha2',
      ciphertext: 'opaque',
      ...(relatesTo ? { 'm.relates_to': relatesTo } : {}),
    },
  });

const stopReaction = (): MatrixEvent =>
  new MatrixEvent({
    type: 'm.reaction',
    event_id: '$stop',
    room_id: ROOM,
    sender: AGENT,
    origin_server_ts: 3,
    content: { 'm.relates_to': { rel_type: 'm.annotation', event_id: '$reply', key: '🛑' } },
  });

const relationsWithStop = (): Relations =>
  ({
    getSortedAnnotationsByKey: () => [['🛑', new Set([stopReaction()])]],
  } as unknown as Relations);

describe("the agent's stop reaction on a reply it cannot read yet", () => {
  it('is the Stop button while the newest edit of a streaming reply waits for its key', () => {
    const target = streamingReply();
    target.makeReplaced(encrypted('$edit', { rel_type: 'm.replace', event_id: '$reply' }));
    expect(isAgentStopButton('🛑', [stopReaction()], target)).toBe(true);
  });

  it('shows no chip while the reply itself is not decrypted', () => {
    const target = encrypted('$reply');
    expect(getRenderableAnnotationsByKey(relationsWithStop(), target)).toEqual([]);
  });
});
